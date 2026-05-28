import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { mkdir, readFile, readdir, rm, symlink, writeFile } from "node:fs/promises";
import { connect as connectTCP } from "node:net";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { startVisibleOriginConnectTunnel } from "../src/connectTunnel";
import {
  buildHtmlRoutes,
  contentTypeFor,
  createDirectoryListingResponse,
  createLocalStoragePersistenceRoutes,
  createPostedRequestPayload,
  createReloadBroadcaster,
  defaultStableWebSpacePort,
  findRootEntry,
  isIgnoredReloadPath,
  readFileResponse,
  readLocalStorageSnapshot,
  renderMarkdownDocument,
  renderMarkdownResponse,
  resolveDocumentPath,
  resolveLocalStorageFilePath,
  resolveRequestPath,
  resolveServerPort,
  resolveServeRoot,
  resolveUnsupportedLegacyDynamicRequestPath,
  resolveWebSpace,
  resolveWebSpaceRequestPath,
  scanHtmlPages,
  stableWebSpaceHostname,
  stableWebSpaceURL,
  webFileSchemaURLForBuildCommit,
  writeLocalStorageSnapshot,
} from "../src/webPackage";

let root: string;
const testBuildCommit = "0123456789abcdef0123456789abcdef01234567";

beforeEach(async () => {
  root = join(tmpdir(), `.web-test-${crypto.randomUUID()}.web`);
  await mkdir(root, { recursive: true });
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

function testWebSpace(rootPath = root) {
  return {
    documentPath: rootPath,
    activeRootPath: rootPath,
    webspaceRootPath: rootPath,
    activeBasePath: "/",
    webspaceKind: "sibling" as const,
    mounts: [],
  };
}

const repoRoot = join(import.meta.dir, "../../../../..");

async function rawTCPRequest(url: URL, requestText: string): Promise<string> {
  return await new Promise((resolvePromise, reject) => {
    const chunks: Buffer[] = [];
    const socket = connectTCP(Number(url.port), url.hostname, () => {
      socket.write(requestText);
    });
    let settled = false;
    let idleTimer: ReturnType<typeof setTimeout> | null = null;
    const settle = (error?: Error) => {
      if (settled) {
        return;
      }
      settled = true;
      if (idleTimer !== null) {
        clearTimeout(idleTimer);
      }
      socket.destroy();
      if (error) {
        reject(error);
        return;
      }
      resolvePromise(Buffer.concat(chunks).toString("utf8"));
    };

    socket.setTimeout(5_000, () => settle(new Error("TCP request timed out.")));
    socket.on("data", (chunk) => {
      chunks.push(Buffer.from(chunk));
      if (idleTimer !== null) {
        clearTimeout(idleTimer);
      }
      idleTimer = setTimeout(() => settle(), 50);
    });
    socket.on("error", settle);
    socket.on("close", () => settle());
  });
}

describe("web package resolution", () => {
  test("resolves .web files and empty packages to their parent directory", async () => {
    await rm(root, { recursive: true, force: true });
    await writeFile(root, "");
    expect(resolveDocumentPath(root)).toBe(root);
    expect(await resolveServeRoot(root)).toBe(dirname(root));

    await rm(root, { force: true });
    await mkdir(root, { recursive: true });
    expect(await resolveServeRoot(root)).toBe(dirname(root));

    await writeFile(join(root, ".DS_Store"), "");
    expect(await resolveServeRoot(root)).toBe(dirname(root));

    await mkdir(join(root, ".local"), { recursive: true });
    await writeFile(join(root, ".local", "storage.json5"), "{}");
    expect(await resolveServeRoot(root)).toBe(dirname(root));
  });

  test("resolves non-empty .web packages to their own contents", async () => {
    await writeFile(join(root, "index.html"), "<h1>Home</h1>");
    expect(await resolveServeRoot(root)).toBe(root);
  });

  test("upgrades empty .web files inside git repos to local JSON5 manifests", async () => {
    const project = join(root, "project");
    const apps = join(project, "apps");
    const site = join(apps, "Dashboard.web");
    await mkdir(join(project, ".git"), { recursive: true });
    await mkdir(apps, { recursive: true });
    await writeFile(site, "");

    const webspace = await resolveWebSpace(site, { buildCommit: testBuildCommit });
    const manifest = await readFile(site, "utf8");

    expect(manifest).toContain(`"$schema": "${webFileSchemaURLForBuildCommit(testBuildCommit)}"`);
    expect(manifest).toContain('root: "@/apps"');
    expect(webspace.activeRootPath).toBe(apps);
    expect(webspace.webspaceRootPath).toBe(project);
    expect(webspace.activeBasePath).toBe("/apps/");
  });

  test("upgrades empty .web files outside git repos to relative local JSON5 manifests", async () => {
    const standaloneRoot = join("/private/tmp", `web-file-${crypto.randomUUID()}`);
    try {
      const site = join(standaloneRoot, "Site.web");
      await mkdir(standaloneRoot, { recursive: true });
      await writeFile(site, "");

      const webspace = await resolveWebSpace(site, { buildCommit: testBuildCommit });
      const manifest = await readFile(site, "utf8");

      expect(manifest).toContain('root: "./"');
      expect(webspace.activeRootPath).toBe(standaloneRoot);
      expect(webspace.webspaceKind).toBe("sibling");
      expect(webspace.activeBasePath).toBe("/");
    } finally {
      await rm(standaloneRoot, { recursive: true, force: true });
    }
  });

  test("upgrades empty .web bundle folders from the Untitled template", async () => {
    const webspace = await resolveWebSpace(root, { buildCommit: testBuildCommit });

    expect(existsSync(join(root, "index.html"))).toBe(true);
    expect(await readFile(join(root, "index.html"), "utf8")).toContain("Untitled Web");
    expect(webspace.activeRootPath).toBe(root);
  });

  test("requires non-empty .web files to be valid manifests", async () => {
    await rm(root, { recursive: true, force: true });
    await writeFile(root, "{ web: 1, source: { kind: 'local', root: './' } }");
    await expect(resolveWebSpace(root, { buildCommit: testBuildCommit })).rejects.toThrow("$schema");

    await writeFile(root, `{
  "$schema": "${webFileSchemaURLForBuildCommit(testBuildCommit)}",
  web: 1,
  source: {
    kind: "git",
    provider: "github",
    repo: "owner/repo",
    commit: "main",
    path: "packages/ui.web",
  },
}`);
    await expect(resolveWebSpace(root, { buildCommit: testBuildCommit })).rejects.toThrow("full 40-character SHA");

    await writeFile(root, `{
  "$schema": "${webFileSchemaURLForBuildCommit(testBuildCommit)}",
  web: 1,
  source: {
    kind: "git",
    provider: "github",
    repo: "../repo",
    commit: "0123456789abcdef0123456789abcdef01234567",
    path: "packages/ui.web",
  },
}`);
    await expect(resolveWebSpace(root, { buildCommit: testBuildCommit })).rejects.toThrow("owner/repo");
  });

  test("mounts local .web manifest files at their document route", async () => {
    const project = join(root, "project");
    const app = join(project, "apps", "dashboard.web");
    const kitSource = join(project, "src", "ui-kit");
    const kitManifest = join(project, "packages", "ui-kit.web");
    await mkdir(join(project, ".git"), { recursive: true });
    await mkdir(app, { recursive: true });
    await mkdir(kitSource, { recursive: true });
    await mkdir(dirname(kitManifest), { recursive: true });
    await writeFile(join(app, "index.html"), "<h1>Dashboard</h1>");
    await writeFile(join(kitSource, "button.js"), "export const name = 'button';");
    await writeFile(kitManifest, `{
  "$schema": "${webFileSchemaURLForBuildCommit(testBuildCommit)}",
  web: 1,
  source: {
    kind: "local",
    root: "@/src/ui-kit",
  },
}`);

    const webspace = await resolveWebSpace(app, { buildCommit: testBuildCommit });
    expect(await resolveWebSpaceRequestPath(webspace, "/packages/ui-kit.web/button.js")).toEqual({
      kind: "file",
      path: join(kitSource, "button.js"),
    });
  });

  test("skips invalid peer .web manifests without breaking the active package", async () => {
    const project = join(root, "project");
    const app = join(project, "apps", "dashboard.web");
    const badPeer = join(project, "packages", "bad.web");
    await mkdir(join(project, ".git"), { recursive: true });
    await mkdir(app, { recursive: true });
    await mkdir(dirname(badPeer), { recursive: true });
    await writeFile(join(app, "index.html"), "<h1>Dashboard</h1>");
    await writeFile(badPeer, "{ web: 1, source: { kind: 'local', root: './' } }");

    const warnings: string[] = [];
    const originalWarn = console.warn;
    console.warn = (...values: unknown[]) => {
      warnings.push(values.map(String).join(" "));
    };
    try {
      const webspace = await resolveWebSpace(app, { buildCommit: testBuildCommit });
      expect(webspace.activeRootPath).toBe(app);
      expect(await resolveWebSpaceRequestPath(webspace, "/apps/dashboard.web/index.html")).toEqual({
        kind: "file",
        path: join(app, "index.html"),
      });
      expect(await resolveWebSpaceRequestPath(webspace, "/packages/bad.web/index.html")).toBeNull();
    } finally {
      console.warn = originalWarn;
    }
    expect(warnings.join("\n")).toContain("Skipping .web peer manifest");
    expect(warnings.join("\n")).toContain("bad.web");
  });

  test("mounts prepared git .web manifest files at their document route", async () => {
    const project = join(root, "project");
    const manifestPath = join(project, "packages", "remote.web");
    const cacheRoot = join("/private/tmp", `web-remote-cache-${crypto.randomUUID()}`);
    const cachedBundle = join(cacheRoot, "github", "owner", "repo", testBuildCommit, "packages", "remote.web");
    try {
      await mkdir(join(project, ".git"), { recursive: true });
      await mkdir(dirname(manifestPath), { recursive: true });
      await mkdir(cachedBundle, { recursive: true });
      await writeFile(join(cacheRoot, "github", "owner", "repo", testBuildCommit, ".web-ready"), "ready\n");
      await writeFile(join(cachedBundle, "index.html"), "<h1>Remote</h1>");
      await writeFile(manifestPath, `{
  "$schema": "${webFileSchemaURLForBuildCommit(testBuildCommit)}",
  web: 1,
  source: {
    kind: "git",
    provider: "github",
    repo: "owner/repo",
    commit: "${testBuildCommit}",
    path: "packages/remote.web",
  },
}`);

      const webspace = await resolveWebSpace(manifestPath, {
        buildCommit: testBuildCommit,
        remoteCacheRootPath: cacheRoot,
      });
      expect(webspace.activeRootPath).toBe(cachedBundle);
      expect(webspace.activeBasePath).toBe("/packages/remote.web/");
      expect(await resolveWebSpaceRequestPath(webspace, "/packages/remote.web/index.html")).toEqual({
        kind: "file",
        path: join(cachedBundle, "index.html"),
      });
    } finally {
      await rm(cacheRoot, { recursive: true, force: true });
    }
  });

  test("uses git roots for URL geometry while serving only .web package contents", async () => {
    const project = join(root, "project");
    const app = join(project, "apps", "dashboard.web");
    const kit = join(project, "packages", "ui-kit.web");
    await mkdir(join(project, ".git"), { recursive: true });
    await mkdir(app, { recursive: true });
    await mkdir(join(kit, "exports"), { recursive: true });
    await writeFile(join(app, "index.html"), "<h1>Dashboard</h1>");
    await writeFile(join(kit, "exports", "button.js"), "export const name = 'button';");
    await writeFile(join(project, "private.txt"), "secret");

    const webspace = await resolveWebSpace(app);
    expect(webspace.webspaceKind).toBe("git");
    expect(webspace.webspaceRootPath).toBe(project);
    expect(webspace.activeRootPath).toBe(app);
    expect(webspace.activeBasePath).toBe("/apps/dashboard.web/");

    expect(await resolveWebSpaceRequestPath(webspace, "/apps/dashboard.web/index.html")).toEqual({
      kind: "file",
      path: join(app, "index.html"),
    });
    expect(await resolveWebSpaceRequestPath(webspace, "/packages/ui-kit.web/exports/button.js")).toEqual({
      kind: "file",
      path: join(kit, "exports", "button.js"),
    });
    expect(await resolveWebSpaceRequestPath(webspace, "/private.txt")).toBeNull();
  });

  test("falls back to sibling webspace roots without a git root", async () => {
    const standaloneRoot = join("/private/tmp", `webspace-${crypto.randomUUID()}`);
    try {
      const app = join(standaloneRoot, "dashboard.web");
      const kit = join(standaloneRoot, "ui-kit.web");
      await mkdir(app, { recursive: true });
      await mkdir(kit, { recursive: true });
      await writeFile(join(app, "index.html"), "<h1>Dashboard</h1>");
      await writeFile(join(kit, "tokens.css"), ":root { color: red; }");

      const webspace = await resolveWebSpace(app);
      expect(webspace.webspaceKind).toBe("sibling");
      expect(webspace.webspaceRootPath).toBe(standaloneRoot);
      expect(webspace.activeBasePath).toBe("/dashboard.web/");
      expect(await resolveWebSpaceRequestPath(webspace, "/ui-kit.web/tokens.css")).toEqual({
        kind: "file",
        path: join(kit, "tokens.css"),
      });
    } finally {
      await rm(standaloneRoot, { recursive: true, force: true });
    }
  });

  test("derives stable localhost origins from the webspace root", async () => {
    const project = join(root, "project");
    const app = join(project, "apps", "dashboard.web");
    const peer = join(project, "apps", "peer.web");
    await mkdir(join(project, ".git"), { recursive: true });
    await mkdir(app, { recursive: true });
    await mkdir(peer, { recursive: true });
    await writeFile(join(app, "index.html"), "<h1>Dashboard</h1>");
    await writeFile(join(peer, "index.html"), "<h1>Peer</h1>");

    const appWebspace = await resolveWebSpace(app);
    const peerWebspace = await resolveWebSpace(peer);

    expect(stableWebSpaceHostname(appWebspace.webspaceRootPath)).toBe(stableWebSpaceHostname(peerWebspace.webspaceRootPath));
    expect(stableWebSpaceURL(appWebspace).origin).toBe(stableWebSpaceURL(peerWebspace).origin);
    expect(stableWebSpaceURL(appWebspace).port).toBe(String(defaultStableWebSpacePort()));
    expect(stableWebSpaceURL(appWebspace).pathname).toBe("/apps/dashboard.web/");
    expect(stableWebSpaceURL(peerWebspace).pathname).toBe("/apps/peer.web/");
  });

  test("stable webspace URL uses 55555 while backend port may be ephemeral", async () => {
    const backendPort = await resolveServerPort("0");
    const webspace = testWebSpace(root);
    const visibleWebspaceURL = stableWebSpaceURL(webspace);
    const backendServerURL = new URL(visibleWebspaceURL.pathname, `http://127.0.0.1:${backendPort}`);

    expect(visibleWebspaceURL.hostname).toBe(stableWebSpaceHostname(root));
    expect(visibleWebspaceURL.port).toBe(String(defaultStableWebSpacePort()));
    expect(backendServerURL.hostname).toBe("127.0.0.1");
    expect(backendServerURL.port).toBe(String(backendPort));
    expect(backendServerURL.pathname).toBe(visibleWebspaceURL.pathname);
  });

  test("stable webspace tunnel uses an ephemeral port and preserves the visible host", async () => {
    const visibleWebspaceURL = new URL("http://repo--a1b2c3d4.localhost:55555/apps/dashboard.web/");
    const backendServer = Bun.serve({
      hostname: "127.0.0.1",
      port: await resolveServerPort(),
      idleTimeout: 0,
      fetch(request) {
        return Response.json({
          url: request.url,
          host: request.headers.get("Host"),
        });
      },
    });
    const tunnel = await startVisibleOriginConnectTunnel({
      visibleOriginURL: visibleWebspaceURL,
      backendURL: backendServer.url,
    });

    try {
      expect(tunnel.url.hostname).toBe("127.0.0.1");
      expect(tunnel.url.port).not.toBe("55555");
      expect(tunnel.url.port).not.toBe(String(backendServer.port));

      const response = await rawTCPRequest(
        tunnel.url,
        [
          `CONNECT ${visibleWebspaceURL.host} HTTP/1.1`,
          `Host: ${visibleWebspaceURL.host}`,
          "",
          `GET /apps/dashboard.web/index.html?x=1 HTTP/1.1`,
          `Host: ${visibleWebspaceURL.host}`,
          "Connection: close",
          "",
          "",
        ].join("\r\n"),
      );
      expect(response).toContain("HTTP/1.1 200 Connection Established");
      expect(response).toContain("HTTP/1.1 200 OK");
      expect(response).toContain('"url":"http://repo--a1b2c3d4.localhost:55555/apps/dashboard.web/index.html?x=1"');
      expect(response).toContain('"host":"repo--a1b2c3d4.localhost:55555"');

      const absoluteFormResponse = await rawTCPRequest(
        tunnel.url,
        [
          `GET ${new URL("index.html?x=2", visibleWebspaceURL).href} HTTP/1.1`,
          `Host: ${visibleWebspaceURL.host}`,
          "Proxy-Connection: keep-alive",
          "",
          "",
        ].join("\r\n"),
      );
      expect(absoluteFormResponse).toContain("HTTP/1.1 200 OK");
      expect(absoluteFormResponse).toContain('"url":"http://repo--a1b2c3d4.localhost:55555/apps/dashboard.web/index.html?x=2"');
      expect(absoluteFormResponse).toContain('"host":"repo--a1b2c3d4.localhost:55555"');

      const originFormResponse = await rawTCPRequest(
        tunnel.url,
        [
          "GET /apps/dashboard.web/index.html?x=3 HTTP/1.1",
          `Host: ${visibleWebspaceURL.host}`,
          "Proxy-Connection: keep-alive",
          "",
          "",
        ].join("\r\n"),
      );
      expect(originFormResponse).toContain("HTTP/1.1 200 OK");
      expect(originFormResponse).toContain('"url":"http://repo--a1b2c3d4.localhost:55555/apps/dashboard.web/index.html?x=3"');
      expect(originFormResponse).toContain('"host":"repo--a1b2c3d4.localhost:55555"');

      const rejected = await rawTCPRequest(
        tunnel.url,
        [
          "CONNECT other.localhost:55555 HTTP/1.1",
          "Host: other.localhost:55555",
          "",
          "",
        ].join("\r\n"),
      );
      expect(rejected).toContain("HTTP/1.1 403 Forbidden");

      const rejectedForward = await rawTCPRequest(
        tunnel.url,
        [
          "GET http://other.localhost:55555/apps/dashboard.web/ HTTP/1.1",
          "Host: other.localhost:55555",
          "",
          "",
        ].join("\r\n"),
      );
      expect(rejectedForward).toContain("HTTP/1.1 403 Forbidden");
    } finally {
      await tunnel.close();
      backendServer.stop(true);
    }
  });

  test("rejects path traversal and symlinks", async () => {
    await writeFile(join(root, "index.html"), "<h1>ok</h1>");
    expect(await resolveRequestPath(root, "/index.html")).toEqual({ kind: "file", path: join(root, "index.html") });
    expect(await resolveRequestPath(root, "/../secret.txt")).toBeNull();

    await writeFile(join(root, "target.txt"), "target");
    await symlink(join(root, "target.txt"), join(root, "linked.txt"));
    expect(await resolveRequestPath(root, "/linked.txt")).toBeNull();

    await mkdir(join(root, ".local"), { recursive: true });
    await writeFile(join(root, ".local", "secret.txt"), "secret");
    expect(await resolveRequestPath(root, "/.local/secret.txt")).toBeNull();

    await mkdir(join(root, "_web", "persistence"), { recursive: true });
    await writeFile(join(root, "_web", "persistence", "local-storage"), "not the route");
    expect(await resolveRequestPath(root, "/_web/persistence/local-storage")).toBeNull();
  });

  test("maps fossil dynamic URLs only to explicit html shadow files", async () => {
    await mkdir(join(root, "cgi-bin"), { recursive: true });
    await writeFile(join(root, "cgi-bin", "contact.cgi"), "<h1>not supported</h1>");
    expect(await resolveRequestPath(root, "/cgi-bin/contact.cgi")).toBeNull();

    const webspace = await resolveWebSpace(root);
    expect(await resolveUnsupportedLegacyDynamicRequestPath(
      webspace,
      `${webspace.activeBasePath}cgi-bin/contact.cgi`,
    )).toEqual({
      path: join(root, "cgi-bin", "contact.cgi"),
      extension: ".cgi",
      shadowPath: join(root, "cgi-bin", "contact.cgi.html"),
    });

    await writeFile(join(root, "cgi-bin", "contact.cgi.html"), "<h1>Contact</h1>");
    expect(await resolveRequestPath(root, "/cgi-bin/contact.cgi")).toEqual({
      kind: "file",
      path: join(root, "cgi-bin", "contact.cgi.html"),
    });
    expect(await resolveRequestPath(root, "/cgi-bin/contact.cgi.html")).toEqual({
      kind: "file",
      path: join(root, "cgi-bin", "contact.cgi.html"),
    });
  });

  test("serves fossil dynamic aliases with posted request data", async () => {
    await mkdir(join(root, "cgi-bin"), { recursive: true });
    await writeFile(
      join(root, "cgi-bin", "contact.cgi.html"),
      "<!doctype html><html><head><script>window.pageScriptRan = true;</script></head><body><h1>Contact</h1></body></html>",
    );
    const server = Bun.serve({
      port: await resolveServerPort(),
      idleTimeout: 0,
      async fetch(request) {
        const url = new URL(request.url);
        const resolved = await resolveRequestPath(root, url.pathname);
        if (resolved?.kind !== "file") {
          return new Response("Not found", { status: 404 });
        }
        if (request.method === "POST") {
          return await readFileResponse(resolved.path, {
            postedRequest: await createPostedRequestPayload(request),
          });
        }
        return await readFileResponse(resolved.path);
      },
    });

    try {
      const getResponse = await fetch(new URL("/cgi-bin/contact.cgi", server.url));
      expect(await getResponse.text()).toContain("<h1>Contact</h1>");

      const postResponse = await fetch(new URL("/cgi-bin/contact.cgi", server.url), {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: "name=Tom",
      });
      const html = await postResponse.text();
      expect(html).toContain('"action":"/cgi-bin/contact.cgi"');
      expect(html).toContain('"fields":[["name","Tom"]]');
      expect(html.indexOf("appify-host-request")).toBeLessThan(html.indexOf("window.pageScriptRan"));
    } finally {
      server.stop(true);
    }
  });

  test("maps common static content types", () => {
    expect(contentTypeFor("index.html")).toBe("text/html; charset=utf-8");
    expect(contentTypeFor("style.css")).toBe("text/css; charset=utf-8");
    expect(contentTypeFor("data.csv")).toBe("text/csv; charset=utf-8");
    expect(contentTypeFor("manual.pdf")).toBe("application/pdf");
    expect(contentTypeFor("unknown.bin")).toBe("application/octet-stream");
  });

  test("resolves configured and ephemeral server ports", async () => {
    expect(await resolveServerPort("4321")).toBe(4321);
    await expect(resolveServerPort("invalid")).rejects.toThrow("PORT must be an integer");

    const port = await resolveServerPort("0");
    expect(port).toBeGreaterThan(0);
    expect(port).toBeLessThanOrEqual(65535);
  });

  test("ignores .local changes for live reload", () => {
    expect(isIgnoredReloadPath(root, ".local/storage.json5")).toBe(true);
    expect(isIgnoredReloadPath(root, ".local/example.web.storage.json")).toBe(true);
    expect(isIgnoredReloadPath(root, Buffer.from(".local/storage.json5"))).toBe(true);
    expect(isIgnoredReloadPath(root, "index.html")).toBe(false);
    expect(isIgnoredReloadPath(root, null)).toBe(false);
  });

  test("finds normal and named root indexes", async () => {
    await writeFile(join(root, "about.html"), "<h1>About</h1>");
    await writeFile(join(root, "index.reseach.html"), "<h1>Index</h1>");
    const pages = await scanHtmlPages(root);
    expect(await findRootEntry(root, pages)).toBe(join(root, "index.reseach.html"));

    await writeFile(join(root, "index.html"), "<h1>Canonical</h1>");
    expect(await findRootEntry(root, await scanHtmlPages(root))).toBe(join(root, "index.html"));
  });

  test("creates Bun HTML routes for discovered pages and index aliases", async () => {
    await mkdir(join(root, "section"), { recursive: true });
    await writeFile(join(root, "index.html"), "<h1>Home</h1>");
    await writeFile(join(root, "legacy.htm"), "<!doctype html><body><h1>Legacy</h1></body>");
    await writeFile(join(root, "section", "index.alt.html"), "<h1>Alternate</h1>");
    await writeFile(join(root, "section", "index.html"), "<h1>Section</h1>");
    const pages = await scanHtmlPages(root);
    const routes = await buildHtmlRoutes(root, pages, await findRootEntry(root, pages), true);

    expect(routes["/"]).toBeDefined();
    expect(routes["/index.html"]).toBeDefined();
    expect(routes["/section/"]).toBeDefined();
    expect(routes["/section/index.html"]).toBeDefined();
    expect(routes["/section/"]).toBe(routes["/section/index.html"]);
    expect(routes["/section/"]).not.toBe(routes["/section/index.alt.html"]);

    const server = Bun.serve({
      port: await resolveServerPort(),
      idleTimeout: 0,
      routes,
      fetch() {
        return new Response("fallback");
      },
    });
    try {
      const legacy = await fetch(new URL("/legacy.htm", server.url));
      expect(await legacy.text()).toContain("<h1>Legacy</h1>");
    } finally {
      server.stop(true);
    }

    const routesWithoutHmr = await buildHtmlRoutes(root, pages, await findRootEntry(root, pages), false);
    expect(routesWithoutHmr["/_web/live-reload"]).toBeUndefined();

    const routesWithPersistence = await buildHtmlRoutes(root, pages, await findRootEntry(root, pages), false, {
      localStoragePersistence: true,
    });
    const persistenceServer = Bun.serve({
      port: await resolveServerPort(),
      idleTimeout: 0,
      routes: routesWithPersistence,
      fetch() {
        return new Response("fallback");
      },
    });
    try {
      const legacy = await fetch(new URL("/legacy.htm", persistenceServer.url));
      expect(await legacy.text()).toContain("__WEB_APP_LOCAL_STORAGE__");
    } finally {
      persistenceServer.stop(true);
    }

    const prefixedRoutes = await buildHtmlRoutes(root, pages, await findRootEntry(root, pages), false, {
      localStoragePersistence: true,
      controlBasePath: "/apps/dashboard.web/",
      routeBasePath: "/apps/dashboard.web/",
    });
    expect(prefixedRoutes["/apps/dashboard.web/"]).toBeDefined();
    expect(prefixedRoutes["/apps/dashboard.web/index.html"]).toBeDefined();
    const prefixedServer = Bun.serve({
      port: await resolveServerPort(),
      idleTimeout: 0,
      routes: prefixedRoutes,
      fetch() {
        return new Response("fallback");
      },
    });
    try {
      const prefixedHome = await fetch(new URL("/apps/dashboard.web/", prefixedServer.url));
      expect(await prefixedHome.text()).toContain("/apps/dashboard.web/_web/persistence/local-storage");
    } finally {
      prefixedServer.stop(true);
    }

    await writeFile(join(root, "module.html"), "<!doctype html><script type=\"module\" src=\"./module.js\"></script>");
    await writeFile(join(root, "module.js"), "document.body.textContent = 'module';");
    const moduleRoutes = await buildHtmlRoutes(root, await scanHtmlPages(root), await findRootEntry(root), false, {
      localStoragePersistence: true,
    });
    const moduleServer = Bun.serve({
      port: await resolveServerPort(),
      idleTimeout: 0,
      routes: moduleRoutes,
      fetch() {
        return new Response("fallback");
      },
    });
    try {
      const modulePage = await fetch(new URL("/module.html", moduleServer.url));
      expect(await modulePage.text()).toContain("__WEB_APP_LOCAL_STORAGE__");
    } finally {
      moduleServer.stop(true);
    }
  });
});

describe("localStorage persistence", () => {
  test("uses package-local storage for directory documents", async () => {
    expect(await resolveLocalStorageFilePath(root)).toBe(join(root, ".local", "storage.json5"));
  });

  test("uses adjacent sidecar storage for file documents", async () => {
    await rm(root, { recursive: true, force: true });
    await writeFile(root, "");

    expect(await resolveLocalStorageFilePath(root)).toBe(
      join(dirname(root), ".local", "storage.json5"),
    );
  });

  test("reads missing storage without creating a sidecar", async () => {
    const storageFilePath = await resolveLocalStorageFilePath(root);
    const routes = createLocalStoragePersistenceRoutes(storageFilePath, root);
    const route = routes["/_web/persistence/local-storage"] as { GET: (request?: Request) => Promise<Response> };
    const response = await route.GET(new Request("http://127.0.0.1/_web/persistence/local-storage?page=%2Findex.html"));

    expect(await response.json()).toEqual({ schema: 1, entries: [] });
    expect(existsSync(join(root, ".local"))).toBe(false);
  });

  test("writes non-empty snapshots and removes empty snapshots", async () => {
    const storageFilePath = await resolveLocalStorageFilePath(root);
    const snapshot = { schema: 1 as const, entries: [["theme", "dark"] as [string, string]] };

    await writeLocalStorageSnapshot(storageFilePath, snapshot);
    expect(JSON.parse(await readFile(storageFilePath, "utf8"))).toEqual({
      schema: 4,
      entries: [{ key: "theme", value: "dark" }],
      files: [],
    });
    expect(await readLocalStorageSnapshot(storageFilePath)).toEqual(snapshot);

    await writeLocalStorageSnapshot(storageFilePath, { schema: 1, entries: [] });
    expect(existsSync(storageFilePath)).toBe(false);
  });

  test("reads private JSON values from flat storage", async () => {
    const storageFilePath = await resolveLocalStorageFilePath(root);
    const viewValue = { selectedId: "intro" };

    await mkdir(dirname(storageFilePath), { recursive: true });
    await writeFile(storageFilePath, `${JSON.stringify({
      schema: 4,
      entries: [
        { key: "theme", value: "dark" },
        { key: "view", json: viewValue },
      ],
      files: [],
    }, null, 2)}\n`);

    expect(await readLocalStorageSnapshot(storageFilePath)).toEqual({
      schema: 1,
      entries: [
        ["theme", "dark"],
        ["view", JSON.stringify(viewValue)],
      ],
    });
  });

  test("writes root-relative and page-relative file keys", async () => {
    const storageFilePath = await resolveLocalStorageFilePath(root);
    await mkdir(join(root, "path", "to", "random"), { recursive: true });
    await writeFile(join(root, "path", "to", "random", "file.html"), "<h1>Page</h1>");
    const snapshot = {
      schema: 1 as const,
      entries: [
        ["./subpath/document.canvas", "{\n  \"nodes\": [],\n  \"edges\": []\n}\n"],
        ["/root.canvas", "root document\n"],
        ["../bad.canvas", "bad"],
        ["./deep//bad.canvas", "bad"],
        ["./.hidden/file.txt", "bad"],
        ["./noextension", "bad"],
        ["theme", "dark"],
      ] as [string, string][],
    };

    await writeLocalStorageSnapshot(storageFilePath, snapshot, {
      webspace: testWebSpace(),
      pagePath: "/path/to/random/file.html",
    });

    expect(await readFile(join(root, "path", "to", "random", "subpath", "document.canvas"), "utf8")).toBe(
      "{\n  \"nodes\": [],\n  \"edges\": []\n}\n",
    );
    expect(await readFile(join(root, "root.canvas"), "utf8")).toBe("root document\n");

    const diskSnapshot = JSON.parse(await readFile(storageFilePath, "utf8"));
    expect(diskSnapshot).toEqual({
      schema: 4,
      entries: [
        { key: "../bad.canvas", value: "bad" },
        { key: "./.hidden/file.txt", value: "bad" },
        { key: "./deep//bad.canvas", value: "bad" },
        { key: "./noextension", value: "bad" },
        { key: "theme", value: "dark" },
      ],
      files: [
        { key: "./subpath/document.canvas", routePath: "/path/to/random/subpath/document.canvas", valueType: "text" },
        { key: "/root.canvas", routePath: "/root.canvas", valueType: "text" },
      ],
    });

    expect(await readLocalStorageSnapshot(storageFilePath, {
      webspace: testWebSpace(),
      pagePath: "/path/to/random/file.html",
    })).toEqual({
      schema: 1,
      entries: [
        ["../bad.canvas", "bad"],
        ["./.hidden/file.txt", "bad"],
        ["./deep//bad.canvas", "bad"],
        ["./noextension", "bad"],
        ["./subpath/document.canvas", "{\n  \"nodes\": [],\n  \"edges\": []\n}\n"],
        ["/root.canvas", "root document\n"],
        ["theme", "dark"],
      ],
    });

    expect(await readLocalStorageSnapshot(storageFilePath, {
      webspace: testWebSpace(),
      pagePath: "/other.html",
    })).toEqual({
      schema: 1,
      entries: [
        ["../bad.canvas", "bad"],
        ["./.hidden/file.txt", "bad"],
        ["./deep//bad.canvas", "bad"],
        ["./noextension", "bad"],
        ["/root.canvas", "root document\n"],
        ["theme", "dark"],
      ],
    });
  });

  test("merges page-relative file indexes across sibling bundle paths", async () => {
    const storageFilePath = await resolveLocalStorageFilePath(root);
    const webspace = testWebSpace();
    await mkdir(join(root, "apps", "a.web"), { recursive: true });
    await mkdir(join(root, "apps", "b.web"), { recursive: true });

    await writeLocalStorageSnapshot(storageFilePath, {
      schema: 1,
      entries: [["./document.canvas", "A"], ["theme", "dark"]],
    }, {
      webspace,
      pagePath: "/apps/a.web/index.html",
    });
    await writeLocalStorageSnapshot(storageFilePath, {
      schema: 1,
      entries: [["./document.canvas", "B"], ["theme", "dark"]],
    }, {
      webspace,
      pagePath: "/apps/b.web/index.html",
    });

    expect(await readFile(join(root, "apps", "a.web", "document.canvas"), "utf8")).toBe("A");
    expect(await readFile(join(root, "apps", "b.web", "document.canvas"), "utf8")).toBe("B");
    expect(JSON.parse(await readFile(storageFilePath, "utf8")).files).toEqual([
      { key: "./document.canvas", routePath: "/apps/a.web/document.canvas", valueType: "text" },
      { key: "./document.canvas", routePath: "/apps/b.web/document.canvas", valueType: "text" },
    ]);
    expect(await readLocalStorageSnapshot(storageFilePath, {
      webspace,
      pagePath: "/apps/a.web/index.html",
    })).toEqual({
      schema: 1,
      entries: [["./document.canvas", "A"], ["theme", "dark"]],
    });
    expect(await readLocalStorageSnapshot(storageFilePath, {
      webspace,
      pagePath: "/apps/b.web/index.html",
    })).toEqual({
      schema: 1,
      entries: [["./document.canvas", "B"], ["theme", "dark"]],
    });
  });

  test("incremental writes do not remap untouched page-relative fallback keys", async () => {
    const storageFilePath = await resolveLocalStorageFilePath(root);
    const webspace = testWebSpace();
    await mkdir(join(root, "examples", "web-native-bundles", "d3-force-lab.web"), { recursive: true });
    await mkdir(join(root, "examples", "web-native-bundles", "excalidraw-scene-board.web"), { recursive: true });
    await mkdir(dirname(storageFilePath), { recursive: true });
    await writeFile(storageFilePath, `${JSON.stringify({
      schema: 4,
      entries: [
        { key: "./graph.json", value: "GRAPH" },
        { key: "theme", value: "dark" },
      ],
      files: [],
    }, null, 2)}\n`);

    await writeLocalStorageSnapshot(storageFilePath, {
      schema: 1,
      entries: [
        ["./graph.json", "GRAPH"],
        ["./scene.excalidraw", "SCENE"],
        ["theme", "dark"],
      ],
      touchedKeys: ["./scene.excalidraw"],
    }, {
      webspace,
      pagePath: "/examples/web-native-bundles/excalidraw-scene-board.web/index.html",
    });

    expect(existsSync(join(root, "examples", "web-native-bundles", "excalidraw-scene-board.web", "graph.json"))).toBe(false);
    expect(await readFile(join(root, "examples", "web-native-bundles", "excalidraw-scene-board.web", "scene.excalidraw"), "utf8")).toBe("SCENE");
    expect(JSON.parse(await readFile(storageFilePath, "utf8"))).toEqual({
      schema: 4,
      entries: [
        { key: "./graph.json", value: "GRAPH" },
        { key: "theme", value: "dark" },
      ],
      files: [
        {
          key: "./scene.excalidraw",
          routePath: "/examples/web-native-bundles/excalidraw-scene-board.web/scene.excalidraw",
          valueType: "text",
        },
      ],
    });
  });

  test("writes supported data URL files and falls back for unsupported data URLs", async () => {
    const storageFilePath = await resolveLocalStorageFilePath(root);
    const pngDataUrl = "data:image/png;base64,iVBORw==";
    const textDataUrl = "data:text/plain;charset=utf-8,hello%20there";
    const unsupportedDataUrl = "data:text/html,%3Cp%3Ebad%3C%2Fp%3E";

    await writeLocalStorageSnapshot(storageFilePath, {
      schema: 1,
      entries: [
        ["/assets/image.png", pngDataUrl],
        ["/notes/greeting.txt", textDataUrl],
        ["/notes/page.html", unsupportedDataUrl],
        ["/assets/broken.png", "data:image/png;base64,not base64"],
      ],
    }, {
      webspace: testWebSpace(),
      pagePath: "/index.html",
    });

    expect(new Uint8Array(await Bun.file(join(root, "assets", "image.png")).arrayBuffer())).toEqual(
      new Uint8Array([0x89, 0x50, 0x4e, 0x47]),
    );
    expect(await readFile(join(root, "notes", "greeting.txt"), "utf8")).toBe("hello there");

    const diskSnapshot = JSON.parse(await readFile(storageFilePath, "utf8"));
    expect(diskSnapshot).toEqual({
      schema: 4,
      entries: [
        { key: "/assets/broken.png", value: "data:image/png;base64,not base64" },
        { key: "/notes/page.html", value: unsupportedDataUrl },
      ],
      files: [
        {
          key: "/assets/image.png",
          routePath: "/assets/image.png",
          valueType: "data-url",
          mediaType: "image/png",
          encoding: "base64",
        },
        {
          key: "/notes/greeting.txt",
          routePath: "/notes/greeting.txt",
          valueType: "data-url",
          mediaType: "text/plain",
          encoding: "utf-8",
        },
      ],
    });

    expect(await readLocalStorageSnapshot(storageFilePath, {
      webspace: testWebSpace(),
      pagePath: "/index.html",
    })).toEqual({
      schema: 1,
      entries: [
        ["/assets/broken.png", "data:image/png;base64,not base64"],
        ["/assets/image.png", pngDataUrl],
        ["/notes/greeting.txt", textDataUrl],
        ["/notes/page.html", unsupportedDataUrl],
      ],
    });
  });

  test("persistence route validates and persists snapshots", async () => {
    const storageFilePath = await resolveLocalStorageFilePath(root);
    const routes = createLocalStoragePersistenceRoutes(storageFilePath, root);
    const route = routes["/_web/persistence/local-storage"] as {
      GET: (request?: Request) => Promise<Response>;
      POST: (request: Request) => Promise<Response>;
    };

    const postResponse = await route.POST(new Request("http://127.0.0.1/_web/persistence/local-storage?page=%2Findex.html", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ schema: 1, entries: [["name", "Web"]] }),
    }));
    expect(postResponse.status).toBe(204);
    expect(await (await route.GET(new Request("http://127.0.0.1/_web/persistence/local-storage?page=%2Findex.html"))).json()).toEqual({ schema: 1, entries: [["name", "Web"]] });

    const invalidResponse = await route.POST(new Request("http://127.0.0.1/_web/persistence/local-storage", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ schema: 1, entries: [["ok", 1]] }),
    }));
    expect(invalidResponse.status).toBe(400);
  });

  test("service worker persistence route can write package-local file keys", async () => {
    const storageFilePath = await resolveLocalStorageFilePath(root);
    const routes = createLocalStoragePersistenceRoutes(storageFilePath, root, "/", "page-token");
    const route = routes["/_web/persistence/service-worker-local-storage"] as {
      GET: (request?: Request) => Promise<Response>;
      POST: (request: Request) => Promise<Response>;
    };

    const postResponse = await route.POST(new Request("http://127.0.0.1/_web/persistence/service-worker-local-storage?page=%2Fservice-worker.js", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        schema: 1,
        entries: [["./weblog-store.json", "{\"posts\":[]}"]],
        touchedKeys: ["./weblog-store.json"],
      }),
    }));

    expect(postResponse.status).toBe(204);
    expect(await readFile(join(root, "weblog-store.json"), "utf8")).toBe("{\"posts\":[]}");
    expect(await (await route.GET(new Request("http://127.0.0.1/_web/persistence/service-worker-local-storage?page=%2Fservice-worker.js"))).json()).toEqual({
      schema: 1,
      entries: [["./weblog-store.json", "{\"posts\":[]}"]],
    });
  });
});

describe("rendering", () => {
  test("renders markdown headings, lists, code, links, and tables", () => {
    const html = renderMarkdownDocument(`# Title

Paragraph with [link](page.html) and \`code\`.

- One
- Two

| A | B |
| --- | --- |
| C | D |

\`\`\`ts
const x = 1;
\`\`\`
`, "README.md", true);

    expect(html).toContain("<h1>Title</h1>");
    expect(html).toContain('<a href="page.html">link</a>');
    expect(html).toContain("<ul>");
    expect(html).toContain("<table>");
    expect(html).toContain('class="language-ts"');
    expect(html).toContain("/_web/live-reload");
  });

  test("renders markdown files as html responses", async () => {
    const readme = join(root, "README.md");
    await writeFile(readme, "# Read Me\n");
    const response = await renderMarkdownResponse(readme, { liveReload: false, title: "README.md" });
    expect(response.headers.get("Content-Type")).toBe("text/html; charset=utf-8");
    expect(await response.text()).toContain("<h1>Read Me</h1>");
  });

  test("injects live reload into raw html fallback responses", async () => {
    const page = join(root, "late.html");
    await writeFile(page, "<!doctype html><body><h1>Late</h1></body>");
    const response = await readFileResponse(page, { liveReload: true });
    const html = await response.text();
    expect(html).toContain("/_web/live-reload");
    expect(html).toContain("/_web/live-reload-version");
  });

  test("injects localStorage persistence before page scripts", async () => {
    const page = join(root, "stateful.html");
    await writeFile(page, "<!doctype html><html><head><script>window.pageScriptRan = true;</script></head><body></body></html>");
    const response = await readFileResponse(page, { localStoragePersistence: true });
    const html = await response.text();

    expect(html).toContain("__WEB_APP_LOCAL_STORAGE__");
    expect(html.indexOf("__WEB_APP_LOCAL_STORAGE__")).toBeLessThan(html.indexOf("window.pageScriptRan"));
    const script = html.match(/<script>\n([\s\S]*?__WEB_APP_LOCAL_STORAGE__[\s\S]*?)\n<\/script>/)?.[1] ?? "";
    expect(script).not.toMatch(/<\/(?:script|style|head|body|html|main|pre|p|h1)>/i);
    expect(script).toContain("\\x3c/style>");
  });

  test("injects posted request data before page scripts", async () => {
    const page = join(root, "posted.html");
    await writeFile(page, "<!doctype html><html><head><script>window.pageScriptRan = true;</script></head><body></body></html>");
    const postedRequest = await createPostedRequestPayload(new Request("http://127.0.0.1/cgi-bin/contact.cgi", {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        "Origin": "http://127.0.0.1",
      },
      body: "name=Tom&topic=Web.app",
    }));
    const response = await readFileResponse(page, { postedRequest });
    const html = await response.text();

    expect(html).toContain('id="appify-host-request"');
    expect(html).toContain('"action":"/cgi-bin/contact.cgi"');
    expect(html).toContain('"fields":[["name","Tom"],["topic","Web.app"]]');
    expect(html).toContain("AppifyHost");
    expect(html).toContain("__WEB_APP_REQUEST_ERROR__");
    expect(html).toContain("Posted request data could not start");
    const script = html.match(/<script>\n([\s\S]*?__WEB_APP_REQUEST_ERROR__[\s\S]*?)\n<\/script>/)?.[1] ?? "";
    expect(script).not.toMatch(/<\/(?:script|style|head|body|html|main|pre|p|h1)>/i);
    expect(script).toContain("\\x3c/style>");
    expect(html.indexOf("appify-host-request")).toBeLessThan(html.indexOf("window.pageScriptRan"));
  });

  test("parses posted form, json, and cross-site guards", async () => {
    const formPayload = await createPostedRequestPayload(new Request("http://127.0.0.1/submit.cgi?ok=1", {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        "Origin": "http://127.0.0.1",
      },
      body: "name=Tom&name=Web",
    }));
    expect(formPayload).toMatchObject({
      schema: 1,
      method: "POST",
      action: "/submit.cgi?ok=1",
      path: "/submit.cgi",
      query: "ok=1",
      fields: [["name", "Tom"], ["name", "Web"]],
      files: [],
    });

    const jsonPayload = await createPostedRequestPayload(new Request("http://127.0.0.1/api/items", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ok: true }),
    }));
    expect(jsonPayload.text).toBe('{"ok":true}');
    expect(jsonPayload.json).toEqual({ ok: true });

    await expect(createPostedRequestPayload(new Request("http://127.0.0.1/submit.cgi", {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        "Origin": "https://example.com",
      },
      body: "name=bad",
    }))).rejects.toThrow("same-origin");
  });

  test("injected localStorage facade avoids native Storage IO", async () => {
    const page = join(root, "stateful.html");
    await writeFile(page, "<!doctype html><html><head></head><body></body></html>");
    const response = await readFileResponse(page, { localStoragePersistence: true });
    const html = await response.text();
    const script = html.match(/<script>\n([\s\S]*?__WEB_APP_LOCAL_STORAGE__[\s\S]*?)\n<\/script>/)?.[1];
    expect(script).toBeDefined();

    const nativeCalls: string[] = [];
    class FakeStorage {
      get length() {
        nativeCalls.push("length");
        throw new Error("native length should not be read");
      }

      getItem(key: string) {
        nativeCalls.push(`getItem:${key}`);
        throw new Error("native getItem should not be called");
      }

      key(index: number) {
        nativeCalls.push(`key:${index}`);
        throw new Error("native key should not be called");
      }

      setItem(key: string, value: string) {
        nativeCalls.push(`setItem:${key}:${value}`);
        throw new Error("native setItem should not be called");
      }

      removeItem(key: string) {
        nativeCalls.push(`removeItem:${key}`);
        throw new Error("native removeItem should not be called");
      }

      clear() {
        nativeCalls.push("clear");
        throw new Error("native clear should not be called");
      }
    }

    const nativeStorage = new FakeStorage();
    const fakeWindow: Record<string, unknown> = {
      localStorage: nativeStorage,
      location: { pathname: "/stateful.html" },
      clearTimeout() {},
      setTimeout(callback: () => void) {
        callback();
        return 1;
      },
      addEventListener() {},
    };
    const requests: string[] = [];
    const fakeXHR = class {
      status = 200;
      responseText = JSON.stringify({ schema: 1, entries: [["existing", "yes"]] });
      open(_method: string, url: string) {
        requests.push(url);
      }
      setRequestHeader() {}
      send() {}
    };

    new Function("window", "Storage", "XMLHttpRequest", "Blob", "navigator", "fetch", "console", script!)(
      fakeWindow,
      FakeStorage,
      fakeXHR,
      Blob,
      { sendBeacon: undefined },
      (_url: string, init: RequestInit) => {
        requests.push(_url);
        requests.push(String(init.body));
        return Promise.resolve(new Response(null, { status: 204 }));
      },
      console,
    );

    const storage = fakeWindow.localStorage as Storage;
    expect(storage.getItem("existing")).toBe("yes");
    expect(storage.length).toBe(1);
    expect(storage.key(0)).toBe("existing");
    expect(storage.key(99)).toBeNull();

    storage.setItem("next", "ok");
    expect(storage.getItem("next")).toBe("ok");
    expect(storage.length).toBe(2);
    expect(FakeStorage.prototype.getItem.call(storage, "next")).toBe("ok");
    FakeStorage.prototype.setItem.call(storage, "proto", "call");
    expect(storage.getItem("proto")).toBe("call");

    (storage as Storage & { answer?: unknown }).answer = 42;
    expect(storage.getItem("answer")).toBe("42");
    expect((storage as Storage & { answer?: unknown }).answer).toBe("42");
    expect(Object.keys(storage)).toEqual(["existing", "next", "proto", "answer"]);
    expect(delete (storage as Storage & { answer?: unknown }).answer).toBe(true);
    expect(storage.getItem("answer")).toBeNull();

    storage.removeItem("existing");
    expect(storage.getItem("existing")).toBeNull();
    storage.clear();
    expect(storage.length).toBe(0);
    expect(requests).toContain("/_web/persistence/local-storage?page=%2Fstateful.html");
    expect(requests.some((request) => request.includes('"touchedKeys"'))).toBe(true);
    expect(requests.at(-1)).toContain('"entries":[]');
    expect(requests.at(-1)).toContain('"clear":true');
    expect(nativeCalls).toEqual([]);
    expect(fakeWindow.localStorage).not.toBe(nativeStorage);
  });

  test("injected localStorage facade leaves native site storage APIs alone", async () => {
    const page = join(root, "stateful.html");
    await writeFile(page, "<!doctype html><html><head></head><body></body></html>");
    const response = await readFileResponse(page, { localStoragePersistence: true });
    const html = await response.text();
    const script = html.match(/<script>\n([\s\S]*?__WEB_APP_LOCAL_STORAGE__[\s\S]*?)\n<\/script>/)?.[1];
    expect(script).toBeDefined();

    class FakeStorage {
      #items = new Map<string, string>();

      get length() {
        return this.#items.size;
      }

      getItem(key: string) {
        return this.#items.get(String(key)) ?? null;
      }

      key(index: number) {
        return Array.from(this.#items.keys())[index] ?? null;
      }

      setItem(key: string, value: string) {
        this.#items.set(String(key), String(value));
      }

      removeItem(key: string) {
        this.#items.delete(String(key));
      }

      clear() {
        this.#items.clear();
      }
    }

    class FakeIDBFactory {
      open(name: string) {
        return { name };
      }
    }
    class FakeCacheStorage {
      open(name: string) {
        return Promise.resolve({ name });
      }
    }
    class FakeServiceWorkerContainer {
      register(scriptURL: string) {
        return Promise.resolve({ scriptURL });
      }
    }
    class FakeStorageManager {
      getDirectory() {
        return Promise.resolve({});
      }
    }
    const serviceWorkerContainer = new FakeServiceWorkerContainer();
    const storageManager = new FakeStorageManager();
    class FakeNavigator {
      get serviceWorker() {
        return serviceWorkerContainer;
      }

      get storage() {
        return storageManager;
      }
    }

    class FakeDocument {
      #cookie = "";

      get cookie() {
        return this.#cookie;
      }

      set cookie(value: string) {
        this.#cookie = String(value);
      }
    }

    const fakeNavigator = new FakeNavigator();
    const fakeWindow: Record<string, unknown> = {
      localStorage: new FakeStorage(),
      sessionStorage: new FakeStorage(),
      indexedDB: new FakeIDBFactory(),
      caches: new FakeCacheStorage(),
      Navigator: FakeNavigator,
      document: new FakeDocument(),
      location: { pathname: "/stateful.html" },
      clearTimeout() {},
      setTimeout(callback: () => void) {
        callback();
        return 1;
      },
      addEventListener() {},
    };
    const requests: string[] = [];
    const warnings: string[] = [];
    const fakeXHR = class {
      status = 200;
      responseText = JSON.stringify({ schema: 1, entries: [] });
      open() {}
      setRequestHeader() {}
      send() {}
    };

    new Function(
      "window",
      "Storage",
      "XMLHttpRequest",
      "Blob",
      "navigator",
      "fetch",
      "console",
      "IDBFactory",
      "CacheStorage",
      "Document",
      "HTMLDocument",
      "ServiceWorkerContainer",
      "StorageManager",
      script!,
    )(
      fakeWindow,
      FakeStorage,
      fakeXHR,
      Blob,
      fakeNavigator,
      (_url: string, init: RequestInit) => {
        requests.push(String(init.body));
        return Promise.resolve(new Response(null, { status: 204 }));
      },
      { warn: (message: string) => warnings.push(message) },
      FakeIDBFactory,
      FakeCacheStorage,
      FakeDocument,
      FakeDocument,
      FakeServiceWorkerContainer,
      FakeStorageManager,
    );

    (fakeWindow.sessionStorage as Storage).setItem("session", "value");
    expect((fakeWindow.sessionStorage as Storage).getItem("session")).toBe("value");
    expect((fakeWindow.indexedDB as FakeIDBFactory).open("db")).toEqual({ name: "db" });
    await expect((fakeWindow.caches as FakeCacheStorage).open("cache")).resolves.toEqual({ name: "cache" });
    (fakeWindow.document as FakeDocument).cookie = "a=b";
    expect((fakeWindow.document as FakeDocument).cookie).toBe("a=b");
    await expect(fakeNavigator.serviceWorker.register("/sw.js")).resolves.toEqual({ scriptURL: "/sw.js" });
    await expect(fakeNavigator.storage.getDirectory()).resolves.toEqual({});

    const storage = fakeWindow.localStorage as Storage;
    storage.setItem("local", "value");
    expect(storage.getItem("local")).toBe("value");
    expect(warnings).toEqual([]);
    expect(requests.some((body) => body.includes("unsupported-storage-warning"))).toBe(false);
  });

  test("injected localStorage facade fails closed when it cannot replace native storage", async () => {
    const page = join(root, "stateful.html");
    await writeFile(page, "<!doctype html><html><head></head><body></body></html>");
    const response = await readFileResponse(page, { localStoragePersistence: true });
    const html = await response.text();
    const script = html.match(/<script>\n([\s\S]*?__WEB_APP_LOCAL_STORAGE__[\s\S]*?)\n<\/script>/)?.[1];
    expect(script).toBeDefined();

    const nativeCalls: string[] = [];
    class FakeStorage {
      getItem(key: string) {
        nativeCalls.push(`getItem:${key}`);
        throw new Error("native getItem should not be called");
      }

      setItem(key: string, value: string) {
        nativeCalls.push(`setItem:${key}:${value}`);
        throw new Error("native setItem should not be called");
      }
    }

    let stopped = false;
    let written = "";
    const nativeStorage = new FakeStorage();
    const fakeWindow: Record<string, unknown> = {
      location: { pathname: "/stateful.html" },
      clearTimeout() {},
      setTimeout(callback: () => void) {
        callback();
        return 1;
      },
      addEventListener() {},
      stop() {
        stopped = true;
      },
      document: {
        open() {},
        write(value: string) {
          written += value;
        },
        close() {},
      },
    };
    Object.defineProperty(fakeWindow, "localStorage", {
      configurable: false,
      value: nativeStorage,
    });

    const fakeXHR = class {
      status = 200;
      responseText = JSON.stringify({ schema: 1, entries: [["existing", "yes"]] });
      open() {}
      setRequestHeader() {}
      send() {}
    };

    expect(() => new Function("window", "Storage", "XMLHttpRequest", "Blob", "navigator", "fetch", "console", script!)(
      fakeWindow,
      FakeStorage,
      fakeXHR,
      Blob,
      { sendBeacon: undefined },
      () => Promise.resolve(new Response(null, { status: 204 })),
      console,
    )).toThrow();

    expect(stopped).toBe(true);
    expect(written).toContain("Web storage could not start");
    expect(written).toContain("single-source localStorage facade");
    expect(fakeWindow.localStorage).toBe(nativeStorage);
    expect(nativeCalls).toEqual([]);
  });

  test("serves worker scripts as ordinary JavaScript without page injections", async () => {
    const worker = join(root, "service-worker.js");
    await writeFile(worker, "self.addEventListener('fetch', () => {});\n");

    const response = await readFileResponse(worker, { localStoragePersistence: true, liveReload: true });
    const text = await response.text();

    expect(response.headers.get("Content-Type")).toBe("text/javascript; charset=utf-8");
    expect(text).toBe("self.addEventListener('fetch', () => {});\n");
    expect(text).not.toContain("__WEB_APP_LOCAL_STORAGE__");
    expect(text).not.toContain("__WEB_APP_LIVE_RELOAD__");
  });

  test("exposes live reload versions for polling clients", async () => {
    const reloader = createReloadBroadcaster();
    expect(await reloader.versionResponse().json()).toEqual({ version: 0 });
    reloader.broadcast();
    expect(await reloader.versionResponse().json()).toEqual({ version: 1 });
  });

  test("generates directory listings", async () => {
    await writeFile(join(root, "README.md"), "# Read Me\n");
    await mkdir(join(root, ".local"), { recursive: true });
    const response = await createDirectoryListingResponse(root, root, "/", { liveReload: true });
    const html = await response.text();
    expect(html).toContain("README.md");
    expect(html).not.toContain(".local");
    expect(html).toContain("/_web/live-reload");
  });
});

describe("native web compatibility fixtures", () => {
  test("web-compat examples do not depend on Appify request globals", async () => {
    const files = await textFixtureFiles(join(repoRoot, "examples", "web-compat"));
    for (const file of files) {
      const text = await readFile(file, "utf8");
      expect(text).not.toMatch(/AppifyHost|__WEB_APP_REQUEST__/);
    }
  });

  test("Rails weblog fixture uses service-worker REST routes and Navigation API detection", async () => {
    const fixtureRoot = join(repoRoot, "examples", "web-compat", "2005-rails-weblog.web");
    const worker = await readFile(join(fixtureRoot, "service-worker.js"), "utf8");
    const app = await readFile(join(fixtureRoot, "app.js"), "utf8");
    const shadow = await readFile(join(fixtureRoot, "posts", "create.cgi.html"), "utf8");
    const postForm = await readFile(join(fixtureRoot, "posts", "new.html"), "utf8");
    const commentForm = await readFile(join(fixtureRoot, "posts", "1", "index.html"), "utf8");
    const store = JSON.parse(await readFile(join(fixtureRoot, "weblog-store.json"), "utf8"));

    expect(worker).toContain("handleRESTRequest");
    expect(worker).toContain("WEB_APP_STORAGE_ROUTE");
    expect(worker).toContain("request.clone().formData()");
    expect(worker).toContain("Response.redirect(url, 303)");
    expect(app).toContain("event.formData");
    expect(app).toContain("shadowPathForCompatPost");
    expect(app).toContain("URLSearchParams(location.search)");
    expect(shadow).toContain("data-request-panel=\"post\"");
    expect(postForm).toContain('action="../posts"');
    expect(commentForm).toContain('action="./comments"');
    expect(store.schema).toBe("appify.rails-weblog.v1");
  });

  test("Rails weblog service worker CRUDs REST post and comment resources", async () => {
    const fixtureRoot = join(repoRoot, "examples", "web-compat", "2005-rails-weblog.web");
    const worker = await readFile(join(fixtureRoot, "service-worker.js"), "utf8");
    const seedStore = await readFile(join(fixtureRoot, "weblog-store.json"), "utf8");
    const scope = "http://weblog.localhost/examples/web-compat/2005-rails-weblog.web/";
    const storeKey = "/examples/web-compat/2005-rails-weblog.web/weblog-store.json";
    const persisted = new Map<string, string>([[storeKey, seedStore]]);
    const fakeFetch = async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(String(input));
      if (url.pathname === "/_web/persistence/service-worker-local-storage") {
        if ((init?.method || "GET").toUpperCase() === "POST") {
          const body = JSON.parse(String(init?.body || "{}"));
          for (const [key, value] of body.entries || []) {
            persisted.set(key, value);
          }
          return new Response(null, { status: 204 });
        }
        return Response.json({ schema: 1, entries: [...persisted.entries()] });
      }
      if (url.pathname === storeKey) {
        return new Response(seedStore, { headers: { "Content-Type": "application/json" } });
      }
      return new Response("not found", { status: 404 });
    };
    const workerAPI = new Function(
      "self",
      "URL",
      "URLSearchParams",
      "Response",
      "fetch",
      `${worker}\nreturn { routeForRequest, handleRESTRequest, storeFileKey };`,
    )({
      location: new URL(scope),
      registration: { scope },
    }, URL, URLSearchParams, Response, fakeFetch) as {
      routeForRequest(request: Request): { kind: string } | null;
      handleRESTRequest(request: Request, route: { kind: string }): Promise<Response>;
      storeFileKey(): string;
    };

    expect(workerAPI.storeFileKey()).toBe(storeKey);
    const postRequest = new Request(`${scope}posts`, {
      method: "POST",
      headers: {
        "Accept": "text/html",
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: "post%5Btitle%5D=REST+post&post%5Bauthor%5D=reader",
    });
    const postResponse = await workerAPI.handleRESTRequest(postRequest, workerAPI.routeForRequest(postRequest)!);
    const postLocation = new URL(postResponse.headers.get("Location") ?? "");
    expect(postResponse.status).toBe(303);
    expect(postLocation.pathname).toBe("/examples/web-compat/2005-rails-weblog.web/posts/create.cgi.html");
    expect(postLocation.searchParams.get("_web_app_action")).toBe("/posts");
    expect(postLocation.searchParams.get("_web_app_persisted")).toBe("1");
    expect(postLocation.searchParams.get("post[title]")).toBe("REST post");
    expect(JSON.parse(persisted.get(storeKey) ?? "{}").posts).toContainEqual(expect.objectContaining({
      id: 3,
      title: "REST post",
      author: "reader",
    }));

    const commentRequest = new Request(`${scope}posts/1/comments`, {
      method: "POST",
      headers: {
        "Accept": "text/html",
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: "comment%5Bpost_id%5D=1&comment%5Bauthor%5D=reader&comment%5Bbody%5D=Works",
    });
    const commentResponse = await workerAPI.handleRESTRequest(commentRequest, workerAPI.routeForRequest(commentRequest)!);
    const commentLocation = new URL(commentResponse.headers.get("Location") ?? "");
    expect(commentResponse.status).toBe(303);
    expect(commentLocation.pathname).toBe("/examples/web-compat/2005-rails-weblog.web/posts/1/comments/create.cgi.html");
    expect(commentLocation.searchParams.get("_web_app_action")).toBe("/posts/1/comments");
    expect(commentLocation.searchParams.get("comment[body]")).toBe("Works");
    expect(JSON.parse(persisted.get(storeKey) ?? "{}").comments).toContainEqual(expect.objectContaining({
      id: 3,
      postId: 1,
      author: "reader",
      body: "Works",
    }));

    const updateRequest = new Request(`${scope}posts/3`, {
      method: "PUT",
      headers: {
        "Accept": "application/json",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ "post[title]": "Updated REST post" }),
    });
    const updateResponse = await workerAPI.handleRESTRequest(updateRequest, workerAPI.routeForRequest(updateRequest)!);
    expect((await updateResponse.json()).post.title).toBe("Updated REST post");

    const deleteRequest = new Request(`${scope}posts/3`, {
      method: "DELETE",
      headers: { "Accept": "application/json" },
    });
    const deleteResponse = await workerAPI.handleRESTRequest(deleteRequest, workerAPI.routeForRequest(deleteRequest)!);
    expect(await deleteResponse.json()).toEqual({ ok: true });
    expect(JSON.parse(persisted.get(storeKey) ?? "{}").posts.some((post: { id: number }) => post.id === 3)).toBe(false);
  });
});

async function textFixtureFiles(directory: string): Promise<string[]> {
  const result: string[] = [];
  const entries = await readdir(directory, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.name === ".DS_Store") continue;
    const entryPath = join(directory, entry.name);
    if (entry.isDirectory()) {
      result.push(...await textFixtureFiles(entryPath));
      continue;
    }
    if (entry.isFile() && /\.(?:html|js|md|css|json)$/i.test(entry.name)) {
      result.push(entryPath);
    }
  }
  return result.sort();
}

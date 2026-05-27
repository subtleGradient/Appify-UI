import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { mkdir, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import {
  buildHtmlRoutes,
  contentTypeFor,
  createDirectoryListingResponse,
  createLocalStoragePersistenceRoutes,
  createReloadBroadcaster,
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
  scanHtmlPages,
  writeLocalStorageSnapshot,
} from "../src/webPackage";

let root: string;

beforeEach(async () => {
  root = join(import.meta.dir, `.web-test-${crypto.randomUUID()}.web`);
  await mkdir(root, { recursive: true });
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

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
    await writeFile(join(root, ".local", "storage.json"), "{}");
    expect(await resolveServeRoot(root)).toBe(dirname(root));
  });

  test("resolves non-empty .web packages to their own contents", async () => {
    await writeFile(join(root, "index.html"), "<h1>Home</h1>");
    expect(await resolveServeRoot(root)).toBe(root);
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
    expect(isIgnoredReloadPath(root, ".local/storage.json")).toBe(true);
    expect(isIgnoredReloadPath(root, ".local/example.web.storage.json")).toBe(true);
    expect(isIgnoredReloadPath(root, Buffer.from(".local/storage.json"))).toBe(true);
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
    expect(await resolveLocalStorageFilePath(root)).toBe(join(root, ".local", "storage.json"));
  });

  test("uses adjacent sidecar storage for file documents", async () => {
    await rm(root, { recursive: true, force: true });
    await writeFile(root, "");

    expect(await resolveLocalStorageFilePath(root)).toBe(
      join(dirname(root), ".local", `${basename(root)}.storage.json`),
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
      schema: 3,
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
      schema: 3,
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
      rootPath: root,
      pagePath: "/path/to/random/file.html",
    });

    expect(await readFile(join(root, "path", "to", "random", "subpath", "document.canvas"), "utf8")).toBe(
      "{\n  \"nodes\": [],\n  \"edges\": []\n}\n",
    );
    expect(await readFile(join(root, "root.canvas"), "utf8")).toBe("root document\n");

    const diskSnapshot = JSON.parse(await readFile(storageFilePath, "utf8"));
    expect(diskSnapshot).toEqual({
      schema: 3,
      entries: [
        { key: "../bad.canvas", value: "bad" },
        { key: "./.hidden/file.txt", value: "bad" },
        { key: "./deep//bad.canvas", value: "bad" },
        { key: "./noextension", value: "bad" },
        { key: "theme", value: "dark" },
      ],
      files: [
        { key: "./subpath/document.canvas", path: "path/to/random/subpath/document.canvas", valueType: "text" },
        { key: "/root.canvas", path: "root.canvas", valueType: "text" },
      ],
    });

    expect(await readLocalStorageSnapshot(storageFilePath, {
      rootPath: root,
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
      rootPath: root,
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
      rootPath: root,
      pagePath: "/index.html",
    });

    expect(new Uint8Array(await Bun.file(join(root, "assets", "image.png")).arrayBuffer())).toEqual(
      new Uint8Array([0x89, 0x50, 0x4e, 0x47]),
    );
    expect(await readFile(join(root, "notes", "greeting.txt"), "utf8")).toBe("hello there");

    const diskSnapshot = JSON.parse(await readFile(storageFilePath, "utf8"));
    expect(diskSnapshot).toEqual({
      schema: 3,
      entries: [
        { key: "/assets/broken.png", value: "data:image/png;base64,not base64" },
        { key: "/notes/page.html", value: unsupportedDataUrl },
      ],
      files: [
        {
          key: "/assets/image.png",
          path: "assets/image.png",
          valueType: "data-url",
          mediaType: "image/png",
          encoding: "base64",
        },
        {
          key: "/notes/greeting.txt",
          path: "notes/greeting.txt",
          valueType: "data-url",
          mediaType: "text/plain",
          encoding: "utf-8",
        },
      ],
    });

    expect(await readLocalStorageSnapshot(storageFilePath, {
      rootPath: root,
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
  });

  test("injected localStorage proxy keeps native Storage methods bound", async () => {
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

    const fakeWindow: Record<string, unknown> = {
      localStorage: new FakeStorage(),
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
    storage.setItem("next", "ok");
    expect(storage.getItem("next")).toBe("ok");
    expect(requests).toContain("/_web/persistence/local-storage?page=%2Fstateful.html");
    expect(requests.at(-1)).toContain('"next"');
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

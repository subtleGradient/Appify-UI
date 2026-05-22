import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdir, rm, symlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
  buildHtmlRoutes,
  contentTypeFor,
  createDirectoryListingResponse,
  createReloadBroadcaster,
  findRootEntry,
  readFileResponse,
  renderMarkdownDocument,
  renderMarkdownResponse,
  resolveRequestPath,
  scanHtmlPages,
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
  test("rejects path traversal and symlinks", async () => {
    await writeFile(join(root, "index.html"), "<h1>ok</h1>");
    expect(await resolveRequestPath(root, "/index.html")).toEqual({ kind: "file", path: join(root, "index.html") });
    expect(await resolveRequestPath(root, "/../secret.txt")).toBeNull();

    await writeFile(join(root, "target.txt"), "target");
    await symlink(join(root, "target.txt"), join(root, "linked.txt"));
    expect(await resolveRequestPath(root, "/linked.txt")).toBeNull();
  });

  test("maps common static content types", () => {
    expect(contentTypeFor("index.html")).toBe("text/html; charset=utf-8");
    expect(contentTypeFor("style.css")).toBe("text/css; charset=utf-8");
    expect(contentTypeFor("data.csv")).toBe("text/csv; charset=utf-8");
    expect(contentTypeFor("manual.pdf")).toBe("application/pdf");
    expect(contentTypeFor("unknown.bin")).toBe("application/octet-stream");
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
      port: 0,
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

  test("exposes live reload versions for polling clients", async () => {
    const reloader = createReloadBroadcaster();
    expect(await reloader.versionResponse().json()).toEqual({ version: 0 });
    reloader.broadcast();
    expect(await reloader.versionResponse().json()).toEqual({ version: 1 });
  });

  test("generates directory listings", async () => {
    await writeFile(join(root, "README.md"), "# Read Me\n");
    const response = await createDirectoryListingResponse(root, root, "/", { liveReload: true });
    const html = await response.text();
    expect(html).toContain("README.md");
    expect(html).toContain("/_web/live-reload");
  });
});

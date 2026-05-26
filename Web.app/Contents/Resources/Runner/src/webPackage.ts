import { existsSync } from "node:fs";
import { lstat, mkdir, readFile, readdir, rename, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import { basename, dirname, extname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { pathToFileURL } from "node:url";

export type ResolvedRequestPath =
  | { kind: "directory"; path: string }
  | { kind: "file"; path: string };

export type RenderOptions = {
  liveReload?: boolean;
  localStoragePersistence?: boolean;
  title?: string;
};

export type LocalStorageSnapshot = {
  schema: 1;
  entries: [string, string][];
};

const TEXT_TYPES = new Map<string, string>([
  [".css", "text/css; charset=utf-8"],
  [".csv", "text/csv; charset=utf-8"],
  [".htm", "text/html; charset=utf-8"],
  [".html", "text/html; charset=utf-8"],
  [".js", "text/javascript; charset=utf-8"],
  [".json", "application/json; charset=utf-8"],
  [".json5", "application/json; charset=utf-8"],
  [".map", "application/json; charset=utf-8"],
  [".md", "text/markdown; charset=utf-8"],
  [".mjs", "text/javascript; charset=utf-8"],
  [".svg", "image/svg+xml; charset=utf-8"],
  [".tsv", "text/tab-separated-values; charset=utf-8"],
  [".txt", "text/plain; charset=utf-8"],
  [".webmanifest", "application/manifest+json; charset=utf-8"],
  [".xml", "application/xml; charset=utf-8"],
]);

const BINARY_TYPES = new Map<string, string>([
  [".avif", "image/avif"],
  [".gif", "image/gif"],
  [".ico", "image/x-icon"],
  [".jpg", "image/jpeg"],
  [".jpeg", "image/jpeg"],
  [".mp3", "audio/mpeg"],
  [".mp4", "video/mp4"],
  [".otf", "font/otf"],
  [".pdf", "application/pdf"],
  [".png", "image/png"],
  [".ttf", "font/ttf"],
  [".wasm", "application/wasm"],
  [".webp", "image/webp"],
  [".woff", "font/woff"],
  [".woff2", "font/woff2"],
]);

const LOCAL_DIRECTORY = ".local";
const LOCAL_STORAGE_ROUTE = "/_web/persistence/local-storage";
const SKIPPED_DIRECTORIES = new Set([".git", LOCAL_DIRECTORY, "_web", "node_modules"]);

export function resolveDocumentPath(documentPath: string | undefined): string {
  if (!documentPath) {
    throw new Error("Expected a .web document path as the last argument.");
  }

  const resolved = resolve(documentPath);
  if (extname(resolved).toLowerCase() !== ".web") {
    throw new Error(`Expected a .web document package, got ${resolved}.`);
  }
  if (!existsSync(resolved)) {
    throw new Error(`${resolved} does not exist.`);
  }
  return resolved;
}

export async function resolveServerPort(configuredPort = process.env.PORT): Promise<number> {
  const value = configuredPort?.trim();
  if (value && value !== "0") {
    const port = Number(value);
    if (!Number.isInteger(port) || port < 1 || port > 65535) {
      throw new Error(`PORT must be an integer from 1 to 65535, got ${configuredPort}.`);
    }
    return port;
  }

  return await findAvailableLoopbackPort();
}

async function findAvailableLoopbackPort(): Promise<number> {
  return await new Promise((resolvePromise, reject) => {
    const probe = createServer();
    probe.once("error", reject);
    probe.listen(0, "127.0.0.1", () => {
      const address = probe.address();
      if (address === null || typeof address === "string") {
        probe.close(() => reject(new Error("Could not resolve an available loopback port.")));
        return;
      }

      probe.close((error) => {
        if (error) {
          reject(error);
          return;
        }
        resolvePromise(address.port);
      });
    });
  });
}

export async function resolveServeRoot(documentPath: string): Promise<string> {
  const stat = await lstat(documentPath);
  if (stat.isFile()) {
    return dirname(documentPath);
  }
  if (stat.isDirectory()) {
    if (await isEmptyDirectory(documentPath)) {
      return dirname(documentPath);
    }
    return documentPath;
  }

  throw new Error(`${documentPath} must be a .web file or directory.`);
}

export async function resolveLocalStorageFilePath(documentPath: string): Promise<string> {
  const stat = await lstat(documentPath);
  if (stat.isDirectory()) {
    return join(documentPath, LOCAL_DIRECTORY, "Web", "localStorage.json");
  }
  if (stat.isFile()) {
    return join(dirname(documentPath), LOCAL_DIRECTORY, basename(documentPath), "Web", "localStorage.json");
  }

  throw new Error(`${documentPath} must be a .web file or directory.`);
}

export function contentTypeFor(filePath: string): string {
  const extension = extname(filePath).toLowerCase();
  return TEXT_TYPES.get(extension) ?? BINARY_TYPES.get(extension) ?? "application/octet-stream";
}

export function isHtmlFile(filePath: string): boolean {
  const extension = extname(filePath).toLowerCase();
  return extension === ".html" || extension === ".htm";
}

export function isMarkdownFile(filePath: string): boolean {
  const extension = extname(filePath).toLowerCase();
  return extension === ".md" || extension === ".markdown";
}

export async function resolveRequestPath(rootPath: string, requestPath: string): Promise<ResolvedRequestPath | null> {
  let decodedPath: string;
  try {
    decodedPath = decodeURIComponent(requestPath);
  } catch {
    return null;
  }

  if (!decodedPath.startsWith("/") || decodedPath.includes("\0") || decodedPath.includes("\\")) {
    return null;
  }
  if (decodedPath.split("/").some((part) => SKIPPED_DIRECTORIES.has(part))) {
    return null;
  }

  const candidate = resolve(rootPath, `.${decodedPath}`);
  if (!isInsideRoot(rootPath, candidate)) {
    return null;
  }

  if (!(await pathExists(candidate)) || !(await assertNoSymlinkAlongPath(rootPath, candidate))) {
    return null;
  }

  const stat = await lstat(candidate);
  if (stat.isDirectory()) {
    return { kind: "directory", path: candidate };
  }
  if (stat.isFile()) {
    return { kind: "file", path: candidate };
  }
  return null;
}

export async function scanHtmlPages(rootPath: string): Promise<string[]> {
  const pages: string[] = [];

  async function walk(directory: string): Promise<void> {
    const entries = await readdir(directory, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.name === ".DS_Store") {
        continue;
      }

      const entryPath = join(directory, entry.name);
      if (entry.isSymbolicLink()) {
        continue;
      }
      if (entry.isDirectory()) {
        if (!SKIPPED_DIRECTORIES.has(entry.name)) {
          await walk(entryPath);
        }
        continue;
      }
      if (entry.isFile() && isHtmlFile(entry.name)) {
        pages.push(entryPath);
      }
    }
  }

  await walk(rootPath);
  return pages.sort((a, b) => routePathFor(rootPath, a).localeCompare(routePathFor(rootPath, b)));
}

export async function findRootEntry(rootPath: string, htmlPages: string[] = []): Promise<string | null> {
  const rootPages = htmlPages.length > 0 ? htmlPages : await scanHtmlPages(rootPath);
  return (
    exactRootPage(rootPath, rootPages, "index.html")
    ?? exactRootPage(rootPath, rootPages, "index.htm")
    ?? firstPatternRootPage(rootPath, rootPages)
    ?? null
  );
}

export async function buildHtmlRoutes(
  rootPath: string,
  htmlPages: string[],
  rootEntry: string | null,
  hmrEnabled: boolean,
  options: Pick<RenderOptions, "localStoragePersistence"> = {},
): Promise<Record<string, unknown>> {
  const routes: Record<string, unknown> = {};
  const aliasTargets = preferredDirectoryAliasTargets(rootPath, htmlPages);

  for (const pagePath of htmlPages) {
    try {
      const htmlImport = (await import(pathToFileURL(pagePath).href)).default;
      const routeValue = htmlRouteValue(pagePath, htmlImport, {
        liveReload: hmrEnabled,
        localStoragePersistence: options.localStoragePersistence,
      });
      routes[routePathFor(rootPath, pagePath)] = routeValue;

      const alias = directoryAliasForIndex(rootPath, pagePath);
      if (alias !== null && aliasTargets.get(alias) === pagePath) {
        routes[alias] = routeValue;
      }
      if (rootEntry === pagePath) {
        routes["/"] = routeValue;
      }
    } catch (error) {
      console.error(`Could not register ${pagePath} as a Bun HTML route:`, error);
    }
  }

  return routes;
}

export async function readFileResponse(filePath: string, options: RenderOptions = {}): Promise<Response> {
  let body: BodyInit = Bun.file(filePath);
  let contentType = contentTypeFor(filePath);

  if ((options.liveReload || options.localStoragePersistence) && isHtmlFile(filePath)) {
    body = injectClientScripts(await Bun.file(filePath).text(), options);
    contentType = "text/html; charset=utf-8";
  }

  return new Response(body, {
    headers: {
      "Cache-Control": "no-store",
      "Content-Type": contentType,
    },
  });
}

export async function renderMarkdownResponse(filePath: string, options: RenderOptions = {}): Promise<Response> {
  const source = await Bun.file(filePath).text();
  return new Response(
    renderMarkdownDocument(
      source,
      options.title ?? basename(filePath),
      options.liveReload === true,
      options.localStoragePersistence === true,
    ),
    {
    headers: {
      "Cache-Control": "no-store",
      "Content-Type": "text/html; charset=utf-8",
    },
    },
  );
}

export async function createDirectoryListingResponse(
  rootPath: string,
  directoryPath: string,
  requestPath: string,
  options: RenderOptions = {},
): Promise<Response> {
  const entries = (await readdir(directoryPath, { withFileTypes: true }))
    .filter((entry) => entry.name !== ".DS_Store" && !SKIPPED_DIRECTORIES.has(entry.name) && !entry.isSymbolicLink())
    .sort((a, b) => {
      if (a.isDirectory() !== b.isDirectory()) {
        return a.isDirectory() ? -1 : 1;
      }
      return a.name.localeCompare(b.name);
    });

  const normalizedRequestPath = requestPath.endsWith("/") ? requestPath : `${requestPath}/`;
  const rel = relative(rootPath, directoryPath);
  const title = rel === "" ? basename(rootPath) : rel;
  const rows: string[] = [];

  if (rel !== "") {
    rows.push(`<li><a href="../">../</a></li>`);
  }

  for (const entry of entries) {
    const href = `${encodePathSegment(entry.name)}${entry.isDirectory() ? "/" : ""}`;
    const label = `${entry.name}${entry.isDirectory() ? "/" : ""}`;
    rows.push(`<li><a href="${href}">${escapeHTML(label)}</a></li>`);
  }

  const body = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <meta name="color-scheme" content="light dark" />
    <title>${escapeHTML(title)}</title>
    <style>${directoryListingCSS()}</style>
    ${options.localStoragePersistence ? localStoragePersistenceClientScript() : ""}
  </head>
  <body>
    <main>
      <p class="tag">Web package</p>
      <h1>${escapeHTML(title || basename(rootPath))}</h1>
      <p class="path">${escapeHTML(normalizedRequestPath)}</p>
      <ul>${rows.join("\n")}</ul>
    </main>
    ${options.liveReload ? liveReloadClientScript() : ""}
  </body>
</html>`;

  return new Response(body, {
    headers: {
      "Cache-Control": "no-store",
      "Content-Type": "text/html; charset=utf-8",
    },
  });
}

export function renderMarkdownDocument(
  source: string,
  title: string,
  liveReload = false,
  localStoragePersistence = false,
): string {
  const body = renderMarkdown(source);
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <meta name="color-scheme" content="light dark" />
    <title>${escapeHTML(title)}</title>
    <style>${markdownCSS()}</style>
    ${localStoragePersistence ? localStoragePersistenceClientScript() : ""}
  </head>
  <body>
    <main class="markdown-body">
      ${body}
    </main>
    ${liveReload ? liveReloadClientScript() : ""}
  </body>
</html>`;
}

export function createReloadBroadcaster() {
  const clients = new Set<ReadableStreamDefaultController<Uint8Array>>();
  const encoder = new TextEncoder();
  let version = 0;

  return {
    response() {
      let client: ReadableStreamDefaultController<Uint8Array> | null = null;
      const stream = new ReadableStream<Uint8Array>({
        start(controller) {
          client = controller;
          clients.add(controller);
          controller.enqueue(encoder.encode(`event: hello\ndata: ${version}\n\n`));
        },
        cancel() {
          if (client !== null) {
            clients.delete(client);
          }
        },
      });

      return new Response(stream, {
        headers: {
          "Cache-Control": "no-store",
          "Content-Type": "text/event-stream",
          "X-Accel-Buffering": "no",
        },
      });
    },
    versionResponse() {
      return Response.json(
        { version },
        {
          headers: {
            "Cache-Control": "no-store",
          },
        },
      );
    },
    broadcast() {
      version += 1;
      for (const client of clients) {
        try {
          client.enqueue(encoder.encode(`event: reload\ndata: ${version}\n\n`));
        } catch {
          clients.delete(client);
        }
      }
    },
  };
}

export async function readLocalStorageSnapshot(storageFilePath: string): Promise<LocalStorageSnapshot> {
  try {
    return normalizeLocalStorageSnapshot(JSON.parse(await readFile(storageFilePath, "utf8")));
  } catch (error) {
    if (isNotFoundError(error)) {
      return { schema: 1, entries: [] };
    }
    throw error;
  }
}

export async function writeLocalStorageSnapshot(
  storageFilePath: string,
  snapshot: LocalStorageSnapshot,
): Promise<void> {
  const normalized = normalizeLocalStorageSnapshot(snapshot);
  if (normalized.entries.length === 0) {
    await rm(storageFilePath, { force: true });
    return;
  }

  await mkdir(dirname(storageFilePath), { recursive: true });
  const tempPath = `${storageFilePath}.${crypto.randomUUID()}.tmp`;
  await writeFile(tempPath, `${JSON.stringify(normalized, null, 2)}\n`);
  await rename(tempPath, storageFilePath);
}

export function createLocalStoragePersistenceRoutes(storageFilePath: string): Record<string, unknown> {
  return {
    [LOCAL_STORAGE_ROUTE]: {
      async GET() {
        try {
          return Response.json(await readLocalStorageSnapshot(storageFilePath), {
            headers: {
              "Cache-Control": "no-store",
            },
          });
        } catch (error) {
          return new Response(String(error), { status: 500 });
        }
      },
      async POST(request: Request) {
        try {
          await writeLocalStorageSnapshot(storageFilePath, await request.json());
          return new Response(null, { status: 204 });
        } catch (error) {
          return new Response(String(error), { status: 400 });
        }
      },
    },
  };
}

function normalizeLocalStorageSnapshot(value: unknown): LocalStorageSnapshot {
  if (typeof value !== "object" || value === null) {
    throw new Error("localStorage snapshot must be an object.");
  }

  const snapshot = value as { schema?: unknown; entries?: unknown };
  if (snapshot.schema !== 1) {
    throw new Error("localStorage snapshot schema must be 1.");
  }
  if (!Array.isArray(snapshot.entries)) {
    throw new Error("localStorage snapshot entries must be an array.");
  }

  return {
    schema: 1,
    entries: snapshot.entries.map((entry) => {
      if (!Array.isArray(entry) || entry.length !== 2 || typeof entry[0] !== "string" || typeof entry[1] !== "string") {
        throw new Error("localStorage snapshot entries must be string pairs.");
      }
      return [entry[0], entry[1]];
    }),
  };
}

function isNotFoundError(error: unknown): boolean {
  return typeof error === "object"
    && error !== null
    && "code" in error
    && (error as { code?: unknown }).code === "ENOENT";
}

function routePathFor(rootPath: string, filePath: string): string {
  return `/${relative(rootPath, filePath).split(sep).map(encodeURIComponent).join("/")}`;
}

function exactRootPage(rootPath: string, pages: string[], name: string): string | null {
  return pages.find((page) => relative(rootPath, page) === name) ?? null;
}

function firstPatternRootPage(rootPath: string, pages: string[]): string | null {
  return pages.find((page) => {
    const rel = relative(rootPath, page);
    return !rel.includes(sep) && /^index\..+\.html?$/i.test(rel);
  }) ?? null;
}

function directoryAliasForIndex(rootPath: string, pagePath: string): string | null {
  const rel = relative(rootPath, pagePath);
  const parts = rel.split(sep);
  const fileName = parts.at(-1) ?? "";
  if (!/^index(?:\..+)?\.html?$/i.test(fileName)) {
    return null;
  }
  if (parts.length === 1) {
    return "/";
  }
  return `/${parts.slice(0, -1).map(encodeURIComponent).join("/")}/`;
}

function htmlRouteValue(pagePath: string, htmlImport: unknown, options: RenderOptions): unknown {
  if (typeof htmlImport === "string") {
    return {
      async GET() {
        return await readFileResponse(pagePath, options);
      },
    };
  }

  return htmlImport;
}

function preferredDirectoryAliasTargets(rootPath: string, htmlPages: string[]): Map<string, string> {
  const targets = new Map<string, string>();

  for (const pagePath of htmlPages) {
    const alias = directoryAliasForIndex(rootPath, pagePath);
    if (alias === null) {
      continue;
    }

    const current = targets.get(alias);
    if (current === undefined || compareIndexAliasPreference(rootPath, pagePath, current) < 0) {
      targets.set(alias, pagePath);
    }
  }

  return targets;
}

function compareIndexAliasPreference(rootPath: string, left: string, right: string): number {
  const leftName = basename(left).toLowerCase();
  const rightName = basename(right).toLowerCase();
  const leftRank = indexAliasRank(leftName);
  const rightRank = indexAliasRank(rightName);
  if (leftRank !== rightRank) {
    return leftRank - rightRank;
  }
  return routePathFor(rootPath, left).localeCompare(routePathFor(rootPath, right));
}

function indexAliasRank(fileName: string): number {
  if (fileName === "index.html") {
    return 0;
  }
  if (fileName === "index.htm") {
    return 1;
  }
  return 2;
}

function isInsideRoot(rootPath: string, candidate: string): boolean {
  const rel = relative(rootPath, candidate);
  return rel === "" || (!rel.startsWith("..") && !isAbsolute(rel));
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await lstat(path);
    return true;
  } catch {
    return false;
  }
}

async function isEmptyDirectory(path: string): Promise<boolean> {
  const entries = await readdir(path);
  return entries.every((entry) => entry === ".DS_Store" || entry === LOCAL_DIRECTORY);
}

async function assertNoSymlinkAlongPath(rootPath: string, candidate: string): Promise<boolean> {
  const rel = relative(rootPath, candidate);
  if (rel === "") {
    return true;
  }
  if (rel.startsWith("..") || isAbsolute(rel)) {
    return false;
  }

  let cursor = rootPath;
  for (const part of rel.split(sep)) {
    cursor = join(cursor, part);
    const stat = await lstat(cursor);
    if (stat.isSymbolicLink()) {
      return false;
    }
  }
  return true;
}

function injectClientScripts(html: string, options: RenderOptions): string {
  let result = html;
  if (options.localStoragePersistence) {
    result = injectHeadScript(result, localStoragePersistenceClientScript());
  }
  if (options.liveReload) {
    result = injectBodyScript(result, liveReloadClientScript());
  }
  return result;
}

function injectHeadScript(html: string, script: string): string {
  if (/<head\b[^>]*>/i.test(html)) {
    return html.replace(/<head\b[^>]*>/i, (match) => `${match}\n${script}`);
  }
  return `${script}${html}`;
}

function injectBodyScript(html: string, script: string): string {
  if (/<\/body>/i.test(html)) {
    return html.replace(/<\/body>/i, `${script}</body>`);
  }
  return `${html}${script}`;
}

function localStoragePersistenceClientScript(): string {
  return `<script>
(() => {
  if (window.__WEB_APP_LOCAL_STORAGE__) return;
  window.__WEB_APP_LOCAL_STORAGE__ = true;
  const endpoint = "/_web/persistence/local-storage";
  const storage = window.localStorage;
  const storageMethods = new Set(["clear", "getItem", "key", "length", "removeItem", "setItem"]);
  const originalSetItem = Storage.prototype.setItem;
  const originalRemoveItem = Storage.prototype.removeItem;
  const originalClear = Storage.prototype.clear;
  let flushTimer = 0;

  const snapshot = () => {
    const entries = [];
    for (let index = 0; index < storage.length; index += 1) {
      const key = storage.key(index);
      if (key !== null) entries.push([key, storage.getItem(key) ?? ""]);
    }
    entries.sort((left, right) => left[0].localeCompare(right[0]));
    return JSON.stringify({ schema: 1, entries });
  };

  const flush = (keepalive = false) => {
    window.clearTimeout(flushTimer);
    const body = snapshot();
    if (keepalive && navigator.sendBeacon) {
      const blob = new Blob([body], { type: "application/json" });
      if (navigator.sendBeacon(endpoint, blob)) return;
    }
    fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body,
      keepalive,
    }).catch((error) => console.warn("Web localStorage persistence failed:", error));
  };

  const scheduleFlush = () => {
    window.clearTimeout(flushTimer);
    flushTimer = window.setTimeout(() => flush(false), 120);
  };

  try {
    const request = new XMLHttpRequest();
    request.open("GET", endpoint, false);
    request.setRequestHeader("Accept", "application/json");
    request.send(null);
    if (request.status >= 200 && request.status < 300 && request.responseText) {
      const payload = JSON.parse(request.responseText);
      if (payload?.schema === 1 && Array.isArray(payload.entries)) {
        originalClear.call(storage);
        for (const entry of payload.entries) {
          if (Array.isArray(entry) && entry.length === 2) {
            originalSetItem.call(storage, String(entry[0]), String(entry[1]));
          }
        }
      }
    }
  } catch (error) {
    console.warn("Web localStorage hydration failed:", error);
  }

  Storage.prototype.setItem = function setItem(key, value) {
    const result = originalSetItem.call(this, key, value);
    if (this === storage) scheduleFlush();
    return result;
  };
  Storage.prototype.removeItem = function removeItem(key) {
    const result = originalRemoveItem.call(this, key);
    if (this === storage) scheduleFlush();
    return result;
  };
  Storage.prototype.clear = function clear() {
    const result = originalClear.call(this);
    if (this === storage) scheduleFlush();
    return result;
  };

  try {
    const proxy = new Proxy(storage, {
      set(target, property, value) {
        const result = Reflect.set(target, property, value);
        if (typeof property === "string" && !storageMethods.has(property)) {
          originalSetItem.call(target, property, String(value));
          scheduleFlush();
        }
        return result;
      },
      deleteProperty(target, property) {
        const result = Reflect.deleteProperty(target, property);
        if (typeof property === "string" && !storageMethods.has(property)) {
          originalRemoveItem.call(target, property);
          scheduleFlush();
        }
        return result;
      },
    });
    Object.defineProperty(window, "localStorage", {
      configurable: true,
      get() {
        return proxy;
      },
    });
  } catch {
    // Some WebKit builds do not allow replacing window.localStorage. Method calls still persist.
  }

  window.addEventListener("pagehide", () => flush(true));
})();
</script>`;
}

function liveReloadClientScript(): string {
  return `<script>
(() => {
  if (window.__WEB_APP_LIVE_RELOAD__) return;
  window.__WEB_APP_LIVE_RELOAD__ = true;
  const reload = () => location.reload();
  const poll = async () => {
    try {
      const response = await fetch("/_web/live-reload-version", { cache: "no-store" });
      const payload = await response.json();
      const version = String(payload.version ?? "");
      if (!window.__WEB_APP_LIVE_RELOAD_VERSION__) {
        window.__WEB_APP_LIVE_RELOAD_VERSION__ = version;
      } else if (version && window.__WEB_APP_LIVE_RELOAD_VERSION__ !== version) {
        reload();
        return;
      }
    } catch {
      // Keep polling; the local server may be restarting.
    }
    window.setTimeout(poll, 750);
  };
  if (typeof EventSource === "function") {
    const source = new EventSource("/_web/live-reload");
    source.addEventListener("hello", (event) => {
      window.__WEB_APP_LIVE_RELOAD_VERSION__ = event.data;
    });
    source.addEventListener("reload", reload);
    source.addEventListener("error", () => {
      source.close();
      poll();
    });
  } else {
    poll();
  }
})();
</script>`;
}

function renderMarkdown(source: string): string {
  const lines = source.replace(/\r\n?/g, "\n").split("\n");
  const output: string[] = [];
  let paragraph: string[] = [];
  let listType: "ul" | "ol" | null = null;
  let codeFence: string[] | null = null;
  let codeLanguage = "";

  const flushParagraph = () => {
    if (paragraph.length === 0) {
      return;
    }
    output.push(`<p>${renderInline(paragraph.join(" "))}</p>`);
    paragraph = [];
  };

  const closeList = () => {
    if (listType !== null) {
      output.push(`</${listType}>`);
      listType = null;
    }
  };

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index] ?? "";

    if (codeFence !== null) {
      if (/^```/.test(line)) {
        output.push(`<pre><code${codeLanguage ? ` class="language-${escapeAttr(codeLanguage)}"` : ""}>${escapeHTML(codeFence.join("\n"))}</code></pre>`);
        codeFence = null;
        codeLanguage = "";
      } else {
        codeFence.push(line);
      }
      continue;
    }

    const fenceMatch = line.match(/^```\s*([A-Za-z0-9_-]*)\s*$/);
    if (fenceMatch) {
      flushParagraph();
      closeList();
      codeFence = [];
      codeLanguage = fenceMatch[1] ?? "";
      continue;
    }

    if (line.trim() === "") {
      flushParagraph();
      closeList();
      continue;
    }

    const table = readMarkdownTable(lines, index);
    if (table !== null) {
      flushParagraph();
      closeList();
      output.push(renderTable(table.rows));
      index = table.endIndex;
      continue;
    }

    const heading = line.match(/^(#{1,6})\s+(.+)$/);
    if (heading) {
      flushParagraph();
      closeList();
      const level = heading[1].length;
      output.push(`<h${level}>${renderInline(heading[2])}</h${level}>`);
      continue;
    }

    const unordered = line.match(/^\s*[-*]\s+(.+)$/);
    if (unordered) {
      flushParagraph();
      if (listType !== "ul") {
        closeList();
        output.push("<ul>");
        listType = "ul";
      }
      output.push(`<li>${renderInline(unordered[1])}</li>`);
      continue;
    }

    const ordered = line.match(/^\s*\d+\.\s+(.+)$/);
    if (ordered) {
      flushParagraph();
      if (listType !== "ol") {
        closeList();
        output.push("<ol>");
        listType = "ol";
      }
      output.push(`<li>${renderInline(ordered[1])}</li>`);
      continue;
    }

    paragraph.push(line.trim());
  }

  if (codeFence !== null) {
    output.push(`<pre><code>${escapeHTML(codeFence.join("\n"))}</code></pre>`);
  }
  flushParagraph();
  closeList();
  return output.join("\n");
}

function readMarkdownTable(lines: string[], startIndex: number): { rows: string[][]; endIndex: number } | null {
  const header = lines[startIndex] ?? "";
  const separator = lines[startIndex + 1] ?? "";
  if (!header.includes("|") || !isTableSeparator(separator)) {
    return null;
  }

  const rows = [splitTableRow(header)];
  let index = startIndex + 2;
  while (index < lines.length && lines[index].includes("|") && lines[index].trim() !== "") {
    rows.push(splitTableRow(lines[index]));
    index += 1;
  }
  return { rows, endIndex: index - 1 };
}

function isTableSeparator(line: string): boolean {
  const cells = splitTableRow(line);
  return cells.length > 0 && cells.every((cell) => /^:?-{3,}:?$/.test(cell.trim()));
}

function splitTableRow(line: string): string[] {
  return line
    .trim()
    .replace(/^\|/, "")
    .replace(/\|$/, "")
    .split("|")
    .map((cell) => cell.trim());
}

function renderTable(rows: string[][]): string {
  const [header = [], ...body] = rows;
  const headCells = header.map((cell) => `<th>${renderInline(cell)}</th>`).join("");
  const bodyRows = body
    .map((row) => `<tr>${row.map((cell) => `<td>${renderInline(cell)}</td>`).join("")}</tr>`)
    .join("");
  return `<table><thead><tr>${headCells}</tr></thead><tbody>${bodyRows}</tbody></table>`;
}

function renderInline(text: string): string {
  return escapeHTML(text)
    .replace(/`([^`]+)`/g, "<code>$1</code>")
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    .replace(/\*([^*]+)\*/g, "<em>$1</em>")
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_match, label: string, href: string) => {
      const trimmedHref = href.trim();
      if (/^javascript:/i.test(trimmedHref)) {
        return label;
      }
      return `<a href="${escapeAttr(trimmedHref)}">${label}</a>`;
    });
}

function escapeHTML(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function escapeAttr(value: string): string {
  return escapeHTML(value).replace(/'/g, "&#39;");
}

function encodePathSegment(value: string): string {
  return encodeURIComponent(value).replace(/%2F/g, "/");
}

function markdownCSS(): string {
  return `:root { color-scheme: light dark; }
body { margin: 0; background: Canvas; color: CanvasText; font-family: ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; line-height: 1.55; }
main { max-inline-size: 72rem; margin-inline: auto; padding: clamp(1rem, 4vw, 3rem); }
h1, h2, h3 { line-height: 1.1; }
a { color: LinkText; }
pre { overflow: auto; padding: 1rem; background: color-mix(in oklch, CanvasText 8%, transparent); border-radius: 0.5rem; }
code { font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; }
table { border-collapse: collapse; inline-size: 100%; }
th, td { border-block-start: 1px solid color-mix(in oklch, CanvasText 18%, transparent); padding: 0.45rem; text-align: start; }`;
}

function directoryListingCSS(): string {
  return `:root { color-scheme: light dark; }
body { margin: 0; background: Canvas; color: CanvasText; font-family: ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; line-height: 1.5; }
main { max-inline-size: 58rem; margin-inline: auto; padding: clamp(1rem, 4vw, 3rem); }
h1 { margin-block: 0 0.25rem; line-height: 1; }
a { color: LinkText; }
ul { padding: 0; list-style: none; display: grid; gap: 0.35rem; }
li { border-block-start: 1px solid color-mix(in oklch, CanvasText 14%, transparent); padding-block: 0.35rem; }
.tag, .path { color: color-mix(in oklch, CanvasText 62%, transparent); font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; }`;
}

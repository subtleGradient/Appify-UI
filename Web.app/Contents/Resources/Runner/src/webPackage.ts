import { existsSync } from "node:fs";
import { lstat, mkdir, readFile, readdir, rename, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import { homedir } from "node:os";
import { basename, dirname, extname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { pathToFileURL } from "node:url";

export type ResolvedRequestPath =
  | { kind: "directory"; path: string }
  | { kind: "file"; path: string };

export type RenderOptions = {
  liveReload?: boolean;
  localStoragePersistence?: boolean;
  controlBasePath?: string;
  title?: string;
};

export type LocalStorageSnapshot = {
  schema: 1;
  entries: [string, string][];
};

export type WebSpace = {
  documentPath: string;
  activeRootPath: string;
  webspaceRootPath: string;
  activeBasePath: string;
  webspaceKind: "git" | "sibling";
};

type LocalStorageDiskSnapshot = {
  schema: 3;
  entries: LocalStorageDiskEntry[];
  files: LocalStorageFileEntry[];
};

type LocalStorageDiskEntry =
  | { key: string; value: string }
  | { key: string; json: unknown };

type LocalStorageFileEntry = {
  key: string;
  path: string;
  valueType: "text" | "data-url";
  mediaType?: string;
  encoding?: "base64" | "utf-8";
};

type LocalStoragePersistenceContext = {
  rootPath: string;
  pagePath?: string | null;
};

type StorageFileTarget = {
  absolutePath: string;
  relativePath: string;
};

type StorageFileWrite = {
  target: StorageFileTarget;
  contents: string | Uint8Array;
  fileEntry: LocalStorageFileEntry;
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
const STORAGE_FILE_NAME = "storage.json";
const FILE_STORAGE_CONTROL_SEGMENTS = new Set(["_web", "node_modules"]);
const FILE_STORAGE_SEGMENT_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._@ -]*$/;
const BINARY_DATA_URL_MEDIA_TYPES = new Set([
  "application/octet-stream",
  "application/pdf",
  "audio/mpeg",
  "image/gif",
  "image/jpeg",
  "image/png",
  "image/webp",
  "video/mp4",
]);
const TEXT_DATA_URL_MEDIA_TYPES = new Set([
  "application/json",
  "image/svg+xml",
  "text/plain",
]);

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

export async function resolveWebSpace(documentPath: string): Promise<WebSpace> {
  const activeRootPath = await resolveServeRoot(documentPath);
  const gitRoot = await nearestProjectGitRoot(activeRootPath);
  const webspaceRootPath = gitRoot ?? fallbackWebspaceRoot(documentPath, activeRootPath);
  const activeBasePath = directoryRoutePath(webspaceRootPath, activeRootPath);

  return {
    documentPath,
    activeRootPath,
    webspaceRootPath,
    activeBasePath,
    webspaceKind: gitRoot === null ? "sibling" : "git",
  };
}

async function nearestProjectGitRoot(startPath: string): Promise<string | null> {
  let cursor = resolve(startPath);
  const homePath = resolve(homedir());

  while (true) {
    if (await pathExists(join(cursor, ".git"))) {
      if (cursor !== dirname(cursor) && cursor !== homePath) {
        return cursor;
      }
      return null;
    }

    const parent = dirname(cursor);
    if (parent === cursor) {
      return null;
    }
    cursor = parent;
  }
}

function fallbackWebspaceRoot(documentPath: string, activeRootPath: string): string {
  const documentExtension = extname(documentPath).toLowerCase();
  if (documentExtension === ".web" && extname(activeRootPath).toLowerCase() === ".web") {
    return dirname(activeRootPath);
  }
  return activeRootPath;
}

export async function resolveLocalStorageFilePath(documentPath: string): Promise<string> {
  const stat = await lstat(documentPath);
  if (stat.isDirectory()) {
    return join(documentPath, LOCAL_DIRECTORY, STORAGE_FILE_NAME);
  }
  if (stat.isFile()) {
    return join(dirname(documentPath), LOCAL_DIRECTORY, `${basename(documentPath)}.${STORAGE_FILE_NAME}`);
  }

  throw new Error(`${documentPath} must be a .web file or directory.`);
}

export function isIgnoredReloadPath(rootPath: string, fileName: string | Buffer | null): boolean {
  if (fileName === null) {
    return false;
  }

  const normalized = relative(rootPath, resolve(rootPath, fileName.toString()));
  return normalized.split(sep).includes(LOCAL_DIRECTORY);
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

export async function resolveWebSpaceRequestPath(
  webspace: WebSpace,
  requestPath: string,
): Promise<ResolvedRequestPath | null> {
  const resolvedPath = await resolveRequestPath(webspace.webspaceRootPath, requestPath);
  if (resolvedPath === null) {
    return null;
  }
  if (!isReadableWebSpacePath(webspace, resolvedPath.path)) {
    return null;
  }
  return resolvedPath;
}

function isReadableWebSpacePath(webspace: WebSpace, filePath: string): boolean {
  if (isInsideRoot(webspace.activeRootPath, filePath)) {
    return true;
  }

  const rel = relative(webspace.webspaceRootPath, filePath);
  if (rel === "" || rel.startsWith("..") || isAbsolute(rel)) {
    return false;
  }

  return rel.split(sep).some((part) => extname(part).toLowerCase() === ".web");
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
  options: Pick<RenderOptions, "localStoragePersistence" | "controlBasePath"> & { routeBasePath?: string } = {},
): Promise<Record<string, unknown>> {
  const routes: Record<string, unknown> = {};
  const aliasTargets = preferredDirectoryAliasTargets(rootPath, htmlPages);
  const routeBasePath = options.routeBasePath ?? "/";

  for (const pagePath of htmlPages) {
    try {
      const htmlImport = (await import(pathToFileURL(pagePath).href)).default;
      const routeValue = htmlRouteValue(pagePath, htmlImport, {
        liveReload: hmrEnabled,
        localStoragePersistence: options.localStoragePersistence,
        controlBasePath: options.controlBasePath,
      });
      routes[routePathWithBase(routeBasePath, routePathFor(rootPath, pagePath))] = routeValue;

      const alias = directoryAliasForIndex(rootPath, pagePath);
      if (alias !== null && aliasTargets.get(alias) === pagePath) {
        routes[routePathWithBase(routeBasePath, alias)] = routeValue;
      }
      if (rootEntry === pagePath) {
        routes[directoryRouteBasePath(routeBasePath)] = routeValue;
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
      options.controlBasePath,
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
    ${options.localStoragePersistence ? localStoragePersistenceClientScript(options.controlBasePath) : ""}
  </head>
  <body>
    <main>
      <p class="tag">Web package</p>
      <h1>${escapeHTML(title || basename(rootPath))}</h1>
      <p class="path">${escapeHTML(normalizedRequestPath)}</p>
      <ul>${rows.join("\n")}</ul>
    </main>
    ${options.liveReload ? liveReloadClientScript(options.controlBasePath) : ""}
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
  controlBasePath = "/",
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
    ${localStoragePersistence ? localStoragePersistenceClientScript(controlBasePath) : ""}
  </head>
  <body>
    <main class="markdown-body">
      ${body}
    </main>
    ${liveReload ? liveReloadClientScript(controlBasePath) : ""}
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

export async function readLocalStorageSnapshot(
  storageFilePath: string,
  context?: LocalStoragePersistenceContext,
): Promise<LocalStorageSnapshot> {
  try {
    const diskSnapshot = normalizeLocalStorageDiskSnapshot(JSON.parse(await readFile(storageFilePath, "utf8")));
    return await localStorageSnapshotFromDisk(diskSnapshot, context);
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
  context?: LocalStoragePersistenceContext,
): Promise<void> {
  const normalized = normalizeLocalStorageSnapshot(snapshot);
  if (normalized.entries.length === 0) {
    await rm(storageFilePath, { force: true });
    return;
  }

  const entries: LocalStorageDiskEntry[] = [];
  const files: LocalStorageFileEntry[] = [];
  for (const [key, value] of sortedLocalStorageEntries(normalized.entries)) {
    if (context !== undefined) {
      const fileWrite = await storageFileWriteForEntry(context, key, value);
      if (fileWrite !== null && await writeStorageFile(context.rootPath, fileWrite.target, fileWrite.contents)) {
        files.push(fileWrite.fileEntry);
        continue;
      }
    }

    entries.push(localStorageDiskEntryFor(key, value));
  }

  if (entries.length === 0 && files.length === 0) {
    await rm(storageFilePath, { force: true });
    return;
  }

  await mkdir(dirname(storageFilePath), { recursive: true });
  const diskSnapshot: LocalStorageDiskSnapshot = { schema: 3, entries, files };
  const tempPath = `${storageFilePath}.${crypto.randomUUID()}.tmp`;
  await writeFile(tempPath, `${JSON.stringify(diskSnapshot, null, 2)}\n`);
  await rename(tempPath, storageFilePath);
}

export function createLocalStoragePersistenceRoutes(
  storageFilePath: string,
  rootPath: string,
  controlBasePath = "/",
): Record<string, unknown> {
  const routePath = routePathWithBase(controlBasePath, LOCAL_STORAGE_ROUTE);
  return {
    [routePath]: {
      async GET(request?: Request) {
        try {
          return Response.json(
            await readLocalStorageSnapshot(storageFilePath, {
              rootPath,
              pagePath: pagePathForPersistenceRequest(request),
            }),
            {
              headers: {
                "Cache-Control": "no-store",
              },
            },
          );
        } catch (error) {
          return new Response(String(error), { status: 500 });
        }
      },
      async POST(request: Request) {
        try {
          await writeLocalStorageSnapshot(storageFilePath, await request.json(), {
            rootPath,
            pagePath: pagePathForPersistenceRequest(request),
          });
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

async function localStorageSnapshotFromDisk(
  diskSnapshot: LocalStorageDiskSnapshot,
  context?: LocalStoragePersistenceContext,
): Promise<LocalStorageSnapshot> {
  const entries: [string, string][] = [];

  for (const entry of diskSnapshot.entries) {
    if ("value" in entry) {
      entries.push([entry.key, entry.value]);
      continue;
    }
    entries.push([entry.key, stringifyJsonStorageValue(entry.json)]);
  }

  if (context !== undefined) {
    for (const fileEntry of diskSnapshot.files) {
      const target = resolveStorageFileTarget(context, fileEntry.key);
      if (target === null || target.relativePath !== fileEntry.path) {
        continue;
      }

      try {
        entries.push([fileEntry.key, await readStorageFileValue(target.absolutePath, fileEntry)]);
      } catch (error) {
        if (!isNotFoundError(error)) {
          throw error;
        }
      }
    }
  }

  return { schema: 1, entries: sortedLocalStorageEntries(entries) };
}

function normalizeLocalStorageDiskSnapshot(value: unknown): LocalStorageDiskSnapshot {
  const snapshot = value as { schema?: unknown; entries?: unknown };
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error("localStorage disk snapshot must be an object.");
  }
  if (snapshot.schema !== 3) {
    throw new Error("localStorage disk snapshot schema must be 3.");
  }
  if (!Array.isArray(snapshot.entries)) {
    throw new Error("localStorage disk snapshot entries must be an array.");
  }
  if (!Array.isArray((value as { files?: unknown }).files)) {
    throw new Error("localStorage disk snapshot files must be an array.");
  }

  const entries: LocalStorageDiskEntry[] = [];
  for (const entry of snapshot.entries) {
    if (typeof entry !== "object" || entry === null || Array.isArray(entry)) {
      throw new Error("localStorage disk snapshot entries must be objects.");
    }

    const diskEntry = entry as { key?: unknown; value?: unknown; json?: unknown };
    if (typeof diskEntry.key !== "string") {
      throw new Error("localStorage disk snapshot entries must include string keys.");
    }

    const hasValue = "value" in diskEntry;
    const hasJson = "json" in diskEntry;
    if ([hasValue, hasJson].filter(Boolean).length !== 1) {
      throw new Error("localStorage disk snapshot entries must include one value source.");
    }

    if (hasValue) {
      if (typeof diskEntry.value !== "string") {
        throw new Error("localStorage disk snapshot value entries must be strings.");
      }
      entries.push({ key: diskEntry.key, value: diskEntry.value });
      continue;
    }

    stringifyJsonStorageValue(diskEntry.json);
    entries.push({ key: diskEntry.key, json: diskEntry.json });
  }

  const files: LocalStorageFileEntry[] = [];
  for (const entry of (value as { files: unknown[] }).files) {
    if (typeof entry !== "object" || entry === null || Array.isArray(entry)) {
      throw new Error("localStorage disk snapshot files must be objects.");
    }

    const fileEntry = entry as {
      key?: unknown;
      path?: unknown;
      valueType?: unknown;
      mediaType?: unknown;
      encoding?: unknown;
    };
    if (typeof fileEntry.key !== "string" || typeof fileEntry.path !== "string") {
      throw new Error("localStorage disk snapshot file entries must include string keys and paths.");
    }
    if (fileEntry.valueType !== "text" && fileEntry.valueType !== "data-url") {
      throw new Error("localStorage disk snapshot file entries must include a known valueType.");
    }

    if (fileEntry.valueType === "text") {
      files.push({
        key: fileEntry.key,
        path: fileEntry.path,
        valueType: "text",
      });
      continue;
    }

    if (
      typeof fileEntry.mediaType !== "string"
      || (fileEntry.encoding !== "base64" && fileEntry.encoding !== "utf-8")
    ) {
      throw new Error("localStorage disk snapshot data-url file entries must include mediaType and encoding.");
    }
    files.push({
      key: fileEntry.key,
      path: fileEntry.path,
      valueType: "data-url",
      mediaType: fileEntry.mediaType,
      encoding: fileEntry.encoding,
    });
  }

  return { schema: 3, entries, files };
}

function parsedCanonicalJsonContainer(value: string): unknown | null {
  let json: unknown;
  try {
    json = JSON.parse(value);
  } catch {
    return null;
  }

  if (!isJsonContainer(json) || JSON.stringify(json) !== value) {
    return null;
  }
  return json;
}

function stringifyJsonStorageValue(value: unknown): string {
  if (!isJsonContainer(value)) {
    throw new Error("localStorage JSON values must be objects or arrays.");
  }

  const text = JSON.stringify(value);
  if (typeof text !== "string") {
    throw new Error("localStorage JSON values must be serializable.");
  }
  return text;
}

function isJsonContainer(value: unknown): boolean {
  return typeof value === "object" && value !== null;
}

function sortedLocalStorageEntries(entries: [string, string][]): [string, string][] {
  return [...entries].sort((left, right) => left[0].localeCompare(right[0]));
}

function localStorageDiskEntryFor(key: string, value: string): LocalStorageDiskEntry {
  const json = parsedCanonicalJsonContainer(value);
  return json === null ? { key, value } : { key, json };
}

async function storageFileWriteForEntry(
  context: LocalStoragePersistenceContext,
  key: string,
  value: string,
): Promise<StorageFileWrite | null> {
  const target = resolveStorageFileTarget(context, key);
  if (target === null) {
    return null;
  }

  const valueWrite = storageFileValueFor(value);
  if (valueWrite === null) {
    return null;
  }

  return {
    target,
    contents: valueWrite.contents,
    fileEntry: {
      key,
      path: target.relativePath,
      ...valueWrite.fileEntry,
    },
  };
}

function storageFileValueFor(value: string): {
  contents: string | Uint8Array;
  fileEntry: Omit<LocalStorageFileEntry, "key" | "path">;
} | null {
  if (!value.startsWith("data:")) {
    return {
      contents: value,
      fileEntry: { valueType: "text" },
    };
  }

  return storageDataUrlValueFor(value);
}

function storageDataUrlValueFor(value: string): {
  contents: string | Uint8Array;
  fileEntry: Omit<LocalStorageFileEntry, "key" | "path">;
} | null {
  const commaIndex = value.indexOf(",");
  if (commaIndex < 0) {
    return null;
  }

  const header = value.slice("data:".length, commaIndex);
  const payload = value.slice(commaIndex + 1);
  const binaryMatch = /^([a-z0-9.+-]+\/[a-z0-9.+-]+);base64$/.exec(header);
  if (binaryMatch !== null) {
    const mediaType = binaryMatch[1];
    if (!BINARY_DATA_URL_MEDIA_TYPES.has(mediaType) || !isStrictBase64(payload)) {
      return null;
    }
    return {
      contents: Uint8Array.from(Buffer.from(payload, "base64")),
      fileEntry: { valueType: "data-url", mediaType, encoding: "base64" },
    };
  }

  const textMatch = /^([a-z0-9.+-]+\/[a-z0-9.+-]+)(?:;charset=utf-8)?$/.exec(header);
  if (textMatch === null || !TEXT_DATA_URL_MEDIA_TYPES.has(textMatch[1])) {
    return null;
  }

  try {
    return {
      contents: decodeURIComponent(payload),
      fileEntry: { valueType: "data-url", mediaType: textMatch[1], encoding: "utf-8" },
    };
  } catch {
    return null;
  }
}

function isStrictBase64(value: string): boolean {
  return value.length % 4 === 0
    && /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value);
}

async function readStorageFileValue(filePath: string, fileEntry: LocalStorageFileEntry): Promise<string> {
  if (fileEntry.valueType === "text") {
    return await readFile(filePath, "utf8");
  }

  if (fileEntry.encoding === "base64") {
    const bytes = await readFile(filePath);
    return `data:${fileEntry.mediaType};base64,${Buffer.from(bytes).toString("base64")}`;
  }

  const text = await readFile(filePath, "utf8");
  return `data:${fileEntry.mediaType};charset=utf-8,${encodeURIComponent(text)}`;
}

function resolveStorageFileTarget(
  context: LocalStoragePersistenceContext,
  key: string,
): StorageFileTarget | null {
  const keySegments = storageKeySegments(key);
  if (keySegments === null) {
    return null;
  }

  const segments = key.startsWith("./")
    ? [...pageDirectorySegments(context.pagePath), ...keySegments]
    : keySegments;
  if (!hasFileNameWithExtension(segments.at(-1))) {
    return null;
  }

  const relativePath = segments.join("/");
  const absolutePath = resolve(context.rootPath, ...segments);
  if (!isInsideRoot(context.rootPath, absolutePath)) {
    return null;
  }
  return { absolutePath, relativePath };
}

function storageKeySegments(key: string): string[] | null {
  if (
    (!key.startsWith("/") && !key.startsWith("./"))
    || key.startsWith("//")
    || key.includes("\\")
    || key.includes("\0")
    || key.includes("%")
    || key.includes("?")
    || key.includes("#")
  ) {
    return null;
  }

  const relativeKey = key.startsWith("./") ? key.slice(2) : key.slice(1);
  if (relativeKey.length === 0 || relativeKey.includes("//")) {
    return null;
  }

  const segments = relativeKey.split("/");
  return segments.every(isFileStoragePathSegment) ? segments : null;
}

function pageDirectorySegments(pagePath: string | null | undefined): string[] {
  const pageSegments = pagePathSegments(pagePath);
  if (pagePath?.endsWith("/")) {
    return pageSegments;
  }
  return pageSegments.slice(0, -1);
}

function pagePathSegments(pagePath: string | null | undefined): string[] {
  if (!pagePath?.startsWith("/") || pagePath.includes("\\") || pagePath.includes("\0")) {
    return [];
  }

  let decodedPath: string;
  try {
    decodedPath = decodeURIComponent(pagePath);
  } catch {
    return [];
  }
  if (!decodedPath.startsWith("/") || decodedPath.includes("\\") || decodedPath.includes("\0")) {
    return [];
  }

  const relativePagePath = decodedPath.slice(1);
  if (relativePagePath === "") {
    return [];
  }
  const segments = relativePagePath.split("/");
  return segments.every(isFileStoragePathSegment) ? segments : [];
}

function isFileStoragePathSegment(segment: string): boolean {
  return segment.length > 0
    && segment !== "."
    && segment !== ".."
    && !segment.startsWith(".")
    && !FILE_STORAGE_CONTROL_SEGMENTS.has(segment)
    && FILE_STORAGE_SEGMENT_PATTERN.test(segment);
}

function hasFileNameWithExtension(segment: string | undefined): boolean {
  if (segment === undefined || segment.startsWith(".")) {
    return false;
  }
  const extension = extname(segment);
  return extension.length > 1 && extension !== segment && !segment.endsWith(".");
}

async function writeStorageFile(
  rootPath: string,
  target: StorageFileTarget,
  contents: string | Uint8Array,
): Promise<boolean> {
  const tempPath = join(dirname(target.absolutePath), `.${basename(target.absolutePath)}.${crypto.randomUUID()}.tmp`);
  try {
    if (!await canWriteStorageFile(rootPath, target.absolutePath)) {
      return false;
    }
    await mkdir(dirname(target.absolutePath), { recursive: true });
    if (!await canWriteStorageFile(rootPath, target.absolutePath)) {
      return false;
    }
    await writeFile(tempPath, contents);
    await rename(tempPath, target.absolutePath);
    return true;
  } catch {
    await rm(tempPath, { force: true });
    return false;
  }
}

async function canWriteStorageFile(rootPath: string, filePath: string): Promise<boolean> {
  if (!isInsideRoot(rootPath, filePath)) {
    return false;
  }
  if (!await existingDirectoryChainIsSafe(rootPath, dirname(filePath))) {
    return false;
  }

  try {
    const stat = await lstat(filePath);
    return stat.isFile() && !stat.isSymbolicLink();
  } catch (error) {
    return isNotFoundError(error);
  }
}

async function existingDirectoryChainIsSafe(rootPath: string, directoryPath: string): Promise<boolean> {
  const rel = relative(rootPath, directoryPath);
  if (rel === "") {
    return true;
  }
  if (rel.startsWith("..") || isAbsolute(rel)) {
    return false;
  }

  let cursor = rootPath;
  for (const part of rel.split(sep)) {
    cursor = join(cursor, part);
    try {
      const stat = await lstat(cursor);
      if (!stat.isDirectory() || stat.isSymbolicLink()) {
        return false;
      }
    } catch (error) {
      if (isNotFoundError(error)) {
        return true;
      }
      throw error;
    }
  }
  return true;
}

function pagePathForPersistenceRequest(request: Request | undefined): string {
  if (request === undefined) {
    return "/";
  }
  try {
    return new URL(request.url).searchParams.get("page") ?? "/";
  } catch {
    return "/";
  }
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

function directoryRoutePath(rootPath: string, directoryPath: string): string {
  return directoryRouteBasePath(routePathFor(rootPath, directoryPath));
}

function directoryRouteBasePath(routePath: string): string {
  const normalized = normalizeRoutePath(routePath);
  return normalized === "/" ? "/" : `${normalized}/`;
}

function routePathWithBase(basePath: string, routePath: string): string {
  const routeIsDirectory = routePath.endsWith("/");
  const normalizedRoute = normalizeRoutePath(routePath);
  const routeSuffix = routeIsDirectory ? directoryRouteBasePath(normalizedRoute) : normalizedRoute;
  const normalizedBase = normalizeControlBasePath(basePath);
  if (normalizedBase === "") {
    return routeSuffix;
  }
  if (routeSuffix === "/") {
    return `${normalizedBase}/`;
  }
  return `${normalizedBase}${routeSuffix}`;
}

function normalizeControlBasePath(basePath: string | undefined): string {
  const normalized = normalizeRoutePath(basePath ?? "/");
  return normalized === "/" ? "" : normalized;
}

function normalizeRoutePath(routePath: string): string {
  if (!routePath.startsWith("/")) {
    routePath = `/${routePath}`;
  }
  while (routePath.length > 1 && routePath.endsWith("/")) {
    routePath = routePath.slice(0, -1);
  }
  return routePath;
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
  if (options.localStoragePersistence || typeof htmlImport === "string") {
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
    result = injectHeadScript(result, localStoragePersistenceClientScript(options.controlBasePath));
  }
  if (options.liveReload) {
    result = injectBodyScript(result, liveReloadClientScript(options.controlBasePath));
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

function localStoragePersistenceClientScript(controlBasePath = "/"): string {
  const endpoint = routePathWithBase(controlBasePath, LOCAL_STORAGE_ROUTE);
  const basePath = normalizeControlBasePath(controlBasePath);
  return `<script>
(() => {
  if (window.__WEB_APP_LOCAL_STORAGE__) return;
  const endpoint = ${JSON.stringify(endpoint)};
  const basePath = ${JSON.stringify(basePath)};
  const pagePath = () => {
    const pathname = window.location?.pathname || "/";
    if (basePath === "") return pathname || "/";
    if (pathname === basePath) return "/";
    if (pathname.startsWith(basePath + "/")) return pathname.slice(basePath.length) || "/";
    return "/";
  };
  const endpointForPage = () => endpoint + "?page=" + encodeURIComponent(pagePath());
  const items = new Map();
  const reservedProperties = new Set(["clear", "getItem", "key", "length", "removeItem", "setItem"]);
  let flushTimer = 0;
  let facade = null;

  const escapeHTML = (value) => String(value).replace(/[&<>"]/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
  })[character] || character);

  const failClosed = (message, cause) => {
    const error = cause instanceof Error ? cause : new Error(message);
    window.__WEB_APP_LOCAL_STORAGE_ERROR__ = error;
    try {
      window.stop();
    } catch {}
    try {
      const document = window.document;
      document.open();
      document.write(
        '<!doctype html><html lang="en"><head><meta charset="utf-8" />'
        + '<meta name="viewport" content="width=device-width, initial-scale=1" />'
        + '<title>Web storage error</title>'
        + '<style>body{margin:0;padding:2rem;font:14px system-ui,sans-serif;background:Canvas;color:CanvasText}'
        + 'main{max-width:48rem}pre{white-space:pre-wrap;border:1px solid color-mix(in oklch,CanvasText 18%,transparent);padding:1rem}</style>'
        + '</head><body><main><h1>Web storage could not start</h1><p>'
        + escapeHTML(message)
        + '</p><pre>'
        + escapeHTML(error.message || String(error))
        + '</pre></main></body></html>',
      );
      document.close();
    } catch {}
    throw error;
  };

  const snapshot = () => {
    const entries = [];
    for (const [key, value] of items) {
      entries.push([key, value]);
    }
    entries.sort((left, right) => left[0].localeCompare(right[0]));
    return JSON.stringify({ schema: 1, entries });
  };

  const flush = (keepalive = false) => {
    window.clearTimeout(flushTimer);
    const body = snapshot();
    if (keepalive && navigator.sendBeacon) {
      const blob = new Blob([body], { type: "application/json" });
      if (navigator.sendBeacon(endpointForPage(), blob)) return;
    }
    fetch(endpointForPage(), {
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

  const keyAt = (index) => {
    const numericIndex = Number(index);
    if (!Number.isFinite(numericIndex) || numericIndex < 0) return null;
    return Array.from(items.keys())[Math.trunc(numericIndex)] ?? null;
  };

  const getItem = (key) => items.get(String(key)) ?? null;
  const setItem = (key, value) => {
    items.set(String(key), String(value));
    scheduleFlush();
  };
  const removeItem = (key) => {
    items.delete(String(key));
    scheduleFlush();
  };
  const clear = () => {
    items.clear();
    scheduleFlush();
  };

  const hydrate = () => {
    const request = new XMLHttpRequest();
    request.open("GET", endpointForPage(), false);
    request.setRequestHeader("Accept", "application/json");
    request.send(null);
    if (request.status < 200 || request.status >= 300) {
      throw new Error("Storage route returned HTTP " + request.status + ".");
    }
    const payload = JSON.parse(request.responseText || '{"schema":1,"entries":[]}');
    if (payload?.schema !== 1 || !Array.isArray(payload.entries)) {
      throw new Error("Storage route returned an invalid snapshot.");
    }
    items.clear();
    for (const entry of payload.entries) {
      if (!Array.isArray(entry) || entry.length !== 2) {
        throw new Error("Storage route returned an invalid entry.");
      }
      items.set(String(entry[0]), String(entry[1]));
    }
  };

  try {
    hydrate();
  } catch (error) {
    failClosed("Web.app could not hydrate localStorage from its disk-backed source of truth.", error);
  }

  const target = {};
  Object.defineProperties(target, {
    length: {
      configurable: true,
      enumerable: false,
      get() {
        return items.size;
      },
    },
    key: {
      configurable: true,
      enumerable: false,
      writable: false,
      value(index) {
        return keyAt(index);
      },
    },
    getItem: {
      configurable: true,
      enumerable: false,
      writable: false,
      value(key) {
        return getItem(key);
      },
    },
    setItem: {
      configurable: true,
      enumerable: false,
      writable: false,
      value(key, value) {
        setItem(key, value);
      },
    },
    removeItem: {
      configurable: true,
      enumerable: false,
      writable: false,
      value(key) {
        removeItem(key);
      },
    },
    clear: {
      configurable: true,
      enumerable: false,
      writable: false,
      value() {
        clear();
      },
    },
  });

  const isFacadeReceiver = (receiver) => receiver === facade || receiver === target;

  try {
    if (typeof Storage === "function" && Storage.prototype) {
      Object.setPrototypeOf(target, Storage.prototype);
    }
  } catch {}

  facade = new Proxy(target, {
    get(target, property, receiver) {
      if (typeof property !== "string") {
        return Reflect.get(target, property, receiver);
      }
      if (Reflect.has(target, property)) {
        const value = Reflect.get(target, property, receiver);
        return typeof value === "function" ? value.bind(receiver) : value;
      }
      return items.has(property) ? items.get(property) : undefined;
    },
    set(target, property, value, receiver) {
      if (typeof property !== "string") {
        return Reflect.set(target, property, value, receiver);
      }
      if (reservedProperties.has(property) || Reflect.has(target, property)) {
        return Reflect.set(target, property, value, receiver);
      }
      setItem(property, value);
      return true;
    },
    deleteProperty(target, property) {
      if (typeof property !== "string" || reservedProperties.has(property) || Reflect.has(target, property)) {
        return false;
      }
      removeItem(property);
      return true;
    },
    has(target, property) {
      return typeof property === "string" && items.has(property) || Reflect.has(target, property);
    },
    ownKeys() {
      return Array.from(items.keys());
    },
    getOwnPropertyDescriptor(target, property) {
      if (typeof property === "string" && items.has(property)) {
        return {
          configurable: true,
          enumerable: true,
          value: items.get(property),
          writable: true,
        };
      }
      return Reflect.getOwnPropertyDescriptor(target, property);
    },
  });

  try {
    Object.defineProperty(window, "localStorage", {
      configurable: true,
      enumerable: true,
      get() {
        return facade;
      },
    });
  } catch (error) {
    failClosed("Web.app could not install its single-source localStorage facade.", error);
  }

  const patchStoragePrototype = () => {
    if (typeof Storage !== "function" || !Storage.prototype) return;
    const prototype = Storage.prototype;
    const originals = {
      clear: prototype.clear,
      getItem: prototype.getItem,
      key: prototype.key,
      removeItem: prototype.removeItem,
      setItem: prototype.setItem,
    };
    const callOriginal = (method, receiver, args) => {
      if (typeof method !== "function") {
        throw new TypeError("Illegal invocation");
      }
      return Reflect.apply(method, receiver, args);
    };
    try {
      Object.defineProperties(prototype, {
        getItem: {
          configurable: true,
          writable: true,
          value(key) {
            return isFacadeReceiver(this) ? getItem(key) : callOriginal(originals.getItem, this, arguments);
          },
        },
        setItem: {
          configurable: true,
          writable: true,
          value(key, value) {
            return isFacadeReceiver(this) ? setItem(key, value) : callOriginal(originals.setItem, this, arguments);
          },
        },
        removeItem: {
          configurable: true,
          writable: true,
          value(key) {
            return isFacadeReceiver(this) ? removeItem(key) : callOriginal(originals.removeItem, this, arguments);
          },
        },
        clear: {
          configurable: true,
          writable: true,
          value() {
            return isFacadeReceiver(this) ? clear() : callOriginal(originals.clear, this, arguments);
          },
        },
        key: {
          configurable: true,
          writable: true,
          value(index) {
            return isFacadeReceiver(this) ? keyAt(index) : callOriginal(originals.key, this, arguments);
          },
        },
      });
    } catch {}
  };
  patchStoragePrototype();

  const unsupportedStorageWarningKey = "appify:web:unsupported-storage-warning-seen";
  const warnUnsupportedStorage = (apiName) => {
    if (getItem(unsupportedStorageWarningKey) === "1") return;
    setItem(unsupportedStorageWarningKey, "1");
    flush(false);
    console.warn(
      "Web.app does not support " + apiName + " as document storage. "
      + "Use localStorage so Web.app can keep one disk-backed source of truth. "
      + "This warning is shown once per .web bundle.",
    );
  };

  const patchMethod = (prototype, methodName, apiName) => {
    if (!prototype || typeof prototype[methodName] !== "function") return;
    const original = prototype[methodName];
    try {
      Object.defineProperty(prototype, methodName, {
        configurable: true,
        writable: true,
        value(...args) {
          warnUnsupportedStorage(apiName);
          return Reflect.apply(original, this, args);
        },
      });
    } catch {}
  };

  const patchGetter = (prototype, propertyName, apiName) => {
    if (!prototype) return;
    const descriptor = Object.getOwnPropertyDescriptor(prototype, propertyName);
    if (!descriptor || !descriptor.configurable || typeof descriptor.get !== "function") return;
    try {
      Object.defineProperty(prototype, propertyName, {
        configurable: true,
        enumerable: descriptor.enumerable,
        get() {
          warnUnsupportedStorage(apiName);
          return descriptor.get.call(this);
        },
        set: typeof descriptor.set === "function"
          ? function setUnsupportedStorageProperty(value) {
            warnUnsupportedStorage(apiName);
            return descriptor.set.call(this, value);
          }
          : undefined,
      });
    } catch {}
  };

  const patchCookieAccess = () => {
    const patched = new Set();
    let prototype = window.document ? Object.getPrototypeOf(window.document) : null;
    while (prototype && prototype !== Object.prototype) {
      if (!patched.has(prototype)) {
        patchGetter(prototype, "cookie", "cookies");
        patched.add(prototype);
      }
      prototype = Object.getPrototypeOf(prototype);
    }
    if (typeof Document === "function") patchGetter(Document.prototype, "cookie", "cookies");
    if (typeof HTMLDocument === "function") patchGetter(HTMLDocument.prototype, "cookie", "cookies");
    if (typeof CookieStore === "function") {
      for (const methodName of ["delete", "get", "getAll", "set"]) {
        patchMethod(CookieStore.prototype, methodName, "cookies");
      }
    }
  };

  const patchUnsupportedStorageWarnings = () => {
    let nativeSessionStorage = null;
    try {
      nativeSessionStorage = window.sessionStorage;
    } catch {}
    patchGetter(window.Window?.prototype, "sessionStorage", "sessionStorage");
    if (typeof Storage === "function" && Storage.prototype) {
      for (const methodName of ["clear", "getItem", "key", "removeItem", "setItem"]) {
        const original = Storage.prototype[methodName];
        if (typeof original !== "function") continue;
        try {
          Object.defineProperty(Storage.prototype, methodName, {
            configurable: true,
            writable: true,
            value(...args) {
              if (nativeSessionStorage !== null && this === nativeSessionStorage) {
                warnUnsupportedStorage("sessionStorage");
              }
              return Reflect.apply(original, this, args);
            },
          });
        } catch {}
      }
    }

    if (typeof IDBFactory === "function") {
      for (const methodName of ["cmp", "databases", "deleteDatabase", "open"]) {
        patchMethod(IDBFactory.prototype, methodName, "IndexedDB");
      }
    }
    if (typeof IDBDatabase === "function") {
      for (const methodName of ["createObjectStore", "deleteObjectStore", "transaction"]) {
        patchMethod(IDBDatabase.prototype, methodName, "IndexedDB");
      }
    }
    if (typeof IDBObjectStore === "function") {
      for (const methodName of ["add", "clear", "delete", "put"]) {
        patchMethod(IDBObjectStore.prototype, methodName, "IndexedDB");
      }
    }

    if (typeof CacheStorage === "function") {
      for (const methodName of ["delete", "has", "keys", "match", "open"]) {
        patchMethod(CacheStorage.prototype, methodName, "CacheStorage");
      }
    }
    if (typeof Cache === "function") {
      for (const methodName of ["add", "addAll", "delete", "keys", "match", "matchAll", "put"]) {
        patchMethod(Cache.prototype, methodName, "CacheStorage");
      }
    }

    patchCookieAccess();

    patchGetter(window.Navigator?.prototype, "serviceWorker", "service worker storage");
    if (typeof ServiceWorkerContainer === "function") {
      for (const methodName of ["getRegistration", "getRegistrations", "register"]) {
        patchMethod(ServiceWorkerContainer.prototype, methodName, "service worker storage");
      }
    }

    patchGetter(window.Navigator?.prototype, "storage", "OPFS");
    if (typeof StorageManager === "function") {
      patchMethod(StorageManager.prototype, "getDirectory", "OPFS");
    }
    if (typeof FileSystemDirectoryHandle === "function") {
      for (const methodName of ["getDirectoryHandle", "getFileHandle", "removeEntry", "resolve"]) {
        patchMethod(FileSystemDirectoryHandle.prototype, methodName, "OPFS");
      }
    }
    if (typeof FileSystemFileHandle === "function") {
      for (const methodName of ["createSyncAccessHandle", "createWritable", "getFile"]) {
        patchMethod(FileSystemFileHandle.prototype, methodName, "OPFS");
      }
    }
  };
  patchUnsupportedStorageWarnings();

  window.__WEB_APP_LOCAL_STORAGE__ = true;
  window.addEventListener("pagehide", () => flush(true));
})();
</script>`;
}

function liveReloadClientScript(controlBasePath = "/"): string {
  const versionEndpoint = routePathWithBase(controlBasePath, "/_web/live-reload-version");
  const eventsEndpoint = routePathWithBase(controlBasePath, "/_web/live-reload");
  return `<script>
(() => {
  if (window.__WEB_APP_LIVE_RELOAD__) return;
  window.__WEB_APP_LIVE_RELOAD__ = true;
  const versionEndpoint = ${JSON.stringify(versionEndpoint)};
  const eventsEndpoint = ${JSON.stringify(eventsEndpoint)};
  const reload = () => location.reload();
  const poll = async () => {
    try {
      const response = await fetch(versionEndpoint, { cache: "no-store" });
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
    const source = new EventSource(eventsEndpoint);
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

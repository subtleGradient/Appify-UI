import { existsSync } from "node:fs";
import { lstat, mkdir, readFile, readdir, rename, rm, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { createServer } from "node:net";
import { homedir, tmpdir } from "node:os";
import { basename, dirname, extname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

export type ResolvedRequestPath =
  | { kind: "directory"; path: string }
  | { kind: "file"; path: string };

export type UnsupportedLegacyDynamicRequestPath = {
  path: string;
  extension: string;
  shadowPath: string;
};

export type RenderOptions = {
  liveReload?: boolean;
  localStoragePersistence?: boolean;
  controlBasePath?: string;
  controlToken?: string;
  postedRequest?: PostedRequestPayload;
  title?: string;
};

export type LocalStorageSnapshot = {
  schema: 1;
  entries: [string, string][];
};

export type PostedRequestPayload = {
  schema: 1;
  method: "POST";
  action: string;
  path: string;
  query: string;
  contentType: string;
  fields: [string, string][];
  files: PostedRequestFile[];
  text?: string;
  json?: unknown;
};

export type PostedRequestFile = {
  name: string;
  filename: string;
  type: string;
  size: number;
};

export type WebSpace = {
  documentPath: string;
  activeRootPath: string;
  webspaceRootPath: string;
  activeBasePath: string;
  webspaceKind: "git" | "sibling";
  mounts: WebSpaceMount[];
};

export type WebSpaceMount = {
  routeBasePath: string;
  rootPath: string;
  sourcePath: string;
  kind: "local" | "git";
};

export type ResolveWebSpaceOptions = {
  buildCommit?: string;
  remoteCacheRootPath?: string;
  templateRootPath?: string;
};

type PreparedWebDocument = {
  documentPath: string;
  activeRootPath: string;
  webspaceRootPath: string;
  activeBasePath: string;
  webspaceKind: "git" | "sibling";
  mounts: WebSpaceMount[];
};

type WebFileManifest = {
  $schema: string;
  web: 1;
  source: LocalWebFileSource | GitWebFileSource;
};

type LocalWebFileSource = {
  kind: "local";
  root: string;
};

type GitWebFileSource = {
  kind: "git";
  provider: "github";
  repo: string;
  commit: string;
  path: string;
};

type LocalStorageDiskSnapshot = {
  schema: 4;
  entries: LocalStorageDiskEntry[];
  files: LocalStorageFileEntry[];
};

type LocalStorageDiskEntry =
  | { key: string; value: string }
  | { key: string; json: unknown };

type LocalStorageFileEntry = {
  key: string;
  routePath: string;
  valueType: "text" | "data-url";
  mediaType?: string;
  encoding?: "base64" | "utf-8";
};

type LocalStoragePersistenceContext = {
  webspace: WebSpace;
  pagePath?: string | null;
  writableRoots?: LocalStorageWritableRoot[];
};

type StorageFileTarget = {
  absolutePath: string;
  routePath: string;
  writableRootPath: string;
};

type LocalStorageWritableRoot = {
  routeBasePath: string;
  rootPath: string;
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
const STORAGE_FILE_NAME = "storage.json5";
// Visible-origin port only: WebKit should store site state against
// *.localhost:55555 while AppifyHost routes traffic to an ephemeral backend.
const DEFAULT_STABLE_WEBSPACE_PORT = 55555;
const WEB_FILE_SCHEMA_PATH = "schema/web-file.schema.json";
const WEB_FILE_SCHEMA_REPOSITORY = "subtleGradient/Appify-UI";
const RUNNER_ROOT_PATH = dirname(dirname(fileURLToPath(import.meta.url)));
const DEFAULT_TEMPLATE_ROOT_PATH = join(RUNNER_ROOT_PATH, "templates", "Untitled.web");
const LEGACY_DYNAMIC_EXTENSIONS = new Set([".asp", ".aspx", ".cgi", ".jsp", ".php", ".pl"]);
const MAX_POST_BODY_BYTES = 1024 * 1024;
const MAX_POST_FIELD_BYTES = 64 * 1024;
const MAX_POST_FIELDS = 200;
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

export function stableWebSpaceHostname(webspaceRootPath: string): string {
  const root = resolve(webspaceRootPath);
  const rawName = basename(root).toLowerCase();
  const safeName = rawName
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48) || "webspace";
  const rootHash = createHash("sha256").update(root).digest("hex").slice(0, 8);
  return `${safeName}--${rootHash}.localhost`;
}

export function stableWebSpaceURL(webspace: Pick<WebSpace, "webspaceRootPath" | "activeBasePath">, port = DEFAULT_STABLE_WEBSPACE_PORT): URL {
  return new URL(webspace.activeBasePath, `http://${stableWebSpaceHostname(webspace.webspaceRootPath)}:${port}`);
}

export function defaultStableWebSpacePort(): number {
  return DEFAULT_STABLE_WEBSPACE_PORT;
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

export async function resolveWebSpace(
  documentPath: string,
  options: ResolveWebSpaceOptions = {},
): Promise<WebSpace> {
  const preparedDocument = await prepareWebDocument(documentPath, options);
  const peerMounts = await discoverWebFileMounts(preparedDocument.webspaceRootPath, preparedDocument, options);
  const mounts = dedupeWebSpaceMounts([...preparedDocument.mounts, ...peerMounts]);

  return {
    ...preparedDocument,
    mounts,
  };
}

async function prepareWebDocument(
  documentPath: string,
  options: ResolveWebSpaceOptions,
): Promise<PreparedWebDocument> {
  const stat = await lstat(documentPath);
  if (stat.isDirectory()) {
    if (await isEmptyDirectory(documentPath)) {
      await installUntitledWebTemplate(documentPath, options.templateRootPath ?? DEFAULT_TEMPLATE_ROOT_PATH);
    }
    const activeRootPath = await resolveServeRoot(documentPath);
    return preparedLocalRootDocument(documentPath, activeRootPath);
  }

  if (!stat.isFile()) {
    throw new Error(`${documentPath} must be a .web file or directory.`);
  }

  if (stat.size === 0) {
    await upgradeEmptyWebFile(documentPath, options);
  }

  const manifest = await readWebFileManifest(documentPath, options);
  return await preparedManifestDocument(documentPath, manifest, options);
}

async function preparedLocalRootDocument(
  documentPath: string,
  activeRootPath: string,
): Promise<PreparedWebDocument> {
  const gitRoot = await nearestProjectGitRoot(activeRootPath);
  const webspaceRootPath = gitRoot ?? fallbackWebspaceRoot(documentPath, activeRootPath);
  return {
    documentPath,
    activeRootPath,
    webspaceRootPath,
    activeBasePath: directoryRoutePath(webspaceRootPath, activeRootPath),
    webspaceKind: gitRoot === null ? "sibling" : "git",
    mounts: [],
  };
}

async function preparedManifestDocument(
  documentPath: string,
  manifest: WebFileManifest,
  options: ResolveWebSpaceOptions,
): Promise<PreparedWebDocument> {
  const documentDirectory = dirname(documentPath);
  const locationGitRoot = await nearestProjectGitRoot(documentDirectory);
  const localWebspaceRoot = locationGitRoot ?? documentDirectory;
  const localWebspaceKind = locationGitRoot === null ? "sibling" : "git";

  if (manifest.source.kind === "local") {
    const activeRootPath = await resolveLocalManifestRoot(documentPath, manifest.source);
    const activeGitRoot = await nearestProjectGitRoot(activeRootPath);
    const webspaceRootPath = activeGitRoot ?? localWebspaceRoot;
    return {
      documentPath,
      activeRootPath,
      webspaceRootPath,
      activeBasePath: directoryRoutePath(webspaceRootPath, activeRootPath),
      webspaceKind: activeGitRoot === null ? localWebspaceKind : "git",
      mounts: [webFileMountForManifest(webspaceRootPath, documentPath, activeRootPath, "local")],
    };
  }

  const activeRootPath = await materializeGitWebSource(manifest.source, options);
  const activeBasePath = directoryRouteBasePath(routePathFor(localWebspaceRoot, documentPath));
  return {
    documentPath,
    activeRootPath,
    webspaceRootPath: localWebspaceRoot,
    activeBasePath,
    webspaceKind: localWebspaceKind,
    mounts: [{
      routeBasePath: activeBasePath,
      rootPath: activeRootPath,
      sourcePath: documentPath,
      kind: "git",
    }],
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

async function upgradeEmptyWebFile(documentPath: string, options: ResolveWebSpaceOptions): Promise<void> {
  const buildCommit = await resolveWebBuildCommit(options);
  const root = await defaultLocalManifestRoot(documentPath);
  const manifest = `{
  "$schema": ${JSON.stringify(webFileSchemaURL(buildCommit))},
  web: 1,
  source: {
    kind: "local",
    root: ${JSON.stringify(root)},
  },
}
`;
  const tempPath = `${documentPath}.${crypto.randomUUID()}.tmp`;
  try {
    await writeFile(tempPath, manifest, { flag: "wx" });
    await rename(tempPath, documentPath);
  } catch (error) {
    await rm(tempPath, { force: true });
    throw error;
  }
}

async function defaultLocalManifestRoot(documentPath: string): Promise<string> {
  const documentDirectory = dirname(documentPath);
  const gitRoot = await nearestProjectGitRoot(documentDirectory);
  if (gitRoot === null) {
    return "./";
  }

  const rel = relative(gitRoot, documentDirectory).split(sep).filter(Boolean).join("/");
  return rel === "" ? "@/" : `@/${rel}`;
}

async function installUntitledWebTemplate(documentPath: string, templateRootPath: string): Promise<void> {
  if (!await pathExists(templateRootPath)) {
    throw new Error(`Web starter template is missing: ${templateRootPath}`);
  }
  if (!await isEmptyDirectory(documentPath)) {
    throw new Error(`${documentPath} is no longer empty.`);
  }

  await copyTemplateDirectory(templateRootPath, documentPath);
}

async function copyTemplateDirectory(sourcePath: string, targetPath: string): Promise<void> {
  const entries = await readdir(sourcePath, { withFileTypes: true });
  for (const entry of entries) {
    const sourceEntryPath = join(sourcePath, entry.name);
    const targetEntryPath = join(targetPath, entry.name);
    if (entry.isSymbolicLink()) {
      throw new Error(`Web starter template must not contain symlinks: ${sourceEntryPath}`);
    }
    if (entry.isDirectory()) {
      await mkdir(targetEntryPath, { recursive: false });
      await copyTemplateDirectory(sourceEntryPath, targetEntryPath);
      continue;
    }
    if (entry.isFile()) {
      await writeFile(targetEntryPath, await readFile(sourceEntryPath), { flag: "wx" });
      continue;
    }
    throw new Error(`Web starter template contains unsupported entry: ${sourceEntryPath}`);
  }
}

async function readWebFileManifest(
  manifestPath: string,
  options: ResolveWebSpaceOptions,
): Promise<WebFileManifest> {
  const value = await parseJson5File(manifestPath);
  return await normalizeWebFileManifest(value, options);
}

async function parseJson5File(filePath: string): Promise<unknown> {
  const tempRoot = join(tmpdir(), `web-manifest-${crypto.randomUUID()}`);
  const tempPath = join(tempRoot, "manifest.json5");
  await mkdir(tempRoot, { recursive: true });
  try {
    await writeFile(tempPath, await readFile(filePath, "utf8"));
    const module = await import(`${pathToFileURL(tempPath).href}?v=${crypto.randomUUID()}`);
    return module.default;
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
}

async function normalizeWebFileManifest(
  value: unknown,
  options: ResolveWebSpaceOptions,
): Promise<WebFileManifest> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(".web manifest must be an object.");
  }
  const manifest = value as { $schema?: unknown; web?: unknown; source?: unknown };
  const buildCommit = await resolveWebBuildCommit(options);
  const expectedSchemaURL = webFileSchemaURL(buildCommit);
  if (manifest.$schema !== expectedSchemaURL) {
    throw new Error(`.web manifest $schema must be ${expectedSchemaURL}.`);
  }
  if (manifest.web !== 1) {
    throw new Error(".web manifest web must be 1.");
  }
  return {
    $schema: manifest.$schema,
    web: 1,
    source: normalizeWebFileSource(manifest.source),
  };
}

function normalizeWebFileSource(value: unknown): LocalWebFileSource | GitWebFileSource {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(".web manifest source must be an object.");
  }
  const source = value as {
    kind?: unknown;
    root?: unknown;
    provider?: unknown;
    repo?: unknown;
    commit?: unknown;
    path?: unknown;
  };

  if (source.kind === "local") {
    if (typeof source.root !== "string" || !isSafeLocalManifestRoot(source.root)) {
      throw new Error('.web local source root must start with "@/"; or "./".');
    }
    return { kind: "local", root: source.root };
  }

  if (source.kind === "git") {
    if (source.provider !== "github") {
      throw new Error('.web git source provider must be "github".');
    }
    if (typeof source.repo !== "string" || !isSafeGitHubRepoSlug(source.repo)) {
      throw new Error(".web git source repo must be an owner/repo slug.");
    }
    if (typeof source.commit !== "string" || !isFullGitCommit(source.commit)) {
      throw new Error(".web git source commit must be a full 40-character SHA.");
    }
    if (typeof source.path !== "string" || !isSafeGitSourcePath(source.path)) {
      throw new Error(".web git source path must be a safe repository-relative path.");
    }
    return {
      kind: "git",
      provider: "github",
      repo: source.repo,
      commit: source.commit.toLowerCase(),
      path: source.path,
    };
  }

  throw new Error('.web manifest source kind must be "local" or "git".');
}

function isSafeLocalManifestRoot(value: string): boolean {
  if (value.includes("\0") || value.includes("\\") || value.includes("//")) {
    return false;
  }
  if (value === "@/" || value.startsWith("@/")) {
    return safeManifestPathSegments(value.slice(2));
  }
  if (value === "./" || value.startsWith("./")) {
    return safeManifestPathSegments(value.slice(2));
  }
  return false;
}

function isSafeGitSourcePath(value: string): boolean {
  if (value === ".") {
    return true;
  }
  if (value.length === 0 || value.startsWith("/") || value.includes("\0") || value.includes("\\") || value.includes("//")) {
    return false;
  }
  return safeManifestPathSegments(value);
}

function isSafeGitHubRepoSlug(value: string): boolean {
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(value)) {
    return false;
  }
  return value.split("/").every((part) => (
    part.length > 0
    && part !== "."
    && part !== ".."
    && !part.startsWith(".")
  ));
}

function safeManifestPathSegments(value: string): boolean {
  if (value === "") {
    return true;
  }
  return value.split("/").every((segment) => (
    segment.length > 0
    && segment !== "."
    && segment !== ".."
    && !SKIPPED_DIRECTORIES.has(segment)
  ));
}

async function resolveLocalManifestRoot(manifestPath: string, source: LocalWebFileSource): Promise<string> {
  const documentDirectory = dirname(manifestPath);
  const gitRoot = await nearestProjectGitRoot(documentDirectory);
  const anchor = source.root.startsWith("@/") ? gitRoot : documentDirectory;
  if (anchor === null) {
    throw new Error('.web local source root uses "@/" but no project git root was found.');
  }

  const suffix = source.root.slice(2);
  const activeRootPath = suffix === "" ? anchor : resolve(anchor, ...suffix.split("/"));
  if (!isInsideRoot(anchor, activeRootPath)) {
    throw new Error(".web local source root must stay inside its anchor.");
  }
  if (!await pathExists(activeRootPath) || !await assertNoSymlinkAlongPath(anchor, activeRootPath)) {
    throw new Error(`.web local source root does not exist or is unsafe: ${source.root}`);
  }
  const stat = await lstat(activeRootPath);
  if (!stat.isDirectory()) {
    throw new Error(`.web local source root must be a directory: ${source.root}`);
  }
  return activeRootPath;
}

async function materializeGitWebSource(
  source: GitWebFileSource,
  options: ResolveWebSpaceOptions,
): Promise<string> {
  const checkoutRoot = join(remoteWebCacheRoot(options), "github", ...source.repo.split("/"), source.commit);
  const readyPath = join(checkoutRoot, ".web-ready");
  const sourceRoot = source.path === "." ? checkoutRoot : join(checkoutRoot, ...source.path.split("/"));
  if (await pathExists(readyPath)) {
    await assertMaterializedGitSource(checkoutRoot, sourceRoot, source);
    return sourceRoot;
  }

  await mkdir(dirname(checkoutRoot), { recursive: true });
  const tempRoot = `${checkoutRoot}.${crypto.randomUUID()}.tmp`;
  await rm(tempRoot, { recursive: true, force: true });
  await mkdir(tempRoot, { recursive: true });
  try {
    await runGit(["init"], tempRoot);
    await runGit(["remote", "add", "origin", `https://github.com/${source.repo}.git`], tempRoot);
    await runGit(["fetch", "--depth=1", "origin", source.commit], tempRoot);
    await runGit(["checkout", "--detach", "FETCH_HEAD"], tempRoot);
    const tempSourceRoot = source.path === "." ? tempRoot : join(tempRoot, ...source.path.split("/"));
    await assertMaterializedGitSource(tempRoot, tempSourceRoot, source);
    await writeFile(join(tempRoot, ".web-ready"), `${source.repo}\n${source.commit}\n${source.path}\n`);
    await rm(checkoutRoot, { recursive: true, force: true });
    await rename(tempRoot, checkoutRoot);
  } catch (error) {
    await rm(tempRoot, { recursive: true, force: true });
    throw error;
  }

  return sourceRoot;
}

async function assertMaterializedGitSource(
  checkoutRoot: string,
  sourceRoot: string,
  source: GitWebFileSource,
): Promise<void> {
  const checkoutStat = await lstat(checkoutRoot);
  if (!checkoutStat.isDirectory() || checkoutStat.isSymbolicLink()) {
    throw new Error(".web git source cache root must be a real directory.");
  }
  const stat = await lstat(sourceRoot).catch((error) => {
    if (isNotFoundError(error)) {
      throw new Error(`.web git source path does not exist in ${source.repo}@${source.commit}: ${source.path}`);
    }
    throw error;
  });
  if (!stat.isDirectory()) {
    throw new Error(`.web git source path must be a directory: ${source.path}`);
  }
  if (!await assertNoSymlinkAlongPath(checkoutRoot, sourceRoot)) {
    throw new Error(`.web git source path must not traverse symlinks: ${source.path}`);
  }
}

function remoteWebCacheRoot(options: ResolveWebSpaceOptions): string {
  return options.remoteCacheRootPath
    ?? process.env.WEB_APP_REMOTE_CACHE_DIR
    ?? join(process.env.XDG_CACHE_HOME ?? join(homedir(), "Library", "Caches"), "Appify-UI", "Web", "RemoteWeb");
}

async function runGit(args: string[], cwd: string): Promise<void> {
  const process = Bun.spawn(["git", ...args], {
    cwd,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [exitCode, stderr] = await Promise.all([
    process.exited,
    new Response(process.stderr).text(),
  ]);
  if (exitCode !== 0) {
    throw new Error(`git ${args.join(" ")} failed: ${stderr.trim()}`);
  }
}

async function resolveWebBuildCommit(options: ResolveWebSpaceOptions = {}): Promise<string> {
  if (options.buildCommit !== undefined) {
    return assertFullGitCommit(options.buildCommit, "configured Web.app build commit");
  }
  if (process.env.WEB_APP_BUILD_COMMIT !== undefined && process.env.WEB_APP_BUILD_COMMIT.trim() !== "") {
    return assertFullGitCommit(process.env.WEB_APP_BUILD_COMMIT.trim(), "WEB_APP_BUILD_COMMIT");
  }

  const buildInfoCommit = await readBuildInfoCommit();
  if (buildInfoCommit !== null) {
    return buildInfoCommit;
  }

  return await gitSchemaCommit();
}

async function readBuildInfoCommit(): Promise<string | null> {
  try {
    const value = JSON.parse(await readFile(join(RUNNER_ROOT_PATH, "build-info.json"), "utf8"));
    if (typeof value?.commit === "string" && value.commit.trim() !== "") {
      return assertFullGitCommit(value.commit.trim(), "Web.app build-info commit");
    }
  } catch (error) {
    if (!isNotFoundError(error)) {
      throw error;
    }
  }
  return null;
}

async function gitSchemaCommit(): Promise<string> {
  const process = Bun.spawn(["git", "log", "-1", "--format=%H", "--", WEB_FILE_SCHEMA_PATH], {
    cwd: RUNNER_ROOT_PATH,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [exitCode, stdout, stderr] = await Promise.all([
    process.exited,
    new Response(process.stdout).text(),
    new Response(process.stderr).text(),
  ]);
  if (exitCode !== 0) {
    throw new Error(`Could not resolve Web.app schema commit: ${stderr.trim() || "git log failed"}`);
  }
  return assertFullGitCommit(stdout.trim(), "local Web.app schema commit");
}

function webFileSchemaURL(buildCommit: string): string {
  return `https://cdn.jsdelivr.net/gh/${WEB_FILE_SCHEMA_REPOSITORY}@${buildCommit}/Web.app/Contents/Resources/Runner/${WEB_FILE_SCHEMA_PATH}`;
}

export function webFileSchemaURLForBuildCommit(buildCommit: string): string {
  return webFileSchemaURL(assertFullGitCommit(buildCommit, "Web.app build commit"));
}

function assertFullGitCommit(value: string, label: string): string {
  if (!isFullGitCommit(value)) {
    throw new Error(`${label} must be a full 40-character git commit SHA.`);
  }
  return value.toLowerCase();
}

function isFullGitCommit(value: string): boolean {
  return /^[0-9a-f]{40}$/i.test(value);
}

function webFileMountForManifest(
  webspaceRootPath: string,
  manifestPath: string,
  rootPath: string,
  kind: WebSpaceMount["kind"],
): WebSpaceMount {
  return {
    routeBasePath: directoryRouteBasePath(routePathFor(webspaceRootPath, manifestPath)),
    rootPath,
    sourcePath: manifestPath,
    kind,
  };
}

async function discoverWebFileMounts(
  rootPath: string,
  preparedDocument: PreparedWebDocument,
  options: ResolveWebSpaceOptions,
): Promise<WebSpaceMount[]> {
  if (!await pathExists(rootPath)) {
    return [];
  }

  const mounts: WebSpaceMount[] = [];
  async function walk(directory: string): Promise<void> {
    const entries = await readdir(directory, { withFileTypes: true }).catch((error) => {
      if (isNotFoundError(error)) {
        return [];
      }
      throw error;
    });
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
      if (!entry.isFile() || extname(entry.name).toLowerCase() !== ".web") {
        continue;
      }
      if (entryPath === preparedDocument.documentPath) {
        continue;
      }

      const stat = await lstat(entryPath);
      if (stat.size === 0) {
        continue;
      }
      try {
        const manifest = await readWebFileManifest(entryPath, options);
        if (manifest.source.kind === "local") {
          mounts.push(webFileMountForManifest(
            rootPath,
            entryPath,
            await resolveLocalManifestRoot(entryPath, manifest.source),
            "local",
          ));
        } else {
          mounts.push(webFileMountForManifest(
            rootPath,
            entryPath,
            await materializeGitWebSource(manifest.source, options),
            "git",
          ));
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        console.warn(`Skipping .web peer manifest ${entryPath}: ${message}`);
      }
    }
  }

  await walk(rootPath);
  return mounts.filter((mount) => mount.sourcePath !== preparedDocument.documentPath);
}

function dedupeWebSpaceMounts(mounts: WebSpaceMount[]): WebSpaceMount[] {
  const seen = new Set<string>();
  const result: WebSpaceMount[] = [];
  for (const mount of mounts) {
    if (seen.has(mount.routeBasePath)) {
      continue;
    }
    seen.add(mount.routeBasePath);
    result.push(mount);
  }
  return result.sort((left, right) => right.routeBasePath.length - left.routeBasePath.length);
}

export async function resolveLocalStorageFilePath(documentPath: string): Promise<string> {
  const stat = await lstat(documentPath);
  if (stat.isDirectory()) {
    return join(documentPath, LOCAL_DIRECTORY, STORAGE_FILE_NAME);
  }
  if (stat.isFile()) {
    return join(dirname(documentPath), LOCAL_DIRECTORY, STORAGE_FILE_NAME);
  }

  throw new Error(`${documentPath} must be a .web file or directory.`);
}

export function resolveWebSpaceLocalStorageFilePath(webspace: Pick<WebSpace, "webspaceRootPath">): string {
  return join(webspace.webspaceRootPath, LOCAL_DIRECTORY, STORAGE_FILE_NAME);
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
  const decodedPath = safeDecodedRequestPath(requestPath);
  if (decodedPath === null) {
    return null;
  }

  const candidate = requestFileCandidate(rootPath, decodedPath);
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

function requestFileCandidate(rootPath: string, decodedPath: string): string {
  if (LEGACY_DYNAMIC_EXTENSIONS.has(extname(decodedPath).toLowerCase())) {
    return resolve(rootPath, `.${decodedPath}.html`);
  }
  return resolve(rootPath, `.${decodedPath}`);
}

function safeDecodedRequestPath(requestPath: string): string | null {
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
  return decodedPath;
}

export async function resolveWebSpaceRequestPath(
  webspace: WebSpace,
  requestPath: string,
): Promise<ResolvedRequestPath | null> {
  const mountedPath = await resolveMountedWebSpaceRequestPath(webspace, requestPath);
  if (mountedPath !== null) {
    return mountedPath;
  }

  const resolvedPath = await resolveRequestPath(webspace.webspaceRootPath, requestPath);
  if (resolvedPath === null) {
    return null;
  }
  if (!isReadableWebSpacePath(webspace, resolvedPath.path)) {
    return null;
  }
  return resolvedPath;
}

export function webSpaceRouteRootPath(webspace: WebSpace, requestPath: string): string {
  return webSpaceMountForRequestPath(webspace, requestPath)?.rootPath ?? webspace.webspaceRootPath;
}

async function resolveMountedWebSpaceRequestPath(
  webspace: WebSpace,
  requestPath: string,
): Promise<ResolvedRequestPath | null> {
  const match = webSpaceMountRequestMatch(webspace, requestPath);
  if (match === null) {
    return null;
  }
  return await resolveRequestPath(match.mount.rootPath, match.mountRequestPath);
}

function webSpaceMountForRequestPath(webspace: WebSpace, requestPath: string): WebSpaceMount | null {
  return webSpaceMountRequestMatch(webspace, requestPath)?.mount ?? null;
}

function webSpaceMountRequestMatch(
  webspace: WebSpace,
  requestPath: string,
): { mount: WebSpaceMount; mountRequestPath: string } | null {
  const path = requestPath.startsWith("/") ? requestPath : `/${requestPath}`;
  for (const mount of webspace.mounts) {
    const routeBasePath = directoryRouteBasePath(mount.routeBasePath);
    const routeBasePathWithoutSlash = routeBasePath.slice(0, -1);
    if (path === routeBasePath || path === routeBasePathWithoutSlash) {
      return { mount, mountRequestPath: "/" };
    }
    if (path.startsWith(routeBasePath)) {
      return { mount, mountRequestPath: `/${path.slice(routeBasePath.length)}` };
    }
  }
  return null;
}

export async function resolveUnsupportedLegacyDynamicRequestPath(
  webspace: WebSpace,
  requestPath: string,
): Promise<UnsupportedLegacyDynamicRequestPath | null> {
  const decodedPath = safeDecodedRequestPath(requestPath);
  if (decodedPath === null) {
    return null;
  }

  const extension = extname(decodedPath).toLowerCase();
  if (!LEGACY_DYNAMIC_EXTENSIONS.has(extension)) {
    return null;
  }

  const candidate = resolve(webspace.webspaceRootPath, `.${decodedPath}`);
  if (!isInsideRoot(webspace.webspaceRootPath, candidate)) {
    return null;
  }
  if (!(await pathExists(candidate)) || !(await assertNoSymlinkAlongPath(webspace.webspaceRootPath, candidate))) {
    return null;
  }
  if (!isReadableWebSpacePath(webspace, candidate)) {
    return null;
  }

  const stat = await lstat(candidate);
  if (!stat.isFile()) {
    return null;
  }

  return {
    path: candidate,
    extension,
    shadowPath: resolve(webspace.webspaceRootPath, `.${decodedPath}.html`),
  };
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
  options: Pick<RenderOptions, "localStoragePersistence" | "controlBasePath" | "controlToken"> & { routeBasePath?: string } = {},
): Promise<Record<string, unknown>> {
  const routes: Record<string, unknown> = {};
  const aliasTargets = preferredDirectoryAliasTargets(rootPath, htmlPages);
  const routeBasePath = options.routeBasePath ?? "/";

  const registerPageRoute = (pagePath: string, routeValue: unknown) => {
    routes[routePathWithBase(routeBasePath, routePathFor(rootPath, pagePath))] = routeValue;

    const alias = directoryAliasForIndex(rootPath, pagePath);
    if (alias !== null && aliasTargets.get(alias) === pagePath) {
      routes[routePathWithBase(routeBasePath, alias)] = routeValue;
    }
    if (rootEntry === pagePath) {
      routes[directoryRouteBasePath(routeBasePath)] = routeValue;
    }
  };

  for (const pagePath of htmlPages) {
    const renderOptions = {
      liveReload: hmrEnabled,
      localStoragePersistence: options.localStoragePersistence,
      controlBasePath: options.controlBasePath,
      controlToken: options.controlToken,
    };
    try {
      const htmlImport = (await import(pathToFileURL(pagePath).href)).default;
      registerPageRoute(pagePath, htmlRouteValue(pagePath, htmlImport, renderOptions));
    } catch (error) {
      console.error(`Could not register ${pagePath} as a Bun HTML route:`, error);
      registerPageRoute(pagePath, htmlRouteValue(pagePath, "", renderOptions));
    }
  }

  return routes;
}

export async function readFileResponse(filePath: string, options: RenderOptions = {}): Promise<Response> {
  let body: BodyInit = Bun.file(filePath);
  let contentType = contentTypeFor(filePath);

  if ((options.liveReload || options.localStoragePersistence || options.postedRequest) && isHtmlFile(filePath)) {
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
      options.controlToken,
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
    ${options.localStoragePersistence ? localStoragePersistenceClientScript(options.controlBasePath, options.controlToken) : ""}
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
  controlToken?: string,
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
    ${localStoragePersistence ? localStoragePersistenceClientScript(controlBasePath, controlToken) : ""}
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
    const diskSnapshot = normalizeLocalStorageDiskSnapshot(await parseJson5File(storageFilePath));
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
  const existing = await readLocalStorageDiskSnapshotIfExists(storageFilePath);
  const snapshotKeys = new Set(normalized.entries.map(([key]) => key));
  const touchedRoutePaths = new Set<string>();
  const entries: LocalStorageDiskEntry[] = [];
  const files: LocalStorageFileEntry[] = [];
  for (const [key, value] of sortedLocalStorageEntries(normalized.entries)) {
    if (context !== undefined) {
      const target = await resolveStorageFileTarget(context, key);
      if (target !== null) {
        touchedRoutePaths.add(target.routePath);
        const valueWrite = storageFileValueFor(value);
        if (valueWrite !== null && await writeStorageFile(target, valueWrite.contents)) {
          files.push({
            key,
            routePath: target.routePath,
            ...valueWrite.fileEntry,
          });
          continue;
        }
      }
    }

    entries.push(localStorageDiskEntryFor(key, value));
  }

  if (context !== undefined && existing !== null) {
    for (const fileEntry of existing.files) {
      if (touchedRoutePaths.has(fileEntry.routePath)) {
        continue;
      }
      if (await localStorageFileEntryIsVisibleInContext(fileEntry, context) && !snapshotKeys.has(fileEntry.key)) {
        continue;
      }
      files.push(fileEntry);
    }
  }

  if (entries.length === 0 && files.length === 0) {
    await rm(storageFilePath, { force: true });
    return;
  }

  await mkdir(dirname(storageFilePath), { recursive: true });
  const diskSnapshot: LocalStorageDiskSnapshot = { schema: 4, entries, files: sortedLocalStorageFileEntries(files) };
  const tempPath = `${storageFilePath}.${crypto.randomUUID()}.tmp`;
  await writeFile(tempPath, `${JSON.stringify(diskSnapshot, null, 2)}\n`);
  await rename(tempPath, storageFilePath);
}

export function createLocalStoragePersistenceRoutes(
  storageFilePath: string,
  webspace: WebSpace | string,
  controlBasePath = "/",
  controlToken?: string,
): Record<string, unknown> {
  const resolvedWebspace = typeof webspace === "string" ? rootOnlyWebSpace(webspace) : webspace;
  const routePath = routePathWithBase(controlBasePath, LOCAL_STORAGE_ROUTE);
  return {
    [routePath]: {
      async GET(request?: Request) {
        try {
          assertAllowedControlRequest(request, controlToken);
          return Response.json(
            await readLocalStorageSnapshot(storageFilePath, await localStoragePersistenceContext(resolvedWebspace, request)),
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
          assertAllowedControlRequest(request, controlToken);
          await writeLocalStorageSnapshot(
            storageFilePath,
            await request.json(),
            await localStoragePersistenceContext(resolvedWebspace, request),
          );
          return new Response(null, { status: 204 });
        } catch (error) {
          return new Response(String(error), { status: 400 });
        }
      },
    },
  };
}

function rootOnlyWebSpace(rootPath: string): WebSpace {
  const resolvedRootPath = resolve(rootPath);
  return {
    documentPath: resolvedRootPath,
    activeRootPath: resolvedRootPath,
    webspaceRootPath: resolvedRootPath,
    activeBasePath: "/",
    webspaceKind: "sibling",
    mounts: [],
  };
}

export async function createPostedRequestPayload(request: Request): Promise<PostedRequestPayload> {
  const method = request.method.toUpperCase();
  if (method !== "POST") {
    throw new Error(`Expected POST, got ${request.method}.`);
  }

  assertPostContentLength(request);
  const url = new URL(request.url);
  assertSameOriginPostRequest(request, url);
  const contentType = request.headers.get("Content-Type") ?? "";
  const mediaType = contentType.split(";", 1)[0]?.trim().toLowerCase() ?? "";
  const payload: PostedRequestPayload = {
    schema: 1,
    method: "POST",
    action: `${url.pathname}${url.search}`,
    path: url.pathname,
    query: url.search.startsWith("?") ? url.search.slice(1) : url.search,
    contentType,
    fields: [],
    files: [],
  };

  if (mediaType === "application/x-www-form-urlencoded" || mediaType === "multipart/form-data") {
    const formData = await request.formData();
    for (const [name, value] of formData) {
      assertPostFieldCount(payload);
      if (typeof value === "string") {
        assertPostFieldSize(name, value);
        payload.fields.push([name, value]);
        continue;
      }

      payload.files.push({
        name,
        filename: value.name,
        type: value.type,
        size: value.size,
      });
    }
    return payload;
  }

  if (mediaType === "application/json") {
    const text = await limitedRequestText(request);
    payload.text = text;
    try {
      payload.json = JSON.parse(text);
    } catch {
      // Keep malformed JSON visible as text; page code can decide what to do.
    }
    return payload;
  }

  if (mediaType === "" || mediaType.startsWith("text/")) {
    payload.text = await limitedRequestText(request);
  }
  return payload;
}

function assertSameOriginPostRequest(request: Request, url: URL): void {
  const origin = request.headers.get("Origin");
  if (origin !== null && origin !== url.origin) {
    throw new Error("POST submissions must be same-origin.");
  }

  const fetchSite = request.headers.get("Sec-Fetch-Site")?.toLowerCase();
  if (fetchSite === "cross-site") {
    throw new Error("Cross-site POST submissions are not accepted.");
  }
}

function assertPostContentLength(request: Request): void {
  const value = request.headers.get("Content-Length");
  if (value === null || value.trim() === "") {
    return;
  }

  const length = Number(value);
  if (!Number.isFinite(length) || length < 0) {
    throw new Error("POST Content-Length must be a valid non-negative number.");
  }
  if (length > MAX_POST_BODY_BYTES) {
    throw new Error(`POST body is too large. Limit is ${MAX_POST_BODY_BYTES} bytes.`);
  }
}

async function limitedRequestText(request: Request): Promise<string> {
  const buffer = await request.arrayBuffer();
  if (buffer.byteLength > MAX_POST_BODY_BYTES) {
    throw new Error(`POST body is too large. Limit is ${MAX_POST_BODY_BYTES} bytes.`);
  }
  const text = new TextDecoder().decode(buffer);
  assertPostFieldSize("text", text);
  return text;
}

function assertPostFieldCount(payload: PostedRequestPayload): void {
  if (payload.fields.length + payload.files.length >= MAX_POST_FIELDS) {
    throw new Error(`POST form has too many fields. Limit is ${MAX_POST_FIELDS}.`);
  }
}

function assertPostFieldSize(name: string, value: string): void {
  if (new TextEncoder().encode(value).byteLength > MAX_POST_FIELD_BYTES) {
    throw new Error(`POST field ${JSON.stringify(name)} is too large. Limit is ${MAX_POST_FIELD_BYTES} bytes.`);
  }
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
      const target = await resolveStorageFileTarget(context, fileEntry.key);
      if (target === null || target.routePath !== fileEntry.routePath) {
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
  if (snapshot.schema !== 3 && snapshot.schema !== 4) {
    throw new Error("localStorage disk snapshot schema must be 4.");
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
      routePath?: unknown;
      valueType?: unknown;
      mediaType?: unknown;
      encoding?: unknown;
    };
    const routePath = snapshot.schema === 3
      ? (typeof fileEntry.path === "string" ? `/${fileEntry.path}` : null)
      : (typeof fileEntry.routePath === "string" ? fileEntry.routePath : null);
    if (typeof fileEntry.key !== "string" || routePath === null || !isSafeStoredRoutePath(routePath)) {
      throw new Error("localStorage disk snapshot file entries must include string keys and route paths.");
    }
    if (fileEntry.valueType !== "text" && fileEntry.valueType !== "data-url") {
      throw new Error("localStorage disk snapshot file entries must include a known valueType.");
    }

    if (fileEntry.valueType === "text") {
      files.push({
        key: fileEntry.key,
        routePath,
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
      routePath,
      valueType: "data-url",
      mediaType: fileEntry.mediaType,
      encoding: fileEntry.encoding,
    });
  }

  return { schema: 4, entries, files };
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

function storageFileValueFor(value: string): {
  contents: string | Uint8Array;
  fileEntry: Omit<LocalStorageFileEntry, "key" | "routePath">;
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
  fileEntry: Omit<LocalStorageFileEntry, "key" | "routePath">;
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

async function resolveStorageFileTarget(
  context: LocalStoragePersistenceContext,
  key: string,
): Promise<StorageFileTarget | null> {
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

  const routePath = storageRoutePathForSegments(segments);
  const writableRoot = writableRootForStorageRoutePath(
    context.writableRoots ?? await localStorageWritableRoots(context.webspace),
    routePath,
  );
  if (writableRoot === null) {
    return null;
  }

  const suffix = storageRoutePathSuffixSegments(routePath, writableRoot.routeBasePath);
  if (suffix === null) {
    return null;
  }

  const absolutePath = resolve(writableRoot.rootPath, ...suffix);
  if (!isInsideRoot(writableRoot.rootPath, absolutePath)) {
    return null;
  }
  return { absolutePath, routePath, writableRootPath: writableRoot.rootPath };
}

function storageRoutePathForSegments(segments: string[]): string {
  return `/${segments.join("/")}`;
}

function writableRootForStorageRoutePath(
  writableRoots: LocalStorageWritableRoot[],
  routePath: string,
): LocalStorageWritableRoot | null {
  const normalizedRoutePath = normalizeStorageRoutePath(routePath);
  for (const writableRoot of writableRoots) {
    const basePath = directoryStorageRouteBasePath(writableRoot.routeBasePath);
    if (basePath === "/") {
      return writableRoot;
    }
    const baseWithoutSlash = basePath.slice(0, -1);
    if (normalizedRoutePath === baseWithoutSlash || normalizedRoutePath.startsWith(basePath)) {
      return writableRoot;
    }
  }
  return null;
}

function storageRoutePathSuffixSegments(routePath: string, routeBasePath: string): string[] | null {
  const normalizedRoutePath = normalizeStorageRoutePath(routePath);
  const basePath = directoryStorageRouteBasePath(routeBasePath);
  const suffix = basePath === "/"
    ? normalizedRoutePath.slice(1)
    : normalizedRoutePath.startsWith(basePath)
      ? normalizedRoutePath.slice(basePath.length)
      : null;
  if (suffix === null) {
    return null;
  }
  if (suffix === "") {
    return [];
  }
  const segments = suffix.split("/");
  return segments.every(isFileStoragePathSegment) ? segments : null;
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
  target: StorageFileTarget,
  contents: string | Uint8Array,
): Promise<boolean> {
  const tempPath = join(dirname(target.absolutePath), `.${basename(target.absolutePath)}.${crypto.randomUUID()}.tmp`);
  try {
    if (!await canWriteStorageFile(target.writableRootPath, target.absolutePath)) {
      return false;
    }
    await mkdir(dirname(target.absolutePath), { recursive: true });
    if (!await canWriteStorageFile(target.writableRootPath, target.absolutePath)) {
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

async function localStoragePersistenceContext(webspace: WebSpace, request: Request | undefined): Promise<LocalStoragePersistenceContext> {
  return {
    webspace,
    pagePath: pagePathForPersistenceRequest(request),
    writableRoots: await localStorageWritableRoots(webspace),
  };
}

async function localStorageWritableRoots(webspace: WebSpace): Promise<LocalStorageWritableRoot[]> {
  const roots: LocalStorageWritableRoot[] = [];
  const addRoot = (routeBasePath: string, rootPath: string) => {
    const normalizedRouteBasePath = directoryStorageRouteBasePath(routeBasePath);
    if (!roots.some((root) => root.routeBasePath === normalizedRouteBasePath && root.rootPath === rootPath)) {
      roots.push({ routeBasePath: normalizedRouteBasePath, rootPath });
    }
  };

  if (webspace.activeRootPath === webspace.webspaceRootPath) {
    addRoot("/", webspace.webspaceRootPath);
  }

  for (const mount of webspace.mounts) {
    if (mount.kind === "local") {
      addRoot(storageRouteBasePathFromHTTPRoute(mount.routeBasePath), mount.rootPath);
    }
  }

  if (await pathExists(webspace.webspaceRootPath)) {
    async function walk(directory: string): Promise<void> {
      const entries = await readdir(directory, { withFileTypes: true }).catch((error) => {
        if (isNotFoundError(error)) {
          return [];
        }
        throw error;
      });
      for (const entry of entries) {
        if (entry.name === ".DS_Store") {
          continue;
        }
        const entryPath = join(directory, entry.name);
        if (entry.isSymbolicLink()) {
          continue;
        }
        if (!entry.isDirectory() || SKIPPED_DIRECTORIES.has(entry.name)) {
          continue;
        }
        if (extname(entry.name).toLowerCase() === ".web") {
          addRoot(directoryStorageRouteBasePath(storageRoutePathFor(webspace.webspaceRootPath, entryPath)), entryPath);
        }
        await walk(entryPath);
      }
    }

    if (extname(webspace.webspaceRootPath).toLowerCase() === ".web") {
      addRoot("/", webspace.webspaceRootPath);
    }
    await walk(webspace.webspaceRootPath);
  }

  return roots.sort((left, right) => right.routeBasePath.length - left.routeBasePath.length);
}

async function readLocalStorageDiskSnapshotIfExists(storageFilePath: string): Promise<LocalStorageDiskSnapshot | null> {
  try {
    return normalizeLocalStorageDiskSnapshot(await parseJson5File(storageFilePath));
  } catch (error) {
    if (isNotFoundError(error)) {
      return null;
    }
    throw error;
  }
}

async function localStorageFileEntryIsVisibleInContext(
  fileEntry: LocalStorageFileEntry,
  context: LocalStoragePersistenceContext,
): Promise<boolean> {
  const target = await resolveStorageFileTarget(context, fileEntry.key);
  return target !== null && target.routePath === fileEntry.routePath;
}

function sortedLocalStorageFileEntries(files: LocalStorageFileEntry[]): LocalStorageFileEntry[] {
  return [...files].sort((left, right) => (
    left.routePath.localeCompare(right.routePath) || left.key.localeCompare(right.key)
  ));
}

function assertAllowedControlRequest(request: Request | undefined, controlToken: string | undefined): void {
  if (request === undefined) {
    if (controlToken !== undefined) {
      throw new Error("Control token is required.");
    }
    return;
  }

  const url = new URL(request.url);
  if (controlToken !== undefined) {
    const headerToken = request.headers.get("X-Web-App-Control-Token");
    const queryToken = url.searchParams.get("token");
    if (headerToken !== controlToken && queryToken !== controlToken) {
      throw new Error("Control token is invalid.");
    }
  }

  const origin = request.headers.get("Origin");
  if (origin !== null && origin !== url.origin) {
    throw new Error("Control requests must be same-origin.");
  }

  const fetchSite = request.headers.get("Sec-Fetch-Site")?.toLowerCase();
  if (fetchSite === "cross-site") {
    throw new Error("Cross-site control requests are not accepted.");
  }
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

function storageRouteBasePathFromHTTPRoute(routeBasePath: string): string {
  try {
    const decoded = decodeURIComponent(routeBasePath);
    return directoryStorageRouteBasePath(decoded);
  } catch {
    return "/";
  }
}

function storageRoutePathFor(rootPath: string, filePath: string): string {
  const rel = relative(rootPath, filePath);
  if (rel === "") {
    return "/";
  }
  return storageRoutePathForSegments(rel.split(sep).filter(Boolean));
}

function directoryStorageRouteBasePath(routePath: string): string {
  const normalized = normalizeStorageRoutePath(routePath);
  return normalized === "/" ? "/" : `${normalized}/`;
}

function normalizeStorageRoutePath(routePath: string): string {
  let normalized = routePath.startsWith("/") ? routePath : `/${routePath}`;
  while (normalized.length > 1 && normalized.endsWith("/")) {
    normalized = normalized.slice(0, -1);
  }
  return normalized;
}

function isSafeStoredRoutePath(routePath: string): boolean {
  if (!routePath.startsWith("/") || routePath.startsWith("//")) {
    return false;
  }
  const relativeRoutePath = routePath.slice(1);
  if (relativeRoutePath === "") {
    return false;
  }
  const segments = relativeRoutePath.split("/");
  return segments.every(isFileStoragePathSegment) && hasFileNameWithExtension(segments.at(-1));
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
      async POST(request: Request) {
        try {
          return await readFileResponse(pagePath, {
            ...options,
            postedRequest: await createPostedRequestPayload(request),
          });
        } catch (error) {
          return postedRequestErrorResponse(error);
        }
      },
    };
  }

  return htmlImport;
}

function postedRequestErrorResponse(error: unknown): Response {
  const message = String(error);
  return new Response(message, {
    status: message.includes("too large") ? 413 : 400,
    headers: { "Content-Type": "text/plain; charset=utf-8" },
  });
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
  const entries = await readdir(path, { withFileTypes: true });
  return entries.every((entry) => (
    entry.name === ".DS_Store"
    || (entry.name === LOCAL_DIRECTORY && entry.isDirectory())
  ));
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
  if (options.postedRequest) {
    result = injectHeadScript(result, postedRequestClientScript(options.postedRequest));
  }
  if (options.localStoragePersistence) {
    result = injectHeadScript(result, localStoragePersistenceClientScript(options.controlBasePath, options.controlToken));
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

function postedRequestClientScript(postedRequest: PostedRequestPayload): string {
  const json = jsonForInlineScript(postedRequest);
  return `<script type="application/json" id="appify-host-request">${json}</script>
<script>
(() => {
  const escapeHTML = (value) => String(value).replace(/[&<>"]/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
  })[character] || character);
  const failLoud = (message, cause) => {
    const error = cause instanceof Error ? cause : new Error(message);
    window.__WEB_APP_REQUEST_ERROR__ = error;
    console.error(message, error);
    if (typeof window.stop === "function") window.stop();
    document.open();
    document.write(
      '\\x3c!doctype html>\\x3chtml lang="en">\\x3chead>\\x3cmeta charset="utf-8" />'
      + '\\x3cmeta name="viewport" content="width=device-width, initial-scale=1" />'
      + '\\x3ctitle>Web request error\\x3c/title>'
      + '\\x3cstyle>body{margin:0;padding:2rem;font:14px system-ui,sans-serif;background:Canvas;color:CanvasText}'
      + 'main{max-width:48rem}pre{white-space:pre-wrap;border:1px solid color-mix(in oklch,CanvasText 18%,transparent);padding:1rem}\\x3c/style>'
      + '\\x3c/head>\\x3cbody>\\x3cmain>\\x3ch1>Posted request data could not start\\x3c/h1>\\x3cp>'
      + escapeHTML(message)
      + '\\x3c/p>\\x3cpre>'
      + escapeHTML(error.message || String(error))
      + '\\x3c/pre>\\x3c/main>\\x3c/body>\\x3c/html>',
    );
    document.close();
    throw error;
  };
  const element = document.getElementById("appify-host-request");
  if (!element) failLoud("Web.app could not find its posted request payload.");
  let payload;
  try {
    payload = JSON.parse(element.textContent || "{}");
  } catch (error) {
    failLoud("Web.app could not parse its posted request payload.", error);
  }
  const fields = Array.isArray(payload.fields) ? payload.fields : [];
  const searchParams = new URLSearchParams();
  for (const entry of fields) {
    if (Array.isArray(entry) && entry.length === 2) {
      searchParams.append(String(entry[0]), String(entry[1]));
    }
  }
  const request = Object.freeze({
    ...payload,
    searchParams,
    field(name) {
      return searchParams.get(String(name));
    },
    fields(name) {
      return searchParams.getAll(String(name));
    },
  });
  const host = window.AppifyHost && typeof window.AppifyHost === "object" ? window.AppifyHost : {};
  try {
    Object.defineProperty(host, "request", {
      configurable: true,
      enumerable: true,
      value: request,
    });
    Object.defineProperty(window, "AppifyHost", {
      configurable: true,
      enumerable: true,
      value: host,
    });
  } catch (error) {
    failLoud("Web.app could not expose posted request data on window.AppifyHost.request.", error);
  }
  try {
    Object.defineProperty(window, "__WEB_APP_REQUEST__", {
      configurable: true,
      enumerable: false,
      value: request,
    });
  } catch (error) {
    failLoud("Web.app could not expose posted request data on window.__WEB_APP_REQUEST__.", error);
  }
})();
</script>`;
}

function jsonForInlineScript(value: unknown): string {
  return JSON.stringify(value)
    .replaceAll("&", "\\u0026")
    .replaceAll("<", "\\u003c")
    .replaceAll(">", "\\u003e")
    .replaceAll("\u2028", "\\u2028")
    .replaceAll("\u2029", "\\u2029");
}

function localStoragePersistenceClientScript(controlBasePath = "/", controlToken?: string): string {
  const endpoint = routePathWithBase(controlBasePath, LOCAL_STORAGE_ROUTE);
  return `<script>
(() => {
  if (window.__WEB_APP_LOCAL_STORAGE__) return;
  const endpoint = ${JSON.stringify(endpoint)};
  const controlToken = ${JSON.stringify(controlToken ?? "")};
  const pagePath = () => {
    const pathname = window.location?.pathname || "/";
    return pathname || "/";
  };
  const endpointForPage = () => {
    const params = new URLSearchParams();
    params.set("page", pagePath());
    if (controlToken) params.set("token", controlToken);
    return endpoint + "?" + params.toString();
  };
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
        '\\x3c!doctype html>\\x3chtml lang="en">\\x3chead>\\x3cmeta charset="utf-8" />'
        + '\\x3cmeta name="viewport" content="width=device-width, initial-scale=1" />'
        + '\\x3ctitle>Web storage error\\x3c/title>'
        + '\\x3cstyle>body{margin:0;padding:2rem;font:14px system-ui,sans-serif;background:Canvas;color:CanvasText}'
        + 'main{max-width:48rem}pre{white-space:pre-wrap;border:1px solid color-mix(in oklch,CanvasText 18%,transparent);padding:1rem}\\x3c/style>'
        + '\\x3c/head>\\x3cbody>\\x3cmain>\\x3ch1>Web storage could not start\\x3c/h1>\\x3cp>'
        + escapeHTML(message)
        + '\\x3c/p>\\x3cpre>'
        + escapeHTML(error.message || String(error))
        + '\\x3c/pre>\\x3c/main>\\x3c/body>\\x3c/html>',
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
      headers: controlToken
        ? { "Content-Type": "application/json", "X-Web-App-Control-Token": controlToken }
        : { "Content-Type": "application/json" },
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
    if (controlToken) request.setRequestHeader("X-Web-App-Control-Token", controlToken);
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

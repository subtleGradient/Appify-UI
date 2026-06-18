import { appendFileSync, existsSync } from "node:fs";
import { mkdir, readdir, readFile, stat, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { homedir } from "node:os";
import { basename, dirname, extname, join, relative, resolve, sep } from "node:path";
import { startVisibleOriginConnectTunnel, type VisibleOriginConnectTunnel } from "./connectTunnel";

export type CommandPhase = "dev";
export type OutputStreamName = "stdout" | "stderr";

export type CommandSpec = {
  phase: CommandPhase;
  command: "bun";
  args: string[];
  cwd: string;
  env?: Record<string, string | undefined>;
};

export type CommandExecutor = {
  (
    spec: CommandSpec,
    onOutput: (stream: OutputStreamName, chunk: string | Uint8Array) => void | Promise<void>,
  ): Promise<number>;
  stopAll?: (signal?: NodeJS.Signals) => void;
};

export type OutputWriter = {
  write(chunk: string | Uint8Array): unknown;
};

export type EnsureWebappPackageResult = {
  devScript: string;
  logPath: string;
  packageJsonPath: string;
};

export type RunWebappLifecycleOptions = {
  devPermissionApprover?: DevServerPermissionApprover;
  executor?: CommandExecutor;
  hostBundleIdentifier?: string;
  permissionStorePath?: string;
  stderr?: OutputWriter;
  stdout?: OutputWriter;
  stableOriginPort?: number;
  tunnelStarter?: ConnectTunnelStarter;
};

export type ConnectTunnelStarter = (options: {
  visibleOriginURL: URL;
  backendURL: URL;
}) => Promise<VisibleOriginConnectTunnel>;

export type DevServerPermissionRequest = {
  command: string[];
  devScript: string;
  hostBundleIdentifier: string;
  packageName: string;
  packagePath: string;
};

export type DevServerPermissionApprover = (request: DevServerPermissionRequest) => Promise<boolean>;

type WebappPermissionState = {
  version: 1;
  devServers: Record<string, DevServerPermissionRecord>;
};

type DevServerPermissionRecord = DevServerPermissionRequest & {
  allowed: true;
  grantedAt: string;
};

const STATIC_DEV_SERVER_PATH = ".local/webapp/dev-server.ts";
const WEBAPP_PERMISSION_STATE_VERSION = 1;
const WEBAPP_PERMISSION_STORE_PATH = join(homedir(), ".local", "webappapp.json5");
const DEFAULT_HOST_BUNDLE_IDENTIFIER = "com.subtlegradient.webapp";
const DEV_COMMAND_ARGS = ["--no-install", "run", "dev"] as const;
const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "::1", "[::1]", "0:0:0:0:0:0:0:1"]);
const HTTP_URL_PATTERN = /https?:\/\/[^\s"'<>]+/gi;
const DEFAULT_STABLE_WEBAPP_PORT = 55555;

export async function resolveWebappDocumentPath(documentPath: string | undefined): Promise<string> {
  if (!documentPath) {
    throw new Error("Expected a .webapp document path as the last argument.");
  }

  const resolved = resolve(documentPath);
  if (extname(resolved).toLowerCase() !== ".webapp") {
    throw new Error(`Expected a .webapp document, got ${resolved}.`);
  }

  const stats = await stat(resolved).catch(() => null);
  if (stats === null) {
    throw new Error(`${resolved} does not exist.`);
  }
  if (!stats.isDirectory() && !stats.isFile()) {
    throw new Error(`Expected a .webapp file or directory package, got ${resolved}.`);
  }

  return resolved;
}

export async function resolveWebappRunRoot(documentPath: string): Promise<string> {
  const stats = await stat(documentPath);
  if (stats.isFile()) {
    return dirname(documentPath);
  }
  if (stats.isDirectory()) {
    if (await isEmptyDirectory(documentPath)) {
      return dirname(documentPath);
    }
    return documentPath;
  }

  throw new Error(`${documentPath} must be a .webapp file or directory.`);
}

export async function ensureWebappPackage(documentPath: string): Promise<EnsureWebappPackageResult> {
  const packageJsonPath = join(documentPath, "package.json");
  const logPath = devLogPath(documentPath);
  await mkdir(join(documentPath, ".local"), { recursive: true });

  const packageJson = await readPackageJson(packageJsonPath, documentPath);
  const scripts = isRecord(packageJson.scripts) ? { ...packageJson.scripts } : {};
  const existingDev = typeof scripts.dev === "string" ? scripts.dev.trim() : "";

  if (existingDev.length === 0) {
    const scaffold = await scaffoldDevScript(documentPath);
    scripts.dev = scaffold.devScript;
    packageJson.scripts = scripts;

    if (scaffold.staticServerEntry !== undefined) {
      await writeStaticDevServer(documentPath, scaffold.staticServerEntry);
    }
  }

  await writeFile(packageJsonPath, `${JSON.stringify(packageJson, null, 2)}\n`);

  return {
    devScript: String((packageJson.scripts as Record<string, unknown>).dev),
    logPath,
    packageJsonPath,
  };
}

export async function runWebappLifecycle(documentPath: string, options: RunWebappLifecycleOptions = {}): Promise<number> {
  const webappPackage = await ensureWebappPackage(documentPath);

  const logPath = webappPackage.logPath;
  await writeFile(logPath, "");
  const executor = options.executor ?? createBunCommandExecutor(process.env);
  const stdout = options.stdout ?? process.stdout;
  const stderr = options.stderr ?? process.stderr;
  const tunnelStarter = options.tunnelStarter ?? startVisibleOriginConnectTunnel;
  const stableOriginPort = options.stableOriginPort ?? DEFAULT_STABLE_WEBAPP_PORT;
  const devCommand = webappDevCommand();
  const permissionRequest = devServerPermissionRequest(documentPath, webappPackage.devScript, devCommand, {
    hostBundleIdentifier: options.hostBundleIdentifier ?? process.env.APPIFY_HOST_BUNDLE_ID ?? DEFAULT_HOST_BUNDLE_IDENTIFIER,
  });
  let openURLWasEmitted = false;
  let devOutputBuffer = "";
  let readyEmissionError: Error | null = null;
  let activeTunnel: VisibleOriginConnectTunnel | null = null;

  const writeBoth = (line: string) => {
    appendFileSync(logPath, line);
    stdout.write(line);
  };

  const writeError = (line: string) => {
    appendFileSync(logPath, line);
    stderr.write(line);
  };

  const emitReadyURL = async (backendURLText: string) => {
    const backendURL = new URL(backendURLText);
    if (!isStableOriginMappableBackendURL(backendURL)) {
      writeBoth(`APPIFY_HOST_OPEN_URL=${backendURL.href}\n`);
      return;
    }

    const visibleURL = stableWebappURL(documentPath, backendURL, stableOriginPort);
    activeTunnel = await tunnelStarter({
      visibleOriginURL: visibleURL,
      backendURL,
    });

    writeBoth(`APPIFY_HOST_BACKEND_URL=${backendURL.href}\n`);
    writeBoth(`APPIFY_HOST_PROXY_URL=${activeTunnel.url.href}\n`);
    writeBoth(`APPIFY_HOST_OPEN_URL=${visibleURL.href}\n`);
  };

  const tee = async (phase: CommandPhase, stream: OutputStreamName, chunk: string | Uint8Array) => {
    const text = textFromChunk(chunk);
    appendFileSync(logPath, text);
    writerFor(stream, stdout, stderr).write(text);

    if (phase !== "dev" || openURLWasEmitted) {
      return;
    }

    devOutputBuffer = `${devOutputBuffer}${text}`;
    const openURL = firstLoopbackHTTPURL(devOutputBuffer);
    if (openURL === null) {
      if (devOutputBuffer.length > 8192) {
        devOutputBuffer = devOutputBuffer.slice(-8192);
      }
      return;
    }

    openURLWasEmitted = true;
    try {
      await emitReadyURL(openURL);
    } catch (error) {
      readyEmissionError = error instanceof Error ? error : new Error(String(error));
      writeError(`Webapp could not prepare a stable local origin for ${openURL}: ${readyEmissionError.message}\n`);
      executor.stopAll?.("SIGTERM");
    }
  };

  const childEnv = childEnvironment(documentPath, logPath);

  const permissionStorePath = options.permissionStorePath ?? defaultWebappPermissionStorePath();
  if (!await hasApprovedDevServerPermission(permissionStorePath, permissionRequest)) {
    const approver = options.devPermissionApprover ?? defaultDevServerPermissionApprover;
    const approved = await approver(permissionRequest);
    if (!approved) {
      writeError("Webapp did not run bun dev because dev-server permission was not granted.\n");
      return 1;
    }
    await rememberApprovedDevServerPermission(permissionStorePath, permissionRequest);
  }

  const devExitCode = await executor(
    { phase: "dev", command: "bun", args: devCommand, cwd: documentPath, env: childEnv },
    (stream, chunk) => tee("dev", stream, chunk),
  );

  if (activeTunnel !== null) {
    await activeTunnel.close().catch((error) => {
      const message = error instanceof Error ? error.message : String(error);
      writeError(`Webapp could not close its stable-origin tunnel cleanly: ${message}\n`);
    });
  }

  return readyEmissionError === null ? devExitCode : 1;
}

export function createBunCommandExecutor(baseEnvironment: Record<string, string | undefined> = process.env): CommandExecutor {
  const children = new Set<ReturnType<typeof Bun.spawn>>();
  const bunExecutable = resolveBunExecutable(baseEnvironment);

  const execute: CommandExecutor = async (spec, onOutput) => {
    const child = Bun.spawn({
      cmd: [spec.command === "bun" ? bunExecutable : spec.command, ...spec.args],
      cwd: spec.cwd,
      env: { ...baseEnvironment, ...spec.env },
      stdout: "pipe",
      stderr: "pipe",
    });

    children.add(child);
    const pumps = [
      pumpReadableStream(child.stdout, (chunk) => onOutput("stdout", chunk)),
      pumpReadableStream(child.stderr, (chunk) => onOutput("stderr", chunk)),
    ];

    try {
      const exitCode = await child.exited;
      await Promise.allSettled(pumps);
      return exitCode;
    } finally {
      children.delete(child);
    }
  };

  execute.stopAll = (signal = "SIGTERM") => {
    for (const child of children) {
      child.kill(signal);
    }
  };

  return execute;
}

export function resolveBunExecutable(environment: Record<string, string | undefined> = process.env): string {
  return environment.APPIFY_WEBAPP_BUN_PATH || process.execPath || "bun";
}

export function stableWebappHostname(documentPath: string): string {
  // Web.app has the sibling stable-origin helper for static webspaces.
  // Check stableWebSpaceHostname/stableWebSpaceURL before changing hostname
  // shape, hash length, or the fixed visible port contract here.
  const root = resolve(documentPath);
  const rawName = basename(root, ".webapp").toLowerCase();
  const safeName = rawName
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48) || "webapp";
  const rootHash = createHash("sha256").update(root).digest("hex").slice(0, 8);
  return `${safeName}--${rootHash}.localhost`;
}

export function stableWebappURL(documentPath: string, backendURL: URL, port = DEFAULT_STABLE_WEBAPP_PORT): URL {
  const visibleURL = new URL(backendURL.href);
  visibleURL.protocol = "http:";
  visibleURL.hostname = stableWebappHostname(documentPath);
  visibleURL.port = String(port);
  visibleURL.username = "";
  visibleURL.password = "";
  return visibleURL;
}

export function defaultStableWebappPort(): number {
  return DEFAULT_STABLE_WEBAPP_PORT;
}

export function defaultWebappPermissionStorePath(): string {
  return WEBAPP_PERMISSION_STORE_PATH;
}

export function webappDevCommand(): string[] {
  return [...DEV_COMMAND_ARGS];
}

export function devServerPermissionRequest(
  documentPath: string,
  devScript: string,
  command: string[] = webappDevCommand(),
  options: { hostBundleIdentifier?: string } = {},
): DevServerPermissionRequest {
  const packagePath = resolve(documentPath);
  return {
    command: [...command],
    devScript,
    hostBundleIdentifier: options.hostBundleIdentifier ?? DEFAULT_HOST_BUNDLE_IDENTIFIER,
    packageName: basename(packagePath, ".webapp"),
    packagePath,
  };
}

export async function hasApprovedDevServerPermission(
  permissionStorePath: string,
  request: DevServerPermissionRequest,
): Promise<boolean> {
  const state = await readWebappPermissionState(permissionStorePath);
  const record = state.devServers[devServerPermissionKey(request)];
  return recordMatchesDevServerPermissionRequest(record, request);
}

export async function rememberApprovedDevServerPermission(
  permissionStorePath: string,
  request: DevServerPermissionRequest,
): Promise<void> {
  const state = await readWebappPermissionState(permissionStorePath);
  state.devServers[devServerPermissionKey(request)] = {
    ...request,
    allowed: true,
    grantedAt: new Date().toISOString(),
  };
  await writeWebappPermissionState(permissionStorePath, state);
}

export function isStableOriginMappableBackendURL(url: URL): boolean {
  return url.protocol === "http:" && LOOPBACK_HOSTS.has(url.hostname.toLowerCase());
}

export async function findBestRootHtmlEntry(documentPath: string): Promise<string | null> {
  const entries = await readdir(documentPath, { withFileTypes: true });
  const htmlFiles = entries
    .filter((entry) => entry.isFile() && isHtmlFile(entry.name))
    .map((entry) => entry.name)
    .sort((a, b) => a.localeCompare(b));

  const packageBaseName = basename(documentPath, ".webapp");
  return (
    exactFile(htmlFiles, "index.html")
    ?? exactFile(htmlFiles, "index.htm")
    ?? exactFile(htmlFiles, `${packageBaseName}.demo.html`)
    ?? htmlFiles.find((name) => name.endsWith(".demo.html"))
    ?? htmlFiles[0]
    ?? null
  );
}

export function firstLoopbackHTTPURL(text: string): string | null {
  for (const match of text.matchAll(HTTP_URL_PATTERN)) {
    const candidate = stripTrailingURLPunctuation(match[0] ?? "");
    try {
      const url = new URL(candidate);
      if ((url.protocol === "http:" || url.protocol === "https:") && LOOPBACK_HOSTS.has(url.hostname.toLowerCase())) {
        return url.toString();
      }
    } catch {
      continue;
    }
  }

  return null;
}

async function readPackageJson(packageJsonPath: string, documentPath: string): Promise<Record<string, unknown>> {
  if (!existsSync(packageJsonPath)) {
    return {
      name: packageNameFor(documentPath),
      private: true,
      type: "module",
      scripts: {},
    };
  }

  const source = await readFile(packageJsonPath, "utf8");
  const parsed = JSON.parse(source) as unknown;
  if (!isRecord(parsed)) {
    throw new Error(`${packageJsonPath} must contain a JSON object.`);
  }
  return parsed;
}

async function scaffoldDevScript(documentPath: string): Promise<{ devScript: string; staticServerEntry?: string | null }> {
  const runnerPath = await findFirstRunner(documentPath);
  const entry = await findBestRootHtmlEntry(documentPath);
  if (runnerPath !== null) {
    const runnerToken = shellToken(relativePath(documentPath, runnerPath));
    const entryToken = entry === null ? "" : ` ${shellToken(entry)}`;
    return { devScript: `bun ${runnerToken}${entryToken}` };
  }

  const staticServerEntry = entry ?? await writeStarterIndex(documentPath);
  return {
    devScript: `bun ${STATIC_DEV_SERVER_PATH}`,
    staticServerEntry,
  };
}

async function findFirstRunner(documentPath: string): Promise<string | null> {
  const scriptsDirectory = join(documentPath, "scripts");
  const entries = await readdir(scriptsDirectory, { withFileTypes: true }).catch(() => []);
  const runner = entries
    .filter((entry) => entry.isFile() && entry.name.endsWith("-runner.ts"))
    .map((entry) => entry.name)
    .sort((a, b) => a.localeCompare(b))[0];

  return runner === undefined ? null : join(scriptsDirectory, runner);
}

async function writeStaticDevServer(documentPath: string, entry: string | null): Promise<void> {
  const serverPath = join(documentPath, STATIC_DEV_SERVER_PATH);
  await mkdir(join(documentPath, ".local", "webapp"), { recursive: true });
  await writeFile(serverPath, staticDevServerSource(entry));
}

async function writeStarterIndex(documentPath: string): Promise<string> {
  const indexName = "index.html";
  await writeFile(join(documentPath, indexName), starterIndexSource(basename(documentPath, ".webapp")));
  return indexName;
}

function starterIndexSource(title: string): string {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <meta name="color-scheme" content="light dark" />
    <title>${escapeHTML(title || "Webapp")}</title>
    <style>
      :root {
        color-scheme: light dark;
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      }
      body {
        margin: 0;
        min-height: 100vh;
        display: grid;
        place-items: center;
        background: Canvas;
        color: CanvasText;
      }
      main {
        width: min(680px, calc(100vw - 48px));
      }
      h1 {
        margin: 0 0 12px;
        font-size: 32px;
        font-weight: 650;
      }
      p {
        margin: 0;
        color: color-mix(in srgb, CanvasText 72%, transparent);
        font-size: 15px;
        line-height: 1.5;
      }
    </style>
  </head>
  <body>
    <main>
      <h1>${escapeHTML(title || "Untitled")}</h1>
      <p>Edit this .webapp package to build your Bun-powered local web app.</p>
    </main>
  </body>
</html>
`;
}

function staticDevServerSource(entry: string | null): string {
  const defaultPath = entry === null ? "/" : `/${entry}`;
  return `#!/usr/bin/env bun
import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { createServer } from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(fileURLToPath(new URL("../..", import.meta.url)));
const defaultPath = ${JSON.stringify(defaultPath)};
const explicitPort = process.env.WEBAPP_PORT;
const startPort = explicitPort === undefined ? 4175 : Number(explicitPort);

const MIME_TYPES = new Map([
  [".css", "text/css; charset=utf-8"],
  [".html", "text/html; charset=utf-8"],
  [".htm", "text/html; charset=utf-8"],
  [".js", "text/javascript; charset=utf-8"],
  [".json", "application/json; charset=utf-8"],
  [".mjs", "text/javascript; charset=utf-8"],
  [".svg", "image/svg+xml; charset=utf-8"],
  [".txt", "text/plain; charset=utf-8"],
]);

async function handleRequest(request, response) {
  const url = new URL(request.url ?? "/", "http://127.0.0.1");
  let pathname = url.pathname;
  try {
    pathname = decodeURIComponent(pathname);
  } catch {
    response.writeHead(400, { "content-type": "text/plain; charset=utf-8" });
    response.end("Bad request");
    return;
  }
  if (pathname === "/") pathname = defaultPath;
  if (pathname.endsWith("/")) pathname += "index.html";
  const filePath = path.resolve(root, \`.\${pathname}\`);
  if (filePath !== root && !filePath.startsWith(\`\${root}\${path.sep}\`)) {
    response.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
    response.end("Not found");
    return;
  }
  const fileStat = await stat(filePath).catch(() => null);
  if (fileStat === null || !fileStat.isFile()) {
    response.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
    response.end("Not found");
    return;
  }
  response.writeHead(200, {
      "cache-control": "no-store",
      "content-type": MIME_TYPES.get(path.extname(filePath).toLowerCase()) ?? "application/octet-stream",
  });
  createReadStream(filePath).pipe(response);
}

function listen(port) {
  return new Promise((resolve, reject) => {
    const server = createServer((request, response) => {
      handleRequest(request, response).catch((error) => {
        response.writeHead(500, { "content-type": "text/plain; charset=utf-8" });
        response.end(error instanceof Error ? error.message : String(error));
      });
    });
    server.once("error", reject);
    server.listen(port, "127.0.0.1", () => {
      server.off("error", reject);
      resolve(server);
    });
  });
}

let server;
for (let offset = 0; offset < 100; offset += 1) {
  const port = startPort + offset;
  try {
    server = await listen(port);
    break;
  } catch (error) {
    if (explicitPort !== undefined || offset === 99) {
      throw error;
    }
  }
}

if (server === undefined) {
  throw new Error("Could not start Webapp dev server.");
}

const address = server.address();
if (address === null || typeof address === "string") {
  throw new Error("Could not read Webapp dev server address.");
}

console.log(\`Webapp: http://127.0.0.1:\${address.port}\${defaultPath}\`);
await new Promise(() => {});
`;
}

function devLogPath(documentPath: string): string {
  return join(documentPath, ".local", "dev.log");
}

async function defaultDevServerPermissionApprover(request: DevServerPermissionRequest): Promise<boolean> {
  const message = [
    "This .webapp package wants to run a local dev server.",
    "",
    `Package: ${request.packagePath}`,
    `Command: bun ${request.command.join(" ")}`,
    `scripts.dev: ${request.devScript}`,
    "",
    "Only run this if you trust the package code.",
  ].join("\n");
  const script = [
    `display dialog ${appleScriptString(message)}`,
    `with title ${appleScriptString("Run Webapp Dev Server?")}`,
    `buttons {"Cancel", "Run Dev Server"}`,
    `default button "Run Dev Server"`,
    `cancel button "Cancel"`,
    `with icon caution`,
  ].join(" ");

  const child = Bun.spawn({
    cmd: ["/usr/bin/osascript", "-e", script],
    stdout: "ignore",
    stderr: "ignore",
  });
  return await child.exited === 0;
}

async function readWebappPermissionState(permissionStorePath: string): Promise<WebappPermissionState> {
  const source = await readFile(permissionStorePath, "utf8").catch((error) => {
    if (isNodeError(error) && error.code === "ENOENT") {
      return null;
    }
    throw error;
  });
  if (source === null) {
    return emptyWebappPermissionState();
  }

  const parsed = safeParseJSON5(source);
  if (!isRecord(parsed) || parsed.version !== WEBAPP_PERMISSION_STATE_VERSION || !isRecord(parsed.devServers)) {
    return emptyWebappPermissionState();
  }

  const devServers: Record<string, DevServerPermissionRecord> = {};
  for (const [key, value] of Object.entries(parsed.devServers)) {
    if (isDevServerPermissionRecord(value)) {
      devServers[key] = value;
    }
  }

  return {
    version: WEBAPP_PERMISSION_STATE_VERSION,
    devServers,
  };
}

async function writeWebappPermissionState(permissionStorePath: string, state: WebappPermissionState): Promise<void> {
  await mkdir(dirname(permissionStorePath), { recursive: true });
  await writeFile(permissionStorePath, `${Bun.JSON5.stringify(state, null, 2)}\n`);
}

function emptyWebappPermissionState(): WebappPermissionState {
  return {
    version: WEBAPP_PERMISSION_STATE_VERSION,
    devServers: {},
  };
}

function devServerPermissionKey(request: DevServerPermissionRequest): string {
  return createHash("sha256")
    .update(JSON.stringify({
      command: request.command,
      devScript: request.devScript,
      hostBundleIdentifier: request.hostBundleIdentifier,
      packageName: request.packageName,
      packagePath: request.packagePath,
    }))
    .digest("hex");
}

function recordMatchesDevServerPermissionRequest(
  record: DevServerPermissionRecord | undefined,
  request: DevServerPermissionRequest,
): boolean {
  return record?.allowed === true
    && record.hostBundleIdentifier === request.hostBundleIdentifier
    && record.packageName === request.packageName
    && record.packagePath === request.packagePath
    && record.devScript === request.devScript
    && arrayEquals(record.command, request.command);
}

function isDevServerPermissionRecord(value: unknown): value is DevServerPermissionRecord {
  return isRecord(value)
    && value.allowed === true
    && typeof value.hostBundleIdentifier === "string"
    && typeof value.packageName === "string"
    && typeof value.packagePath === "string"
    && typeof value.devScript === "string"
    && Array.isArray(value.command)
    && value.command.every((item) => typeof item === "string")
    && typeof value.grantedAt === "string";
}

function arrayEquals(left: string[], right: string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function appleScriptString(value: string): string {
  return `"${value.replaceAll("\\", "\\\\").replaceAll("\"", "\\\"").replaceAll("\n", "\\n")}"`;
}

function safeParseJSON5(source: string): unknown {
  try {
    return Bun.JSON5.parse(source) as unknown;
  } catch {
    return null;
  }
}

async function isEmptyDirectory(path: string): Promise<boolean> {
  const entries = await readdir(path);
  return entries.every((entry) => entry === ".DS_Store");
}

function childEnvironment(documentPath: string, logPath: string): Record<string, string> {
  return {
    APPIFY_WEBAPP_DOCUMENT_PATH: documentPath,
    APPIFY_WEBAPP_LOG_PATH: logPath,
    WEB_NATIVE_OPENAI_NO_OPEN: "1",
  };
}

async function pumpReadableStream(
  stream: ReadableStream<Uint8Array> | null,
  onChunk: (chunk: Uint8Array) => void | Promise<void>,
): Promise<void> {
  if (stream === null) {
    return;
  }

  const reader = stream.getReader();
  while (true) {
    const { done, value } = await reader.read();
    if (done) {
      return;
    }
    await onChunk(value);
  }
}

function textFromChunk(chunk: string | Uint8Array): string {
  return typeof chunk === "string" ? chunk : new TextDecoder().decode(chunk);
}

function writerFor(stream: OutputStreamName, stdout: OutputWriter, stderr: OutputWriter): OutputWriter {
  return stream === "stdout" ? stdout : stderr;
}

function isHtmlFile(name: string): boolean {
  const extension = extname(name).toLowerCase();
  return extension === ".html" || extension === ".htm";
}

function exactFile(files: string[], target: string): string | null {
  const found = files.find((file) => file.toLowerCase() === target.toLowerCase());
  return found ?? null;
}

function relativePath(root: string, filePath: string): string {
  return relative(root, filePath).split(sep).join("/");
}

function shellToken(value: string): string {
  if (/^[A-Za-z0-9_./:@%+=,-]+$/.test(value)) {
    return value;
  }
  return `'${value.replaceAll("'", "'\\''")}'`;
}

function packageNameFor(documentPath: string): string {
  return basename(documentPath, ".webapp")
    .toLowerCase()
    .replaceAll(/[^a-z0-9._-]+/g, "-")
    .replaceAll(/^-+|-+$/g, "")
    || "webapp";
}

function escapeHTML(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function stripTrailingURLPunctuation(value: string): string {
  let candidate = value;
  while (/[),.\]}]/.test(candidate.at(-1) ?? "")) {
    candidate = candidate.slice(0, -1);
  }
  return candidate;
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

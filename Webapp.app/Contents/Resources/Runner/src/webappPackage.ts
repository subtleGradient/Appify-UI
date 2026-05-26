import { appendFileSync, existsSync } from "node:fs";
import { mkdir, readdir, readFile, stat, writeFile } from "node:fs/promises";
import { basename, extname, join, relative, resolve, sep } from "node:path";

export type CommandPhase = "install" | "dev";
export type OutputStreamName = "stdout" | "stderr";

export type CommandSpec = {
  phase: CommandPhase;
  command: "bun";
  args: string[];
  cwd: string;
  env?: Record<string, string | undefined>;
};

export type CommandExecutor = {
  (spec: CommandSpec, onOutput: (stream: OutputStreamName, chunk: string | Uint8Array) => void): Promise<number>;
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
  executor?: CommandExecutor;
  stderr?: OutputWriter;
  stdout?: OutputWriter;
};

const STATIC_DEV_SERVER_PATH = ".local/webapp/dev-server.ts";
const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "::1", "[::1]", "0:0:0:0:0:0:0:1"]);
const HTTP_URL_PATTERN = /https?:\/\/[^\s"'<>]+/gi;

export async function resolveWebappDocumentPath(documentPath: string | undefined): Promise<string> {
  if (!documentPath) {
    throw new Error("Expected a .webapp package path as the last argument.");
  }

  const resolved = resolve(documentPath);
  if (extname(resolved).toLowerCase() !== ".webapp") {
    throw new Error(`Expected a .webapp package, got ${resolved}.`);
  }

  const stats = await stat(resolved).catch(() => null);
  if (stats === null) {
    throw new Error(`${resolved} does not exist.`);
  }
  if (!stats.isDirectory()) {
    throw new Error(`Expected a .webapp directory package, got ${resolved}.`);
  }

  return resolved;
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
  let openURLWasEmitted = false;
  let devOutputBuffer = "";

  const tee = (phase: CommandPhase, stream: OutputStreamName, chunk: string | Uint8Array) => {
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
    const readyLine = `APPIFY_HOST_OPEN_URL=${openURL}\n`;
    appendFileSync(logPath, readyLine);
    stdout.write(readyLine);
  };

  const childEnv = childEnvironment(documentPath, logPath);
  const installExitCode = await executor(
    { phase: "install", command: "bun", args: ["install"], cwd: documentPath, env: childEnv },
    (stream, chunk) => tee("install", stream, chunk),
  );
  if (installExitCode !== 0) {
    return installExitCode;
  }

  return await executor(
    { phase: "dev", command: "bun", args: ["dev"], cwd: documentPath, env: childEnv },
    (stream, chunk) => tee("dev", stream, chunk),
  );
}

export function createBunCommandExecutor(baseEnvironment: Record<string, string | undefined> = process.env): CommandExecutor {
  const children = new Set<ReturnType<typeof Bun.spawn>>();

  const execute: CommandExecutor = async (spec, onOutput) => {
    const child = Bun.spawn({
      cmd: [spec.command, ...spec.args],
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

  return {
    devScript: `bun ${STATIC_DEV_SERVER_PATH}`,
    staticServerEntry: entry,
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

function staticDevServerSource(entry: string | null): string {
  const defaultPath = entry === null ? "/" : `/${entry}`;
  return `#!/usr/bin/env bun
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(fileURLToPath(new URL("../..", import.meta.url)));
const defaultPath = ${JSON.stringify(defaultPath)};
const port = Number(process.env.PORT ?? process.env.WEBAPP_PORT ?? 0);

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

const server = Bun.serve({
  hostname: "127.0.0.1",
  port,
  async fetch(request) {
    const url = new URL(request.url);
    let pathname = url.pathname;
    try {
      pathname = decodeURIComponent(pathname);
    } catch {
      return new Response("Bad request", { status: 400 });
    }
    if (pathname === "/") pathname = defaultPath;
    if (pathname.endsWith("/")) pathname += "index.html";
    const filePath = path.resolve(root, \`.\${pathname}\`);
    if (filePath !== root && !filePath.startsWith(\`\${root}\${path.sep}\`)) {
      return new Response("Not found", { status: 404 });
    }
    const file = Bun.file(filePath);
    if (!(await file.exists())) return new Response("Not found", { status: 404 });
    return new Response(file, {
      headers: {
        "cache-control": "no-store",
        "content-type": MIME_TYPES.get(path.extname(filePath).toLowerCase()) ?? "application/octet-stream",
      },
    });
  },
});

console.log(\`Webapp: http://\${server.hostname}:\${server.port}\${defaultPath}\`);
await new Promise(() => {});
`;
}

function devLogPath(documentPath: string): string {
  return join(documentPath, ".local", "dev.log");
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
  onChunk: (chunk: Uint8Array) => void,
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
    onChunk(value);
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

function stripTrailingURLPunctuation(value: string): string {
  let candidate = value;
  while (/[),.\]}]/.test(candidate.at(-1) ?? "")) {
    candidate = candidate.slice(0, -1);
  }
  return candidate;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

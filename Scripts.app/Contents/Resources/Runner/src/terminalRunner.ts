import { accessSync, constants } from "node:fs";
import { dirname, join } from "node:path";
import net from "node:net";
import { parseArgsText } from "./args";
import { joinURLPath, pathIsAtOrUnder, shellToken } from "./pathUtils";
import { type ScriptEntry, requireCatalogScript } from "./scriptCatalog";

export type RunStatus = "starting" | "running" | "exited" | "failed" | "stopped";

export type TerminalRun = {
  id: string;
  scriptId: string;
  scriptName: string;
  origin: ScriptEntry["origin"];
  status: RunStatus;
  command: string[];
  commandDisplay: string;
  cwd: string;
  startedAt: string;
  endedAt?: string;
  exitCode?: number;
  signal?: string;
  error?: string;
  terminalPath: string;
  diagnostics: string;
  diagnosticsTruncated: boolean;
};

export type SerializedTerminalRun = Omit<TerminalRun, "command"> & {
  command: string;
};

export type TerminalCommandSpec = {
  command: string;
  args: string[];
  env: Record<string, string>;
  cwd: string;
  mode: "direct" | "nix";
};

export type SpawnedChild = {
  stdout?: ReadableStream<Uint8Array> | null;
  stderr?: ReadableStream<Uint8Array> | null;
  exited: Promise<number>;
  kill(signal?: NodeJS.Signals): void;
};

export type SpawnTerminal = (spec: TerminalCommandSpec) => SpawnedChild;
export type ResolveTool = (name: string) => string | null;
export type AllocatePort = () => Promise<number>;
export type WaitForPort = (port: number, timeoutMs: number) => Promise<boolean>;

export type TerminalRunnerOptions = {
  documentPath: string;
  workingDirectory: string;
  basePath: string;
  resolveTool?: ResolveTool;
  allocatePort?: AllocatePort;
  waitForPort?: WaitForPort;
  spawn?: SpawnTerminal;
  maxDiagnosticsChars?: number;
  maxRuns?: number;
  stopGraceMs?: number;
};

export type RunScriptRequest = {
  scriptId: string;
  argsText?: string;
};

const DEFAULT_MAX_DIAGNOSTICS_CHARS = 60_000;
const DEFAULT_MAX_RUNS = 80;
const DEFAULT_STOP_GRACE_MS = 1_500;

export class TerminalRunner {
  readonly documentPath: string;
  readonly workingDirectory: string;
  readonly basePath: string;
  private readonly resolveTool: ResolveTool;
  private readonly allocatePort: AllocatePort;
  private readonly waitForPort: WaitForPort;
  private readonly spawn: SpawnTerminal;
  private readonly maxDiagnosticsChars: number;
  private readonly maxRuns: number;
  private readonly stopGraceMs: number;
  private readonly runs = new Map<string, TerminalRun>();
  private readonly children = new Map<string, SpawnedChild>();
  private readonly ports = new Map<string, number>();

  constructor(options: TerminalRunnerOptions) {
    this.documentPath = options.documentPath;
    this.workingDirectory = options.workingDirectory;
    this.basePath = options.basePath;
    this.resolveTool = options.resolveTool ?? findTool;
    this.allocatePort = options.allocatePort ?? allocateLoopbackPort;
    this.waitForPort = options.waitForPort ?? waitForLoopbackPort;
    this.spawn = options.spawn ?? spawnWithBun;
    this.maxDiagnosticsChars = options.maxDiagnosticsChars ?? DEFAULT_MAX_DIAGNOSTICS_CHARS;
    this.maxRuns = options.maxRuns ?? DEFAULT_MAX_RUNS;
    this.stopGraceMs = options.stopGraceMs ?? DEFAULT_STOP_GRACE_MS;
  }

  async runScript(input: RunScriptRequest): Promise<TerminalRun> {
    const args = parseArgsText(input.argsText ?? "");
    const script = await requireCatalogScript(input.scriptId, this.documentPath, this.workingDirectory);
    const port = await this.allocatePort();
    const id = crypto.randomUUID();
    const terminalPath = joinURLPath(this.basePath, "terminal", id);
    const spec = buildTtydCommand({
      port,
      basePath: terminalPath,
      cwd: script.cwd,
      scriptPath: script.path,
      scriptArgs: args,
      resolveTool: this.resolveTool,
    });

    const command = [script.path, ...args];
    const run: TerminalRun = {
      id,
      scriptId: script.id,
      scriptName: script.name,
      origin: script.origin,
      status: "starting",
      command,
      commandDisplay: command.map(shellToken).join(" "),
      cwd: script.cwd,
      startedAt: new Date().toISOString(),
      terminalPath,
      diagnostics: "",
      diagnosticsTruncated: false,
    };

    this.runs.set(id, run);
    this.ports.set(id, port);
    this.pruneRuns();

    try {
      const child = this.spawn(spec);
      this.children.set(id, child);
      void pumpReadableStream(child.stdout ?? null, (chunk) => this.appendDiagnostics(id, "stdout", chunk));
      void pumpReadableStream(child.stderr ?? null, (chunk) => this.appendDiagnostics(id, "stderr", chunk));
      void child.exited.then(
        (exitCode) => this.finishRun(id, exitCode),
        (error) => this.failRun(id, error),
      );

      const ready = await this.waitForPort(port, 10_000);
      if (!ready) {
        child.kill("SIGTERM");
        run.status = "failed";
        run.error = `ttyd did not become reachable on 127.0.0.1:${port}.`;
        run.endedAt = new Date().toISOString();
        this.children.delete(id);
        return { ...run };
      }

      run.status = "running";
    } catch (error) {
      this.failRun(id, error);
    }

    return { ...run };
  }

  stopRun(id: string): TerminalRun {
    const run = this.requireRun(id);
    if (run.status !== "starting" && run.status !== "running") {
      return { ...run };
    }

    const child = this.children.get(id);
    if (!child) {
      run.status = "failed";
      run.error = "No terminal process is attached to this run.";
      run.endedAt = new Date().toISOString();
      return { ...run };
    }

    child.kill("SIGTERM");
    run.status = "stopped";
    run.signal = "SIGTERM";
    run.endedAt = new Date().toISOString();
    setTimeout(() => {
      if (this.children.has(id)) {
        child.kill("SIGKILL");
        this.children.delete(id);
      }
    }, this.stopGraceMs);
    return { ...run };
  }

  getRun(id: string): TerminalRun {
    return { ...this.requireRun(id) };
  }

  listRuns(): TerminalRun[] {
    return [...this.runs.values()]
      .sort((left, right) => right.startedAt.localeCompare(left.startedAt))
      .map((run) => ({ ...run }));
  }

  serializeRun(run: TerminalRun): SerializedTerminalRun {
    return {
      ...run,
      command: run.commandDisplay,
    };
  }

  serializeRuns(runs = this.listRuns()): SerializedTerminalRun[] {
    return runs.map((run) => this.serializeRun(run));
  }

  terminalTargetURL(pathname: string, search: string, protocol: "http" | "ws"): string | null {
    for (const [id, port] of this.ports) {
      const run = this.runs.get(id);
      if (!run || !pathIsAtOrUnder(pathname, run.terminalPath)) {
        continue;
      }
      return `${protocol}://127.0.0.1:${port}${pathname}${search}`;
    }
    return null;
  }

  private appendDiagnostics(id: string, stream: "stdout" | "stderr", chunk: Uint8Array): void {
    const run = this.runs.get(id);
    if (!run) {
      return;
    }

    const text = new TextDecoder().decode(chunk);
    const prefix = stream === "stderr" ? "[stderr] " : "";
    const next = `${run.diagnostics}${prefix}${text}`;
    if (next.length <= this.maxDiagnosticsChars) {
      run.diagnostics = next;
      return;
    }

    run.diagnosticsTruncated = true;
    run.diagnostics = next.slice(next.length - this.maxDiagnosticsChars);
  }

  private finishRun(id: string, exitCode: number): void {
    const run = this.runs.get(id);
    if (!run) {
      return;
    }
    if (run.status === "stopped") {
      this.children.delete(id);
      return;
    }

    run.status = "exited";
    run.exitCode = exitCode;
    run.endedAt = new Date().toISOString();
    this.children.delete(id);
  }

  private failRun(id: string, error: unknown): void {
    const run = this.runs.get(id);
    if (!run) {
      return;
    }
    if (run.status === "stopped") {
      this.children.delete(id);
      return;
    }

    run.status = "failed";
    run.error = error instanceof Error ? error.message : String(error);
    run.endedAt = new Date().toISOString();
    this.children.delete(id);
  }

  private requireRun(id: string): TerminalRun {
    const run = this.runs.get(id);
    if (!run) {
      throw new Error(`Unknown run: ${id}`);
    }
    return run;
  }

  private pruneRuns(): void {
    const ordered = [...this.runs.values()].sort((left, right) => right.startedAt.localeCompare(left.startedAt));
    for (const run of ordered.slice(this.maxRuns)) {
      if (run.status !== "running" && run.status !== "starting") {
        this.runs.delete(run.id);
        this.ports.delete(run.id);
      }
    }
  }
}

export function buildTtydCommand(input: {
  port: number;
  basePath: string;
  cwd: string;
  scriptPath: string;
  scriptArgs: string[];
  resolveTool?: ResolveTool;
}): TerminalCommandSpec {
  const resolveTool = input.resolveTool ?? findTool;
  const ttyd = resolveTool("ttyd");
  const ttydArgs = [
    "--interface",
    "127.0.0.1",
    "--port",
    String(input.port),
    "--writable",
    "--check-origin",
    "--once",
    "--max-clients",
    "1",
    "--base-path",
    input.basePath,
    "--cwd",
    input.cwd,
    input.scriptPath,
    ...input.scriptArgs,
  ];

  if (ttyd) {
    return {
      command: ttyd,
      args: ttydArgs,
      env: {},
      cwd: input.cwd,
      mode: "direct",
    };
  }

  const nixShell = resolveTool("nix-shell");
  if (!nixShell) {
    throw new Error("Scripts requires ttyd. Install ttyd directly, install Nix, or make nix-shell available.");
  }

  return {
    command: nixShell,
    args: ["-p", "ttyd", "--run", ["exec", "ttyd", ...ttydArgs].map(shellToken).join(" ")],
    env: {},
    cwd: input.cwd,
    mode: "nix",
  };
}

export function findTool(name: string): string | null {
  const candidates = [
    join(process.env.HOME || "", ".nix-profile", "bin", name),
    join("/nix/var/nix/profiles/default/bin", name),
    join("/run/current-system/sw/bin", name),
    join("/opt/homebrew/bin", name),
    join("/usr/local/bin", name),
    join("/usr/bin", name),
  ];

  for (const candidate of candidates) {
    if (candidate && isExecutable(candidate)) {
      return candidate;
    }
  }

  for (const directory of (process.env.PATH || "").split(":")) {
    if (!directory) {
      continue;
    }
    const candidate = join(directory, name);
    if (isExecutable(candidate)) {
      return candidate;
    }
  }

  return null;
}

function isExecutable(path: string): boolean {
  try {
    accessSync(path, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

export async function allocateLoopbackPort(): Promise<number> {
  return await new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      server.close(() => {
        if (address && typeof address !== "string") {
          resolve(address.port);
        } else {
          reject(new Error("Could not allocate a loopback port."));
        }
      });
    });
  });
}

export async function waitForLoopbackPort(port: number, timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await canConnect(port)) {
      return true;
    }
    await Bun.sleep(100);
  }
  return false;
}

function canConnect(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = net.createConnection({ host: "127.0.0.1", port });
    socket.setTimeout(200);
    socket.once("connect", () => {
      socket.destroy();
      resolve(true);
    });
    socket.once("timeout", () => {
      socket.destroy();
      resolve(false);
    });
    socket.once("error", () => {
      socket.destroy();
      resolve(false);
    });
  });
}

function spawnWithBun(spec: TerminalCommandSpec): SpawnedChild {
  return Bun.spawn({
    cmd: [spec.command, ...spec.args],
    cwd: spec.cwd,
    env: { ...process.env, ...spec.env },
    stdout: "pipe",
    stderr: "pipe",
  });
}

async function pumpReadableStream(
  stream: ReadableStream<Uint8Array> | null,
  onChunk: (chunk: Uint8Array) => void,
): Promise<void> {
  if (!stream) {
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

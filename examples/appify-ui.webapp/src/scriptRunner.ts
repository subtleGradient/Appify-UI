import {
  type CommandSpec,
  type RootScriptId,
  type RunScriptInput,
  buildCommandForScript,
} from "./scriptCatalog";

export type RunStatus = "running" | "exited" | "failed" | "stopped";
export type OutputStreamName = "stdout" | "stderr";

export type RunRecord = {
  id: string;
  scriptId: RootScriptId;
  status: RunStatus;
  command: string[];
  cwd: string;
  startedAt: string;
  endedAt?: string;
  exitCode?: number;
  signal?: string;
  error?: string;
  log: string;
  logBytes: number;
  truncated: boolean;
  longRunning: boolean;
};

export type SerializedRunRecord = Omit<RunRecord, "command"> & {
  command: string;
};

type SpawnedChild = {
  stdout?: ReadableStream<Uint8Array> | null;
  stderr?: ReadableStream<Uint8Array> | null;
  exited: Promise<number>;
  kill(signal?: NodeJS.Signals): void;
};

export type SpawnCommand = (spec: CommandSpec) => SpawnedChild;

export type ScriptRunnerOptions = {
  repoRoot: string;
  spawn?: SpawnCommand;
  maxLogChars?: number;
  maxRuns?: number;
};

const DEFAULT_MAX_LOG_CHARS = 120_000;
const DEFAULT_MAX_RUNS = 80;

export class ScriptRunner {
  readonly repoRoot: string;
  private readonly spawn: SpawnCommand;
  private readonly maxLogChars: number;
  private readonly maxRuns: number;
  private readonly runs = new Map<string, RunRecord>();
  private readonly children = new Map<string, SpawnedChild>();

  constructor(options: ScriptRunnerOptions) {
    this.repoRoot = options.repoRoot;
    this.spawn = options.spawn ?? spawnWithBun;
    this.maxLogChars = options.maxLogChars ?? DEFAULT_MAX_LOG_CHARS;
    this.maxRuns = options.maxRuns ?? DEFAULT_MAX_RUNS;
  }

  runScript(input: RunScriptInput): RunRecord {
    const spec = buildCommandForScript(input, this.repoRoot);
    const id = crypto.randomUUID();
    const run: RunRecord = {
      id,
      scriptId: input.scriptId,
      status: "running",
      command: [spec.command, ...spec.args],
      cwd: spec.cwd,
      startedAt: new Date().toISOString(),
      log: "",
      logBytes: 0,
      truncated: false,
      longRunning: spec.longRunning,
    };

    this.runs.set(id, run);
    this.pruneRuns();

    try {
      const child = this.spawn(spec);
      this.children.set(id, child);
      void pumpReadableStream(child.stdout ?? null, (chunk) => this.appendLog(id, "stdout", chunk));
      void pumpReadableStream(child.stderr ?? null, (chunk) => this.appendLog(id, "stderr", chunk));
      void child.exited.then(
        (exitCode) => this.finishRun(id, exitCode),
        (error) => this.failRun(id, error),
      );
    } catch (error) {
      this.failRun(id, error);
    }

    return { ...run };
  }

  stopRun(id: string): RunRecord {
    const run = this.requireRun(id);
    if (run.status !== "running") {
      return { ...run };
    }

    const child = this.children.get(id);
    if (!child) {
      run.status = "failed";
      run.error = "No child process is attached to this run.";
      run.endedAt = new Date().toISOString();
      return { ...run };
    }

    child.kill("SIGTERM");
    run.status = "stopped";
    run.signal = "SIGTERM";
    run.endedAt = new Date().toISOString();
    this.children.delete(id);
    return { ...run };
  }

  getRun(id: string): RunRecord {
    return { ...this.requireRun(id) };
  }

  listRuns(): RunRecord[] {
    return [...this.runs.values()]
      .sort((a, b) => b.startedAt.localeCompare(a.startedAt))
      .map((run) => ({ ...run }));
  }

  serializeRun(run: RunRecord): SerializedRunRecord {
    return {
      ...run,
      command: run.command.map(shellDisplayToken).join(" "),
    };
  }

  serializeRuns(runs = this.listRuns()): SerializedRunRecord[] {
    return runs.map((run) => this.serializeRun(run));
  }

  private appendLog(id: string, stream: OutputStreamName, chunk: Uint8Array): void {
    const run = this.runs.get(id);
    if (!run) {
      return;
    }

    const text = new TextDecoder().decode(chunk);
    const prefix = stream === "stderr" ? "[stderr] " : "";
    const next = `${run.log}${prefix}${text}`;
    run.logBytes += text.length;

    if (next.length <= this.maxLogChars) {
      run.log = next;
      return;
    }

    run.truncated = true;
    run.log = next.slice(next.length - this.maxLogChars);
  }

  private finishRun(id: string, exitCode: number): void {
    const run = this.runs.get(id);
    if (!run || run.status === "stopped") {
      return;
    }

    run.status = "exited";
    run.exitCode = exitCode;
    run.endedAt = new Date().toISOString();
    this.children.delete(id);
  }

  private failRun(id: string, error: unknown): void {
    const run = this.runs.get(id);
    if (!run || run.status === "stopped") {
      return;
    }

    run.status = "failed";
    run.error = error instanceof Error ? error.message : String(error);
    run.endedAt = new Date().toISOString();
    this.children.delete(id);
  }

  private requireRun(id: string): RunRecord {
    const run = this.runs.get(id);
    if (!run) {
      throw new Error(`Unknown run: ${id}`);
    }
    return run;
  }

  private pruneRuns(): void {
    const ordered = [...this.runs.values()].sort((a, b) => b.startedAt.localeCompare(a.startedAt));
    for (const run of ordered.slice(this.maxRuns)) {
      if (run.status !== "running") {
        this.runs.delete(run.id);
      }
    }
  }
}

function spawnWithBun(spec: CommandSpec): SpawnedChild {
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

function shellDisplayToken(value: string): string {
  if (/^[A-Za-z0-9_./:@%+=,-]+$/.test(value)) {
    return value;
  }
  return `'${value.replaceAll("'", "'\\''")}'`;
}

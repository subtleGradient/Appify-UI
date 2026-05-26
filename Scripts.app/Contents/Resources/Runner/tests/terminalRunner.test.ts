import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { chmod, mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { buildTtydCommand, TerminalRunner, type SpawnTerminal, type TerminalCommandSpec } from "../src/terminalRunner";
import { listScripts } from "../src/scriptCatalog";

let root: string;
let scriptsDir: string;
let marker: string;

beforeEach(async () => {
  root = join(import.meta.dir, `.scripts-terminal-${crypto.randomUUID()}`);
  scriptsDir = join(root, "Scripts Dir");
  marker = join(scriptsDir, "tools.scripts");
  await mkdir(marker, { recursive: true });
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

describe("ttyd command construction", () => {
  test("uses direct ttyd when available", () => {
    const spec = buildTtydCommand({
      port: 4001,
      basePath: "/base/terminal/run-1",
      cwd: "/tmp/work",
      scriptPath: "/tmp/work/do thing.sh",
      scriptArgs: ["--name", "two words"],
      resolveTool: (name) => name === "ttyd" ? "/opt/bin/ttyd" : null,
    });

    expect(spec.mode).toBe("direct");
    expect(spec.command).toBe("/opt/bin/ttyd");
    expect(spec.args).toContain("--check-origin");
    expect(spec.args).toContain("/tmp/work/do thing.sh");
    expect(spec.args.at(-1)).toBe("two words");
  });

  test("falls back to nix-shell with quoted command tokens", () => {
    const spec = buildTtydCommand({
      port: 4001,
      basePath: "/base/terminal/run-1",
      cwd: "/tmp/work",
      scriptPath: "/tmp/work/do thing.sh",
      scriptArgs: ["$(nope)", "two words"],
      resolveTool: (name) => name === "nix-shell" ? "/nix/bin/nix-shell" : null,
    });

    expect(spec.mode).toBe("nix");
    expect(spec.command).toBe("/nix/bin/nix-shell");
    expect(spec.args.slice(0, 3)).toEqual(["-p", "ttyd", "--run"]);
    expect(spec.args[3]).toContain("'$(nope)'");
    expect(spec.args[3]).toContain("'two words'");
    expect(spec.args[3]).toContain("'/tmp/work/do thing.sh'");
  });
});

describe("terminal runner", () => {
  test("starts catalogued scripts through ttyd and stops the child", async () => {
    const scriptPath = join(scriptsDir, "open.sh");
    await executable(scriptPath);
    const script = (await listScripts(marker, scriptsDir)).scripts[0]!;
    let seen: TerminalCommandSpec | null = null;
    let killedWith = "";
    const spawn: SpawnTerminal = (spec) => {
      seen = spec;
      return {
        stdout: streamFromText("ttyd ready\n"),
        stderr: null,
        exited: new Promise(() => {}),
        kill(signal) {
          killedWith = signal ?? "";
        },
      };
    };
    const runner = new TerminalRunner({
      documentPath: marker,
      workingDirectory: scriptsDir,
      basePath: "/scripts",
      resolveTool: (name) => name === "ttyd" ? "/bin/ttyd" : null,
      allocatePort: async () => 4567,
      waitForPort: async () => true,
      spawn,
      stopGraceMs: 1,
    });

    const run = await runner.runScript({ scriptId: script.id, argsText: "--flag 'two words'" });
    expect(run.status).toBe("running");
    expect(run.terminalPath).toBe(`/scripts/terminal/${run.id}`);
    expect(seen?.args).toContain("--base-path");
    expect(seen?.args).toContain(run.terminalPath);
    expect(seen?.args).toContain("--cwd");
    expect(seen?.args).toContain(scriptsDir);
    expect(seen?.args).toContain("two words");

    const stopped = runner.stopRun(run.id);
    expect(stopped.status).toBe("stopped");
    expect(killedWith).toBe("SIGTERM");
  });

  test("does not run scripts that fail revalidation", async () => {
    const scriptPath = join(scriptsDir, "gone.sh");
    await executable(scriptPath);
    const script = (await listScripts(marker, scriptsDir)).scripts[0]!;
    await chmod(scriptPath, 0o644);
    const runner = new TerminalRunner({
      documentPath: marker,
      workingDirectory: scriptsDir,
      basePath: "/scripts",
      resolveTool: () => "/bin/ttyd",
      allocatePort: async () => 4567,
      waitForPort: async () => true,
      spawn: () => {
        throw new Error("spawn should not be called");
      },
    });

    await expect(runner.runScript({ scriptId: script.id })).rejects.toThrow("Unknown or no longer executable");
  });

  test("maps only known terminal paths to loopback targets", async () => {
    await executable(join(scriptsDir, "open.sh"));
    const script = (await listScripts(marker, scriptsDir)).scripts[0]!;
    const runner = new TerminalRunner({
      documentPath: marker,
      workingDirectory: scriptsDir,
      basePath: "/scripts",
      resolveTool: () => "/bin/ttyd",
      allocatePort: async () => 4567,
      waitForPort: async () => true,
      spawn: () => ({
        stdout: null,
        stderr: null,
        exited: new Promise(() => {}),
        kill() {},
      }),
    });

    const run = await runner.runScript({ scriptId: script.id });

    expect(runner.terminalTargetURL(`${run.terminalPath}/ws`, "?x=1", "ws")).toBe(`ws://127.0.0.1:4567${run.terminalPath}/ws?x=1`);
    expect(runner.terminalTargetURL("/scripts/terminal/not-real/ws", "", "ws")).toBeNull();
  });
});

async function executable(path: string) {
  await writeFile(path, "#!/usr/bin/env bash\necho ok\n");
  await chmod(path, 0o755);
}

function streamFromText(text: string): ReadableStream<Uint8Array> {
  return new ReadableStream({
    start(controller) {
      controller.enqueue(new TextEncoder().encode(text));
      controller.close();
    },
  });
}

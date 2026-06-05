import { describe, expect, test } from "bun:test";
import { defaultRepoRoot, type CommandSpec } from "../src/scriptCatalog";
import { ScriptRunner, type SpawnCommand } from "../src/scriptRunner";

const repoRoot = defaultRepoRoot();

describe("script runner", () => {
  test("records command, output, and exit code", async () => {
    const spawn: SpawnCommand = () => ({
      stdout: streamFromText("ok\n"),
      stderr: streamFromText("warn\n"),
      exited: Promise.resolve(0),
      kill() {},
    });
    const runner = new ScriptRunner({ repoRoot, spawn });

    const run = runner.runScript({ scriptId: "verify-root-apps" });
    await Bun.sleep(0);
    await Bun.sleep(0);

    const finished = runner.getRun(run.id);
    expect(finished.status).toBe("exited");
    expect(finished.exitCode).toBe(0);
    expect(finished.log).toContain("ok");
    expect(finished.log).toContain("[stderr] warn");
  });

  test("caps logs and marks truncation", async () => {
    const spawn: SpawnCommand = () => ({
      stdout: streamFromText("0123456789"),
      stderr: null,
      exited: Promise.resolve(0),
      kill() {},
    });
    const runner = new ScriptRunner({ repoRoot, spawn, maxLogChars: 4 });

    const run = runner.runScript({ scriptId: "verify-root-apps" });
    await Bun.sleep(0);

    const finished = runner.getRun(run.id);
    expect(finished.truncated).toBe(true);
    expect(finished.log).toBe("6789");
  });

  test("stops a running child process", () => {
    let killedWith = "";
    const spawn: SpawnCommand = () => ({
      stdout: null,
      stderr: null,
      exited: new Promise(() => {}),
      kill(signal) {
        killedWith = signal ?? "";
      },
    });
    const runner = new ScriptRunner({ repoRoot, spawn });

    const run = runner.runScript({ scriptId: "verify-root-apps" });
    const stopped = runner.stopRun(run.id);

    expect(killedWith).toBe("SIGTERM");
    expect(stopped.status).toBe("stopped");
    expect(stopped.signal).toBe("SIGTERM");
  });

  test("passes constructed command specs to spawn", () => {
    let seen: CommandSpec | null = null;
    const spawn: SpawnCommand = (spec) => {
      seen = spec;
      return {
        stdout: null,
        stderr: null,
        exited: Promise.resolve(0),
        kill() {},
      };
    };
    const runner = new ScriptRunner({ repoRoot, spawn });

    runner.runScript({
      scriptId: "eject-app",
      sourceApp: "Webapp.app",
      outputPath: "/private/tmp/Webapp.app",
      signMode: "ad-hoc",
    });

    expect(seen?.args).toContain("--sign");
    expect(seen?.args).toContain("-");
  });
});

function streamFromText(text: string): ReadableStream<Uint8Array> {
  return new ReadableStream({
    start(controller) {
      controller.enqueue(new TextEncoder().encode(text));
      controller.close();
    },
  });
}

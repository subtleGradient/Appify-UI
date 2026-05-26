import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import {
  type CommandExecutor,
  ensureWebappPackage,
  firstLoopbackHTTPURL,
  resolveBunExecutable,
  resolveWebappDocumentPath,
  resolveWebappRunRoot,
  runWebappLifecycle,
} from "../src/webappPackage";

let root: string;

beforeEach(async () => {
  root = join(import.meta.dir, `.webapp-test-${crypto.randomUUID()}.webapp`);
  await mkdir(root, { recursive: true });
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

describe("webapp package scaffold", () => {
  test("resolves .webapp files and empty packages to their parent directory", async () => {
    await rm(root, { recursive: true, force: true });
    await writeFile(root, "");
    expect(await resolveWebappDocumentPath(root)).toBe(root);
    expect(await resolveWebappRunRoot(root)).toBe(dirname(root));

    await rm(root, { force: true });
    await mkdir(root, { recursive: true });
    expect(await resolveWebappRunRoot(root)).toBe(dirname(root));

    await writeFile(join(root, ".DS_Store"), "");
    expect(await resolveWebappRunRoot(root)).toBe(dirname(root));
  });

  test("resolves non-empty .webapp packages to their own contents", async () => {
    await writeFile(join(root, "package.json"), "{}");
    expect(await resolveWebappRunRoot(root)).toBe(root);
  });

  test("creates package.json and a static dev script when package metadata is missing", async () => {
    await writeFile(join(root, "index.html"), "<h1>Hello</h1>");

    const result = await ensureWebappPackage(root);
    const packageJson = JSON.parse(await readFile(result.packageJsonPath, "utf8"));

    expect(packageJson).toEqual({
      name: packageName(root),
      private: true,
      type: "module",
      scripts: {
        dev: "bun .local/webapp/dev-server.ts",
      },
    });
    expect(await readFile(join(root, ".local", "webapp", "dev-server.ts"), "utf8")).toContain('const defaultPath = "/index.html"');
  });

  test("creates a starter index for an empty package", async () => {
    await ensureWebappPackage(root);

    const index = await readFile(join(root, "index.html"), "utf8");
    const devServer = await readFile(join(root, ".local", "webapp", "dev-server.ts"), "utf8");

    expect(index).toContain("<!doctype html>");
    expect(index).toContain("Edit this .webapp package");
    expect(devServer).toContain('const defaultPath = "/index.html"');
  });

  test("adds dev to existing package.json without dropping existing fields", async () => {
    await writeFile(join(root, "package.json"), JSON.stringify({
      name: "custom",
      dependencies: { leftpad: "1.0.0" },
    }));
    await writeFile(join(root, "index.html"), "<h1>Hello</h1>");

    await ensureWebappPackage(root);
    const packageJson = JSON.parse(await readFile(join(root, "package.json"), "utf8"));

    expect(packageJson.name).toBe("custom");
    expect(packageJson.dependencies).toEqual({ leftpad: "1.0.0" });
    expect(packageJson.scripts.dev).toBe("bun .local/webapp/dev-server.ts");
  });

  test("scaffolds runner-based dev command with the best root HTML entry", async () => {
    await mkdir(join(root, "scripts"));
    await writeFile(join(root, "scripts", "openai-runner.ts"), "console.log('runner')");
    await writeFile(join(root, "openai.text.demo.html"), "<h1>Text</h1>");
    await writeFile(join(root, "openai.demo.html"), "<h1>Demos</h1>");

    await ensureWebappPackage(root);
    const packageJson = JSON.parse(await readFile(join(root, "package.json"), "utf8"));

    expect(packageJson.scripts.dev).toBe("bun scripts/openai-runner.ts openai.demo.html");
  });

  test("keeps an existing dev script", async () => {
    await writeFile(join(root, "package.json"), JSON.stringify({
      name: "custom",
      scripts: { dev: "bun custom-dev.ts" },
    }));

    await ensureWebappPackage(root);
    const packageJson = JSON.parse(await readFile(join(root, "package.json"), "utf8"));

    expect(packageJson.scripts.dev).toBe("bun custom-dev.ts");
  });
});

describe("webapp lifecycle", () => {
  test("runs bun install before bun dev", async () => {
    await writeFile(join(root, "index.html"), "<h1>Hello</h1>");
    const invocations: string[] = [];
    const executor: CommandExecutor = async (spec, onOutput) => {
      invocations.push(`${spec.phase}:${spec.command} ${spec.args.join(" ")}`);
      if (spec.phase === "dev") {
        onOutput("stdout", "Local: http://localhost:4173/\n");
      }
      return 0;
    };

    const stdout = createCaptureWriter();
    const exitCode = await runWebappLifecycle(root, { executor, stdout });

    expect(exitCode).toBe(0);
    expect(invocations).toEqual(["install:bun install", "dev:bun dev"]);
    expect(stdout.text).toContain("APPIFY_HOST_OPEN_URL=http://localhost:4173/");
  });

  test("failed bun install stops before dev and preserves the log", async () => {
    await writeFile(join(root, "index.html"), "<h1>Hello</h1>");
    const invocations: string[] = [];
    const executor: CommandExecutor = async (spec, onOutput) => {
      invocations.push(spec.phase);
      onOutput("stderr", "install failed\n");
      return 42;
    };

    const exitCode = await runWebappLifecycle(root, { executor, stderr: createCaptureWriter() });

    expect(exitCode).toBe(42);
    expect(invocations).toEqual(["install"]);
    expect(await onlyLogText(root)).toContain("install failed");
  });

  test("tees stdout and stderr from install and dev into .local/dev.log", async () => {
    await writeFile(join(root, "index.html"), "<h1>Hello</h1>");
    const executor: CommandExecutor = async (spec, onOutput) => {
      onOutput("stdout", `${spec.phase} stdout\n`);
      onOutput("stderr", `${spec.phase} stderr\n`);
      if (spec.phase === "dev") {
        onOutput("stdout", "http://127.0.0.1:3000/\n");
      }
      return 0;
    };

    await runWebappLifecycle(root, { executor, stderr: createCaptureWriter(), stdout: createCaptureWriter() });
    const log = await onlyLogText(root);

    expect(log).toContain("install stdout");
    expect(log).toContain("install stderr");
    expect(log).toContain("dev stdout");
    expect(log).toContain("dev stderr");
    expect(log).toContain("APPIFY_HOST_OPEN_URL=http://127.0.0.1:3000/");
  });

  test("uses the first dev-phase loopback URL and ignores install-phase URLs", async () => {
    await writeFile(join(root, "index.html"), "<h1>Hello</h1>");
    const executor: CommandExecutor = async (spec, onOutput) => {
      if (spec.phase === "install") {
        onOutput("stdout", "install docs http://127.0.0.1:9999/\n");
      } else {
        onOutput("stdout", "first http://localhost:1000/one\nsecond http://localhost:1001/two\n");
      }
      return 0;
    };
    const stdout = createCaptureWriter();

    await runWebappLifecycle(root, { executor, stdout });

    expect(stdout.text).toContain("APPIFY_HOST_OPEN_URL=http://localhost:1000/one");
    expect(stdout.text).not.toContain("APPIFY_HOST_OPEN_URL=http://127.0.0.1:9999/");
    expect(stdout.text).not.toContain("APPIFY_HOST_OPEN_URL=http://localhost:1001/two");
  });
});

describe("URL parsing", () => {
  test("accepts loopback HTTP URLs only", () => {
    expect(firstLoopbackHTTPURL("open http://localhost:3000/path")).toBe("http://localhost:3000/path");
    expect(firstLoopbackHTTPURL("open http://127.0.0.1:3000/path")).toBe("http://127.0.0.1:3000/path");
    expect(firstLoopbackHTTPURL("open https://example.com")).toBeNull();
  });
});

describe("bun executable resolution", () => {
  test("uses the app server resolved Bun path when present", () => {
    expect(resolveBunExecutable({ APPIFY_WEBAPP_BUN_PATH: "/custom/bun" })).toBe("/custom/bun");
  });
});

function createCaptureWriter() {
  return {
    text: "",
    write(chunk: string | Uint8Array) {
      this.text += typeof chunk === "string" ? chunk : new TextDecoder().decode(chunk);
    },
  };
}

async function onlyLogText(documentPath: string): Promise<string> {
  return await readFile(join(documentPath, ".local", "dev.log"), "utf8");
}

function packageName(documentPath: string): string {
  return documentPath.split("/").at(-1)!.replace(/\.webapp$/, "").toLowerCase();
}

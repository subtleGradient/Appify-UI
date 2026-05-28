import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import {
  type CommandExecutor,
  type ConnectTunnelStarter,
  defaultStableWebappPort,
  ensureWebappPackage,
  firstLoopbackHTTPURL,
  isStableOriginMappableBackendURL,
  resolveBunExecutable,
  resolveWebappDocumentPath,
  resolveWebappRunRoot,
  runWebappLifecycle,
  stableWebappURL,
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
        await onOutput("stdout", "Local: http://localhost:4173/\n");
      }
      return 0;
    };

    const stdout = createCaptureWriter();
    const tunnel = createFakeTunnelStarter();
    const exitCode = await runWebappLifecycle(root, { executor, stdout, tunnelStarter: tunnel.starter });
    const expectedOpenURL = stableWebappURL(root, new URL("http://localhost:4173/"));

    expect(exitCode).toBe(0);
    expect(invocations).toEqual(["install:bun install", "dev:bun dev"]);
    expect(stdout.text).toContain("APPIFY_HOST_BACKEND_URL=http://localhost:4173/");
    expect(stdout.text).toContain("APPIFY_HOST_PROXY_URL=http://127.0.0.1:49153/");
    expect(stdout.text).toContain(`APPIFY_HOST_OPEN_URL=${expectedOpenURL.href}`);
    expect(tunnel.calls.map((call) => [call.visibleOriginURL.href, call.backendURL.href])).toEqual([[
      expectedOpenURL.href,
      "http://localhost:4173/",
    ]]);
    expect(tunnel.closeCount).toBe(1);
  });

  test("failed bun install stops before dev and preserves the log", async () => {
    await writeFile(join(root, "index.html"), "<h1>Hello</h1>");
    const invocations: string[] = [];
    const executor: CommandExecutor = async (spec, onOutput) => {
      invocations.push(spec.phase);
      await onOutput("stderr", "install failed\n");
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
      await onOutput("stdout", `${spec.phase} stdout\n`);
      await onOutput("stderr", `${spec.phase} stderr\n`);
      if (spec.phase === "dev") {
        await onOutput("stdout", "http://127.0.0.1:3000/\n");
      }
      return 0;
    };
    const tunnel = createFakeTunnelStarter();

    await runWebappLifecycle(root, { executor, stderr: createCaptureWriter(), stdout: createCaptureWriter(), tunnelStarter: tunnel.starter });
    const log = await onlyLogText(root);

    expect(log).toContain("install stdout");
    expect(log).toContain("install stderr");
    expect(log).toContain("dev stdout");
    expect(log).toContain("dev stderr");
    expect(log).toContain("APPIFY_HOST_BACKEND_URL=http://127.0.0.1:3000/");
    expect(log).toContain(`APPIFY_HOST_OPEN_URL=${stableWebappURL(root, new URL("http://127.0.0.1:3000/")).href}`);
  });

  test("uses the first dev-phase loopback URL and ignores install-phase URLs", async () => {
    await writeFile(join(root, "index.html"), "<h1>Hello</h1>");
    const executor: CommandExecutor = async (spec, onOutput) => {
      if (spec.phase === "install") {
        await onOutput("stdout", "install docs http://127.0.0.1:9999/\n");
      } else {
        await onOutput("stdout", "first http://localhost:1000/one\nsecond http://localhost:1001/two\n");
      }
      return 0;
    };
    const stdout = createCaptureWriter();
    const tunnel = createFakeTunnelStarter();

    await runWebappLifecycle(root, { executor, stdout, tunnelStarter: tunnel.starter });

    expect(stdout.text).toContain("APPIFY_HOST_BACKEND_URL=http://localhost:1000/one");
    expect(stdout.text).toContain(`APPIFY_HOST_OPEN_URL=${stableWebappURL(root, new URL("http://localhost:1000/one")).href}`);
    expect(stdout.text).not.toContain("APPIFY_HOST_OPEN_URL=http://127.0.0.1:9999/");
    expect(stdout.text).not.toContain("APPIFY_HOST_BACKEND_URL=http://localhost:1001/two");
    expect(tunnel.calls.length).toBe(1);
  });

  test("falls back to direct open URLs for loopback HTTPS dev servers", async () => {
    await writeFile(join(root, "index.html"), "<h1>Hello</h1>");
    const executor: CommandExecutor = async (spec, onOutput) => {
      if (spec.phase === "dev") {
        await onOutput("stdout", "https://localhost:3443/\n");
      }
      return 0;
    };
    const stdout = createCaptureWriter();
    const tunnel = createFakeTunnelStarter();

    await runWebappLifecycle(root, { executor, stdout, tunnelStarter: tunnel.starter });

    expect(stdout.text).toContain("APPIFY_HOST_OPEN_URL=https://localhost:3443/");
    expect(stdout.text).not.toContain("APPIFY_HOST_PROXY_URL=");
    expect(tunnel.calls).toEqual([]);
  });
});

describe("URL parsing", () => {
  test("accepts loopback HTTP URLs only", () => {
    expect(firstLoopbackHTTPURL("open http://localhost:3000/path")).toBe("http://localhost:3000/path");
    expect(firstLoopbackHTTPURL("open http://127.0.0.1:3000/path")).toBe("http://127.0.0.1:3000/path");
    expect(firstLoopbackHTTPURL("open https://example.com")).toBeNull();
  });
});

describe("stable webapp origins", () => {
  test("derives stable visible URLs from the package root while preserving dev-server paths", () => {
    const backendURL = new URL("http://127.0.0.1:3000/workbench/?q=1#panel");
    const visibleURL = stableWebappURL(root, backendURL);

    expect(visibleURL.protocol).toBe("http:");
    expect(visibleURL.hostname).toEndWith(".localhost");
    expect(visibleURL.port).toBe(String(defaultStableWebappPort()));
    expect(visibleURL.pathname).toBe("/workbench/");
    expect(visibleURL.search).toBe("?q=1");
    expect(visibleURL.hash).toBe("#panel");
    expect(visibleURL.hostname).not.toBe(backendURL.hostname);
  });

  test("maps only HTTP loopback backend URLs through the stable-origin tunnel", () => {
    expect(isStableOriginMappableBackendURL(new URL("http://localhost:3000/"))).toBe(true);
    expect(isStableOriginMappableBackendURL(new URL("http://127.0.0.1:3000/"))).toBe(true);
    expect(isStableOriginMappableBackendURL(new URL("https://localhost:3000/"))).toBe(false);
    expect(isStableOriginMappableBackendURL(new URL("http://example.com:3000/"))).toBe(false);
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

function createFakeTunnelStarter() {
  const calls: Array<{ visibleOriginURL: URL; backendURL: URL }> = [];
  const result = {
    calls,
    closeCount: 0,
    starter: (async (options) => {
      calls.push(options);
      return {
        url: new URL("http://127.0.0.1:49153/"),
        close: async () => {
          result.closeCount += 1;
        },
      };
    }) satisfies ConnectTunnelStarter,
  };
  return result;
}

function packageName(documentPath: string): string {
  return documentPath.split("/").at(-1)!.replace(/\.webapp$/, "").toLowerCase();
}

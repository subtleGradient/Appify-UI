import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { chmod, mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { createScriptsServer, type ScriptsServer } from "../src/server";
import { TerminalRunner, type SpawnTerminal } from "../src/terminalRunner";

let root: string;
let scriptsDir: string;
let marker: string;
let app: ScriptsServer | null;

beforeEach(async () => {
  root = join(import.meta.dir, `.scripts-server-${crypto.randomUUID()}`);
  scriptsDir = join(root, "Scripts");
  marker = join(scriptsDir, "tools.scripts");
  await mkdir(marker, { recursive: true });
  await executable(join(scriptsDir, "run.sh"));
  app = null;
});

afterEach(async () => {
  app?.server.stop(true);
  await rm(root, { recursive: true, force: true });
});

describe("scripts server", () => {
  test("serves catalog only under the random base path", async () => {
    app = await createTestServer();

    expect((await fetch(`${origin()}/nope/api/catalog`)).status).toBe(404);

    const response = await fetch(`${app.url}api/catalog`);
    const payload = await response.json();
    expect(payload.workingDirectory).toBe(scriptsDir);
    expect(payload.scripts.map((script: { name: string }) => script.name)).toEqual(["run.sh"]);
  });

  test("requires same-origin session token for mutating endpoints", async () => {
    app = await createTestServer();
    const scriptId = (await (await fetch(`${app.url}api/catalog`)).json()).scripts[0].id;

    const missingToken = await fetch(`${app.url}api/runs`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Origin": origin() },
      body: JSON.stringify({ scriptId }),
    });
    expect(missingToken.status).toBe(403);

    const badOrigin = await fetch(`${app.url}api/runs`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Origin": "https://example.com",
        "X-Scripts-Token": app.token,
      },
      body: JSON.stringify({ scriptId }),
    });
    expect(badOrigin.status).toBe(403);

    const accepted = await fetch(`${app.url}api/runs`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Origin": origin(),
        "X-Scripts-Token": app.token,
      },
      body: JSON.stringify({ scriptId, argsText: "--ok" }),
    });
    expect(accepted.status).toBe(200);
    expect((await accepted.json()).status).toBe("running");
  });

  test("proxies only known terminal paths", async () => {
    const terminalBackend = Bun.serve({
      hostname: "127.0.0.1",
      port: 0,
      fetch(request) {
        return new Response(new URL(request.url).pathname);
      },
    });
    try {
      app = await createTestServer({ port: terminalBackend.port });
      const scriptId = (await (await fetch(`${app.url}api/catalog`)).json()).scripts[0].id;
      const run = await (await fetch(`${app.url}api/runs`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Origin": origin(),
          "X-Scripts-Token": app.token,
        },
        body: JSON.stringify({ scriptId }),
      })).json();

      const unknown = await fetch(`${origin()}${app.basePath}/terminal/not-real/`);
      expect(unknown.status).toBe(404);

      const proxied = await fetch(`${origin()}${run.terminalPath}/asset.js`);
      expect(await proxied.text()).toBe(`${run.terminalPath}/asset.js`);
    } finally {
      terminalBackend.stop(true);
    }
  });
});

async function createTestServer(options: { port?: number } = {}) {
  const spawn: SpawnTerminal = () => ({
    stdout: null,
    stderr: null,
    exited: new Promise(() => {}),
    kill() {},
  });
  const runner = new TerminalRunner({
    documentPath: marker,
    workingDirectory: scriptsDir,
    basePath: "/test-scripts",
    resolveTool: (name) => name === "ttyd" ? "/bin/ttyd" : null,
    allocatePort: async () => options.port ?? 4567,
    waitForPort: async () => true,
    spawn,
  });
  return await createScriptsServer({
    documentPath: marker,
    workingDirectory: scriptsDir,
    basePath: "/test-scripts",
    token: "test-token",
    runner,
  });
}

function origin() {
  if (!app) {
    throw new Error("Server is not running.");
  }
  return new URL(app.url).origin;
}

async function executable(path: string) {
  await writeFile(path, "#!/usr/bin/env bash\necho ok\n");
  await chmod(path, 0o755);
}

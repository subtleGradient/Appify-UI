import { join } from "node:path";
import { pathIsAtOrUnder, randomPath } from "./pathUtils";
import { listScripts } from "./scriptCatalog";
import { TerminalRunner, type SerializedTerminalRun } from "./terminalRunner";

export type ScriptsServerOptions = {
  documentPath: string;
  workingDirectory: string;
  port?: number;
  basePath?: string;
  token?: string;
  runner?: TerminalRunner;
};

export type ScriptsServer = {
  server: Bun.Server;
  runner: TerminalRunner;
  basePath: string;
  token: string;
  url: string;
};

type ProxyWebSocketData = {
  targetURL: string;
  targetOrigin: string;
  remote?: WebSocket;
  queue: Array<string | Uint8Array | ArrayBuffer>;
};

export async function createScriptsServer(options: ScriptsServerOptions): Promise<ScriptsServer> {
  const basePath = options.basePath ?? randomPath("appify-scripts");
  const token = options.token ?? crypto.randomUUID();
  const runner = options.runner ?? new TerminalRunner({
    documentPath: options.documentPath,
    workingDirectory: options.workingDirectory,
    basePath,
  });
  const packageRoot = join(import.meta.dir, "..");
  const frontend = await buildFrontend(packageRoot);

  const server = Bun.serve<ProxyWebSocketData>({
    hostname: "127.0.0.1",
    port: options.port ?? 0,
    idleTimeout: 0,
    async fetch(request, bunServer) {
      try {
        return await handleRequest({
          request,
          bunServer,
          runner,
          documentPath: options.documentPath,
          workingDirectory: options.workingDirectory,
          basePath,
          token,
          packageRoot,
          frontend,
        });
      } catch (error) {
        return jsonResponse({ error: messageFromError(error) }, 400);
      }
    },
    websocket: {
      open(client) {
        const data = client.data;
        const remote = new WebSocket(data.targetURL, {
          headers: {
            Origin: data.targetOrigin,
          },
        });
        data.remote = remote;

        remote.binaryType = "arraybuffer";
        remote.addEventListener("open", () => {
          for (const message of data.queue.splice(0)) {
            remote.send(message);
          }
        });
        remote.addEventListener("message", (event) => {
          if (client.readyState === WebSocket.OPEN) {
            client.send(event.data as string | ArrayBuffer | Uint8Array);
          }
        });
        remote.addEventListener("close", () => {
          client.close();
        });
        remote.addEventListener("error", () => {
          client.close();
        });
      },
      message(client, message) {
        const data = client.data;
        const remote = data.remote;
        if (remote?.readyState === WebSocket.OPEN) {
          remote.send(message);
        } else {
          data.queue.push(message);
        }
      },
      close(client) {
        client.data.remote?.close();
      },
    },
  });

  return {
    server,
    runner,
    basePath,
    token,
    url: `${server.url.origin}${basePath}/`,
  };
}

async function handleRequest(context: {
  request: Request;
  bunServer: Bun.Server;
  runner: TerminalRunner;
  documentPath: string;
  workingDirectory: string;
  basePath: string;
  token: string;
  packageRoot: string;
  frontend: string;
}): Promise<Response> {
  const url = new URL(context.request.url);
  if (!pathIsAtOrUnder(url.pathname, context.basePath)) {
    return textResponse("Not found", 404);
  }

  const terminalRoot = `${context.basePath}/terminal`;
  if (pathIsAtOrUnder(url.pathname, terminalRoot)) {
    return proxyTerminalRequest(context.request, context.bunServer, context.runner);
  }

  const route = url.pathname.slice(context.basePath.length) || "/";
  if (route === "/") {
    return htmlResponse(indexHTML({
      basePath: context.basePath,
      token: context.token,
    }));
  }

  if (route === "/assets/frontend.js") {
    return new Response(context.frontend, {
      headers: {
        "Cache-Control": "no-store",
        "Content-Type": "text/javascript; charset=utf-8",
      },
    });
  }

  if (route === "/styles.css") {
    return fileResponse(join(context.packageRoot, "src", "styles.css"), "text/css; charset=utf-8");
  }

  if (route === "/api/catalog" && context.request.method === "GET") {
    return jsonResponse({
      ...await listScripts(context.documentPath, context.workingDirectory),
      notice: "Running a script executes local code with your user account in the displayed working directory.",
    });
  }

  if (route === "/api/runs" && context.request.method === "GET") {
    return jsonResponse({ runs: context.runner.serializeRuns() });
  }

  if (route === "/api/runs" && context.request.method === "POST") {
    const problem = requireTrustedMutation(context.request, context.token);
    if (problem) {
      return problem;
    }

    const input = await readJSONBody(context.request);
    const run = await context.runner.runScript({
      scriptId: stringField(input, "scriptId"),
      argsText: optionalStringField(input, "argsText"),
    });
    return jsonResponse(context.runner.serializeRun(run));
  }

  const runMatch = route.match(/^\/api\/runs\/([^/]+)$/);
  if (runMatch && context.request.method === "GET") {
    return jsonResponse(context.runner.serializeRun(context.runner.getRun(decodeURIComponent(runMatch[1]!))));
  }

  const stopMatch = route.match(/^\/api\/runs\/([^/]+)\/stop$/);
  if (stopMatch && context.request.method === "POST") {
    const problem = requireTrustedMutation(context.request, context.token);
    if (problem) {
      return problem;
    }
    return jsonResponse(context.runner.serializeRun(context.runner.stopRun(decodeURIComponent(stopMatch[1]!))));
  }

  return textResponse("Not found", 404);
}

function proxyTerminalRequest(request: Request, server: Bun.Server, runner: TerminalRunner): Response | Promise<Response> {
  const url = new URL(request.url);
  const isWebSocket = request.headers.get("upgrade")?.toLowerCase() === "websocket";
  const target = runner.terminalTargetURL(url.pathname, url.search, isWebSocket ? "ws" : "http");
  if (!target) {
    return textResponse("Unknown terminal session", 404);
  }

  const targetURL = new URL(target);
  if (isWebSocket) {
    const accepted = server.upgrade(request, {
      data: {
        targetURL: targetURL.toString(),
        targetOrigin: targetURL.origin,
        queue: [],
      },
    });
    return accepted ? new Response(null) : textResponse("Could not upgrade WebSocket", 400);
  }

  const headers = new Headers(request.headers);
  headers.set("Host", targetURL.host);
  headers.set("Origin", targetURL.origin);
  headers.delete("Content-Length");

  return fetch(targetURL, {
    method: request.method,
    headers,
    body: request.method === "GET" || request.method === "HEAD" ? undefined : request.body,
    redirect: "manual",
  });
}

async function buildFrontend(packageRoot: string): Promise<string> {
  const result = await Bun.build({
    entrypoints: [join(packageRoot, "src", "frontend.ts")],
    target: "browser",
    minify: false,
    sourcemap: "inline",
  });

  if (!result.success) {
    const messages = result.logs.map((log) => log.message).join("\n");
    throw new Error(`Could not build Scripts frontend:\n${messages}`);
  }

  return await result.outputs[0].text();
}

function indexHTML(config: { basePath: string; token: string }): string {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <meta name="color-scheme" content="light dark" />
    <title>Scripts</title>
    <link rel="stylesheet" href="${config.basePath}/styles.css" />
    <script>
      window.SCRIPTS_APP_CONFIG = ${JSON.stringify(config).replaceAll("<", "\\u003c")};
    </script>
  </head>
  <body>
    <main class="shell">
      <header class="topbar">
        <div>
          <h1>Scripts</h1>
          <p id="working-directory">Loading</p>
        </div>
        <div class="status-pill" id="connection-status">Connecting</div>
      </header>

      <section class="workspace" aria-label="Scripts dashboard">
        <aside class="sidebar">
          <div class="sidebar-header">
            <h2>Executables</h2>
            <button type="button" class="secondary-button compact" id="refresh-button">Refresh</button>
          </div>
          <nav class="script-list" id="script-list" aria-label="Executable scripts"></nav>
        </aside>

        <section class="detail">
          <div class="detail-header">
            <div>
              <h2 id="script-title">Select a script</h2>
              <p id="script-path"></p>
            </div>
            <span class="badge" id="script-origin">Idle</span>
          </div>

          <form class="run-form" id="run-form">
            <div class="authority-grid">
              <div>
                <span class="label">Cwd</span>
                <strong id="script-cwd">-</strong>
              </div>
              <div>
                <span class="label">Command</span>
                <strong id="command-preview">-</strong>
              </div>
              <div class="warning">
                <span class="label">Authority</span>
                <strong>Runs as your local user</strong>
              </div>
            </div>
            <label class="field">
              <span>Args</span>
              <input id="args-input" name="args" type="text" autocomplete="off" spellcheck="false" />
            </label>
            <div class="actions">
              <button type="submit" class="primary-button" id="run-button">Run</button>
              <button type="button" class="secondary-button" id="stop-button" disabled>Stop</button>
              <button type="button" class="secondary-button" id="copy-command-button">Copy Command</button>
            </div>
          </form>

          <section class="terminal-panel" aria-label="Terminal">
            <iframe id="terminal-frame" title="Script terminal"></iframe>
            <pre id="diagnostics"></pre>
          </section>
        </section>

        <aside class="history">
          <h2>Runs</h2>
          <div class="run-list" id="run-list"></div>
        </aside>
      </section>
    </main>
    <script type="module" src="${config.basePath}/assets/frontend.js"></script>
  </body>
</html>`;
}

function requireTrustedMutation(request: Request, token: string): Response | null {
  const originProblem = validateLocalOrigin(request);
  if (originProblem) {
    return originProblem;
  }
  if (request.headers.get("X-Scripts-Token") !== token) {
    return jsonResponse({ error: "Missing or invalid session token." }, 403);
  }
  return null;
}

function validateLocalOrigin(request: Request): Response | null {
  const origin = request.headers.get("Origin");
  if (!origin) {
    return null;
  }

  const requestURL = new URL(request.url);
  try {
    const originURL = new URL(origin);
    if (
      originURL.origin === requestURL.origin
      && isLoopbackHost(originURL.hostname)
      && isLoopbackHost(requestURL.hostname)
    ) {
      return null;
    }
  } catch {
    return jsonResponse({ error: "Invalid Origin." }, 403);
  }

  return jsonResponse({ error: "Forbidden Origin." }, 403);
}

function isLoopbackHost(hostname: string): boolean {
  const host = hostname.toLowerCase();
  return host === "localhost" || host === "127.0.0.1" || host === "::1" || host === "[::1]";
}

async function readJSONBody(request: Request): Promise<unknown> {
  try {
    return await request.json();
  } catch {
    throw new Error("Expected a JSON request body.");
  }
}

function stringField(value: unknown, key: string): string {
  if (!isRecord(value) || typeof value[key] !== "string" || value[key].trim() === "") {
    throw new Error(`${key} is required.`);
  }
  return value[key].trim();
}

function optionalStringField(value: unknown, key: string): string | undefined {
  if (!isRecord(value) || value[key] === undefined) {
    return undefined;
  }
  if (typeof value[key] !== "string") {
    throw new Error(`${key} must be a string.`);
  }
  return value[key];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function jsonResponse(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value, null, 2), {
    status,
    headers: {
      "Cache-Control": "no-store",
      "Content-Type": "application/json; charset=utf-8",
    },
  });
}

function htmlResponse(value: string): Response {
  return new Response(value, {
    headers: {
      "Cache-Control": "no-store",
      "Content-Type": "text/html; charset=utf-8",
    },
  });
}

function textResponse(value: string, status = 200): Response {
  return new Response(value, {
    status,
    headers: {
      "Cache-Control": "no-store",
      "Content-Type": "text/plain; charset=utf-8",
    },
  });
}

function fileResponse(path: string, contentType: string): Response {
  return new Response(Bun.file(path), {
    headers: {
      "Cache-Control": "no-store",
      "Content-Type": contentType,
    },
  });
}

function messageFromError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

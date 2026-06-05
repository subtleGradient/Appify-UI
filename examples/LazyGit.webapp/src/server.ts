import { join, resolve } from "node:path";
import type { ServerWebSocket } from "bun";
import { buildLazyGitCommand, resolveDefaultRepoPath, type LazyGitCommandSpec, type ResolveTool } from "./lazygit";
import {
  assetHeaders,
  createSessionSecrets,
  htmlHeaders,
  validateWebSocketAuthority,
  type SessionSecrets,
} from "./security";

export type ClientAssets = {
  js: string;
  css: string;
};

export type LazyGitWebappServerOptions = {
  packageRoot?: string;
  repoPath?: string;
  port?: number;
  environment?: Record<string, string | undefined>;
  resolveTool?: ResolveTool;
  session?: SessionSecrets;
  clientAssets?: ClientAssets;
};

export type LazyGitWebappServer = {
  server: Bun.Server;
  repoPath: string;
  session: SessionSecrets;
  stop(): void;
};

type ClientMessage =
  | { type: "input"; data: string }
  | { type: "resize"; cols: number; rows: number };

type WebSocketData = {
  commandSpec: LazyGitCommandSpec;
  process?: Bun.Subprocess;
};

const DEFAULT_COLS = 100;
const DEFAULT_ROWS = 32;
const MAX_CLIENT_MESSAGE_BYTES = 1024 * 1024;

export async function createLazyGitWebappServer(options: LazyGitWebappServerOptions = {}): Promise<LazyGitWebappServer> {
  const packageRoot = options.packageRoot ?? resolve(import.meta.dir, "..");
  const environment = options.environment ?? process.env;
  const repoPath = resolve(options.repoPath ?? resolveDefaultRepoPath(packageRoot, environment));
  const session = options.session ?? createSessionSecrets();
  const assetsPromise = options.clientAssets ? Promise.resolve(options.clientAssets) : buildClientAssets(packageRoot);
  const activeSockets = new Set<ServerWebSocket<WebSocketData>>();
  const activeProcesses = new Set<Bun.Subprocess>();
  const listenPort = resolveListenPort(options.port, environment.PORT);

  const server = serveWithPortFallback<WebSocketData>(listenPort, {
    hostname: "127.0.0.1",
    idleTimeout: 0,
    async fetch(request, bunServer) {
      const url = new URL(request.url);
      const isRead = request.method === "GET" || request.method === "HEAD";

      if (isRead && (url.pathname === "/" || url.pathname === "/index.html")) {
        return new Response(request.method === "HEAD" ? null : indexHTML(session), {
          headers: htmlHeaders(url, session),
        });
      }

      if (isRead && url.pathname === "/assets/client.js") {
        const assets = await assetsPromise;
        return new Response(request.method === "HEAD" ? null : assets.js, {
          headers: assetHeaders("text/javascript; charset=utf-8"),
        });
      }

      if (isRead && url.pathname === "/assets/client.css") {
        const assets = await assetsPromise;
        return new Response(request.method === "HEAD" ? null : assets.css, {
          headers: assetHeaders("text/css; charset=utf-8"),
        });
      }

      if (isRead && url.pathname === "/src/styles.css") {
        return new Response(request.method === "HEAD" ? null : Bun.file(join(packageRoot, "src", "styles.css")), {
          headers: assetHeaders("text/css; charset=utf-8"),
        });
      }

      if (isRead && url.pathname === "/assets/ghostty-vt.wasm") {
        return new Response(request.method === "HEAD" ? null : Bun.file(join(packageRoot, "node_modules", "@wterm", "ghostty", "wasm", "ghostty-vt.wasm")), {
          headers: assetHeaders("application/wasm"),
        });
      }

      if (url.pathname === "/pty") {
        const isWebSocket = request.headers.get("upgrade")?.toLowerCase() === "websocket";
        if (!isWebSocket) {
          return textResponse("WebSocket upgrade required.", 426);
        }

        const validation = validateWebSocketAuthority(request, session);
        if (!validation.ok) {
          return textResponse(validation.message, validation.status);
        }

        if (activeSockets.size > 0) {
          return textResponse("LazyGit.webapp already has an active terminal session.", 409);
        }

        let commandSpec: LazyGitCommandSpec;
        try {
          commandSpec = buildLazyGitCommand({
            repoPath,
            environment,
            resolveTool: options.resolveTool,
          });
        } catch (error) {
          return textResponse(errorMessage(error), 500);
        }

        const accepted = bunServer.upgrade(request, {
          data: { commandSpec },
        });
        return accepted ? new Response(null) : textResponse("Could not upgrade WebSocket.", 400);
      }

      return textResponse("Not found.", 404);
    },
    websocket: {
      open(socket) {
        activeSockets.add(socket);
        try {
          const child = startLazyGitPTY(socket, socket.data.commandSpec);
          socket.data.process = child;
          activeProcesses.add(child);
          void child.exited.then((exitCode) => {
            activeProcesses.delete(child);
            if (socket.readyState === WebSocket.OPEN) {
              socket.send(`\r\n\x1b[2mLazyGit exited with code ${exitCode}.\x1b[0m\r\n`);
              socket.close(1000, "lazygit exited");
            }
          }, (error) => {
            activeProcesses.delete(child);
            if (socket.readyState === WebSocket.OPEN) {
              socket.send(terminalError(errorMessage(error)));
              socket.close(1011, "lazygit failed");
            }
          });
        } catch (error) {
          if (socket.readyState === WebSocket.OPEN) {
            socket.send(terminalError(errorMessage(error)));
            socket.close(1011, "lazygit failed");
          }
        }
      },
      message(socket, message) {
        const parsed = parseClientMessage(message);
        if (parsed === null) {
          socket.close(1003, "unsupported message");
          return;
        }

        const terminal = socket.data.process?.terminal;
        if (!terminal) {
          return;
        }

        if (parsed.type === "input") {
          terminal.write(parsed.data);
        } else {
          terminal.resize(parsed.cols, parsed.rows);
        }
      },
      close(socket) {
        activeSockets.delete(socket);
        stopProcess(socket.data.process);
        if (socket.data.process) {
          activeProcesses.delete(socket.data.process);
          socket.data.process = undefined;
        }
      },
    },
  });

  return {
    server,
    repoPath,
    session,
    stop() {
      for (const socket of activeSockets) {
        socket.close(1001, "server stopping");
      }
      for (const child of activeProcesses) {
        stopProcess(child);
      }
      server.stop(true);
    },
  };
}

export function parseClientMessage(message: string | Buffer): ClientMessage | null {
  const text = typeof message === "string" ? message : new TextDecoder().decode(message);
  if (text.length > MAX_CLIENT_MESSAGE_BYTES) {
    return null;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return null;
  }

  if (!isRecord(parsed) || typeof parsed.type !== "string") {
    return null;
  }

  if (parsed.type === "input" && typeof parsed.data === "string") {
    return { type: "input", data: parsed.data };
  }

  if (parsed.type === "resize") {
    const cols = Number(parsed.cols);
    const rows = Number(parsed.rows);
    if (Number.isInteger(cols) && Number.isInteger(rows) && cols > 0 && rows > 0 && cols <= 1000 && rows <= 1000) {
      return { type: "resize", cols, rows };
    }
  }

  return null;
}

export function resolveListenPort(optionPort: number | undefined, environmentPort: string | undefined): number | null {
  if (optionPort !== undefined && optionPort !== 0) {
    return requireValidPort(optionPort, "port");
  }

  const value = environmentPort?.trim();
  if (value && value !== "0") {
    return requireValidPort(Number(value), "PORT");
  }

  return null;
}

function requireValidPort(port: number, label: string): number {
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(`${label} must be an integer from 1 to 65535.`);
  }
  return port;
}

function serveWithPortFallback<T>(requestedPort: number | null, config: Omit<Bun.Serve<T>, "port">): Bun.Server {
  if (requestedPort !== null) {
    return Bun.serve<T>({ ...config, port: requestedPort });
  }

  let lastError: unknown;
  for (const port of candidatePorts()) {
    try {
      return Bun.serve<T>({ ...config, port });
    } catch (error) {
      lastError = error;
      if (!isAddressInUse(error)) {
        throw error;
      }
    }
  }

  throw lastError instanceof Error ? lastError : new Error("Could not bind a loopback port.");
}

function candidatePorts(): number[] {
  const min = 30000;
  const max = 49151;
  const span = max - min + 1;
  const values = new Uint16Array(1);
  crypto.getRandomValues(values);
  const start = min + (values[0]! % span);
  return Array.from({ length: 2048 }, (_value, index) => min + ((start - min + index) % span));
}

function isAddressInUse(error: unknown): boolean {
  return error instanceof Error && "code" in error && (error as Error & { code?: string }).code === "EADDRINUSE";
}

async function buildClientAssets(packageRoot: string): Promise<ClientAssets> {
  const result = await Bun.build({
    entrypoints: [join(packageRoot, "src", "client.ts")],
    target: "browser",
    minify: false,
    sourcemap: "inline",
  });

  if (!result.success) {
    const messages = result.logs.map((log) => log.message).join("\n");
    throw new Error(`Could not build LazyGit.webapp client:\n${messages}`);
  }

  let js = "";
  let css = "";
  for (const output of result.outputs) {
    if (output.path.endsWith(".js")) {
      js = await output.text();
    } else if (output.path.endsWith(".css")) {
      css += await output.text();
    }
  }

  if (!js) {
    throw new Error("LazyGit.webapp client build did not produce JavaScript.");
  }

  return { js, css };
}

function startLazyGitPTY(socket: ServerWebSocket<WebSocketData>, spec: LazyGitCommandSpec): Bun.Subprocess {
  return Bun.spawn(spec.command, {
    cwd: spec.cwd,
    env: spec.env,
    terminal: {
      cols: DEFAULT_COLS,
      rows: DEFAULT_ROWS,
      name: "xterm-256color",
      data(_terminal, data) {
        if (socket.readyState === WebSocket.OPEN) {
          socket.send(data);
        }
      },
    },
  });
}

function stopProcess(child: Bun.Subprocess | undefined): void {
  if (!child) {
    return;
  }
  try {
    child.terminal?.close();
  } catch {}
  try {
    child.kill("SIGTERM");
  } catch {}
}

function indexHTML(session: SessionSecrets): string {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <meta name="color-scheme" content="dark light" />
    <title>LazyGit</title>
    <link rel="stylesheet" href="/src/styles.css" />
    <link rel="stylesheet" href="/assets/client.css" />
    <script nonce="${session.cspNonce}" type="module" src="/assets/client.js"></script>
  </head>
  <body>
    <main class="app-shell" aria-label="LazyGit terminal">
      <header class="topbar">
        <div class="brand">
          <span class="brand-mark" aria-hidden="true"></span>
          <h1>LazyGit</h1>
        </div>
        <p id="connection-status" class="connection-status">Starting</p>
      </header>
      <section class="terminal-shell" aria-label="Terminal">
        <div id="terminal" class="terminal" tabindex="0"></div>
      </section>
    </main>
  </body>
</html>`;
}

function textResponse(message: string, status = 200): Response {
  return new Response(message, {
    status,
    headers: assetHeaders("text/plain; charset=utf-8"),
  });
}

function terminalError(message: string): string {
  return `\r\n\x1b[31m${message}\x1b[0m\r\n`;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

if (import.meta.main) {
  const app = await createLazyGitWebappServer();
  for (const signal of ["SIGINT", "SIGTERM"] as const) {
    process.on(signal, () => {
      app.stop();
      process.exit(0);
    });
  }

  console.log(`LazyGit.webapp serving ${app.repoPath}`);
  console.log(`LazyGit.webapp: ${app.server.url}`);
}

import { join, resolve } from "node:path";
import { createMcpHttpHandler } from "../src/mcpServer";
import { defaultRepoRoot } from "../src/scriptCatalog";
import { ScriptRunner } from "../src/scriptRunner";

const packageRoot = resolve(import.meta.dir, "..");
const repoRoot = defaultRepoRoot();
const runner = new ScriptRunner({ repoRoot });
const mcpHandler = await createMcpHttpHandler({ runner, repoRoot });
const frontend = await buildFrontend();

const server = Bun.serve({
  hostname: "127.0.0.1",
  port: Number(process.env.PORT || 0),
  idleTimeout: 0,
  async fetch(request) {
    const url = new URL(request.url);

    if (url.pathname === "/mcp") {
      return await mcpHandler(request);
    }

    if (url.pathname === "/" || url.pathname === "/index.html") {
      return fileResponse(join(packageRoot, "index.html"), "text/html; charset=utf-8");
    }

    if (url.pathname === "/src/styles.css") {
      return fileResponse(join(packageRoot, "src", "styles.css"), "text/css; charset=utf-8");
    }

    if (url.pathname === "/assets/frontend.js") {
      return new Response(frontend, {
        headers: {
          "Content-Type": "text/javascript; charset=utf-8",
          "Cache-Control": "no-store",
        },
      });
    }

    return new Response("Not found", {
      status: 404,
      headers: { "Content-Type": "text/plain; charset=utf-8" },
    });
  },
});

console.log(`Appify UI serving ${repoRoot}`);
console.log(`APPIFY_HOST_OPEN_URL=${server.url}`);

async function buildFrontend(): Promise<string> {
  const result = await Bun.build({
    entrypoints: [join(packageRoot, "src", "frontend.ts")],
    target: "browser",
    minify: false,
    sourcemap: "inline",
  });

  if (!result.success) {
    const messages = result.logs.map((log) => log.message).join("\n");
    throw new Error(`Could not build frontend:\n${messages}`);
  }

  return await result.outputs[0].text();
}

function fileResponse(path: string, contentType: string): Response {
  return new Response(Bun.file(path), {
    headers: {
      "Content-Type": contentType,
      "Cache-Control": "no-store",
    },
  });
}

import { describe, expect, test } from "bun:test";
import { createMcpHttpHandler } from "../src/mcpServer";
import { defaultRepoRoot } from "../src/scriptCatalog";
import { ScriptRunner, type SpawnCommand } from "../src/scriptRunner";

const repoRoot = defaultRepoRoot();
const protocolVersion = "2025-06-18";

describe("MCP server", () => {
  test("serves tools through Streamable HTTP", async () => {
    const handler = await createHandler();
    await initialize(handler);

    const result = await rpc(handler, "tools/call", {
      name: "appify.list_scripts",
      arguments: {},
    });

    expect(result.structuredContent.scripts.map((script: { id: string }) => script.id)).toContain("verify-root-apps");
  });

  test("serves resources through Streamable HTTP", async () => {
    const handler = await createHandler();
    await initialize(handler);

    const result = await rpc(handler, "resources/read", {
      uri: "appify://scripts",
    });
    const payload = JSON.parse(result.contents[0].text);

    expect(payload.repoRoot).toBe(repoRoot);
    expect(payload.scripts.map((script: { id: string }) => script.id)).toContain("appify-host-lib");
  });

  test("runs an allowlisted script through appify.run_script", async () => {
    const handler = await createHandler(() => ({
      stdout: streamFromText("transport ok\n"),
      stderr: null,
      exited: Promise.resolve(0),
      kill() {},
    }));
    await initialize(handler);

    const result = await rpc(handler, "tools/call", {
      name: "appify.run_script",
      arguments: { scriptId: "verify-root-apps" },
    });

    expect(result.structuredContent.scriptId).toBe("verify-root-apps");
    expect(result.structuredContent.status).toBe("running");
  });

  test("rejects non-local origins before transport handling", async () => {
    const handler = await createHandler();
    const response = await handler(new Request("http://127.0.0.1/mcp", {
      method: "POST",
      headers: {
        "Origin": "https://example.com",
        "Accept": "application/json, text/event-stream",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }),
    }));

    expect(response.status).toBe(403);
  });
});

async function createHandler(spawn?: SpawnCommand) {
  const runner = new ScriptRunner({
    repoRoot,
    spawn: spawn ?? (() => ({
      stdout: null,
      stderr: null,
      exited: Promise.resolve(0),
      kill() {},
    })),
  });
  return await createMcpHttpHandler({ runner, repoRoot });
}

async function initialize(handler: (request: Request) => Promise<Response>) {
  await rpc(handler, "initialize", {
    protocolVersion,
    capabilities: {},
    clientInfo: {
      name: "appify-ui-test",
      version: "0.1.0",
    },
  });
  await handler(new Request("http://127.0.0.1/mcp", {
    method: "POST",
    headers: headers(),
    body: JSON.stringify({
      jsonrpc: "2.0",
      method: "notifications/initialized",
      params: {},
    }),
  }));
}

let nextId = 1;

async function rpc(handler: (request: Request) => Promise<Response>, method: string, params: unknown): Promise<any> {
  const id = nextId++;
  const response = await handler(new Request("http://127.0.0.1/mcp", {
    method: "POST",
    headers: headers(),
    body: JSON.stringify({
      jsonrpc: "2.0",
      id,
      method,
      params,
    }),
  }));

  expect(response.status).toBeLessThan(400);
  const message = await readRpcResponse(response, id);
  if (message.error) {
    throw new Error(message.error.message);
  }
  return message.result;
}

function headers(): HeadersInit {
  return {
    "Accept": "application/json, text/event-stream",
    "Content-Type": "application/json",
    "MCP-Protocol-Version": protocolVersion,
    "Origin": "http://127.0.0.1",
  };
}

async function readRpcResponse(response: Response, id: number): Promise<any> {
  const text = await response.text();
  if ((response.headers.get("content-type") ?? "").includes("text/event-stream")) {
    const messages = text
      .split(/\n\n+/)
      .flatMap((event) => {
        const data = event
          .split(/\n/)
          .filter((line) => line.startsWith("data:"))
          .map((line) => line.slice(5).trimStart())
          .join("\n");
        return data ? [JSON.parse(data)] : [];
      });
    const message = messages.find((candidate) => candidate.id === id);
    if (!message) {
      throw new Error(`No response for ${id}: ${text}`);
    }
    return message;
  }
  return JSON.parse(text);
}

function streamFromText(text: string): ReadableStream<Uint8Array> {
  return new ReadableStream({
    start(controller) {
      controller.enqueue(new TextEncoder().encode(text));
      controller.close();
    },
  });
}

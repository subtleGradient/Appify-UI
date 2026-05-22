import { afterEach, beforeEach, expect, test } from "bun:test";
import { randomUUID } from "node:crypto";
import { mkdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { DOCUMENT_API_PATH, type JSONCanvasDocument } from "../src/jsonCanvas";

let rootPath = "";
let canvasFilePath = "";

beforeEach(async () => {
  rootPath = join(process.cwd(), ".canvas-test", `server-${randomUUID()}`);
  canvasFilePath = join(rootPath, "server.canvas");
  await mkdir(rootPath, { recursive: true });
});

afterEach(async () => {
  if (rootPath) {
    await rm(rootPath, { force: true, recursive: true });
  }
});

async function readStream(stream: ReadableStream<Uint8Array> | null) {
  if (!stream) {
    return "";
  }

  return await new Response(stream).text();
}

async function startServer() {
  const child = Bun.spawn({
    cmd: ["bun", "src/index.ts", canvasFilePath],
    cwd: process.cwd(),
    stdout: "pipe",
    stderr: "pipe",
    env: {
      ...process.env,
      NODE_ENV: "test",
    },
  });

  let output = "";
  const decoder = new TextDecoder();
  const deadline = Date.now() + 5000;

  while (Date.now() < deadline) {
    const chunk = await child.stdout.getReader().read();
    if (chunk.done) {
      break;
    }

    output += decoder.decode(chunk.value);
    const match = output.match(/APPIFY_HOST_OPEN_URL=(http:\/\/127\.0\.0\.1:\d+\/)/);
    if (match) {
      return {
        process: child,
        url: new URL(DOCUMENT_API_PATH, match[1]).toString(),
      };
    }
  }

  const stderr = await readStream(child.stderr);
  child.kill();
  throw new Error(`Timed out waiting for server URL.\nstdout: ${output}\nstderr: ${stderr}`);
}

async function stopServer(process: Bun.Subprocess<"ignore" | "pipe" | "inherit", "ignore" | "pipe" | "inherit", "ignore" | "pipe" | "inherit">) {
  process.kill();
  await process.exited;
}

test("serves a .canvas file payload and writes edits", async () => {
  const initialDocument: JSONCanvasDocument = {
    nodes: [
      {
        id: "a",
        type: "text",
        text: "A",
        x: 0,
        y: 0,
        width: 200,
        height: 100,
      },
    ],
    edges: [],
  };
  await Bun.write(canvasFilePath, `${JSON.stringify(initialDocument, null, 2)}\n`);

  const { process, url } = await startServer();
  try {
    const getResponse = await fetch(url);
    const getBody = await getResponse.json() as {
      digest: string;
      document: JSONCanvasDocument;
    };

    expect(getResponse.status).toBe(200);
    expect(getBody.document).toEqual(initialDocument);

    const nextDocument: JSONCanvasDocument = {
      nodes: [
        {
          ...initialDocument.nodes[0]!,
          text: "Updated",
        },
      ],
      edges: [],
    };
    const putResponse = await fetch(url, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        digest: getBody.digest,
        document: nextDocument,
      }),
    });
    const putBody = await putResponse.json() as { document: JSONCanvasDocument };

    expect(putResponse.status).toBe(200);
    expect(putBody.document).toEqual(nextDocument);
    expect(await Bun.file(canvasFilePath).text()).toContain('"text": "Updated"');
  } finally {
    await stopServer(process);
  }
});

test("rejects stale saves", async () => {
  const { process, url } = await startServer();
  try {
    const getBody = await (await fetch(url)).json() as {
      digest: string;
      document: JSONCanvasDocument;
    };
    await Bun.write(canvasFilePath, JSON.stringify({ nodes: [], edges: [] }));

    const response = await fetch(url, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        digest: getBody.digest,
        document: getBody.document,
      }),
    });
    const body = await response.json() as { error: string };

    expect(response.status).toBe(409);
    expect(body.error).toContain("changed on disk");
  } finally {
    await stopServer(process);
  }
});

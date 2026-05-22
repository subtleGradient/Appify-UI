import { afterEach, beforeEach, expect, test } from "bun:test";
import { randomUUID } from "node:crypto";
import { mkdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { createSourceHash, SAVE_API_PATH } from "../src/webform";

let documentPath = "";

beforeEach(async () => {
  documentPath = join(process.cwd(), ".webform-test", `${randomUUID()}.webform`);
  await mkdir(join(process.cwd(), ".webform-test"), { recursive: true });
  await Bun.write(documentPath, `<!doctype html>
<meta charset=utf-8>
<title>Server Test</title>
<form><input value=before><textarea>notes</textarea></form>`);
});

afterEach(async () => {
  await rm(join(process.cwd(), ".webform-test"), { force: true, recursive: true });
});

async function readStream(stream: ReadableStream<Uint8Array> | null): Promise<string> {
  if (!stream) {
    return "";
  }
  return await new Response(stream).text();
}

async function startServer() {
  const child = Bun.spawn({
    cmd: ["bun", "src/index.ts", documentPath],
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
  const reader = child.stdout.getReader();

  while (Date.now() < deadline) {
    const chunk = await reader.read();
    if (chunk.done) {
      break;
    }

    output += decoder.decode(chunk.value);
    const match = output.match(/APPIFY_HOST_OPEN_URL=(http:\/\/127\.0\.0\.1:\d+\/document)/);
    if (match) {
      return {
        process: child,
        url: match[1],
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

test("serves the opened webform with injected runtime", async () => {
  const { process, url } = await startServer();

  try {
    const response = await fetch(url);
    const html = await response.text();

    expect(response.status).toBe(200);
    expect(html).toContain("<title>Server Test</title>");
    expect(html).toContain("__webformer_bar");
    expect(html).toContain("name=color-scheme");
    expect(html).toContain("__webformer_default_style");
    expect(html).toContain("ui-sans-serif");
    expect(html).not.toContain("name=\"viewport\"");
  } finally {
    await stopServer(process);
  }
});

test("saves posted field values back to the single webform file", async () => {
  const { process, url } = await startServer();

  try {
    const source = await Bun.file(documentPath).text();
    const response = await fetch(new URL(SAVE_API_PATH, url), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        sourceHash: createSourceHash(source),
        formIndex: null,
        fields: [
          { key: "f0", value: "after" },
          { key: "f1", value: "saved <notes>" },
        ],
      }),
    });
    const body = await response.json() as { savedFieldCount?: number };

    expect(response.status).toBe(200);
    expect(body.savedFieldCount).toBe(2);
    expect(await Bun.file(documentPath).text()).toContain("<input value=after>");
    expect(await Bun.file(documentPath).text()).toContain("<textarea>saved &lt;notes></textarea>");
  } finally {
    await stopServer(process);
  }
});

import { randomBytes } from "node:crypto";
import { createServer } from "node:net";

const configuredPassword = process.env.OPENCODE_SERVER_PASSWORD;
const hasConfiguredPassword = configuredPassword !== undefined && configuredPassword.length > 0;
const serverPassword = hasConfiguredPassword
  ? configuredPassword
  : randomBytes(24).toString("base64url");
const serverUsername = process.env.OPENCODE_SERVER_USERNAME || "opencode";
const serverPort = await availableLoopbackPort();

console.error("Starting OpenCode without browser auto-open.");
console.error(`OpenCode bind: 127.0.0.1:${serverPort}`);

const child = Bun.spawn({
  cmd: ["opencode", "serve", "--hostname", "127.0.0.1", "--port", String(serverPort)],
  env: {
    ...process.env,
    OPENCODE_SERVER_PASSWORD: serverPassword,
    OPENCODE_SERVER_USERNAME: serverUsername,
  },
  stdin: "inherit",
  stdout: "pipe",
  stderr: "pipe",
});

const forwardSignal = (signal: "SIGINT" | "SIGTERM") => {
  child.kill(signal);
};

process.on("SIGINT", () => forwardSignal("SIGINT"));
process.on("SIGTERM", () => forwardSignal("SIGTERM"));

const pumps = [
  pumpOutput(child.stdout, process.stdout),
  pumpOutput(child.stderr, process.stderr),
];
const [exitCode] = await Promise.all([child.exited, ...pumps]);
process.exit(exitCode);

async function availableLoopbackPort(): Promise<number> {
  return await new Promise((resolve, reject) => {
    const server = createServer();
    server.unref();
    server.on("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (typeof address !== "object" || address === null) {
        reject(new Error("Could not reserve a loopback port for OpenCode."));
        return;
      }

      const { port } = address;
      server.close((error) => {
        if (error) {
          reject(error);
          return;
        }
        resolve(port);
      });
    });
  });
}

async function pumpOutput(
  stream: ReadableStream<Uint8Array> | null,
  sink: NodeJS.WriteStream,
): Promise<void> {
  if (stream === null) {
    return;
  }

  const decoder = new TextDecoder();
  let buffer = "";
  for await (const chunk of stream) {
    buffer += decoder.decode(chunk, { stream: true });
    buffer = writeCompleteLines(buffer, sink);
  }

  buffer += decoder.decode();
  if (buffer.length > 0) {
    writeLine(buffer, sink, false);
  }
}

function writeCompleteLines(buffer: string, sink: NodeJS.WriteStream): string {
  let lineStart = 0;
  for (;;) {
    const newlineIndex = buffer.indexOf("\n", lineStart);
    if (newlineIndex === -1) {
      break;
    }

    writeLine(buffer.slice(lineStart, newlineIndex), sink, true);
    lineStart = newlineIndex + 1;
  }
  return buffer.slice(lineStart);
}

function writeLine(line: string, sink: NodeJS.WriteStream, newline: boolean): void {
  const match = line.match(/opencode server listening on (https?:\/\/[^\s]+)/);
  if (match?.[1] !== undefined) {
    const authenticatedURL = authenticatedURLFor(match[1]);
    process.stdout.write(`OpenCode Web URL: ${authenticatedURL}\n`);
    return;
  }

  sink.write(`${line}${newline ? "\n" : ""}`);
}

function authenticatedURLFor(rawURL: string): string {
  const url = new URL(rawURL);
  url.username = serverUsername;
  url.password = serverPassword;
  return url.href;
}

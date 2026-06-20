import { randomBytes } from "node:crypto";
import { createServer } from "node:net";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createOpencodeServer } from "@opencode-ai/sdk";

const configuredPassword = process.env.OPENCODE_SERVER_PASSWORD;
const hasConfiguredPassword = configuredPassword !== undefined && configuredPassword.length > 0;
const serverPassword = hasConfiguredPassword
  ? configuredPassword
  : randomBytes(24).toString("base64url");
const serverUsername = process.env.OPENCODE_SERVER_USERNAME || "opencode";
const serverPort = await availableLoopbackPort();

process.env.OPENCODE_SERVER_PASSWORD = serverPassword;
process.env.OPENCODE_SERVER_USERNAME = serverUsername;
process.env.PATH = pathWithLocalBin();

console.error("Starting OpenCode without browser auto-open.");
console.error(`OpenCode bind: 127.0.0.1:${serverPort}`);

const server = await createOpencodeServer({
  hostname: "127.0.0.1",
  port: serverPort,
});
console.log(`OpenCode Web URL: ${authenticatedURLFor(server.url)}`);

await waitForShutdown(server.close);

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

function authenticatedURLFor(rawURL: string): string {
  const url = new URL(rawURL);
  url.username = serverUsername;
  url.password = serverPassword;
  return url.href;
}

function pathWithLocalBin(): string {
  const scriptDirectory = dirname(fileURLToPath(import.meta.url));
  const packageDirectory = dirname(scriptDirectory);
  const localBin = join(packageDirectory, "node_modules", ".bin");
  const currentPath = process.env.PATH ?? "";
  return currentPath.length > 0 ? `${localBin}:${currentPath}` : localBin;
}

async function waitForShutdown(closeServer: () => void): Promise<never> {
  await new Promise<void>((resolve) => {
    const shutdown = () => {
      process.off("SIGINT", shutdown);
      process.off("SIGTERM", shutdown);
      closeServer();
      resolve();
    };

    process.on("SIGINT", shutdown);
    process.on("SIGTERM", shutdown);
  });
  process.exit(0);
}

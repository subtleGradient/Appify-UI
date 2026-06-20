import { createServer } from "node:net";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createOpencodeServer } from "@opencode-ai/sdk";

const serverPort = await availableLoopbackPort();

delete process.env.OPENCODE_SERVER_PASSWORD;
delete process.env.OPENCODE_SERVER_USERNAME;
process.env.PATH = pathWithLocalBin();

console.error("Starting OpenCode without browser auto-open.");
console.error(`OpenCode bind: 127.0.0.1:${serverPort}`);
console.error("OpenCode is reachable only from this Mac through the loopback interface.");

const server = await createOpencodeServer({
  hostname: "127.0.0.1",
  port: serverPort,
});
console.log(`OpenCode Web URL: ${server.url}`);

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

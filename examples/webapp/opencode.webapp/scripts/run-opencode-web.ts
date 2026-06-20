import { createServer } from "node:net";
import { basename, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createOpencodeClient, createOpencodeServer } from "@opencode-ai/sdk";

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const packageDirectory = dirname(scriptDirectory);
const serverPort = await availableLoopbackPort();

delete process.env.OPENCODE_SERVER_PASSWORD;
delete process.env.OPENCODE_SERVER_USERNAME;
process.env.PATH = pathWithLocalBin(packageDirectory);

console.error("Starting OpenCode without browser auto-open.");
console.error(`OpenCode bind: 127.0.0.1:${serverPort}`);
console.error("OpenCode is reachable only from this Mac through the loopback interface.");

const server = await createOpencodeServer({
  hostname: "127.0.0.1",
  port: serverPort,
});

const client = createOpencodeClient({
  baseUrl: server.url,
  directory: packageDirectory,
});
try {
  const sessionResult = await client.session.create({
    body: { title: basename(packageDirectory) },
    throwOnError: true,
  });
  const session = sessionResult.data;
  const sessionUrl = new URL(
    `/${directoryRouteSegment(session.directory)}/session/${session.id}`,
    server.url,
  );
  console.error(`OpenCode session: ${session.id}`);
  console.log(`OpenCode Web URL: ${sessionUrl.href}`);
} catch (error) {
  server.close();
  throw error;
}

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

function pathWithLocalBin(packageDirectory: string): string {
  const localBin = join(packageDirectory, "node_modules", ".bin");
  const currentPath = process.env.PATH ?? "";
  return currentPath.length > 0 ? `${localBin}:${currentPath}` : localBin;
}

function directoryRouteSegment(directory: string): string {
  return Buffer.from(directory, "utf8").toString("base64url");
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

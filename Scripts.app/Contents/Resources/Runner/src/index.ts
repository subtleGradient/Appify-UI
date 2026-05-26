import { createScriptsServer } from "./server";
import { resolveScriptsDocumentPath, resolveScriptsWorkingDirectory } from "./scriptCatalog";

const documentPath = await resolveScriptsDocumentPath(process.argv[2] || process.env.APPIFY_HOST_DOCUMENT_PATH);
const workingDirectory = await resolveScriptsWorkingDirectory(
  documentPath,
  process.argv[3] || process.env.APPIFY_HOST_WORKING_DIRECTORY,
);
const scriptsServer = await createScriptsServer({
  documentPath,
  workingDirectory,
  port: resolveServerPort(),
  basePath: process.env.APPIFY_HOST_PREFERRED_BASE_PATH,
});

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    scriptsServer.server.stop(true);
    process.exit(0);
  });
}

console.log(`Scripts serving ${workingDirectory}`);
console.log(`APPIFY_HOST_OPEN_URL=${scriptsServer.url}`);

function resolveServerPort(): number | undefined {
  const value = process.env.PORT?.trim();
  if (value === undefined || value === "" || value === "0") {
    return undefined;
  }

  const port = Number(value);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(`PORT must be an integer from 1 to 65535, got ${process.env.PORT}.`);
  }
  return port;
}

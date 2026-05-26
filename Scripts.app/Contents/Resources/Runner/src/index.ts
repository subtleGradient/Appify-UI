import { createScriptsServer } from "./server";
import { resolveScriptsDocumentPath, resolveScriptsWorkingDirectory } from "./scriptCatalog";

const documentPath = await resolveScriptsDocumentPath(process.argv[2] || process.env.APPIFY_HOST_DOCUMENT_PATH);
const workingDirectory = await resolveScriptsWorkingDirectory(
  documentPath,
  process.argv[3] || process.env.APPIFY_HOST_WORKING_DIRECTORY,
);
const scriptsServer = await createScriptsServer({ documentPath, workingDirectory });

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    scriptsServer.server.stop(true);
    process.exit(0);
  });
}

console.log(`Scripts serving ${workingDirectory}`);
console.log(`APPIFY_HOST_OPEN_URL=${scriptsServer.url}`);

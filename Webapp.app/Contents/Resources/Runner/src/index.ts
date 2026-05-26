import {
  createBunCommandExecutor,
  resolveWebappDocumentPath,
  resolveWebappRunRoot,
  runWebappLifecycle,
} from "./webappPackage";

const documentPath = await resolveWebappDocumentPath(process.argv[2] || process.env.APPIFY_HOST_DOCUMENT_PATH);
const runRoot = await resolveWebappRunRoot(documentPath);
const executor = createBunCommandExecutor(process.env);

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    executor.stopAll(signal);
    process.exit(0);
  });
}

const exitCode = await runWebappLifecycle(runRoot, { executor });
process.exit(exitCode);

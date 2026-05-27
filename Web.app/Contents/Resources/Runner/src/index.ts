import { watch } from "node:fs";
import { basename, resolve } from "node:path";
import {
  buildHtmlRoutes,
  createDirectoryListingResponse,
  createLocalStoragePersistenceRoutes,
  createReloadBroadcaster,
  findRootEntry,
  isHtmlFile,
  isIgnoredReloadPath,
  isMarkdownFile,
  readFileResponse,
  renderMarkdownResponse,
  resolveDocumentPath,
  resolveLocalStorageFilePath,
  resolveRequestPath,
  resolveServerPort,
  resolveServeRoot,
  scanHtmlPages,
} from "./webPackage";

const documentPath = resolveDocumentPath(process.argv[2] || process.env.APPIFY_HOST_DOCUMENT_PATH);
const serveRoot = await resolveServeRoot(documentPath);
const hmrEnabled = process.env.WEB_APP_HMR !== "0";
const reloader = createReloadBroadcaster();
const localStorageFilePath = await resolveLocalStorageFilePath(documentPath);
const htmlPages = await scanHtmlPages(serveRoot);
const rootEntry = await findRootEntry(serveRoot, htmlPages);
const routes = {
  ...createLocalStoragePersistenceRoutes(localStorageFilePath, serveRoot),
  ...(await buildHtmlRoutes(serveRoot, htmlPages, rootEntry, hmrEnabled, {
    localStoragePersistence: true,
  })),
};

if (hmrEnabled) {
  try {
    const watcher = watch(serveRoot, { recursive: true }, (_eventType, fileName) => {
      if (isIgnoredReloadPath(serveRoot, fileName)) {
        return;
      }
      reloader.broadcast();
    });
    for (const signal of ["SIGTERM", "SIGINT"] as const) {
      process.on(signal, () => {
        watcher.close();
        process.exit(0);
      });
    }
  } catch (error) {
    console.error(`Web live reload watcher could not start for ${serveRoot}:`, error);
  }
}

const server = Bun.serve({
  hostname: "127.0.0.1",
  port: await resolveServerPort(),
  idleTimeout: 0,
  routes,
  development: hmrEnabled && {
    hmr: true,
    console: true,
  },
  async fetch(request) {
    const url = new URL(request.url);

    if (hmrEnabled && url.pathname === "/_web/live-reload") {
      return reloader.response();
    }

    if (hmrEnabled && url.pathname === "/_web/live-reload-version") {
      return reloader.versionResponse();
    }

    const resolvedPath = await resolveRequestPath(serveRoot, url.pathname);
    if (resolvedPath === null) {
      return new Response("Not found", {
        status: 404,
        headers: { "Content-Type": "text/plain; charset=utf-8" },
      });
    }

    if (resolvedPath.kind === "directory") {
      if (!url.pathname.endsWith("/")) {
        return Response.redirect(`${url.pathname}/${url.search}`, 308);
      }
      return await createDirectoryListingResponse(serveRoot, resolvedPath.path, url.pathname, {
        liveReload: hmrEnabled,
        localStoragePersistence: true,
      });
    }

    if (isMarkdownFile(resolvedPath.path)) {
      return await renderMarkdownResponse(resolvedPath.path, {
        liveReload: hmrEnabled,
        localStoragePersistence: true,
        title: basename(resolvedPath.path),
      });
    }

    return await readFileResponse(resolvedPath.path, {
      liveReload: hmrEnabled && isHtmlFile(resolvedPath.path),
      localStoragePersistence: true,
    });
  },
});

console.log(`Web serving ${resolve(serveRoot)}`);
console.log(`APPIFY_HOST_OPEN_URL=${server.url}`);

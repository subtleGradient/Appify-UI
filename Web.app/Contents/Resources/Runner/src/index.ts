import { watch } from "node:fs";
import { basename, resolve } from "node:path";
import {
  buildHtmlRoutes,
  createDirectoryListingResponse,
  createReloadBroadcaster,
  findRootEntry,
  isHtmlFile,
  isMarkdownFile,
  readFileResponse,
  renderMarkdownResponse,
  resolveDocumentPath,
  resolveRequestPath,
  scanHtmlPages,
} from "./webPackage";

const documentPath = resolveDocumentPath(process.argv[2] || process.env.APPIFY_HOST_DOCUMENT_PATH);
const hmrEnabled = process.env.WEB_APP_HMR !== "0";
const reloader = createReloadBroadcaster();
const htmlPages = await scanHtmlPages(documentPath);
const rootEntry = await findRootEntry(documentPath, htmlPages);
const routes = await buildHtmlRoutes(documentPath, htmlPages, rootEntry, hmrEnabled);

if (hmrEnabled) {
  try {
    const watcher = watch(documentPath, { recursive: true }, () => {
      reloader.broadcast();
    });
    for (const signal of ["SIGTERM", "SIGINT"] as const) {
      process.on(signal, () => {
        watcher.close();
        process.exit(0);
      });
    }
  } catch (error) {
    console.error(`Web live reload watcher could not start for ${documentPath}:`, error);
  }
}

const server = Bun.serve({
  hostname: "127.0.0.1",
  port: Number(process.env.PORT || 0),
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

    const resolvedPath = await resolveRequestPath(documentPath, url.pathname);
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
      return await createDirectoryListingResponse(documentPath, resolvedPath.path, url.pathname, {
        liveReload: hmrEnabled,
      });
    }

    if (isMarkdownFile(resolvedPath.path)) {
      return await renderMarkdownResponse(resolvedPath.path, {
        liveReload: hmrEnabled,
        title: basename(resolvedPath.path),
      });
    }

    return await readFileResponse(resolvedPath.path, {
      liveReload: hmrEnabled && isHtmlFile(resolvedPath.path),
    });
  },
});

console.log(`Web serving ${resolve(documentPath)}`);
console.log(`APPIFY_HOST_OPEN_URL=${server.url}`);

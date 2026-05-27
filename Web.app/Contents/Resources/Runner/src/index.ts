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
  createPostedRequestPayload,
  resolveDocumentPath,
  resolveLocalStorageFilePath,
  resolveServerPort,
  resolveUnsupportedLegacyDynamicRequestPath,
  resolveWebSpace,
  resolveWebSpaceRequestPath,
  scanHtmlPages,
  webSpaceRouteRootPath,
} from "./webPackage";

const documentPath = resolveDocumentPath(process.argv[2] || process.env.APPIFY_HOST_DOCUMENT_PATH);
const webspace = await resolveWebSpace(documentPath);
const hmrEnabled = process.env.WEB_APP_HMR !== "0";
const reloader = createReloadBroadcaster();
const localStorageFilePath = await resolveLocalStorageFilePath(documentPath);
const htmlPages = await scanHtmlPages(webspace.activeRootPath);
const rootEntry = await findRootEntry(webspace.activeRootPath, htmlPages);
const routes = {
  ...createLocalStoragePersistenceRoutes(localStorageFilePath, webspace.activeRootPath, webspace.activeBasePath),
  ...(await buildHtmlRoutes(webspace.activeRootPath, htmlPages, rootEntry, hmrEnabled, {
    localStoragePersistence: true,
    controlBasePath: webspace.activeBasePath,
    routeBasePath: webspace.activeBasePath,
  })),
};
const liveReloadPath = new URL("_web/live-reload", `http://web.local${webspace.activeBasePath}`).pathname;
const liveReloadVersionPath = new URL("_web/live-reload-version", `http://web.local${webspace.activeBasePath}`).pathname;

if (hmrEnabled) {
  try {
    const watcher = watch(webspace.activeRootPath, { recursive: true }, (_eventType, fileName) => {
      if (isIgnoredReloadPath(webspace.activeRootPath, fileName)) {
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
    console.error(`Web live reload watcher could not start for ${webspace.activeRootPath}:`, error);
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
    const method = request.method.toUpperCase();

    if (hmrEnabled && url.pathname === liveReloadPath) {
      return reloader.response();
    }

    if (hmrEnabled && url.pathname === liveReloadVersionPath) {
      return reloader.versionResponse();
    }

    const resolvedPath = await resolveWebSpaceRequestPath(webspace, url.pathname);
    if (resolvedPath === null) {
      const unsupportedDynamicPath = await resolveUnsupportedLegacyDynamicRequestPath(webspace, url.pathname);
      if (unsupportedDynamicPath !== null) {
        return unsupportedLegacyDynamicResponse(url.pathname, unsupportedDynamicPath.extension);
      }

      return new Response("Not found", {
        status: 404,
        headers: { "Content-Type": "text/plain; charset=utf-8" },
      });
    }

    if (resolvedPath.kind === "directory") {
      if (method === "POST") {
        return methodNotAllowedResponse("GET, HEAD");
      }
      if (!url.pathname.endsWith("/")) {
        return Response.redirect(`${url.pathname}/${url.search}`, 308);
      }
      const isActivePath = isPathInside(webspace.activeRootPath, resolvedPath.path);
      return await createDirectoryListingResponse(webSpaceRouteRootPath(webspace, url.pathname), resolvedPath.path, url.pathname, {
        liveReload: hmrEnabled && isActivePath,
        localStoragePersistence: isActivePath,
        controlBasePath: webspace.activeBasePath,
      });
    }

    const isActivePath = isPathInside(webspace.activeRootPath, resolvedPath.path);
    if (method === "POST") {
      if (!isActivePath || !isHtmlFile(resolvedPath.path)) {
        return methodNotAllowedResponse("GET, HEAD");
      }

      try {
        return await readFileResponse(resolvedPath.path, {
          liveReload: hmrEnabled && isHtmlFile(resolvedPath.path),
          localStoragePersistence: true,
          controlBasePath: webspace.activeBasePath,
          postedRequest: await createPostedRequestPayload(request),
        });
      } catch (error) {
        const message = String(error);
        return new Response(message, {
          status: message.includes("too large") ? 413 : 400,
          headers: { "Content-Type": "text/plain; charset=utf-8" },
        });
      }
    }

    if (isMarkdownFile(resolvedPath.path)) {
      return await renderMarkdownResponse(resolvedPath.path, {
        liveReload: hmrEnabled && isActivePath,
        localStoragePersistence: isActivePath,
        controlBasePath: webspace.activeBasePath,
        title: basename(resolvedPath.path),
      });
    }

    return await readFileResponse(resolvedPath.path, {
      liveReload: hmrEnabled && isActivePath && isHtmlFile(resolvedPath.path),
      localStoragePersistence: isActivePath,
      controlBasePath: webspace.activeBasePath,
    });
  },
});

console.log(`Web serving ${resolve(webspace.activeRootPath)} from ${resolve(webspace.webspaceRootPath)} (${webspace.webspaceKind})`);
console.log(`APPIFY_HOST_OPEN_URL=${new URL(webspace.activeBasePath, server.url)}`);

function isPathInside(rootPath: string, candidatePath: string): boolean {
  const relativePath = candidatePath === rootPath ? "" : candidatePath.slice(rootPath.length);
  return relativePath === "" || relativePath.startsWith("/");
}

function methodNotAllowedResponse(allow: string): Response {
  return new Response("Method not allowed", {
    status: 405,
    headers: {
      "Allow": allow,
      "Content-Type": "text/plain; charset=utf-8",
    },
  });
}

function unsupportedLegacyDynamicResponse(requestPath: string, extension: string): Response {
  const shadowPath = `${requestPath}.html`;
  return new Response(
    [
      `Web.app does not run ${extension} server files.`,
      "",
      "On-disk file extensions are respected and feared. This local web runtime never executes bundle-provided server code.",
      `To serve a static compatibility page at this URL, create ${shadowPath}.`,
    ].join("\n"),
    {
      status: 501,
      headers: {
        "Content-Type": "text/plain; charset=utf-8",
      },
    },
  );
}

import { existsSync } from "node:fs";
import { dirname, extname, resolve, sep } from "node:path";
import {
  DOCUMENT_ROUTE_PATH,
  renderWebForm,
  SAVE_API_PATH,
  saveWebFormSource,
  writeWebFormAtomically,
} from "./webform";

const JSON_HEADERS = { "Content-Type": "application/json" };

function resolveDocumentPath(): string {
  const documentPath = process.argv[2] || process.env.APPIFY_HOST_DOCUMENT_PATH;
  if (!documentPath) {
    throw new Error("Expected a .webform document path as the last argument");
  }
  return resolve(documentPath);
}

function jsonResponse(data: unknown, init?: ResponseInit): Response {
  return new Response(JSON.stringify(data), {
    ...init,
    headers: {
      ...JSON_HEADERS,
      ...(init?.headers ?? {}),
    },
  });
}

async function readSource(documentPath: string): Promise<string> {
  if (!existsSync(documentPath)) {
    throw new Error(`${documentPath} does not exist.`);
  }
  return await Bun.file(documentPath).text();
}

function contentTypeFor(path: string): string {
  switch (extname(path).toLowerCase()) {
    case ".css":
      return "text/css; charset=utf-8";
    case ".gif":
      return "image/gif";
    case ".html":
    case ".htm":
    case ".webform":
      return "text/html; charset=utf-8";
    case ".jpg":
    case ".jpeg":
      return "image/jpeg";
    case ".js":
    case ".mjs":
      return "text/javascript; charset=utf-8";
    case ".json":
      return "application/json; charset=utf-8";
    case ".png":
      return "image/png";
    case ".svg":
      return "image/svg+xml; charset=utf-8";
    case ".txt":
      return "text/plain; charset=utf-8";
    case ".webp":
      return "image/webp";
    default:
      return "application/octet-stream";
  }
}

function resolveAssetPath(documentPath: string, requestPath: string): string | null {
  let decodedPath: string;
  try {
    decodedPath = decodeURIComponent(requestPath);
  } catch {
    return null;
  }

  if (decodedPath.includes("\0") || decodedPath.includes("\\")) {
    return null;
  }

  const documentDirectory = dirname(documentPath);
  const candidate = resolve(documentDirectory, `.${decodedPath}`);
  if (candidate !== documentDirectory && !candidate.startsWith(`${documentDirectory}${sep}`)) {
    return null;
  }
  if (candidate === documentPath) {
    return null;
  }
  return candidate;
}

async function handleSave(documentPath: string, request: Request): Promise<Response> {
  let body: Record<string, unknown>;
  try {
    body = await request.json() as Record<string, unknown>;
  } catch {
    return jsonResponse({
      diagnostics: [{ severity: "error", message: "Save request body must be JSON." }],
    }, { status: 400 });
  }

  if (body.sourceHash === undefined) {
    body.sourceHash = request.headers.get("if-match") ?? undefined;
  }

  const currentSource = await readSource(documentPath);
  const result = await saveWebFormSource(currentSource, body);
  if (!result.ok) {
    return jsonResponse({ diagnostics: result.diagnostics }, { status: result.status });
  }

  await writeWebFormAtomically(documentPath, result.source);
  return jsonResponse({
    sourceHash: result.sourceHash,
    savedFieldCount: result.savedFieldCount,
  });
}

const documentPath = resolveDocumentPath();
const documentName = documentPath.split(sep).at(-1) ?? "document.webform";

for (const signal of ["SIGTERM", "SIGINT"] as const) {
  process.on(signal, () => {
    process.exit(0);
  });
}

const server = Bun.serve({
  hostname: "127.0.0.1",
  port: Number(process.env.PORT || 0),
  async fetch(request) {
    const url = new URL(request.url);

    if (request.method === "GET" && (url.pathname === "/" || url.pathname === DOCUMENT_ROUTE_PATH)) {
      try {
        return await renderWebForm(await readSource(documentPath), documentName);
      } catch (error) {
        return new Response(error instanceof Error ? error.message : String(error), {
          status: 500,
          headers: { "Content-Type": "text/plain; charset=utf-8" },
        });
      }
    }

    if (url.pathname === SAVE_API_PATH) {
      if (request.method !== "POST") {
        return jsonResponse({ error: "Use POST to save a webform." }, { status: 405 });
      }
      try {
        return await handleSave(documentPath, request);
      } catch (error) {
        console.error("Failed to save webform", error);
        return jsonResponse({
          diagnostics: [{ severity: "error", message: "Failed to save the .webform file." }],
        }, { status: 500 });
      }
    }

    if (request.method === "GET" || request.method === "HEAD") {
      const assetPath = resolveAssetPath(documentPath, url.pathname);
      if (assetPath !== null && existsSync(assetPath)) {
        return new Response(request.method === "HEAD" ? null : Bun.file(assetPath), {
          headers: {
            "Content-Type": contentTypeFor(assetPath),
            "Cache-Control": "no-store",
          },
        });
      }
    }

    return new Response("Not found", {
      status: 404,
      headers: { "Content-Type": "text/plain; charset=utf-8" },
    });
  },
});

console.log(`APPIFY_HOST_OPEN_URL=${new URL(DOCUMENT_ROUTE_PATH, server.url)}`);

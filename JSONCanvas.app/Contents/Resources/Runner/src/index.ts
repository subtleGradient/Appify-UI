import { serve } from "bun";
import { basename, extname, resolve } from "node:path";
import index from "./index.html";
import {
  DOCUMENT_API_PATH,
  type JSONCanvasDocument,
  readJSONCanvasDocument,
  writeJSONCanvasDocument,
} from "./jsonCanvas";

const JSON_HEADERS = { "Content-Type": "application/json" };

function createJsonResponse(data: unknown, init?: ResponseInit) {
  return new Response(JSON.stringify(data), {
    ...init,
    headers: {
      ...JSON_HEADERS,
      ...(init?.headers ?? {}),
    },
  });
}

function resolveDocumentPath() {
  const documentPath = process.argv[2] || process.env.APPIFY_HOST_DOCUMENT_PATH;
  if (!documentPath) {
    throw new Error("Expected a .canvas document path as the last argument.");
  }

  const resolved = resolve(documentPath);
  if (extname(resolved).toLowerCase() !== ".canvas") {
    throw new Error(`Expected a .canvas document path, got ${resolved}.`);
  }

  return resolved;
}

function summarizeDocument(document: JSONCanvasDocument) {
  return {
    nodeCount: document.nodes.length,
    edgeCount: document.edges.length,
    textNodeCount: document.nodes.filter((node) => node.type === "text").length,
    fileNodeCount: document.nodes.filter((node) => node.type === "file").length,
    linkNodeCount: document.nodes.filter((node) => node.type === "link").length,
    groupNodeCount: document.nodes.filter((node) => node.type === "group").length,
  };
}

async function documentPayload(documentPath: string) {
  const result = await readJSONCanvasDocument(documentPath);
  return {
    path: documentPath,
    name: basename(documentPath),
    digest: result.digest,
    document: result.document,
    summary: summarizeDocument(result.document),
  };
}

const documentPath = resolveDocumentPath();

for (const signal of ["SIGTERM", "SIGINT"] as const) {
  process.on(signal, () => {
    process.exit(0);
  });
}

const server = serve({
  hostname: "127.0.0.1",
  port: Number(process.env.PORT || 0),
  routes: {
    [DOCUMENT_API_PATH]: {
      async GET() {
        try {
          return createJsonResponse(await documentPayload(documentPath));
        } catch (error) {
          console.error("Failed to load JSON Canvas document", error);
          return createJsonResponse({ error: String(error instanceof Error ? error.message : error) }, { status: 500 });
        }
      },
      async PUT(request) {
        let body: { digest?: unknown; document?: unknown };

        try {
          body = (await request.json()) as typeof body;
        } catch {
          return createJsonResponse({ error: "Request body must be JSON." }, { status: 400 });
        }

        if (typeof body.document !== "object" || body.document === null || Array.isArray(body.document)) {
          return createJsonResponse({ error: "Request body is missing document." }, { status: 400 });
        }

        try {
          const current = await readJSONCanvasDocument(documentPath);
          if (body.digest !== undefined && body.digest !== current.digest) {
            return createJsonResponse(
              {
                error: "File changed on disk. Reload before saving.",
                digest: current.digest,
              },
              { status: 409 },
            );
          }

          await writeJSONCanvasDocument(documentPath, body.document as JSONCanvasDocument);
          return createJsonResponse(await documentPayload(documentPath));
        } catch (error) {
          console.error("Failed to save JSON Canvas document", error);
          return createJsonResponse({ error: String(error instanceof Error ? error.message : error) }, { status: 400 });
        }
      },
    },

    "/*": index,
  },

  development: process.env.NODE_ENV !== "production" && {
    hmr: true,
    console: true,
  },
});

console.log(`APPIFY_HOST_OPEN_URL=${server.url}`);

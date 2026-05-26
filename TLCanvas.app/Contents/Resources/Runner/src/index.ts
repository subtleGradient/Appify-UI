import { serve } from "bun";
import { createTLStore, toRichText } from "tldraw";
import { mkdir, rename, rm, symlink } from "node:fs/promises";
import { createHash, randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { basename, dirname, extname, join, relative, resolve } from "node:path";
import index from "./index.html";
import {
  type CanvasStatePayload,
  CANVAS_API_PATH,
  CANVAS_FILE_NAME,
  CANVAS_SCHEMA_URI,
  type PersistedCanvasStateEnvelope,
  stringifyCanvasState,
} from "./canvasApi";
import { createCanvasReadErrorTracker } from "./canvasReadErrorTracker";
import { createStarterCanvasState } from "./starterCanvas";

const JSON_HEADERS = { "Content-Type": "application/json" };
const MAX_INLINE_PERSISTED_VALUE_LENGTH = 100_000;
const MAX_SNAPSHOT_IMAGE_BYTES = 15_000_000;
const README_FILE_NAME = "README.md";
const QUICK_LOOK_DIRECTORY_NAME = "QuickLook";
const QUICK_LOOK_THUMBNAIL_FILE_NAME = "Thumbnail.png";
const QUICK_LOOK_PREVIEW_FILE_NAME = "Preview.png";
const SNAPSHOT_API_PATH = "/api/snapshot";
const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const canvasReadErrorTracker = createCanvasReadErrorTracker();

type PersistedSidecarReference = {
  $sidecar: true;
  path: string;
  attrs?: unknown;
};

function isPersistedSidecarReference(value: unknown): value is PersistedSidecarReference {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }

  const candidate = value as Partial<PersistedSidecarReference>;
  return candidate.$sidecar === true && typeof candidate.path === "string";
}

function isRichTextDocument(value: unknown): value is { type: "doc"; content: Array<{ type?: string; content?: Array<{ text?: string }> }>; attrs?: unknown } {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value) &&
    (value as { type?: unknown }).type === "doc" &&
    Array.isArray((value as { content?: unknown }).content)
  );
}

function extractPlainTextMarkdownFromRichText(value: unknown): string | null {
  if (!isRichTextDocument(value)) {
    return null;
  }

  const paragraphs: string[] = [];

  for (const block of value.content) {
    if (typeof block !== "object" || block === null || Array.isArray(block) || block.type !== "paragraph") {
      return null;
    }

    if (block.content === undefined) {
      paragraphs.push("");
      continue;
    }

    if (!Array.isArray(block.content)) {
      return null;
    }

    let text = "";

    for (const node of block.content) {
      if (typeof node !== "object" || node === null || Array.isArray(node) || typeof node.text !== "string") {
        return null;
      }

      text += node.text;
    }

    paragraphs.push(text);
  }

  return paragraphs.join("\n");
}

function shouldPersistRichTextSidecar(value: unknown): boolean {
  return isRichTextDocument(value) && (value.content.length > 1 || value.attrs !== undefined);
}

function encodeSidecarPathSegment(value: string): string {
  return encodeURIComponent(value);
}

function recordSidecarDirectoryPath(canvasDirectoryPath: string, ownerId?: string): string | null {
  if (ownerId === undefined) {
    return null;
  }

  const separatorIndex = ownerId.indexOf(":");

  if (separatorIndex <= 0 || separatorIndex === ownerId.length - 1) {
    return null;
  }

  const recordType = ownerId.slice(0, separatorIndex);
  const recordId = ownerId.slice(separatorIndex + 1);
  return join(
    canvasDirectoryPath,
    "records",
    encodeSidecarPathSegment(recordType),
    encodeSidecarPathSegment(recordId),
  );
}

function createOwnerSidecarFilePath(
  canvasDirectoryPath: string,
  ownerId: string | undefined,
  fieldName: string | undefined,
  extension: string,
): string | null {
  const sidecarDirectoryPath = recordSidecarDirectoryPath(canvasDirectoryPath, ownerId);

  if (sidecarDirectoryPath === null || fieldName === undefined) {
    return null;
  }

  return join(sidecarDirectoryPath, `${encodeSidecarPathSegment(fieldName)}${extension}`);
}

function createSidecarReference(canvasDirectoryPath: string, sidecarFilePath: string): PersistedSidecarReference {
  return {
    $sidecar: true,
    path: `./${relative(canvasDirectoryPath, sidecarFilePath)}`,
  };
}

function getDataUrlFileExtension(mimeType: string): string {
  const normalizedMimeType = mimeType.toLowerCase();

  switch (normalizedMimeType) {
    case "image/jpeg":
      return ".jpg";
    case "image/svg+xml":
      return ".svg";
    default:
      return `.${normalizedMimeType.split("/").at(-1)?.split("+")[0] ?? "bin"}`;
  }
}

function getMimeTypeForSidecarFilePath(sidecarFilePath: string): string | null {
  switch (extname(sidecarFilePath).toLowerCase()) {
    case ".png":
      return "image/png";
    case ".jpg":
    case ".jpeg":
      return "image/jpeg";
    case ".svg":
      return "image/svg+xml";
    case ".gif":
      return "image/gif";
    case ".webp":
      return "image/webp";
    default:
      return null;
  }
}

function createContentAddressedSidecarFilePath(
  canvasDirectoryPath: string,
  contents: string | Buffer,
  extension: string,
): string {
  const contentHash = createHash("sha256").update(contents).digest("hex");
  return join(canvasDirectoryPath, "records", "_content", `${contentHash}${extension}`);
}

async function writeSidecarFile(sidecarFilePath: string, contents: string | Buffer): Promise<void> {
  await mkdir(dirname(sidecarFilePath), { recursive: true });
  await Bun.write(sidecarFilePath, contents);
}

async function persistStringSidecar(
  canvasFilePath: string,
  value: string,
  ownerId?: string,
  fieldName?: string,
): Promise<PersistedSidecarReference> {
  const canvasDirectoryPath = dirname(canvasFilePath);
  const dataUrlMatch = value.match(/^data:([^;,]+)(;base64)?,(.*)$/s);

  if (dataUrlMatch) {
    const [, mimeType, encodingFlag, payload] = dataUrlMatch;
    const decodedPayload = encodingFlag ? Buffer.from(payload, "base64") : decodeURIComponent(payload);
    const extension = getDataUrlFileExtension(mimeType);
    const sidecarFilePath =
      createOwnerSidecarFilePath(canvasDirectoryPath, ownerId, fieldName, extension) ??
      createContentAddressedSidecarFilePath(canvasDirectoryPath, decodedPayload, extension);
    await writeSidecarFile(sidecarFilePath, decodedPayload);
    return createSidecarReference(canvasDirectoryPath, sidecarFilePath);
  }

  const sidecarFilePath =
    createOwnerSidecarFilePath(canvasDirectoryPath, ownerId, fieldName, ".md") ??
    createContentAddressedSidecarFilePath(canvasDirectoryPath, value, ".md");
  await writeSidecarFile(sidecarFilePath, value);
  return createSidecarReference(canvasDirectoryPath, sidecarFilePath);
}

async function persistRichTextSidecar(
  canvasFilePath: string,
  value: unknown,
  ownerId?: string,
): Promise<PersistedSidecarReference | null> {
  if (!shouldPersistRichTextSidecar(value)) {
    return null;
  }

  const markdown = extractPlainTextMarkdownFromRichText(value);

  if (markdown === null) {
    return null;
  }

  const reference =
    ownerId === undefined
      ? await persistStringSidecar(canvasFilePath, markdown)
      : await (async () => {
          const canvasDirectoryPath = dirname(canvasFilePath);
          const sidecarFilePath =
            createOwnerSidecarFilePath(canvasDirectoryPath, ownerId, "richText", ".md") ??
            createContentAddressedSidecarFilePath(canvasDirectoryPath, markdown, ".md");
          await writeSidecarFile(sidecarFilePath, markdown);
          return createSidecarReference(canvasDirectoryPath, sidecarFilePath);
        })();

  if (isRichTextDocument(value) && value.attrs !== undefined) {
    return {
      ...reference,
      attrs: value.attrs,
    };
  }

  return reference;
}

function createInitialCanvasState(): CanvasStatePayload {
  return createStarterCanvasState();
}

function createPortableReadme(documentPath: string): string {
  const documentName = basename(documentPath);

  return `# ${documentName}

![TLCanvas preview](QuickLook/Preview.png)

This is a TLCanvas document package. It is a folder that macOS shows as a single document.

## Open on macOS

Double-click this package with TLCanvas.app installed.

## Open without TLCanvas.app

- The canvas data is in \`canvas.json5\`.
- Large assets and editable text sidecars live under \`records/\`.
- \`QuickLook/Preview.png\` is the generated preview image from the last saved TLCanvas session.
- \`QuickLook/Thumbnail.png\` is the Finder thumbnail link to \`QuickLook/Preview.png\`.

TLCanvas is built with the tldraw SDK and stores its document data as local files for portability.
`;
}

async function ensurePortableDocumentFiles(documentPath: string): Promise<void> {
  await mkdir(documentPath, { recursive: true });

  const readmeFilePath = join(documentPath, README_FILE_NAME);
  if (!existsSync(readmeFilePath)) {
    await Bun.write(readmeFilePath, createPortableReadme(documentPath));
  }
}

function trimTrailingMarkdownNewlines(value: string): string {
  return value.replace(/(?:\r?\n)+$/g, "");
}

function canonicalizeSnapshot(snapshot: unknown): CanvasStatePayload["snapshot"] {
  if (typeof snapshot !== "object" || snapshot === null || Array.isArray(snapshot)) {
    throw new Error("Canvas snapshot must be an object");
  }

  const store = createTLStore({ snapshot: snapshot as CanvasStatePayload["snapshot"] });
  return store.getStoreSnapshot("document");
}

async function parseCanvasStatePayload(canvasFilePath: string, payload: unknown): Promise<CanvasStatePayload> {
  if (typeof payload !== "object" || payload === null || Array.isArray(payload)) {
    throw new Error("Canvas payload must be an object");
  }

  const parsed = payload as Partial<PersistedCanvasStateEnvelope>;

  if (!Number.isInteger(parsed.revision) || parsed.revision < 0) {
    throw new Error("Canvas payload revision must be a non-negative integer");
  }

  return {
    revision: parsed.revision,
    snapshot: canonicalizeSnapshot(await reconstructPersistedSidecarValues(canvasFilePath, parsed.snapshot)),
  };
}

async function extractOversizedPersistedValues(
  canvasFilePath: string,
  value: unknown,
  key?: string,
  ownerId?: string,
): Promise<unknown> {
  if (key === "richText") {
    const richTextReference = await persistRichTextSidecar(canvasFilePath, value, ownerId);

    if (richTextReference !== null) {
      return richTextReference;
    }
  }

  if (typeof value === "string" && value.length > MAX_INLINE_PERSISTED_VALUE_LENGTH) {
    return await persistStringSidecar(canvasFilePath, value, ownerId, key);
  }

  if (Array.isArray(value)) {
    return await Promise.all(
      value.map((item) => extractOversizedPersistedValues(canvasFilePath, item, undefined, ownerId)),
    );
  }

  if (typeof value !== "object" || value === null) {
    return value;
  }

  const nextOwnerId =
    typeof (value as { id?: unknown }).id === "string"
      ? (value as { id: string }).id
      : ownerId;

  const extractedEntries = await Promise.all(
    Object.entries(value).map(async ([nestedKey, nestedValue]) => [
      nestedKey,
      await extractOversizedPersistedValues(canvasFilePath, nestedValue, nestedKey, nextOwnerId),
    ]),
  );

  return Object.fromEntries(extractedEntries);
}

async function reconstructPersistedSidecarValues(canvasFilePath: string, value: unknown, key?: string): Promise<unknown> {
  if (isPersistedSidecarReference(value)) {
    const sidecarFilePath = resolve(dirname(canvasFilePath), value.path);

    if (key === "richText") {
      const richText = toRichText(trimTrailingMarkdownNewlines(await Bun.file(sidecarFilePath).text()));
      return value.attrs === undefined ? richText : { ...richText, attrs: value.attrs };
    }

    const mimeType = getMimeTypeForSidecarFilePath(sidecarFilePath);

    if (mimeType === null) {
      return await Bun.file(sidecarFilePath).text();
    }

    const bytes = await Bun.file(sidecarFilePath).bytes();
    return `data:${mimeType};base64,${Buffer.from(bytes).toString("base64")}`;
  }

  if (Array.isArray(value)) {
    return await Promise.all(value.map((item) => reconstructPersistedSidecarValues(canvasFilePath, item)));
  }

  if (typeof value !== "object" || value === null) {
    return value;
  }

  const reconstructedEntries = await Promise.all(
    Object.entries(value).map(async ([nestedKey, nestedValue]) => [
      nestedKey,
      await reconstructPersistedSidecarValues(canvasFilePath, nestedValue, nestedKey),
    ]),
  );

  return Object.fromEntries(reconstructedEntries);
}

async function getCanvasState(canvasFilePath: string): Promise<CanvasStatePayload> {
  if (!existsSync(canvasFilePath)) {
    const initialState = createInitialCanvasState();
    await writeCanvasState(canvasFilePath, initialState);
    canvasReadErrorTracker.reset();
    return initialState;
  }

  let text: string | null = null;

  try {
    text = await Bun.file(canvasFilePath).text();
    const state = await parseCanvasStatePayload(canvasFilePath, Bun.JSON5.parse(text));
    canvasReadErrorTracker.reset();
    return state;
  } catch (error) {
    canvasReadErrorTracker.log(text, error);
    throw error;
  }
}

async function writeCanvasState(canvasFilePath: string, state: CanvasStatePayload): Promise<void> {
  await mkdir(dirname(canvasFilePath), { recursive: true });
  await ensurePortableDocumentFiles(dirname(canvasFilePath));

  const persistedSnapshot = (await extractOversizedPersistedValues(
    canvasFilePath,
    state.snapshot,
  )) as CanvasStatePayload["snapshot"];
  const tempFilePath = `${canvasFilePath}.${randomUUID()}.tmp`;
  await Bun.write(tempFilePath, stringifyCanvasState({
    ...state,
    snapshot: persistedSnapshot,
  }));
  await rename(tempFilePath, canvasFilePath);
  canvasReadErrorTracker.reset();
}

function createJsonResponse(data: unknown, init?: ResponseInit) {
  return new Response(JSON.stringify(data), {
    ...init,
    headers: {
      ...JSON_HEADERS,
      ...(init?.headers ?? {}),
    },
  });
}

async function writeSnapshotImage(documentPath: string, request: Request): Promise<Response> {
  const contentType = request.headers.get("content-type")?.split(";")[0]?.trim().toLowerCase();
  if (contentType !== "image/png") {
    return createJsonResponse({ error: "Snapshot must be image/png." }, { status: 415 });
  }

  const bytes = Buffer.from(await request.arrayBuffer());
  if (bytes.length === 0 || bytes.length > MAX_SNAPSHOT_IMAGE_BYTES) {
    return createJsonResponse({ error: "Snapshot image size is invalid." }, { status: 413 });
  }

  if (!bytes.subarray(0, PNG_SIGNATURE.length).equals(PNG_SIGNATURE)) {
    return createJsonResponse({ error: "Snapshot is not a PNG image." }, { status: 400 });
  }

  await ensurePortableDocumentFiles(documentPath);
  const snapshotFilePath = quickLookPreviewFilePath(documentPath);
  const tempFilePath = `${snapshotFilePath}.${randomUUID()}.tmp`;
  await mkdir(dirname(snapshotFilePath), { recursive: true });
  await Bun.write(tempFilePath, bytes);
  await rename(tempFilePath, snapshotFilePath);

  await writeQuickLookThumbnailLink(documentPath);
  await rm(join(documentPath, "snapshot.png"), { force: true });

  return new Response(null, { status: 204 });
}

function quickLookPreviewFilePath(documentPath: string): string {
  return join(documentPath, QUICK_LOOK_DIRECTORY_NAME, QUICK_LOOK_PREVIEW_FILE_NAME);
}

async function writeQuickLookThumbnailLink(documentPath: string): Promise<void> {
  const quickLookDirectoryPath = join(documentPath, QUICK_LOOK_DIRECTORY_NAME);
  await mkdir(quickLookDirectoryPath, { recursive: true });

  const thumbnailFilePath = join(quickLookDirectoryPath, QUICK_LOOK_THUMBNAIL_FILE_NAME);
  const tempFilePath = `${thumbnailFilePath}.${randomUUID()}.tmp`;
  await symlink(QUICK_LOOK_PREVIEW_FILE_NAME, tempFilePath);
  await rename(tempFilePath, thumbnailFilePath);
}

function snapshotExistsResponse(documentPath: string): Response {
  return new Response(null, {
    status: existsSync(quickLookPreviewFilePath(documentPath)) ? 204 : 404,
  });
}

function resolveDocumentPath() {
  const documentPath = process.argv[2] || process.env.APPIFY_HOST_DOCUMENT_PATH;
  if (!documentPath) {
    throw new Error("Expected a .tlcanvas document path as the last argument");
  }

  return resolve(documentPath);
}

const documentPath = resolveDocumentPath();
const canvasFilePath = join(documentPath, CANVAS_FILE_NAME);

for (const signal of ["SIGTERM", "SIGINT"] as const) {
  process.on(signal, () => {
    process.exit(0);
  });
}

await mkdir(documentPath, { recursive: true });
await ensurePortableDocumentFiles(documentPath);

const server = serve({
  hostname: "127.0.0.1",
  port: Number(process.env.PORT || 0),
  routes: {
    [CANVAS_API_PATH]: {
      async GET() {
        try {
          const state = await getCanvasState(canvasFilePath);
          return createJsonResponse(state);
        } catch {
          return createJsonResponse({ error: "Failed to load canvas file." }, { status: 500 });
        }
      },
      async PUT(req) {
        const body = (await req.json()) as Partial<CanvasStatePayload>;
        const ifMatchHeader = req.headers.get("if-match");
        const bodyRevision = typeof body?.revision === "number" ? body.revision : undefined;

        if (!body.snapshot || typeof body.snapshot !== "object") {
          return createJsonResponse({ error: "Request body is missing snapshot." }, { status: 400 });
        }

        let payloadSnapshot: CanvasStatePayload["snapshot"];

        try {
          payloadSnapshot = canonicalizeSnapshot(body.snapshot);
        } catch {
          return createJsonResponse({ error: "Request body contains an invalid snapshot." }, { status: 400 });
        }

        try {
          const currentState = await getCanvasState(canvasFilePath);
          const expectedRevision = ifMatchHeader !== null ? Number.parseInt(ifMatchHeader, 10) : bodyRevision;

          if (!Number.isInteger(expectedRevision) || expectedRevision < 0) {
            return createJsonResponse(
              {
                error: "If-Match header must be a valid revision integer.",
                revision: currentState.revision,
              },
              { status: 400 },
            );
          }

          if (expectedRevision !== currentState.revision) {
            return createJsonResponse(
              {
                error: "Revision mismatch. Try refreshing your canvas state.",
                revision: currentState.revision,
              },
              { status: 409 },
            );
          }

          const nextState: CanvasStatePayload = {
            revision: currentState.revision + 1,
            snapshot: payloadSnapshot,
          };

          await writeCanvasState(canvasFilePath, nextState);
          return createJsonResponse(await getCanvasState(canvasFilePath));
        } catch (error) {
          console.error("Failed to persist canvas", error);
          return createJsonResponse({ error: "Failed to persist canvas." }, { status: 500 });
        }
      },
    },

    [SNAPSHOT_API_PATH]: {
      HEAD() {
        return snapshotExistsResponse(documentPath);
      },
      GET() {
        const snapshotFilePath = quickLookPreviewFilePath(documentPath);
        if (!existsSync(snapshotFilePath)) {
          return createJsonResponse({ error: "Snapshot image does not exist." }, { status: 404 });
        }

        return new Response(Bun.file(snapshotFilePath), {
          headers: {
            "Content-Type": "image/png",
            "Cache-Control": "no-store",
          },
        });
      },
      async PUT(req) {
        return await writeSnapshotImage(documentPath, req);
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

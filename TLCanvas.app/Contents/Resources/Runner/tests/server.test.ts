import { afterEach, beforeEach, expect, test } from "bun:test";
import { randomUUID } from "node:crypto";
import { mkdir, readdir, readlink, rm } from "node:fs/promises";
import { dirname, join } from "node:path";
import { createTLStore, createShapeId, toRichText } from "tldraw";
import {
  CANVAS_API_PATH,
  CANVAS_FILE_NAME,
  CANVAS_SCHEMA_URI,
  type CanvasStatePayload,
} from "../src/canvasApi";
import { createStarterCanvasState } from "../src/starterCanvas";

let documentPath = "";

beforeEach(async () => {
  documentPath = join(process.cwd(), ".canvas-test", `server-${randomUUID()}.tlcanvas`);
  await mkdir(documentPath, { recursive: true });
});

afterEach(async () => {
  if (documentPath) {
    await rm(documentPath, { force: true, recursive: true });
  }
});

async function readStream(stream: ReadableStream<Uint8Array> | null) {
  if (!stream) {
    return "";
  }
  return await new Response(stream).text();
}

async function startServer() {
  const child = Bun.spawn({
    cmd: ["bun", "src/index.ts", documentPath],
    cwd: process.cwd(),
    stdout: "pipe",
    stderr: "pipe",
    env: {
      ...process.env,
      NODE_ENV: "test",
    },
  });

  let output = "";
  const deadline = Date.now() + 5000;

  while (Date.now() < deadline) {
    const chunk = await child.stdout.getReader().read();
    if (chunk.done) {
      break;
    }

    output += new TextDecoder().decode(chunk.value);
    const match = output.match(/APPIFY_HOST_OPEN_URL=(http:\/\/127\.0\.0\.1:\d+\/)/);
    if (match) {
      return {
        process: child,
        url: new URL(CANVAS_API_PATH, match[1]).toString(),
      };
    }
  }

  const stderr = await readStream(child.stderr);
  child.kill();
  throw new Error(`Timed out waiting for server URL.\nstdout: ${output}\nstderr: ${stderr}`);
}

async function stopServer(process: Bun.Subprocess<"ignore" | "pipe" | "inherit", "ignore" | "pipe" | "inherit", "ignore" | "pipe" | "inherit">) {
  process.kill();
  await process.exited;
}

function createSnapshotWithLargeImageAssetDataUrl(snapshot: CanvasStatePayload["snapshot"], dataUrl: string) {
  const assetId = `asset:${randomUUID()}` as const;
  const shapeId = createShapeId();

  return {
    ...snapshot,
    store: {
      ...snapshot.store,
      [assetId]: {
        id: assetId,
        typeName: "asset",
        type: "image",
        props: {
          name: "oversized.png",
          src: dataUrl,
          w: 64,
          h: 64,
          mimeType: "image/png",
          isAnimated: false,
        },
        meta: {},
      },
      [shapeId]: {
        id: shapeId,
        typeName: "shape",
        type: "image",
        parentId: "page:page",
        index: "a1",
        x: 120,
        y: 160,
        rotation: 0,
        isLocked: false,
        opacity: 1,
        meta: {},
        props: {
          assetId,
          w: 64,
          h: 64,
          playing: true,
          url: "",
          crop: null,
          flipX: false,
          flipY: false,
          altText: "image",
        },
      },
    },
  } satisfies CanvasStatePayload["snapshot"];
}

function createSnapshotWithRichTextSidecar(
  snapshot: CanvasStatePayload["snapshot"],
  markdown = "Heading\n\nSecond paragraph",
) {
  const shapeId = createShapeId();

  return {
    ...snapshot,
    store: {
      ...snapshot.store,
      [shapeId]: {
        id: shapeId,
        typeName: "shape",
        type: "geo",
        parentId: "page:page",
        index: "a1",
        x: 120,
        y: 180,
        rotation: 0,
        isLocked: false,
        opacity: 1,
        meta: {},
        props: {
          w: 120,
          h: 90,
          geo: "rectangle",
          dash: "draw",
          growY: 0,
          url: "",
          scale: 1,
          color: "black",
          labelColor: "black",
          fill: "none",
          size: "m",
          font: "draw",
          align: "middle",
          verticalAlign: "middle",
          richText: {
            ...toRichText(markdown),
            attrs: { testId: "richtext-sidecar" },
          },
        },
      },
    },
  } satisfies CanvasStatePayload["snapshot"];
}

function createRecordSidecarPath(ownerId: string, fileName: string): string {
  const separatorIndex = ownerId.indexOf(":");

  if (separatorIndex <= 0 || separatorIndex === ownerId.length - 1) {
    throw new Error(`Expected a tldraw record id, got ${ownerId}`);
  }

  return join(
    "records",
    encodeURIComponent(ownerId.slice(0, separatorIndex)),
    encodeURIComponent(ownerId.slice(separatorIndex + 1)),
    fileName,
  );
}

function findRecordId(
  snapshot: CanvasStatePayload["snapshot"],
  predicate: (record: { id?: unknown; typeName?: unknown; props?: unknown }) => boolean,
): string {
  const record = Object.values(snapshot.store as Record<string, { id?: unknown; typeName?: unknown; props?: unknown }>)
    .find(predicate);

  if (typeof record?.id !== "string") {
    throw new Error("Expected matching record with string id");
  }

  return record.id;
}

test("server initializes a starter canvas.json5 with a CDN schema link", async () => {
  const { process, url } = await startServer();

  try {
    const response = await fetch(url);
    const body = await response.json() as CanvasStatePayload;
    const starterState = createStarterCanvasState();

    expect(response.status).toBe(200);
    expect(body.revision).toBe(0);
    expect(body.snapshot).toEqual(starterState.snapshot);
    expect(await Bun.file(join(documentPath, CANVAS_FILE_NAME)).exists()).toBe(true);
    expect(await Bun.file(join(documentPath, "canvas.schema.json")).exists()).toBe(false);

    const persistedText = await Bun.file(join(documentPath, CANVAS_FILE_NAME)).text();
    expect(persistedText).toContain(CANVAS_SCHEMA_URI);
    expect(persistedText).toContain("Start here");
    expect(persistedText).toContain("Next move");
  } finally {
    await stopServer(process);
  }
});

test("server creates portable README metadata", async () => {
  const { process } = await startServer();

  try {
    const readme = await Bun.file(join(documentPath, "README.md")).text();

    expect(readme).toContain(`# ${documentPath.split("/").at(-1)}`);
    expect(readme).toContain("![TLCanvas snapshot](snapshot.png)");
    expect(readme).toContain("canvas.json5");
    expect(readme).toContain("records/");
    expect(readme).toContain("QuickLook/Thumbnail.png");
    expect(readme).toContain("Finder compatibility link");
    expect(readme).toContain("Double-click this package with TLCanvas.app installed.");
  } finally {
    await stopServer(process);
  }
});

test("server stores portable snapshot images", async () => {
  const { process, url } = await startServer();
  const snapshotUrl = new URL("/api/snapshot", url).toString();
  const pngSignature = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  const snapshotBytes = new Uint8Array([...pngSignature, 0x00, 0x00, 0x00, 0x00]);

  try {
    expect((await fetch(snapshotUrl, { method: "HEAD" })).status).toBe(404);

    const putResponse = await fetch(snapshotUrl, {
      method: "PUT",
      headers: {
        "Content-Type": "image/png",
      },
      body: snapshotBytes,
    });
    expect(putResponse.status).toBe(204);
    expect((await fetch(snapshotUrl, { method: "HEAD" })).status).toBe(204);

    const getResponse = await fetch(snapshotUrl);
    expect(getResponse.status).toBe(200);
    expect(getResponse.headers.get("Content-Type")).toBe("image/png");
    expect(Array.from(new Uint8Array(await getResponse.arrayBuffer()))).toEqual(Array.from(snapshotBytes));
    expect(Array.from(await Bun.file(join(documentPath, "snapshot.png")).bytes())).toEqual(Array.from(snapshotBytes));
    expect(await readlink(join(documentPath, "QuickLook", "Thumbnail.png"))).toBe("../snapshot.png");
    expect(Array.from(await Bun.file(join(documentPath, "QuickLook", "Thumbnail.png")).bytes())).toEqual(Array.from(snapshotBytes));
  } finally {
    await stopServer(process);
  }
});

test("server enforces revision checks and persists JSON5", async () => {
  const { process, url } = await startServer();

  try {
    const initial = await (await fetch(url)).json() as CanvasStatePayload;
    const nextSnapshot = createSnapshotWithRichTextSidecar(initial.snapshot);
    const richTextShapeId = findRecordId(nextSnapshot, (record) => {
      const richText = (record.props as { richText?: { attrs?: { testId?: string } } } | undefined)?.richText;
      return record.typeName === "shape" && richText?.attrs?.testId === "richtext-sidecar";
    });
    const richTextSidecarPath = createRecordSidecarPath(richTextShapeId, "richText.md");
    const staleResponse = await fetch(url, {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
        "If-Match": "99",
      },
      body: JSON.stringify({
        revision: 99,
        snapshot: nextSnapshot,
      }),
    });
    expect(staleResponse.status).toBe(409);

    const putResponse = await fetch(url, {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
        "If-Match": String(initial.revision),
      },
      body: JSON.stringify({
        revision: initial.revision,
        snapshot: nextSnapshot,
      }),
    });

    expect(putResponse.status).toBe(200);
    const persistedText = await Bun.file(join(documentPath, CANVAS_FILE_NAME)).text();
    expect(persistedText).toContain("revision: 1");
    expect(persistedText).toContain(`path: './${richTextSidecarPath}'`);
    expect(await Bun.file(join(documentPath, richTextSidecarPath)).exists()).toBe(true);
    expect(await Bun.file(join(documentPath, `${richTextShapeId}.richText.md`)).exists()).toBe(false);
  } finally {
    await stopServer(process);
  }
});

test("server returns the reconstructed state after rich text sidecar normalization", async () => {
  const { process, url } = await startServer();

  try {
    const initial = await (await fetch(url)).json() as CanvasStatePayload;
    const nextSnapshot = createSnapshotWithRichTextSidecar(initial.snapshot, "Heading\n");
    const putResponse = await fetch(url, {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
        "If-Match": String(initial.revision),
      },
      body: JSON.stringify({
        revision: initial.revision,
        snapshot: nextSnapshot,
      }),
    });

    expect(putResponse.status).toBe(200);

    const putState = await putResponse.json() as CanvasStatePayload;
    const getState = await (await fetch(url)).json() as CanvasStatePayload;
    const richTextShape = Object.values(putState.snapshot.store as Record<string, { typeName?: string; props?: { richText?: { attrs?: { testId?: string } } } }>)
      .find((record) => record.typeName === "shape" && record.props?.richText?.attrs?.testId === "richtext-sidecar");

    expect(putState).toEqual(getState);
    expect(richTextShape?.props?.richText).toEqual({
      ...toRichText("Heading"),
      attrs: { testId: "richtext-sidecar" },
    });
  } finally {
    await stopServer(process);
  }
});

test("server emits oversized media as record sidecars and reconstructs them", async () => {
  const oversizedDataUrl = `data:image/png;base64,${"a".repeat(200_000)}`;
  const { process, url } = await startServer();

  try {
    const initial = await (await fetch(url)).json() as CanvasStatePayload;
    const nextSnapshot = createSnapshotWithLargeImageAssetDataUrl(initial.snapshot, oversizedDataUrl);
    const assetId = findRecordId(nextSnapshot, (record) => record.typeName === "asset");
    const mediaSidecarPath = createRecordSidecarPath(assetId, "src.png");
    const putResponse = await fetch(url, {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
        "If-Match": String(initial.revision),
      },
      body: JSON.stringify({
        revision: initial.revision,
        snapshot: nextSnapshot,
      }),
    });

    expect(putResponse.status).toBe(200);

    const entries = await readdir(documentPath);
    expect(entries.sort()).toEqual([CANVAS_FILE_NAME, "README.md", "records"].sort());
    expect(await Bun.file(join(documentPath, mediaSidecarPath)).exists()).toBe(true);
    const persistedText = await Bun.file(join(documentPath, CANVAS_FILE_NAME)).text();
    expect(persistedText).not.toContain(oversizedDataUrl);
    expect(persistedText).toContain("$sidecar: true");
    expect(persistedText).toContain(`path: './${mediaSidecarPath}'`);

    const getResponse = await fetch(url);
    const loadedState = await getResponse.json() as CanvasStatePayload;
    const asset = Object.values(loadedState.snapshot.store as Record<string, { typeName?: string; props?: { src?: unknown } }>)
      .find((record) => record.typeName === "asset");
    expect(asset?.props?.src).toBe(oversizedDataUrl);
  } finally {
    await stopServer(process);
  }
});

test("server reads hand-edited root sidecars", async () => {
  const canvasFilePath = join(documentPath, CANVAS_FILE_NAME);
  const richTextSidecar = {
    $sidecar: true,
    path: "./rich-text-sidecar.md",
  };
  const snapshot = createSnapshotWithRichTextSidecar(createTLStore().getStoreSnapshot("document"));
  const rectangle = Object.values(snapshot.store as Record<string, { typeName?: string; props?: { richText?: unknown } }>)
    .find((record) => record.typeName === "shape");

  if (!rectangle?.props) {
    throw new Error("Expected shape record");
  }

  rectangle.props.richText = richTextSidecar;
  await Bun.write(join(documentPath, "rich-text-sidecar.md"), "Edited from disk\n");
  await Bun.write(
    canvasFilePath,
    Bun.JSON5.stringify({
      $schema: CANVAS_SCHEMA_URI,
      revision: 0,
      snapshot,
    }, null, 2),
  );

  const { process, url } = await startServer();

  try {
    const loadedState = await (await fetch(url)).json() as CanvasStatePayload;
    const loadedRectangle = Object.values(loadedState.snapshot.store as Record<string, { typeName?: string; props?: { richText?: unknown } }>)
      .find((record) => record.typeName === "shape");

    expect(loadedRectangle?.props?.richText).toEqual(toRichText("Edited from disk"));
  } finally {
    await stopServer(process);
  }
});

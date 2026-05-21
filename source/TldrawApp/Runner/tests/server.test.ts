import { afterEach, beforeEach, expect, test } from "bun:test";
import { randomUUID } from "node:crypto";
import { mkdir, readdir, rm } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { createTLStore, createShapeId, toRichText } from "tldraw";
import {
  CANVAS_API_PATH,
  CANVAS_FILE_NAME,
  CANVAS_SCHEMA_FILE_NAME,
  CANVAS_SCHEMA_URI,
  type CanvasStatePayload,
} from "../src/canvasApi";
import { createStarterCanvasState } from "../src/starterCanvas";

let documentPath = "";

beforeEach(async () => {
  documentPath = join(process.cwd(), ".canvas-test", `server-${randomUUID()}.tldraw`);
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
    const match = output.match(/WEBAPP_HOST_OPEN_URL=(http:\/\/127\.0\.0\.1:\d+\/)/);
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

function createSnapshotWithRichTextSidecar(snapshot: CanvasStatePayload["snapshot"]) {
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
            ...toRichText("Heading\n\nSecond paragraph"),
            attrs: { testId: "richtext-sidecar" },
          },
        },
      },
    },
  } satisfies CanvasStatePayload["snapshot"];
}

test("server initializes a starter canvas.json5 and local schema copy", async () => {
  const { process, url } = await startServer();

  try {
    const response = await fetch(url);
    const body = await response.json() as CanvasStatePayload;
    const starterState = createStarterCanvasState();

    expect(response.status).toBe(200);
    expect(body.revision).toBe(0);
    expect(body.snapshot).toEqual(starterState.snapshot);
    expect(await Bun.file(join(documentPath, CANVAS_FILE_NAME)).exists()).toBe(true);
    expect(await Bun.file(join(documentPath, CANVAS_SCHEMA_FILE_NAME)).exists()).toBe(true);

    const persistedText = await Bun.file(join(documentPath, CANVAS_FILE_NAME)).text();
    expect(persistedText).toContain(CANVAS_SCHEMA_URI);
    expect(persistedText).toContain("Start here");
    expect(persistedText).toContain("Next move");
  } finally {
    await stopServer(process);
  }
});

test("server enforces revision checks and persists JSON5", async () => {
  const { process, url } = await startServer();

  try {
    const initial = await (await fetch(url)).json() as CanvasStatePayload;
    const nextSnapshot = createSnapshotWithRichTextSidecar(initial.snapshot);
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
    expect(persistedText).toContain(".richText.md");
  } finally {
    await stopServer(process);
  }
});

test("server emits oversized media as root sidecars and reconstructs them", async () => {
  const oversizedDataUrl = `data:image/png;base64,${"a".repeat(200_000)}`;
  const { process, url } = await startServer();

  try {
    const initial = await (await fetch(url)).json() as CanvasStatePayload;
    const nextSnapshot = createSnapshotWithLargeImageAssetDataUrl(initial.snapshot, oversizedDataUrl);
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
    expect(entries.some((entry) => entry.endsWith(".png"))).toBe(true);
    const persistedText = await Bun.file(join(documentPath, CANVAS_FILE_NAME)).text();
    expect(persistedText).not.toContain(oversizedDataUrl);
    expect(persistedText).toContain("$sidecar: true");

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
  await Bun.write(join(documentPath, "rich-text-sidecar.md"), "Edited from disk");
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

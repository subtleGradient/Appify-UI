import { afterEach, beforeEach, expect, test } from "bun:test";
import { randomUUID } from "node:crypto";
import { mkdir, rm } from "node:fs/promises";
import { dirname, join } from "node:path";
import { createShapeId, createTLStore } from "tldraw";
import * as canvasApi from "../src/canvasApi";
import type { CanvasStatePayload } from "../src/canvasApi";

let canvasRootPath = "";
let canvasFilePath = "";

beforeEach(() => {
  canvasRootPath = join(process.cwd(), ".canvas-test", `crud-contract-${randomUUID()}`);
  canvasFilePath = join(canvasRootPath, canvasApi.CANVAS_FILE_NAME);
});

afterEach(async () => {
  if (canvasRootPath) {
    await rm(canvasRootPath, { force: true, recursive: true });
  }
});

function createSnapshotWithRectangleAt(x: number) {
  const snapshot = createTLStore().getStoreSnapshot("document");
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
        x,
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
            type: "doc",
            content: [{ type: "paragraph" }],
          },
        },
      },
    },
  } satisfies CanvasStatePayload["snapshot"];
}

test("canvas CRUD API stores canonical JSON5 envelopes on disk", async () => {
  const initialState: CanvasStatePayload = {
    revision: 0,
    snapshot: createSnapshotWithRectangleAt(120),
  };

  await mkdir(dirname(canvasFilePath), { recursive: true });

  const created = await canvasApi.createCanvasState({
    canvasFilePath,
    state: initialState,
  });

  expect(created).toEqual(initialState);
  expect(await Bun.file(canvasFilePath).exists()).toBe(true);

  const persistedText = await Bun.file(canvasFilePath).text();
  expect(persistedText).toContain("$schema:");
  expect(persistedText).toContain("revision: 0");
  expect(persistedText).toContain(canvasApi.CANVAS_SCHEMA_URI);

  const loadedAfterCreate = await canvasApi.readCanvasState({ canvasFilePath });
  expect(loadedAfterCreate).toEqual(initialState);

  const updatedSnapshot = createSnapshotWithRectangleAt(360);
  const updated = await canvasApi.updateCanvasState({
    canvasFilePath,
    update: (current) => ({
      revision: current.revision + 1,
      snapshot: updatedSnapshot,
    }),
  });

  expect(updated).toEqual({
    revision: 1,
    snapshot: updatedSnapshot,
  });
  expect(await canvasApi.readCanvasState({ canvasFilePath })).toEqual(updated);

  await canvasApi.deleteCanvasState({ canvasFilePath });
  expect(await Bun.file(canvasFilePath).exists()).toBe(false);
});

test("canvas reader accepts hand-authored JSON5 comments and trailing commas", async () => {
  const state: CanvasStatePayload = {
    revision: 2,
    snapshot: createTLStore().getStoreSnapshot("document"),
  };

  await mkdir(dirname(canvasFilePath), { recursive: true });
  await Bun.write(
    canvasFilePath,
    `{
      // hand-authored comment
      $schema: '${canvasApi.CANVAS_SCHEMA_URI}',
      revision: ${state.revision},
      snapshot: ${Bun.JSON5.stringify(state.snapshot, null, 2)},
    }\n`,
  );

  expect(await canvasApi.readCanvasState({ canvasFilePath })).toEqual(state);
});

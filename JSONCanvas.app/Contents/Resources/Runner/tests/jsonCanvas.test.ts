import { afterEach, beforeEach, expect, test } from "bun:test";
import { randomUUID } from "node:crypto";
import { mkdir, rm } from "node:fs/promises";
import { dirname, join } from "node:path";
import {
  createStarterCanvasDocument,
  normalizeJSONCanvasDocument,
  readJSONCanvasDocument,
  writeJSONCanvasDocument,
  type JSONCanvasDocument,
} from "../src/jsonCanvas";

let rootPath = "";
let canvasFilePath = "";

beforeEach(() => {
  rootPath = join(process.cwd(), ".canvas-test", `jsoncanvas-${randomUUID()}`);
  canvasFilePath = join(rootPath, "example.canvas");
});

afterEach(async () => {
  if (rootPath) {
    await rm(rootPath, { force: true, recursive: true });
  }
});

test("normalizes a valid JSON Canvas document while preserving unknown fields", () => {
  const document = normalizeJSONCanvasDocument({
    app: "upstream",
    nodes: [
      {
        id: "note",
        type: "text",
        text: "Hello",
        x: 0,
        y: 0,
        width: 240,
        height: 120,
        unknownNodeField: true,
      },
      {
        id: "site",
        type: "link",
        url: "https://jsoncanvas.org/spec/1.0",
        x: 320,
        y: 0,
        width: 240,
        height: 120,
      },
    ],
    edges: [
      {
        id: "edge-note-site",
        fromNode: "note",
        toNode: "site",
        toEnd: "arrow",
        unknownEdgeField: 42,
      },
    ],
  });

  expect(document.app).toBe("upstream");
  expect(document.nodes[0]!.unknownNodeField).toBe(true);
  expect(document.edges[0]!.unknownEdgeField).toBe(42);
});

test("rejects duplicate node ids and missing edge endpoints", () => {
  expect(() =>
    normalizeJSONCanvasDocument({
      nodes: [
        { id: "same", type: "text", text: "One", x: 0, y: 0, width: 200, height: 100 },
        { id: "same", type: "text", text: "Two", x: 240, y: 0, width: 200, height: 100 },
      ],
      edges: [],
    }),
  ).toThrow("duplicates id same");

  expect(() =>
    normalizeJSONCanvasDocument({
      nodes: [{ id: "one", type: "text", text: "One", x: 0, y: 0, width: 200, height: 100 }],
      edges: [{ id: "bad", fromNode: "one", toNode: "missing" }],
    }),
  ).toThrow("references missing node missing");
});

test("writes canonical JSON and reads it back with a stable digest", async () => {
  const document: JSONCanvasDocument = {
    nodes: [
      {
        id: "note",
        type: "text",
        text: "A note",
        x: 0,
        y: 0,
        width: 280,
        height: 140,
      },
    ],
    edges: [],
  };

  const written = await writeJSONCanvasDocument(canvasFilePath, document);
  const text = await Bun.file(canvasFilePath).text();

  expect(text).toContain('"nodes": [');
  expect(text).toContain('"text": "A note"');
  expect(text.endsWith("\n")).toBe(true);

  const read = await readJSONCanvasDocument(canvasFilePath);
  expect(read).toEqual(written);
});

test("initializes missing and empty .canvas files with starter content", async () => {
  const missing = await readJSONCanvasDocument(canvasFilePath);
  expect(missing.document).toEqual(createStarterCanvasDocument());
  expect(await Bun.file(canvasFilePath).exists()).toBe(true);

  const emptyFilePath = join(rootPath, "empty.canvas");
  await mkdir(dirname(emptyFilePath), { recursive: true });
  await Bun.write(emptyFilePath, "");

  const empty = await readJSONCanvasDocument(emptyFilePath);
  expect(empty.document.nodes.length).toBeGreaterThan(0);
  expect(empty.document.edges.length).toBeGreaterThan(0);
});

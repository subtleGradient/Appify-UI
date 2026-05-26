import { mkdir, rename } from "node:fs/promises";
import { dirname } from "node:path";
import { createHash, randomUUID } from "node:crypto";

export const DOCUMENT_API_PATH = "/api/document";
export const JSON_CANVAS_VERSION = "1.0";

const NODE_TYPES = new Set(["text", "file", "link", "group"]);
const SIDES = new Set(["top", "right", "bottom", "left"]);
const EDGE_ENDS = new Set(["none", "arrow"]);
const BACKGROUND_STYLES = new Set(["cover", "ratio", "repeat"]);
const PRESET_COLORS = new Set(["1", "2", "3", "4", "5", "6"]);
const HEX_COLOR_PATTERN = /^#[0-9a-fA-F]{6}$/;

type JsonRecord = Record<string, unknown>;

export type JSONCanvasNodeType = "text" | "file" | "link" | "group";

export interface JSONCanvasNode extends JsonRecord {
  id: string;
  type: JSONCanvasNodeType;
  x: number;
  y: number;
  width: number;
  height: number;
  color?: string;
  text?: string;
  file?: string;
  subpath?: string;
  url?: string;
  label?: string;
  background?: string;
  backgroundStyle?: string;
}

export interface JSONCanvasEdge extends JsonRecord {
  id: string;
  fromNode: string;
  toNode: string;
  fromSide?: string;
  toSide?: string;
  fromEnd?: string;
  toEnd?: string;
  color?: string;
  label?: string;
}

export interface JSONCanvasDocument extends JsonRecord {
  nodes: JSONCanvasNode[];
  edges: JSONCanvasEdge[];
}

export interface CanvasReadResult {
  document: JSONCanvasDocument;
  digest: string;
}

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function expectRecord(value: unknown, path: string): JsonRecord {
  if (!isRecord(value)) {
    throw new Error(`${path} must be an object.`);
  }

  return value;
}

function expectString(value: unknown, path: string): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`${path} must be a non-empty string.`);
  }

  return value;
}

function expectOptionalString(value: unknown, path: string): string | undefined {
  if (value === undefined) {
    return undefined;
  }

  if (typeof value !== "string") {
    throw new Error(`${path} must be a string.`);
  }

  return value;
}

function expectInteger(value: unknown, path: string): number {
  if (!Number.isInteger(value)) {
    throw new Error(`${path} must be an integer.`);
  }

  return value as number;
}

function expectSetMember<T extends string>(value: unknown, allowed: Set<T>, path: string): T {
  if (typeof value !== "string" || !allowed.has(value as T)) {
    throw new Error(`${path} must be one of: ${Array.from(allowed).join(", ")}.`);
  }

  return value as T;
}

function expectOptionalSetMember<T extends string>(value: unknown, allowed: Set<T>, path: string): T | undefined {
  if (value === undefined) {
    return undefined;
  }

  return expectSetMember(value, allowed, path);
}

function expectOptionalColor(value: unknown, path: string): string | undefined {
  if (value === undefined) {
    return undefined;
  }

  if (typeof value !== "string" || (!PRESET_COLORS.has(value) && !HEX_COLOR_PATTERN.test(value))) {
    throw new Error(`${path} must be a JSON Canvas preset color or a six-digit hex color.`);
  }

  return value;
}

function normalizeNode(value: unknown, index: number): JSONCanvasNode {
  const path = `nodes[${index}]`;
  const input = expectRecord(value, path);
  const node: JSONCanvasNode = {
    ...input,
    id: expectString(input.id, `${path}.id`),
    type: expectSetMember(input.type, NODE_TYPES, `${path}.type`) as JSONCanvasNodeType,
    x: expectInteger(input.x, `${path}.x`),
    y: expectInteger(input.y, `${path}.y`),
    width: expectInteger(input.width, `${path}.width`),
    height: expectInteger(input.height, `${path}.height`),
  };

  if (node.width <= 0 || node.height <= 0) {
    throw new Error(`${path}.width and ${path}.height must be positive.`);
  }

  node.color = expectOptionalColor(input.color, `${path}.color`);

  switch (node.type) {
    case "text":
      node.text = expectString(input.text, `${path}.text`);
      break;
    case "file":
      node.file = expectString(input.file, `${path}.file`);
      node.subpath = expectOptionalString(input.subpath, `${path}.subpath`);
      if (node.subpath !== undefined && !node.subpath.startsWith("#")) {
        throw new Error(`${path}.subpath must start with #.`);
      }
      break;
    case "link":
      node.url = expectString(input.url, `${path}.url`);
      break;
    case "group":
      node.label = expectOptionalString(input.label, `${path}.label`);
      node.background = expectOptionalString(input.background, `${path}.background`);
      node.backgroundStyle = expectOptionalSetMember(input.backgroundStyle, BACKGROUND_STYLES, `${path}.backgroundStyle`);
      break;
  }

  return node;
}

function normalizeEdge(value: unknown, index: number, nodeIds: Set<string>): JSONCanvasEdge {
  const path = `edges[${index}]`;
  const input = expectRecord(value, path);
  const edge: JSONCanvasEdge = {
    ...input,
    id: expectString(input.id, `${path}.id`),
    fromNode: expectString(input.fromNode, `${path}.fromNode`),
    toNode: expectString(input.toNode, `${path}.toNode`),
  };

  if (!nodeIds.has(edge.fromNode)) {
    throw new Error(`${path}.fromNode references missing node ${edge.fromNode}.`);
  }

  if (!nodeIds.has(edge.toNode)) {
    throw new Error(`${path}.toNode references missing node ${edge.toNode}.`);
  }

  edge.fromSide = expectOptionalSetMember(input.fromSide, SIDES, `${path}.fromSide`);
  edge.toSide = expectOptionalSetMember(input.toSide, SIDES, `${path}.toSide`);
  edge.fromEnd = expectOptionalSetMember(input.fromEnd, EDGE_ENDS, `${path}.fromEnd`);
  edge.toEnd = expectOptionalSetMember(input.toEnd, EDGE_ENDS, `${path}.toEnd`);
  edge.color = expectOptionalColor(input.color, `${path}.color`);
  edge.label = expectOptionalString(input.label, `${path}.label`);

  return edge;
}

function assertUniqueId(id: string, seen: Set<string>, path: string) {
  if (seen.has(id)) {
    throw new Error(`${path} duplicates id ${id}.`);
  }

  seen.add(id);
}

export function normalizeJSONCanvasDocument(value: unknown): JSONCanvasDocument {
  const input = expectRecord(value, "document");
  const rawNodes = input.nodes === undefined ? [] : input.nodes;
  const rawEdges = input.edges === undefined ? [] : input.edges;

  if (!Array.isArray(rawNodes)) {
    throw new Error("document.nodes must be an array.");
  }

  if (!Array.isArray(rawEdges)) {
    throw new Error("document.edges must be an array.");
  }

  const nodeIds = new Set<string>();
  const nodes = rawNodes.map((node, index) => {
    const normalized = normalizeNode(node, index);
    assertUniqueId(normalized.id, nodeIds, `nodes[${index}].id`);
    return normalized;
  });

  const edgeIds = new Set<string>();
  const edges = rawEdges.map((edge, index) => {
    const normalized = normalizeEdge(edge, index, nodeIds);
    assertUniqueId(normalized.id, edgeIds, `edges[${index}].id`);
    return normalized;
  });

  return {
    ...input,
    nodes,
    edges,
  };
}

export function createStarterCanvasDocument(): JSONCanvasDocument {
  return {
    nodes: [
      {
        id: "json-canvas",
        type: "text",
        text: "# JSON Canvas\n\nA local .canvas file opened by JSONCanvas.app.",
        x: 0,
        y: 0,
        width: 360,
        height: 180,
        color: "5",
      },
      {
        id: "format",
        type: "link",
        url: "https://jsoncanvas.org/spec/1.0",
        x: 460,
        y: 0,
        width: 320,
        height: 140,
        color: "4",
      },
      {
        id: "notes",
        type: "text",
        text: "Edit nodes, move them around, and save the file as plain JSON.",
        x: 460,
        y: 220,
        width: 320,
        height: 140,
        color: "3",
      },
    ],
    edges: [
      {
        id: "edge-json-canvas-format",
        fromNode: "json-canvas",
        toNode: "format",
        fromEnd: "none",
        toEnd: "arrow",
      },
      {
        id: "edge-json-canvas-notes",
        fromNode: "json-canvas",
        toNode: "notes",
        fromEnd: "none",
        toEnd: "arrow",
      },
    ],
  };
}

export function stringifyJSONCanvasDocument(document: JSONCanvasDocument): string {
  return `${JSON.stringify(normalizeJSONCanvasDocument(document), null, 2)}\n`;
}

export function digestText(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}

export async function readJSONCanvasDocument(canvasFilePath: string): Promise<CanvasReadResult> {
  const file = Bun.file(canvasFilePath);
  if (!(await file.exists())) {
    const document = createStarterCanvasDocument();
    return await writeJSONCanvasDocument(canvasFilePath, document);
  }

  const text = await file.text();
  if (text.trim().length === 0) {
    const document = createStarterCanvasDocument();
    return await writeJSONCanvasDocument(canvasFilePath, document);
  }

  return {
    document: normalizeJSONCanvasDocument(JSON.parse(text)),
    digest: digestText(text),
  };
}

export async function writeJSONCanvasDocument(
  canvasFilePath: string,
  document: JSONCanvasDocument,
): Promise<CanvasReadResult> {
  const normalized = normalizeJSONCanvasDocument(document);
  const text = stringifyJSONCanvasDocument(normalized);
  const tempFilePath = `${canvasFilePath}.${randomUUID()}.tmp`;

  await mkdir(dirname(canvasFilePath), { recursive: true });
  await Bun.write(tempFilePath, text);
  await rename(tempFilePath, canvasFilePath);

  return {
    document: normalized,
    digest: digestText(text),
  };
}

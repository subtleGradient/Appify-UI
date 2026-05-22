import "./index.css";
import {
  DOCUMENT_API_PATH,
  type JSONCanvasDocument,
  type JSONCanvasEdge,
  type JSONCanvasNode,
  type JSONCanvasNodeType,
} from "./jsonCanvas";

type Selection =
  | { kind: "node"; id: string }
  | { kind: "edge"; id: string };

interface AppState {
  document: JSONCanvasDocument;
  digest: string | null;
  documentName: string;
  dirty: boolean;
  selected: Selection | null;
  mode: "canvas" | "json";
  pan: { x: number; y: number };
  scale: number;
}

interface DocumentApiPayload {
  name: string;
  digest: string;
  document: JSONCanvasDocument;
}

const NODE_DEFAULTS: Record<JSONCanvasNodeType, Pick<JSONCanvasNode, "width" | "height">> = {
  text: { width: 280, height: 150 },
  file: { width: 300, height: 120 },
  link: { width: 300, height: 120 },
  group: { width: 420, height: 260 },
};

const state: AppState = {
  document: { nodes: [], edges: [] },
  digest: null,
  documentName: "Opening",
  dirty: false,
  selected: null,
  mode: "canvas",
  pan: { x: 96, y: 88 },
  scale: 1,
};

const elements = {
  documentName: mustElement<HTMLElement>("document-name"),
  status: mustElement<HTMLElement>("status"),
  saveButton: mustElement<HTMLButtonElement>("save-button"),
  reloadButton: mustElement<HTMLButtonElement>("reload-button"),
  addTextButton: mustElement<HTMLButtonElement>("add-text-button"),
  addFileButton: mustElement<HTMLButtonElement>("add-file-button"),
  addLinkButton: mustElement<HTMLButtonElement>("add-link-button"),
  addGroupButton: mustElement<HTMLButtonElement>("add-group-button"),
  addEdgeButton: mustElement<HTMLButtonElement>("add-edge-button"),
  zoomOutButton: mustElement<HTMLButtonElement>("zoom-out-button"),
  fitButton: mustElement<HTMLButtonElement>("fit-button"),
  zoomInButton: mustElement<HTMLButtonElement>("zoom-in-button"),
  canvasTab: mustElement<HTMLButtonElement>("canvas-tab"),
  jsonTab: mustElement<HTMLButtonElement>("json-tab"),
  nodeList: mustElement<HTMLElement>("node-list"),
  edgeList: mustElement<HTMLElement>("edge-list"),
  inspectorBody: mustElement<HTMLElement>("inspector-body"),
  canvasPanel: mustElement<HTMLElement>("canvas-panel"),
  jsonPanel: mustElement<HTMLElement>("json-panel"),
  canvasViewport: mustElement<HTMLElement>("canvas-viewport"),
  canvasWorld: mustElement<HTMLElement>("canvas-world"),
  edgeLayer: mustElement<SVGSVGElement>("edge-layer"),
  nodeLayer: mustElement<HTMLElement>("node-layer"),
  jsonSource: mustElement<HTMLTextAreaElement>("json-source"),
  formatJsonButton: mustElement<HTMLButtonElement>("format-json-button"),
  applyJsonButton: mustElement<HTMLButtonElement>("apply-json-button"),
};

let dragState:
  | {
      kind: "node";
      id: string;
      pointerId: number;
      startClient: { x: number; y: number };
      startNode: { x: number; y: number };
    }
  | {
      kind: "pan";
      pointerId: number;
      startClient: { x: number; y: number };
      startPan: { x: number; y: number };
    }
  | null = null;

function mustElement<T extends Element>(id: string): T {
  const element = document.getElementById(id);
  if (!element) {
    throw new Error(`Missing element #${id}`);
  }

  return element as T;
}

function createElement<K extends keyof HTMLElementTagNameMap>(
  tagName: K,
  className?: string,
): HTMLElementTagNameMap[K] {
  const element = document.createElement(tagName);
  if (className) {
    element.className = className;
  }

  return element;
}

function createSvgElement<K extends keyof SVGElementTagNameMap>(tagName: K): SVGElementTagNameMap[K] {
  return document.createElementNS("http://www.w3.org/2000/svg", tagName);
}

function apiUrl(path: string) {
  return new URL(path, window.location.href).toString();
}

function setStatus(message: string) {
  elements.status.textContent = message;
}

function markDirty() {
  state.dirty = true;
  renderChrome();
}

function selectedNode() {
  if (state.selected?.kind !== "node") {
    return null;
  }

  return state.document.nodes.find((node) => node.id === state.selected?.id) ?? null;
}

function selectedEdge() {
  if (state.selected?.kind !== "edge") {
    return null;
  }

  return state.document.edges.find((edge) => edge.id === state.selected?.id) ?? null;
}

function nodeTitle(node: JSONCanvasNode) {
  switch (node.type) {
    case "text":
      return firstLine(node.text) || node.id;
    case "file":
      return node.file || node.id;
    case "link":
      return node.url || node.id;
    case "group":
      return node.label || node.id;
  }
}

function edgeTitle(edge: JSONCanvasEdge) {
  return edge.label || `${edge.fromNode} -> ${edge.toNode}`;
}

function firstLine(value: unknown) {
  return typeof value === "string" ? value.split(/\r?\n/)[0]?.trim() ?? "" : "";
}

function ensureUniqueId(base: string, usedIds: Set<string>) {
  const slug = base
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "") || "item";

  if (!usedIds.has(slug)) {
    return slug;
  }

  let index = 2;
  while (usedIds.has(`${slug}-${index}`)) {
    index += 1;
  }

  return `${slug}-${index}`;
}

function usedNodeIds() {
  return new Set(state.document.nodes.map((node) => node.id));
}

function usedEdgeIds() {
  return new Set(state.document.edges.map((edge) => edge.id));
}

function viewportCenterInWorld() {
  const rect = elements.canvasViewport.getBoundingClientRect();
  return {
    x: Math.round((rect.width / 2 - state.pan.x) / state.scale),
    y: Math.round((rect.height / 2 - state.pan.y) / state.scale),
  };
}

function addNode(type: JSONCanvasNodeType) {
  const center = viewportCenterInWorld();
  const defaults = NODE_DEFAULTS[type];
  const id = ensureUniqueId(type, usedNodeIds());
  const node: JSONCanvasNode = {
    id,
    type,
    x: center.x - Math.round(defaults.width / 2),
    y: center.y - Math.round(defaults.height / 2),
    width: defaults.width,
    height: defaults.height,
  };

  if (type === "text") {
    node.text = "New note";
  } else if (type === "file") {
    node.file = "README.md";
  } else if (type === "link") {
    node.url = "https://jsoncanvas.org/spec/1.0";
  } else {
    node.label = "Group";
  }

  state.document.nodes.push(node);
  state.selected = { kind: "node", id };
  markDirty();
  render();
}

function addEdge() {
  if (state.document.nodes.length < 2) {
    setStatus("Add two nodes first");
    return;
  }

  const fromNode = selectedNode()?.id ?? state.document.nodes[0]!.id;
  const toNode = state.document.nodes.find((node) => node.id !== fromNode)?.id ?? state.document.nodes[1]!.id;
  const id = ensureUniqueId(`edge-${fromNode}-${toNode}`, usedEdgeIds());

  state.document.edges.push({
    id,
    fromNode,
    toNode,
    fromEnd: "none",
    toEnd: "arrow",
  });
  state.selected = { kind: "edge", id };
  markDirty();
  render();
}

function deleteSelection() {
  if (!state.selected) {
    return;
  }

  if (state.selected.kind === "node") {
    const id = state.selected.id;
    state.document.nodes = state.document.nodes.filter((node) => node.id !== id);
    state.document.edges = state.document.edges.filter((edge) => edge.fromNode !== id && edge.toNode !== id);
  } else {
    state.document.edges = state.document.edges.filter((edge) => edge.id !== state.selected?.id);
  }

  state.selected = null;
  markDirty();
  render();
}

function updateSelectedNode(patch: Partial<JSONCanvasNode>) {
  const node = selectedNode();
  if (!node) {
    return;
  }

  Object.assign(node, patch);
  markDirty();
  render();
}

function updateSelectedEdge(patch: Partial<JSONCanvasEdge>) {
  const edge = selectedEdge();
  if (!edge) {
    return;
  }

  Object.assign(edge, patch);
  markDirty();
  render();
}

function select(selection: Selection | null) {
  state.selected = selection;
  render();
}

function setMode(mode: AppState["mode"]) {
  state.mode = mode;
  if (mode === "json") {
    elements.jsonSource.value = JSON.stringify(state.document, null, 2);
  }
  render();
}

async function loadDocument() {
  setStatus("Loading");
  const response = await fetch(apiUrl(DOCUMENT_API_PATH), { cache: "no-store" });
  const payload = await response.json() as DocumentApiPayload | { error?: string };

  if (!response.ok || !("document" in payload)) {
    throw new Error("error" in payload && payload.error ? payload.error : "Failed to load document.");
  }

  state.document = payload.document;
  state.digest = payload.digest;
  state.documentName = payload.name;
  state.dirty = false;
  state.selected = state.document.nodes[0] ? { kind: "node", id: state.document.nodes[0].id } : null;
  fitGraph();
  setStatus("Loaded");
  render();
}

async function saveDocument() {
  setStatus("Saving");
  const response = await fetch(apiUrl(DOCUMENT_API_PATH), {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      digest: state.digest,
      document: state.document,
    }),
  });
  const payload = await response.json() as DocumentApiPayload | { error?: string };

  if (!response.ok || !("document" in payload)) {
    throw new Error("error" in payload && payload.error ? payload.error : "Failed to save document.");
  }

  state.document = payload.document;
  state.digest = payload.digest;
  state.documentName = payload.name;
  state.dirty = false;
  if (state.mode === "json") {
    elements.jsonSource.value = JSON.stringify(state.document, null, 2);
  }
  setStatus("Saved");
  render();
}

function renderChrome() {
  elements.documentName.textContent = state.documentName;
  elements.saveButton.disabled = !state.dirty;
  elements.canvasTab.setAttribute("aria-selected", String(state.mode === "canvas"));
  elements.jsonTab.setAttribute("aria-selected", String(state.mode === "json"));
  elements.canvasPanel.hidden = state.mode !== "canvas";
  elements.jsonPanel.hidden = state.mode !== "json";
  if (state.dirty && !elements.status.textContent?.endsWith("*")) {
    setStatus("Edited *");
  }
}

function renderOutline() {
  elements.nodeList.replaceChildren(
    ...state.document.nodes.map((node) => {
      const button = createElement("button", "outline-item");
      button.type = "button";
      if (state.selected?.kind === "node" && state.selected.id === node.id) {
        button.classList.add("is-selected");
      }
      button.append(createElement("span", "outline-kind"), createElement("span"));
      button.children[0]!.textContent = node.type.slice(0, 1).toUpperCase();
      button.children[1]!.textContent = nodeTitle(node);
      button.addEventListener("click", () => select({ kind: "node", id: node.id }));
      return button;
    }),
  );

  if (state.document.nodes.length === 0) {
    const empty = createElement("p", "empty-state");
    empty.textContent = "No nodes";
    elements.nodeList.append(empty);
  }

  elements.edgeList.replaceChildren(
    ...state.document.edges.map((edge) => {
      const button = createElement("button", "outline-item");
      button.type = "button";
      if (state.selected?.kind === "edge" && state.selected.id === edge.id) {
        button.classList.add("is-selected");
      }
      button.append(createElement("span", "outline-kind"), createElement("span"));
      button.children[0]!.textContent = "E";
      button.children[1]!.textContent = edgeTitle(edge);
      button.addEventListener("click", () => select({ kind: "edge", id: edge.id }));
      return button;
    }),
  );

  if (state.document.edges.length === 0) {
    const empty = createElement("p", "empty-state");
    empty.textContent = "No edges";
    elements.edgeList.append(empty);
  }
}

function endpointFor(node: JSONCanvasNode | undefined, side: unknown, fallback: "from" | "to") {
  if (!node) {
    return { x: 0, y: 0 };
  }

  const normalizedSide = typeof side === "string" ? side : fallback === "from" ? "right" : "left";
  switch (normalizedSide) {
    case "top":
      return { x: node.x + node.width / 2, y: node.y };
    case "bottom":
      return { x: node.x + node.width / 2, y: node.y + node.height };
    case "left":
      return { x: node.x, y: node.y + node.height / 2 };
    case "right":
    default:
      return { x: node.x + node.width, y: node.y + node.height / 2 };
  }
}

function edgePath(from: { x: number; y: number }, to: { x: number; y: number }) {
  const dx = Math.max(80, Math.abs(to.x - from.x) * 0.45);
  return `M ${from.x} ${from.y} C ${from.x + dx} ${from.y}, ${to.x - dx} ${to.y}, ${to.x} ${to.y}`;
}

function renderEdges() {
  const defs = elements.edgeLayer.querySelector("defs");
  elements.edgeLayer.replaceChildren();
  if (defs) {
    elements.edgeLayer.append(defs);
  }

  const nodeMap = new Map(state.document.nodes.map((node) => [node.id, node]));
  for (const edge of state.document.edges) {
    const from = endpointFor(nodeMap.get(edge.fromNode), edge.fromSide, "from");
    const to = endpointFor(nodeMap.get(edge.toNode), edge.toSide, "to");
    const path = createSvgElement("path");
    path.setAttribute("d", edgePath(from, to));
    path.setAttribute("data-edge-id", edge.id);
    path.style.stroke = edge.color && edge.color.startsWith("#") ? edge.color : "";
    if (edge.toEnd !== "none") {
      path.setAttribute("marker-end", "url(#edge-arrow)");
    }
    if (state.selected?.kind === "edge" && state.selected.id === edge.id) {
      path.classList.add("is-selected");
    }
    path.addEventListener("pointerdown", (event) => {
      event.stopPropagation();
      select({ kind: "edge", id: edge.id });
    });
    elements.edgeLayer.append(path);

    if (edge.label) {
      const text = createSvgElement("text");
      text.textContent = edge.label;
      text.setAttribute("x", String((from.x + to.x) / 2));
      text.setAttribute("y", String((from.y + to.y) / 2 - 8));
      text.setAttribute("text-anchor", "middle");
      elements.edgeLayer.append(text);
    }
  }
}

function renderNodes() {
  elements.nodeLayer.replaceChildren(
    ...state.document.nodes.map((node) => {
      const nodeElement = createElement("article", `node type-${node.type}`);
      nodeElement.dataset.nodeId = node.id;
      if (node.color) {
        nodeElement.dataset.color = node.color;
      }
      if (state.selected?.kind === "node" && state.selected.id === node.id) {
        nodeElement.classList.add("is-selected");
      }
      nodeElement.style.left = `${node.x}px`;
      nodeElement.style.top = `${node.y}px`;
      nodeElement.style.width = `${node.width}px`;
      nodeElement.style.height = `${node.height}px`;

      const header = createElement("div", "node-header");
      const type = createElement("span", "node-type");
      type.textContent = node.type;
      const title = createElement("span", "node-title");
      title.textContent = node.id;
      header.append(type, title);

      const body = createElement("div", "node-body");
      body.textContent = nodeBodyText(node);

      nodeElement.append(header, body);
      nodeElement.addEventListener("pointerdown", (event) => {
        event.stopPropagation();
        select({ kind: "node", id: node.id });
        dragState = {
          kind: "node",
          id: node.id,
          pointerId: event.pointerId,
          startClient: { x: event.clientX, y: event.clientY },
          startNode: { x: node.x, y: node.y },
        };
        nodeElement.setPointerCapture(event.pointerId);
      });

      return nodeElement;
    }),
  );
}

function nodeBodyText(node: JSONCanvasNode) {
  switch (node.type) {
    case "text":
      return node.text ?? "";
    case "file":
      return node.subpath ? `${node.file ?? ""}${node.subpath}` : node.file ?? "";
    case "link":
      return node.url ?? "";
    case "group":
      return node.label ?? "Group";
  }
}

function renderWorldTransform() {
  elements.canvasWorld.style.transform = `translate(${state.pan.x}px, ${state.pan.y}px) scale(${state.scale})`;
}

function renderInspector() {
  elements.inspectorBody.replaceChildren();
  const node = selectedNode();
  if (node) {
    elements.inspectorBody.append(createNodeInspector(node));
    return;
  }

  const edge = selectedEdge();
  if (edge) {
    elements.inspectorBody.append(createEdgeInspector(edge));
    return;
  }

  const empty = createElement("p", "empty-state");
  empty.textContent = "Nothing selected";
  elements.inspectorBody.append(empty);
}

function createNodeInspector(node: JSONCanvasNode) {
  const form = createElement("div", "form-grid");
  form.append(
    readOnlyField("ID", node.id),
    readOnlyField("Type", node.type),
    fieldRow(
      numberField("X", node.x, (value) => updateSelectedNode({ x: value })),
      numberField("Y", node.y, (value) => updateSelectedNode({ y: value })),
    ),
    fieldRow(
      numberField("Width", node.width, (value) => updateSelectedNode({ width: Math.max(1, value) })),
      numberField("Height", node.height, (value) => updateSelectedNode({ height: Math.max(1, value) })),
    ),
    textField("Color", node.color ?? "", (value) => updateSelectedNode({ color: value || undefined })),
  );

  if (node.type === "text") {
    form.append(textAreaField("Text", node.text ?? "", (value) => updateSelectedNode({ text: value })));
  } else if (node.type === "file") {
    form.append(
      textField("File", node.file ?? "", (value) => updateSelectedNode({ file: value })),
      textField("Subpath", node.subpath ?? "", (value) => updateSelectedNode({ subpath: value || undefined })),
    );
  } else if (node.type === "link") {
    form.append(textField("URL", node.url ?? "", (value) => updateSelectedNode({ url: value })));
  } else {
    form.append(
      textField("Label", node.label ?? "", (value) => updateSelectedNode({ label: value || undefined })),
      textField("Background", node.background ?? "", (value) => updateSelectedNode({ background: value || undefined })),
      selectField("Background Style", node.backgroundStyle ?? "", ["", "cover", "ratio", "repeat"], (value) =>
        updateSelectedNode({ backgroundStyle: value || undefined }),
      ),
    );
  }

  form.append(dangerButton("Delete Node", deleteSelection));
  return form;
}

function createEdgeInspector(edge: JSONCanvasEdge) {
  const nodeIds = state.document.nodes.map((node) => node.id);
  const form = createElement("div", "form-grid");
  form.append(
    readOnlyField("ID", edge.id),
    selectField("From", edge.fromNode, nodeIds, (value) => updateSelectedEdge({ fromNode: value })),
    selectField("To", edge.toNode, nodeIds, (value) => updateSelectedEdge({ toNode: value })),
    fieldRow(
      selectField("From Side", edge.fromSide ?? "", ["", "top", "right", "bottom", "left"], (value) =>
        updateSelectedEdge({ fromSide: value || undefined }),
      ),
      selectField("To Side", edge.toSide ?? "", ["", "top", "right", "bottom", "left"], (value) =>
        updateSelectedEdge({ toSide: value || undefined }),
      ),
    ),
    fieldRow(
      selectField("From End", edge.fromEnd ?? "none", ["none", "arrow"], (value) => updateSelectedEdge({ fromEnd: value })),
      selectField("To End", edge.toEnd ?? "arrow", ["none", "arrow"], (value) => updateSelectedEdge({ toEnd: value })),
    ),
    textField("Label", edge.label ?? "", (value) => updateSelectedEdge({ label: value || undefined })),
    textField("Color", edge.color ?? "", (value) => updateSelectedEdge({ color: value || undefined })),
    dangerButton("Delete Edge", deleteSelection),
  );
  return form;
}

function fieldRow(...children: HTMLElement[]) {
  const row = createElement("div", "form-row");
  row.append(...children);
  return row;
}

function readOnlyField(labelText: string, value: string) {
  const label = createElement("label");
  label.textContent = labelText;
  const input = createElement("input");
  input.value = value;
  input.readOnly = true;
  label.append(input);
  return label;
}

function textField(labelText: string, value: string, onChange: (value: string) => void) {
  const label = createElement("label");
  label.textContent = labelText;
  const input = createElement("input");
  input.value = value;
  input.addEventListener("input", () => onChange(input.value));
  label.append(input);
  return label;
}

function textAreaField(labelText: string, value: string, onChange: (value: string) => void) {
  const label = createElement("label");
  label.textContent = labelText;
  const textarea = createElement("textarea");
  textarea.value = value;
  textarea.addEventListener("input", () => onChange(textarea.value));
  label.append(textarea);
  return label;
}

function numberField(labelText: string, value: number, onChange: (value: number) => void) {
  const label = createElement("label");
  label.textContent = labelText;
  const input = createElement("input");
  input.type = "number";
  input.step = "1";
  input.value = String(value);
  input.addEventListener("input", () => {
    const next = Number.parseInt(input.value, 10);
    if (Number.isFinite(next)) {
      onChange(next);
    }
  });
  label.append(input);
  return label;
}

function selectField(labelText: string, value: string, options: string[], onChange: (value: string) => void) {
  const label = createElement("label");
  label.textContent = labelText;
  const select = createElement("select");
  for (const optionValue of options) {
    const option = createElement("option");
    option.value = optionValue;
    option.textContent = optionValue || "auto";
    select.append(option);
  }
  select.value = value;
  select.addEventListener("change", () => onChange(select.value));
  label.append(select);
  return label;
}

function dangerButton(text: string, onClick: () => void) {
  const button = createElement("button", "danger-button");
  button.type = "button";
  button.textContent = text;
  button.addEventListener("click", onClick);
  return button;
}

function fitGraph() {
  const bounds = graphBounds();
  const rect = elements.canvasViewport.getBoundingClientRect();
  if (!bounds || rect.width === 0 || rect.height === 0) {
    state.pan = { x: 96, y: 88 };
    state.scale = 1;
    return;
  }

  const padding = 96;
  const scaleX = (rect.width - padding * 2) / Math.max(1, bounds.width);
  const scaleY = (rect.height - padding * 2) / Math.max(1, bounds.height);
  state.scale = clamp(Math.min(scaleX, scaleY, 1.2), 0.25, 1.2);
  state.pan = {
    x: Math.round(rect.width / 2 - (bounds.x + bounds.width / 2) * state.scale),
    y: Math.round(rect.height / 2 - (bounds.y + bounds.height / 2) * state.scale),
  };
}

function graphBounds() {
  if (state.document.nodes.length === 0) {
    return null;
  }

  const minX = Math.min(...state.document.nodes.map((node) => node.x));
  const minY = Math.min(...state.document.nodes.map((node) => node.y));
  const maxX = Math.max(...state.document.nodes.map((node) => node.x + node.width));
  const maxY = Math.max(...state.document.nodes.map((node) => node.y + node.height));
  return {
    x: minX,
    y: minY,
    width: maxX - minX,
    height: maxY - minY,
  };
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function zoomBy(multiplier: number) {
  state.scale = clamp(state.scale * multiplier, 0.2, 3);
  renderWorldTransform();
}

function applyJsonSource() {
  try {
    const parsed = JSON.parse(elements.jsonSource.value) as JSONCanvasDocument;
    if (!Array.isArray(parsed.nodes) || !Array.isArray(parsed.edges)) {
      throw new Error("JSON must contain nodes and edges arrays.");
    }
    state.document = parsed;
    state.selected = parsed.nodes[0] ? { kind: "node", id: parsed.nodes[0].id } : null;
    markDirty();
    fitGraph();
    setStatus("Applied JSON");
    render();
  } catch (error) {
    setStatus(error instanceof Error ? error.message : String(error));
  }
}

function render() {
  renderChrome();
  renderOutline();
  renderEdges();
  renderNodes();
  renderInspector();
  renderWorldTransform();
}

function bindEvents() {
  elements.saveButton.addEventListener("click", () => {
    void saveDocument().catch((error) => setStatus(error instanceof Error ? error.message : String(error)));
  });
  elements.reloadButton.addEventListener("click", () => {
    void loadDocument().catch((error) => setStatus(error instanceof Error ? error.message : String(error)));
  });
  elements.addTextButton.addEventListener("click", () => addNode("text"));
  elements.addFileButton.addEventListener("click", () => addNode("file"));
  elements.addLinkButton.addEventListener("click", () => addNode("link"));
  elements.addGroupButton.addEventListener("click", () => addNode("group"));
  elements.addEdgeButton.addEventListener("click", addEdge);
  elements.zoomOutButton.addEventListener("click", () => zoomBy(0.85));
  elements.zoomInButton.addEventListener("click", () => zoomBy(1.15));
  elements.fitButton.addEventListener("click", () => {
    fitGraph();
    renderWorldTransform();
  });
  elements.canvasTab.addEventListener("click", () => setMode("canvas"));
  elements.jsonTab.addEventListener("click", () => setMode("json"));
  elements.formatJsonButton.addEventListener("click", () => {
    elements.jsonSource.value = JSON.stringify(JSON.parse(elements.jsonSource.value), null, 2);
  });
  elements.applyJsonButton.addEventListener("click", applyJsonSource);

  elements.canvasViewport.addEventListener("pointerdown", (event) => {
    if (event.target !== elements.canvasViewport && event.target !== elements.canvasWorld && event.target !== elements.nodeLayer) {
      return;
    }

    select(null);
    dragState = {
      kind: "pan",
      pointerId: event.pointerId,
      startClient: { x: event.clientX, y: event.clientY },
      startPan: { ...state.pan },
    };
    elements.canvasViewport.setPointerCapture(event.pointerId);
  });

  elements.canvasViewport.addEventListener("pointermove", (event) => {
    if (!dragState || dragState.pointerId !== event.pointerId) {
      return;
    }

    if (dragState.kind === "pan") {
      state.pan = {
        x: dragState.startPan.x + event.clientX - dragState.startClient.x,
        y: dragState.startPan.y + event.clientY - dragState.startClient.y,
      };
      renderWorldTransform();
      return;
    }

    const node = state.document.nodes.find((candidate) => candidate.id === dragState?.id);
    if (!node) {
      return;
    }

    node.x = Math.round(dragState.startNode.x + (event.clientX - dragState.startClient.x) / state.scale);
    node.y = Math.round(dragState.startNode.y + (event.clientY - dragState.startClient.y) / state.scale);
    state.dirty = true;
    render();
  });

  elements.canvasViewport.addEventListener("pointerup", () => {
    dragState = null;
    if (state.dirty) {
      renderChrome();
    }
  });

  elements.canvasViewport.addEventListener("wheel", (event) => {
    event.preventDefault();
    if (event.metaKey || event.ctrlKey) {
      const rect = elements.canvasViewport.getBoundingClientRect();
      const before = {
        x: (event.clientX - rect.left - state.pan.x) / state.scale,
        y: (event.clientY - rect.top - state.pan.y) / state.scale,
      };
      state.scale = clamp(state.scale * (event.deltaY > 0 ? 0.92 : 1.08), 0.2, 3);
      state.pan = {
        x: event.clientX - rect.left - before.x * state.scale,
        y: event.clientY - rect.top - before.y * state.scale,
      };
    } else {
      state.pan = {
        x: state.pan.x - event.deltaX,
        y: state.pan.y - event.deltaY,
      };
    }
    renderWorldTransform();
  }, { passive: false });

  window.addEventListener("keydown", (event) => {
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "s") {
      event.preventDefault();
      void saveDocument().catch((error) => setStatus(error instanceof Error ? error.message : String(error)));
      return;
    }

    if (event.key === "Delete" || event.key === "Backspace") {
      const target = event.target;
      if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement) {
        return;
      }
      deleteSelection();
    }
  });
}

bindEvents();
void loadDocument().catch((error) => setStatus(error instanceof Error ? error.message : String(error)));

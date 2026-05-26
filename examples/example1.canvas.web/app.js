const STORAGE_KEY = "example1.canvas.web:document";
const VIEW_KEY = "example1.canvas.web:view";

const elements = {
  status: document.getElementById("status"),
  canvas: document.getElementById("canvas"),
  edges: document.getElementById("edges"),
  nodes: document.getElementById("nodes"),
  source: document.getElementById("json-source"),
  addNote: document.getElementById("add-note"),
  addLink: document.getElementById("add-link"),
  addEdge: document.getElementById("add-edge"),
  reset: document.getElementById("reset"),
  download: document.getElementById("download"),
  applyJson: document.getElementById("apply-json"),
  formatJson: document.getElementById("format-json"),
};

let seedDocument = null;
let canvasDocument = { nodes: [], edges: [] };
let selectedId = null;
let drag = null;

init().catch((error) => {
  console.error(error);
  setStatus(`Could not open: ${error.message}`);
});

async function init() {
  seedDocument = normalizeCanvasDocument(await fetch("./document.canvas").then((response) => response.json()));
  const stored = localStorage.getItem(STORAGE_KEY);
  canvasDocument = stored ? normalizeCanvasDocument(JSON.parse(stored)) : structuredClone(seedDocument);

  try {
    selectedId = JSON.parse(localStorage.getItem(VIEW_KEY) || "{}").selectedId || canvasDocument.nodes[0]?.id || null;
  } catch {
    selectedId = canvasDocument.nodes[0]?.id || null;
  }

  wireEvents();
  render();
  setStatus("Opened");
}

function wireEvents() {
  elements.addNote.addEventListener("click", () => {
    const id = uniqueId("note");
    canvasDocument.nodes.push({
      id,
      type: "text",
      text: "New JSON Canvas note",
      x: 160,
      y: 520,
      width: 280,
      height: 140,
      color: "5",
    });
    selectedId = id;
    persist("Added text node");
    render();
  });

  elements.addLink.addEventListener("click", () => {
    const id = uniqueId("link");
    canvasDocument.nodes.push({
      id,
      type: "link",
      url: "https://jsoncanvas.org/spec/1.0",
      x: 520,
      y: 520,
      width: 300,
      height: 120,
      color: "4",
    });
    selectedId = id;
    persist("Added link node");
    render();
  });

  elements.addEdge.addEventListener("click", () => {
    if (canvasDocument.nodes.length < 2) {
      setStatus("Add two nodes first");
      return;
    }
    const fromNode = selectedId && canvasDocument.nodes.some((node) => node.id === selectedId)
      ? selectedId
      : canvasDocument.nodes[0].id;
    const toNode = canvasDocument.nodes.find((node) => node.id !== fromNode)?.id;
    if (!toNode) return;

    canvasDocument.edges.push({
      id: uniqueEdgeId(`edge-${fromNode}-${toNode}`),
      fromNode,
      toNode,
      fromEnd: "none",
      toEnd: "arrow",
      label: "relates",
    });
    persist("Added edge");
    render();
  });

  elements.reset.addEventListener("click", () => {
    canvasDocument = structuredClone(seedDocument);
    selectedId = canvasDocument.nodes[0]?.id || null;
    persist("Reset to bundled seed");
    render();
  });

  elements.download.addEventListener("click", () => {
    const blob = new Blob([stableJSON(canvasDocument)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = "example1.canvas";
    link.click();
    URL.revokeObjectURL(url);
  });

  elements.applyJson.addEventListener("click", () => {
    try {
      canvasDocument = normalizeCanvasDocument(JSON.parse(elements.source.value));
      selectedId = canvasDocument.nodes[0]?.id || null;
      persist("Applied JSON");
      render();
    } catch (error) {
      setStatus(`Invalid JSON Canvas: ${error.message}`);
    }
  });

  elements.formatJson.addEventListener("click", () => {
    elements.source.value = stableJSON(canvasDocument);
  });
}

function render() {
  elements.source.value = stableJSON(canvasDocument);
  renderEdges();
  renderNodes();
}

function renderNodes() {
  elements.nodes.replaceChildren();
  for (const node of canvasDocument.nodes) {
    const element = document.createElement("article");
    element.className = `node ${node.type}${node.id === selectedId ? " selected" : ""}`;
    element.style.transform = `translate(${node.x}px, ${node.y}px)`;
    element.style.width = `${node.width}px`;
    element.style.height = `${node.height}px`;
    element.dataset.id = node.id;

    const title = document.createElement("h2");
    title.textContent = nodeTitle(node);
    element.append(title);

    const body = document.createElement(node.type === "text" ? "pre" : "p");
    body.textContent = nodeBody(node);
    element.append(body);

    element.addEventListener("pointerdown", (event) => beginDrag(event, node));
    element.addEventListener("dblclick", () => editNode(node));
    elements.nodes.append(element);
  }
}

function renderEdges() {
  const defs = elements.edges.querySelector("defs");
  elements.edges.replaceChildren(defs);
  const nodesById = new Map(canvasDocument.nodes.map((node) => [node.id, node]));

  for (const edge of canvasDocument.edges) {
    const from = nodesById.get(edge.fromNode);
    const to = nodesById.get(edge.toNode);
    if (!from || !to) continue;

    const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
    const start = center(from);
    const end = center(to);
    const midpoint = Math.max(80, Math.abs(end.x - start.x) / 2);
    path.setAttribute("d", `M ${start.x} ${start.y} C ${start.x + midpoint} ${start.y}, ${end.x - midpoint} ${end.y}, ${end.x} ${end.y}`);
    elements.edges.append(path);
  }
}

function beginDrag(event, node) {
  selectedId = node.id;
  for (const element of elements.nodes.querySelectorAll(".node.selected")) {
    element.classList.remove("selected");
  }
  event.currentTarget.classList.add("selected");
  drag = {
    id: node.id,
    pointerId: event.pointerId,
    startClientX: event.clientX,
    startClientY: event.clientY,
    startX: node.x,
    startY: node.y,
  };
  event.currentTarget.setPointerCapture(event.pointerId);
  event.currentTarget.addEventListener("pointermove", moveDrag);
  event.currentTarget.addEventListener("pointerup", endDrag, { once: true });
}

function moveDrag(event) {
  if (!drag || event.pointerId !== drag.pointerId) return;
  const node = canvasDocument.nodes.find((candidate) => candidate.id === drag.id);
  if (!node) return;

  node.x = Math.round(drag.startX + event.clientX - drag.startClientX);
  node.y = Math.round(drag.startY + event.clientY - drag.startClientY);
  event.currentTarget.style.transform = `translate(${node.x}px, ${node.y}px)`;
  renderEdges();
}

function endDrag(event) {
  event.currentTarget.removeEventListener("pointermove", moveDrag);
  drag = null;
  persist("Moved node");
  render();
}

function editNode(node) {
  const current = node.type === "text" ? node.text : node.type === "link" ? node.url : node.type === "file" ? node.file : node.label;
  const next = window.prompt("Edit selected node", current || "");
  if (next === null) return;

  if (node.type === "text") node.text = next;
  if (node.type === "link") node.url = next;
  if (node.type === "file") node.file = next;
  if (node.type === "group") node.label = next;
  persist("Edited node");
  render();
}

function persist(message) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(canvasDocument));
  localStorage.setItem(VIEW_KEY, JSON.stringify({ selectedId }));
  setStatus(`${message} - saved to localStorage`);
}

function setStatus(message) {
  elements.status.textContent = message;
}

function normalizeCanvasDocument(value) {
  if (!value || typeof value !== "object" || !Array.isArray(value.nodes) || !Array.isArray(value.edges)) {
    throw new Error("Document must have nodes and edges arrays.");
  }
  const ids = new Set();
  for (const node of value.nodes) {
    if (!node.id || ids.has(node.id)) throw new Error(`Invalid or duplicate node id ${node.id}`);
    if (!["text", "file", "link", "group"].includes(node.type)) throw new Error(`Invalid node type ${node.type}`);
    for (const key of ["x", "y", "width", "height"]) {
      if (!Number.isInteger(node[key])) throw new Error(`${node.id}.${key} must be an integer`);
    }
    ids.add(node.id);
  }
  for (const edge of value.edges) {
    if (!edge.id || !ids.has(edge.fromNode) || !ids.has(edge.toNode)) {
      throw new Error(`Invalid edge ${edge.id}`);
    }
  }
  return value;
}

function nodeTitle(node) {
  if (node.type === "group") return node.label || node.id;
  if (node.type === "link") return "Link";
  if (node.type === "file") return "File";
  return firstLine(node.text) || node.id;
}

function nodeBody(node) {
  if (node.type === "text") return node.text || "";
  if (node.type === "link") return node.url || "";
  if (node.type === "file") return node.file || "";
  return node.label || "";
}

function firstLine(value) {
  return typeof value === "string" ? value.split(/\r?\n/)[0].replace(/^#+\s*/, "") : "";
}

function center(node) {
  return { x: node.x + node.width / 2, y: node.y + node.height / 2 };
}

function uniqueId(base) {
  const used = new Set(canvasDocument.nodes.map((node) => node.id));
  return uniqueFrom(base, used);
}

function uniqueEdgeId(base) {
  const used = new Set(canvasDocument.edges.map((edge) => edge.id));
  return uniqueFrom(base, used);
}

function uniqueFrom(base, used) {
  const slug = base.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "item";
  if (!used.has(slug)) return slug;
  let index = 2;
  while (used.has(`${slug}-${index}`)) index += 1;
  return `${slug}-${index}`;
}

function stableJSON(value) {
  return `${JSON.stringify(value, null, 2)}\n`;
}

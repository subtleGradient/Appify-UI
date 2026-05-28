const DOCUMENT_KEY = "./pipeline.rete.json";
const VIEW_KEY = "rete-pipeline.web:view";

const elements = {
  status: document.getElementById("status"),
  runtime: document.getElementById("rete-runtime"),
  canvas: document.getElementById("canvas"),
  edges: document.getElementById("edges"),
  nodes: document.getElementById("nodes"),
  nodeLabel: document.getElementById("node-label"),
  nodeValue: document.getElementById("node-value"),
  nodeFactor: document.getElementById("node-factor"),
  nodeMin: document.getElementById("node-min"),
  nodeMax: document.getElementById("node-max"),
  linkSource: document.getElementById("link-source"),
  linkTarget: document.getElementById("link-target"),
  connect: document.getElementById("connect"),
  deleteSelected: document.getElementById("delete-selected"),
  result: document.getElementById("result"),
  reset: document.getElementById("reset"),
  export: document.getElementById("export"),
  addInput: document.getElementById("add-input"),
  addMultiply: document.getElementById("add-multiply"),
  addAdd: document.getElementById("add-add"),
  addClamp: document.getElementById("add-clamp"),
  addOutput: document.getElementById("add-output"),
};

const seedPipeline = {
  schema: "appify.rete-pipeline.v1",
  title: "Document scoring pipeline",
  nodes: [
    pipelineNode("inputs", "input", 80, 120, { label: "Bundle count", value: 5 }),
    pipelineNode("complexity", "multiply", 360, 80, { label: "Complexity factor", factor: 1.4 }),
    pipelineNode("risk", "input", 80, 330, { label: "Risk score", value: 3 }),
    pipelineNode("total", "add", 620, 170, { label: "Weighted total" }),
    pipelineNode("cap", "clamp", 850, 170, { label: "Clamp to launch band", min: 0, max: 10 }),
    pipelineNode("ship", "output", 1080, 170, { label: "Ship score" }),
  ],
  connections: [
    connection("inputs", "complexity"),
    connection("complexity", "total"),
    connection("risk", "total"),
    connection("total", "cap"),
    connection("cap", "ship"),
  ],
};

let pipeline = loadPipeline();
let selectedId = loadView().selectedId || pipeline.nodes[0]?.id || "";
let drag = null;
let reteModule = null;
let reteSummary = "Rete core not loaded yet";

wireEvents();
render();
persist("Opened");
loadReteCore();

function wireEvents() {
  elements.addInput.addEventListener("click", () => addNode("input"));
  elements.addMultiply.addEventListener("click", () => addNode("multiply"));
  elements.addAdd.addEventListener("click", () => addNode("add"));
  elements.addClamp.addEventListener("click", () => addNode("clamp"));
  elements.addOutput.addEventListener("click", () => addNode("output"));

  elements.reset.addEventListener("click", () => {
    pipeline = structuredClone(seedPipeline);
    selectedId = pipeline.nodes[0]?.id || "";
    persist("Reset pipeline");
    render();
  });

  elements.export.addEventListener("click", () => {
    const blob = new Blob([stableJSON(normalizePipeline(pipeline))], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = "pipeline.rete.json";
    link.click();
    URL.revokeObjectURL(url);
  });

  elements.connect.addEventListener("click", () => {
    const source = elements.linkSource.value;
    const target = elements.linkTarget.value;
    if (!source || !target || source === target) {
      setStatus("Choose two different nodes");
      return;
    }
    if (pipeline.connections.some((candidate) => candidate.source === source && candidate.target === target)) {
      setStatus("Connection already exists");
      return;
    }
    pipeline.connections.push(connection(source, target));
    persist("Connected nodes");
    render();
  });

  elements.deleteSelected.addEventListener("click", () => {
    if (!selectedId) return;
    pipeline.nodes = pipeline.nodes.filter((node) => node.id !== selectedId);
    pipeline.connections = pipeline.connections.filter((link) => link.source !== selectedId && link.target !== selectedId);
    selectedId = pipeline.nodes[0]?.id || "";
    persist("Deleted node");
    render();
  });

  for (const [field, input] of Object.entries({
    label: elements.nodeLabel,
    value: elements.nodeValue,
    factor: elements.nodeFactor,
    min: elements.nodeMin,
    max: elements.nodeMax,
  })) {
    input.addEventListener("input", () => {
      const selected = selectedNode();
      if (!selected) return;
      selected.data[field] = field === "label" ? input.value : Number(input.value);
      persist(`Saved ${field}`);
      render();
    });
  }

  elements.canvas.addEventListener("pointermove", moveDrag);
  elements.canvas.addEventListener("pointerup", endDrag);
}

async function loadReteCore() {
  try {
    reteModule = await import("https://cdn.jsdelivr.net/npm/rete@2/+esm");
    await rebuildReteGraph();
  } catch (error) {
    reteSummary = `Rete core failed to load; native renderer is still usable. ${error.message}`;
    renderRuntime();
  }
}

async function rebuildReteGraph() {
  if (!reteModule) return;
  try {
    const editor = new reteModule.NodeEditor();
    for (const node of pipeline.nodes) {
      await editor.addNode({ id: node.id, label: node.data.label, type: node.type });
    }
    for (const link of pipeline.connections) {
      await editor.addConnection({ id: link.id, source: link.source, target: link.target });
    }
    reteSummary = `Rete core graph: ${editor.getNodes().length} nodes, ${editor.getConnections().length} connections`;
  } catch (error) {
    reteSummary = `Rete core validation failed; native renderer is still usable. ${error.message}`;
  }
  renderRuntime();
}

function render() {
  renderEdges();
  renderNodes();
  renderInspector();
  renderResult();
  rebuildReteGraph();
}

function renderNodes() {
  elements.nodes.replaceChildren();
  const values = evaluatePipeline();
  for (const node of pipeline.nodes) {
    const card = document.createElement("article");
    card.className = `node ${node.type}${node.id === selectedId ? " selected" : ""}`;
    card.style.transform = `translate(${node.x}px, ${node.y}px)`;
    card.dataset.id = node.id;

    const kind = document.createElement("span");
    kind.className = "kind";
    kind.textContent = node.type;

    const title = document.createElement("h2");
    title.textContent = node.data.label || node.id;

    const value = document.createElement("p");
    value.textContent = `value ${formatNumber(values.get(node.id))}`;

    card.append(kind, title, value);
    card.addEventListener("pointerdown", beginDrag);
    card.addEventListener("click", () => {
      selectedId = node.id;
      localStorage.setItem(VIEW_KEY, JSON.stringify({ selectedId }));
      render();
    });
    elements.nodes.append(card);
  }
}

function renderEdges() {
  elements.edges.replaceChildren();
  const nodesById = new Map(pipeline.nodes.map((node) => [node.id, node]));
  for (const link of pipeline.connections) {
    const source = nodesById.get(link.source);
    const target = nodesById.get(link.target);
    if (!source || !target) continue;
    const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
    const start = { x: source.x + 180, y: source.y + 58 };
    const end = { x: target.x, y: target.y + 58 };
    const bend = Math.max(80, Math.abs(end.x - start.x) / 2);
    path.setAttribute("d", `M ${start.x} ${start.y} C ${start.x + bend} ${start.y}, ${end.x - bend} ${end.y}, ${end.x} ${end.y}`);
    elements.edges.append(path);
  }
}

function renderInspector() {
  renderRuntime();
  const selected = selectedNode();
  for (const input of [elements.nodeLabel, elements.nodeValue, elements.nodeFactor, elements.nodeMin, elements.nodeMax]) {
    input.disabled = !selected;
  }
  elements.deleteSelected.disabled = !selected;
  elements.nodeLabel.value = selected?.data.label || "";
  elements.nodeValue.value = selected?.data.value ?? 0;
  elements.nodeFactor.value = selected?.data.factor ?? 1;
  elements.nodeMin.value = selected?.data.min ?? 0;
  elements.nodeMax.value = selected?.data.max ?? 10;

  const options = pipeline.nodes.map((node) => {
    const option = document.createElement("option");
    option.value = node.id;
    option.textContent = node.data.label || node.id;
    return option;
  });
  elements.linkSource.replaceChildren(...options.map((option) => option.cloneNode(true)));
  elements.linkTarget.replaceChildren(...options.map((option) => option.cloneNode(true)));
  if (pipeline.nodes[0]) elements.linkSource.value = pipeline.nodes[0].id;
  if (pipeline.nodes[1]) elements.linkTarget.value = pipeline.nodes[1].id;
}

function renderRuntime() {
  elements.runtime.textContent = reteSummary;
}

function renderResult() {
  const values = evaluatePipeline();
  const lines = pipeline.nodes
    .filter((node) => node.type === "output")
    .map((node) => `${node.data.label || node.id}: ${formatNumber(values.get(node.id))}`);
  elements.result.textContent = lines.length ? lines.join("\n") : "No output nodes.";
}

function beginDrag(event) {
  const id = event.currentTarget.dataset.id;
  const node = pipeline.nodes.find((candidate) => candidate.id === id);
  if (!node) return;
  selectedId = id;
  drag = {
    id,
    pointerId: event.pointerId,
    startX: node.x,
    startY: node.y,
    clientX: event.clientX,
    clientY: event.clientY,
  };
  event.currentTarget.setPointerCapture(event.pointerId);
}

function moveDrag(event) {
  if (!drag || event.pointerId !== drag.pointerId) return;
  const node = pipeline.nodes.find((candidate) => candidate.id === drag.id);
  if (!node) return;
  node.x = Math.round(drag.startX + event.clientX - drag.clientX);
  node.y = Math.round(drag.startY + event.clientY - drag.clientY);
  const element = elements.nodes.querySelector(`[data-id="${CSS.escape(node.id)}"]`);
  if (element) element.style.transform = `translate(${node.x}px, ${node.y}px)`;
  renderEdges();
}

function endDrag(event) {
  if (!drag || event.pointerId !== drag.pointerId) return;
  drag = null;
  persist("Moved node");
  render();
}

function addNode(type) {
  const id = uniqueId(type, pipeline.nodes.map((node) => node.id));
  pipeline.nodes.push(pipelineNode(id, type, 120 + pipeline.nodes.length * 34, 120 + pipeline.nodes.length * 28, defaultData(type)));
  selectedId = id;
  persist(`Added ${type}`);
  render();
}

function evaluatePipeline() {
  const values = new Map();
  for (const node of pipeline.nodes) {
    if (node.type === "input") values.set(node.id, Number(node.data.value) || 0);
  }

  for (let pass = 0; pass < pipeline.nodes.length + 2; pass += 1) {
    let changed = false;
    for (const node of pipeline.nodes) {
      if (values.has(node.id) && node.type !== "input") continue;
      const incoming = pipeline.connections
        .filter((link) => link.target === node.id)
        .map((link) => values.get(link.source))
        .filter((value) => Number.isFinite(value));
      if (!incoming.length && node.type !== "input") continue;
      const next = computeNode(node, incoming);
      if (Number.isFinite(next) && values.get(node.id) !== next) {
        values.set(node.id, next);
        changed = true;
      }
    }
    if (!changed) break;
  }
  return values;
}

function computeNode(node, incoming) {
  if (node.type === "input") return Number(node.data.value) || 0;
  if (node.type === "multiply") return (incoming[0] || 0) * (Number(node.data.factor) || 1);
  if (node.type === "add") return incoming.reduce((sum, value) => sum + value, 0);
  if (node.type === "clamp") {
    const min = Number(node.data.min) || 0;
    const max = Number(node.data.max) || 10;
    return Math.min(max, Math.max(min, incoming[0] || 0));
  }
  if (node.type === "output") return incoming[0] || 0;
  return 0;
}

function selectedNode() {
  return pipeline.nodes.find((node) => node.id === selectedId) || null;
}

function persist(message) {
  localStorage.setItem(DOCUMENT_KEY, stableJSON(normalizePipeline(pipeline)));
  localStorage.setItem(VIEW_KEY, JSON.stringify({ selectedId }));
  setStatus(`${message} - saved`);
}

function loadPipeline() {
  const stored = localStorage.getItem(DOCUMENT_KEY);
  if (stored) {
    try {
      return normalizePipeline(JSON.parse(stored));
    } catch (error) {
      console.warn("Could not parse stored Rete pipeline.", error);
    }
  }
  return structuredClone(seedPipeline);
}

function loadView() {
  try {
    return JSON.parse(localStorage.getItem(VIEW_KEY) || "{}");
  } catch {
    return {};
  }
}

function normalizePipeline(value) {
  const nodes = Array.isArray(value.nodes) ? value.nodes.map((candidate) => ({
    id: String(candidate.id),
    type: ["input", "multiply", "add", "clamp", "output"].includes(candidate.type) ? candidate.type : "add",
    x: Number(candidate.x) || 0,
    y: Number(candidate.y) || 0,
    data: { ...defaultData(candidate.type), ...(candidate.data || {}) },
  })) : [];
  const ids = new Set(nodes.map((node) => node.id));
  const connections = Array.isArray(value.connections) ? value.connections
    .map((candidate) => ({
      id: String(candidate.id || `${candidate.source}-${candidate.target}`),
      source: String(candidate.source),
      target: String(candidate.target),
    }))
    .filter((candidate) => ids.has(candidate.source) && ids.has(candidate.target) && candidate.source !== candidate.target) : [];
  return {
    schema: "appify.rete-pipeline.v1",
    title: String(value.title || "Rete pipeline"),
    nodes,
    connections,
  };
}

function pipelineNode(id, type, x, y, data) {
  return { id, type, x, y, data: { ...defaultData(type), ...data } };
}

function connection(source, target) {
  return { id: `${source}-${target}`, source, target };
}

function defaultData(type) {
  if (type === "input") return { label: "Input", value: 1 };
  if (type === "multiply") return { label: "Multiply", factor: 2 };
  if (type === "clamp") return { label: "Clamp", min: 0, max: 10 };
  if (type === "output") return { label: "Output" };
  return { label: "Add" };
}

function uniqueId(prefix, usedValues) {
  const used = new Set(usedValues);
  let index = used.size + 1;
  while (used.has(`${prefix}-${index}`)) index += 1;
  return `${prefix}-${index}`;
}

function formatNumber(value) {
  return Number.isFinite(value) ? Number(value.toFixed(2)).toString() : "pending";
}

function stableJSON(value) {
  return `${JSON.stringify(value, null, 2)}\n`;
}

function setStatus(message) {
  elements.status.textContent = message;
}

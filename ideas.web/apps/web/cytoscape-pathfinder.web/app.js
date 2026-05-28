import cytoscape from "https://cdn.jsdelivr.net/npm/cytoscape@3/dist/cytoscape.esm.min.mjs";

const DOCUMENT_KEY = "./network.cy.json";
const VIEW_KEY = "cytoscape-pathfinder.web:view";

const elements = {
  status: document.getElementById("status"),
  label: document.getElementById("label"),
  role: document.getElementById("role"),
  weight: document.getElementById("weight"),
  edgeSource: document.getElementById("edge-source"),
  edgeTarget: document.getElementById("edge-target"),
  pathSource: document.getElementById("path-source"),
  pathTarget: document.getElementById("path-target"),
  filter: document.getElementById("filter"),
  addNode: document.getElementById("add-node"),
  addEdge: document.getElementById("add-edge"),
  deleteSelected: document.getElementById("delete-selected"),
  layout: document.getElementById("layout"),
  reset: document.getElementById("reset"),
  export: document.getElementById("export"),
  findPath: document.getElementById("find-path"),
  nodeCount: document.getElementById("node-count"),
  edgeCount: document.getElementById("edge-count"),
  pathSummary: document.getElementById("path-summary"),
};

const seedNetwork = {
  schema: "appify.cytoscape-pathfinder.v1",
  nodes: [
    cyNode("webapp", "Web.app", "service", 120, 160),
    cyNode("runner", "Bun runner", "runtime", 340, 90),
    cyNode("origin", "Stable origin", "runtime", 350, 290),
    cyNode("localstorage", "./network.cy.json", "storage", 620, 190),
    cyNode("cdn", "CDN modules", "risk", 850, 90),
    cyNode("peers", "Peer .web bundles", "service", 850, 300),
    cyNode("finder", "Finder package", "storage", 1080, 200),
  ],
  edges: [
    cyEdge("webapp", "runner", 2),
    cyEdge("webapp", "origin", 1),
    cyEdge("runner", "localstorage", 3),
    cyEdge("origin", "localstorage", 1),
    cyEdge("runner", "cdn", 5),
    cyEdge("origin", "peers", 2),
    cyEdge("localstorage", "finder", 1),
    cyEdge("peers", "finder", 4),
  ],
};

let view = loadView();
let saveTimer = 0;

const cy = cytoscape({
  container: document.getElementById("cy"),
  elements: toElements(loadNetwork()),
  layout: { name: "preset" },
  wheelSensitivity: 0.22,
  style: [
    { selector: "node", style: {
      "background-color": "#3c6fb6",
      "border-width": 2,
      "border-color": "#f8fafc",
      "color": "#1f2937",
      "font-family": "system-ui, sans-serif",
      "font-size": 13,
      "label": "data(label)",
      "text-background-color": "#f8fafc",
      "text-background-opacity": 0.82,
      "text-background-padding": 3,
      "text-valign": "bottom",
      "text-margin-y": 8,
      "width": 42,
      "height": 42,
    } },
    { selector: 'node[role = "storage"]', style: { "background-color": "#2f8f6b" } },
    { selector: 'node[role = "runtime"]', style: { "background-color": "#9867b8" } },
    { selector: 'node[role = "risk"]', style: { "background-color": "#b84646" } },
    { selector: "edge", style: {
      "curve-style": "bezier",
      "line-color": "#94a3b8",
      "target-arrow-color": "#94a3b8",
      "target-arrow-shape": "triangle",
      "label": "data(weight)",
      "font-size": 11,
      "text-background-color": "#f8fafc",
      "text-background-opacity": 0.8,
      "text-background-padding": 2,
      "width": 2,
    } },
    { selector: ":selected", style: { "border-color": "#f4b942", "border-width": 5, "line-color": "#f4b942", "target-arrow-color": "#f4b942" } },
    { selector: ".path", style: { "background-color": "#2f8f6b", "line-color": "#2f8f6b", "target-arrow-color": "#2f8f6b", "width": 5, "z-index": 5 } },
    { selector: ".faded", style: { "opacity": 0.22 } },
    { selector: ".filtered", style: { "display": "none" } },
  ],
});

wireEvents();
renderControls();
applyFilter();
findPath();
persistSoon("Opened");

function wireEvents() {
  cy.on("select unselect", "node, edge", renderSelection);
  cy.on("position data add remove", () => persistSoon("Saved network"));

  elements.label.addEventListener("input", () => {
    const selected = selectedElement();
    if (!selected) return;
    selected.data("label", elements.label.value);
    persistSoon("Saved label");
  });

  elements.role.addEventListener("change", () => {
    const selected = selectedElement();
    if (!selected || !selected.isNode()) return;
    selected.data("role", elements.role.value);
    applyFilter();
    persistSoon("Saved role");
  });

  elements.weight.addEventListener("input", () => {
    const selected = selectedElement();
    if (!selected || !selected.isEdge()) return;
    selected.data("weight", Number(elements.weight.value) || 1);
    findPath();
    persistSoon("Saved weight");
  });

  elements.addNode.addEventListener("click", () => {
    const id = uniqueId("node", cy.nodes().map((node) => node.id()));
    const position = visibleCenter();
    cy.add({ group: "nodes", data: { id, label: "New node", role: "service" }, position });
    cy.getElementById(id).select();
    renderControls();
    persistSoon("Added node");
  });

  elements.addEdge.addEventListener("click", () => {
    const source = elements.edgeSource.value;
    const target = elements.edgeTarget.value;
    if (!source || !target || source === target) {
      setStatus("Choose two different nodes");
      return;
    }
    const id = uniqueId(`${source}-${target}`, cy.edges().map((edge) => edge.id()));
    cy.add({ group: "edges", data: { id, source, target, label: "1", weight: 1 } });
    renderControls();
    persistSoon("Added edge");
  });

  elements.deleteSelected.addEventListener("click", () => {
    const selected = selectedElement();
    if (!selected) return;
    cy.remove(selected);
    renderControls();
    persistSoon("Deleted selected element");
  });

  elements.layout.addEventListener("click", () => {
    cy.layout({ name: "cose", animate: true, animationDuration: 450, nodeRepulsion: 8000, idealEdgeLength: 150 }).run();
    persistSoon("Ran layout");
  });

  elements.reset.addEventListener("click", () => {
    cy.elements().remove();
    cy.add(toElements(seedNetwork));
    cy.layout({ name: "preset" }).run();
    renderControls();
    applyFilter();
    findPath();
    persistSoon("Reset network");
  });

  elements.export.addEventListener("click", () => {
    const blob = new Blob([stableJSON(fromCy())], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = "network.cy.json";
    link.click();
    URL.revokeObjectURL(url);
  });

  elements.findPath.addEventListener("click", findPath);
  elements.pathSource.addEventListener("change", () => {
    view.pathSource = elements.pathSource.value;
    persistView();
    findPath();
  });
  elements.pathTarget.addEventListener("change", () => {
    view.pathTarget = elements.pathTarget.value;
    persistView();
    findPath();
  });
  elements.filter.addEventListener("change", () => {
    view.filter = elements.filter.value;
    persistView();
    applyFilter();
  });
}

function renderControls() {
  const options = cy.nodes().map((node) => {
    const option = document.createElement("option");
    option.value = node.id();
    option.textContent = node.data("label");
    return option;
  });

  for (const select of [elements.edgeSource, elements.edgeTarget, elements.pathSource, elements.pathTarget]) {
    select.replaceChildren(...options.map((option) => option.cloneNode(true)));
  }

  const first = cy.nodes()[0]?.id();
  const second = cy.nodes()[1]?.id();
  elements.edgeSource.value = first || "";
  elements.edgeTarget.value = second || "";
  elements.pathSource.value = view.pathSource && cy.getElementById(view.pathSource).nonempty() ? view.pathSource : first || "";
  elements.pathTarget.value = view.pathTarget && cy.getElementById(view.pathTarget).nonempty() ? view.pathTarget : cy.nodes().last().id() || second || "";
  elements.filter.value = view.filter || "all";
  elements.nodeCount.textContent = String(cy.nodes().length);
  elements.edgeCount.textContent = String(cy.edges().length);
  renderSelection();
}

function renderSelection() {
  const selected = selectedElement();
  const isNode = selected?.isNode();
  const isEdge = selected?.isEdge();
  elements.label.disabled = !selected;
  elements.role.disabled = !isNode;
  elements.weight.disabled = !isEdge;
  elements.deleteSelected.disabled = !selected;
  elements.label.value = selected?.data("label") || "";
  elements.role.value = isNode ? selected.data("role") || "service" : "service";
  elements.weight.value = isEdge ? selected.data("weight") || 1 : 1;
}

function applyFilter() {
  const filter = elements.filter.value || "all";
  cy.elements().removeClass("filtered");
  if (filter !== "all") {
    cy.nodes().filter((node) => node.data("role") !== filter).addClass("filtered");
    cy.edges().filter((edge) => edge.source().hasClass("filtered") || edge.target().hasClass("filtered")).addClass("filtered");
  }
}

function findPath() {
  cy.elements().removeClass("path faded");
  const source = elements.pathSource.value;
  const target = elements.pathTarget.value;
  if (!source || !target || source === target) {
    elements.pathSummary.textContent = "none";
    return;
  }

  const rootSelector = `#${source}`;
  const targetNode = cy.getElementById(target);
  const result = cy.elements().not(".filtered").dijkstra(rootSelector, (edge) => Number(edge.data("weight")) || 1, false);
  const path = result.pathTo(targetNode);
  const distance = result.distanceTo(targetNode);

  if (!path.length || !Number.isFinite(distance)) {
    elements.pathSummary.textContent = "unreachable";
    return;
  }

  cy.elements().not(path).addClass("faded");
  path.addClass("path");
  elements.pathSummary.textContent = `${formatPath(path)} (${distance})`;
}

function selectedElement() {
  return cy.$(":selected")[0] || null;
}

function visibleCenter() {
  const pan = cy.pan();
  const zoom = cy.zoom();
  const rect = cy.container().getBoundingClientRect();
  return {
    x: (rect.width / 2 - pan.x) / zoom,
    y: (rect.height / 2 - pan.y) / zoom,
  };
}

function persistSoon(message) {
  clearTimeout(saveTimer);
  saveTimer = window.setTimeout(() => {
    localStorage.setItem(DOCUMENT_KEY, stableJSON(fromCy()));
    setStatus(`${message} - saved`);
    renderControls();
  }, 160);
}

function persistView() {
  localStorage.setItem(VIEW_KEY, JSON.stringify(view));
}

function loadNetwork() {
  const stored = localStorage.getItem(DOCUMENT_KEY);
  if (stored) {
    try {
      return normalizeNetwork(JSON.parse(stored));
    } catch (error) {
      console.warn("Could not parse stored Cytoscape network.", error);
    }
  }
  return structuredClone(seedNetwork);
}

function loadView() {
  try {
    return JSON.parse(localStorage.getItem(VIEW_KEY) || "{}");
  } catch {
    return {};
  }
}

function fromCy() {
  return normalizeNetwork({
    schema: "appify.cytoscape-pathfinder.v1",
    nodes: cy.nodes().map((node) => ({
      id: node.id(),
      label: node.data("label"),
      role: node.data("role"),
      x: Math.round(node.position("x")),
      y: Math.round(node.position("y")),
    })),
    edges: cy.edges().map((edge) => ({
      id: edge.id(),
      source: edge.source().id(),
      target: edge.target().id(),
      weight: Number(edge.data("weight")) || 1,
    })),
  });
}

function toElements(network) {
  return [
    ...network.nodes.map((node) => ({
      group: "nodes",
      data: { id: node.id, label: node.label, role: node.role },
      position: { x: node.x, y: node.y },
    })),
    ...network.edges.map((edge) => ({
      group: "edges",
      data: { id: edge.id, source: edge.source, target: edge.target, label: String(edge.weight), weight: edge.weight },
    })),
  ];
}

function normalizeNetwork(value) {
  if (!value || typeof value !== "object") throw new Error("Network must be an object.");
  const nodes = Array.isArray(value.nodes) ? value.nodes.map((candidate) => ({
    id: String(candidate.id),
    label: String(candidate.label || candidate.id),
    role: ["service", "storage", "runtime", "risk"].includes(candidate.role) ? candidate.role : "service",
    x: Number(candidate.x) || 0,
    y: Number(candidate.y) || 0,
  })) : [];
  const ids = new Set(nodes.map((node) => node.id));
  const edges = Array.isArray(value.edges) ? value.edges
    .map((candidate) => ({
      id: String(candidate.id || `${candidate.source}-${candidate.target}`),
      source: String(candidate.source),
      target: String(candidate.target),
      weight: Math.max(1, Number(candidate.weight) || 1),
    }))
    .filter((candidate) => ids.has(candidate.source) && ids.has(candidate.target) && candidate.source !== candidate.target) : [];
  return { schema: "appify.cytoscape-pathfinder.v1", nodes, edges };
}

function cyNode(id, label, role, x, y) {
  return { id, label, role, x, y };
}

function cyEdge(source, target, weight) {
  return { id: `${source}-${target}`, source, target, weight };
}

function uniqueId(prefix, usedValues) {
  const used = new Set(usedValues);
  if (!used.has(prefix)) return prefix;
  let index = 2;
  while (used.has(`${prefix}-${index}`)) index += 1;
  return `${prefix}-${index}`;
}

function formatPath(path) {
  return path.nodes().map((node) => node.data("label")).join(" -> ");
}

function stableJSON(value) {
  return `${JSON.stringify(value, null, 2)}\n`;
}

function setStatus(message) {
  elements.status.textContent = message;
}

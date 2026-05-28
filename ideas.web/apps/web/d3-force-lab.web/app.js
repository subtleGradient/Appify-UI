import * as d3 from "https://cdn.jsdelivr.net/npm/d3@7/+esm";

const DOCUMENT_KEY = "./graph.json";
const VIEW_KEY = "d3-force-lab.web:view";

const elements = {
  status: document.getElementById("status"),
  title: document.getElementById("title"),
  nodeLabel: document.getElementById("node-label"),
  nodeGroup: document.getElementById("node-group"),
  linkSource: document.getElementById("link-source"),
  linkTarget: document.getElementById("link-target"),
  charge: document.getElementById("charge"),
  distance: document.getElementById("distance"),
  collision: document.getElementById("collision"),
  nodeCount: document.getElementById("node-count"),
  linkCount: document.getElementById("link-count"),
  degree: document.getElementById("degree"),
  addNode: document.getElementById("add-node"),
  addLink: document.getElementById("add-link"),
  pinSelected: document.getElementById("pin-selected"),
  deleteSelected: document.getElementById("delete-selected"),
  reset: document.getElementById("reset"),
  export: document.getElementById("export"),
};

const seedGraph = {
  schema: "appify.d3-force-lab.v1",
  title: "Local-first Web.app runtime map",
  settings: { charge: -360, distance: 145, collision: 44 },
  nodes: [
    graphNode("webapp", "Web.app", "product", 290, 230),
    graphNode("static", "Static .web bundle", "runtime", 520, 170),
    graphNode("storage", "./graph.json storage", "runtime", 710, 300),
    graphNode("cdn", "CDN-hosted D3", "risk", 520, 440),
    graphNode("stable-origin", "Stable localhost origin", "evidence", 260, 430),
    graphNode("composition", "Peer .web composition", "product", 860, 150),
  ],
  links: [
    graphLink("webapp", "static"),
    graphLink("static", "storage"),
    graphLink("static", "cdn"),
    graphLink("webapp", "stable-origin"),
    graphLink("stable-origin", "storage"),
    graphLink("static", "composition"),
  ],
};

let graph = loadGraph();
let selectedId = loadView().selectedId || graph.nodes[0]?.id || "";
let simulation = null;

const svg = d3.select("#graph");
const viewport = svg.append("g").attr("class", "viewport");
const linkLayer = viewport.append("g").attr("class", "links");
const nodeLayer = viewport.append("g").attr("class", "nodes");

svg.call(
  d3.zoom()
    .scaleExtent([0.35, 2.4])
    .on("zoom", (event) => viewport.attr("transform", event.transform)),
);

wireEvents();
render();

function wireEvents() {
  elements.title.addEventListener("input", () => {
    graph.title = elements.title.value;
    persist("Saved title");
  });

  elements.nodeLabel.addEventListener("input", () => {
    const selected = selectedNode();
    if (!selected) return;
    selected.label = elements.nodeLabel.value;
    persist("Saved node label");
    render();
  });

  elements.nodeGroup.addEventListener("change", () => {
    const selected = selectedNode();
    if (!selected) return;
    selected.group = elements.nodeGroup.value;
    persist("Saved node group");
    render();
  });

  for (const [key, input] of Object.entries({ charge: elements.charge, distance: elements.distance, collision: elements.collision })) {
    input.addEventListener("input", () => {
      graph.settings[key] = Number(input.value);
      persist("Saved force settings");
      restartSimulation();
    });
  }

  elements.addNode.addEventListener("click", () => {
    const id = uniqueId("node", graph.nodes.map((candidate) => candidate.id));
    graph.nodes.push(graphNode(id, "New node", "product", 560, 360));
    selectedId = id;
    persist("Added node");
    render();
  });

  elements.addLink.addEventListener("click", () => {
    const source = elements.linkSource.value;
    const target = elements.linkTarget.value;
    if (!source || !target || source === target) {
      setStatus("Choose two different nodes");
      return;
    }
    const exists = graph.links.some((link) => link.source === source && link.target === target);
    if (!exists) graph.links.push(graphLink(source, target));
    persist(exists ? "Link already existed" : "Added link");
    render();
  });

  elements.pinSelected.addEventListener("click", () => {
    const selected = selectedNode();
    if (!selected) return;
    selected.pinned = !selected.pinned;
    selected.fx = selected.pinned ? selected.x : null;
    selected.fy = selected.pinned ? selected.y : null;
    persist(selected.pinned ? "Pinned node" : "Released node");
    render();
  });

  elements.deleteSelected.addEventListener("click", () => {
    if (!selectedId) return;
    graph.nodes = graph.nodes.filter((node) => node.id !== selectedId);
    graph.links = graph.links.filter((link) => link.source !== selectedId && link.target !== selectedId);
    selectedId = graph.nodes[0]?.id || "";
    persist("Deleted node");
    render();
  });

  elements.reset.addEventListener("click", () => {
    graph = structuredClone(seedGraph);
    selectedId = graph.nodes[0]?.id || "";
    persist("Reset graph");
    render();
  });

  elements.export.addEventListener("click", () => {
    const blob = new Blob([stableJSON(normalizeGraph(graph))], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = "graph.json";
    link.click();
    URL.revokeObjectURL(url);
  });
}

function render() {
  elements.title.value = graph.title;
  elements.charge.value = graph.settings.charge;
  elements.distance.value = graph.settings.distance;
  elements.collision.value = graph.settings.collision;
  renderOptions();
  renderInspector();
  restartSimulation();
}

function restartSimulation() {
  const nodes = graph.nodes.map((node) => ({ ...node }));
  const links = graph.links.map((link) => ({ ...link }));
  const nodesById = new Map(nodes.map((node) => [node.id, node]));

  if (simulation) simulation.stop();

  const linkSelection = linkLayer
    .selectAll("line")
    .data(links, (link) => link.id)
    .join("line")
    .attr("class", "link");

  const nodeSelection = nodeLayer
    .selectAll("g")
    .data(nodes, (node) => node.id)
    .join((enter) => {
      const group = enter.append("g").attr("class", "node").call(dragBehavior());
      group.append("circle").attr("r", 22);
      group.append("text").attr("dy", 38);
      group.on("click", (_, node) => {
        selectedId = node.id;
        localStorage.setItem(VIEW_KEY, JSON.stringify({ selectedId }));
        renderInspector();
        restartSimulation();
      });
      return group;
    })
    .attr("class", (node) => `node ${node.group}${node.id === selectedId ? " selected" : ""}`);

  nodeSelection.select("text").text((node) => node.label);

  simulation = d3.forceSimulation(nodes)
    .force("link", d3.forceLink(links).id((node) => node.id).distance(graph.settings.distance).strength(0.7))
    .force("charge", d3.forceManyBody().strength(graph.settings.charge))
    .force("center", d3.forceCenter(600, 390))
    .force("collision", d3.forceCollide(graph.settings.collision))
    .on("tick", () => {
      for (const node of nodes) {
        const stored = graph.nodes.find((candidate) => candidate.id === node.id);
        if (!stored) continue;
        stored.x = Math.round(node.x);
        stored.y = Math.round(node.y);
        if (stored.pinned) {
          stored.fx = stored.x;
          stored.fy = stored.y;
        }
      }
      linkSelection
        .attr("x1", (link) => nodesById.get(link.source.id || link.source)?.x || 0)
        .attr("y1", (link) => nodesById.get(link.source.id || link.source)?.y || 0)
        .attr("x2", (link) => nodesById.get(link.target.id || link.target)?.x || 0)
        .attr("y2", (link) => nodesById.get(link.target.id || link.target)?.y || 0);
      nodeSelection.attr("transform", (node) => `translate(${node.x},${node.y})`);
    });

  setStatus(`Saved ${graph.nodes.length} nodes to ${DOCUMENT_KEY}`);
}

function dragBehavior() {
  return d3.drag()
    .on("start", (event) => {
      if (!event.active) simulation.alphaTarget(0.28).restart();
      event.subject.fx = event.subject.x;
      event.subject.fy = event.subject.y;
    })
    .on("drag", (event) => {
      event.subject.fx = event.x;
      event.subject.fy = event.y;
    })
    .on("end", (event) => {
      if (!event.active) simulation.alphaTarget(0);
      const stored = graph.nodes.find((node) => node.id === event.subject.id);
      if (stored) {
        stored.x = Math.round(event.subject.x);
        stored.y = Math.round(event.subject.y);
        if (stored.pinned) {
          stored.fx = stored.x;
          stored.fy = stored.y;
        } else {
          stored.fx = null;
          stored.fy = null;
        }
      }
      persist("Moved node");
    });
}

function renderOptions() {
  const options = graph.nodes.map((node) => {
    const option = document.createElement("option");
    option.value = node.id;
    option.textContent = node.label;
    return option;
  });
  elements.linkSource.replaceChildren(...options.map((option) => option.cloneNode(true)));
  elements.linkTarget.replaceChildren(...options.map((option) => option.cloneNode(true)));
  if (graph.nodes[0]) elements.linkSource.value = graph.nodes[0].id;
  if (graph.nodes[1]) elements.linkTarget.value = graph.nodes[1].id;
}

function renderInspector() {
  const selected = selectedNode();
  elements.nodeLabel.disabled = !selected;
  elements.nodeGroup.disabled = !selected;
  elements.pinSelected.disabled = !selected;
  elements.deleteSelected.disabled = !selected;
  elements.nodeLabel.value = selected?.label || "";
  elements.nodeGroup.value = selected?.group || "product";
  elements.nodeCount.textContent = String(graph.nodes.length);
  elements.linkCount.textContent = String(graph.links.length);
  elements.degree.textContent = selected ? String(degree(selected.id)) : "0";
}

function selectedNode() {
  return graph.nodes.find((node) => node.id === selectedId) || null;
}

function degree(id) {
  return graph.links.filter((link) => link.source === id || link.target === id).length;
}

function persist(message) {
  localStorage.setItem(DOCUMENT_KEY, stableJSON(normalizeGraph(graph)));
  localStorage.setItem(VIEW_KEY, JSON.stringify({ selectedId }));
  setStatus(`${message} - saved`);
}

function loadGraph() {
  const stored = localStorage.getItem(DOCUMENT_KEY);
  if (stored) {
    try {
      return normalizeGraph(JSON.parse(stored));
    } catch (error) {
      console.warn("Could not parse stored graph.", error);
    }
  }
  return structuredClone(seedGraph);
}

function loadView() {
  try {
    return JSON.parse(localStorage.getItem(VIEW_KEY) || "{}");
  } catch {
    return {};
  }
}

function normalizeGraph(value) {
  if (!value || typeof value !== "object") throw new Error("Graph must be an object.");
  const nodes = Array.isArray(value.nodes) ? value.nodes.map((candidate) => ({
    id: String(candidate.id),
    label: String(candidate.label || candidate.id),
    group: ["product", "runtime", "risk", "evidence"].includes(candidate.group) ? candidate.group : "product",
    x: Number(candidate.x) || 600,
    y: Number(candidate.y) || 390,
    pinned: Boolean(candidate.pinned),
    fx: candidate.pinned ? Number(candidate.fx ?? candidate.x) || null : null,
    fy: candidate.pinned ? Number(candidate.fy ?? candidate.y) || null : null,
  })) : [];
  const ids = new Set(nodes.map((node) => node.id));
  const links = Array.isArray(value.links) ? value.links
    .map((candidate) => ({
      id: String(candidate.id || `${candidate.source}-${candidate.target}`),
      source: String(candidate.source?.id || candidate.source),
      target: String(candidate.target?.id || candidate.target),
    }))
    .filter((candidate) => ids.has(candidate.source) && ids.has(candidate.target) && candidate.source !== candidate.target) : [];
  return {
    schema: "appify.d3-force-lab.v1",
    title: String(value.title || "D3 force graph"),
    settings: {
      charge: Number(value.settings?.charge) || -360,
      distance: Number(value.settings?.distance) || 145,
      collision: Number(value.settings?.collision) || 44,
    },
    nodes,
    links,
  };
}

function graphNode(id, label, group, x, y) {
  return { id, label, group, x, y, pinned: false, fx: null, fy: null };
}

function graphLink(source, target) {
  return { id: `${source}-${target}`, source, target };
}

function uniqueId(prefix, usedValues) {
  const used = new Set(usedValues);
  let index = used.size + 1;
  while (used.has(`${prefix}-${index}`)) index += 1;
  return `${prefix}-${index}`;
}

function stableJSON(value) {
  return `${JSON.stringify(value, null, 2)}\n`;
}

function setStatus(message) {
  elements.status.textContent = message;
}

import React, { useCallback, useEffect, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  addEdge,
  applyEdgeChanges,
  applyNodeChanges,
  Background,
  Controls,
  Handle,
  MarkerType,
  MiniMap,
  Position,
  ReactFlow,
  ReactFlowProvider,
} from "@xyflow/react";

const DOCUMENT_KEY = "./flow.json";
const VIEW_KEY = "react-flow-kanban.web:view";
const e = React.createElement;

const seedDocument = {
  schema: "appify.react-flow-kanban.v1",
  title: "Web.app bundle launch board",
  nodes: [
    node("brief", "decision", 40, 80, {
      label: "Bundle contract",
      owner: "Design",
      status: "accepted",
      estimate: 2,
      notes: "Static .web packages, no build step, durable state through ./file.ext localStorage keys.",
    }),
    node("storage", "work", 380, 40, {
      label: "File-backed storage",
      owner: "Runner",
      status: "active",
      estimate: 3,
      notes: "Autosave writes the editable flow document to ./flow.json inside Web.app.",
    }),
    node("cdn", "risk", 380, 230, {
      label: "CDN dependency",
      owner: "Examples",
      status: "watch",
      estimate: 1,
      notes: "The bundle remains static, but first load needs network unless dependencies are vendored later.",
    }),
    node("verify", "work", 730, 120, {
      label: "Open in Web.app",
      owner: "QA",
      status: "queued",
      estimate: 2,
      notes: "Move nodes, connect them, reload, and confirm the saved flow round-trips.",
    }),
  ],
  edges: [
    edge("brief", "storage"),
    edge("brief", "cdn"),
    edge("storage", "verify"),
    edge("cdn", "verify"),
  ],
};

function App() {
  const [documentState, setDocumentState] = useState(loadDocument);
  const [selectedId, setSelectedId] = useState(loadView().selectedId || documentState.nodes[0]?.id || "");
  const [status, setStatus] = useState("Opened");
  const nodeTypes = useMemo(() => ({ decision: FlowCard, work: FlowCard, risk: FlowCard }), []);
  const selectedNode = documentState.nodes.find((candidate) => candidate.id === selectedId) || null;

  useEffect(() => {
    persistDocument(documentState);
    localStorage.setItem(VIEW_KEY, JSON.stringify({ selectedId }));
    setStatus(`Saved ${documentState.nodes.length} nodes to ${DOCUMENT_KEY}`);
  }, [documentState, selectedId]);

  const onNodesChange = useCallback((changes) => {
    setDocumentState((current) => ({
      ...current,
      nodes: applyNodeChanges(changes, current.nodes),
    }));
  }, []);

  const onEdgesChange = useCallback((changes) => {
    setDocumentState((current) => ({
      ...current,
      edges: applyEdgeChanges(changes, current.edges),
    }));
  }, []);

  const onConnect = useCallback((connection) => {
    setDocumentState((current) => ({
      ...current,
      edges: addEdge(
        {
          ...connection,
          id: uniqueEdgeId(current.edges, connection.source, connection.target),
          type: "smoothstep",
          markerEnd: { type: MarkerType.ArrowClosed },
        },
        current.edges,
      ),
    }));
  }, []);

  function addBoardNode(kind) {
    const nextId = uniqueNodeId(documentState.nodes, kind);
    const position = nextPosition(documentState.nodes, kind);
    setDocumentState((current) => ({
      ...current,
      nodes: [
        ...current.nodes,
        node(nextId, kind, position.x, position.y, {
          label: kind === "risk" ? "New risk" : kind === "decision" ? "New decision" : "New task",
          owner: kind === "risk" ? "Watch" : "Owner",
          status: kind === "risk" ? "watch" : "queued",
          estimate: 1,
          notes: "Double-click the canvas controls or edit this card in the inspector.",
        }),
      ],
    }));
    setSelectedId(nextId);
  }

  function updateSelected(field, value) {
    if (!selectedNode) return;
    setDocumentState((current) => ({
      ...current,
      nodes: current.nodes.map((candidate) => {
        if (candidate.id !== selectedNode.id) return candidate;
        return { ...candidate, data: { ...candidate.data, [field]: value } };
      }),
    }));
  }

  function resetBoard() {
    const next = structuredClone(seedDocument);
    setDocumentState(next);
    setSelectedId(next.nodes[0]?.id || "");
  }

  function layoutBoard() {
    const columns = { decision: 40, work: 390, risk: 740 };
    const counts = { decision: 0, work: 0, risk: 0 };
    setDocumentState((current) => ({
      ...current,
      nodes: current.nodes.map((candidate) => {
        const kind = candidate.type in columns ? candidate.type : "work";
        const index = counts[kind]++;
        return {
          ...candidate,
          position: {
            x: columns[kind],
            y: 60 + index * 180,
          },
        };
      }),
    }));
  }

  function downloadDocument() {
    const blob = new Blob([stableJSON(documentState)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = "flow.json";
    link.click();
    URL.revokeObjectURL(url);
  }

  return e(
    "main",
    { className: "app-shell" },
    e(
      "header",
      { className: "toolbar" },
      e("div", null, e("strong", null, documentState.title), e("span", { id: "status" }, status)),
      e(
        "div",
        { className: "actions" },
        e("button", { type: "button", onClick: () => addBoardNode("work") }, "Task"),
        e("button", { type: "button", onClick: () => addBoardNode("risk") }, "Risk"),
        e("button", { type: "button", onClick: () => addBoardNode("decision") }, "Decision"),
        e("button", { type: "button", onClick: layoutBoard }, "Layout"),
        e("button", { type: "button", onClick: resetBoard }, "Reset"),
        e("button", { type: "button", onClick: downloadDocument }, "Export"),
      ),
    ),
    e(
      "section",
      { className: "workspace" },
      e(
        "section",
        { className: "flow-panel", "aria-label": "React Flow board" },
        e(ReactFlowProvider, null,
          e(ReactFlow, {
            nodes: documentState.nodes,
            edges: documentState.edges,
            nodeTypes,
            fitView: true,
            minZoom: 0.35,
            maxZoom: 1.8,
            onNodesChange,
            onEdgesChange,
            onConnect,
            onNodeClick: (_, clickedNode) => setSelectedId(clickedNode.id),
            onPaneClick: () => setSelectedId(""),
          },
            e(Background, { gap: 24, size: 1 }),
            e(MiniMap, { pannable: true, zoomable: true }),
            e(Controls, null),
          ),
        ),
      ),
      e(Inspector, {
        selectedNode,
        updateSelected,
        setTitle: (title) => setDocumentState((current) => ({ ...current, title })),
        title: documentState.title,
        edgeCount: documentState.edges.length,
      }),
    ),
  );
}

function FlowCard({ data, selected }) {
  const tone = data.status === "accepted" ? "accepted" : data.status === "active" ? "active" : data.status === "watch" ? "watch" : "queued";
  return e(
    "article",
    { className: `flow-card ${tone}${selected ? " selected" : ""}` },
    e(Handle, { type: "target", position: Position.Left }),
    e("div", { className: "card-topline" }, e("span", null, data.owner || "Owner"), e("span", null, data.status || "queued")),
    e("h2", null, data.label || "Untitled"),
    e("p", null, data.notes || ""),
    e("meter", { min: 0, max: 5, value: Number(data.estimate) || 0, title: "Estimate" }),
    e(Handle, { type: "source", position: Position.Right }),
  );
}

function Inspector({ selectedNode, updateSelected, title, setTitle, edgeCount }) {
  return e(
    "aside",
    { className: "inspector", "aria-label": "Board inspector" },
    e("label", null, "Board title", e("input", { value: title, onChange: (event) => setTitle(event.target.value) })),
    selectedNode
      ? e(
          React.Fragment,
          null,
          e("h2", null, "Selected node"),
          e("label", null, "Label", e("input", { value: selectedNode.data.label || "", onChange: (event) => updateSelected("label", event.target.value) })),
          e("label", null, "Owner", e("input", { value: selectedNode.data.owner || "", onChange: (event) => updateSelected("owner", event.target.value) })),
          e("label", null, "Status", e("select", { value: selectedNode.data.status || "queued", onChange: (event) => updateSelected("status", event.target.value) },
            e("option", { value: "queued" }, "queued"),
            e("option", { value: "active" }, "active"),
            e("option", { value: "watch" }, "watch"),
            e("option", { value: "accepted" }, "accepted"),
          )),
          e("label", null, "Estimate", e("input", { type: "number", min: 0, max: 5, value: selectedNode.data.estimate || 0, onChange: (event) => updateSelected("estimate", Number(event.target.value)) })),
          e("label", null, "Notes", e("textarea", { value: selectedNode.data.notes || "", onChange: (event) => updateSelected("notes", event.target.value) })),
        )
      : e("p", { className: "empty" }, "Select a node to edit its document fields."),
    e("dl", { className: "stats" },
      e("div", null, e("dt", null, "Nodes"), e("dd", null, selectedNode ? selectedNode.id : "none")),
      e("div", null, e("dt", null, "Edges"), e("dd", null, String(edgeCount))),
      e("div", null, e("dt", null, "Storage"), e("dd", null, DOCUMENT_KEY)),
    ),
  );
}

function loadDocument() {
  const stored = localStorage.getItem(DOCUMENT_KEY);
  if (stored) {
    try {
      return normalizeDocument(JSON.parse(stored));
    } catch (error) {
      console.warn("Could not parse stored flow document.", error);
    }
  }
  return structuredClone(seedDocument);
}

function loadView() {
  try {
    return JSON.parse(localStorage.getItem(VIEW_KEY) || "{}");
  } catch {
    return {};
  }
}

function persistDocument(documentState) {
  localStorage.setItem(DOCUMENT_KEY, stableJSON(normalizeDocument(documentState)));
}

function normalizeDocument(value) {
  if (!value || typeof value !== "object") throw new Error("Flow document must be an object.");
  const nodes = Array.isArray(value.nodes) ? value.nodes.map(normalizeNode) : [];
  const ids = new Set(nodes.map((candidate) => candidate.id));
  const edges = Array.isArray(value.edges)
    ? value.edges.filter((candidate) => ids.has(candidate.source) && ids.has(candidate.target)).map(normalizeEdge)
    : [];
  return {
    schema: "appify.react-flow-kanban.v1",
    title: typeof value.title === "string" ? value.title : "React Flow board",
    nodes,
    edges,
  };
}

function normalizeNode(value) {
  return {
    id: String(value.id || crypto.randomUUID()),
    type: ["decision", "risk", "work"].includes(value.type) ? value.type : "work",
    position: {
      x: Number(value.position?.x) || 0,
      y: Number(value.position?.y) || 0,
    },
    data: {
      label: String(value.data?.label || value.id || "Untitled"),
      owner: String(value.data?.owner || "Owner"),
      status: String(value.data?.status || "queued"),
      estimate: Number(value.data?.estimate) || 0,
      notes: String(value.data?.notes || ""),
    },
  };
}

function normalizeEdge(value) {
  return {
    id: String(value.id || uniqueEdgeId([], value.source, value.target)),
    source: String(value.source),
    target: String(value.target),
    type: value.type || "smoothstep",
    markerEnd: { type: MarkerType.ArrowClosed },
  };
}

function node(id, type, x, y, data) {
  return { id, type, position: { x, y }, data };
}

function edge(source, target) {
  return {
    id: `${source}-${target}`,
    source,
    target,
    type: "smoothstep",
    markerEnd: { type: MarkerType.ArrowClosed },
  };
}

function uniqueNodeId(nodes, prefix) {
  const used = new Set(nodes.map((candidate) => candidate.id));
  let index = nodes.length + 1;
  while (used.has(`${prefix}-${index}`)) index += 1;
  return `${prefix}-${index}`;
}

function uniqueEdgeId(edges, source, target) {
  const used = new Set(edges.map((candidate) => candidate.id));
  const base = `${source}-${target}`;
  if (!used.has(base)) return base;
  let index = 2;
  while (used.has(`${base}-${index}`)) index += 1;
  return `${base}-${index}`;
}

function nextPosition(nodes, kind) {
  const x = kind === "decision" ? 40 : kind === "risk" ? 740 : 390;
  const count = nodes.filter((candidate) => candidate.type === kind).length;
  return { x, y: 80 + count * 180 };
}

function stableJSON(value) {
  return `${JSON.stringify(value, null, 2)}\n`;
}

createRoot(document.getElementById("root")).render(e(App));

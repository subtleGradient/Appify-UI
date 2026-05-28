import React, { useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import * as ExcalidrawLib from "@excalidraw/excalidraw";

const DOCUMENT_KEY = "./scene.excalidraw";
const e = React.createElement;
const { Excalidraw } = ExcalidrawLib;

function App() {
  const apiRef = useRef(null);
  const saveTimer = useRef(0);
  const [status, setStatus] = useState("Opened");
  const initialScene = useMemo(loadScene, []);
  const latestScene = useRef(initialScene);
  const initialData = useMemo(() => sceneToInitialData(initialScene), [initialScene]);

  function onChange(elements, appState, files) {
    latestScene.current = sceneDocument(elements, appState, files);
    clearTimeout(saveTimer.current);
    saveTimer.current = window.setTimeout(() => {
      persistScene(latestScene.current);
      setStatus(`Saved ${latestScene.current.elements.length} elements to ${DOCUMENT_KEY}`);
    }, 240);
  }

  function resetScene() {
    const next = seedScene();
    latestScene.current = next;
    apiRef.current?.updateScene(sceneToInitialData(next));
    persistScene(next);
    setStatus("Reset scene - saved");
  }

  function insertTemplate() {
    const template = templateElements(40 + latestScene.current.elements.length * 8);
    const next = {
      ...latestScene.current,
      elements: [...latestScene.current.elements, ...template],
    };
    latestScene.current = next;
    apiRef.current?.updateScene({ elements: next.elements, appState: next.appState, files: next.files });
    persistScene(next);
    setStatus(`Inserted ${template.length} template elements - saved`);
  }

  function downloadScene() {
    const blob = new Blob([stableJSON(latestScene.current)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = "scene.excalidraw";
    link.click();
    URL.revokeObjectURL(url);
  }

  return e(
    "main",
    { className: "app-shell" },
    e(
      "header",
      { className: "toolbar" },
      e("div", null, e("strong", null, "Excalidraw Scene Board"), e("span", { id: "status" }, status)),
      e(
        "div",
        { className: "actions" },
        e("button", { type: "button", onClick: insertTemplate }, "Template"),
        e("button", { type: "button", onClick: resetScene }, "Reset"),
        e("button", { type: "button", onClick: downloadScene }, "Export"),
      ),
    ),
    e(
      "section",
      { className: "canvas-wrap" },
      e(Excalidraw, {
        initialData,
        excalidrawAPI: (api) => {
          apiRef.current = api;
        },
        onChange,
      }),
    ),
  );
}

function loadScene() {
  const stored = localStorage.getItem(DOCUMENT_KEY);
  if (stored) {
    try {
      return normalizeScene(JSON.parse(stored));
    } catch (error) {
      console.warn("Could not parse stored Excalidraw scene.", error);
    }
  }
  const seeded = seedScene();
  persistScene(seeded);
  return seeded;
}

function seedScene() {
  return {
    type: "excalidraw",
    version: 2,
    source: "appify-ui/ideas.web/apps/web/excalidraw-scene-board.web",
    elements: templateElements(0),
    appState: {
      viewBackgroundColor: "#f8faf7",
      currentItemStrokeColor: "#1f2937",
      currentItemBackgroundColor: "transparent",
      theme: "light",
      gridSize: 20,
    },
    files: {},
  };
}

function templateElements(offset) {
  const convert = ExcalidrawLib.convertToExcalidrawElements;
  if (typeof convert !== "function") return [];
  return convert([
    { type: "rectangle", x: 40 + offset, y: 90, width: 280, height: 130, strokeColor: "#2f8f6b", backgroundColor: "#d8f3dc", fillStyle: "solid", roundness: { type: 3 } },
    { type: "text", x: 72 + offset, y: 130, width: 220, height: 50, fontSize: 22, strokeColor: "#1f2937", text: "Web.app opens a static .web bundle" },
    { type: "diamond", x: 390 + offset, y: 100, width: 220, height: 120, strokeColor: "#b87915", backgroundColor: "#fff1c7", fillStyle: "solid" },
    { type: "text", x: 430 + offset, y: 138, width: 150, height: 44, fontSize: 20, strokeColor: "#1f2937", text: "State key starts with ./ ?" },
    { type: "rectangle", x: 690 + offset, y: 90, width: 270, height: 130, strokeColor: "#3c6fb6", backgroundColor: "#dbeafe", fillStyle: "solid", roundness: { type: 3 } },
    { type: "text", x: 725 + offset, y: 130, width: 210, height: 50, fontSize: 22, strokeColor: "#1f2937", text: "Scene writes ./scene.excalidraw" },
    { type: "arrow", x: 326 + offset, y: 155, width: 58, height: 0, strokeColor: "#64748b", endArrowhead: "arrow" },
    { type: "arrow", x: 616 + offset, y: 155, width: 68, height: 0, strokeColor: "#64748b", endArrowhead: "arrow" },
    { type: "text", x: 64 + offset, y: 280, width: 650, height: 36, fontSize: 18, strokeColor: "#475569", text: "Draw freely, then reload. Web.app turns the localStorage file key into package data." },
  ]);
}

function sceneToInitialData(scene) {
  return {
    elements: scene.elements,
    appState: scene.appState,
    files: scene.files,
    scrollToContent: true,
  };
}

function sceneDocument(elements, appState, files) {
  return normalizeScene({
    type: "excalidraw",
    version: 2,
    source: "appify-ui/ideas.web/apps/web/excalidraw-scene-board.web",
    elements: Array.from(elements || []),
    appState: scrubAppState(appState),
    files: files || {},
  });
}

function normalizeScene(value) {
  if (!value || typeof value !== "object") throw new Error("Scene must be an object.");
  return {
    type: "excalidraw",
    version: Number(value.version) || 2,
    source: typeof value.source === "string" ? value.source : "appify-ui/ideas.web/apps/web/excalidraw-scene-board.web",
    elements: Array.isArray(value.elements) ? value.elements : [],
    appState: scrubAppState(value.appState || {}),
    files: value.files && typeof value.files === "object" ? value.files : {},
  };
}

function scrubAppState(appState) {
  const next = {
    viewBackgroundColor: typeof appState.viewBackgroundColor === "string" ? appState.viewBackgroundColor : "#f8faf7",
    currentItemStrokeColor: typeof appState.currentItemStrokeColor === "string" ? appState.currentItemStrokeColor : "#1f2937",
    currentItemBackgroundColor: typeof appState.currentItemBackgroundColor === "string" ? appState.currentItemBackgroundColor : "transparent",
    theme: appState.theme === "dark" ? "dark" : "light",
    gridSize: Number.isFinite(appState.gridSize) ? appState.gridSize : 20,
    scrollX: Number(appState.scrollX) || 0,
    scrollY: Number(appState.scrollY) || 0,
  };
  if (appState.zoom && Number.isFinite(appState.zoom.value)) {
    next.zoom = { value: appState.zoom.value };
  }
  return next;
}

function persistScene(scene) {
  localStorage.setItem(DOCUMENT_KEY, stableJSON(normalizeScene(scene)));
}

function stableJSON(value) {
  return `${JSON.stringify(value, null, 2)}\n`;
}

if (!Excalidraw) {
  document.getElementById("root").textContent = "Excalidraw did not load from the CDN.";
} else {
  createRoot(document.getElementById("root")).render(e(App));
}

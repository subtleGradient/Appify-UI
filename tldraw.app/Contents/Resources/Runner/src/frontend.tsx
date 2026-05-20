import { createRoot } from "react-dom/client";
import { normalizeStructuredClone } from "./normalizeStructuredClone";

async function start() {
  normalizeStructuredClone();
  const { App } = await import("./App");
  const root = createRoot(document.getElementById("root")!);
  root.render(<App />);
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", () => {
    void start();
  });
} else {
  void start();
}

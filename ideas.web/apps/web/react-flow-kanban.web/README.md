# react-flow-kanban.web

Static React Flow example for `Web.app`.

- Runtime: native browser modules, React from CDN, `@xyflow/react` from CDN.
- Persistence: the board writes JSON to `localStorage.setItem("./flow.json", ...)`.
- Web.app behavior: the `./flow.json` key is file-backed inside this `.web` package.
- Normal browser behavior: the same key remains normal origin-scoped localStorage.

Open `index.html`, move nodes, connect cards, edit the inspector fields, and reload.

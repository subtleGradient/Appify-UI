# excalidraw-scene-board.web

Static Excalidraw scene-board example for `Web.app`.

- Runtime: native browser modules, React from CDN, Excalidraw from CDN.
- Persistence: scene data writes to `localStorage.setItem("./scene.excalidraw", ...)`.
- Web.app behavior: `./scene.excalidraw` becomes a real file in this `.web` package.
- Normal browser behavior: the same key remains origin-scoped localStorage.

Open `index.html`, draw, insert the template, reload, and export the scene JSON when needed. The CDN path is intentionally simple for the example; production bundles can vendor Excalidraw assets and fonts later.

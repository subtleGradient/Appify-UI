# rete-pipeline.web

Static Rete.js pipeline example for `Web.app`.

- Runtime: native browser JavaScript, dynamic Rete core import from CDN, and a plain DOM/SVG renderer.
- Persistence: editable pipeline data writes to `localStorage.setItem("./pipeline.rete.json", ...)`.
- Web.app behavior: `./pipeline.rete.json` becomes a real file in this `.web` package.
- Normal browser behavior: the same key remains ordinary localStorage.

The example uses Rete as the graph core and keeps the view layer browser-native so the bundle has no build step.

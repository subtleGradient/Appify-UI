# d3-force-lab.web

Static D3 force-graph editor for `Web.app`.

- Runtime: native browser module import from the D3 CDN bundle.
- Persistence: graph data and force settings write to `localStorage.setItem("./graph.json", ...)`.
- Web.app behavior: `./graph.json` becomes a real file in this `.web` package.
- Normal browser behavior: the same key works as ordinary localStorage.

Open `index.html`, drag nodes, tune the force sliders, add links, and reload.

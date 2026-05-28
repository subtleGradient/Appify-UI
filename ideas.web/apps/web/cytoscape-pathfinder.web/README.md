# cytoscape-pathfinder.web

Static Cytoscape.js pathfinding example for `Web.app`.

- Runtime: native browser ES module import of Cytoscape.js from CDN.
- Persistence: network data writes to `localStorage.setItem("./network.cy.json", ...)`.
- Web.app behavior: `./network.cy.json` becomes a real file in this `.web` package.
- Normal browser behavior: the same key remains ordinary localStorage.

Open `index.html`, edit the graph, filter roles, calculate a shortest path, and reload.

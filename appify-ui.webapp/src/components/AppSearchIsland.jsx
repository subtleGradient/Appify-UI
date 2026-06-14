import { useMemo, useState } from "react";
import AppCard from "./AppCard.jsx";

export default function AppSearchIsland({ apps }) {
  const [query, setQuery] = useState("");
  const [extensionOnly, setExtensionOnly] = useState(false);

  const filteredApps = useMemo(() => {
    const needle = query.trim().toLowerCase();

    return apps.filter((app) => {
      const searchable = [
        app.name,
        app.path,
        app.kind,
        app.description,
        ...app.extensions,
        ...app.highlights,
      ].join(" ").toLowerCase();

      const matchesQuery = needle.length === 0 || searchable.includes(needle);
      const matchesExtensionMode = !extensionOnly || app.extensions.some((extension) => extension.startsWith("."));

      return matchesQuery && matchesExtensionMode;
    });
  }, [apps, extensionOnly, query]);

  return (
    <section className="island-panel" aria-label="Interactive app finder">
      <div className="finder-controls">
        <label className="search-field">
          <span>Find an app</span>
          <input
            type="search"
            value={query}
            placeholder="Try .web, terminal, canvas"
            onChange={(event) => setQuery(event.target.value)}
          />
        </label>
        <label className="toggle-field">
          <input
            type="checkbox"
            checked={extensionOnly}
            onChange={(event) => setExtensionOnly(event.target.checked)}
          />
          <span>Document types only</span>
        </label>
        <output>{filteredApps.length} of {apps.length}</output>
      </div>
      <div className="app-grid compact">
        {filteredApps.map((app) => (
          <AppCard app={app} key={app.id} />
        ))}
      </div>
    </section>
  );
}

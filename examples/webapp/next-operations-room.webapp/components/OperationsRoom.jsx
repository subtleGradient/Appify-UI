"use client";

import {
  Activity,
  CheckCircle2,
  Filter,
  RefreshCw,
  Search,
  ShieldAlert,
  SlidersHorizontal,
} from "lucide-react";
import { useMemo, useState } from "react";

const filters = [
  { id: "all", label: "All" },
  { id: "watch", label: "Watch" },
  { id: "blocked", label: "Blocked" },
];

const states = {
  clear: "Clear",
  watch: "Watch",
  blocked: "Blocked",
  triage: "Triage",
  ready: "Ready",
};

export function OperationsRoom({ initialPulse }) {
  const [pulse, setPulse] = useState(initialPulse);
  const [activeFilter, setActiveFilter] = useState("all");
  const [query, setQuery] = useState("");
  const [denseMode, setDenseMode] = useState(false);
  const [refreshState, setRefreshState] = useState("idle");

  const visibleIncidents = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    return pulse.incidents.filter((incident) => {
      const matchesFilter =
        activeFilter === "all" ||
        incident.state === activeFilter ||
        incident.severity === activeFilter;
      const matchesQuery =
        normalizedQuery.length === 0 ||
        [incident.id, incident.title, incident.area, incident.owner]
          .join(" ")
          .toLowerCase()
          .includes(normalizedQuery);
      return matchesFilter && matchesQuery;
    });
  }, [activeFilter, pulse.incidents, query]);

  async function refreshPulse() {
    setRefreshState("loading");
    try {
      const response = await fetch("/api/pulse", { cache: "no-store" });
      const nextPulse = await response.json();
      setPulse(nextPulse);
      setRefreshState("done");
      window.setTimeout(() => setRefreshState("idle"), 900);
    } catch {
      setRefreshState("error");
    }
  }

  return (
    <main className={denseMode ? "shell dense" : "shell"}>
      <aside className="sidebar" aria-label="Operations navigation">
        <div className="brand">
          <div className="brandMark" aria-hidden="true">
            <Activity size={18} strokeWidth={2.1} />
          </div>
          <div>
            <p className="eyebrow">Webapp example</p>
            <h1>Operations Room</h1>
          </div>
        </div>

        <nav className="navList" aria-label="Sections">
          <a href="#pulse" className="navItem active">
            <Activity size={16} />
            Pulse
          </a>
          <a href="#incidents" className="navItem">
            <ShieldAlert size={16} />
            Incidents
          </a>
          <a href="#controls" className="navItem">
            <SlidersHorizontal size={16} />
            Controls
          </a>
        </nav>

        <div className="sourceBox">
          {pulse.links.map((link) => (
            <div className="sourceRow" key={link.label}>
              <span>{link.label}</span>
              <strong>{link.detail}</strong>
              <em>{link.state}</em>
            </div>
          ))}
        </div>
      </aside>

      <section className="workspace">
        <header className="topbar">
          <div>
            <p className="eyebrow">Local package dashboard</p>
            <h2>Keep the launch surface small, visible, and calm.</h2>
          </div>

          <div className="actions" id="controls">
            <label className="search">
              <Search size={16} aria-hidden="true" />
              <input
                aria-label="Search incidents"
                name="incident-search"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Search incidents"
              />
            </label>
            <button className="iconButton" type="button" onClick={refreshPulse} aria-label="Refresh pulse">
              <RefreshCw size={16} className={refreshState === "loading" ? "spin" : ""} />
            </button>
          </div>
        </header>

        <section className="stats" id="pulse" aria-label="Operations summary">
          <Metric label="Average load" value={`${pulse.summary.averageLoad}%`} detail="Across active lanes" />
          <Metric label="Watch lanes" value={pulse.summary.watch} detail="Need owner attention" />
          <Metric label="Blocked" value={pulse.summary.blocked} detail="Waiting on a decision" />
          <Metric label="Incidents" value={pulse.summary.activeIncidents} detail="Open package work" />
        </section>

        <section className="laneGrid" aria-label="Shift lanes">
          {pulse.shifts.map((shift) => (
            <article className={`lane ${shift.state}`} key={shift.id}>
              <div className="laneHeader">
                <div>
                  <h3>{shift.label}</h3>
                  <p>{shift.owner}</p>
                </div>
                <span>{states[shift.state]}</span>
              </div>
              <div className="loadTrack" aria-label={`${shift.label} load ${shift.load}%`}>
                <span style={{ "--load": `${shift.load}%` }} />
              </div>
              <div className="laneMeta">
                <strong>{shift.load}%</strong>
                <span>Target {shift.target}%</span>
                <em>{shift.trend}</em>
              </div>
              <p>{shift.note}</p>
            </article>
          ))}
        </section>

        <section className="board">
          <div className="boardHeader">
            <div>
              <p className="eyebrow">Incident queue</p>
              <h2 id="incidents">Ready for a WebView, still honest about the process.</h2>
            </div>

            <div className="filterGroup" aria-label="Incident filters">
              <Filter size={16} aria-hidden="true" />
              {filters.map((filter) => (
                <button
                  type="button"
                  className={activeFilter === filter.id ? "selected" : ""}
                  key={filter.id}
                  onClick={() => setActiveFilter(filter.id)}
                >
                  {filter.label}
                </button>
              ))}
            </div>
          </div>

          <div className="incidentList">
            {visibleIncidents.map((incident) => (
              <article className={`incident ${incident.severity}`} key={incident.id}>
                <div className="incidentTitle">
                  <span>{incident.id}</span>
                  <h3>{incident.title}</h3>
                </div>
                <div className="incidentMeta">
                  <span>{incident.area}</span>
                  <span>{incident.owner}</span>
                  <span>{incident.age}</span>
                  <strong>{states[incident.state]}</strong>
                </div>
                <p>{incident.next}</p>
              </article>
            ))}
          </div>
        </section>

        <section className="footerBand" aria-label="Launch milestones">
          <div className="milestones">
            {pulse.milestones.map((milestone) => (
              <div className="milestone" key={milestone.label}>
                <span>{milestone.label}</span>
                <strong>{milestone.value}%</strong>
                <div className={`miniTrack ${milestone.tone}`}>
                  <span style={{ "--value": `${milestone.value}%` }} />
                </div>
              </div>
            ))}
          </div>
          <label className="toggle">
            <input
              type="checkbox"
              name="dense-mode"
              checked={denseMode}
              onChange={(event) => setDenseMode(event.target.checked)}
            />
            <span aria-hidden="true" />
            Dense view
          </label>
        </section>
      </section>
    </main>
  );
}

function Metric({ label, value, detail }) {
  return (
    <article className="metric">
      <span>{label}</span>
      <strong>{value}</strong>
      <p>{detail}</p>
    </article>
  );
}

"use client";

import {
  Calculator,
  CheckCircle2,
  Gauge,
  GitCompareArrows,
  RefreshCw,
  SlidersHorizontal,
} from "lucide-react";
import { useMemo, useState } from "react";

const bands = [
  { max: -1, label: "Masterstroke", tone: "best" },
  { max: 3, label: "Solid", tone: "good" },
  { max: 7, label: "Weak", tone: "watch" },
  { max: 12, label: "Sucker", tone: "bad" },
  { max: Number.POSITIVE_INFINITY, label: "Stop", tone: "stop" },
];

export function ScenarioLab({ initialSet }) {
  const [scenarioSet, setScenarioSet] = useState(initialSet);
  const [selectedId, setSelectedId] = useState(initialSet.scenarios[0]?.id);
  const [enabledMitigations, setEnabledMitigations] = useState(() => new Set(["pass-bar", "no-host-change"]));
  const [refreshState, setRefreshState] = useState("idle");

  const selected = scenarioSet.scenarios.find((scenario) => scenario.id === selectedId) ?? scenarioSet.scenarios[0];
  const axisSet = scenarioSet.axes[selected.type];
  const adjustedScores = useMemo(() => {
    const nextScores = { ...selected.scores };
    for (const mitigation of selected.mitigations) {
      if (!enabledMitigations.has(mitigation.id)) continue;
      for (const [key, value] of Object.entries(mitigation.delta)) {
        nextScores[key] = (nextScores[key] ?? 0) + value;
      }
    }
    return nextScores;
  }, [enabledMitigations, selected]);
  const total = Object.values(adjustedScores).reduce((sum, score) => sum + score, 0);
  const band = bands.find((candidate) => total <= candidate.max) ?? bands.at(-1);
  const selectedMitigations = selected.mitigations.filter((mitigation) => enabledMitigations.has(mitigation.id));

  function toggleMitigation(id) {
    setEnabledMitigations((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function refreshScenarios() {
    setRefreshState("loading");
    try {
      const response = await fetch("/api/scenarios", { cache: "no-store" });
      setScenarioSet(await response.json());
      setRefreshState("done");
      window.setTimeout(() => setRefreshState("idle"), 900);
    } catch {
      setRefreshState("error");
    }
  }

  return (
    <main className="labShell">
      <aside className="leftRail" aria-label="Scenario list">
        <div className="masthead">
          <Gauge size={18} aria-hidden="true" />
          <div>
            <p className="eyebrow">Next.js .webapp</p>
            <h1>Scenario Lab</h1>
          </div>
        </div>

        <div className="scenarioList">
          {scenarioSet.scenarios.map((scenario) => {
            const scenarioTotal = Object.values(scenario.scores).reduce((sum, score) => sum + score, 0);
            return (
              <button
                type="button"
                className={scenario.id === selected.id ? "scenario selected" : "scenario"}
                key={scenario.id}
                onClick={() => setSelectedId(scenario.id)}
              >
                <span>{scenario.type === "decision" ? "Decision" : "Thing"}</span>
                <strong>{scenario.name}</strong>
                <em>{scenarioTotal > 0 ? `+${scenarioTotal}` : scenarioTotal}</em>
              </button>
            );
          })}
        </div>
      </aside>

      <section className="labWorkspace">
        <header className="labTop">
          <div>
            <p className="eyebrow">{selected.type === "decision" ? "Decision Golf" : "Thing Golf"}</p>
            <h2>{selected.summary}</h2>
          </div>
          <button className="toolButton" type="button" onClick={refreshScenarios}>
            <RefreshCw size={16} className={refreshState === "loading" ? "spin" : ""} />
            Refresh
          </button>
        </header>

        <section className="scoreHero" aria-label="Selected scenario score">
          <div className="scoreNumber">
            <span>Total</span>
            <strong>{total > 0 ? `+${total}` : total}</strong>
            <em className={band.tone}>{band.label}</em>
          </div>
          <div className="scoreNarrative">
            <h3>{selected.name}</h3>
            <p>{selected.note}</p>
            <div className="applied">
              <CheckCircle2 size={16} aria-hidden="true" />
              <span>
                {selectedMitigations.length === 0
                  ? "No mitigations applied."
                  : `${selectedMitigations.length} mitigation${selectedMitigations.length === 1 ? "" : "s"} applied.`}
              </span>
            </div>
          </div>
        </section>

        <section className="axisGrid" aria-label="Axis scores">
          {axisSet.map((axis) => {
            const score = adjustedScores[axis.key] ?? 0;
            return (
              <article className="axis" key={axis.key}>
                <div className="axisTop">
                  <div>
                    <span>{axis.label}</span>
                    <strong>{score > 0 ? `+${score}` : score}</strong>
                  </div>
                  <em>{score <= 0 ? axis.good : axis.bad}</em>
                </div>
                <div className="axisTrack">
                  <span style={{ "--offset": `${Math.min(100, Math.max(0, (score + 4) * 12.5))}%` }} />
                </div>
              </article>
            );
          })}
        </section>

        <section className="lowerGrid">
          <div className="panel">
            <div className="panelTitle">
              <SlidersHorizontal size={16} aria-hidden="true" />
              <h3>Mitigations</h3>
            </div>
            <div className="mitigations">
              {selected.mitigations.map((mitigation) => (
                <label className="mitigation" key={mitigation.id}>
                  <input
                    type="checkbox"
                    name={`mitigation-${mitigation.id}`}
                    checked={enabledMitigations.has(mitigation.id)}
                    onChange={() => toggleMitigation(mitigation.id)}
                  />
                  <span aria-hidden="true" />
                  <strong>{mitigation.label}</strong>
                  <em>{formatDelta(mitigation.delta)}</em>
                </label>
              ))}
            </div>
          </div>

          <div className="panel">
            <div className="panelTitle">
              <GitCompareArrows size={16} aria-hidden="true" />
              <h3>Readout</h3>
            </div>
            <dl className="readout">
              <div>
                <dt>Package shape</dt>
                <dd>Normal Bun package with `.webapp` Finder identity.</dd>
              </div>
              <div>
                <dt>Runtime boundary</dt>
                <dd>`bun install`, `bun dev`, local URL, stable WebKit origin.</dd>
              </div>
              <div>
                <dt>Next action</dt>
                <dd>Ship examples first; mutate the host only after the friction repeats.</dd>
              </div>
            </dl>
          </div>

          <div className="panel compact">
            <div className="panelTitle">
              <Calculator size={16} aria-hidden="true" />
              <h3>Formula</h3>
            </div>
            <p>
              Sum the bad-side points. Negative values mean the move removes liability; positive values mean the
              package, decision, or workflow carries more future pain.
            </p>
          </div>
        </section>
      </section>
    </main>
  );
}

function formatDelta(delta) {
  return Object.entries(delta)
    .map(([key, value]) => `${key} ${value > 0 ? "+" : ""}${value}`)
    .join(", ");
}

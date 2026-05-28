const axes = {
  decision: [
    { key: "calibration", label: "Calibration", good: "Calibrated", bad: "Deaf" },
    { key: "exposure", label: "Exposure", good: "Obscured", bad: "Exposed" },
    { key: "reactivity", label: "Reactivity", good: "Sovereign", bad: "Reactive" },
    { key: "ruin", label: "Ruin", good: "Asymmetric", bad: "Ruinous" },
    { key: "rigidity", label: "Rigidity", good: "Fluid", bad: "Rigid" },
  ],
  thing: [
    { key: "safety", label: "Safety", good: "Safe", bad: "Explosive" },
    { key: "burden", label: "Burden", good: "Lighter", bad: "Heavier" },
    { key: "chaos", label: "Chaos", good: "Clear", bad: "Chaotic" },
    { key: "betrayal", label: "Trust", good: "Trustworthy", bad: "Betraying" },
    { key: "control", label: "Control", good: "Free", bad: "Control-freak" },
  ],
};

const scenarios = [
  {
    id: "generic-webapp-first",
    name: "Generic Webapp first",
    type: "decision",
    summary: "Build framework examples in .webapp before creating dedicated framework apps.",
    scores: { calibration: -2, exposure: 0, reactivity: -2, ruin: -1, rigidity: -2 },
    mitigations: [
      { id: "pass-bar", label: "Write pass bars before examples", delta: { calibration: -1, rigidity: -1 } },
      { id: "no-host-change", label: "Avoid host changes in this pass", delta: { ruin: -1, reactivity: -1 } },
      { id: "document-cache", label: "Document generated cache boundaries", delta: { exposure: -1 } },
    ],
    note: "Small generic bet, high information gain, low lock-in.",
  },
  {
    id: "dev-sidebar",
    name: "Webapp dev sidebar",
    type: "decision",
    summary: "Expose Bun or Expo terminal output next to the live WebView in Webapp.app.",
    scores: { calibration: -1, exposure: 0, reactivity: 0, ruin: 1, rigidity: 1 },
    mitigations: [
      { id: "read-only-log", label: "Start with read-only log pane", delta: { ruin: -1, rigidity: -1 } },
      { id: "sidebar-toggle", label: "Make sidebar optional per window", delta: { rigidity: -1 } },
      { id: "lazy-terminal", label: "Promote to TTY only for Expo-style flows", delta: { calibration: -1, exposure: -1 } },
    ],
    note: "Promising, but worth proving with examples before adding native chrome.",
  },
  {
    id: "auto-run-packages",
    name: "Auto-run arbitrary packages",
    type: "decision",
    summary: "Open every .webapp by immediately installing and running package scripts.",
    scores: { calibration: 1, exposure: 3, reactivity: 2, ruin: 4, rigidity: 1 },
    mitigations: [
      { id: "explicit-document-type", label: "Keep .webapp as explicit executable package type", delta: { exposure: -1 } },
      { id: "visible-log", label: "Tee lifecycle output to .local/dev.log", delta: { ruin: -1 } },
      { id: "loopback-only", label: "Load loopback URLs only", delta: { ruin: -1, exposure: -1 } },
    ],
    note: "Good for local experiments, dangerous if it stops feeling explicit.",
  },
  {
    id: "next-examples",
    name: "Next.js examples",
    type: "thing",
    summary: "Add two Next.js App Router packages under examples/webapp.",
    scores: { safety: 1, burden: 2, chaos: -1, betrayal: 0, control: 0 },
    mitigations: [
      { id: "plain-js", label: "Keep source plain JS and CSS", delta: { chaos: -1, burden: -1 } },
      { id: "package-ignore", label: "Ignore generated framework state", delta: { betrayal: -1, chaos: -1 } },
      { id: "api-small", label: "Keep API routes read-only", delta: { safety: -1 } },
    ],
    note: "More dependency weight, but the framework path becomes concrete.",
  },
  {
    id: "expo-example",
    name: "Expo Web example",
    type: "thing",
    summary: "Add an Expo Web package that demonstrates the TUI/WebView tension.",
    scores: { safety: 1, burden: 2, chaos: 1, betrayal: 0, control: 1 },
    mitigations: [
      { id: "localhost", label: "Use --localhost and fixed web port", delta: { safety: -1, exposure: -1 } },
      { id: "no-native-modules", label: "Avoid native-only APIs in the example", delta: { chaos: -1, burden: -1 } },
      { id: "readme-caveat", label: "Document Terminal UI caveat", delta: { betrayal: -1 } },
    ],
    note: "Good proof because Expo is where the generic runner feels least browser-native.",
  },
];

export function getScenarioSet() {
  return {
    generatedAt: "2026-05-27T15:10:00.000Z",
    axes,
    scenarios,
  };
}

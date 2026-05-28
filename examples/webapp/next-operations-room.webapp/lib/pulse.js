const shifts = [
  {
    id: "intake",
    label: "Intake",
    owner: "Mara",
    load: 68,
    target: 72,
    trend: "+8%",
    state: "watch",
    note: "Two review queues are close to the morning SLA edge.",
  },
  {
    id: "build",
    label: "Build",
    owner: "Jon",
    load: 44,
    target: 62,
    trend: "-6%",
    state: "clear",
    note: "Artifact signing is clean and the cache hit rate recovered.",
  },
  {
    id: "support",
    label: "Support",
    owner: "Inez",
    load: 81,
    target: 70,
    trend: "+14%",
    state: "blocked",
    note: "Two customer escalations need a release-owner decision.",
  },
  {
    id: "docs",
    label: "Docs",
    owner: "Lee",
    load: 37,
    target: 58,
    trend: "-11%",
    state: "clear",
    note: "Migration notes are drafted and waiting for screenshots.",
  },
];

const incidents = [
  {
    id: "INC-2841",
    title: "Signed bundle failed notarization",
    area: "Release",
    severity: "major",
    state: "blocked",
    owner: "Mara",
    age: "42m",
    next: "Compare local entitlements with CI archive.",
  },
  {
    id: "INC-2840",
    title: "Preview cache did not invalidate",
    area: "Webapp",
    severity: "watch",
    state: "triage",
    owner: "Jon",
    age: "1h 18m",
    next: "Reproduce after deleting package-local .next output.",
  },
  {
    id: "INC-2837",
    title: "Support macro drifted from current menu labels",
    area: "Support",
    severity: "minor",
    state: "ready",
    owner: "Inez",
    age: "3h",
    next: "Ship copy patch with the next docs pass.",
  },
  {
    id: "INC-2834",
    title: "Demo package prints LAN URL before localhost",
    area: "Runner",
    severity: "watch",
    state: "triage",
    owner: "Lee",
    age: "5h",
    next: "Force loopback host in the package dev script.",
  },
];

const milestones = [
  { label: "Dependency install", value: 92, tone: "teal" },
  { label: "Ready URL detection", value: 84, tone: "amber" },
  { label: "Stable-origin tunnel", value: 76, tone: "rose" },
  { label: "Window restore", value: 88, tone: "green" },
];

const links = [
  { label: "Run log", detail: ".local/dev.log", state: "live" },
  { label: "Host", detail: "Webapp.app", state: "stable" },
  { label: "Document", detail: "next-operations-room.webapp", state: "local" },
];

export function getPulse() {
  const blocked = incidents.filter((incident) => incident.state === "blocked").length;
  const watch = shifts.filter((shift) => shift.state !== "clear").length;
  const averageLoad = Math.round(shifts.reduce((sum, shift) => sum + shift.load, 0) / shifts.length);

  return {
    generatedAt: "2026-05-27T14:45:00.000Z",
    summary: {
      averageLoad,
      blocked,
      watch,
      activeIncidents: incidents.length,
    },
    shifts,
    incidents,
    milestones,
    links,
  };
}

export type AppEntry = {
  id: string;
  name: string;
  path: string;
  kind: string;
  extensions: string[];
  description: string;
  highlights: string[];
  tone: "green" | "blue" | "red" | "gold";
};

export type ExampleEntry = {
  name: string;
  path: string;
  stack: string;
  description: string;
};

export const apps: AppEntry[] = [
  {
    id: "web",
    name: "Web.app",
    path: "Web.app",
    kind: "Static document host",
    extensions: [".web"],
    description: "Opens browser-native folders with HTML, CSS, JavaScript, assets, data, and relative links.",
    highlights: ["Static document package", "Peer .web package routes", "No install step in the artifact"],
    tone: "green",
  },
  {
    id: "webapp",
    name: "Webapp.app",
    path: "Webapp.app",
    kind: "Bun package host",
    extensions: [".webapp"],
    description: "Runs local Bun package folders through install and dev scripts, then opens the loopback app in a native WebKit window.",
    highlights: ["Framework dev server boundary", "Stable localhost origin", "Package-shaped authoring"],
    tone: "blue",
  },
  {
    id: "webformer",
    name: "WebFormer.app",
    path: "WebFormer.app",
    kind: "Single-file form host",
    extensions: [".webform"],
    description: "Serves single-file HTML documents and writes edited native form state back into narrow source spans.",
    highlights: ["One HTML document", "Runtime save affordances", "Source-preserving patches"],
    tone: "gold",
  },
  {
    id: "tlcanvas",
    name: "TLCanvas.app",
    path: "TLCanvas.app",
    kind: "Canvas document host",
    extensions: [".tlcanvas"],
    description: "Bundles the tldraw SDK runner for canvas-shaped documents with schema, tests, lockfile, and local server code.",
    highlights: ["tldraw SDK", "Document package output", "App-local runner"],
    tone: "red",
  },
  {
    id: "jsoncanvas",
    name: "JSONCanvas.app",
    path: "JSONCanvas.app",
    kind: "JSON Canvas host",
    extensions: [".canvas"],
    description: "Opens JSON Canvas files, validates nodes and edges, and writes changes back as plain JSON.",
    highlights: ["Plain JSON storage", "Bun web runner", "Native document window"],
    tone: "green",
  },
  {
    id: "lazygit",
    name: "LazyGit.app",
    path: "LazyGit.app",
    kind: "TUI host",
    extensions: [".lazygit"],
    description: "Starts lazygit for a repository marker package and shows the terminal UI inside a native app shell.",
    highlights: ["ttyd transport", "Repo marker package", "Git-focused local tool"],
    tone: "blue",
  },
  {
    id: "scripts",
    name: "Scripts.app",
    path: "Scripts.app",
    kind: "Script runner",
    extensions: [".scripts"],
    description: "Lists executable peer files and package scripts, then runs selected commands through terminal sessions.",
    highlights: ["Local code execution", "Project script catalogs", "Terminal-backed sessions"],
    tone: "blue",
  },
  {
    id: "logscope",
    name: "LogScope.app",
    path: "LogScope.app",
    kind: "Log TUI host",
    extensions: [".log", ".jsonl", ".ndjson"],
    description: "Starts lnav for log-shaped files and shows the indexed timeline in a native WebKit window.",
    highlights: ["Log inspection", "Terminal-backed UI", "Focused file associations"],
    tone: "gold",
  },
  {
    id: "wiki",
    name: "WikiDock.app",
    path: "WikiDock.app",
    kind: "TiddlyWiki host",
    extensions: [".tiddlywiki"],
    description: "Opens standard TiddlyWikiFolder packages without registering as a generic HTML handler.",
    highlights: ["Folder-native wiki", "TiddlyWiki contract", "Focused document type"],
    tone: "red",
  },
  {
    id: "data",
    name: "tw.app and litecli.app",
    path: "tw.app / litecli.app",
    kind: "Data TUI hosts",
    extensions: [".csv", ".jsonl", ".sqlite"],
    description: "Wrap tabular data and SQLite command-line tools in small native document hosts.",
    highlights: ["Tabiew", "litecli", "Read-focused data inspection"],
    tone: "green",
  },
];

export const examples: ExampleEntry[] = [
  {
    name: "Astro Blog Webapp",
    path: "examples/webapp/astro-blog.webapp",
    stack: "Astro + React islands",
    description: "Static content routes, React JSX composition, and one hydrated island exported into a sibling .web bundle.",
  },
  {
    name: "Expo Field Kit",
    path: "examples/webapp/expo-field-kit.webapp",
    stack: "Expo Web",
    description: "React Native Web controls exported into a static .web package for Web.app.",
  },
  {
    name: "Next Operations Room",
    path: "examples/webapp/next-operations-room.webapp",
    stack: "Next.js App Router",
    description: "A local operations dashboard with an API route and Webapp.app dev server lifecycle.",
  },
  {
    name: "Next Scenario Lab",
    path: "examples/webapp/next-scenario-lab.webapp",
    stack: "Next.js App Router",
    description: "A small scoring lab for comparing bundle decisions and mitigation toggles.",
  },
  {
    name: "Web Native Bundles",
    path: "examples/web-native-bundles",
    stack: "Plain static web",
    description: "Framework-free .web packages proving static, inspectable, browser-native document bundles.",
  },
  {
    name: "Web Compat Fixtures",
    path: "examples/web-compat",
    stack: "Compatibility cases",
    description: "Small red-case .web fixtures that justify Web.app compatibility behavior.",
  },
];

export const principles = [
  "Object-first repository shape: apps, runners, examples, and fixtures stay near the thing they serve.",
  "Static artifacts are ordinary folders whenever possible, with build tools kept on the source side.",
  "Native document identity comes from small focused hosts, not from one generic mega-runtime.",
  "Bun-powered .webapp packages are the explicit boundary for framework dev servers and export steps.",
];

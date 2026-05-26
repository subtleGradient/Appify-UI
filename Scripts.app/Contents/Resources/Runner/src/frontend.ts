type ScriptOrigin = "peer" | "package";

type ScriptEntry = {
  id: string;
  origin: ScriptOrigin;
  name: string;
  path: string;
  cwd: string;
  displayPath: string;
};

type ScriptCatalog = {
  documentPath: string;
  workingDirectory: string;
  scripts: ScriptEntry[];
  notice: string;
};

type RunRecord = {
  id: string;
  scriptId: string;
  scriptName: string;
  origin: ScriptOrigin;
  status: "starting" | "running" | "exited" | "failed" | "stopped";
  command: string;
  cwd: string;
  startedAt: string;
  endedAt?: string;
  exitCode?: number;
  signal?: string;
  error?: string;
  terminalPath: string;
  diagnostics: string;
  diagnosticsTruncated: boolean;
};

type AppConfig = {
  basePath: string;
  token: string;
};

declare global {
  interface Window {
    SCRIPTS_APP_CONFIG: AppConfig;
  }
}

const config = window.SCRIPTS_APP_CONFIG;
const elements = {
  workingDirectory: mustElement<HTMLElement>("working-directory"),
  connectionStatus: mustElement<HTMLElement>("connection-status"),
  refreshButton: mustElement<HTMLButtonElement>("refresh-button"),
  scriptList: mustElement<HTMLElement>("script-list"),
  scriptTitle: mustElement<HTMLElement>("script-title"),
  scriptPath: mustElement<HTMLElement>("script-path"),
  scriptOrigin: mustElement<HTMLElement>("script-origin"),
  scriptCwd: mustElement<HTMLElement>("script-cwd"),
  commandPreview: mustElement<HTMLElement>("command-preview"),
  runForm: mustElement<HTMLFormElement>("run-form"),
  argsInput: mustElement<HTMLInputElement>("args-input"),
  runButton: mustElement<HTMLButtonElement>("run-button"),
  stopButton: mustElement<HTMLButtonElement>("stop-button"),
  copyCommandButton: mustElement<HTMLButtonElement>("copy-command-button"),
  terminalFrame: mustElement<HTMLIFrameElement>("terminal-frame"),
  diagnostics: mustElement<HTMLElement>("diagnostics"),
  runList: mustElement<HTMLElement>("run-list"),
};

let catalog: ScriptCatalog | null = null;
let selectedScriptId = "";
let selectedRunId = "";
let selectedRun: RunRecord | null = null;
let pollTimer: ReturnType<typeof setInterval> | null = null;

async function boot() {
  bindEvents();
  await refreshCatalog();
  await refreshRuns();
  setConnectionStatus("Connected", false);
  pollTimer = setInterval(() => {
    void refreshSelectedRun();
    void refreshRuns();
  }, 1200);
}

function bindEvents() {
  elements.refreshButton.addEventListener("click", () => {
    void refreshCatalog();
    void refreshRuns();
  });

  elements.argsInput.addEventListener("input", renderCommandPreview);

  elements.runForm.addEventListener("submit", (event) => {
    event.preventDefault();
    void runSelectedScript();
  });

  elements.stopButton.addEventListener("click", () => {
    if (!selectedRunId) {
      return;
    }
    void api<RunRecord>(`/api/runs/${encodeURIComponent(selectedRunId)}/stop`, {
      method: "POST",
      token: true,
    }).then((run) => {
      selectedRun = run;
      renderRun(run);
      void refreshRuns();
    }).catch((error) => setConnectionStatus(messageFromError(error), true));
  });

  elements.copyCommandButton.addEventListener("click", () => {
    const command = selectedRun?.command || elements.commandPreview.textContent || "";
    void navigator.clipboard?.writeText(command);
  });
}

async function refreshCatalog() {
  catalog = await api<ScriptCatalog>("/api/catalog");
  elements.workingDirectory.textContent = catalog.workingDirectory;
  if (!selectedScriptId || !catalog.scripts.some((script) => script.id === selectedScriptId)) {
    selectedScriptId = catalog.scripts[0]?.id ?? "";
  }
  renderScripts();
  renderSelectedScript();
}

async function refreshRuns() {
  const result = await api<{ runs: RunRecord[] }>("/api/runs");
  renderRuns(result.runs);
}

async function refreshSelectedRun() {
  if (!selectedRunId) {
    return;
  }

  try {
    const run = await api<RunRecord>(`/api/runs/${encodeURIComponent(selectedRunId)}`);
    selectedRun = run;
    renderRun(run);
  } catch {
    selectedRunId = "";
    selectedRun = null;
  }
}

async function runSelectedScript() {
  const script = selectedScript();
  if (!script) {
    return;
  }

  elements.runButton.disabled = true;
  setConnectionStatus("Starting terminal", false);

  try {
    const run = await api<RunRecord>("/api/runs", {
      method: "POST",
      token: true,
      body: {
        scriptId: script.id,
        argsText: elements.argsInput.value,
      },
    });
    selectedRunId = run.id;
    selectedRun = run;
    renderRun(run);
    await refreshRuns();
    setConnectionStatus("Connected", false);
  } catch (error) {
    setConnectionStatus(messageFromError(error), true);
  } finally {
    elements.runButton.disabled = false;
  }
}

function renderScripts() {
  if (!catalog) {
    return;
  }

  if (catalog.scripts.length === 0) {
    const empty = document.createElement("p");
    empty.className = "empty";
    empty.textContent = "No executable scripts";
    elements.scriptList.replaceChildren(empty);
    return;
  }

  elements.scriptList.replaceChildren(...catalog.scripts.map((script) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "script-button";
    button.setAttribute("aria-selected", String(script.id === selectedScriptId));
    button.addEventListener("click", () => {
      selectedScriptId = script.id;
      selectedRun = null;
      renderScripts();
      renderSelectedScript();
    });

    const title = document.createElement("strong");
    title.textContent = script.name;
    const path = document.createElement("span");
    path.textContent = script.displayPath;
    const origin = document.createElement("span");
    origin.textContent = script.origin;
    button.append(title, path, origin);
    return button;
  }));
}

function renderSelectedScript() {
  const script = selectedScript();
  if (!script) {
    elements.scriptTitle.textContent = "No script selected";
    elements.scriptPath.textContent = "";
    elements.scriptOrigin.textContent = "Idle";
    elements.scriptCwd.textContent = "-";
    elements.commandPreview.textContent = "-";
    elements.runButton.disabled = true;
    return;
  }

  elements.scriptTitle.textContent = script.name;
  elements.scriptPath.textContent = script.path;
  elements.scriptOrigin.textContent = script.origin;
  elements.scriptCwd.textContent = script.cwd;
  elements.runButton.disabled = false;
  renderCommandPreview();
}

function renderCommandPreview() {
  const script = selectedScript();
  if (!script) {
    return;
  }
  const args = elements.argsInput.value.trim();
  elements.commandPreview.textContent = args ? `${shellToken(script.path)} ${args}` : shellToken(script.path);
}

function renderRuns(runs: RunRecord[]) {
  if (runs.length === 0) {
    const empty = document.createElement("p");
    empty.className = "empty";
    empty.textContent = "No runs";
    elements.runList.replaceChildren(empty);
    return;
  }

  elements.runList.replaceChildren(...runs.map((run) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "run-item";
    button.setAttribute("aria-selected", String(run.id === selectedRunId));
    button.addEventListener("click", () => {
      selectedRunId = run.id;
      selectedRun = run;
      renderRun(run);
      renderRuns(runs);
    });

    const title = document.createElement("strong");
    title.textContent = run.scriptName;
    const status = document.createElement("span");
    status.textContent = `${run.status}${run.exitCode === undefined ? "" : ` ${run.exitCode}`}`;
    const time = document.createElement("span");
    time.textContent = new Date(run.startedAt).toLocaleTimeString();
    button.append(title, status, time);
    return button;
  }));
}

function renderRun(run: RunRecord) {
  elements.stopButton.disabled = run.status !== "running" && run.status !== "starting";
  elements.copyCommandButton.disabled = false;
  elements.diagnostics.textContent = run.error || run.diagnostics || run.command;
  if (run.status === "running" || run.status === "starting" || run.status === "exited") {
    const terminalURL = new URL(run.terminalPath.endsWith("/") ? run.terminalPath : `${run.terminalPath}/`, window.location.origin);
    if (elements.terminalFrame.src !== terminalURL.href) {
      elements.terminalFrame.src = terminalURL.href;
    }
  }
}

function selectedScript(): ScriptEntry | null {
  return catalog?.scripts.find((script) => script.id === selectedScriptId) ?? null;
}

async function api<T>(path: string, options: {
  method?: string;
  body?: unknown;
  token?: boolean;
} = {}): Promise<T> {
  const headers = new Headers({
    Accept: "application/json",
  });
  if (options.body !== undefined) {
    headers.set("Content-Type", "application/json");
  }
  if (options.token) {
    headers.set("X-Scripts-Token", config.token);
  }

  const response = await fetch(`${config.basePath}${path}`, {
    method: options.method ?? "GET",
    headers,
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  });

  const text = await response.text();
  const data = text ? JSON.parse(text) : null;
  if (!response.ok) {
    throw new Error(data?.error ?? text ?? response.statusText);
  }
  return data as T;
}

function setConnectionStatus(message: string, isError: boolean) {
  elements.connectionStatus.textContent = message;
  elements.connectionStatus.classList.toggle("danger", isError);
}

function mustElement<T extends Element>(id: string): T {
  const element = document.getElementById(id);
  if (!element) {
    throw new Error(`Missing element #${id}`);
  }
  return element as T;
}

function shellToken(value: string): string {
  if (/^[A-Za-z0-9_./:@%+=,-]+$/.test(value)) {
    return value;
  }
  return `'${value.replaceAll("'", "'\\''")}'`;
}

function messageFromError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

globalThis.addEventListener("beforeunload", () => {
  if (pollTimer) {
    clearInterval(pollTimer);
  }
});

void boot().catch((error) => {
  setConnectionStatus(messageFromError(error), true);
});

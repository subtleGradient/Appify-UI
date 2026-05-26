type ScriptInputField = {
  name: string;
  label: string;
  type: "app" | "path" | "text" | "signMode";
  required?: boolean;
  placeholder?: string;
};

type ScriptCatalogEntry = {
  id: string;
  title: string;
  path: string;
  description: string;
  runnable: boolean;
  longRunning?: boolean;
  inputs: ScriptInputField[];
};

type CatalogPayload = {
  repoRoot: string;
  apps: string[];
  scripts: ScriptCatalogEntry[];
};

type RunRecord = {
  id: string;
  scriptId: string;
  status: "running" | "exited" | "failed" | "stopped";
  command: string;
  startedAt: string;
  endedAt?: string;
  exitCode?: number;
  error?: string;
  log: string;
  truncated: boolean;
  longRunning: boolean;
};

type JsonRpcMessage = {
  jsonrpc: "2.0";
  id?: number | string;
  method?: string;
  params?: unknown;
  result?: unknown;
  error?: { code: number; message: string; data?: unknown };
};

type ToolResult<T> = {
  structuredContent?: T;
  content?: Array<{ type: string; text?: string }>;
};

const MCP_ENDPOINT = "/mcp";
const PROTOCOL_VERSION = "2025-06-18";

const elements = {
  repoRoot: mustElement<HTMLElement>("repo-root"),
  connectionStatus: mustElement<HTMLElement>("connection-status"),
  refreshButton: mustElement<HTMLButtonElement>("refresh-button"),
  scriptList: mustElement<HTMLElement>("script-list"),
  scriptTitle: mustElement<HTMLElement>("script-title"),
  scriptPath: mustElement<HTMLElement>("script-path"),
  scriptState: mustElement<HTMLElement>("script-state"),
  runForm: mustElement<HTMLFormElement>("run-form"),
  formFields: mustElement<HTMLElement>("form-fields"),
  runButton: mustElement<HTMLButtonElement>("run-button"),
  stopButton: mustElement<HTMLButtonElement>("stop-button"),
  runId: mustElement<HTMLElement>("run-id"),
  runStatus: mustElement<HTMLElement>("run-status"),
  runExit: mustElement<HTMLElement>("run-exit"),
  runLog: mustElement<HTMLElement>("run-log"),
  runList: mustElement<HTMLElement>("run-list"),
  copyLogButton: mustElement<HTMLButtonElement>("copy-log-button"),
};

let catalog: CatalogPayload | null = null;
let selectedScriptId = "";
let selectedRunId = "";
let pollTimer: ReturnType<typeof setInterval> | null = null;

async function boot() {
  bindEvents();
  try {
    await client.initialize();
    setConnectionStatus("Connected", false);
    await refreshCatalog();
    await refreshRuns();
    pollTimer = setInterval(() => {
      void refreshSelectedRun();
      void refreshRuns();
    }, 1200);
  } catch (error) {
    setConnectionStatus(messageFromError(error), true);
  }
}

function bindEvents() {
  elements.refreshButton.addEventListener("click", () => {
    void refreshCatalog();
    void refreshRuns();
  });

  elements.runForm.addEventListener("submit", (event) => {
    event.preventDefault();
    void runSelectedScript();
  });

  elements.stopButton.addEventListener("click", () => {
    if (!selectedRunId) {
      return;
    }
    void client.callTool<RunRecord>("appify.stop_run", { runId: selectedRunId })
      .then((run) => {
        selectedRunId = run.id;
        renderRun(run);
        void refreshRuns();
      })
      .catch((error) => setConnectionStatus(messageFromError(error), true));
  });

  elements.copyLogButton.addEventListener("click", () => {
    void navigator.clipboard?.writeText(elements.runLog.textContent ?? "");
  });
}

async function refreshCatalog() {
  catalog = await client.callTool<CatalogPayload>("appify.list_scripts", {});
  elements.repoRoot.textContent = catalog.repoRoot;
  if (!selectedScriptId) {
    selectedScriptId = catalog.scripts.find((script) => script.runnable)?.id ?? catalog.scripts[0]?.id ?? "";
  }
  renderScripts();
  renderSelectedScript();
}

async function refreshRuns() {
  const result = await client.callTool<{ runs: RunRecord[] }>("appify.list_runs", {});
  renderRuns(result.runs);
}

async function refreshSelectedRun() {
  if (!selectedRunId) {
    return;
  }
  try {
    const run = await client.callTool<RunRecord>("appify.get_run", { runId: selectedRunId });
    renderRun(run);
  } catch {
    selectedRunId = "";
  }
}

async function runSelectedScript() {
  const script = selectedScript();
  if (!script?.runnable) {
    return;
  }

  elements.runButton.disabled = true;
  setConnectionStatus("Running", false);

  try {
    const input: Record<string, string> = { scriptId: script.id };
    const formData = new FormData(elements.runForm);
    for (const [key, value] of formData.entries()) {
      if (typeof value === "string" && value.trim()) {
        input[key] = value.trim();
      }
    }
    const run = await client.callTool<RunRecord>("appify.run_script", input);
    selectedRunId = run.id;
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

  elements.scriptList.replaceChildren(...catalog.scripts.map((script) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "script-button";
    button.setAttribute("aria-selected", String(script.id === selectedScriptId));
    button.disabled = !script.runnable && script.inputs.length > 0;
    button.addEventListener("click", () => {
      selectedScriptId = script.id;
      renderScripts();
      renderSelectedScript();
    });

    const title = document.createElement("strong");
    title.textContent = script.title;
    const path = document.createElement("span");
    path.textContent = script.path;
    const state = document.createElement("span");
    state.textContent = script.runnable ? "Runnable" : "Helper";
    if (!script.runnable) {
      state.className = "danger";
    }

    button.append(title, path, state);
    return button;
  }));
}

function renderSelectedScript() {
  const script = selectedScript();
  if (!script) {
    elements.scriptTitle.textContent = "Select a script";
    elements.scriptPath.textContent = "";
    elements.scriptState.textContent = "Idle";
    elements.formFields.replaceChildren();
    elements.runButton.disabled = true;
    return;
  }

  elements.scriptTitle.textContent = script.title;
  elements.scriptPath.textContent = script.path;
  elements.scriptState.textContent = script.runnable ? (script.longRunning ? "Long running" : "Runnable") : "Helper";
  elements.runButton.disabled = !script.runnable;
  elements.formFields.replaceChildren(...script.inputs.map((field) => renderField(field)));
}

function renderField(field: ScriptInputField): HTMLElement {
  const wrapper = document.createElement("div");
  wrapper.className = "field";

  const label = document.createElement("label");
  label.textContent = field.label;
  label.htmlFor = `field-${field.name}`;
  wrapper.append(label);

  if (field.type === "app") {
    const select = document.createElement("select");
    select.id = `field-${field.name}`;
    select.name = field.name;
    select.required = Boolean(field.required);
    for (const app of catalog?.apps ?? []) {
      const option = document.createElement("option");
      option.value = app;
      option.textContent = app;
      select.append(option);
    }
    wrapper.append(select);
    return wrapper;
  }

  if (field.type === "signMode") {
    const segmented = document.createElement("div");
    segmented.className = "segmented";
    for (const [value, title] of [["ad-hoc", "Ad hoc"], ["no-sign", "No sign"], ["identity", "Identity"]]) {
      const optionLabel = document.createElement("label");
      const radio = document.createElement("input");
      radio.type = "radio";
      radio.name = field.name;
      radio.value = value;
      radio.checked = value === "ad-hoc";
      optionLabel.append(radio, title);
      segmented.append(optionLabel);
    }
    wrapper.append(segmented);
    return wrapper;
  }

  const input = document.createElement("input");
  input.id = `field-${field.name}`;
  input.name = field.name;
  input.type = "text";
  input.required = Boolean(field.required);
  input.placeholder = field.placeholder ?? "";
  input.autocomplete = "off";
  wrapper.append(input);
  return wrapper;
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
      renderRun(run);
      renderRuns(runs);
    });

    const title = document.createElement("strong");
    title.textContent = run.scriptId;
    const status = document.createElement("span");
    status.textContent = `${run.status}${run.exitCode === undefined ? "" : ` ${run.exitCode}`}`;
    const time = document.createElement("span");
    time.textContent = new Date(run.startedAt).toLocaleTimeString();
    button.append(title, status, time);
    return button;
  }));
}

function renderRun(run: RunRecord) {
  elements.runId.textContent = run.id;
  elements.runStatus.textContent = run.status;
  elements.runExit.textContent = run.exitCode === undefined ? "-" : String(run.exitCode);
  elements.runLog.textContent = run.log || run.command;
  elements.stopButton.disabled = run.status !== "running";
}

function selectedScript(): ScriptCatalogEntry | null {
  return catalog?.scripts.find((script) => script.id === selectedScriptId) ?? null;
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

function messageFromError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

class McpBrowserClient {
  private nextId = 1;
  private initialized = false;

  constructor(private readonly endpoint: string) {}

  async initialize(): Promise<void> {
    if (this.initialized) {
      return;
    }

    await this.request("initialize", {
      protocolVersion: PROTOCOL_VERSION,
      capabilities: {},
      clientInfo: {
        name: "appify-ui-webapp",
        version: "0.1.0",
      },
    });
    await this.notify("notifications/initialized", {});
    this.initialized = true;
  }

  async callTool<T>(name: string, args: Record<string, unknown>): Promise<T> {
    const result = await this.request<ToolResult<T>>("tools/call", {
      name,
      arguments: args,
    });

    if (result.structuredContent !== undefined) {
      return result.structuredContent;
    }

    const text = result.content?.find((item) => item.type === "text")?.text;
    if (text) {
      return JSON.parse(text) as T;
    }

    throw new Error(`Tool ${name} did not return structured content.`);
  }

  private async notify(method: string, params: unknown): Promise<void> {
    await fetch(this.endpoint, {
      method: "POST",
      headers: {
        "Accept": "application/json, text/event-stream",
        "Content-Type": "application/json",
        "MCP-Protocol-Version": PROTOCOL_VERSION,
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        method,
        params,
      }),
    });
  }

  private async request<T>(method: string, params: unknown): Promise<T> {
    const id = this.nextId++;
    const response = await fetch(this.endpoint, {
      method: "POST",
      headers: {
        "Accept": "application/json, text/event-stream",
        "Content-Type": "application/json",
        "MCP-Protocol-Version": PROTOCOL_VERSION,
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id,
        method,
        params,
      }),
    });

    if (!response.ok) {
      throw new Error(await response.text());
    }

    const message = await readMcpResponse(response, id);
    if (message.error) {
      throw new Error(message.error.message);
    }
    return message.result as T;
  }
}

const client = new McpBrowserClient(MCP_ENDPOINT);
void boot();

async function readMcpResponse(response: Response, id: number | string): Promise<JsonRpcMessage> {
  const contentType = response.headers.get("content-type") ?? "";
  const text = await response.text();

  if (contentType.includes("text/event-stream")) {
    const messages = parseSseMessages(text);
    const found = messages.find((message) => message.id === id);
    if (!found) {
      throw new Error("MCP response stream closed without a matching response.");
    }
    return found;
  }

  return JSON.parse(text) as JsonRpcMessage;
}

function parseSseMessages(text: string): JsonRpcMessage[] {
  return text
    .split(/\n\n+/)
    .flatMap((event) => {
      const data = event
        .split(/\n/)
        .filter((line) => line.startsWith("data:"))
        .map((line) => line.slice(5).trimStart())
        .join("\n");
      if (!data) {
        return [];
      }
      return [JSON.parse(data) as JsonRpcMessage];
    });
}

globalThis.addEventListener("beforeunload", () => {
  if (pollTimer) {
    clearInterval(pollTimer);
  }
});

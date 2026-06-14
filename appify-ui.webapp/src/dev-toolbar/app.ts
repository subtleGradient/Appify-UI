import { defineToolbarApp } from "astro/toolbar";
import {
  APPIFY_TOOLBAR_EVENTS,
  appifyToolbarCommands,
  type AppifyToolbarCommand,
  type AppifyToolbarCommandUpdate,
} from "./protocol";

const maxLogLength = 18_000;

function createElement<K extends keyof HTMLElementTagNameMap>(
  tagName: K,
  className?: string,
): HTMLElementTagNameMap[K] {
  const element = document.createElement(tagName);
  if (className) {
    element.className = className;
  }
  return element;
}

function appendOutput(currentOutput: string, output: string): string {
  const nextOutput = `${currentOutput}${output}`;
  if (nextOutput.length <= maxLogLength) {
    return nextOutput;
  }

  return nextOutput.slice(nextOutput.length - maxLogLength);
}

export default defineToolbarApp({
  init(canvas, app, server) {
    let activeRequestId: string | undefined;
    let isRunning = false;
    let logOutput = "";

    const style = createElement("style");
    style.textContent = `
      astro-dev-toolbar-window {
        color: #e5e7eb;
      }

      .shell {
        display: grid;
        gap: 14px;
        width: min(680px, calc(100vw - 48px));
        padding: 4px;
        font-family: ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      }

      .header,
      .status-row {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 12px;
      }

      .title {
        margin: 0;
        color: #ffffff;
        font-size: 17px;
        line-height: 1.25;
        font-weight: 700;
      }

      .subtitle {
        margin: 4px 0 0;
        color: #a8b3cf;
        font-size: 13px;
        line-height: 1.45;
      }

      .commands {
        display: grid;
        grid-template-columns: repeat(3, minmax(0, 1fr));
        gap: 10px;
      }

      .command {
        display: grid;
        gap: 8px;
        min-width: 0;
        padding: 12px;
        border: 1px solid rgba(148, 163, 184, 0.24);
        border-radius: 8px;
        background: rgba(15, 23, 42, 0.7);
      }

      .command-title {
        margin: 0;
        color: #ffffff;
        font-size: 13px;
        font-weight: 700;
        line-height: 1.25;
      }

      .command-description,
      .command-text,
      .status-text {
        margin: 0;
        color: #a8b3cf;
        font-size: 12px;
        line-height: 1.4;
      }

      .command-text {
        overflow-wrap: anywhere;
        color: #93c5fd;
        font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", monospace;
      }

      .log {
        box-sizing: border-box;
        min-height: 180px;
        max-height: min(360px, 45vh);
        margin: 0;
        overflow: auto;
        white-space: pre-wrap;
        word-break: break-word;
        border: 1px solid rgba(148, 163, 184, 0.22);
        border-radius: 8px;
        background: #020617;
        color: #d1d5db;
        padding: 12px;
        font-size: 12px;
        line-height: 1.45;
        font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", monospace;
      }

      .muted {
        color: #94a3b8;
      }

      .is-disabled {
        opacity: 0.55;
        pointer-events: none;
      }

      @media (max-width: 720px) {
        .commands {
          grid-template-columns: 1fr;
        }

        .header,
        .status-row {
          align-items: flex-start;
          flex-direction: column;
        }
      }
    `;

    const windowElement = document.createElement("astro-dev-toolbar-window");
    const shell = createElement("section", "shell");
    const header = createElement("header", "header");
    const headingGroup = createElement("div");
    const title = createElement("h2", "title");
    const subtitle = createElement("p", "subtitle");
    const statusBadge = document.createElement("astro-dev-toolbar-badge");
    const commands = createElement("div", "commands");
    const statusRow = createElement("div", "status-row");
    const statusText = createElement("p", "status-text");
    const clearButton = document.createElement("astro-dev-toolbar-button");
    const log = createElement("pre", "log");
    const commandButtons = new Map<AppifyToolbarCommand, HTMLElement>();

    title.textContent = "Appify commands";
    subtitle.textContent = "Run the Pages build and deployment scripts from the Astro dev server.";
    statusBadge.textContent = "Idle";
    statusBadge.badgeStyle = "gray";
    statusText.textContent = "No command has run in this toolbar session.";
    clearButton.textContent = "Clear log";
    clearButton.buttonStyle = "gray";
    clearButton.size = "small";
    log.textContent = "$ Waiting for a command...\n";

    clearButton.addEventListener("click", () => {
      logOutput = "";
      log.textContent = "$ Log cleared.\n";
    });

    const setRunningState = (nextIsRunning: boolean) => {
      isRunning = nextIsRunning;
      for (const button of commandButtons.values()) {
        button.classList.toggle("is-disabled", isRunning);
      }
    };

    const writeLog = (output: string) => {
      logOutput = appendOutput(logOutput, output);
      log.textContent = logOutput;
      log.scrollTop = log.scrollHeight;
    };

    const setStatus = (
      label: string,
      badgeStyle: "gray" | "blue" | "green" | "red" | "yellow",
      message: string,
    ) => {
      statusBadge.textContent = label;
      statusBadge.badgeStyle = badgeStyle;
      statusText.textContent = message;
    };

    const runCommand = (command: AppifyToolbarCommand) => {
      if (isRunning) {
        return;
      }

      const definition = appifyToolbarCommands.find((item) => item.command === command);
      if (!definition) {
        return;
      }

      if (definition.confirm && !window.confirm(definition.confirm)) {
        return;
      }

      const requestId = `${command}-${Date.now().toString(36)}`;
      activeRequestId = requestId;
      logOutput = `$ ${definition.commandText}\n`;
      log.textContent = logOutput;
      setRunningState(true);
      setStatus("Running", "blue", definition.commandText);
      app.toggleNotification({ state: true, level: "info" });
      server.send(APPIFY_TOOLBAR_EVENTS.run, { command, requestId });
    };

    for (const definition of appifyToolbarCommands) {
      const command = createElement("article", "command");
      const commandTitle = createElement("h3", "command-title");
      const commandDescription = createElement("p", "command-description");
      const commandText = createElement("p", "command-text");
      const button = document.createElement("astro-dev-toolbar-button");

      commandTitle.textContent = definition.label;
      commandDescription.textContent = definition.description;
      commandText.textContent = definition.commandText;
      button.textContent = definition.label;
      button.buttonStyle = definition.command === "deploy-pages" ? "green" : "blue";
      button.size = "medium";
      button.addEventListener("click", () => runCommand(definition.command));

      commandButtons.set(definition.command, button);
      command.append(commandTitle, commandDescription, commandText, button);
      commands.append(command);
    }

    server.on<AppifyToolbarCommandUpdate>(APPIFY_TOOLBAR_EVENTS.update, (update) => {
      if (activeRequestId !== update.requestId) {
        return;
      }

      if (update.status === "started") {
        setRunningState(true);
        setStatus("Running", "blue", update.message ?? "Command started.");
        writeLog(`${update.message ?? "Command started."}\n`);
        return;
      }

      if (update.status === "output" && update.output) {
        writeLog(update.output);
        return;
      }

      if (update.status === "completed") {
        setRunningState(false);
        setStatus("Complete", "green", update.message ?? "Command completed.");
        writeLog(`\n${update.message ?? "Command completed."}\n`);
        app.toggleNotification({ state: false });
        return;
      }

      if (update.status === "failed") {
        setRunningState(false);
        setStatus("Failed", "red", update.message ?? "Command failed.");
        writeLog(`\n${update.message ?? "Command failed."}\n`);
        app.toggleNotification({ state: true, level: "error" });
        return;
      }

      if (update.status === "rejected") {
        setRunningState(false);
        setStatus("Busy", "yellow", update.message ?? "Another command is already running.");
        writeLog(`\n${update.message ?? "Another command is already running."}\n`);
        app.toggleNotification({ state: true, level: "warning" });
      }
    });

    headingGroup.append(title, subtitle);
    header.append(headingGroup, statusBadge);
    statusRow.append(statusText, clearButton);
    shell.append(header, commands, statusRow, log);
    windowElement.append(shell);
    canvas.append(style, windowElement);
  },
});

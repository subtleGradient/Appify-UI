import { WTerm } from "@wterm/dom";
import { GhosttyCore } from "@wterm/ghostty";
import "@wterm/dom/css";

const terminalElement = requireElement<HTMLDivElement>("terminal");
const statusElement = requireElement<HTMLElement>("connection-status");

setStatus("Loading terminal");

const terminal = await createTerminal();
terminal.focus();
connectTerminal(terminal);

async function createTerminal(): Promise<WTerm> {
  const core = await GhosttyCore.load({
    wasmPath: "/assets/ghostty-vt.wasm",
  });
  const terminal = new WTerm(terminalElement, {
    core,
    cols: 100,
    rows: 32,
    autoResize: true,
    cursorBlink: true,
    onTitle(title) {
      document.title = title ? `${title} - LazyGit` : "LazyGit";
    },
  });
  return await terminal.init();
}

function connectTerminal(terminal: WTerm): void {
  const socketURL = new URL("/pty", window.location.href);
  socketURL.protocol = window.location.protocol === "https:" ? "wss:" : "ws:";

  const socket = new WebSocket(socketURL);
  socket.binaryType = "arraybuffer";
  terminal.onData = (data) => {
    if (socket.readyState === WebSocket.OPEN) {
      socket.send(JSON.stringify({ type: "input", data }));
    }
  };
  terminal.onResize = (cols, rows) => {
    if (socket.readyState === WebSocket.OPEN) {
      socket.send(JSON.stringify({ type: "resize", cols, rows }));
    }
  };

  socket.addEventListener("open", () => {
    setStatus("Connected");
    sendResize(socket, terminal);
    terminalElement.focus();
  });

  socket.addEventListener("message", (event) => {
    if (typeof event.data === "string") {
      terminal.write(event.data);
    } else if (event.data instanceof ArrayBuffer) {
      terminal.write(new Uint8Array(event.data));
    } else if (event.data instanceof Blob) {
      void event.data.arrayBuffer().then((buffer) => terminal.write(new Uint8Array(buffer)));
    }
  });

  socket.addEventListener("close", () => {
    setStatus("Disconnected");
  });

  socket.addEventListener("error", () => {
    setStatus("Connection error");
  });

  terminalElement.addEventListener("keydown", () => {
    if (socket.readyState === WebSocket.OPEN) {
      terminal.focus();
    }
  });
}

function sendResize(socket: WebSocket, terminal: WTerm): void {
  const cols = Number(terminal.cols ?? 100);
  const rows = Number(terminal.rows ?? 32);
  if (Number.isInteger(cols) && Number.isInteger(rows) && cols > 0 && rows > 0) {
    socket.send(JSON.stringify({ type: "resize", cols, rows }));
  }
}

function setStatus(status: string): void {
  statusElement.textContent = status;
  statusElement.dataset.state = status.toLowerCase().replaceAll(/\s+/g, "-");
}

function requireElement<T extends HTMLElement>(id: string): T {
  const element = document.getElementById(id);
  if (element === null) {
    throw new Error(`Missing #${id}.`);
  }
  return element as T;
}

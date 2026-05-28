import { createConnection, createServer, type Server, type Socket } from "node:net";

// Keep this transport in sync with Web.app/Contents/Resources/Runner/src/connectTunnel.ts.
// The app bundles eject independently, so this code is duplicated deliberately
// instead of imported across app directories.
const MAX_CONNECT_HEADER_BYTES = 16 * 1024;

export interface VisibleOriginConnectTunnel {
  url: URL;
  close(): Promise<void>;
}

export async function startVisibleOriginConnectTunnel(options: {
  visibleOriginURL: URL;
  backendURL: URL;
}): Promise<VisibleOriginConnectTunnel> {
  const visibleAuthority = authorityFor(options.visibleOriginURL);
  const backendHost = options.backendURL.hostname;
  const backendPort = Number(options.backendURL.port);
  if (!Number.isInteger(backendPort) || backendPort < 1 || backendPort > 65535) {
    throw new Error(`Backend URL must include a valid port: ${options.backendURL.href}`);
  }

  const sockets = new Set<Socket>();
  const server = createServer({ allowHalfOpen: false }, (client) => {
    trackSocket(sockets, client);
    handleConnectClient(client, visibleAuthority, backendHost, backendPort, sockets);
  });

  await new Promise<void>((resolvePromise, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      server.off("error", reject);
      resolvePromise();
    });
  });

  const address = server.address();
  if (address === null || typeof address === "string") {
    server.close();
    throw new Error("Could not resolve CONNECT tunnel listener address.");
  }

  return {
    url: new URL(`http://127.0.0.1:${address.port}/`),
    close: () => closeServer(server, sockets),
  };
}

function handleConnectClient(
  client: Socket,
  visibleAuthority: string,
  backendHost: string,
  backendPort: number,
  sockets: Set<Socket>,
): void {
  let buffered = Buffer.alloc(0);

  const fail = (status: number, reason: string) => {
    client.end(`HTTP/1.1 ${status} ${reason}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`);
  };

  const onHeaderData = (chunk: Buffer) => {
    buffered = Buffer.concat([buffered, chunk]);
    if (buffered.length > MAX_CONNECT_HEADER_BYTES) {
      client.off("data", onHeaderData);
      fail(431, "Request Header Fields Too Large");
      return;
    }

    const headerEnd = buffered.indexOf("\r\n\r\n");
    if (headerEnd === -1) {
      return;
    }

    client.off("data", onHeaderData);
    client.pause();

    const header = buffered.subarray(0, headerEnd).toString("latin1");
    const remainder = buffered.subarray(headerEnd + 4);
    const request = parseProxyRequest(header, visibleAuthority);
    if (request === null) {
      fail(405, "Method Not Allowed");
      return;
    }

    if (!request.allowed) {
      fail(403, "Forbidden");
      return;
    }

    const upstream = createConnection({ host: backendHost, port: backendPort }, () => {
      if (request.kind === "connect") {
        client.write("HTTP/1.1 200 Connection Established\r\nConnection: keep-alive\r\n\r\n");
      } else {
        upstream.write(rewriteForwardProxyHeader(header, request.path, visibleAuthority));
      }
      if (remainder.length > 0) {
        upstream.write(remainder);
      }
      client.pipe(upstream);
      upstream.pipe(client);
      client.resume();
    });
    trackSocket(sockets, upstream);

    upstream.on("error", () => {
      client.destroy();
    });
    client.on("error", () => {
      upstream.destroy();
    });
    client.on("close", () => {
      upstream.destroy();
    });
  };

  client.on("error", () => {});
  client.on("data", onHeaderData);
}

type ParsedProxyRequest =
  | { kind: "connect"; allowed: boolean }
  | { kind: "forward"; allowed: boolean; path: string };

function parseProxyRequest(header: string, visibleAuthority: string): ParsedProxyRequest | null {
  const lines = header.split("\r\n");
  const requestLine = lines[0] ?? "";
  const match = /^([A-Z]+)\s+([^\s]+)\s+HTTP\/1\.[01]$/i.exec(requestLine);
  if (match === null) {
    return null;
  }

  const method = match[1]?.toUpperCase() ?? "";
  const target = match[2] ?? "";
  if (method === "CONNECT") {
    return { kind: "connect", allowed: normalizeAuthority(target) === visibleAuthority };
  }

  if (target.startsWith("http://") || target.startsWith("https://")) {
    try {
      const url = new URL(target);
      const authority = authorityFor(url);
      const path = `${url.pathname || "/"}${url.search}`;
      return { kind: "forward", allowed: authority === visibleAuthority, path };
    } catch {
      return null;
    }
  }

  if (target.startsWith("/")) {
    const host = headerValue(lines, "host");
    return { kind: "forward", allowed: normalizeAuthority(host) === visibleAuthority, path: target };
  }

  return null;
}

function rewriteForwardProxyHeader(header: string, path: string, visibleAuthority: string): string {
  const lines = header.split("\r\n");
  const requestLine = lines[0] ?? "";
  const requestMatch = /^([A-Z]+)\s+[^\s]+\s+(HTTP\/1\.[01])$/i.exec(requestLine);
  const method = requestMatch?.[1] ?? "GET";
  const version = requestMatch?.[2] ?? "HTTP/1.1";
  const rewrittenLines = [`${method} ${path} ${version}`, `Host: ${visibleAuthority}`, "Connection: close"];

  for (const line of lines.slice(1)) {
    if (line === "") {
      continue;
    }
    const separator = line.indexOf(":");
    if (separator === -1) {
      continue;
    }
    const name = line.slice(0, separator).trim().toLowerCase();
    if (name === "host" || name === "connection" || name === "proxy-connection") {
      continue;
    }
    rewrittenLines.push(line);
  }

  return `${rewrittenLines.join("\r\n")}\r\n\r\n`;
}

function headerValue(lines: string[], headerName: string): string | undefined {
  const normalizedHeaderName = headerName.toLowerCase();
  for (const line of lines.slice(1)) {
    const separator = line.indexOf(":");
    if (separator === -1) {
      continue;
    }
    if (line.slice(0, separator).trim().toLowerCase() === normalizedHeaderName) {
      return line.slice(separator + 1).trim();
    }
  }
  return undefined;
}

function trackSocket(sockets: Set<Socket>, socket: Socket): void {
  sockets.add(socket);
  socket.on("close", () => {
    sockets.delete(socket);
  });
}

function authorityFor(url: URL): string {
  const port = url.port || (url.protocol === "https:" ? "443" : "80");
  return normalizeAuthority(`${url.hostname}:${port}`);
}

function normalizeAuthority(authority: string | undefined): string {
  return (authority ?? "").trim().toLowerCase();
}

async function closeServer(server: Server, sockets: Set<Socket>): Promise<void> {
  for (const socket of sockets) {
    socket.destroy();
  }
  await new Promise<void>((resolvePromise, reject) => {
    server.close((error) => {
      if (error) {
        if ((error as NodeJS.ErrnoException).code === "ERR_SERVER_NOT_RUNNING") {
          resolvePromise();
          return;
        }
        reject(error);
        return;
      }
      resolvePromise();
    });
  });
}

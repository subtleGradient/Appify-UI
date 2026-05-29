export const SESSION_COOKIE_NAME = "LazyGitWebappSession";

export type SessionSecrets = {
  cookieValue: string;
  cspNonce: string;
};

export type ValidationResult =
  | { ok: true }
  | { ok: false; status: number; message: string };

export function createSessionSecrets(): SessionSecrets {
  return {
    cookieValue: randomBase64URL(32),
    cspNonce: randomBase64URL(18),
  };
}

export function htmlHeaders(requestURL: URL, session: SessionSecrets): Headers {
  const headers = baseHeaders("text/html; charset=utf-8");
  headers.set("Content-Security-Policy", contentSecurityPolicy(requestURL, session.cspNonce));
  headers.set("Set-Cookie", sessionCookieHeader(session.cookieValue));
  return headers;
}

export function assetHeaders(contentType: string): Headers {
  return baseHeaders(contentType);
}

export function contentSecurityPolicy(requestURL: URL, nonce: string): string {
  return [
    "default-src 'none'",
    `script-src 'nonce-${nonce}' 'wasm-unsafe-eval'`,
    "style-src 'self'",
    `connect-src 'self' ${webSocketOriginFor(requestURL)}`,
    "img-src 'self' data:",
    "font-src 'self'",
    "base-uri 'none'",
    "form-action 'none'",
    "frame-ancestors 'none'",
    "object-src 'none'",
  ].join("; ");
}

export function validateWebSocketAuthority(request: Request, session: SessionSecrets): ValidationResult {
  const requestURL = new URL(request.url);
  const origin = request.headers.get("Origin");
  if (!origin) {
    return { ok: false, status: 403, message: "Missing Origin." };
  }

  let originURL: URL;
  try {
    originURL = new URL(origin);
  } catch {
    return { ok: false, status: 403, message: "Invalid Origin." };
  }

  if (originURL.origin !== requestURL.origin) {
    return { ok: false, status: 403, message: "Forbidden Origin." };
  }

  if (!isLocalWebappHost(originURL.hostname) || !isLocalWebappHost(requestURL.hostname)) {
    return { ok: false, status: 403, message: "Forbidden Host." };
  }

  const cookies = parseCookieHeader(request.headers.get("Cookie") ?? "");
  if (cookies.get(SESSION_COOKIE_NAME) !== session.cookieValue) {
    return { ok: false, status: 403, message: "Missing or invalid session cookie." };
  }

  return { ok: true };
}

export function parseCookieHeader(cookieHeader: string): Map<string, string> {
  const cookies = new Map<string, string>();
  for (const part of cookieHeader.split(";")) {
    const separator = part.indexOf("=");
    if (separator === -1) {
      continue;
    }
    const name = part.slice(0, separator).trim();
    const value = part.slice(separator + 1).trim();
    if (name) {
      cookies.set(name, value);
    }
  }
  return cookies;
}

export function sessionCookieHeader(value: string): string {
  return `${SESSION_COOKIE_NAME}=${value}; Path=/; HttpOnly; SameSite=Strict; Max-Age=86400`;
}

function baseHeaders(contentType: string): Headers {
  return new Headers({
    "Cache-Control": "no-store",
    "Content-Type": contentType,
    "Cross-Origin-Opener-Policy": "same-origin",
    "Cross-Origin-Resource-Policy": "same-origin",
    "Referrer-Policy": "no-referrer",
    "X-Content-Type-Options": "nosniff",
  });
}

function webSocketOriginFor(requestURL: URL): string {
  const websocketURL = new URL(requestURL.href);
  websocketURL.protocol = requestURL.protocol === "https:" ? "wss:" : "ws:";
  websocketURL.pathname = "/";
  websocketURL.search = "";
  websocketURL.hash = "";
  return websocketURL.origin;
}

function isLocalWebappHost(hostname: string): boolean {
  const host = hostname.toLowerCase();
  return host === "localhost"
    || host.endsWith(".localhost")
    || host === "127.0.0.1"
    || host === "::1"
    || host === "[::1]";
}

function randomBase64URL(byteLength: number): string {
  return Buffer.from(crypto.getRandomValues(new Uint8Array(byteLength)))
    .toString("base64")
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replaceAll("=", "");
}

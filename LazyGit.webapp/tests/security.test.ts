import { afterEach, describe, expect, test } from "bun:test";
import {
  contentSecurityPolicy,
  createSessionSecrets,
  htmlHeaders,
  parseCookieHeader,
  SESSION_COOKIE_NAME,
  sessionCookieHeader,
  validateWebSocketAuthority,
} from "../src/security";
import { createLazyGitWebappServer, parseClientMessage, resolveListenPort, type LazyGitWebappServer } from "../src/server";

let app: LazyGitWebappServer | null = null;

afterEach(() => {
  app?.stop();
  app = null;
});

describe("local browser authority", () => {
  test("sets an HttpOnly strict session cookie and strict CSP on the document", async () => {
    app = await createTestServer();
    const response = await fetch(app.server.url);

    expect(response.status).toBe(200);
    expect(response.headers.get("Set-Cookie")).toContain(`${SESSION_COOKIE_NAME}=`);
    expect(response.headers.get("Set-Cookie")).toContain("HttpOnly");
    expect(response.headers.get("Set-Cookie")).toContain("SameSite=Strict");

    const csp = response.headers.get("Content-Security-Policy") ?? "";
    expect(csp).toContain("default-src 'none'");
    expect(csp).toContain("script-src 'nonce-");
    expect(csp).toContain("'wasm-unsafe-eval'");
    expect(csp).toContain("connect-src 'self' ws://127.0.0.1:");
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).toContain("object-src 'none'");
    expect(csp).not.toContain("'unsafe-inline'");
    expect(csp).not.toContain("'unsafe-eval'");
  });

  test("rejects websocket upgrades without the session cookie", async () => {
    app = await createTestServer();
    const response = await fetch(new URL("/pty", app.server.url), {
      headers: {
        "Upgrade": "websocket",
        "Origin": app.server.url.origin,
      },
    });

    expect(response.status).toBe(403);
    expect(await response.text()).toContain("session cookie");
  });

  test("rejects websocket upgrades from another origin", async () => {
    app = await createTestServer();
    const response = await fetch(new URL("/pty", app.server.url), {
      headers: {
        "Upgrade": "websocket",
        "Origin": "https://example.com",
        "Cookie": sessionCookieHeader(app.session.cookieValue).split(";")[0]!,
      },
    });

    expect(response.status).toBe(403);
    expect(await response.text()).toContain("Origin");
  });

  test("accepts same-origin localhost-style hosts with the session cookie", () => {
    const session = createSessionSecrets();
    const request = new Request("http://lazy--1234.localhost:55555/pty", {
      headers: {
        "Origin": "http://lazy--1234.localhost:55555",
        "Cookie": `${SESSION_COOKIE_NAME}=${session.cookieValue}`,
      },
    });

    expect(validateWebSocketAuthority(request, session)).toEqual({ ok: true });
  });
});

describe("security helpers", () => {
  test("parses cookies without exposing the session in JavaScript", () => {
    const cookies = parseCookieHeader("left=1; LazyGitWebappSession=secret; right=2");
    expect(cookies.get(SESSION_COOKIE_NAME)).toBe("secret");
  });

  test("builds a dynamic websocket CSP origin", () => {
    const csp = contentSecurityPolicy(new URL("http://lazy--abcd.localhost:55555/"), "nonce");
    expect(csp).toContain("connect-src 'self' ws://lazy--abcd.localhost:55555");
    expect(csp).toContain("script-src 'nonce-nonce' 'wasm-unsafe-eval'");
  });

  test("uses no-store text/html headers for the shell", () => {
    const session = createSessionSecrets();
    const headers = htmlHeaders(new URL("http://127.0.0.1:3000/"), session);
    expect(headers.get("Cache-Control")).toBe("no-store");
    expect(headers.get("X-Content-Type-Options")).toBe("nosniff");
  });
});

describe("client websocket messages", () => {
  test("accepts input and bounded resize messages", () => {
    expect(parseClientMessage(JSON.stringify({ type: "input", data: "\u001b[A" }))).toEqual({
      type: "input",
      data: "\u001b[A",
    });
    expect(parseClientMessage(JSON.stringify({ type: "resize", cols: 120, rows: 40 }))).toEqual({
      type: "resize",
      cols: 120,
      rows: 40,
    });
  });

  test("rejects malformed messages", () => {
    expect(parseClientMessage("not json")).toBeNull();
    expect(parseClientMessage(JSON.stringify({ type: "resize", cols: -1, rows: 40 }))).toBeNull();
    expect(parseClientMessage(JSON.stringify({ type: "input", data: 42 }))).toBeNull();
  });
});

describe("listen port resolution", () => {
  test("treats PORT=0 as dynamic positive-port fallback", () => {
    expect(resolveListenPort(undefined, "0")).toBeNull();
    expect(resolveListenPort(undefined, "")).toBeNull();
    expect(resolveListenPort(undefined, undefined)).toBeNull();
    expect(resolveListenPort(undefined, "5173")).toBe(5173);
  });
});

async function createTestServer(): Promise<LazyGitWebappServer> {
  return await createLazyGitWebappServer({
    repoPath: process.cwd(),
    clientAssets: { js: "export {};", css: "" },
    resolveTool: (name) => name === "nix-shell" ? null : `/tools/${name}`,
  });
}

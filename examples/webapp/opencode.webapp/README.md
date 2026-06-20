# OpenCode Web

A minimal `.webapp` package that starts OpenCode's browser UI server without
opening a browser.

Install the package dependencies first, then open this folder with `Webapp.app`
or run:

```sh
bun install
bun dev
```

The package dev script starts a small Bun wrapper that reserves a free loopback
port, starts OpenCode through `@opencode-ai/sdk`, and creates a new session for
this package directory:

```ts
createOpencodeServer({ hostname: "127.0.0.1", port })
createOpencodeClient({ baseUrl: server.url, directory })
client.session.create({ body: { title } })
```

Using the SDK server path avoids OpenCode's browser auto-open behavior. The
wrapper clears `OPENCODE_SERVER_PASSWORD` before OpenCode starts because
AppifyHost rejects URLs with embedded credentials. Instead, it binds OpenCode to
`127.0.0.1`, so other machines on the LAN cannot connect to the server.

When OpenCode is ready, the wrapper prints a credential-free loopback URL for
the newly created session:

```text
OpenCode Web URL: http://127.0.0.1:<port>/<encoded-directory>/session/<session-id>
```

Opening that URL loads the OpenCode interface directly in the new session. Each
`bun dev` run chooses its own port, so multiple servers can run at the same
time.

`Webapp.app` will approve the package script, run `bun --no-install run dev`,
and load the first loopback URL printed by the wrapper.

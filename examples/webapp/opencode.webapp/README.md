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
port and starts OpenCode through `@opencode-ai/sdk`:

```ts
createOpencodeServer({ hostname: "127.0.0.1", port })
```

Using the SDK server path avoids OpenCode's browser auto-open behavior. The
wrapper ensures `OPENCODE_SERVER_PASSWORD` is non-empty before OpenCode starts.
If you do not set one yourself, it generates a password for the run; the
username defaults to `opencode` unless you set `OPENCODE_SERVER_USERNAME`.

When OpenCode is ready, the wrapper prints a URL with HTTP Basic credentials:

```text
OpenCode Web URL: http://opencode:<password>@127.0.0.1:<port>/
```

Opening that full URL should load the OpenCode interface directly instead of
showing a password prompt. Each `bun dev` run chooses its own port, so multiple
servers can run at the same time.

`Webapp.app` will approve the package script, run `bun --no-install run dev`,
and load the first loopback URL printed by the wrapper.

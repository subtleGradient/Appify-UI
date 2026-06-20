# OpenCode Web

A minimal `.webapp` package that opens OpenCode's browser UI through
`Webapp.app`.

The package intentionally keeps OpenCode as an external tool, so install it
first with one of the methods from the OpenCode docs. Then open this folder with
`Webapp.app` or run:

```sh
bun dev
```

The package dev script starts a small Bun wrapper that runs:

```sh
opencode web
```

No `--port` is passed, so OpenCode keeps its documented behavior of choosing a
random available local port. The wrapper also ensures `OPENCODE_SERVER_PASSWORD`
is non-empty before OpenCode starts. If you do not set one yourself, it prints a
generated password for the run; the username defaults to `opencode` unless you
set `OPENCODE_SERVER_USERNAME`.

`Webapp.app` will approve the package script, run `bun --no-install run dev`,
and load the first loopback URL printed by OpenCode.

# OpenCode Web

A minimal `.webapp` package that opens OpenCode's browser UI through
`Webapp.app`.

The package intentionally keeps OpenCode as an external tool, so install it
first with one of the methods from the OpenCode docs. Then open this folder with
`Webapp.app` or run:

```sh
bun dev
```

The `dev` script runs:

```sh
opencode web
```

`Webapp.app` will approve the package script, run `bun --no-install run dev`,
and load the first loopback URL printed by OpenCode.

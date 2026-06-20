# Webapp Framework Examples

These `.webapp` packages are normal local web projects that can be opened with
`Webapp.app`. Each package declares a `bun dev` script, so the Webapp runner can
ask before first execution, start the framework dev server without auto-installing
dependencies, and open the first local URL it prints. Packages that support a
static export write sibling `.web` folders for `Web.app`.

## Packages

- `next-operations-room.webapp`: a Next.js App Router operations dashboard with
  a local API route, refresh flow, filtering, and responsive command-center UI.
- `next-scenario-lab.webapp`: a Next.js App Router golf-scoring lab for comparing
  bundle decisions and mitigation toggles.
- `expo-field-kit.webapp`: an Expo Web / React Native Web dispatch board with
  native-style controls, segmented modes, and responsive split panes.
- `astro-blog.webapp`: an Astro content blog with static React JSX composition,
  one hydrated React island, and a build that exports sibling `astro-blog.web`
  output for `Web.app`.
- `opencode.webapp`: a minimal wrapper that starts OpenCode's documented browser
  UI with `opencode web`, a dynamic port, and `OPENCODE_SERVER_PASSWORD`.

## Try One

From a package folder:

```sh
bun install
bun dev
```

After dependencies are installed, open the `.webapp` package with `Webapp.app`
and approve its dev server when prompted.

`opencode.webapp` expects `opencode` to already be installed on your `PATH`;
it has no package dependencies to install, leaves OpenCode's port dynamic, and
sets a generated `OPENCODE_SERVER_PASSWORD` when you do not provide one.

For packages with static export support:

```sh
bun run build
```

The packages intentionally do not commit `node_modules`, `.next`, `.expo`,
`.astro`, generated `.web` output, or other generated state.

# Webapp Framework Examples

These `.webapp` packages are normal local web projects that can be opened with
`Webapp.app`. Each package declares a `bun dev` script, so the Webapp runner can
install dependencies, start the framework dev server, and open the first local
URL it prints.

## Packages

- `next-operations-room.webapp`: a Next.js App Router operations dashboard with
  a local API route, refresh flow, filtering, and responsive command-center UI.
- `next-scenario-lab.webapp`: a Next.js App Router golf-scoring lab for comparing
  bundle decisions and mitigation toggles.
- `expo-field-kit.webapp`: an Expo Web / React Native Web dispatch board with
  native-style controls, segmented modes, and responsive split panes.

## Try One

From a package folder:

```sh
bun install
bun dev
```

Or open the `.webapp` package with `Webapp.app` and let the app run those steps.

The packages intentionally do not commit `node_modules`, `.next`, `.expo`,
`dist`, or other generated state.

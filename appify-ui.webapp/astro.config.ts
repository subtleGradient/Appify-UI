import react from "@astrojs/react";
import { defineConfig } from "astro/config";
import appifyCommandToolbar from "./src/dev-toolbar/integration";

export default defineConfig({
  site: "https://subtlegradient.github.io",
  base: "/appify-ui",
  output: "static",
  outDir: "../appify-ui.web",
  trailingSlash: "never",
  build: {
    format: "file",
  },
  integrations: [react(), appifyCommandToolbar()],
});

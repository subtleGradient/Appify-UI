import react from "@astrojs/react";
import type { AstroIntegration } from "astro";
import { defineConfig } from "astro/config";
import { relativizeWebExport } from "./scripts/relativize-web-export.ts";

function appifyWebExport(): AstroIntegration {
  return {
    name: "appify-web-export",
    hooks: {
      "astro:build:done": async ({ dir, logger }) => {
        const count = await relativizeWebExport(dir);
        logger.info(`Relativized ${count} exported files for Finder-friendly .web output.`);
      },
    },
  };
}

export default defineConfig({
  output: "static",
  outDir: "../astro-blog.web",
  trailingSlash: "never",
  build: {
    format: "file",
  },
  integrations: [react(), appifyWebExport()],
});

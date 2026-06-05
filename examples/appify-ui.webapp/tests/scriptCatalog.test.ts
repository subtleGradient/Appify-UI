import { describe, expect, test } from "bun:test";
import { join, resolve } from "node:path";
import {
  buildCommandForScript,
  defaultRepoRoot,
  getRootApps,
  listRootScripts,
} from "../src/scriptCatalog";

const repoRoot = defaultRepoRoot();

describe("script catalog", () => {
  test("lists only root Scripts entries for v1", () => {
    const scripts = listRootScripts(repoRoot);

    expect(scripts.map((script) => script.id)).toEqual([
      "verify-root-apps",
      "build-host-artifact",
      "eject-app",
      "build-app-from-root",
      "appify-host-launcher",
      "appify-host-lib",
    ]);
    expect(scripts.find((script) => script.id === "appify-host-lib")?.runnable).toBe(false);
  });

  test("discovers root app selectors", () => {
    expect(getRootApps(repoRoot)).toContain("Webapp.app");
  });

  test("builds no-input root script commands", () => {
    const command = buildCommandForScript({ scriptId: "verify-root-apps" }, repoRoot);

    expect(command.command).toBe(join(repoRoot, "Scripts", "verify-root-apps.sh"));
    expect(command.args).toEqual([]);
    expect(command.cwd).toBe(repoRoot);
  });

  test("builds eject command with validated app, output, and sign args", () => {
    const command = buildCommandForScript({
      scriptId: "eject-app",
      sourceApp: "WebFormer.app",
      outputPath: "/private/tmp/WebFormer.app",
      signMode: "no-sign",
    }, repoRoot);

    expect(command.args).toEqual([
      join(repoRoot, "WebFormer.app"),
      "--output",
      "/private/tmp/WebFormer.app",
      "--no-sign",
    ]);
  });

  test("builds build-app-from-root command using controlled env names", () => {
    const command = buildCommandForScript({
      scriptId: "build-app-from-root",
      sourceApp: "Webapp.app",
      outputPath: "/private/tmp/Webapp.app",
      signMode: "identity",
      signIdentity: "Developer ID Application: Example",
    }, repoRoot);

    expect(command.args).toEqual([
      join(repoRoot, "Webapp.app"),
      "Webapp",
      "APPIFY_UI_BUILD_OUTPUT",
      "APPIFY_UI_BUILD_SIGN",
    ]);
    expect(command.env.APPIFY_UI_BUILD_OUTPUT).toBe("/private/tmp/Webapp.app");
    expect(command.env.APPIFY_UI_BUILD_SIGN).toBe("Developer ID Application: Example");
  });

  test("rejects arbitrary source apps and repo-local outputs", () => {
    expect(() => buildCommandForScript({
      scriptId: "eject-app",
      sourceApp: "../Other.app",
      outputPath: "/private/tmp/Other.app",
    }, repoRoot)).toThrow("sourceApp must be one of");

    expect(() => buildCommandForScript({
      scriptId: "eject-app",
      sourceApp: "Webapp.app",
      outputPath: resolve(repoRoot, "dist", "Webapp.app"),
    }, repoRoot)).toThrow("outside the repository");
  });
});

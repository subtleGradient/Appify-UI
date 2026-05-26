import { existsSync } from "node:fs";
import { basename, join, resolve } from "node:path";

export const ROOT_SCRIPT_IDS = [
  "verify-root-apps",
  "build-host-artifact",
  "eject-app",
  "build-app-from-root",
  "appify-host-launcher",
  "appify-host-lib",
] as const;

export type RootScriptId = typeof ROOT_SCRIPT_IDS[number];
export type SignMode = "ad-hoc" | "no-sign" | "identity";

export type ScriptInputField = {
  name: string;
  label: string;
  type: "app" | "path" | "text" | "signMode";
  required?: boolean;
  placeholder?: string;
};

export type ScriptCatalogEntry = {
  id: RootScriptId;
  title: string;
  path: string;
  description: string;
  runnable: boolean;
  longRunning?: boolean;
  inputs: ScriptInputField[];
};

export type RunScriptInput = {
  scriptId: RootScriptId;
  sourceApp?: string;
  outputPath?: string;
  signMode?: SignMode;
  signIdentity?: string;
  documentPath?: string;
};

export type CommandSpec = {
  command: string;
  args: string[];
  cwd: string;
  env: Record<string, string>;
  longRunning: boolean;
};

export const ROOT_APP_NAMES = [
  "JSONCanvas.app",
  "LazyGit.app",
  "LogScope.app",
  "TLCanvas.app",
  "Web.app",
  "Webapp.app",
  "WebFormer.app",
  "WikiDock.app",
  "litecli.app",
  "tw.app",
] as const;

const runnableNoInputFields: ScriptInputField[] = [];
const sourceAppField: ScriptInputField = {
  name: "sourceApp",
  label: "Source app",
  type: "app",
  required: true,
};
const outputPathField: ScriptInputField = {
  name: "outputPath",
  label: "Output path",
  type: "path",
  required: true,
  placeholder: "/private/tmp/WebFormer.app",
};
const signModeField: ScriptInputField = {
  name: "signMode",
  label: "Sign mode",
  type: "signMode",
  required: true,
};
const signIdentityField: ScriptInputField = {
  name: "signIdentity",
  label: "Signing identity",
  type: "text",
  placeholder: "Developer ID Application: ...",
};

export function listRootScripts(repoRoot: string): ScriptCatalogEntry[] {
  return [
    {
      id: "verify-root-apps",
      title: "Verify Root Apps",
      path: "Scripts/verify-root-apps.sh",
      description: "Checks checked-in root app bundle shape and host artifact freshness.",
      runnable: true,
      inputs: runnableNoInputFields,
    },
    {
      id: "build-host-artifact",
      title: "Build Host Artifact",
      path: "Scripts/build-host-artifact.sh",
      description: "Runs AppifyHost Swift tests, builds the release host, and refreshes bin/appify-host.",
      runnable: true,
      inputs: runnableNoInputFields,
    },
    {
      id: "eject-app",
      title: "Eject App",
      path: "Scripts/eject-app.sh",
      description: "Creates a standalone app bundle from a checked-in root app.",
      runnable: true,
      inputs: [sourceAppField, outputPathField, signModeField, signIdentityField],
    },
    {
      id: "build-app-from-root",
      title: "Build App From Root",
      path: "Scripts/build-app-from-root.sh",
      description: "Runs the shared root-app eject wrapper with Appify UI controlled output and sign settings.",
      runnable: true,
      inputs: [sourceAppField, outputPathField, signModeField, signIdentityField],
    },
    {
      id: "appify-host-launcher",
      title: "Appify Host Launcher",
      path: "Scripts/appify-host-launcher.sh",
      description: "Launches a root app through the repo-bound AppifyHost shim.",
      runnable: true,
      longRunning: true,
      inputs: [
        sourceAppField,
        {
          name: "documentPath",
          label: "Document path",
          type: "path",
          placeholder: "Optional document/package path",
        },
      ],
    },
    {
      id: "appify-host-lib",
      title: "Appify Host Library",
      path: "Scripts/appify-host-lib.sh",
      description: "Shared shell helpers sourced by other scripts. Visible for reference, not directly runnable.",
      runnable: false,
      inputs: [],
    },
  ].map((entry) => ({
    ...entry,
    runnable: entry.runnable && existsSync(join(repoRoot, entry.path)),
  }));
}

export function getRootApps(repoRoot: string): string[] {
  return ROOT_APP_NAMES.filter((name) => existsSync(join(repoRoot, name)));
}

export function buildCommandForScript(input: RunScriptInput, repoRoot: string): CommandSpec {
  const script = listRootScripts(repoRoot).find((entry) => entry.id === input.scriptId);
  if (!script) {
    throw new Error(`Unknown script: ${input.scriptId}`);
  }
  if (!script.runnable) {
    throw new Error(`${script.title} is not runnable.`);
  }

  const scriptPath = join(repoRoot, script.path);
  const env: Record<string, string> = {};

  switch (input.scriptId) {
    case "verify-root-apps":
    case "build-host-artifact":
      return {
        command: scriptPath,
        args: [],
        cwd: repoRoot,
        env,
        longRunning: false,
      };

    case "eject-app": {
      const sourceApp = validateRootApp(input.sourceApp, repoRoot);
      const outputPath = validateOutputPath(input.outputPath, repoRoot);
      const signArgs = signArguments(input.signMode, input.signIdentity);
      return {
        command: scriptPath,
        args: [sourceApp, "--output", outputPath, ...signArgs],
        cwd: repoRoot,
        env,
        longRunning: false,
      };
    }

    case "build-app-from-root": {
      const sourceApp = validateRootApp(input.sourceApp, repoRoot);
      const outputPath = validateOutputPath(input.outputPath, repoRoot);
      const signValue = buildAppSignValue(input.signMode, input.signIdentity);
      env.APPIFY_UI_BUILD_OUTPUT = outputPath;
      env.APPIFY_UI_BUILD_SIGN = signValue;
      return {
        command: scriptPath,
        args: [sourceApp, basename(sourceApp, ".app"), "APPIFY_UI_BUILD_OUTPUT", "APPIFY_UI_BUILD_SIGN"],
        cwd: repoRoot,
        env,
        longRunning: false,
      };
    }

    case "appify-host-launcher": {
      const sourceApp = validateRootApp(input.sourceApp, repoRoot);
      const args = [sourceApp];
      const documentPath = validateOptionalPath(input.documentPath, repoRoot);
      if (documentPath) {
        args.push(documentPath);
      }
      return {
        command: scriptPath,
        args,
        cwd: repoRoot,
        env,
        longRunning: true,
      };
    }

    case "appify-host-lib":
      throw new Error("appify-host-lib is a sourced helper, not an executable tool.");
  }
}

export function defaultRepoRoot(): string {
  return resolve(import.meta.dir, "..", "..");
}

function validateRootApp(sourceApp: string | undefined, repoRoot: string): string {
  if (!sourceApp) {
    throw new Error("sourceApp is required.");
  }
  if (!ROOT_APP_NAMES.includes(sourceApp as typeof ROOT_APP_NAMES[number])) {
    throw new Error(`sourceApp must be one of: ${ROOT_APP_NAMES.join(", ")}`);
  }
  const appPath = join(repoRoot, sourceApp);
  if (!existsSync(appPath)) {
    throw new Error(`Source app does not exist: ${sourceApp}`);
  }
  return appPath;
}

function validateOutputPath(outputPath: string | undefined, repoRoot: string): string {
  if (!outputPath?.trim()) {
    throw new Error("outputPath is required.");
  }
  const resolved = resolve(repoRoot, outputPath);
  if (!resolved.endsWith(".app")) {
    throw new Error("outputPath must end with .app.");
  }
  if (resolved === repoRoot || resolved.startsWith(`${repoRoot}/`)) {
    throw new Error("outputPath must be outside the repository.");
  }
  return resolved;
}

function validateOptionalPath(path: string | undefined, repoRoot: string): string | undefined {
  if (!path?.trim()) {
    return undefined;
  }
  return resolve(repoRoot, path);
}

function signArguments(signMode: SignMode | undefined, signIdentity: string | undefined): string[] {
  switch (signMode ?? "ad-hoc") {
    case "ad-hoc":
      return ["--sign", "-"];
    case "no-sign":
      return ["--no-sign"];
    case "identity":
      if (!signIdentity?.trim()) {
        throw new Error("signIdentity is required when signMode is identity.");
      }
      return ["--sign", signIdentity.trim()];
  }
}

function buildAppSignValue(signMode: SignMode | undefined, signIdentity: string | undefined): string {
  switch (signMode ?? "ad-hoc") {
    case "ad-hoc":
      return "-";
    case "no-sign":
      return "0";
    case "identity":
      if (!signIdentity?.trim()) {
        throw new Error("signIdentity is required when signMode is identity.");
      }
      return signIdentity.trim();
  }
}

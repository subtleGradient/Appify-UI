import { existsSync } from "node:fs";
import { access, lstat, readdir, stat } from "node:fs/promises";
import { constants } from "node:fs";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { basename, dirname, extname, join, resolve } from "node:path";

export type ScriptOrigin = "peer" | "package";

export type ScriptEntry = {
  id: string;
  origin: ScriptOrigin;
  name: string;
  path: string;
  cwd: string;
  displayPath: string;
  executable: true;
};

export type ScriptCatalog = {
  documentPath: string;
  workingDirectory: string;
  scripts: ScriptEntry[];
};

export async function resolveScriptsDocumentPath(documentPath: string | undefined): Promise<string> {
  if (!documentPath) {
    throw new Error("Expected a .scripts document path.");
  }

  const resolved = resolve(documentPath);
  if (extname(resolved).toLowerCase() !== ".scripts") {
    throw new Error(`Expected a .scripts document, got ${resolved}.`);
  }

  const stats = await stat(resolved).catch(() => null);
  if (stats === null) {
    throw new Error(`${resolved} does not exist.`);
  }
  if (!stats.isDirectory()) {
    throw new Error(`${resolved} must be a .scripts directory package.`);
  }

  return resolved;
}

export async function resolveScriptsWorkingDirectory(
  documentPath: string,
  workingDirectory: string | undefined,
): Promise<string> {
  const resolved = resolve(workingDirectory || dirname(documentPath));
  const stats = await stat(resolved).catch(() => null);
  if (stats === null || !stats.isDirectory()) {
    throw new Error(`${resolved} is not a readable scripts working directory.`);
  }
  return resolved;
}

export async function listScripts(documentPath: string, workingDirectory: string): Promise<ScriptCatalog> {
  const [peerScripts, packageScripts] = await Promise.all([
    listScriptsInDirectory("peer", workingDirectory, workingDirectory, basename(documentPath)),
    listScriptsInDirectory("package", documentPath, documentPath),
  ]);

  const scripts = [...peerScripts, ...packageScripts]
    .sort((left, right) => {
      const byName = left.name.localeCompare(right.name);
      return byName === 0 ? left.origin.localeCompare(right.origin) : byName;
    });

  return {
    documentPath,
    workingDirectory,
    scripts,
  };
}

export async function requireCatalogScript(
  scriptId: string,
  documentPath: string,
  workingDirectory: string,
): Promise<ScriptEntry> {
  const catalog = await listScripts(documentPath, workingDirectory);
  const script = catalog.scripts.find((entry) => entry.id === scriptId);
  if (!script) {
    throw new Error(`Unknown or no longer executable script: ${scriptId}`);
  }
  return script;
}

async function listScriptsInDirectory(
  origin: ScriptOrigin,
  directory: string,
  cwd: string,
  excludedName?: string,
): Promise<ScriptEntry[]> {
  const entries = await readdir(directory, { withFileTypes: true }).catch(() => []);
  const scripts: ScriptEntry[] = [];

  for (const entry of entries) {
    if (!entry.isFile() || entry.name.startsWith(".") || entry.name === excludedName) {
      continue;
    }

    const path = join(directory, entry.name);
    if (!await isSafeExecutableFile(path)) {
      continue;
    }

    scripts.push({
      id: scriptId(origin, path),
      origin,
      name: entry.name,
      path,
      cwd,
      displayPath: origin === "peer" ? entry.name : join(basename(directory), entry.name),
      executable: true,
    });
  }

  return scripts;
}

async function isSafeExecutableFile(path: string): Promise<boolean> {
  const linkStats = await lstat(path).catch(() => null);
  if (linkStats === null || linkStats.isSymbolicLink() || !linkStats.isFile()) {
    return false;
  }
  if ((linkStats.mode & 0o111) === 0) {
    return false;
  }
  if (await isFinderAlias(path)) {
    return false;
  }
  try {
    await access(path, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

function scriptId(origin: ScriptOrigin, path: string): string {
  const hash = createHash("sha256").update(`${origin}\0${path}`).digest("base64url").slice(0, 16);
  return `${origin}-${hash}`;
}

function isFinderAlias(path: string): boolean {
  if (process.platform !== "darwin" || !existsSync("/usr/bin/xattr")) {
    return false;
  }

  const result = spawnSync("/usr/bin/xattr", ["-px", "com.apple.FinderInfo", path], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"],
  });
  if (result.status !== 0 || !result.stdout.trim()) {
    return false;
  }

  const bytes = Buffer.from(result.stdout.replace(/\s+/g, ""), "hex");
  return bytes.subarray(0, 4).toString("latin1") === "alis";
}

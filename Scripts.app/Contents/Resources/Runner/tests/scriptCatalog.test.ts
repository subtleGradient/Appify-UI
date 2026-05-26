import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { chmod, mkdir, rm, symlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { listScripts, requireCatalogScript, resolveScriptsDocumentPath, resolveScriptsWorkingDirectory } from "../src/scriptCatalog";

let root: string;
let scriptsDir: string;
let marker: string;

beforeEach(async () => {
  root = join(import.meta.dir, `.scripts-catalog-${crypto.randomUUID()}`);
  scriptsDir = join(root, "Scripts");
  marker = join(scriptsDir, "tools.scripts");
  await mkdir(marker, { recursive: true });
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

describe("script catalog", () => {
  test("resolves .scripts directory packages and working directories", async () => {
    expect(await resolveScriptsDocumentPath(marker)).toBe(marker);
    expect(await resolveScriptsWorkingDirectory(marker, scriptsDir)).toBe(scriptsDir);
    await expect(resolveScriptsDocumentPath(join(scriptsDir, "bad.txt"))).rejects.toThrow(".scripts");
  });

  test("lists direct executable peer and package files only", async () => {
    await executable(join(scriptsDir, "build.sh"));
    await executable(join(marker, "build.sh"));
    await executable(join(scriptsDir, ".hidden.sh"));
    await writeFile(join(scriptsDir, "notes.sh"), "#!/usr/bin/env bash\n");
    await chmod(join(scriptsDir, "notes.sh"), 0o644);
    await symlink(join(scriptsDir, "build.sh"), join(scriptsDir, "linked.sh"));
    await mkdir(join(scriptsDir, "nested"));
    await executable(join(scriptsDir, "nested", "deep.sh"));

    const catalog = await listScripts(marker, scriptsDir);

    expect(catalog.scripts.map((script) => `${script.origin}:${script.name}`)).toEqual([
      "package:build.sh",
      "peer:build.sh",
    ]);
    expect(new Set(catalog.scripts.map((script) => script.id)).size).toBe(2);
    expect(catalog.scripts.every((script) => script.path.endsWith("build.sh"))).toBe(true);
  });

  test("revalidates executable status before returning a selected script", async () => {
    const scriptPath = join(scriptsDir, "once.sh");
    await executable(scriptPath);
    const catalog = await listScripts(marker, scriptsDir);
    const id = catalog.scripts[0]!.id;

    await chmod(scriptPath, 0o644);

    await expect(requireCatalogScript(id, marker, scriptsDir)).rejects.toThrow("Unknown or no longer executable");
  });
});

async function executable(path: string) {
  await writeFile(path, "#!/usr/bin/env bash\necho ok\n");
  await chmod(path, 0o755);
}

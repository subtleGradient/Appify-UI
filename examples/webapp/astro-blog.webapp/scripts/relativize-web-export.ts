import { readdir, readFile, writeFile } from "node:fs/promises";
import { dirname, extname, join, posix, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";

const textExtensions = new Set([".css", ".html", ".js", ".xml"]);
const localURLPattern = "[A-Za-z0-9._~!$'()*+,;=:@/%-]*";
const exportedURLPattern = new RegExp(
  [
    String.raw`\/(?:_astro|blog|tags|rss\.xml|composition-map\.svg|src\/styles\/global\.css)(?:\/?${localURLPattern})?`,
    String.raw`\/(?=["'])`,
  ].join("|"),
  "g",
);

export async function relativizeWebExport(outputDirectoryURL: URL): Promise<number> {
  const outputRoot = fileURLToPath(outputDirectoryURL);
  const files = await collectTextFiles(outputRoot);

  await Promise.all(files.map(async (filePath) => {
    const source = await readFile(filePath, "utf8");
    const fileDirectory = toPosixPath(relative(outputRoot, dirname(filePath))) || ".";
    const updated = source.replace(exportedURLPattern, (urlPath) => relativeExportURL(fileDirectory, urlPath));

    if (updated !== source) {
      await writeFile(filePath, updated);
    }
  }));

  return files.length;
}

async function collectTextFiles(root: string): Promise<string[]> {
  const entries = await readdir(root, { withFileTypes: true });
  const files: string[] = [];

  for (const entry of entries) {
    const entryPath = join(root, entry.name);

    if (entry.isDirectory()) {
      files.push(...(await collectTextFiles(entryPath)));
      continue;
    }

    if (entry.isFile() && textExtensions.has(extname(entry.name))) {
      files.push(entryPath);
    }
  }

  return files;
}

function relativeExportURL(fileDirectory: string, urlPath: string): string {
  const target = exportTargetPath(urlPath);
  const relativePath = posix.relative(fileDirectory, target);
  return relativePath || "index.html";
}

function exportTargetPath(urlPath: string): string {
  const pathWithinExport = urlPath.replace(/^\/+/, "");

  if (pathWithinExport.length === 0) {
    return "index.html";
  }

  if (pathWithinExport.endsWith("/")) {
    return `${pathWithinExport.slice(0, -1)}.html`;
  }

  if (posix.extname(pathWithinExport).length === 0) {
    return `${pathWithinExport}.html`;
  }

  return pathWithinExport;
}

function toPosixPath(filePath: string): string {
  return filePath.split(sep).filter(Boolean).join("/");
}

import { spawn } from "node:child_process";
import { cp, mkdir, readdir, rm, stat, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

type RunOptions = {
  cwd: string;
  allowFailure?: boolean;
};

const scriptPath = fileURLToPath(import.meta.url);
const packageRoot = resolve(dirname(scriptPath), "..");
const repoRoot = resolve(packageRoot, "..");
const outputRoot = resolve(repoRoot, "appify-ui.web");
const publishRoot = resolve(repoRoot, ".local", "pages-gh-pages");
const deployBranch = "gh-pages";

const args = new Set(process.argv.slice(2));
const dryRun = args.has("--dry-run");

await main();

async function main(): Promise<void> {
  await run("bun", ["run", "build"], { cwd: packageRoot });
  await assertDirectory(outputRoot, "Astro output");

  const remoteURL = (await capture("git", ["config", "--get", "remote.origin.url"], { cwd: repoRoot })).trim();
  if (!remoteURL) {
    throw new Error("No remote.origin.url configured; cannot publish gh-pages.");
  }

  const sourceCommit = (await capture("git", ["rev-parse", "HEAD"], { cwd: repoRoot })).trim();
  const sourceShortCommit = (await capture("git", ["rev-parse", "--short", "HEAD"], { cwd: repoRoot })).trim();
  const hasRemoteBranch = await succeeds("git", ["ls-remote", "--exit-code", "--heads", remoteURL, deployBranch], { cwd: repoRoot });

  await resetPublishRoot(remoteURL, hasRemoteBranch);
  await emptyPublishRoot();
  await copyOutput();
  await writePublishMetadata(sourceCommit);

  await run("git", ["add", "--all"], { cwd: publishRoot });
  const hasChanges = await hasStagedChanges();

  if (!hasChanges) {
    console.log("No Pages changes to deploy.");
    return;
  }

  await run("git", ["commit", "-m", `Deploy Appify UI Pages from ${sourceShortCommit}`], { cwd: publishRoot });

  if (dryRun) {
    console.log(`Dry run complete. Inspect ${publishRoot}; no push was performed.`);
    return;
  }

  await run("git", ["push", "origin", `HEAD:${deployBranch}`], { cwd: publishRoot });
  console.log(`Published appify-ui.web to origin/${deployBranch}.`);
}

async function resetPublishRoot(remoteURL: string, hasRemoteBranch: boolean): Promise<void> {
  await rm(publishRoot, { recursive: true, force: true });
  await mkdir(dirname(publishRoot), { recursive: true });

  if (hasRemoteBranch) {
    await run("git", ["clone", "--single-branch", "--branch", deployBranch, remoteURL, publishRoot], { cwd: repoRoot });
    return;
  }

  await mkdir(publishRoot, { recursive: true });
  await run("git", ["init"], { cwd: publishRoot });
  await run("git", ["checkout", "--orphan", deployBranch], { cwd: publishRoot });
  await run("git", ["remote", "add", "origin", remoteURL], { cwd: publishRoot });
}

async function emptyPublishRoot(): Promise<void> {
  const entries = await readdir(publishRoot, { withFileTypes: true });

  await Promise.all(entries.map(async (entry) => {
    if (entry.name === ".git") {
      return;
    }

    await rm(join(publishRoot, entry.name), { recursive: true, force: true });
  }));
}

async function copyOutput(): Promise<void> {
  const entries = await readdir(outputRoot, { withFileTypes: true });

  await Promise.all(entries.map((entry) => (
    cp(join(outputRoot, entry.name), join(publishRoot, entry.name), { recursive: true })
  )));
}

async function writePublishMetadata(sourceCommit: string): Promise<void> {
  await writeFile(join(publishRoot, ".nojekyll"), "");
  await writeFile(
    join(publishRoot, ".build-info.json"),
    `${JSON.stringify({
      sourceRepository: "subtleGradient/appify-ui",
      sourceCommit,
      sourcePackage: "appify-ui.webapp",
      outputPackage: "appify-ui.web",
      builtAt: new Date().toISOString(),
    }, null, 2)}\n`,
  );
}

async function hasStagedChanges(): Promise<boolean> {
  const result = await run("git", ["diff", "--cached", "--quiet"], { cwd: publishRoot, allowFailure: true });
  return result !== 0;
}

async function assertDirectory(path: string, label: string): Promise<void> {
  const stats = await stat(path).catch(() => null);
  if (!stats?.isDirectory()) {
    throw new Error(`${label} does not exist or is not a directory: ${path}`);
  }
}

async function succeeds(command: string, commandArgs: string[], options: RunOptions): Promise<boolean> {
  return await run(command, commandArgs, { ...options, allowFailure: true }) === 0;
}

async function capture(command: string, commandArgs: string[], options: RunOptions): Promise<string> {
  return await new Promise((resolveOutput, reject) => {
    const child = spawn(command, commandArgs, {
      cwd: options.cwd,
      stdio: ["ignore", "pipe", "pipe"],
    });
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];

    child.stdout.on("data", (chunk: Buffer) => stdout.push(chunk));
    child.stderr.on("data", (chunk: Buffer) => stderr.push(chunk));
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) {
        resolveOutput(Buffer.concat(stdout).toString("utf8"));
        return;
      }

      reject(new Error(`${formatCommand(command, commandArgs)} failed with exit code ${code ?? "unknown"}\n${Buffer.concat(stderr).toString("utf8")}`));
    });
  });
}

async function run(command: string, commandArgs: string[], options: RunOptions): Promise<number> {
  console.log(`$ ${formatCommand(command, commandArgs)}`);

  return await new Promise((resolveExitCode, reject) => {
    const child = spawn(command, commandArgs, {
      cwd: options.cwd,
      stdio: "inherit",
    });

    child.on("error", reject);
    child.on("close", (code) => {
      const exitCode = code ?? 1;

      if (exitCode === 0 || options.allowFailure) {
        resolveExitCode(exitCode);
        return;
      }

      reject(new Error(`${formatCommand(command, commandArgs)} failed with exit code ${exitCode}`));
    });
  });
}

function formatCommand(command: string, commandArgs: string[]): string {
  return [command, ...commandArgs].map((part) => (
    /^[A-Za-z0-9_./:=@+-]+$/.test(part) ? part : JSON.stringify(part)
  )).join(" ");
}

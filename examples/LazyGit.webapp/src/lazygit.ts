import { dirname, join, resolve } from "node:path";

export type ResolveTool = (name: string) => string | null;

export type LazyGitCommandSpec = {
  command: string[];
  cwd: string;
  env: Record<string, string | undefined>;
  mode: "direct" | "nix";
};

export function resolveDefaultRepoPath(packageRoot: string, environment: Record<string, string | undefined> = process.env): string {
  const override = environment.LAZYGIT_WEBAPP_REPO_PATH?.trim();
  if (override) {
    return resolve(override);
  }

  const parentDirectory = dirname(resolve(packageRoot));
  return resolveGitRoot(parentDirectory, environment);
}

export function resolveGitRoot(startPath: string, environment: Record<string, string | undefined> = process.env): string {
  const git = findTool("git", environment);
  if (git) {
    return runGitRootCommand([git, "-C", startPath, "rev-parse", "--show-toplevel"], environment);
  }

  const nixShell = findTool("nix-shell", environment);
  if (nixShell) {
    return runGitRootCommand([
      nixShell,
      "-p",
      "git",
      "--run",
      `git -C ${shellToken(startPath)} rev-parse --show-toplevel`,
    ], environment);
  }

  throw new Error("LazyGit.webapp requires git or nix-shell to resolve the target repository.");
}

export function buildLazyGitCommand(input: {
  repoPath: string;
  environment?: Record<string, string | undefined>;
  resolveTool?: ResolveTool;
}): LazyGitCommandSpec {
  const environment = cleanChildEnvironment(input.environment ?? process.env);
  const resolveTool = input.resolveTool ?? ((name) => findTool(name, environment));
  const lazygit = resolveTool("lazygit");
  const git = resolveTool("git");
  const gitLfs = resolveTool("git-lfs");
  const repoPath = resolve(input.repoPath);

  if (lazygit && git && gitLfs) {
    return {
      command: [lazygit, "--path", repoPath],
      cwd: repoPath,
      env: {
        ...environment,
        PATH: pathWithToolDirectories(environment.PATH, [lazygit, git, gitLfs]),
        TERM: "xterm-256color",
      },
      mode: "direct",
    };
  }

  const nixShell = resolveTool("nix-shell");
  if (!nixShell) {
    throw new Error("LazyGit.webapp requires direct installations of lazygit, git, and git-lfs, or nix-shell.");
  }

  return {
    command: [
      nixShell,
      "-p",
      "lazygit",
      "git",
      "git-lfs",
      "--run",
      `exec lazygit --path ${shellToken(repoPath)}`,
    ],
    cwd: repoPath,
    env: {
      ...environment,
      TERM: "xterm-256color",
    },
    mode: "nix",
  };
}

export function findTool(name: string, environment: Record<string, string | undefined> = process.env): string | null {
  const home = environment.HOME || "";
  const candidates = [
    join(home, ".nix-profile", "bin", name),
    join("/nix/var/nix/profiles/default/bin", name),
    join("/run/current-system/sw/bin", name),
    join("/opt/homebrew/bin", name),
    join("/usr/local/bin", name),
    join("/usr/bin", name),
  ];

  for (const candidate of candidates) {
    if (candidate && isExecutable(candidate)) {
      return candidate;
    }
  }

  for (const directory of (environment.PATH || "").split(":")) {
    if (!directory) {
      continue;
    }
    const candidate = join(directory, name);
    if (isExecutable(candidate)) {
      return candidate;
    }
  }

  return null;
}

export function shellToken(value: string): string {
  if (/^[A-Za-z0-9_./:@%+=,-]+$/.test(value)) {
    return value;
  }
  return `'${value.replaceAll("'", "'\\''")}'`;
}

function runGitRootCommand(command: string[], environment: Record<string, string | undefined>): string {
  const result = Bun.spawnSync({
    cmd: command,
    env: cleanChildEnvironment(environment),
    stdout: "pipe",
    stderr: "pipe",
  });

  if (result.exitCode !== 0) {
    const diagnostic = new TextDecoder().decode(result.stderr).trim();
    throw new Error(diagnostic || "Could not resolve the target git repository.");
  }

  const root = new TextDecoder().decode(result.stdout).trim();
  if (!root) {
    throw new Error("Could not resolve the target git repository.");
  }
  return root;
}

function cleanChildEnvironment(environment: Record<string, string | undefined>): Record<string, string | undefined> {
  const childEnvironment = { ...environment };
  delete childEnvironment.DEVELOPER_DIR;
  delete childEnvironment.SDKROOT;
  return childEnvironment;
}

function pathWithToolDirectories(currentPath: string | undefined, tools: string[]): string {
  const directories = [];
  const seen = new Set<string>();
  for (const tool of tools) {
    const directory = dirname(tool);
    if (!seen.has(directory)) {
      seen.add(directory);
      directories.push(directory);
    }
  }
  if (currentPath) {
    directories.push(currentPath);
  }
  return directories.join(":");
}

function isExecutable(path: string): boolean {
  try {
    return Bun.spawnSync({ cmd: ["/bin/test", "-x", path] }).exitCode === 0;
  } catch {
    return false;
  }
}

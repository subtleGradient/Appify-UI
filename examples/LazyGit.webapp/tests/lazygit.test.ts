import { describe, expect, test } from "bun:test";
import { mkdtemp, realpath, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { buildLazyGitCommand, resolveDefaultRepoPath, shellToken } from "../src/lazygit";

describe("repo resolution", () => {
  test("uses LAZYGIT_WEBAPP_REPO_PATH when present", () => {
    expect(resolveDefaultRepoPath("/tmp/LazyGit.webapp", {
      LAZYGIT_WEBAPP_REPO_PATH: "/tmp/example",
      PATH: process.env.PATH,
    })).toBe("/tmp/example");
  });

  test("resolves the git root above the package", async () => {
    const root = await mkdtemp(join(tmpdir(), "lazygit-webapp-test-"));
    try {
      const packageRoot = join(root, "nested", "LazyGit.webapp");
      await Bun.$`mkdir -p ${packageRoot}`.quiet();
      await Bun.$`git -C ${root} init -q`.quiet();

      expect(resolveDefaultRepoPath(packageRoot, process.env)).toBe(await realpath(root));
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});

describe("lazygit command construction", () => {
  test("uses direct tools when lazygit, git, and git-lfs are available", () => {
    const command = buildLazyGitCommand({
      repoPath: "/repo with spaces",
      environment: { PATH: "/usr/bin" },
      resolveTool: (name) => name === "nix-shell" ? null : `/tools/${name}`,
    });

    expect(command.mode).toBe("direct");
    expect(command.command).toEqual(["/tools/lazygit", "--path", "/repo with spaces"]);
    expect(command.cwd).toBe("/repo with spaces");
    expect(command.env.PATH).toStartWith("/tools:");
    expect(command.env.TERM).toBe("xterm-256color");
  });

  test("falls back to nix-shell with a quoted lazygit command", () => {
    const command = buildLazyGitCommand({
      repoPath: "/repo with spaces",
      environment: { PATH: "/usr/bin" },
      resolveTool: (name) => name === "nix-shell" ? "/nix/bin/nix-shell" : null,
    });

    expect(command.mode).toBe("nix");
    expect(command.command.slice(0, 5)).toEqual(["/nix/bin/nix-shell", "-p", "lazygit", "git", "git-lfs"]);
    expect(command.command.at(-1)).toBe("exec lazygit --path '/repo with spaces'");
  });

  test("quotes shell tokens only when needed", () => {
    expect(shellToken("/repo/simple")).toBe("/repo/simple");
    expect(shellToken("/repo/with spaces")).toBe("'/repo/with spaces'");
  });
});

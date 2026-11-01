import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

export interface CommitStats {
  hash: string;
  message: string;
  linesChanged: number;
}

function git(cwd: string, args: string[]): string {
  return execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
}

export function repoRoot(cwd: string): string | null {
  try {
    return git(cwd, ["rev-parse", "--show-toplevel"]);
  } catch {
    return null;
  }
}

/** "3 files changed, 40 insertions(+), 2 deletions(-)" → 42 */
export function parseShortStat(text: string): number {
  const ins = /(\d+) insertion/.exec(text);
  const del = /(\d+) deletion/.exec(text);
  return (ins ? Number(ins[1]) : 0) + (del ? Number(del[1]) : 0);
}

export function lastCommitStats(cwd: string): CommitStats {
  const hash = git(cwd, ["rev-parse", "HEAD"]);
  const message = git(cwd, ["log", "-1", "--pretty=%s"]);
  // --root handles the very first commit, which has no parent
  const stat = git(cwd, ["show", "--shortstat", "--format=", "--root", "HEAD"]);
  return { hash, message, linesChanged: parseShortStat(stat) };
}

const MARK = "# installed by byte";

/**
 * Adds one line to a git hook, keeping anything already in it.
 * Running it again replaces Byte's line instead of adding a second one.
 */
export function installHook(cwd: string, hook: "post-commit" | "pre-commit", command: string): string {
  const root = repoRoot(cwd);
  if (!root) throw new Error("Not inside a git repository.");
  const hooksDir = path.resolve(root, git(root, ["rev-parse", "--git-path", "hooks"]));
  fs.mkdirSync(hooksDir, { recursive: true });
  const hookFile = path.join(hooksDir, hook);
  let existing = fs.existsSync(hookFile) ? fs.readFileSync(hookFile, "utf8") : "#!/bin/sh\n";
  existing = existing
    .split("\n")
    .filter((l) => !l.includes(MARK))
    .join("\n")
    .replace(/\n*$/, "\n");
  fs.writeFileSync(hookFile, `${existing}${command} ${MARK}\n`);
  fs.chmodSync(hookFile, 0o755);
  return hookFile;
}

/** After each commit: update the pet. Never fails the commit. */
export function installPostCommitHook(cwd: string, cliPath: string): string {
  return installHook(cwd, "post-commit", `node "${cliPath}" log-commit || true`);
}

/**
 * Before each commit: run the design guard. The CLI only exits non-zero
 * when byte.patterns.yml sets block: true and there are new warnings.
 */
export function installPreCommitHook(cwd: string, cliPath: string): string {
  return installHook(cwd, "pre-commit", `command -v node >/dev/null 2>&1 || exit 0; node "${cliPath}" guard check --hook || exit 1`);
}

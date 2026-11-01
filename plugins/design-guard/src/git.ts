import { execFileSync } from "node:child_process";

function git(root: string, args: string[]): string {
  return execFileSync("git", args, { cwd: root, encoding: "utf8", maxBuffer: 64 * 1024 * 1024, stdio: ["ignore", "pipe", "ignore"] });
}

export function gitRoot(cwd: string): string {
  return git(cwd, ["rev-parse", "--show-toplevel"]).trim();
}

export function hasHead(root: string): boolean {
  try {
    git(root, ["rev-parse", "--verify", "HEAD"]);
    return true;
  } catch {
    return false;
  }
}

/** Files git knows about in the index (respects .gitignore). */
export function indexFiles(root: string): string[] {
  return git(root, ["ls-files"]).split("\n").filter(Boolean);
}

/** Tracked files plus new files not yet added (still respects .gitignore). */
export function workingFiles(root: string): string[] {
  return git(root, ["ls-files", "--cached", "--others", "--exclude-standard"]).split("\n").filter(Boolean);
}

export function headFiles(root: string): string[] {
  if (!hasHead(root)) return [];
  return git(root, ["ls-tree", "-r", "--name-only", "HEAD"]).split("\n").filter(Boolean);
}

export interface StagedChange {
  status: "A" | "M" | "D" | "R";
  path: string;
}

export function stagedChanges(root: string): StagedChange[] {
  // Before the first commit, everything in the index is new
  if (!hasHead(root)) return indexFiles(root).map((p) => ({ status: "A", path: p }));
  return git(root, ["diff", "--cached", "--name-status", "-M"])
    .split("\n")
    .filter(Boolean)
    .map((line) => {
      const parts = line.split("\t");
      const code = parts[0][0];
      const status = code === "C" ? "A" : code === "T" ? "M" : code;
      return { status: status as StagedChange["status"], path: parts[parts.length - 1] };
    });
}

/** The staged version of a file, which is what will actually be committed. */
export function readStaged(root: string, file: string): string {
  return git(root, ["show", `:${file}`]);
}

export function readHead(root: string, file: string): string | null {
  try {
    return git(root, ["show", `HEAD:${file}`]);
  } catch {
    return null;
  }
}

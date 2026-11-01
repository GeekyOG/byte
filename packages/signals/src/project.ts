import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

/** Facts about a project's setup, shared by the CLI and the VS Code extension. */

export type Runner = "vitest" | "jest";

export interface TestSetup {
  runner: Runner | null;
  script: string | null; // current "test" script
  reportFile: string | null;
  flags: string | null; // what to add to the runner command
  configured: boolean; // already writes a JSON report Byte can read
  newScript: string | null; // what Byte would change it to (null = too custom to edit safely)
}

const REPORT: Record<Runner, { file: string; flags: string }> = {
  vitest: { file: "vitest-report.json", flags: "--reporter=default --reporter=json --outputFile=vitest-report.json" },
  jest: { file: "jest-results.json", flags: "--json --outputFile=jest-results.json" },
};

export function readPackage(root: string): any | null {
  try {
    return JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
  } catch {
    return null;
  }
}

export function detectTests(root: string): TestSetup {
  const pkg = readPackage(root);
  const none: TestSetup = { runner: null, script: null, reportFile: null, flags: null, configured: false, newScript: null };
  if (!pkg) return none;
  const deps = { ...pkg.dependencies, ...pkg.devDependencies };
  const script: string | null = pkg.scripts?.test ?? null;
  const runner: Runner | null = /\bvitest\b/.test(script ?? "") || deps.vitest ? "vitest" : /\bjest\b/.test(script ?? "") || deps.jest ? "jest" : null;
  if (!runner) return { ...none, script };
  const { file, flags } = REPORT[runner];
  const configured =
    !!script && (runner === "jest" ? /--json\b/.test(script) && /--outputFile/.test(script) : /--reporter[= ]json/.test(script) && /--outputFile/.test(script));
  // Only rewrite simple scripts that call the runner directly; anything fancier gets instructions instead
  const simple = !!script && new RegExp(`^\\s*(npx\\s+)?${runner}(\\s|$)`).test(script) && !/[;&|]/.test(script);
  const newScript = configured || !simple ? null : `${script!.trim()} ${flags}`;
  return { runner, script, reportFile: file, flags, configured, newScript };
}

export function addToGitignore(root: string, line: string): void {
  const file = path.join(root, ".gitignore");
  const text = fs.existsSync(file) ? fs.readFileSync(file, "utf8") : "";
  if (text.split("\n").some((l) => l.trim() === line)) return;
  fs.writeFileSync(file, `${text}${text && !text.endsWith("\n") ? "\n" : ""}${line}\n`);
}

/** Writes the new test script, keeping the file's indentation, and ignores the report file. */
export function applyTestSetup(root: string): TestSetup {
  const t = detectTests(root);
  if (!t.newScript) return t;
  const file = path.join(root, "package.json");
  const raw = fs.readFileSync(file, "utf8");
  const indent = /\n([ \t]+)"/.exec(raw)?.[1] ?? "  ";
  const pkg = JSON.parse(raw);
  pkg.scripts.test = t.newScript;
  fs.writeFileSync(file, JSON.stringify(pkg, null, indent) + (raw.endsWith("\n") ? "\n" : ""));
  addToGitignore(root, t.reportFile!);
  return detectTests(root);
}

export function hooksInstalled(root: string): { pre: boolean; post: boolean } {
  let dir = path.join(root, ".git", "hooks");
  try {
    dir = path.resolve(root, execFileSync("git", ["rev-parse", "--git-path", "hooks"], { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim());
  } catch {}
  const has = (name: string) => {
    try {
      return fs.readFileSync(path.join(dir, name), "utf8").includes("installed by byte");
    } catch {
      return false;
    }
  };
  return { pre: has("pre-commit"), post: has("post-commit") };
}

export interface SetupProgress {
  hooks: boolean;
  rules: boolean;
  tests: boolean | null; // null = no Jest or Vitest in this project
  audit: boolean;
}

export function setupProgress(root: string): SetupProgress {
  const h = hooksInstalled(root);
  const t = detectTests(root);
  return {
    hooks: h.pre && h.post,
    rules: fs.existsSync(path.join(root, "byte.patterns.yml")),
    tests: t.runner ? t.configured : null,
    audit: fs.existsSync(path.join(root, ".byte/audit.json")),
  };
}

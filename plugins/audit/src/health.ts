import fs from "node:fs";
import path from "node:path";
import type { FileFacts } from "@byte/design-guard";
import type { Finding } from "./types";
import { isTestPath, shortId } from "./util";

const ENTRY = /(^|\/)(index|main|app|server|cli|bin|worker|handler|middleware|instrumentation)\.[a-z]+$/;
const FRAMEWORK_DIRS = /(^|\/)(pages|app|routes|api|bin|scripts|migrations|seeds?|public|cypress|e2e|stories)\//;
const CONFIG = /(^|\/)[^/]*\.(config|setup|rc)\.[a-z]+$|(^|\/)\.[^/]+\.[a-z]+$|\.d\.ts$|\.stories\.[a-z]+$/;

export interface HealthResult {
  findings: Finding[];
  testRatio: number | null;
  todos: number;
}

/**
 * Entry points from every package.json in the repo (monorepos too): main, module,
 * bin, exports, and files named in scripts. "dist/extension.js" also marks
 * "src/extension.ts" as an entry, since that's usually where it's built from.
 */
function entryPoints(root: string, files: string[]): { exact: Set<string>; byName: { dir: string; base: string }[] } {
  const exact = new Set<string>();
  const byName: { dir: string; base: string }[] = [];
  for (const pkgFile of files.filter((f) => f === "package.json" || f.endsWith("/package.json"))) {
    const dir = path.posix.dirname(pkgFile) === "." ? "" : path.posix.dirname(pkgFile);
    let pkg: any;
    try {
      pkg = JSON.parse(fs.readFileSync(path.join(root, pkgFile), "utf8"));
    } catch {
      continue;
    }
    const refs: string[] = [];
    const collect = (v: unknown) => {
      if (typeof v === "string") refs.push(v);
      else if (v && typeof v === "object") Object.values(v).forEach(collect);
    };
    [pkg.main, pkg.module, pkg.bin, pkg.exports, pkg.browser].forEach(collect);
    for (const script of Object.values<string>(pkg.scripts ?? {})) {
      for (const m of String(script).matchAll(/[\w./-]+\.(?:[cm]?[jt]sx?)\b/g)) refs.push(m[0]);
    }
    for (const ref of refs) {
      const full = path.posix.normalize(path.posix.join(dir, ref));
      exact.add(full);
      byName.push({ dir, base: path.posix.basename(ref).replace(/\.[^.]+$/, "") });
    }
  }
  return { exact, byName };
}

export function scanHealth(root: string, facts: FileFacts[], allFiles: string[] = []): HealthResult {
  const findings: Finding[] = [];
  const entries = entryPoints(root, allFiles.length ? allFiles : ["package.json"]);
  const isPkgEntry = (file: string) => {
    if (entries.exact.has(file)) return true;
    const base = path.posix.basename(file).replace(/\.[^.]+$/, "");
    return entries.byName.some((e) => e.base === base && (e.dir === "" || file.startsWith(e.dir + "/")));
  };

  const imported = new Set<string>();
  for (const f of facts) for (const i of f.imports) if (i.resolved) imported.add(i.resolved);

  const source = facts.filter((f) => !isTestPath(f.path) && !CONFIG.test(f.path));
  const tests = facts.filter((f) => isTestPath(f.path));
  let todos = 0;
  let unused = 0;

  for (const f of source) {
    let text = "";
    try {
      text = fs.readFileSync(path.join(root, f.path), "utf8");
    } catch {
      continue;
    }
    const lines = text.split("\n").length;
    todos += (text.match(/\b(TODO|FIXME|HACK|XXX)\b/g) ?? []).length;
    if (lines > 500) {
      findings.push({
        id: shortId("big", f.path),
        category: "health",
        severity: "low",
        title: `Very large file (${lines} lines)`,
        file: f.path,
        fix: "Split it into smaller modules so it's easier to review and test.",
      });
    }
    const isEntry = ENTRY.test(f.path) || FRAMEWORK_DIRS.test(f.path) || isPkgEntry(f.path);
    if (!isEntry && !imported.has(f.path) && unused < 15) {
      unused++;
      findings.push({
        id: shortId("unused", f.path),
        category: "health",
        severity: "low",
        title: "File isn't imported anywhere (maybe unused)",
        file: f.path,
        fix: "Delete it if it's dead code, or accept it if it's loaded some other way.",
      });
    }
  }

  // Rough test coverage: how many source files have a test file with the same name
  const testNames = new Set(tests.map((t) => path.posix.basename(t.path).replace(/\.(test|spec)\.[a-z]+$/, "")));
  const testable = source.filter((f) => !ENTRY.test(f.path));
  const covered = testable.filter((f) => testNames.has(path.posix.basename(f.path).replace(/\.[a-z]+$/, ""))).length;
  const testRatio = testable.length ? covered / testable.length : null;
  if (testable.length >= 5 && tests.length === 0) {
    findings.push({
      id: shortId("no-tests"),
      category: "health",
      severity: "moderate",
      title: "No tests found",
      fix: "Start with tests for the code that handles money, auth or user data.",
    });
  }
  return { findings, testRatio, todos };
}

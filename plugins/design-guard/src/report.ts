import fs from "node:fs";
import path from "node:path";
import { analyzeSource, isCodeFile } from "./analyze";
import { compareWithBaseline, loadBaseline } from "./baseline";
import { checkFiles, layerMatcher } from "./check";
import { loadConfig } from "./config";
import { headFiles, indexFiles, readHead, readStaged, stagedChanges, workingFiles } from "./git";
import type { FileFacts, GuardReport, Introduced, PatternsConfig, Violation } from "./types";

export const REPORT_FILE = ".byte/last-report.json";

function deps(json: string | null): Set<string> {
  if (!json) return new Set();
  try {
    const p = JSON.parse(json);
    return new Set([...Object.keys(p.dependencies ?? {}), ...Object.keys(p.devDependencies ?? {})]);
  } catch {
    return new Set();
  }
}

/** Analyzes every code file in the repo (working tree versions). Used by init and baseline. */
export function analyzeRepo(root: string): FileFacts[] {
  const all = workingFiles(root);
  const set = new Set(all);
  return all
    .filter(isCodeFile)
    .filter((f) => fs.existsSync(path.join(root, f)))
    .map((f) => analyzeSource(f, fs.readFileSync(path.join(root, f), "utf8"), set));
}

export function checkRepo(root: string, config: PatternsConfig): Violation[] {
  return checkFiles(config, analyzeRepo(root));
}

/** Checks only what is staged, comparing with HEAD, the way the pre-commit hook needs. */
export function checkStaged(root: string): GuardReport {
  const config = loadConfig(root);
  const changes = stagedChanges(root);
  const layerOf = config ? layerMatcher(config.layers) : () => null;
  const index = new Set(indexFiles(root));

  const changed = changes.map((c) => ({ ...c, layer: layerOf(c.path) }));

  // What was introduced: new packages and new folders
  const introduced: Introduced[] = [];
  const pkgChanges = changes.filter((c) => c.path.endsWith("package.json") && c.status !== "D");
  for (const c of pkgChanges) {
    const before = deps(readHead(root, c.path));
    for (const name of deps(readStaged(root, c.path))) {
      if (!before.has(name)) introduced.push({ kind: "package", name, note: `new dependency in ${c.path}` });
    }
  }
  const head = headFiles(root);
  const headDirs = new Set(head.map((f) => path.posix.dirname(f)));
  const seenDirs = new Set<string>();
  // On the very first commit every folder is new, which isn't worth listing
  for (const c of head.length ? changes.filter((c) => c.status === "A" && isCodeFile(c.path)) : []) {
    const dir = path.posix.dirname(c.path);
    if (headDirs.has(dir) || seenDirs.has(dir) || [...headDirs].some((d) => d.startsWith(dir + "/"))) continue;
    seenDirs.add(dir);
    const covered = layerOf(c.path) !== null;
    introduced.push({ kind: "folder", name: `${dir}/`, note: covered ? `part of the ${layerOf(c.path)} layer` : "not part of any layer" });
  }

  let warnings: Violation[] = [];
  let baselined = 0;
  let fixed: { rule: string; file: string }[] = [];
  if (config) {
    const live = changes.filter((c) => c.status !== "D" && isCodeFile(c.path));
    const facts = live.map((c) => analyzeSource(c.path, readStaged(root, c.path), index));
    const all = checkFiles(config, facts);
    const checked = new Set(changes.map((c) => c.path));
    const result = compareWithBaseline(loadBaseline(root), all, checked);
    warnings = result.fresh;
    baselined = result.known;
    fixed = result.fixed.map(({ rule, file }) => ({ rule, file }));
  }

  return { createdAt: new Date().toISOString(), changed, introduced, warnings, baselined, fixed, hasConfig: Boolean(config) };
}

export function saveReport(root: string, report: GuardReport): void {
  const file = path.join(root, REPORT_FILE);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(report, null, 2));
}

const paint = {
  green: (s: string) => `\x1b[38;2;126;224;181m${s}\x1b[0m`,
  amber: (s: string) => `\x1b[38;2;242;184;107m${s}\x1b[0m`,
  blue: (s: string) => `\x1b[38;2;130;170;255m${s}\x1b[0m`,
  dim: (s: string) => `\x1b[2m${s}\x1b[0m`,
  bold: (s: string) => `\x1b[1m${s}\x1b[0m`,
};

export function formatReport(r: GuardReport, color = true): string {
  const c = color ? paint : { green: String, amber: String, blue: String, dim: String, bold: String };
  const lines: string[] = [];
  const w = r.warnings.length;
  const n = r.introduced.length;
  const head = w
    ? `Byte design guard: ${w} warning${w > 1 ? "s" : ""}${n ? `, ${n} new thing${n > 1 ? "s" : ""}` : ""}.`
    : `Byte design guard: all clear${n ? `, ${n} new thing${n > 1 ? "s" : ""}` : ""}.`;
  const face = w ? ["[ >_< ]", "/|_!_|\\"] : ["[ ^_^ ]", "/|_=_|\\"];
  const tone = w ? c.amber : c.green;
  lines.push("", `   ${tone(face[0])}   ${tone(head)}`);
  const sub = r.hasConfig
    ? r.fixed.length
      ? `You fixed ${r.fixed.length} old issue${r.fixed.length > 1 ? "s" : ""}. Nice.`
      : r.baselined
        ? `${r.baselined} older issue${r.baselined > 1 ? "s" : ""} in these files ignored (baseline).`
        : ""
    : "No byte.patterns.yml yet. Run: byte guard init";
  lines.push(`   ${tone(face[1])}   ${c.dim(sub)}`, "");

  if (r.changed.length) {
    lines.push(c.bold(" What changed"));
    for (const f of r.changed.slice(0, 15)) {
      const mark = f.status === "A" ? c.green("A") : f.status === "D" ? c.amber("D") : c.blue(f.status);
      lines.push(`   ${mark}  ${f.path}${f.layer ? c.dim(`  ${f.layer}`) : ""}`);
    }
    if (r.changed.length > 15) lines.push(c.dim(`   and ${r.changed.length - 15} more`));
    lines.push("");
  }
  if (n) {
    lines.push(c.bold(" What was introduced"));
    for (const i of r.introduced) lines.push(`   ${c.blue("+")}  ${i.kind} ${i.name}${c.dim(`  ${i.note}`)}`);
    lines.push("");
  }
  if (w) {
    lines.push(c.bold(" Warnings"));
    r.warnings.forEach((v, i) => {
      lines.push(`   ${c.amber(`${i + 1}.`)} ${v.message}`);
      lines.push(`      ${c.dim(`${v.file}:${v.line}  (${v.rule})`)}`);
      lines.push(`      ${c.dim(`Fix: ${v.fix}`)}`);
    });
    lines.push("");
  }
  return lines.join("\n");
}

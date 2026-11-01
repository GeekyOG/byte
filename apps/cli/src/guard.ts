import fs from "node:fs";
import path from "node:path";
import readline from "node:readline/promises";
import { applyEvent, loadState, saveState } from "@byte/pet";
import {
  CONFIG_FILE,
  analyzeRepo,
  baselineFrom,
  checkFiles,
  checkStaged,
  discover,
  formatReport,
  gitRoot,
  loadBaseline,
  loadConfig,
  pruneBaseline,
  saveBaseline,
  saveReport,
  stringifyConfig,
  type PatternsConfig,
  type Rule,
} from "@byte/design-guard";

const c = {
  green: (s: string) => `\x1b[38;2;126;224;181m${s}\x1b[0m`,
  amber: (s: string) => `\x1b[38;2;242;184;107m${s}\x1b[0m`,
  dim: (s: string) => `\x1b[2m${s}\x1b[0m`,
  bold: (s: string) => `\x1b[1m${s}\x1b[0m`,
};

/** byte guard init: study the codebase, suggest rules, ask the team, save rules and a baseline. */
export async function guardInit(flags: Set<string>) {
  const root = gitRoot(process.cwd());
  const configPath = path.join(root, CONFIG_FILE);
  if (fs.existsSync(configPath) && !flags.has("--force")) {
    console.log(`${CONFIG_FILE} already exists. Run with --force to study the codebase again.`);
    return;
  }
  console.log(c.dim("\n   Studying your codebase..."));
  const facts = analyzeRepo(root);
  if (facts.length === 0) {
    console.log(`\n   ${c.amber("[ o_o ]")}   ${c.amber("Byte didn't find any JavaScript or TypeScript files here.")}`);
    console.log(`   ${c.amber("/|_._|\\")}   ${c.dim(`Looked in ${root}`)}`);
    console.log(c.dim("\n   Run this inside the project you want Byte to watch. Nothing was saved.\n"));
    return;
  }
  const found = discover(facts);
  const layerCount = Object.keys(found.layers).length;
  console.log(`\n   ${c.green("[ ^_^ ]")}   ${c.green(`Byte studied ${found.filesScanned} files and found ${found.suggestions.length} pattern${found.suggestions.length === 1 ? "" : "s"}.`)}`);
  console.log(`   ${c.green("/|_=_|\\")}   ${c.dim(`Layers: ${Object.keys(found.layers).join(", ") || "none detected"}`)}\n`);

  const auto = flags.has("--yes") || !process.stdin.isTTY;
  const rl = auto ? null : readline.createInterface({ input: process.stdin, output: process.stdout });
  const rules: Rule[] = [];

  for (const s of found.suggestions) {
    const tag = s.confidence === "high" ? c.green(" HIGH ") : c.amber(" MIXED");
    console.log(` ${tag}  ${c.bold(s.title)}`);
    console.log(`         ${c.dim(s.evidence)}`);
    let choice = 0;
    if (auto) {
      choice = s.confidence === "high" ? 0 : s.options.length - 1; // unattended: keep sure things, skip open questions
      console.log(`         ${c.dim(`-> ${s.options[choice].label}`)}`);
    } else {
      s.options.forEach((o, i) => console.log(`         ${i + 1}) ${o.label}${i === 0 ? c.dim("  (Enter)") : ""}`));
      const answer = (await rl!.question("         > ")).trim();
      const n = Number(answer);
      choice = answer === "" ? 0 : Number.isInteger(n) && n >= 1 && n <= s.options.length ? n - 1 : 0;
    }
    rules.push(...s.options[choice].rules);
    console.log();
  }
  rl?.close();

  const config: PatternsConfig = { version: 1, layers: found.layers, rules, block: false };
  ignoreReportFile(root);
  fs.writeFileSync(configPath, stringifyConfig(config));
  const existing = checkFiles(config, facts);
  saveBaseline(root, baselineFrom(existing));

  console.log(`   Saved ${c.bold(CONFIG_FILE)} with ${layerCount} layers and ${rules.length} rule${rules.length === 1 ? "" : "s"}.`);
  console.log(
    `   ${existing.length} existing issue${existing.length === 1 ? "" : "s"} went into ${c.bold(".byte/baseline.json")}, so only new code gets warnings.`,
  );
  console.log(c.dim(`   Commit both files so your team shares the same rules.\n`));
}

/** The last report is personal and changes every commit, so keep it out of git. The baseline is shared. */
function ignoreReportFile(root: string) {
  const file = path.join(root, ".gitignore");
  const line = ".byte/last-report.json";
  const text = fs.existsSync(file) ? fs.readFileSync(file, "utf8") : "";
  if (text.split("\n").some((l) => l.trim() === line)) return;
  fs.writeFileSync(file, `${text}${text && !text.endsWith("\n") ? "\n" : ""}${line}\n`);
}

/** Secrets in the staged lines. Returns true if the commit should stop. */
async function checkStagedSecrets(root: string, mode: "block" | "warn", hook: boolean): Promise<boolean> {
  const { scanStaged } = await import("@byte/audit");
  const found = scanStaged(root);
  if (!found.length) return false;
  const stop = mode === "block" && hook;
  console.log(`\n   ${c.amber("[ O_O ]")}   ${c.amber(c.bold(`Beep! This commit adds ${found.length === 1 ? "a secret" : `${found.length} secrets`}.`))}`);
  console.log(`   ${c.amber("/|_!_|\\")}   ${c.dim(stop ? "I stopped the commit so it doesn't end up in git history." : "Double-check before pushing.")}\n`);
  for (const f of found) {
    console.log(`   ${c.amber(f.title)}${f.detail ? c.dim(`  ${f.detail}`) : ""}`);
    console.log(`      ${c.dim(`${f.file}${f.line ? `:${f.line}` : ""}`)}`);
    console.log(`      ${c.dim(`Fix: ${f.fix}`)}`);
  }
  if (stop) console.log(c.dim("\n   If it's a false alarm: add  // byte-ignore-secret  to the line, or commit with --no-verify.\n"));
  return stop;
}

/** byte guard check: check the staged changes. --hook = called from pre-commit. */
export async function guardCheck(flags: Set<string>) {
  const hook = flags.has("--hook");
  try {
    const root = gitRoot(process.cwd());
    const secretsMode = loadConfig(root)?.secrets ?? "block";
    if (!flags.has("--json") && (await checkStagedSecrets(root, secretsMode, hook))) {
      process.exitCode = 1;
      return;
    }
    const report = checkStaged(root);
    saveReport(root, report);
    if (flags.has("--json")) {
      console.log(JSON.stringify(report, null, 2));
    } else if (!hook || report.warnings.length || report.introduced.length || report.fixed.length) {
      console.log(formatReport(report, process.stdout.isTTY || hook));
    }
    if (hook && report.hasConfig) {
      const r = applyEvent(loadState(), { type: "guard", at: new Date(), warnings: report.warnings.length, fixed: report.fixed.length });
      saveState(r.state);
    }
    const config = loadConfig(root);
    if (config?.block && report.warnings.length) {
      console.log(c.amber("   Commit stopped because block: true is set in byte.patterns.yml."));
      console.log(c.dim("   Fix the warnings, or skip the check once with: git commit --no-verify\n"));
      process.exitCode = 1;
    }
  } catch (err) {
    if (!hook) throw err;
    // Never break someone's commit because Byte itself had a problem
    console.error(c.dim(`   Byte guard skipped: ${(err as Error).message}`));
  }
}

/** byte guard baseline: rebuild the list of accepted old issues. --prune only removes fixed ones. */
export function guardBaseline(flags: Set<string>) {
  const root = gitRoot(process.cwd());
  const config = loadConfig(root);
  if (!config) throw new Error(`No ${CONFIG_FILE} yet. Run: byte guard init`);
  const current = checkFiles(config, analyzeRepo(root));
  if (flags.has("--prune")) {
    const before = loadBaseline(root);
    const live = new Set(current.map((v) => v.fingerprint));
    const gone = Object.keys(before.entries).filter((fp) => !live.has(fp));
    saveBaseline(root, pruneBaseline(before, gone));
    console.log(`Removed ${gone.length} fixed issue${gone.length === 1 ? "" : "s"} from the baseline. ${Object.keys(before.entries).length - gone.length} left.`);
  } else {
    saveBaseline(root, baselineFrom(current));
    console.log(`Baseline rebuilt with ${current.length} existing issue${current.length === 1 ? "" : "s"}.`);
  }
}

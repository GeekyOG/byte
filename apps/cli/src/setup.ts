import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import readline from "node:readline/promises";
import { applyTestSetup, detectTests, hooksInstalled, installPostCommitHook, installPreCommitHook, repoRoot } from "@byte/signals";

const useColor = !process.env.NO_COLOR && process.stdout.isTTY;
const paint = (code: string) => (s: string) => (useColor ? `\x1b[${code}m${s}\x1b[0m` : s);
const c = { green: paint("38;2;126;224;181"), amber: paint("38;2;242;184;107"), dim: paint("2"), bold: paint("1") };
const OK = c.green("\u2713");
const NO = c.amber("\u2717");

async function confirm(question: string, auto: boolean): Promise<boolean> {
  if (auto || !process.stdin.isTTY) return true;
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const answer = (await rl.question(`${question} ${c.dim("[Y/n]")} `)).trim().toLowerCase();
  rl.close();
  return answer === "" || answer === "y" || answer === "yes";
}

/** byte tests setup: make the test runner write a JSON report Byte can read. */
export async function setupTests(root: string, auto: boolean): Promise<"done" | "already" | "manual" | "none" | "declined"> {
  const t = detectTests(root);
  if (!t.runner) {
    console.log(`   ${NO} No Jest or Vitest found. Byte reads their JSON reports; other runners aren't supported yet.`);
    return "none";
  }
  if (t.configured) {
    console.log(`   ${OK} ${t.runner} already writes a report Byte can read.`);
    return "already";
  }
  if (!t.newScript) {
    console.log(`   ${NO} Your test script is custom, so Byte won't edit it. Add these flags to your ${t.runner} command:`);
    console.log(`      ${c.bold(t.flags!)}`);
    return "manual";
  }
  console.log(`   Byte found ${c.bold(t.runner)}. To see your results, it will change the "test" script in package.json:`);
  console.log(`      ${c.dim("from")} ${t.script}`);
  console.log(`      ${c.dim("to  ")} ${t.newScript}`);
  if (!(await confirm("   Make this change?", auto))) return "declined";
  applyTestSetup(root);
  console.log(`   ${OK} Done. ${t.reportFile} is added to .gitignore.`);
  return "done";
}

/* ---------- doctor ---------- */

interface Check {
  label: string;
  ok: boolean;
  fix?: string;
  optional?: boolean;
}

export function doctorChecks(cwd: string): { root: string | null; checks: Check[] } {
  const checks: Check[] = [];
  const major = Number(process.versions.node.split(".")[0]);
  checks.push({ label: `Node.js ${process.versions.node}`, ok: major >= 18, fix: "Install Node.js 18 or newer." });
  let gitOk = true;
  try {
    execFileSync("git", ["--version"], { stdio: "ignore" });
  } catch {
    gitOk = false;
  }
  checks.push({ label: "git is installed", ok: gitOk, fix: "Install git." });
  const root = gitOk ? repoRoot(cwd) : null;
  checks.push({ label: "Inside a git repository", ok: !!root, fix: "cd into your project, or run git init." });
  if (!root) return { root, checks };

  const hooks = hooksInstalled(root);
  checks.push({ label: "Commit hooks installed", ok: hooks.pre && hooks.post, fix: "byte init" });
  checks.push({ label: "Design rules (byte.patterns.yml)", ok: fs.existsSync(path.join(root, "byte.patterns.yml")), fix: "byte guard init" });
  const t = detectTests(root);
  checks.push({
    label: t.runner ? `Test reports from ${t.runner}` : "Test reports",
    ok: t.configured,
    fix: t.runner ? "byte tests setup" : "Byte supports Jest and Vitest",
    optional: !t.runner,
  });
  const hasPkg = fs.existsSync(path.join(root, "package.json"));
  if (hasPkg) {
    checks.push({ label: "package-lock.json (for the package check)", ok: fs.existsSync(path.join(root, "package-lock.json")), fix: "npm install (pnpm and yarn aren't supported yet)", optional: true });
  }
  checks.push({ label: "First health check", ok: fs.existsSync(path.join(root, ".byte/audit.json")), fix: "byte audit" });
  return { root, checks };
}

export function doctor() {
  const { root, checks } = doctorChecks(process.cwd());
  console.log(`\n   ${c.bold("Byte doctor")}${root ? c.dim(`  ${root}`) : ""}\n`);
  for (const ch of checks) {
    const mark = ch.ok ? OK : ch.optional ? c.dim("-") : NO;
    console.log(`   ${mark} ${ch.label}${!ch.ok && ch.fix ? c.dim(`   ->  ${ch.fix}`) : ""}`);
  }
  const missing = checks.filter((ch) => !ch.ok && !ch.optional).length;
  console.log(missing ? `\n   ${missing} thing${missing > 1 ? "s" : ""} to set up. Or run ${c.bold("byte setup")} to do it all at once.\n` : `\n   ${c.green("All set. Byte is fully awake.")}\n`);
}

/* ---------- setup: everything in one go ---------- */

export async function setup(flags: Set<string>, cliPath: string, steps: { guardInit: (f: Set<string>) => Promise<void>; audit: (args: string[]) => Promise<void> }) {
  const auto = flags.has("--yes");
  const root = repoRoot(process.cwd());
  const step = (n: number, total: number, text: string) => console.log(`\n ${c.green(`[${n}/${total}]`)} ${c.bold(text)}`);
  console.log(`\n   ${c.green("[ ^_^ ]")}   ${c.green(c.bold("Hi! I'm Byte. Let's get me set up."))}`);
  console.log(`   ${c.green("/|_=_|\\")}   ${c.dim("Four quick steps. Nothing leaves your machine.")}`);
  if (!root) {
    console.log(`\n   ${NO} This folder isn't a git repository. cd into your project (or run git init) and try again.\n`);
    process.exitCode = 1;
    return;
  }

  step(1, 4, "Commit hooks");
  installPreCommitHook(root, cliPath);
  installPostCommitHook(root, cliPath);
  console.log(`   ${OK} Before each commit I check for secrets and design rules. After it, I give you XP.`);

  step(2, 4, "Design rules");
  if (fs.existsSync(path.join(root, "byte.patterns.yml"))) console.log(`   ${OK} byte.patterns.yml already exists. Run "byte guard init --force" to relearn.`);
  else {
    const cwd = process.cwd();
    process.chdir(root);
    await steps.guardInit(new Set(auto ? ["--yes"] : []));
    process.chdir(cwd);
  }

  step(3, 4, "Test results");
  await setupTests(root, auto);

  step(4, 4, "First health check");
  if (flags.has("--skip-audit")) console.log(c.dim("   Skipped. Run byte audit any time."));
  else {
    const cwd = process.cwd();
    process.chdir(root);
    await steps.audit(flags.has("--no-deps") ? ["--no-deps"] : []);
    process.chdir(cwd);
  }

  console.log(`\n   ${c.green("All done!")} Commit ${c.bold("byte.patterns.yml")}, ${c.bold(".byte/")} and ${c.bold(".gitignore")} so your team shares the setup.`);
  console.log(c.dim(`   Try "byte pet" to play with me, or "byte doctor" to check the setup any time.\n`));
}

import fs from "node:fs";
import path from "node:path";
import {
  FACES,
  applyEvent,
  loadState,
  moodFor,
  nextStage,
  saveState,
  stageFor,
  stageLabel,
  type ApplyResult,
  type PetEvent,
} from "@byte/pet";
import { installPostCommitHook, installPreCommitHook, lastCommitStats, parseTestReport } from "@byte/signals";
import { animate, chestFor, type Caption } from "./art";
import type { PetState } from "@byte/pet";

// Colour only when a person is watching a terminal (hooks count: git shows their output)
const useColor = !process.env.NO_COLOR && (process.stdout.isTTY || process.argv[2] === "log-commit");
const color = {
  green: (s: string) => (useColor ? `\x1b[38;2;126;224;181m${s}\x1b[0m` : s),
  amber: (s: string) => (useColor ? `\x1b[38;2;242;184;107m${s}\x1b[0m` : s),
  dim: (s: string) => (useColor ? `\x1b[2m${s}\x1b[0m` : s),
};

function nextLine(state: PetState): string {
  const next = nextStage(state.xp);
  return next ? `${next.minXp - state.xp} XP until ${next.label}` : "Fully evolved";
}

/** Small two-line face: used inside git hooks, where output should stay short and fast. */
function sayCompact(result: ApplyResult | null, extra?: string) {
  const state = result?.state ?? loadState();
  const mood = moodFor(state, new Date());
  const [top, bottom] = FACES[mood];
  const paint = mood === "happy" ? color.green : color.amber;
  const line = result?.message || extra || `Feeling ${mood.replace("-", " ")}.`;
  console.log(`\n   ${paint(top)}   ${paint(`${state.name}: ${line}`)}`);
  console.log(`   ${paint(bottom)}   ${color.dim(nextLine(state))}\n`);
}

/** The pixel robot, animated for a moment when the terminal supports it. */
async function say(result: ApplyResult | null, extra?: string, ms = 1600) {
  const state = result?.state ?? loadState();
  const mood = moodFor(state, new Date());
  const line = result?.message || extra || `Feeling ${mood.replace("-", " ")}.`;
  console.log();
  await animate(() => ({ mood, caption: { title: `${state.name}: ${line}`, lines: [color.dim(nextLine(state))] } }), ms);
  console.log();
}

function statusCaption(s: PetState): Caption {
  const mood = moodFor(s, new Date());
  return {
    title: `${s.name} is feeling ${mood.replace("-", " ")}`,
    lines: [
      "",
      `Stage    ${stageLabel(stageFor(s.xp))}  ${color.dim(`(${s.xp} XP)`)}`,
      `Health   ${s.health}%`,
      `Streak   ${s.streakDays} day${s.streakDays === 1 ? "" : "s"}`,
      ...(s.auditScore !== null && s.auditScore !== undefined ? [`Checkup  ${s.auditScore}/100`] : []),
      color.dim(nextLine(s)),
    ],
  };
}

function record(event: PetEvent) {
  const result = applyEvent(loadState(event.at), event);
  saveState(result.state);
  return result;
}

const commands: Record<string, (args: string[]) => void | Promise<void>> = {
  async init() {
    const cli = path.resolve(process.argv[1]);
    installPostCommitHook(process.cwd(), cli);
    installPreCommitHook(process.cwd(), cli);
    console.log("Installed git hooks: Byte checks each commit and reacts after it.");
    await say(null, "Hi! I'll watch your commits from now on.");
    console.log(color.dim("   Next: run `byte guard init` so I can learn your design rules.\n"));
  },

  async guard([sub, ...args]) {
    const flags = new Set(args);
    // Loaded only when needed: it pulls in the TypeScript compiler, which is slow to start
    const { guardBaseline, guardCheck, guardInit } = await import("./guard");
    if (sub === "init") return guardInit(flags);
    if (sub === "check") return guardCheck(flags);
    if (sub === "baseline") return guardBaseline(flags);
    fail("Usage: byte guard init [--yes] [--force] | check [--json] | baseline [--prune]");
  },

  "log-commit"() {
    const stats = lastCommitStats(process.cwd());
    sayCompact(record({ type: "commit", at: new Date(), linesChanged: stats.linesChanged, message: stats.message }));
  },

  async report([file]) {
    if (!file) return fail("Usage: byte report <test-report.json>");
    const summary = parseTestReport(fs.readFileSync(file, "utf8"));
    if (!summary) return fail("That file isn't a Jest or Vitest JSON report.");
    await say(record({ type: "tests", at: new Date(), ...summary }));
  },

  async vacation([value]) {
    if (value !== "on" && value !== "off") return fail("Usage: byte vacation on|off");
    await say(record({ type: "vacation", at: new Date(), on: value === "on" }));
  },

  async status() {
    const s = loadState();
    console.log();
    await animate(() => ({ mood: moodFor(s, new Date()), caption: statusCaption(s), chest: chestFor(s.auditScore) }), 2400);
    if (s.log.length) {
      console.log(`\n   Recent`);
      for (const e of s.log.slice(0, 5)) console.log(`   ${color.dim(e.at.slice(0, 16).replace("T", " "))}  ${e.text}`);
    }
    console.log();
  },

  async setup(args) {
    const { setup } = await import("./setup");
    const { guardInit } = await import("./guard");
    const { audit } = await import("./audit");
    await setup(new Set(args), path.resolve(process.argv[1]), { guardInit, audit });
  },

  async doctor() {
    const { doctor } = await import("./setup");
    doctor();
  },

  async tests([sub, ...args]) {
    const { setupTests } = await import("./setup");
    const { repoRoot } = await import("@byte/signals");
    if (sub !== "setup") return fail("Usage: byte tests setup [--yes]");
    const root = repoRoot(process.cwd());
    if (!root) return fail("Not inside a git repository.");
    await setupTests(root, args.includes("--yes"));
  },

  async audit(args) {
    const { audit } = await import("./audit");
    await audit(args);
  },

  /** Byte lives in your terminal until you press q: walks, reacts, and responds to keys and clicks. */
  async pet() {
    const { livePet } = await import("./live");
    await livePet(() => loadState());
  },

  help() {
    console.log(`byte, a robot pet for your terminal

  byte setup             set everything up in one go (start here)
  byte doctor            check what's set up and what's missing
  byte tests setup       let Byte read your Jest or Vitest results

  byte init              install the git hooks in this repo
  byte guard init        learn this codebase's design rules
  byte guard check       check staged changes against the rules
  byte guard baseline    rebuild the list of accepted old issues (--prune: drop fixed ones)
  byte status            show Byte's health, XP and recent activity
  byte pet               Byte lives in your terminal: pet it, feed it, click it (q to quit)
  byte audit             health check: secrets, packages, risky code, code health
                         --history  also scan git history   --url <site>  check a live site
                         --all  list everything   --json   --strict (exit 1 on critical, for CI)
  byte audit accept <id> "reason"   keep a risk on purpose (also: accepted, unaccept <id>)
  byte report <file>     feed a Jest or Vitest JSON report
  byte vacation on|off   pause health decay
`);
  },
};

function fail(msg: string) {
  console.error(msg);
  process.exitCode = 1;
}

const [cmd = "help", ...rest] = process.argv.slice(2);
Promise.resolve()
  .then(() => (commands[cmd] ?? commands.help)(rest))
  .catch((err) => fail((err as Error).message));

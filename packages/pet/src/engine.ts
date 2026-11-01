import type { ApplyResult, LogEntry, Mood, PetEvent, PetState, Stage } from "./types";

export const STAGES: { stage: Stage; label: string; minXp: number }[] = [
  { stage: "boot", label: "Boot", minXp: 0 },
  { stage: "mini-bot", label: "Mini-bot", minXp: 50 },
  { stage: "bot", label: "Bot", minXp: 200 },
  { stage: "senior-dev", label: "Senior Dev", minXp: 500 },
];

// Daily caps stop people farming XP with junk commits or repeated runs
export const CAPS = { commitXp: 30, testXp: 25, lintXp: 20, guardXp: 15, auditXp: 15 };
const MAX_LOG = 30;
const MAX_SEEN_RUNS = 50;

export function createPet(name = "Byte"): PetState {
  return {
    version: 1,
    name,
    xp: 0,
    health: 80,
    streakDays: 0,
    lastCommitDay: null,
    lastActiveAt: null,
    lastDecayDay: null,
    vacation: false,
    lastTestsFailed: false,
    guardWarnings: 0,
    auditScore: null,
    auditCritical: 0,
    lintErrors: null,
    seenTestRuns: [],
    today: { day: "", commitXp: 0, testXp: 0, lintXp: 0, guardXp: 0 },
    log: [],
  };
}

export function dayKey(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function parseDay(key: string): Date {
  const [y, m, d] = key.split("-").map(Number);
  return new Date(y, m - 1, d);
}

function isWeekend(d: Date): boolean {
  return d.getDay() === 0 || d.getDay() === 6;
}

/** Weekdays strictly between two days (weekends never count against you). */
export function weekdaysBetween(fromKey: string, to: Date): number {
  const cursor = parseDay(fromKey);
  const end = parseDay(dayKey(to));
  let count = 0;
  cursor.setDate(cursor.getDate() + 1);
  while (cursor < end) {
    if (!isWeekend(cursor)) count++;
    cursor.setDate(cursor.getDate() + 1);
  }
  return count;
}

const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, n));

export function stageFor(xp: number): Stage {
  let current: Stage = "boot";
  for (const s of STAGES) if (xp >= s.minXp) current = s.stage;
  return current;
}

export function stageLabel(stage: Stage): string {
  return STAGES.find((s) => s.stage === stage)!.label;
}

export function nextStage(xp: number): { label: string; minXp: number } | null {
  const next = STAGES.find((s) => s.minXp > xp);
  return next ? { label: next.label, minXp: next.minXp } : null;
}

export function moodFor(state: PetState, now: Date): Mood {
  if (state.vacation) return "standby";
  if (state.health < 30) return "glitching";
  if (state.lastActiveAt) {
    const idle = weekdaysBetween(dayKey(new Date(state.lastActiveAt)), now);
    if (idle >= 2) return "standby";
  }
  if (state.lastTestsFailed || state.guardWarnings > 0 || state.auditCritical > 0) return "concerned";
  if (!isWeekend(now) && state.lastCommitDay !== dayKey(now)) return "low-battery";
  return "happy";
}

function rollDay(state: PetState, now: Date): PetState {
  const key = dayKey(now);
  if (state.today.day === key) return state;
  return { ...state, today: { day: key, commitXp: 0, testXp: 0, lintXp: 0, guardXp: 0 } };
}

function withLog(state: PetState, entry: LogEntry): PetState {
  return { ...state, log: [entry, ...state.log].slice(0, MAX_LOG) };
}

/**
 * Slow, forgiving health decay: only for idle weekdays, never on weekends
 * or in vacation mode, capped so a long break never kills the pet.
 */
export function applyDecay(state: PetState, now: Date): PetState {
  const key = dayKey(now);
  if (state.lastDecayDay === key) return state;
  const next: PetState = { ...state, lastDecayDay: key };
  if (state.vacation || !state.lastActiveAt) return next;
  const activeDay = dayKey(new Date(state.lastActiveAt));
  // Full idle weekdays in this break, and how many were already charged on an earlier day
  const lossFor = (days: number) => Math.min(days * 4, 20); // capped per break
  const idle = weekdaysBetween(activeDay, now);
  const charged =
    state.lastDecayDay && state.lastDecayDay > activeDay
      ? weekdaysBetween(activeDay, parseDay(state.lastDecayDay))
      : 0;
  const loss = lossFor(idle) - lossFor(charged);
  if (loss <= 0) return next;
  return { ...next, health: clamp(next.health - loss, 10, 100) };
}

export function applyEvent(prev: PetState, event: PetEvent): ApplyResult {
  const now = event.at;
  const beforeStage = stageFor(prev.xp);
  let state = rollDay(applyDecay(prev, now), now);
  let xp = 0;
  let hp = 0;
  let message = "";

  switch (event.type) {
    case "commit": {
      const today = dayKey(now);
      const raw = event.linesChanged >= 3 ? 5 : 1; // tiny commits count less
      xp = Math.min(raw, CAPS.commitXp - state.today.commitXp);
      hp = 2;
      let streak = state.streakDays;
      if (state.lastCommitDay !== today) {
        const gap = state.lastCommitDay ? weekdaysBetween(state.lastCommitDay, now) : 0;
        streak = state.lastCommitDay && gap === 0 ? streak + 1 : 1;
      }
      state = {
        ...state,
        streakDays: streak,
        lastCommitDay: today,
        today: { ...state.today, commitXp: state.today.commitXp + xp },
      };
      message = xp > 0 ? `Commit logged. +${xp} XP` : "Commit logged. Daily commit XP is maxed, nice work.";
      break;
    }
    case "tests": {
      if (state.seenTestRuns.includes(event.runId)) {
        return { state: prev, xp: 0, hp: 0, message: "Already counted that test run." };
      }
      state = { ...state, seenTestRuns: [event.runId, ...state.seenTestRuns].slice(0, MAX_SEEN_RUNS) };
      if (event.failed === 0 && event.passed > 0) {
        xp = Math.min(event.passed, CAPS.testXp - state.today.testXp);
        hp = 5;
        message = `All ${event.passed} tests green! +${xp} XP`;
        state = { ...state, lastTestsFailed: false, today: { ...state.today, testXp: state.today.testXp + xp } };
      } else if (event.failed > 0) {
        hp = -Math.min(event.failed * 2, 10);
        message = `${event.failed} test${event.failed > 1 ? "s" : ""} failing. Let's fix ${event.failed > 1 ? "them" : "it"}.`;
        state = { ...state, lastTestsFailed: true };
      } else {
        message = "No tests ran.";
      }
      if (event.skipped > 0) {
        hp -= Math.min(event.skipped, 5);
        message += ` ${event.skipped} skipped.`;
      }
      break;
    }
    case "lint": {
      const before = state.lintErrors;
      state = { ...state, lintErrors: event.errors };
      if (before === null) {
        return { state, xp: 0, hp: 0, message: "" }; // first reading is just a baseline
      }
      const delta = before - event.errors;
      if (delta > 0) {
        xp = Math.min(delta * 2, CAPS.lintXp - state.today.lintXp);
        state = { ...state, today: { ...state.today, lintXp: state.today.lintXp + xp } };
        message = `Fixed ${delta} lint error${delta > 1 ? "s" : ""}. +${xp} XP`;
      } else if (delta < 0) {
        hp = -Math.min(-delta, 5);
        message = `${-delta} new lint error${delta < -1 ? "s" : ""}.`;
      } else {
        return { state, xp: 0, hp: 0, message: "" };
      }
      break;
    }
    case "guard": {
      state = { ...state, guardWarnings: event.warnings };
      if (event.fixed > 0) {
        const used = state.today.guardXp ?? 0;
        xp = Math.min(event.fixed * 3, CAPS.guardXp - used);
        state = { ...state, today: { ...state.today, guardXp: used + xp } };
        message = `You fixed ${event.fixed} old design issue${event.fixed > 1 ? "s" : ""}. +${xp} XP`;
      }
      if (event.warnings > 0) {
        hp = -Math.min(event.warnings * 2, 6);
        message = `${message ? message + " " : ""}${event.warnings} design warning${event.warnings > 1 ? "s" : ""} in this commit.`;
      } else if (!message) {
        return { state, xp: 0, hp: 0, message: "" };
      }
      break;
    }
    case "audit": {
      const before = state.auditScore;
      state = { ...state, auditScore: event.score, auditCritical: event.critical };
      if (before !== null && event.score > before) {
        const used = state.today.auditXp ?? 0;
        xp = Math.min(event.score - before, CAPS.auditXp - used);
        state = { ...state, today: { ...state.today, auditXp: used + xp } };
        message = `Health check up from ${before} to ${event.score}. +${xp} XP`;
      } else if (before !== null && event.score < before) {
        hp = -Math.min(Math.ceil((before - event.score) / 5), 5);
        message = `Health check down from ${before} to ${event.score}.`;
      } else {
        message = `Health check: ${event.score}/100.`;
      }
      if (event.critical > 0) message += ` ${event.critical} critical issue${event.critical > 1 ? "s" : ""} to fix.`;
      break;
    }
    case "vacation": {
      state = { ...state, vacation: event.on };
      message = event.on ? "Vacation mode on. See you soon." : "Welcome back!";
      break;
    }
  }

  state = {
    ...state,
    xp: state.xp + xp,
    health: clamp(state.health + hp, 0, 100),
    lastActiveAt: event.type === "vacation" ? state.lastActiveAt : now.toISOString(),
  };

  const afterStage = stageFor(state.xp);
  const evolvedTo = afterStage !== beforeStage ? afterStage : undefined;
  if (evolvedTo) message += ` ${state.name} evolved into ${stageLabel(evolvedTo)}!`;
  if (message) state = withLog(state, { at: now.toISOString(), text: message.trim(), xp, hp });

  return { state, xp, hp, message: message.trim(), evolvedTo };
}

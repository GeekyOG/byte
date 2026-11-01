export type Stage = "boot" | "mini-bot" | "bot" | "senior-dev";

export type Mood = "happy" | "concerned" | "low-battery" | "standby" | "glitching";

export interface LogEntry {
  at: string; // ISO time
  text: string;
  xp: number;
  hp: number;
}

export interface PetState {
  version: 1;
  name: string;
  xp: number;
  health: number; // 0 to 100
  streakDays: number;
  lastCommitDay: string | null; // YYYY-MM-DD, local
  lastActiveAt: string | null; // ISO
  lastDecayDay: string | null; // YYYY-MM-DD, local
  vacation: boolean;
  lastTestsFailed: boolean;
  guardWarnings: number; // new design warnings in the last checked commit
  auditScore: number | null; // last health check score, 0 to 100
  auditCritical: number; // critical findings in the last health check
  lintErrors: number | null; // last known count, null = unknown
  seenTestRuns: string[]; // recent run hashes, so the same run never pays twice
  today: { day: string; commitXp: number; testXp: number; lintXp: number; guardXp?: number; auditXp?: number };
  log: LogEntry[]; // newest first, capped
}

export type PetEvent =
  | { type: "commit"; at: Date; linesChanged: number; message?: string }
  | { type: "tests"; at: Date; passed: number; failed: number; skipped: number; runId: string }
  | { type: "lint"; at: Date; errors: number }
  | { type: "vacation"; at: Date; on: boolean }
  | { type: "guard"; at: Date; warnings: number; fixed: number }
  | { type: "audit"; at: Date; score: number; critical: number };

export interface ApplyResult {
  state: PetState;
  xp: number; // change from this event
  hp: number;
  message: string; // short line Byte says
  evolvedTo?: Stage;
}

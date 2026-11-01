import fs from "node:fs";
import path from "node:path";
import type { Violation } from "./types";

export const BASELINE_FILE = ".byte/baseline.json";

export interface Baseline {
  version: 1;
  createdAt: string;
  entries: Record<string, { rule: string; file: string }>; // fingerprint -> where
}

export function loadBaseline(root: string): Baseline {
  try {
    const raw = JSON.parse(fs.readFileSync(path.join(root, BASELINE_FILE), "utf8"));
    if (raw.version === 1) return raw;
  } catch {}
  return { version: 1, createdAt: new Date().toISOString(), entries: {} };
}

export function saveBaseline(root: string, baseline: Baseline): void {
  const file = path.join(root, BASELINE_FILE);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(baseline, null, 2) + "\n");
}

export function baselineFrom(violations: Violation[]): Baseline {
  const entries: Baseline["entries"] = {};
  for (const v of violations) entries[v.fingerprint] = { rule: v.rule, file: v.file };
  return { version: 1, createdAt: new Date().toISOString(), entries };
}

/**
 * Splits violations in the checked files into new ones and known ones,
 * and finds baseline entries in those files that have been fixed.
 */
export function compareWithBaseline(baseline: Baseline, violations: Violation[], checkedFiles: Set<string>) {
  const current = new Set(violations.map((v) => v.fingerprint));
  const fresh = violations.filter((v) => !baseline.entries[v.fingerprint]);
  const known = violations.length - fresh.length;
  const fixed = Object.entries(baseline.entries)
    .filter(([fp, e]) => checkedFiles.has(e.file) && !current.has(fp))
    .map(([fp, e]) => ({ fingerprint: fp, ...e }));
  return { fresh, known, fixed };
}

/** Drops fixed entries so the baseline only ever shrinks. */
export function pruneBaseline(baseline: Baseline, fixedFingerprints: string[]): Baseline {
  const entries = { ...baseline.entries };
  for (const fp of fixedFingerprints) delete entries[fp];
  return { ...baseline, entries };
}

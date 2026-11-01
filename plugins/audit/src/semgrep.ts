import { execFile } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import type { CheckStatus, Finding, Severity } from "./types";
import { shortId } from "./util";

export const SEMGREP_DIR = ".byte/semgrep";

/**
 * Optional: if the team keeps its own Semgrep rules in .byte/semgrep and has
 * semgrep installed, Byte runs them too. Byte never ships registry rules.
 */
export async function scanSemgrep(root: string): Promise<{ findings: Finding[]; status: CheckStatus | null }> {
  const dir = path.join(root, SEMGREP_DIR);
  if (!fs.existsSync(dir)) return { findings: [], status: null };
  const stdout = await new Promise<string | null>((resolve) => {
    execFile("semgrep", ["scan", "--config", dir, "--json", "--quiet", "--metrics=off", "."], { cwd: root, maxBuffer: 64 * 1024 * 1024, timeout: 120_000 }, (err, out) =>
      resolve(err && !out ? null : out),
    );
  });
  if (stdout === null) return { findings: [], status: { category: "code", ran: false, note: "your .byte/semgrep rules were skipped: semgrep isn't installed" } };
  const sev = (s: string): Severity => (s === "ERROR" ? "high" : s === "WARNING" ? "moderate" : "low");
  try {
    const results: any[] = JSON.parse(stdout).results ?? [];
    return {
      findings: results.map((r) => ({
        id: shortId("semgrep", r.check_id, r.path, r.start?.line),
        category: "code" as const,
        severity: sev(r.extra?.severity),
        title: r.extra?.message ?? r.check_id,
        file: r.path,
        line: r.start?.line,
        fix: r.extra?.fix ?? "See the rule in .byte/semgrep.",
      })),
      status: { category: "code", ran: true, note: `plus ${results.length} result(s) from your .byte/semgrep rules` },
    };
  } catch {
    return { findings: [], status: { category: "code", ran: false, note: "semgrep output couldn't be read" } };
  }
}

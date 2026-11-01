import { createHash } from "node:crypto";

export interface TestRunSummary {
  passed: number;
  failed: number;
  skipped: number;
  runId: string;
}

/**
 * Reads a Jest `--json` report or a Vitest `--reporter=json` report.
 * Both share the same top-level counters, so one parser covers both.
 */
export function parseTestReport(json: string): TestRunSummary | null {
  let data: any;
  try {
    data = JSON.parse(json);
  } catch {
    return null;
  }
  if (typeof data?.numTotalTests !== "number") return null;
  const passed = Number(data.numPassedTests ?? 0);
  const failed = Number(data.numFailedTests ?? 0);
  const skipped = Number(data.numPendingTests ?? 0) + Number(data.numTodoTests ?? 0);
  // startTime makes each run unique, so re-reading the same file never pays twice
  const runId = createHash("sha1")
    .update(`${data.startTime ?? ""}:${passed}:${failed}:${skipped}`)
    .digest("hex")
    .slice(0, 16);
  return { passed, failed, skipped, runId };
}

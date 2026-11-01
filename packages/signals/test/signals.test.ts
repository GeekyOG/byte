import { describe, expect, it } from "vitest";
import { parseShortStat, parseTestReport } from "@byte/signals";

describe("parseTestReport", () => {
  it("reads Jest and Vitest JSON reports", () => {
    const r = parseTestReport(JSON.stringify({ numTotalTests: 10, numPassedTests: 8, numFailedTests: 1, numPendingTests: 1, startTime: 123 }));
    expect(r).toMatchObject({ passed: 8, failed: 1, skipped: 1 });
    expect(r!.runId).toHaveLength(16);
  });

  it("rejects files that are not test reports", () => {
    expect(parseTestReport("{\"name\":\"pkg\"}")).toBeNull();
    expect(parseTestReport("not json")).toBeNull();
  });
});

describe("parseShortStat", () => {
  it("adds insertions and deletions", () => {
    expect(parseShortStat(" 3 files changed, 40 insertions(+), 2 deletions(-)")).toBe(42);
    expect(parseShortStat(" 1 file changed, 1 deletion(-)")).toBe(1);
  });
});

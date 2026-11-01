import type { Finding } from "./types";

const WEIGHT = { critical: 25, high: 10, moderate: 3, low: 1 };

/** Starts at 100; low findings together can cost at most 10 points, so tidy-ups never dominate. */
export function scoreFor(findings: Finding[]): number {
  let lowCost = 0;
  let cost = 0;
  for (const f of findings) {
    if (f.severity === "low") lowCost += WEIGHT.low;
    else cost += WEIGHT[f.severity];
  }
  return Math.max(0, 100 - cost - Math.min(lowCost, 10));
}

export function scoreColor(score: number): "green" | "amber" | "red" {
  return score >= 80 ? "green" : score >= 50 ? "amber" : "red";
}

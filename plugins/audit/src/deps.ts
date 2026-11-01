import { execFile } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import type { CheckStatus, Finding, Severity } from "./types";
import { shortId } from "./util";

const SEV: Record<string, Severity> = { critical: "critical", high: "high", moderate: "moderate", low: "low", info: "low" };

/** Turns `npm audit --json` output into findings. */
export function parseNpmAudit(json: string, lockfile = "package-lock.json"): Finding[] {
  const data = JSON.parse(json);
  const out: Finding[] = [];
  for (const [name, v] of Object.entries<any>(data.vulnerabilities ?? {})) {
    const titles: string[] = (v.via ?? []).filter((x: any) => typeof x === "object" && x.title).map((x: any) => x.title);
    const direct = (v.via ?? []).every((x: any) => typeof x === "object");
    const fix =
      v.fixAvailable === true
        ? `Run "npm audit fix".`
        : v.fixAvailable && typeof v.fixAvailable === "object"
          ? `Update ${v.fixAvailable.name} to ${v.fixAvailable.version}${v.fixAvailable.isSemVerMajor ? " (major version, check for breaking changes)" : ""}.`
          : "No fix yet. Consider replacing this package, or accept the risk with a reason.";
    out.push({
      id: shortId("dep", name, v.range),
      category: "dependencies",
      severity: SEV[v.severity] ?? "low",
      title: `${name}: ${titles[0] ?? "known vulnerability"}${titles.length > 1 ? ` (+${titles.length - 1} more)` : ""}`,
      file: lockfile,
      detail: `${direct ? "" : "comes in through another package, "}affected ${v.range}`,
      fix,
    });
  }
  return out;
}

export async function scanDependencies(root: string): Promise<{ findings: Finding[]; status: CheckStatus }> {
  const has = (f: string) => fs.existsSync(path.join(root, f));
  if (!has("package.json")) return { findings: [], status: { category: "dependencies", ran: false, note: "no package.json" } };
  if (!has("package-lock.json")) {
    const other = has("pnpm-lock.yaml") ? "pnpm" : has("yarn.lock") ? "yarn" : null;
    return {
      findings: [],
      status: { category: "dependencies", ran: false, note: other ? `${other} lockfiles aren't supported yet (npm only for now)` : "no package-lock.json; run npm install first" },
    };
  }
  const stdout = await new Promise<string>((resolve) => {
    execFile("npm", ["audit", "--json"], { cwd: root, maxBuffer: 64 * 1024 * 1024, timeout: 60_000 }, (_err, out) => resolve(out ?? ""));
  });
  try {
    const data = JSON.parse(stdout);
    if (data.error) throw new Error(data.error.summary ?? "npm audit failed");
    const findings = parseNpmAudit(stdout);
    const total = data.metadata?.dependencies?.total;
    return { findings, status: { category: "dependencies", ran: true, note: total ? `${total} packages checked` : undefined } };
  } catch {
    return { findings: [], status: { category: "dependencies", ran: false, note: "couldn't reach the npm registry (offline?)" } };
  }
}

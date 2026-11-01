import fs from "node:fs";
import path from "node:path";
import { analyzeRepo, workingFiles } from "@byte/design-guard";
import { loadAccepted } from "./accept";
import { scanDependencies } from "./deps";
import { scanHealth } from "./health";
import { scanLive } from "./live";
import { scanRiskyCode } from "./risky";
import { scoreFor } from "./score";
import { scanHistory, scanWorkingTree } from "./secrets";
import { scanSemgrep } from "./semgrep";
import { SEVERITY_ORDER, type AuditReport, type CheckStatus, type Finding } from "./types";

export const AUDIT_FILE = ".byte/audit.json";

export interface AuditOptions {
  history?: boolean; // also scan recent git history for secrets
  url?: string; // also check a live site
  dependencies?: boolean; // default true; tests turn it off (needs the network)
}

export async function runAudit(root: string, opts: AuditOptions = {}): Promise<AuditReport> {
  const files = workingFiles(root);
  const checks: CheckStatus[] = [];
  const findings: Finding[] = [];

  // Secrets
  const secretFindings = scanWorkingTree(root, files);
  if (opts.history) secretFindings.push(...scanHistory(root));
  findings.push(...dedupe(secretFindings));
  checks.push({ category: "secrets", ran: true, note: opts.history ? "files and the last 300 commits" : "current files; add --history to scan git history" });

  // Dependencies, in parallel with the code checks
  const depsPromise = opts.dependencies === false ? null : scanDependencies(root);
  const semgrepPromise = scanSemgrep(root);

  // Risky code
  const facts = analyzeRepo(root);
  for (const f of facts) {
    try {
      findings.push(...scanRiskyCode(f.path, fs.readFileSync(path.join(root, f.path), "utf8")));
    } catch {}
  }
  checks.push({ category: "code", ran: true, note: `${facts.length} JavaScript/TypeScript files` });
  const semgrep = await semgrepPromise;
  findings.push(...semgrep.findings);
  if (semgrep.status) checks.push(semgrep.status);

  // Code health
  const health = scanHealth(root, facts, files);
  findings.push(...health.findings);
  checks.push({ category: "health", ran: true });

  if (depsPromise) {
    const deps = await depsPromise;
    findings.push(...deps.findings);
    checks.push(deps.status);
  } else {
    checks.push({ category: "dependencies", ran: false, note: "skipped" });
  }

  if (opts.url) {
    const live = await scanLive(opts.url);
    findings.push(...live.findings);
    checks.push({ category: "live", ran: true, note: live.note });
  }

  const accepted = loadAccepted(root);
  const open = findings.filter((f) => !accepted.entries[f.id]);
  open.sort((a, b) => SEVERITY_ORDER.indexOf(a.severity) - SEVERITY_ORDER.indexOf(b.severity));

  return {
    createdAt: new Date().toISOString(),
    score: scoreFor(open),
    findings: open,
    accepted: findings.length - open.length,
    checks,
    metrics: { filesScanned: files.length, testRatio: health.testRatio, todos: health.todos },
  };
}

function dedupe(list: Finding[]): Finding[] {
  const seen = new Set<string>();
  return list.filter((f) => (seen.has(f.id) ? false : (seen.add(f.id), true)));
}

export function saveAudit(root: string, report: AuditReport): void {
  const file = path.join(root, AUDIT_FILE);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(report, null, 2));
}

export function loadAudit(root: string): AuditReport | null {
  try {
    return JSON.parse(fs.readFileSync(path.join(root, AUDIT_FILE), "utf8"));
  } catch {
    return null;
  }
}

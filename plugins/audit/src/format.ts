import { scoreColor } from "./score";
import type { AuditReport, Category, Finding } from "./types";

const LABEL: Record<Category, string> = {
  secrets: "Secrets",
  dependencies: "Packages",
  code: "Risky code",
  health: "Code health",
  live: "Live site",
};

export function formatAudit(r: AuditReport, color = true, perCategory = 5): string {
  const paint = (code: string) => (s: string) => (color ? `\x1b[${code}m${s}\x1b[0m` : s);
  const c = {
    green: paint("38;2;126;224;181"),
    amber: paint("38;2;242;184;107"),
    red: paint("38;2;242;139;130"),
    dim: paint("2"),
    bold: paint("1"),
  };
  const tone = { green: c.green, amber: c.amber, red: c.red }[scoreColor(r.score)];
  const sev = (f: Finding) => {
    const label = f.severity.toUpperCase().padEnd(8);
    return f.severity === "critical" ? c.red(label) : f.severity === "high" ? c.amber(label) : f.severity === "moderate" ? c.amber(label) : c.dim(label);
  };
  const counts = { critical: 0, high: 0, moderate: 0, low: 0 };
  for (const f of r.findings) counts[f.severity]++;

  const face = r.score >= 80 ? ["[ ^_^ ]", "/|_=_|\\"] : r.score >= 50 ? ["[ o_o ]", "/|_._|\\"] : ["[ x_x ]", "/|_#_|\\"];
  const headline = r.findings.length ? `Health check: ${r.score}/100` : "Health check: 100/100, nothing found!";
  const summary = (["critical", "high", "moderate", "low"] as const).filter((k) => counts[k]).map((k) => `${counts[k]} ${k}`).join(", ");
  const lines = ["", `   ${tone(face[0])}   ${tone(c.bold(headline))}`, `   ${tone(face[1])}   ${c.dim(summary || `${r.metrics.filesScanned} files checked`)}`, ""];

  const cats: Category[] = ["secrets", "dependencies", "code", "health", "live"];
  for (const cat of cats) {
    const status = r.checks.find((s) => s.category === cat);
    if (!status) continue;
    const list = r.findings.filter((f) => f.category === cat);
    const mark = !status.ran ? c.dim("skipped") : list.length ? `${list.length} found` : c.green("all clear");
    lines.push(` ${c.bold(LABEL[cat])}  ${mark}${status.note ? c.dim(`  (${status.note})`) : ""}`);
    for (const f of list.slice(0, perCategory)) {
      const where = f.file ? `${f.file}${f.line ? `:${f.line}` : ""}` : "";
      lines.push(`   ${sev(f)} ${f.title}${f.detail ? c.dim(`  ${f.detail}`) : ""}`);
      if (where) lines.push(`            ${c.dim(where)}`);
      lines.push(`            ${c.dim(`Fix: ${f.fix}`)}  ${c.dim(`[${f.id}]`)}`);
    }
    if (list.length > perCategory) lines.push(c.dim(`   and ${list.length - perCategory} more (byte audit --all)`));
    lines.push("");
  }
  const m = r.metrics;
  const extras = [
    m.testRatio !== null ? `${Math.round(m.testRatio * 100)}% of files have a matching test` : null,
    m.todos ? `${m.todos} TODO/FIXME notes` : null,
    r.accepted ? `${r.accepted} accepted risk${r.accepted > 1 ? "s" : ""} hidden` : null,
  ].filter(Boolean);
  if (extras.length) lines.push(c.dim(` ${extras.join("  ·  ")}`));
  if (r.findings.length) lines.push(c.dim(` Accept a risk you've decided to keep: byte audit accept <id> "reason"`));
  lines.push("");
  return lines.join("\n");
}

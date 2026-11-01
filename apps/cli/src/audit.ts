import fs from "node:fs";
import path from "node:path";
import { applyEvent, loadState, saveState } from "@byte/pet";
import { gitRoot } from "@byte/design-guard";
import { ACCEPT_FILE, formatAudit, loadAccepted, runAudit, saveAccepted, saveAudit, loadAudit } from "@byte/audit";

const useColor = !process.env.NO_COLOR && process.stdout.isTTY;
const dim = (s: string) => (useColor ? `\x1b[2m${s}\x1b[0m` : s);

function ignoreAuditFile(root: string) {
  const file = path.join(root, ".gitignore");
  const line = ".byte/audit.json";
  const text = fs.existsSync(file) ? fs.readFileSync(file, "utf8") : "";
  if (text.split("\n").some((l) => l.trim() === line)) return;
  fs.writeFileSync(file, `${text}${text && !text.endsWith("\n") ? "\n" : ""}${line}\n`);
}

/** byte audit [--history] [--url <site>] [--all] [--json] [--no-deps] */
export async function audit(args: string[]) {
  const [sub, ...rest] = args;
  if (sub === "accept") return accept(rest);
  if (sub === "accepted") return listAccepted();
  if (sub === "unaccept") return unaccept(rest);

  const flags = new Set(args.filter((a) => a.startsWith("--")));
  const urlIndex = args.indexOf("--url");
  const url = urlIndex >= 0 ? args[urlIndex + 1] : undefined;
  if (urlIndex >= 0 && (!url || !/^https?:\/\//.test(url))) throw new Error("Usage: byte audit --url https://your-site.com");

  const root = gitRoot(process.cwd());
  const json = flags.has("--json");
  if (!json) console.log(dim("\n   Running the health check..."));
  const report = await runAudit(root, { history: flags.has("--history"), url, dependencies: !flags.has("--no-deps") });
  saveAudit(root, report);
  ignoreAuditFile(root);

  const critical = report.findings.filter((f) => f.severity === "critical").length;
  const r = applyEvent(loadState(), { type: "audit", at: new Date(), score: report.score, critical });
  saveState(r.state);

  if (json) console.log(JSON.stringify(report, null, 2));
  else {
    console.log(formatAudit(report, useColor, flags.has("--all") ? Infinity : 5));
    if (r.xp > 0) console.log(`   ${r.message}\n`);
  }
  if (flags.has("--strict") && critical > 0) process.exitCode = 1; // for CI
}

function accept([id, ...reasonParts]: string[]) {
  const reason = reasonParts.join(" ").trim();
  if (!id || !reason) throw new Error('Usage: byte audit accept <id> "why it\'s okay"');
  const root = gitRoot(process.cwd());
  const last = loadAudit(root);
  const finding = last?.findings.find((f) => f.id === id);
  if (!finding) throw new Error(`No finding with id ${id} in the last health check. Run "byte audit" first.`);
  const accepted = loadAccepted(root);
  accepted.entries[id] = { reason, title: finding.title, at: new Date().toISOString() };
  saveAccepted(root, accepted);
  console.log(`Accepted: ${finding.title}\nSaved in ${ACCEPT_FILE}. Commit it so your team sees the reason.`);
}

function listAccepted() {
  const accepted = loadAccepted(gitRoot(process.cwd()));
  const entries = Object.entries(accepted.entries);
  if (!entries.length) return console.log("No accepted risks.");
  for (const [id, e] of entries) console.log(`${id}  ${e.title}\n          ${dim(`"${e.reason}"  (${e.at.slice(0, 10)})`)}`);
}

function unaccept([id]: string[]) {
  const root = gitRoot(process.cwd());
  const accepted = loadAccepted(root);
  if (!id || !accepted.entries[id]) throw new Error("Usage: byte audit unaccept <id> (see byte audit accepted)");
  delete accepted.entries[id];
  saveAccepted(root, accepted);
  console.log(`Removed. It will show up again in the next health check.`);
}

import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import type { Finding, Severity } from "./types";
import { entropy, isTestPath, mask, shortId } from "./util";

/**
 * Byte's own secret rules (MIT, no external tool needed). If gitleaks is
 * installed, history scans can use it too, but these cover the common keys.
 */
interface SecretRule {
  id: string;
  name: string;
  pattern: RegExp; // capture group 1 = the secret, or whole match
  severity: Severity;
  check?: (secret: string, line: string) => boolean;
}

const PLACEHOLDER = /^(x+|\*+|password|passwd|secret|changeme|example|your[_-]?|test|dummy|placeholder|<.*>|\$\{.*\}|\{\{.*\}\})/i;

export const SECRET_RULES: SecretRule[] = [
  { id: "private-key", name: "Private key", pattern: /-----BEGIN (?:RSA |EC |OPENSSH |DSA |PGP |ENCRYPTED )?PRIVATE KEY-----/, severity: "critical" },
  { id: "aws-key", name: "AWS access key", pattern: /\b((?:AKIA|ASIA)[0-9A-Z]{16})\b/, severity: "critical" },
  { id: "live-secret-key", name: "Paystack or Stripe live secret key", pattern: /\b(sk_live_[0-9a-zA-Z]{20,})\b/, severity: "critical" },
  { id: "test-secret-key", name: "Paystack or Stripe test secret key", pattern: /\b(sk_test_[0-9a-zA-Z]{20,})\b/, severity: "moderate" },
  { id: "flutterwave-live", name: "Flutterwave live secret key", pattern: /\b(FLWSECK-[0-9a-zA-Z]{20,}-X)\b/, severity: "critical" },
  { id: "flutterwave-test", name: "Flutterwave test secret key", pattern: /\b(FLWSECK_TEST-[0-9a-zA-Z]{20,}-X)\b/, severity: "moderate" },
  { id: "github-token", name: "GitHub token", pattern: /\b((?:ghp|gho|ghu|ghs|ghr)_[0-9A-Za-z]{36}|github_pat_[0-9A-Za-z_]{40,})\b/, severity: "critical" },
  { id: "anthropic-key", name: "Anthropic API key", pattern: /\b(sk-ant-[A-Za-z0-9_\-]{20,})/, severity: "critical" },
  { id: "openai-key", name: "OpenAI API key", pattern: /\b(sk-(?:proj-)?[A-Za-z0-9_\-]{32,})\b/, severity: "high", check: (s) => !s.startsWith("sk-ant-") },
  { id: "slack-token", name: "Slack token", pattern: /\b(xox[baprs]-[0-9A-Za-z-]{10,})\b/, severity: "high" },
  { id: "google-api-key", name: "Google API key", pattern: /\b(AIza[0-9A-Za-z_\-]{35})\b/, severity: "high" },
  {
    id: "db-url-password",
    name: "Database URL with a password",
    pattern: /\b(?:postgres(?:ql)?|mysql|mongodb(?:\+srv)?|redis|amqp):\/\/[^\s:@\/'"`]+:([^\s@\/'"`]{3,})@/,
    severity: "high",
    check: (s) => !PLACEHOLDER.test(s),
  },
  {
    id: "hardcoded-secret",
    name: "Hard-coded password or key",
    pattern: /(?:password|passwd|secret|api[_-]?key|access[_-]?token|auth[_-]?token|private[_-]?key)["']?\s*[:=]\s*["'`]([^"'`\s]{12,})["'`]/i,
    severity: "moderate",
    check: (s) => !PLACEHOLDER.test(s) && entropy(s) >= 3.5 && !s.includes("process.env"),
  },
];

const SKIP_FILE = /(^|\/)(node_modules|dist|build|coverage|\.next|vendor)\/|\.(png|jpe?g|gif|webp|ico|pdf|zip|gz|woff2?|ttf|mp4|lock)$|(^|\/)(package-lock\.json|pnpm-lock\.yaml|yarn\.lock)$|\.min\.js$/;
const ENV_FILE = /(^|\/)\.env(\.[\w-]+)?$/;
const ENV_EXAMPLE = /\.(example|sample|template|dist)$/;

export function scanText(file: string, text: string, startLine = 1, lineNumbers?: number[]): Finding[] {
  const out: Finding[] = [];
  const lines = text.split("\n");
  lines.forEach((line, i) => {
    if (line.length > 2000 || /byte-ignore-secret/.test(line)) return;
    for (const rule of SECRET_RULES) {
      const m = rule.pattern.exec(line);
      if (!m) continue;
      const secret = m[1] ?? m[0];
      if (rule.check && !rule.check(secret, line)) continue;
      // Passwords and database URLs inside tests are usually fixtures; real key formats still count
      if ((rule.id === "hardcoded-secret" || rule.id === "db-url-password") && isTestPath(file)) continue;
      const lineNo = lineNumbers ? lineNumbers[i] : startLine + i;
      out.push({
        id: shortId("secret", rule.id, file, secret),
        category: "secrets",
        severity: rule.severity,
        title: `${rule.name} in code`,
        file,
        line: lineNo,
        detail: rule.id === "private-key" ? "-----BEGIN ... PRIVATE KEY-----" : mask(secret),
        fix:
          rule.severity === "critical" || rule.severity === "high"
            ? "Rotate this key at the provider now, move it to an environment variable, then remove it from git history."
            : "Move it to an environment variable.",
      });
      break; // one finding per line is enough
    }
  });
  return out;
}

export function isScannable(file: string): boolean {
  return !SKIP_FILE.test(file);
}

/** Scans the current files in the repo. */
export function scanWorkingTree(root: string, files: string[]): Finding[] {
  const out: Finding[] = [];
  for (const file of files) {
    if (ENV_FILE.test(file) && !ENV_EXAMPLE.test(file)) {
      out.push({
        id: shortId("env-file", file),
        category: "secrets",
        severity: "high",
        title: "Environment file is tracked by git",
        file,
        fix: `Remove it with "git rm --cached ${file}", add it to .gitignore, and rotate anything inside it.`,
      });
    }
    if (!isScannable(file)) continue;
    const full = path.join(root, file);
    let stat: fs.Stats;
    try {
      stat = fs.statSync(full);
    } catch {
      continue;
    }
    if (!stat.isFile() || stat.size > 1024 * 1024) continue;
    const text = fs.readFileSync(full, "utf8");
    if (text.includes("\u0000")) continue; // binary
    out.push(...scanText(file, text));
  }
  return out;
}

/** Added lines in staged changes only, so old secrets in a touched file don't block every commit. */
export function stagedAddedLines(root: string): { file: string; lines: string[]; numbers: number[] }[] {
  const diff = execFileSync("git", ["diff", "--cached", "-U0", "--no-color", "--no-ext-diff"], { cwd: root, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
  const result: { file: string; lines: string[]; numbers: number[] }[] = [];
  let current: { file: string; lines: string[]; numbers: number[] } | null = null;
  let lineNo = 0;
  for (const raw of diff.split("\n")) {
    if (raw.startsWith("+++ ")) {
      const name = raw.slice(4).replace(/^b\//, "");
      current = name === "/dev/null" ? null : { file: name, lines: [], numbers: [] };
      if (current) result.push(current);
    } else if (raw.startsWith("@@")) {
      const m = /\+(\d+)/.exec(raw);
      lineNo = m ? Number(m[1]) : 0;
    } else if (raw.startsWith("+") && current) {
      current.lines.push(raw.slice(1));
      current.numbers.push(lineNo++);
    }
  }
  return result;
}

export function scanStaged(root: string): Finding[] {
  const out: Finding[] = [];
  const staged = execFileSync("git", ["diff", "--cached", "--name-only", "--diff-filter=A"], { cwd: root, encoding: "utf8" })
    .split("\n")
    .filter(Boolean);
  for (const file of staged) {
    if (ENV_FILE.test(file) && !ENV_EXAMPLE.test(file)) {
      out.push({
        id: shortId("env-file", file),
        category: "secrets",
        severity: "high",
        title: "You're about to commit an environment file",
        file,
        fix: `Unstage it with "git restore --staged ${file}" and add it to .gitignore.`,
      });
    }
  }
  for (const chunk of stagedAddedLines(root)) {
    if (!isScannable(chunk.file)) continue;
    out.push(...scanText(chunk.file, chunk.lines.join("\n"), 1, chunk.numbers));
  }
  return out;
}

/** Recent history: secrets deleted later are still in git and still usable. */
export function scanHistory(root: string, maxCommits = 300): Finding[] {
  let log = "";
  try {
    log = execFileSync("git", ["log", `-n${maxCommits}`, "-p", "-U0", "--no-color", "--format=commit %H"], {
      cwd: root,
      encoding: "utf8",
      maxBuffer: 256 * 1024 * 1024,
    });
  } catch {
    return [];
  }
  const out: Finding[] = [];
  const seen = new Set<string>();
  let commit = "";
  let file = "";
  for (const raw of log.split("\n")) {
    if (raw.startsWith("commit ")) commit = raw.slice(7, 14);
    else if (raw.startsWith("+++ ")) file = raw.slice(4).replace(/^b\//, "");
    else if (raw.startsWith("+") && file && isScannable(file)) {
      for (const f of scanText(file, raw.slice(1))) {
        if (seen.has(f.id)) continue;
        seen.add(f.id);
        out.push({ ...f, line: undefined, title: f.title.replace("in code", "in git history"), detail: `${f.detail}, commit ${commit}` });
      }
    }
  }
  return out;
}

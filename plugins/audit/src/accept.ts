import fs from "node:fs";
import path from "node:path";

export const ACCEPT_FILE = ".byte/audit-accepted.json";

export interface Accepted {
  version: 1;
  entries: Record<string, { reason: string; title: string; at: string }>;
}

export function loadAccepted(root: string): Accepted {
  try {
    const raw = JSON.parse(fs.readFileSync(path.join(root, ACCEPT_FILE), "utf8"));
    if (raw.version === 1) return raw;
  } catch {}
  return { version: 1, entries: {} };
}

export function saveAccepted(root: string, accepted: Accepted): void {
  const file = path.join(root, ACCEPT_FILE);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(accepted, null, 2) + "\n");
}

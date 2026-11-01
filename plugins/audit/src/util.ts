import { createHash } from "node:crypto";

export function shortId(...parts: (string | number | undefined)[]): string {
  return createHash("sha1").update(parts.map((p) => String(p ?? "")).join("|")).digest("hex").slice(0, 8);
}

/** Shows just enough of a secret to recognise it: sk_l••••4f2a */
export function mask(secret: string): string {
  if (secret.length <= 10) return secret.slice(0, 2) + "\u2022\u2022\u2022\u2022";
  return secret.slice(0, 4) + "\u2022\u2022\u2022\u2022" + secret.slice(-4);
}

/** Shannon entropy in bits per character: random keys score high, words score low. */
export function entropy(s: string): number {
  const counts = new Map<string, number>();
  for (const ch of s) counts.set(ch, (counts.get(ch) ?? 0) + 1);
  let h = 0;
  for (const n of counts.values()) {
    const p = n / s.length;
    h -= p * Math.log2(p);
  }
  return h;
}

export const isTestPath = (p: string) => /\.(test|spec)\.[a-z]+$/.test(p) || /(^|\/)(__tests__|__mocks__|tests?|spec|fixtures)\//.test(p);

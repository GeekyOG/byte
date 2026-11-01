import { createHash } from "node:crypto";
import picomatch from "picomatch";
import type { FileFacts, PatternsConfig, Violation } from "./types";

export type LayerOf = (file: string) => string | null;

export function layerMatcher(layers: Record<string, string>): LayerOf {
  const matchers = Object.entries(layers).map(([name, glob]) => [name, picomatch(glob, { dot: true })] as const);
  return (file) => matchers.find(([, isMatch]) => isMatch(file))?.[0] ?? null;
}

function fingerprint(rule: string, file: string, detail: string): string {
  return createHash("sha1").update(`${rule}|${file}|${detail}`).digest("hex").slice(0, 16);
}

/** Checks the given files against every rule. Only facts for these files are needed. */
export function checkFiles(config: PatternsConfig, facts: FileFacts[]): Violation[] {
  const layerOf = layerMatcher(config.layers);
  const out: Violation[] = [];

  for (const f of facts) {
    const fileLayer = layerOf(f.path);
    for (const rule of config.rules) {
      if (rule.type === "forbid-import") {
        if (fileLayer !== rule.from) continue;
        for (const imp of f.imports) {
          if (!imp.resolved || layerOf(imp.resolved) !== rule.to) continue;
          out.push({
            rule: rule.id,
            file: f.path,
            line: imp.line,
            message: rule.message ?? `${cap(rule.from)} must not import ${rule.to} directly ("${imp.spec}")`,
            fix: `Use the layer that talks to ${rule.to} instead, the way the rest of ${rule.from} does.`,
            fingerprint: fingerprint(rule.id, f.path, imp.spec),
          });
        }
      } else if (rule.type === "must-implement") {
        if (!picomatch.isMatch(f.path, rule.files, { dot: true })) continue;
        for (const cls of f.classes) {
          if (cls.implements.includes(rule.interface)) continue;
          out.push({
            rule: rule.id,
            file: f.path,
            line: cls.line,
            message: rule.message ?? `${cls.name} does not implement ${rule.interface}`,
            fix: `Change it to: class ${cls.name} implements ${rule.interface}`,
            fingerprint: fingerprint(rule.id, f.path, cls.name),
          });
        }
      } else if (rule.type === "forbid-package") {
        if (rule.files && !picomatch.isMatch(f.path, rule.files, { dot: true })) continue;
        for (const imp of f.imports) {
          if (!imp.pkg || !rule.packages.includes(imp.pkg)) continue;
          out.push({
            rule: rule.id,
            file: f.path,
            line: imp.line,
            message: rule.message ?? `"${imp.pkg}" is not used in this codebase`,
            fix: rule.message ? rule.message : `Use the existing alternative instead of ${imp.pkg}.`,
            fingerprint: fingerprint(rule.id, f.path, imp.pkg),
          });
        }
      }
    }
  }
  return out;
}

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

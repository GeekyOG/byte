import path from "node:path";
import { layerMatcher } from "./check";
import type { FileFacts, Rule } from "./types";

export interface SuggestionOption {
  label: string;
  rules: Rule[];
}

export interface Suggestion {
  id: string;
  confidence: "high" | "mixed";
  title: string;
  evidence: string;
  options: SuggestionOption[]; // first option is the recommended one
}

export interface Discovery {
  layers: Record<string, string>;
  suggestions: Suggestion[];
  filesScanned: number;
}

const SOURCE_ROOTS = new Set(["src", "app", "lib", "server", "api", "source"]);
const TEST_DIRS = /(^|\/)(__tests__|__mocks__|tests?|spec|e2e|fixtures)(\/|$)/;
const TEST_FILE = /\.(test|spec)\.[a-z]+$/;

const PACKAGE_GROUPS: { topic: string; packages: string[] }[] = [
  { topic: "HTTP requests", packages: ["axios", "node-fetch", "got", "ky", "superagent", "undici"] },
  { topic: "Dates", packages: ["moment", "dayjs", "date-fns", "luxon"] },
  { topic: "Utility helpers", packages: ["lodash", "underscore", "ramda"] },
  { topic: "Validation", packages: ["zod", "yup", "joi", "class-validator"] },
];

export function isTestFile(p: string): boolean {
  return TEST_FILE.test(p) || TEST_DIRS.test(p);
}

/** src/controllers/user.ts -> src/controllers ; utils/date.ts -> utils */
function layerDir(file: string): string | null {
  const parts = file.split("/");
  if (parts.length < 2) return null;
  if (SOURCE_ROOTS.has(parts[0])) return parts.length >= 3 ? `${parts[0]}/${parts[1]}` : null;
  return parts[0];
}

export function detectLayers(files: string[]): Record<string, string> {
  const counts = new Map<string, number>();
  for (const f of files) {
    const dir = layerDir(f);
    if (dir) counts.set(dir, (counts.get(dir) ?? 0) + 1);
  }
  const layers: Record<string, string> = {};
  for (const [dir, n] of [...counts].sort()) {
    if (n < 3) continue;
    let name = path.posix.basename(dir);
    if (layers[name]) name = dir.replace(/\//g, "-");
    layers[name] = `${dir}/**`;
  }
  return layers;
}

const pct = (a: number, b: number) => Math.round((a / b) * 100);

export function discover(facts: FileFacts[]): Discovery {
  const code = facts.filter((f) => !isTestFile(f.path));
  const layers = detectLayers(code.map((f) => f.path));
  const layerOf = layerMatcher(layers);
  const names = Object.keys(layers);
  const suggestions: Suggestion[] = [];

  // Import matrix between layers: files in A that import B
  const filesIn: Record<string, number> = {};
  const importers: Record<string, Set<string>> = {};
  const edges: Record<string, number> = {};
  for (const f of code) {
    const a = layerOf(f.path);
    if (!a) continue;
    filesIn[a] = (filesIn[a] ?? 0) + 1;
    const targets = new Set(f.imports.map((i) => (i.resolved ? layerOf(i.resolved) : null)).filter((b): b is string => !!b && b !== a));
    for (const b of targets) {
      const key = `${a}->${b}`;
      (importers[key] ??= new Set()).add(f.path);
      edges[key] = (edges[key] ?? 0) + 1;
    }
  }
  const e = (a: string, b: string) => edges[`${a}->${b}`] ?? 0;

  // "A reaches B only through C": a classic layering rule nobody wrote down
  for (const a of names) {
    const total = filesIn[a] ?? 0;
    if (total < 4) continue;
    for (const b of names) {
      if (a === b) continue;
      const via = names.find((c) => c !== a && c !== b && e(a, c) >= 2 && e(c, b) >= 2);
      if (!via) continue;
      const direct = e(a, b);
      const rule: Rule = { id: `no-${a}-to-${b}`, type: "forbid-import", from: a, to: b, message: `${cap(a)} should reach ${b} through ${via}` };
      if (direct === 0) {
        suggestions.push({
          id: rule.id,
          confidence: "high",
          title: `${cap(a)} never import ${b} directly`,
          evidence: `0 of ${total} files in ${a} import ${b}; they go through ${via}`,
          options: [{ label: "Keep", rules: [rule] }, { label: "Skip", rules: [] }],
        });
      } else if (pct(direct, total) <= 25) {
        suggestions.push({
          id: rule.id,
          confidence: "mixed",
          title: `${cap(a)} importing ${b}`,
          evidence: `${direct} of ${total} files in ${a} import ${b} directly; the rest go through ${via}`,
          options: [
            { label: `Enforce for new code (existing ${direct} go in the baseline)`, rules: [rule] },
            { label: "Don't enforce", rules: [] },
          ],
        });
      }
    }
  }

  // Classes in a folder that share an interface
  const byDir = new Map<string, { name: string; implements: string[] }[]>();
  for (const f of code) {
    for (const c of f.classes) {
      const dir = path.posix.dirname(f.path);
      byDir.set(dir, [...(byDir.get(dir) ?? []), c]);
    }
  }
  for (const [dir, classes] of byDir) {
    if (classes.length < 3) continue;
    const freq = new Map<string, number>();
    for (const c of classes) for (const i of c.implements) freq.set(i, (freq.get(i) ?? 0) + 1);
    const top = [...freq].sort((x, y) => y[1] - x[1])[0];
    if (!top) continue;
    const [iface, k] = top;
    const rule: Rule = { id: `${path.posix.basename(dir)}-implement-${iface}`.toLowerCase(), type: "must-implement", files: `${dir}/**`, interface: iface };
    if (k === classes.length) {
      suggestions.push({
        id: rule.id,
        confidence: "high",
        title: `Classes in ${dir}/ implement ${iface}`,
        evidence: `${k} of ${k} classes do`,
        options: [{ label: "Keep", rules: [rule] }, { label: "Skip", rules: [] }],
      });
    } else if (pct(k, classes.length) >= 60) {
      suggestions.push({
        id: rule.id,
        confidence: "mixed",
        title: `Classes in ${dir}/ and ${iface}`,
        evidence: `${k} of ${classes.length} classes implement it`,
        options: [
          { label: "Enforce for new code", rules: [rule] },
          { label: "Don't enforce", rules: [] },
        ],
      });
    }
  }

  // Two libraries doing the same job
  for (const group of PACKAGE_GROUPS) {
    const users = group.packages
      .map((p) => ({ p, n: code.filter((f) => f.imports.some((i) => i.pkg === p)).length }))
      .filter((u) => u.n > 0)
      .sort((x, y) => y.n - x.n);
    if (users.length < 2) continue;
    const total = users.reduce((s, u) => s + u.n, 0);
    suggestions.push({
      id: `one-${group.topic.toLowerCase().replace(/\W+/g, "-")}-library`,
      confidence: "mixed",
      title: group.topic,
      evidence: users.map((u) => `${pct(u.n, total)}% use ${u.p}`).join(", "),
      options: [
        ...users.map((u) => ({
          label: `Use ${u.p} everywhere`,
          rules: [
            {
              id: `use-${u.p}`,
              type: "forbid-package" as const,
              packages: users.filter((o) => o.p !== u.p).map((o) => o.p),
              message: `Use ${u.p} for ${group.topic.toLowerCase()}`,
            },
          ],
        })),
        { label: "Don't enforce", rules: [] },
      ],
    });
  }

  suggestions.sort((x, y) => (x.confidence === y.confidence ? 0 : x.confidence === "high" ? -1 : 1));
  return { layers, suggestions, filesScanned: facts.length };
}

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

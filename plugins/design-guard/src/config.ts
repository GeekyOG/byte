import fs from "node:fs";
import path from "node:path";
import YAML from "yaml";
import type { PatternsConfig, Rule } from "./types";

export const CONFIG_FILE = "byte.patterns.yml";

export function loadConfig(root: string): PatternsConfig | null {
  const file = path.join(root, CONFIG_FILE);
  if (!fs.existsSync(file)) return null;
  return parseConfig(fs.readFileSync(file, "utf8"));
}

export function parseConfig(text: string): PatternsConfig {
  const raw = YAML.parse(text) ?? {};
  const layers: Record<string, string> = {};
  for (const [name, glob] of Object.entries(raw.layers ?? {})) {
    if (typeof glob !== "string") throw new Error(`Layer "${name}" needs a glob, like src/${name}/**`);
    layers[name] = glob;
  }
  const rules: Rule[] = [];
  for (const r of raw.rules ?? []) {
    if (!r?.id || !r?.type) throw new Error("Every rule needs an id and a type.");
    if (r.type === "forbid-import") {
      for (const key of ["from", "to"]) {
        if (!layers[r[key]]) throw new Error(`Rule ${r.id}: unknown layer "${r[key]}".`);
      }
    } else if (r.type === "must-implement") {
      if (!r.files || !r.interface) throw new Error(`Rule ${r.id}: needs files and interface.`);
    } else if (r.type === "forbid-package") {
      if (!Array.isArray(r.packages) || !r.packages.length) throw new Error(`Rule ${r.id}: needs a packages list.`);
    } else {
      throw new Error(`Rule ${r.id}: unknown type "${r.type}".`);
    }
    rules.push(r as Rule);
  }
  const secrets = raw.secrets === "warn" ? "warn" : "block";
  return { version: 1, layers, rules, block: Boolean(raw.block), secrets, conventions: raw.conventions };
}

export function stringifyConfig(config: PatternsConfig): string {
  const header = [
    "# Byte design rules. Byte checks every commit against these.",
    "# Edit freely: add layers, remove rules, or set block: true to stop commits with new warnings.",
    "# secrets: block stops commits that add a password or API key (warn = just tell me).",
    "",
  ].join("\n");
  const body: Record<string, unknown> = { layers: config.layers, rules: config.rules, block: config.block ?? false, secrets: config.secrets ?? "block" };
  if (config.conventions) body.conventions = config.conventions;
  return header + YAML.stringify(body);
}

export type Rule =
  | { id: string; type: "forbid-import"; from: string; to: string; message?: string }
  | { id: string; type: "must-implement"; files: string; interface: string; message?: string }
  | { id: string; type: "forbid-package"; packages: string[]; files?: string; message?: string };

export interface PatternsConfig {
  version: 1;
  layers: Record<string, string>; // layer name -> glob, e.g. controllers: src/controllers/**
  rules: Rule[];
  block?: boolean; // true = stop the commit when there are new warnings
  secrets?: "block" | "warn"; // what to do when a commit adds a secret (default: block)
  conventions?: string; // free text, used later by the AI review
}

export interface ImportFact {
  spec: string; // as written: "../db", "axios"
  line: number;
  resolved: string | null; // repo-relative file for relative imports
  pkg: string | null; // package name for bare imports
}

export interface ClassFact {
  name: string;
  line: number;
  implements: string[];
}

export interface FileFacts {
  path: string; // repo-relative, forward slashes
  imports: ImportFact[];
  classes: ClassFact[];
}

export interface Violation {
  rule: string;
  file: string;
  line: number;
  message: string;
  fix: string;
  fingerprint: string; // stable across line moves, used by the baseline
}

export interface ChangedFile {
  path: string;
  status: "A" | "M" | "D" | "R";
  layer: string | null;
}

export interface Introduced {
  kind: "package" | "folder";
  name: string;
  note: string;
}

export interface GuardReport {
  createdAt: string;
  changed: ChangedFile[];
  introduced: Introduced[];
  warnings: Violation[]; // new, not in the baseline
  baselined: number; // old violations in changed files that were ignored
  fixed: { rule: string; file: string }[]; // baseline entries that disappeared
  hasConfig: boolean;
}

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { describe, expect, it } from "vitest";
import { applyTestSetup, detectTests, installPostCommitHook, installPreCommitHook, setupProgress } from "@byte/signals";

function project(pkg: object | string) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "byte-proj-"));
  fs.writeFileSync(path.join(root, "package.json"), typeof pkg === "string" ? pkg : JSON.stringify(pkg, null, 2));
  return root;
}

describe("detectTests", () => {
  it("finds vitest and jest and plans a safe change", () => {
    expect(detectTests(project({ scripts: { test: "vitest run" }, devDependencies: { vitest: "2" } }))).toMatchObject({
      runner: "vitest",
      configured: false,
      newScript: "vitest run --reporter=default --reporter=json --outputFile=vitest-report.json",
    });
    expect(detectTests(project({ scripts: { test: "npx jest --runInBand" } })).newScript).toBe("npx jest --runInBand --json --outputFile=jest-results.json");
  });

  it("knows when it's already set up, and won't touch custom scripts", () => {
    expect(detectTests(project({ scripts: { test: "jest --json --outputFile=out.json" } })).configured).toBe(true);
    const custom = detectTests(project({ scripts: { test: "npm run lint && jest" }, devDependencies: { jest: "29" } }));
    expect(custom).toMatchObject({ runner: "jest", newScript: null, flags: "--json --outputFile=jest-results.json" });
    expect(detectTests(project({ scripts: { test: "mocha" } })).runner).toBeNull();
  });

  it("keeps the file's indentation and ignores the report file", () => {
    const root = project('{\n    "scripts": {\n        "test": "vitest run"\n    }\n}\n');
    applyTestSetup(root);
    const text = fs.readFileSync(path.join(root, "package.json"), "utf8");
    expect(text).toContain('\n        "test": "vitest run --reporter=default');
    expect(text.endsWith("}\n")).toBe(true);
    expect(fs.readFileSync(path.join(root, ".gitignore"), "utf8")).toBe("vitest-report.json\n");
    expect(detectTests(root).configured).toBe(true);
  });
});

describe("setupProgress", () => {
  it("tracks each setup step", () => {
    const root = project({ scripts: { test: "vitest run" }, devDependencies: { vitest: "2" } });
    execFileSync("git", ["init", "-q"], { cwd: root });
    expect(setupProgress(root)).toEqual({ hooks: false, rules: false, tests: false, audit: false });
    installPreCommitHook(root, "/x/byte.js");
    installPostCommitHook(root, "/x/byte.js");
    applyTestSetup(root);
    expect(setupProgress(root)).toEqual({ hooks: true, rules: false, tests: true, audit: false });
  });
});

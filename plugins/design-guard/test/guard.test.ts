import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import {
  analyzeRepo,
  analyzeSource,
  baselineFrom,
  checkRepo,
  checkStaged,
  discover,
  formatReport,
  parseConfig,
  saveBaseline,
  stringifyConfig,
  type PatternsConfig,
} from "@byte/design-guard";

let root: string;
const git = (...args: string[]) => execFileSync("git", args, { cwd: root, stdio: "ignore" });
const write = (file: string, text: string) => {
  fs.mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
  fs.writeFileSync(path.join(root, file), text);
};

function seedRepo() {
  write("package.json", JSON.stringify({ name: "shop", dependencies: { got: "1.0.0" } }));
  for (const name of ["user", "order", "cart", "product", "refund"]) {
    write(`src/controllers/${name}.controller.ts`, `import { ${name}Service } from "../services/${name}.service";\nexport const handle = () => ${name}Service();\n`);
    write(`src/services/${name}.service.ts`, `import { ${name}Repo } from "../repositories/${name}.repo";\nexport const ${name}Service = () => ${name}Repo();\n`);
    write(`src/repositories/${name}.repo.ts`, `import { db } from "../db/client";\nexport const ${name}Repo = () => db;\n`);
  }
  write("src/db/client.ts", "export const db = {};\n");
  write("src/db/schema.ts", "export const schema = {};\n");
  write("src/db/migrate.ts", "export const migrate = () => {};\n");
  write("src/gateways/types.ts", "export interface PaymentGateway { charge(): void }\n");
  for (const g of ["Flutterwave", "Stripe", "Monnify"]) {
    write(`src/gateways/${g.toLowerCase()}.ts`, `import type { PaymentGateway } from "./types";\nexport class ${g}Gateway implements PaymentGateway { charge() {} }\n`);
  }
  write("src/lib/http.ts", `import got from "got";\nexport const http = got;\n`);
  write("src/lib/a.ts", `import got from "got";\nexport const a = got;\n`);
  write("src/lib/b.ts", `import axios from "axios";\nexport const b = axios;\n`);
  git("init", "-q");
  git("config", "user.email", "t@t.t");
  git("config", "user.name", "t");
  git("add", ".");
  git("commit", "-qm", "seed");
}

function acceptHigh(alsoMixed = false): PatternsConfig {
  const d = discover(analyzeRepo(root));
  const rules = d.suggestions
    .filter((s) => s.confidence === "high" || (alsoMixed && s.id.startsWith("no-")))
    .flatMap((s) => s.options[0].rules);
  return { version: 1, layers: d.layers, rules };
}

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "byte-guard-"));
  seedRepo();
});

describe("analyzeSource", () => {
  it("finds imports, requires, aliases and implemented interfaces", () => {
    const files = new Set(["src/db/client.ts", "src/lib/http.ts"]);
    const facts = analyzeSource(
      "src/x/y.ts",
      `import a from "../db/client";\nconst h = require("@/lib/http");\nimport z from "zod";\nclass P implements Gateway, Other {}\n`,
      files,
    );
    expect(facts.imports.map((i) => [i.resolved, i.pkg])).toEqual([
      ["src/db/client.ts", null],
      ["src/lib/http.ts", null],
      [null, "zod"],
    ]);
    expect(facts.classes[0]).toMatchObject({ name: "P", line: 4, implements: ["Gateway", "Other"] });
  });
});

describe("discover", () => {
  it("finds unwritten rules in an existing codebase", () => {
    const d = discover(analyzeRepo(root));
    expect(d.layers).toMatchObject({ controllers: "src/controllers/**", db: "src/db/**" });
    const byId = Object.fromEntries(d.suggestions.map((s) => [s.id, s]));
    expect(byId["no-controllers-to-repositories"]).toMatchObject({ confidence: "high" });
    expect(byId["no-services-to-db"]).toMatchObject({ confidence: "high" });
    expect(byId["gateways-implement-paymentgateway"]).toMatchObject({ confidence: "high", evidence: "3 of 3 classes do" });
    expect(byId["one-http-requests-library"]).toMatchObject({ confidence: "mixed" });
  });
});

describe("config", () => {
  it("round-trips through YAML", () => {
    const config = acceptHigh();
    expect(parseConfig(stringifyConfig(config)).rules).toEqual(config.rules);
  });

  it("explains broken config clearly", () => {
    expect(() => parseConfig("layers:\n  a: src/a/**\nrules:\n  - id: x\n    type: forbid-import\n    from: a\n    to: b\n")).toThrow(/unknown layer "b"/);
  });
});

describe("checkStaged", () => {
  it("reports what changed, what was introduced, and new warnings", () => {
    const config = acceptHigh();
    write("byte.patterns.yml", stringifyConfig(config));
    saveBaseline(root, baselineFrom(checkRepo(root, config)));
    git("add", ".");
    git("commit", "-qm", "rules");

    write("src/controllers/payout.controller.ts", `import { payoutRepo } from "../repositories/user.repo";\nexport const x = payoutRepo;\n`);
    write("src/gateways/paystack.ts", `export class PaystackClient { charge() {} }\n`);
    write("src/webhooks/paystack.ts", `export const hook = 1;\n`);
    write("package.json", JSON.stringify({ name: "shop", dependencies: { got: "1.0.0", axios: "1.0.0" } }));
    git("add", ".");

    const r = checkStaged(root);
    expect(r.warnings.map((w) => [w.rule, w.file, w.line])).toEqual([
      ["no-controllers-to-repositories", "src/controllers/payout.controller.ts", 1],
      ["gateways-implement-paymentgateway", "src/gateways/paystack.ts", 1],
    ]);
    expect(r.introduced).toEqual(
      expect.arrayContaining([
        { kind: "package", name: "axios", note: "new dependency in package.json" },
        { kind: "folder", name: "src/webhooks/", note: "not part of any layer" },
      ]),
    );
    expect(r.changed.find((c) => c.path.includes("payout"))).toMatchObject({ status: "A", layer: "controllers" });
    expect(formatReport(r, false)).toContain("Byte design guard: 2 warnings, 2 new things.");
  });

  it("ignores old problems in the baseline and notices when they get fixed", () => {
    // An existing violation before rules are added
    write("src/controllers/legacy.controller.ts", `import { db } from "../repositories/user.repo";\nexport const y = db;\n`);
    git("add", ".");
    git("commit", "-qm", "legacy");
    // 1 of 6 controllers now breaks the pattern, so Byte calls it mixed; the team chooses to enforce it
    const mixed = discover(analyzeRepo(root)).suggestions.find((s) => s.id === "no-controllers-to-repositories");
    expect(mixed?.confidence).toBe("mixed");
    const config = acceptHigh(true);
    write("byte.patterns.yml", stringifyConfig(config));
    saveBaseline(root, baselineFrom(checkRepo(root, config)));
    git("add", ".");
    git("commit", "-qm", "rules");

    // Touch the legacy file without fixing it: no warning
    write("src/controllers/legacy.controller.ts", `import { db } from "../repositories/user.repo";\nexport const y = db; // touched\n`);
    git("add", ".");
    let r = checkStaged(root);
    expect(r.warnings).toHaveLength(0);
    expect(r.baselined).toBe(1);

    // Fix it: Byte notices
    write("src/controllers/legacy.controller.ts", `import { userService } from "../services/user.service";\nexport const y = userService;\n`);
    git("add", ".");
    r = checkStaged(root);
    expect(r.fixed).toEqual([{ rule: "no-controllers-to-repositories", file: "src/controllers/legacy.controller.ts" }]);
  });

  it("works without a config and suggests running init", () => {
    write("src/new.ts", "export const n = 1;\n");
    git("add", ".");
    const r = checkStaged(root);
    expect(r.hasConfig).toBe(false);
    expect(formatReport(r, false)).toContain("byte guard init");
  });
});

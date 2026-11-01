import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import {
  checkCertificateDays,
  checkHeaders,
  formatAudit,
  loadAccepted,
  mask,
  parseNpmAudit,
  runAudit,
  saveAccepted,
  scanRiskyCode,
  scanStaged,
  scanText,
  scoreFor,
  type Finding,
} from "@byte/audit";

// Built from pieces so this file never contains a real-looking key (GitHub push protection would block it)
const LIVE_KEY = "sk_" + "live_" + "4eC39HqLyjWDarjtT1zdp7dc9xQ2";
const GH_TOKEN = "ghp" + "_" + "a1B2c3D4e5F6g7H8i9J0k1L2m3N4o5P6q7R8";
const AWS = "AKIA" + "IOSFODNN7EXAMPLE";

let root: string;
const git = (...args: string[]) => execFileSync("git", args, { cwd: root, stdio: "ignore" });
const write = (file: string, text: string) => {
  fs.mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
  fs.writeFileSync(path.join(root, file), text);
};

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "byte-audit-"));
  git("init", "-q");
  git("config", "user.email", "t@t.t");
  git("config", "user.name", "t");
});

describe("secrets", () => {
  it("finds common keys and masks them", () => {
    const found = scanText("src/pay.ts", [`const key = "${LIVE_KEY}";`, `token: "${GH_TOKEN}"`, `aws = "${AWS}"`, `const url = "postgres://app:S3cretPassw0rd@db:5432/x"`].join("\n"));
    expect(found.map((f) => [f.title, f.severity, f.line])).toEqual([
      ["Paystack or Stripe live secret key in code", "critical", 1],
      ["GitHub token in code", "critical", 2],
      ["AWS access key in code", "critical", 3],
      ["Database URL with a password in code", "high", 4],
    ]);
    expect(found[0].detail).toBe(mask(LIVE_KEY));
    expect(found[0].detail).not.toContain(LIVE_KEY.slice(8, 20));
  });

  it("ignores placeholders, env lookups and low-entropy words", () => {
    const found = scanText("src/cfg.ts", [
      `const url = "postgres://user:password@localhost/db"`,
      `apiKey: process.env.API_KEY`,
      `password: "correcthorsebattery"`,
      `secret: "\${SECRET_FROM_VAULT}"`,
    ].join("\n"));
    expect(found).toEqual([]);
  });

  it("flags tracked .env files but not .env.example", async () => {
    write(".env", "X=1\n");
    write(".env.example", "X=\n");
    git("add", ".");
    const r = await runAudit(root, { dependencies: false });
    const env = r.findings.filter((f) => f.title.includes("Environment file"));
    expect(env.map((f) => f.file)).toEqual([".env"]);
  });

  it("checks only added lines when staging, so old secrets don't block every commit", () => {
    write("src/a.ts", `export const old = "${LIVE_KEY}";\n`);
    git("add", ".");
    git("commit", "-qm", "old");
    write("src/a.ts", `export const old = "${LIVE_KEY}";\nexport const n = 1;\n`);
    git("add", ".");
    expect(scanStaged(root)).toEqual([]);
    write("src/b.ts", `export const t = "${GH_TOKEN}";\n`);
    write(".env", "X=1\n");
    git("add", ".");
    const found = scanStaged(root);
    expect(found.map((f) => [f.file, f.line ?? null])).toEqual([
      [".env", null],
      ["src/b.ts", 1],
    ]);
  });

  it("finds secrets that were deleted but are still in history", async () => {
    write("src/a.ts", `export const k = "${AWS}";\n`);
    git("add", ".");
    git("commit", "-qm", "oops");
    write("src/a.ts", `export const k = process.env.K;\n`);
    git("add", ".");
    git("commit", "-qm", "fix");
    const now = await runAudit(root, { dependencies: false });
    expect(now.findings.filter((f) => f.category === "secrets")).toEqual([]);
    const withHistory = await runAudit(root, { dependencies: false, history: true });
    const hist = withHistory.findings.find((f) => f.title.includes("git history"));
    expect(hist?.detail).toMatch(/commit [0-9a-f]{7}/);
  });
});

describe("risky code", () => {
  const titles = (code: string, file = "src/x.ts") => scanRiskyCode(file, code).map((f) => f.title);

  it("catches injection patterns", () => {
    expect(titles("db.query(`SELECT * FROM users WHERE id = ${id}`)")).toEqual(["SQL query built with ${} (SQL injection risk)"]);
    expect(titles("db.query('SELECT * FROM users WHERE id = $1', [id])")).toEqual([]);
    expect(titles("sql`SELECT * FROM users WHERE id = ${id}`")).toEqual([]);
    expect(titles("exec(`convert ${file} out.png`)")).toEqual(["Shell command built from strings (command injection risk)"]);
    expect(titles("eval(input)")).toEqual(["eval() runs any string as code"]);
    expect(titles("el.innerHTML = userBio")).toEqual(["Setting innerHTML from data (XSS risk)"]);
    expect(titles("el.innerHTML = ''")).toEqual([]);
  });

  it("catches auth and transport mistakes", () => {
    expect(titles("app.use(cors({ origin: '*', credentials: true }))")).toEqual(["CORS allows any website to make logged-in requests"]);
    expect(titles("const p = jwt.decode(token)")).toEqual(["jwt.decode() doesn't check the signature"]);
    expect(titles("jwt.verify(t, k, { algorithms: ['HS256', 'none'] })")).toEqual(["JWT verify accepts the 'none' algorithm"]);
    expect(titles("https.request({ rejectUnauthorized: false })")).toEqual(["TLS certificate checks are turned off"]);
    expect(titles("crypto.createHash('md5').update(pw)")).toEqual(["MD5 is too weak for passwords or tokens"]);
    expect(titles("const resetToken = Math.random().toString(36)")).toEqual(["Math.random() used for a secret value"]);
  });

  it("works on TSX and skips test files", () => {
    expect(titles("export const A = () => <div dangerouslySetInnerHTML={{ __html: html }} />", "src/A.tsx")).toEqual(["dangerouslySetInnerHTML with data (XSS risk)"]);
    expect(titles("eval(x)", "src/x.test.ts")).toEqual([]);
  });
});

describe("packages", () => {
  it("reads npm audit output", () => {
    const json = JSON.stringify({
      vulnerabilities: {
        lodash: { severity: "high", range: "<4.17.21", via: [{ title: "Prototype Pollution" }], fixAvailable: true },
        minimist: { severity: "critical", range: "<1.2.6", via: ["mkdirp"], fixAvailable: { name: "mkdirp", version: "1.0.4", isSemVerMajor: true } },
      },
    });
    const f = parseNpmAudit(json);
    expect(f.map((x) => [x.title, x.severity])).toEqual([
      ["lodash: Prototype Pollution", "high"],
      ["minimist: known vulnerability", "critical"],
    ]);
    expect(f[1].fix).toContain("Update mkdirp to 1.0.4 (major version");
    expect(f[1].detail).toContain("comes in through another package");
  });
});

describe("live site", () => {
  it("checks HTTPS, headers and speed", () => {
    const f = checkHeaders("http://shop.example", { "x-powered-by": "Express" }, 200, 2400);
    const t = f.map((x) => x.title);
    expect(t).toContain("Site is served over plain HTTP");
    expect(t).toContain("Missing content-security-policy header");
    expect(t).toContain("X-Powered-By header reveals your server stack");
    expect(t).toContain("Slow response (2400 ms)");
    const good = checkHeaders("https://shop.example", {
      "strict-transport-security": "max-age=63072000",
      "content-security-policy": "default-src 'self'; frame-ancestors 'none'",
      "x-content-type-options": "nosniff",
      "referrer-policy": "strict-origin",
    }, 200, 300);
    expect(good).toEqual([]);
  });

  it("warns before the certificate expires", () => {
    const now = new Date("2026-10-20");
    expect(checkCertificateDays("https://a", new Date("2026-10-28"), now)[0].severity).toBe("high");
    expect(checkCertificateDays("https://a", new Date("2026-10-01"), now)[0].severity).toBe("critical");
    expect(checkCertificateDays("https://a", new Date("2027-03-01"), now)).toEqual([]);
  });
});

describe("score, health and accepted risks", () => {
  it("scores fairly and caps the cost of small issues", () => {
    const f = (severity: Finding["severity"]): Finding => ({ id: severity + Math.random(), category: "code", severity, title: "", fix: "" });
    expect(scoreFor([])).toBe(100);
    expect(scoreFor([f("critical"), f("high"), f("moderate")])).toBe(62);
    expect(scoreFor(Array.from({ length: 40 }, () => f("low")))).toBe(90);
    expect(scoreFor([f("critical"), f("critical"), f("critical"), f("critical"), f("critical")])).toBe(0);
  });

  it("runs the full audit, then hides a risk once it's accepted", async () => {
    write("package.json", JSON.stringify({ name: "x", main: "src/index.ts" }));
    write("src/index.ts", `import { pay } from "./pay";\npay();\n`);
    write("src/pay.ts", `export const pay = () => db.query(\`SELECT * FROM o WHERE id = \${id}\`);\nconst k = "${LIVE_KEY}";\n`);
    write("src/old.ts", "export const unused = 1;\n");
    write("src/big.ts", "export const a = 1;\n".repeat(600));
    git("add", ".");
    const r = await runAudit(root, { dependencies: false });
    const titles = r.findings.map((f) => f.title);
    expect(titles).toContain("Paystack or Stripe live secret key in code");
    expect(titles).toContain("SQL query built with ${} (SQL injection risk)");
    expect(titles).toContain("File isn't imported anywhere (maybe unused)");
    expect(titles.some((t) => t.startsWith("Very large file"))).toBe(true);
    expect(r.findings[0].severity).toBe("critical"); // worst first
    expect(r.score).toBe(100 - 25 - 10 - 3); // 2 low findings (unused files) + 1 low (big file)
    expect(formatAudit(r, false)).toContain("Health check: 62/100");

    const sql = r.findings.find((f) => f.title.startsWith("SQL"))!;
    const accepted = loadAccepted(root);
    accepted.entries[sql.id] = { reason: "internal admin tool, input is a number", title: sql.title, at: new Date().toISOString() };
    saveAccepted(root, accepted);
    const again = await runAudit(root, { dependencies: false });
    expect(again.findings.find((f) => f.id === sql.id)).toBeUndefined();
    expect(again.accepted).toBe(1);
    expect(again.score).toBe(r.score + 10);
  });
});

describe("fewer false alarms", () => {
  it("doesn't flag hashes used for ids, or strings that mention secrets in logs", () => {
    expect(scanRiskyCode("src/a.ts", `const id = createHash("sha1").update(file).digest("hex");`)).toEqual([]);
    expect(scanRiskyCode("src/a.ts", `const h = createHash("sha1").update(password).digest("hex");`).length).toBe(1);
    expect(scanRiskyCode("src/a.ts", `console.log("found a secret in", file);`)).toEqual([]);
    expect(scanRiskyCode("src/a.ts", `console.log(user.password);`).length).toBe(1);
  });

  it("treats database URLs in test files as fixtures", () => {
    expect(scanText("src/db.test.ts", `const url = "postgres://app:S3cretPassw0rd@db/x";`)).toEqual([]);
  });

  it("knows built entry points and script files aren't dead code", async () => {
    write("package.json", JSON.stringify({ name: "x", main: "dist/extension.js", scripts: { build: "node build.mjs" } }));
    write("src/extension.ts", "export const a = 1;\n");
    write("build.mjs", "console.log(1);\n");
    write("src/orphan.ts", "export const b = 1;\n");
    git("add", ".");
    const r = await runAudit(root, { dependencies: false });
    expect(r.findings.filter((f) => f.title.startsWith("File isn't")).map((f) => f.file)).toEqual(["src/orphan.ts"]);
  });
});

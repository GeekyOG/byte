import ts from "typescript";
import type { Finding, Severity } from "./types";
import { isTestPath, shortId } from "./util";

/**
 * Byte's own risky-code rules, written against the TypeScript syntax tree.
 * No Semgrep rules involved, so there are no license questions.
 */
export function scanRiskyCode(file: string, text: string): Finding[] {
  if (isTestPath(file)) return [];
  const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, file.endsWith("x") ? ts.ScriptKind.TSX : undefined);
  const out: Finding[] = [];
  const lineOf = (n: ts.Node) => source.getLineAndCharacterOfPosition(n.getStart(source)).line + 1;
  const add = (node: ts.Node, rule: string, severity: Severity, title: string, fix: string) =>
    out.push({ id: shortId("code", rule, file, node.getText(source).slice(0, 80)), category: "code", severity, title, file, line: lineOf(node), fix });

  const calleeName = (e: ts.Expression): string =>
    ts.isIdentifier(e) ? e.text : ts.isPropertyAccessExpression(e) ? e.name.text : "";
  const fullCallee = (e: ts.Expression): string => (ts.isPropertyAccessExpression(e) ? `${e.expression.getText(source)}.${e.name.text}` : calleeName(e));
  const isBuiltString = (e?: ts.Expression) =>
    !!e && ((ts.isTemplateExpression(e) && e.templateSpans.length > 0) || (ts.isBinaryExpression(e) && e.operatorToken.kind === ts.SyntaxKind.PlusToken));
  const propValue = (obj: ts.ObjectLiteralExpression, key: string) => {
    for (const p of obj.properties) {
      if (ts.isPropertyAssignment(p) && p.name.getText(source).replace(/["']/g, "") === key) return p.initializer;
    }
    return undefined;
  };
  const SECRET_NAME = /token|secret|password|passwd|otp|apikey|api_key|nonce/i;
  /** The whole statement a node sits in, to judge what a hash or random value is used for. */
  const statementText = (n: ts.Node): string => {
    let cur: ts.Node = n;
    while (cur.parent && !ts.isStatement(cur) && !ts.isSourceFile(cur.parent)) cur = cur.parent;
    return cur.getText(source);
  };

  const visit = (node: ts.Node) => {
    if (ts.isCallExpression(node)) {
      const name = calleeName(node.expression);
      const full = fullCallee(node.expression);
      const first = node.arguments[0];

      if (name === "eval" && ts.isIdentifier(node.expression)) {
        add(node, "eval", "high", "eval() runs any string as code", "Parse the data instead (JSON.parse) or use a lookup table.");
      }
      if ((name === "exec" || name === "execSync") && isBuiltString(first)) {
        add(node, "cmd-injection", "high", "Shell command built from strings (command injection risk)", "Use execFile/spawn with an argument array instead of one command string.");
      }
      if (["query", "raw", "execute", "$queryRawUnsafe", "$executeRawUnsafe", "unsafe"].includes(name) && first && ts.isTemplateExpression(first) && first.templateSpans.length) {
        const sqlish = /\b(select|insert|update|delete|where|from)\b/i.test(first.getText(source));
        if (sqlish) add(node, "sql-injection", "high", "SQL query built with ${} (SQL injection risk)", "Use query parameters ($1, ?) or a tagged sql`` template from your library.");
      }
      if (name === "cors" && first && ts.isObjectLiteralExpression(first)) {
        const origin = propValue(first, "origin");
        const creds = propValue(first, "credentials");
        const open = origin && ((ts.isStringLiteral(origin) && origin.text === "*") || origin.kind === ts.SyntaxKind.TrueKeyword);
        if (open && creds?.kind === ts.SyntaxKind.TrueKeyword) {
          add(node, "cors-open-creds", "high", "CORS allows any website to make logged-in requests", "List the allowed origins explicitly when credentials are on.");
        } else if (open) {
          add(node, "cors-open", "moderate", "CORS is open to every website", "List the origins that should be allowed.");
        }
      }
      if (full.endsWith("jwt.decode")) {
        add(node, "jwt-decode", "moderate", "jwt.decode() doesn't check the signature", "Use jwt.verify() with your secret before trusting the token.");
      }
      if (full.endsWith("jwt.verify")) {
        const opts = node.arguments[2];
        if (opts && ts.isObjectLiteralExpression(opts)) {
          const algs = propValue(opts, "algorithms");
          if (algs && /["']none["']/i.test(algs.getText(source))) add(node, "jwt-none", "critical", "JWT verify accepts the 'none' algorithm", "Remove 'none' and list only the algorithm you sign with.");
        }
      }
      if (name === "createHash" && first && ts.isStringLiteral(first) && /^(md5|sha1)$/i.test(first.text) && /password|passwd|pwd|\bpw\b|\bpass\b|token|secret|otp|credential/i.test(statementText(node))) {
        add(node, "weak-hash", "moderate", `${first.text.toUpperCase()} is too weak for passwords or tokens`, "For passwords use bcrypt or argon2; for other hashing use sha256.");
      }
      const namesSecret = (a: ts.Expression) =>
        (ts.isIdentifier(a) && SECRET_NAME.test(a.text)) || (ts.isPropertyAccessExpression(a) && SECRET_NAME.test(a.name.text));
      if (/^console\.(log|info|debug|warn|error)$/.test(full) && node.arguments.some(namesSecret)) {
        add(node, "log-secret", "low", "A password or token may be written to the logs", "Remove it from the log line, or log a masked version.");
      }
    }

    if (ts.isNewExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === "Function") {
      add(node, "new-function", "high", "new Function() runs strings as code", "Avoid building functions from strings.");
    }

    // el.innerHTML = something
    if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.EqualsToken && ts.isPropertyAccessExpression(node.left)) {
      const prop = node.left.name.text;
      if ((prop === "innerHTML" || prop === "outerHTML") && !ts.isStringLiteral(node.right) && !ts.isNoSubstitutionTemplateLiteral(node.right)) {
        add(node, "inner-html", "moderate", `Setting ${prop} from data (XSS risk)`, "Use textContent, or sanitise the HTML first (for example with DOMPurify).");
      }
      if (node.left.getText(source).endsWith("NODE_TLS_REJECT_UNAUTHORIZED")) {
        add(node, "tls-off", "high", "TLS certificate checks are turned off", "Remove this; fix the certificate instead.");
      }
    }
    if (ts.isJsxAttribute(node) && node.name.getText(source) === "dangerouslySetInnerHTML") {
      add(node, "dangerous-html", "moderate", "dangerouslySetInnerHTML with data (XSS risk)", "Sanitise the HTML first, or render it as text.");
    }
    if (ts.isPropertyAssignment(node) && node.name.getText(source).replace(/["']/g, "") === "rejectUnauthorized" && node.initializer.kind === ts.SyntaxKind.FalseKeyword) {
      add(node, "tls-off", "high", "TLS certificate checks are turned off", "Remove rejectUnauthorized: false; fix the certificate instead.");
    }
    // const token = Math.random()...
    if (ts.isVariableDeclaration(node) && node.initializer && SECRET_NAME.test(node.name.getText(source)) && /Math\.random\(\)/.test(node.initializer.getText(source))) {
      add(node, "weak-random", "moderate", "Math.random() used for a secret value", "Use crypto.randomBytes() or crypto.randomUUID().");
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return out;
}

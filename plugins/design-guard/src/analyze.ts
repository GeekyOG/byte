import path from "node:path";
import ts from "typescript";
import type { ClassFact, FileFacts, ImportFact } from "./types";

export const CODE_EXT = /\.(ts|tsx|js|jsx|mjs|cjs|mts|cts)$/;
const RESOLVE_EXT = [".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ".mts", ".cts"];

export function isCodeFile(p: string): boolean {
  return CODE_EXT.test(p) && !p.endsWith(".d.ts") && !p.includes("node_modules/");
}

export function packageName(spec: string): string | null {
  if (spec.startsWith(".") || spec.startsWith("/") || spec.startsWith("node:")) return null;
  const parts = spec.split("/");
  return spec.startsWith("@") ? parts.slice(0, 2).join("/") : parts[0];
}

/** Turns "./db" or "@/lib/http" into a repo file, using the list of files that exist. */
export function resolveImport(fromFile: string, spec: string, files: Set<string>, aliases: Record<string, string>): string | null {
  let base: string | null = null;
  if (spec.startsWith(".")) {
    base = path.posix.normalize(path.posix.join(path.posix.dirname(fromFile), spec));
  } else {
    for (const [prefix, target] of Object.entries(aliases)) {
      if (spec.startsWith(prefix)) base = path.posix.normalize(target + spec.slice(prefix.length));
    }
  }
  if (base === null) return null;
  const stripped = base.replace(/\.(js|jsx|mjs|cjs)$/, ""); // TS projects often import "./x.js"
  const candidates = [base, ...RESOLVE_EXT.map((e) => stripped + e), ...RESOLVE_EXT.map((e) => `${base}/index${e}`)];
  return candidates.find((c) => files.has(c)) ?? null;
}

export function analyzeSource(
  file: string,
  text: string,
  files: Set<string>,
  aliases: Record<string, string> = { "@/": "src/", "~/": "src/" },
): FileFacts {
  const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true);
  const imports: ImportFact[] = [];
  const classes: ClassFact[] = [];
  const lineOf = (node: ts.Node) => source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1;
  const addImport = (spec: string, node: ts.Node) => {
    const pkg = packageName(spec);
    imports.push({ spec, line: lineOf(node), pkg, resolved: resolveImport(file, spec, files, aliases) });
  };

  const visit = (node: ts.Node) => {
    if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) {
      addImport(node.moduleSpecifier.text, node);
    } else if (ts.isCallExpression(node) && node.arguments.length === 1 && ts.isStringLiteral(node.arguments[0])) {
      const isRequire = ts.isIdentifier(node.expression) && node.expression.text === "require";
      const isDynamic = node.expression.kind === ts.SyntaxKind.ImportKeyword;
      if (isRequire || isDynamic) addImport(node.arguments[0].text, node);
    } else if (ts.isClassDeclaration(node) && node.name) {
      const impl = (node.heritageClauses ?? [])
        .filter((h) => h.token === ts.SyntaxKind.ImplementsKeyword)
        .flatMap((h) => h.types.map((t) => t.expression.getText(source)));
      classes.push({ name: node.name.text, line: lineOf(node), implements: impl });
    }
    ts.forEachChild(node, visit);
  };
  visit(source);

  // An alias like "@/lib/http" looks like a package; if it resolved to a file, it's local
  for (const imp of imports) if (imp.resolved) imp.pkg = null;
  return { path: file, imports, classes };
}

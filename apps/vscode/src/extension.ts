import { execFile } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import * as vscode from "vscode";
import {
  FACES,
  applyEvent,
  loadState,
  moodFor,
  saveState,
  statePath,
  type PetEvent,
  type PetState,
} from "@byte/pet";
import type { GuardReport } from "@byte/design-guard";
import type { AuditReport } from "@byte/audit";
import { applyTestSetup, detectTests, installPostCommitHook, installPreCommitHook, parseTestReport, setupProgress } from "@byte/signals";
import { PetViewProvider } from "./panel";

let state: PetState;
let report: GuardReport | null = null;
let hasRules = false;
let audit: AuditReport | null = null;
let auditRunning = false;

function loadAuditReport() {
  const root = repoFolder();
  if (!root) return;
  try {
    audit = JSON.parse(fs.readFileSync(path.join(root, ".byte/audit.json"), "utf8"));
  } catch {
    audit = null;
  }
}

function repoFolder(): string | undefined {
  return vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
}

function loadGuard() {
  const root = repoFolder();
  if (!root) return;
  hasRules = fs.existsSync(path.join(root, "byte.patterns.yml"));
  try {
    report = JSON.parse(fs.readFileSync(path.join(root, ".byte/last-report.json"), "utf8"));
  } catch {
    report = null;
  }
}

export function activate(context: vscode.ExtensionContext) {
  state = loadState();
  loadGuard();
  loadAuditReport();
  const cli = context.asAbsolutePath("dist/byte.js");
  const provider = new PetViewProvider(
    () => state,
    () => ({ report, hasRules }),
    () => ({ report: audit, running: auditRunning }),
    () => {
      const root = repoFolder();
      try {
        return root ? setupProgress(root) : null;
      } catch {
        return null;
      }
    },
  );
  const WALKTHROUGH = `${context.extension.id}#getStarted`;
  const status = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
  status.command = "byte.show";
  status.show();

  const refresh = () => {
    const mood = moodFor(state, new Date());
    status.text = `${FACES[mood][0]} ${state.xp} XP`;
    status.tooltip = `${state.name} is ${mood.replace("-", " ")}. Health ${state.health}%`;
    provider.refresh();
  };

  const record = (event: PetEvent, announce = true) => {
    const result = applyEvent(loadState(event.at), event); // reload first: the CLI may have written
    state = result.state;
    saveState(state);
    refresh();
    if (announce && result.message) {
      if (result.evolvedTo) vscode.window.showInformationMessage(`Byte: ${result.message}`);
      else vscode.window.setStatusBarMessage(`Byte: ${result.message}`, 4000);
    }
  };

  // The CLI (git hook, `byte report`) writes the same state file, so pick up its changes
  const file = statePath();
  fs.watchFile(file, { interval: 1500 }, () => {
    state = loadState();
    refresh();
  });
  context.subscriptions.push({ dispose: () => fs.unwatchFile(file) });

  // Test reports written by Jest `--json --outputFile` or Vitest `--reporter=json --outputFile`
  const glob = vscode.workspace.getConfiguration("byte").get<string>("testReportGlob")!;
  const reports = vscode.workspace.createFileSystemWatcher(glob);
  const onReport = async (uri: vscode.Uri) => {
    if (uri.fsPath.includes("node_modules")) return;
    const text = Buffer.from(await vscode.workspace.fs.readFile(uri)).toString("utf8");
    const summary = parseTestReport(text);
    if (summary) record({ type: "tests", at: new Date(), ...summary });
  };
  reports.onDidCreate(onReport);
  reports.onDidChange(onReport);
  context.subscriptions.push(reports);

  // Design guard: the pre-commit hook (or a manual check) writes .byte/last-report.json
  const guardFiles = vscode.workspace.createFileSystemWatcher("{.byte/last-report.json,.byte/audit.json,byte.patterns.yml}");
  const onGuard = () => {
    loadGuard();
    loadAuditReport();
    refresh();
  };
  guardFiles.onDidCreate(onGuard);
  guardFiles.onDidChange(onGuard);
  guardFiles.onDidDelete(onGuard);
  context.subscriptions.push(guardFiles);

  // Errors in the Problems panel, counted after things settle for a few seconds
  let lintTimer: NodeJS.Timeout | undefined;
  context.subscriptions.push(
    vscode.languages.onDidChangeDiagnostics(() => {
      if (!vscode.workspace.getConfiguration("byte").get<boolean>("watchLint")) return;
      clearTimeout(lintTimer);
      lintTimer = setTimeout(() => {
        const errors = vscode.languages
          .getDiagnostics()
          .filter(([uri]) => vscode.workspace.getWorkspaceFolder(uri))
          .reduce((n, [, list]) => n + list.filter((d) => d.severity === vscode.DiagnosticSeverity.Error).length, 0);
        record({ type: "lint", at: new Date(), errors });
      }, 3000);
    }),
  );

  context.subscriptions.push(
    status,
    vscode.window.registerWebviewViewProvider("byte.pet", provider),
    vscode.commands.registerCommand("byte.show", () => vscode.commands.executeCommand("byte.pet.focus")),
    vscode.commands.registerCommand("byte.toggleVacation", () =>
      record({ type: "vacation", at: new Date(), on: !state.vacation }),
    ),
    vscode.commands.registerCommand("byte.installHook", () => {
      const root = repoFolder();
      if (!root) return vscode.window.showWarningMessage("Open a folder with a git repository first.");
      try {
        installPostCommitHook(root, cli);
        installPreCommitHook(root, cli);
        refresh();
        vscode.window.showInformationMessage("Byte will now check and react to every commit in this repo.");
      } catch (err) {
        vscode.window.showErrorMessage(`Byte couldn't install the hooks: ${(err as Error).message}`);
      }
    }),
    vscode.commands.registerCommand("byte.guardInit", () => {
      const root = repoFolder();
      if (!root) return vscode.window.showWarningMessage("Open a folder with a git repository first.");
      // Interactive questions, so it runs in a real terminal
      const term = vscode.window.createTerminal({ name: "Byte", cwd: root });
      term.show();
      term.sendText(`node "${cli}" guard init${hasRules ? " --force" : ""}`);
    }),
    vscode.commands.registerCommand("byte.guardCheck", () => {
      const root = repoFolder();
      if (!root) return;
      execFile("node", [cli, "guard", "check", "--json"], { cwd: root, maxBuffer: 16 * 1024 * 1024 }, (err, stdout) => {
        if (err && !stdout) return vscode.window.showErrorMessage(`Byte guard failed: ${err.message}`);
        loadGuard();
        refresh();
        const w = report?.warnings.length ?? 0;
        vscode.window.setStatusBarMessage(w ? `Byte: ${w} design warning${w > 1 ? "s" : ""}` : "Byte: design check all clear", 4000);
        vscode.commands.executeCommand("byte.pet.focus");
      });
    }),
    vscode.commands.registerCommand("byte.walkthrough", () =>
      vscode.commands.executeCommand("workbench.action.openWalkthrough", WALKTHROUGH, false),
    ),
    vscode.commands.registerCommand("byte.setupTests", async () => {
      const root = repoFolder();
      if (!root) return vscode.window.showWarningMessage("Open your project folder first.");
      const t = detectTests(root);
      if (!t.runner) return vscode.window.showInformationMessage("Byte reads Jest and Vitest results. Neither was found in this project.");
      if (t.configured) return vscode.window.showInformationMessage(`Byte can already read your ${t.runner} results.`);
      if (!t.newScript) {
        const pick = await vscode.window.showInformationMessage(
          `Your test script is custom, so Byte won't edit it. Add these flags to your ${t.runner} command: ${t.flags}`,
          "Copy flags",
        );
        if (pick) await vscode.env.clipboard.writeText(t.flags!);
        return;
      }
      const ok = await vscode.window.showInformationMessage(
        `Byte will change your "test" script so ${t.runner} also saves a report Byte can read.`,
        { modal: true, detail: `From:  ${t.script}\nTo:  ${t.newScript}\n\n${t.reportFile} will be added to .gitignore.` },
        "Change it",
      );
      if (ok !== "Change it") return;
      applyTestSetup(root);
      refresh();
      vscode.window.showInformationMessage(`Done. Run your tests and watch Byte react.`);
    }),
    vscode.commands.registerCommand("byte.audit", (quiet?: boolean) => {
      const root = repoFolder();
      if (!root || auditRunning) return;
      auditRunning = true;
      refresh();
      execFile("node", [cli, "audit", "--json"], { cwd: root, maxBuffer: 64 * 1024 * 1024, timeout: 180_000 }, (err, stdout) => {
        auditRunning = false;
        if (err && !stdout) {
          refresh();
          if (!quiet) vscode.window.showErrorMessage(`Byte health check failed: ${err.message}`);
          return;
        }
        state = loadState();
        loadAuditReport();
        refresh();
        if (!quiet && audit) {
          const critical = audit.findings.filter((f) => f.severity === "critical").length;
          const text = `Byte health check: ${audit.score}/100${critical ? `, ${critical} critical` : ""}`;
          if (critical) vscode.window.showWarningMessage(text, "Show me").then((a) => a && vscode.commands.executeCommand("byte.pet.focus"));
          else vscode.window.setStatusBarMessage(text, 5000);
        }
      });
    }),
    vscode.commands.registerCommand("byte.openFinding", async (file: string, line: number) => {
      const root = repoFolder();
      if (!root) return;
      const doc = await vscode.workspace.openTextDocument(path.join(root, file));
      const pos = new vscode.Position(Math.max(0, line - 1), 0);
      await vscode.window.showTextDocument(doc, { selection: new vscode.Range(pos, pos) });
    }),
  );

  // Sound on/off or volume changed in settings (or from the panel's speaker button)
  context.subscriptions.push(
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration("byte.sound") || e.affectsConfiguration("byte.soundVolume")) refresh();
    }),
  );

  // Mood depends on the time of day too (no commit yet today, idle days), so recheck now and then
  const timer = setInterval(() => {
    state = loadState();
    refresh();
  }, 5 * 60 * 1000);
  context.subscriptions.push({ dispose: () => clearInterval(timer) });

  // First time ever: open the setup guide once
  if (!context.globalState.get<boolean>("byte.welcomed")) {
    context.globalState.update("byte.welcomed", true);
    setTimeout(() => vscode.commands.executeCommand("byte.walkthrough"), 1500);
  }

  // A weekly check, quietly, so problems don't wait for someone to remember
  const week = 7 * 24 * 60 * 60 * 1000;
  const root = repoFolder();
  if (root && fs.existsSync(path.join(root, "package.json")) && (!audit || Date.now() - new Date(audit.createdAt).getTime() > week)) {
    const t = setTimeout(() => vscode.commands.executeCommand("byte.audit", true), 60_000);
    context.subscriptions.push({ dispose: () => clearTimeout(t) });
  }

  refresh();
}

export function deactivate() {}

import { randomBytes } from "node:crypto";
import * as vscode from "vscode";
import type { GuardReport } from "@byte/design-guard";
import type { AuditReport } from "@byte/audit";
import { moodFor, nextStage, stageFor, stageLabel, STAGES, type PetState } from "@byte/pet";
import { sprite } from "./sprite";
import { SOUND_SCRIPT } from "./sounds";

const MOOD_LINE: Record<string, string> = {
  happy: "All good. Keep it up.",
  concerned: "Some tests are failing.",
  "low-battery": "No commits yet today.",
  standby: "Resting.",
  glitching: "Health is low. A green test run helps.",
};

function concernReason(s: PetState): string {
  if (s.lastTestsFailed) return "Some tests are failing.";
  if (s.guardWarnings > 0) return "The last commit broke a design rule.";
  if (s.auditCritical > 0) return "The health check found critical issues.";
  return MOOD_LINE.concerned;
}

export class PetViewProvider implements vscode.WebviewViewProvider {
  private view?: vscode.WebviewView;

  constructor(
    private readonly getState: () => PetState,
    private readonly getGuard: () => { report: GuardReport | null; hasRules: boolean },
    private readonly getAudit: () => { report: AuditReport | null; running: boolean },
    private readonly getSetup: () => { hooks: boolean; rules: boolean; tests: boolean | null; audit: boolean } | null = () => null,
  ) {}

  resolveWebviewView(view: vscode.WebviewView) {
    this.view = view;
    view.webview.options = { enableScripts: true };
    view.webview.html = this.html();
    view.webview.onDidReceiveMessage((msg: { command?: string; file?: string; line?: number }) => {
      if (msg.command === "installHook") vscode.commands.executeCommand("byte.installHook");
      if (msg.command === "vacation") vscode.commands.executeCommand("byte.toggleVacation");
      if (msg.command === "guardInit") vscode.commands.executeCommand("byte.guardInit");
      if (msg.command === "guardCheck") vscode.commands.executeCommand("byte.guardCheck");
      if (msg.command === "audit") vscode.commands.executeCommand("byte.audit");
      if (msg.command === "walkthrough") vscode.commands.executeCommand("byte.walkthrough");
      if (msg.command === "toggleSound") {
        const cfg = vscode.workspace.getConfiguration("byte");
        cfg.update("sound", !cfg.get<boolean>("sound", true), vscode.ConfigurationTarget.Global);
      }
      if (msg.command === "open" && msg.file) vscode.commands.executeCommand("byte.openFinding", msg.file, msg.line ?? 1);
    });
    view.onDidChangeVisibility(() => view.visible && this.refresh());
    this.refresh();
  }

  refresh() {
    if (!this.view) return;
    const s = this.getState();
    const now = new Date();
    const stage = stageFor(s.xp);
    const mood = moodFor(s, now);
    const next = nextStage(s.xp);
    const floor = STAGES.find((x) => x.stage === stage)!.minXp;
    const audit = this.getAudit();
    const chest = audit.report ? (audit.report.score >= 80 ? "green" : audit.report.score >= 50 ? "amber" : "red") : undefined;
    const xpPct = next ? Math.round(((s.xp - floor) / (next.minXp - floor)) * 100) : 100;
    this.view.webview.postMessage({
      svg: sprite(stage, mood, s.name, chest),
      svgHappy: sprite(stage, "happy", s.name, chest),
      xp: s.xp,
      hp: s.health,
      lastLog: s.log[0]?.text ?? "",
      lastLogAt: s.log[0]?.at ?? "",
      standby: mood === "standby",
      worried: mood === "concerned" || mood === "glitching",
      name: s.name,
      sub: `${stageLabel(stage)}, ${mood.replace("-", " ")}`,
      line: s.vacation ? "Vacation mode is on. Health won't drop." : mood === "concerned" ? concernReason(s) : MOOD_LINE[mood],
      health: s.health,
      xpLabel: next ? `${s.xp - floor} / ${next.minXp - floor} to ${next.label}` : `${s.xp} XP, fully evolved`,
      xpPct,
      streak: Math.min(s.streakDays, 7),
      streakDays: s.streakDays,
      log: s.log.slice(0, 6).map((e) => ({ text: e.text, xp: e.xp, hp: e.hp })),
      vacation: s.vacation,
      guard: this.guardView(),
      audit: this.auditView(audit),
      setup: this.getSetup(),
      sound: vscode.workspace.getConfiguration("byte").get<boolean>("sound", true),
      volume: Math.max(0, Math.min(1, vscode.workspace.getConfiguration("byte").get<number>("soundVolume", 0.5))),
    });
  }

  private auditView(audit: { report: AuditReport | null; running: boolean }) {
    const r = audit.report;
    if (!r) return { running: audit.running, report: null };
    const counts = { critical: 0, high: 0, moderate: 0, low: 0 };
    for (const f of r.findings) counts[f.severity]++;
    return {
      running: audit.running,
      report: {
        score: r.score,
        when: r.createdAt,
        counts,
        accepted: r.accepted,
        skipped: r.checks.filter((c) => !c.ran).map((c) => `${c.category}: ${c.note ?? "skipped"}`),
        findings: r.findings.filter((f) => f.severity !== "low").slice(0, 6).map((f) => ({ id: f.id, severity: f.severity, title: f.title, file: f.file, line: f.line, fix: f.fix, detail: f.detail })),
      },
    };
  }

  private guardView() {
    const { report, hasRules } = this.getGuard();
    if (!report) return { hasRules, report: null };
    return {
      hasRules,
      report: {
        changed: report.changed.length,
        introduced: report.introduced.map((i) => `${i.kind} ${i.name}, ${i.note}`),
        warnings: report.warnings.map((w) => ({ message: w.message, file: w.file, line: w.line, fix: w.fix })),
        baselined: report.baselined,
        fixed: report.fixed.length,
      },
    };
  }

  private html(): string {
    const nonce = randomBytes(16).toString("base64");
    const csp = `default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-${nonce}';`;
    return /* html */ `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="${csp}">
<meta name="viewport" content="width=device-width, initial-scale=1">
<style>
  :root { --mint: #7EE0B5; --amber: #F2B86B; --track: color-mix(in srgb, var(--vscode-foreground) 14%, transparent); }
  body { margin: 0; padding: 12px; font-family: var(--vscode-font-family); font-size: var(--vscode-font-size); color: var(--vscode-foreground); }
  .card { display: flex; flex-direction: column; align-items: center; gap: 4px; padding: 12px 8px 16px; border-radius: 12px;
          background: color-mix(in srgb, var(--vscode-foreground) 5%, transparent); }
  .name { font-size: 1.25em; font-weight: 700; margin-top: 4px; }
  .sub { opacity: .75; }
  .line { margin-top: 6px; text-align: center; }
  .stats { display: flex; flex-direction: column; gap: 12px; margin: 16px 0; }
  .row { display: flex; justify-content: space-between; margin-bottom: 6px; font-size: .92em; }
  .bar { height: 8px; border-radius: 4px; background: var(--track); overflow: hidden; }
  .fill { height: 100%; border-radius: 4px; transition: width .4s ease; }
  .streak { display: flex; gap: 4px; }
  .streak span { flex: 1; height: 8px; border-radius: 2px; background: var(--track); }
  .streak span.on { background: var(--mint); }
  h2 { font-size: .92em; font-weight: 600; margin: 16px 0 8px; opacity: .8; }
  ul { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 6px; }
  li { display: flex; justify-content: space-between; gap: 8px; font-size: .92em; }
  li .delta { font-family: var(--vscode-editor-font-family); white-space: nowrap; }
  .plus { color: var(--mint); } .minus { color: var(--amber); }
  .empty { opacity: .7; }
  .guard-counts { display: grid; grid-template-columns: repeat(3, 1fr); gap: 6px; margin-bottom: 10px; }
  .guard-counts div { text-align: center; padding: 8px 4px; border-radius: 8px; background: color-mix(in srgb, var(--vscode-foreground) 5%, transparent); }
  .guard-counts b { display: block; font-size: 1.3em; }
  .guard-counts small { opacity: .75; }
  .finding { display: flex; flex-direction: column; gap: 2px; text-align: left; width: 100%; padding: 8px; border-radius: 6px; cursor: pointer;
             border: 1px solid color-mix(in srgb, var(--amber) 45%, transparent); background: color-mix(in srgb, var(--amber) 8%, transparent); color: inherit; font: inherit; }
  .finding .where { font-family: var(--vscode-editor-font-family); font-size: .88em; opacity: .8; }
  .finding .fix { font-size: .88em; opacity: .8; }
  .note { font-size: .9em; opacity: .8; margin: 8px 0 0; }
  .setup { margin: 14px 0 0; padding: 12px; border-radius: 10px; border: 1px solid color-mix(in srgb, var(--mint) 45%, transparent);
           background: color-mix(in srgb, var(--mint) 7%, transparent); }
  .setup b { display: block; margin-bottom: 6px; }
  .setup .bar { margin: 8px 0 10px; }
  .score { display: flex; align-items: center; gap: 12px; margin-bottom: 10px; }
  .score b { font-size: 2em; line-height: 1; }
  .dot { width: 12px; height: 12px; border-radius: 50%; flex: none; }
  .sev { font-size: .75em; font-weight: 700; letter-spacing: .04em; padding: 1px 6px; border-radius: 4px; align-self: flex-start; }
  .sev-critical { background: #F28B82; color: #1b1b1b; } .sev-high { background: var(--amber); color: #1b1b1b; }
  .sev-moderate { border: 1px solid var(--amber); color: var(--amber); }
  .actions { display: flex; gap: 8px; margin-top: 16px; }
  button { flex: 1; min-height: 32px; border: none; border-radius: 6px; cursor: pointer; font: inherit;
           background: var(--vscode-button-secondaryBackground); color: var(--vscode-button-secondaryForeground); }
  button.primary { background: var(--vscode-button-background); color: var(--vscode-button-foreground); }
  button:focus-visible { outline: 1px solid var(--vscode-focusBorder); outline-offset: 2px; }
  .stage { position: relative; width: 100%; height: 196px; overflow: hidden; cursor: pointer; user-select: none; }
  .byte { position: absolute; bottom: 0; left: 0; width: 148px; cursor: grab; }
  .byte svg { display: block; }
  .face { transition: transform .25s ease-out; }
  .pet .eye { transform-box: fill-box; transform-origin: center; animation: blink 5s infinite; }
  .pet-happy { animation: bob 2.4s ease-in-out infinite; }
  .walking .hopper { animation: waddle .32s ease-in-out infinite; }
  .hopper.jump { animation: jump .62s cubic-bezier(.3,.7,.4,1); }
  .hopper.shake { animation: shake .5s linear; }
  .hopper.squish { animation: squish .35s ease-out; }
  .mute { position: absolute; top: 4px; right: 4px; z-index: 2; width: 28px; height: 28px; min-height: 0; padding: 0; flex: none;
          display: grid; place-items: center; border-radius: 6px; opacity: .65; background: transparent; color: var(--vscode-foreground); }
  .mute:hover { opacity: 1; background: color-mix(in srgb, var(--vscode-foreground) 10%, transparent); }
  .bubble { position: absolute; top: 4px; max-width: 86%; padding: 6px 10px; border-radius: 10px; font-size: .9em; line-height: 1.35;
            background: var(--vscode-editorWidget-background, #252526); border: 1px solid color-mix(in srgb, var(--vscode-foreground) 18%, transparent);
            opacity: 0; transform: translateY(4px); transition: opacity .2s, transform .2s, left .2s; pointer-events: none; }
  .bubble.show { opacity: 1; transform: translateY(0); }
  .float { position: absolute; pointer-events: none; font-weight: 700; animation: rise 1.4s ease-out forwards; }
  @keyframes blink { 0%, 94%, 100% { transform: scaleY(1); } 97% { transform: scaleY(.1); } }
  @keyframes bob { 0%, 100% { transform: translateY(0); } 50% { transform: translateY(-3px); } }
  @keyframes waddle { 0%, 100% { transform: translateY(0) rotate(0); } 25% { transform: translateY(-2px) rotate(-2deg); } 75% { transform: translateY(-2px) rotate(2deg); } }
  @keyframes jump { 0% { transform: translateY(0) scale(1.06, .92); } 40% { transform: translateY(-34px) scale(.96, 1.05); } 70% { transform: translateY(-12px); } 100% { transform: translateY(0) scale(1); } }
  @keyframes shake { 0%, 100% { transform: translateX(0); } 20%, 60% { transform: translateX(-5px) rotate(-3deg); } 40%, 80% { transform: translateX(5px) rotate(3deg); } }
  @keyframes squish { 0% { transform: scale(1); } 40% { transform: scale(1.08, .9); } 100% { transform: scale(1); } }
  @keyframes rise { 0% { opacity: 0; transform: translateY(0) scale(.7); } 15% { opacity: 1; transform: translateY(-8px) scale(1); } 100% { opacity: 0; transform: translateY(-70px) scale(1.1); } }
  @media (prefers-reduced-motion: reduce) {
    .pet .eye, .pet-happy, .fill, .walking .hopper, .hopper.jump, .hopper.shake, .hopper.squish, .float { animation: none; transition: none; }
    .face, .bubble { transition: none; }
  }
</style>
</head>
<body>
  <div class="card">
    <div class="stage" id="stage" title="Click Byte to pet it, double-click to make it jump, click anywhere else to send it there">
      <button class="mute" id="mute" aria-label="Turn sound off" title="Sound on (click to mute)"></button>
      <div class="bubble" id="bubble"></div>
      <div class="byte" id="byte"><div class="hopper" id="hopper"><div id="sprite"></div></div></div>
    </div>
    <div class="name" id="name">Byte</div>
    <div class="sub" id="sub"></div>
    <div class="line" id="line"></div>
  </div>
  <div id="setup"></div>
  <div class="stats">
    <div><div class="row"><span>Health</span><span id="hpText"></span></div><div class="bar"><div class="fill" id="hp"></div></div></div>
    <div><div class="row"><span>XP</span><span id="xpText"></span></div><div class="bar"><div class="fill" id="xp" style="background: var(--amber)"></div></div></div>
    <div><div class="row"><span>Commit streak</span><span id="streakText"></span></div><div class="streak" id="streak"></div></div>
  </div>
  <h2>Health check</h2>
  <div id="audit"></div>
  <h2>Design guard</h2>
  <div id="guard"></div>
  <h2>Recent</h2>
  <ul id="log"></ul>
  <div class="actions">
    <button class="primary" id="hook">Install git hooks</button>
    <button id="vac">Vacation mode</button>
  </div>
<script nonce="${nonce}">
  const vscode = acquireVsCodeApi();
  const $ = (id) => document.getElementById(id);
  const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };
  function button(label, command, primary) {
    const b = el("button", primary ? "primary" : "", label);
    b.addEventListener("click", () => vscode.postMessage({ command }));
    return b;
  }
  function renderGuard(g) {
    const box = $("guard");
    const parts = [];
    if (!g.hasRules) {
      parts.push(el("p", "note", "Byte can learn the design rules your code already follows, then warn when a commit breaks them."));
      const row = el("div", "actions"); row.append(button("Learn design rules", "guardInit", true)); parts.push(row);
      box.replaceChildren(...parts);
      return;
    }
    const r = g.report;
    if (!r) {
      parts.push(el("p", "note", "No check yet. Stage some changes, then check them, or just commit."));
    } else {
      const counts = el("div", "guard-counts");
      for (const [n, label] of [[r.changed, "changed"], [r.introduced.length, "introduced"], [r.warnings.length, "warnings"]]) {
        const d = el("div"); d.append(el("b", "", String(n)), el("small", "", label)); counts.append(d);
      }
      parts.push(counts);
      const list = el("ul");
      for (const w of r.warnings.slice(0, 5)) {
        const li = el("li");
        const b = el("button", "finding");
        b.append(el("span", "", w.message), el("span", "where", w.file + ":" + w.line), el("span", "fix", "Fix: " + w.fix));
        b.addEventListener("click", () => vscode.postMessage({ command: "open", file: w.file, line: w.line }));
        li.append(b); list.append(li);
      }
      for (const i of r.introduced.slice(0, 4)) list.append(el("li", "", "New " + i));
      if (list.children.length) parts.push(list);
      if (r.fixed) parts.push(el("p", "note", "You fixed " + r.fixed + " old issue" + (r.fixed > 1 ? "s" : "") + " in this change."));
      else if (r.baselined) parts.push(el("p", "note", r.baselined + " older issue" + (r.baselined > 1 ? "s" : "") + " in these files are in the baseline and ignored."));
    }
    const row = el("div", "actions");
    row.append(button("Check staged changes", "guardCheck", true), button("Relearn rules", "guardInit"));
    parts.push(row);
    box.replaceChildren(...parts);
  }
  $("hook").addEventListener("click", () => vscode.postMessage({ command: "installHook" }));
  $("vac").addEventListener("click", () => vscode.postMessage({ command: "vacation" }));
  function renderSetup(p) {
    const box = $("setup");
    if (!p) return box.replaceChildren();
    const steps = [p.hooks, p.rules, p.tests, p.audit].filter((v) => v !== null);
    const done = steps.filter(Boolean).length;
    if (done === steps.length) return box.replaceChildren();
    const card = el("div", "setup");
    card.append(el("b", "", "Finish waking Byte up"), el("span", "note", done + " of " + steps.length + " steps done"));
    const bar = el("div", "bar"); const fill = el("div", "fill"); fill.style.width = Math.round((done / steps.length) * 100) + "%"; fill.style.background = "var(--mint)"; bar.append(fill); card.append(bar);
    const row = el("div", "actions"); row.style.marginTop = "0"; row.append(button("Open setup guide", "walkthrough", true)); card.append(row);
    box.replaceChildren(card);
  }

  function renderAudit(a) {
    const box = $("audit");
    const parts = [];
    const r = a.report;
    if (!r) {
      parts.push(el("p", "note", "Byte can check this project for leaked keys, vulnerable packages, risky code and messy spots."));
    } else {
      const color = r.score >= 80 ? "var(--mint)" : r.score >= 50 ? "var(--amber)" : "#F28B82";
      const row = el("div", "score");
      const dot = el("span", "dot"); dot.style.background = color;
      const num = el("b", "", String(r.score)); num.style.color = color;
      const label = el("div");
      const sums = ["critical", "high", "moderate", "low"].filter((k) => r.counts[k]).map((k) => r.counts[k] + " " + k).join(", ");
      label.append(el("div", "", "out of 100"), el("small", "note", sums || "Nothing found"));
      row.append(dot, num, label);
      parts.push(row);
      const list = el("ul");
      for (const f of r.findings) {
        const li = el("li");
        const b = el("button", "finding");
        b.append(el("span", "sev sev-" + f.severity, f.severity.toUpperCase()), el("span", "", f.title + (f.detail ? "  (" + f.detail + ")" : "")));
        if (f.file && !/^https?:/.test(f.file)) b.append(el("span", "where", f.file + (f.line ? ":" + f.line : "")));
        b.append(el("span", "fix", "Fix: " + f.fix));
        if (f.file && !/^https?:/.test(f.file)) b.addEventListener("click", () => vscode.postMessage({ command: "open", file: f.file, line: f.line || 1 }));
        li.append(b); list.append(li);
      }
      if (list.children.length) parts.push(list);
      for (const s of r.skipped) parts.push(el("p", "note", "Skipped " + s));
      parts.push(el("p", "note", "Checked " + new Date(r.when).toLocaleString() + (r.accepted ? ", " + r.accepted + " accepted risk(s) hidden" : "")));
    }
    const row = el("div", "actions");
    const btn = button(a.running ? "Checking..." : r ? "Check again" : "Run health check", "audit", true);
    btn.disabled = a.running;
    row.append(btn);
    parts.push(row);
    box.replaceChildren(...parts);
  }

  /* ---------- Byte's voice ---------- */
  ${SOUND_SCRIPT}
  let audio = null, soundOn = true, volume = 0.5;
  const SPEAKER_ON = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M4 9h4l5-4v14l-5-4H4z"/><path d="M16.5 8.5a5 5 0 0 1 0 7"/><path d="M19 6a8.5 8.5 0 0 1 0 12"/></svg>';
  const SPEAKER_OFF = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M4 9h4l5-4v14l-5-4H4z"/><path d="M17 9l5 6M22 9l-5 6"/></svg>';
  function audioCtx(fromUser) {
    // Browsers only allow sound after the user has clicked once; clicks create or wake the audio
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    if (!audio && fromUser) audio = new AC();
    if (audio && audio.state === "suspended" && fromUser) audio.resume();
    return audio && (audio.state === "running" || fromUser) ? audio : null;
  }
  function play(name, fromUser) {
    if (!soundOn || volume <= 0) return;
    const a = audioCtx(fromUser);
    if (!a) return;
    try { ByteSounds[name](a, a.currentTime + 0.01, volume); } catch (e) {}
  }
  function showMute() {
    const m = $("mute");
    m.innerHTML = soundOn ? SPEAKER_ON : SPEAKER_OFF;
    m.setAttribute("aria-label", soundOn ? "Turn sound off" : "Turn sound on");
    m.title = soundOn ? "Sound on (click to mute)" : "Sound off (click to unmute)";
  }
  $("mute").addEventListener("click", (e) => {
    e.stopPropagation();
    soundOn = !soundOn;
    showMute();
    if (soundOn) play("blip", true);
    vscode.postMessage({ command: "toggleSound" });
  });
  // Any click in the panel unlocks audio for later event sounds (commits, tests)
  document.addEventListener("pointerdown", () => audioCtx(true), { once: true });

  /* ---------- Byte comes alive ---------- */
  const stage = $("stage"), byteEl = $("byte"), hopper = $("hopper"), bubbleEl = $("bubble");
  const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;
  const BOT = 148;
  let current = null, happyUntil = 0, prev = null, x = 0, pets = 0, bubbleTimer, walkTimer;
  const PET = ["Hehe, that tickles!", "Beep boop, thank you!", "*happy whirring*", "Again! Again!", "You're my favourite human."];
  const MANY = ["Okay okay, I love you too!", "My circuits are blushing.", "Best. Developer. Ever."];
  const TIPS = ["Small real commits earn full XP.", "Run your tests, I love green.", "Fixing old design issues gives bonus XP.", "Going away? Vacation mode keeps me healthy."];
  const pick = (a) => a[Math.floor(Math.random() * a.length)];

  function drawSprite() {
    if (!current) return;
    $("sprite").innerHTML = Date.now() < happyUntil ? current.svgHappy : current.svg;
  }
  function maxX() { return Math.max(0, stage.clientWidth - BOT); }
  function place(nx, speed) {
    nx = Math.max(0, Math.min(maxX(), nx));
    const dist = Math.abs(nx - x);
    const secs = reduced ? 0 : dist / (speed || 70);
    byteEl.style.transition = "left " + secs + "s linear";
    byteEl.style.left = nx + "px";
    if (secs > 0.05) {
      stage.classList.add("walking");
      lookAt(nx > x ? 3 : -3, 0);
      clearTimeout(walkTimer);
      walkTimer = setTimeout(() => { stage.classList.remove("walking"); lookAt(0, 0); }, secs * 1000);
    }
    x = nx;
    moveBubble();
  }
  function lookAt(lx, ly) {
    const face = $("sprite").querySelector(".face");
    if (face) face.style.transform = "translate(" + lx.toFixed(1) + "px, " + ly.toFixed(1) + "px)";
  }
  function animateOnce(cls) {
    if (reduced) return;
    hopper.classList.remove("jump", "shake", "squish");
    void hopper.offsetWidth; // restart the animation
    hopper.classList.add(cls);
  }
  function say(text, ms) {
    bubbleEl.textContent = text;
    bubbleEl.classList.add("show");
    moveBubble();
    clearTimeout(bubbleTimer);
    bubbleTimer = setTimeout(() => bubbleEl.classList.remove("show"), ms || 3200);
  }
  function moveBubble() {
    const w = bubbleEl.offsetWidth || 120;
    bubbleEl.style.left = Math.max(0, Math.min(stage.clientWidth - w, x + BOT / 2 - w / 2)) + "px";
  }
  function float(text, color, count) {
    if (reduced) return;
    for (let i = 0; i < (count || 1); i++) {
      const f = el("span", "float", text);
      f.style.color = color;
      f.style.left = (x + 30 + Math.random() * (BOT - 60)) + "px";
      f.style.top = (60 + Math.random() * 30) + "px";
      f.style.animationDelay = (i * 0.12) + "s";
      stage.append(f);
      setTimeout(() => f.remove(), 1800 + i * 120);
    }
  }

  let lastPet = 0;
  function pet() {
    pets++;
    const quick = Date.now() - lastPet < 400; // part of a double-click: don't giggle twice
    lastPet = Date.now();
    happyUntil = Date.now() + 2600;
    drawSprite();
    setTimeout(drawSprite, 2700);
    animateOnce("squish");
    if (!quick) play("giggle", true);
    float("\u2665", "#F29BA6", 4);
    say(pets % 7 === 0 ? pick(MANY) : pick(PET));
  }

  byteEl.addEventListener("click", (e) => { e.stopPropagation(); pet(); });
  byteEl.addEventListener("dblclick", (e) => { e.stopPropagation(); animateOnce("jump"); play("jump", true); float("\u2726", "#7EE0B5", 3); });
  stage.addEventListener("click", (e) => {
    const r = stage.getBoundingClientRect();
    place(e.clientX - r.left - BOT / 2);
    play("beep", true);
    say(pick(["On my way!", "Coming!", "Zoom zoom."]), 1400);
  });
  // Eyes follow your mouse around the panel
  document.addEventListener("mousemove", (e) => {
    if (stage.classList.contains("walking")) return;
    const r = byteEl.getBoundingClientRect();
    const dx = e.clientX - (r.left + r.width / 2), dy = e.clientY - (r.top + r.height * 0.45);
    lookAt(Math.max(-4, Math.min(4, dx / 25)), Math.max(-2, Math.min(2, dy / 40)));
  });
  document.addEventListener("mouseleave", () => lookAt(0, 0));

  // A little life of its own
  function idle() {
    if (current && !document.hidden) {
      const roll = Math.random();
      if (current.standby) float("z", "#9AA3B2", 1);
      else if (roll < 0.4) place(Math.random() * maxX());
      else if (roll < 0.55) animateOnce("jump");
      else if (roll < 0.7) { lookAt(-4, 0); setTimeout(() => lookAt(4, 0), 700); setTimeout(() => lookAt(0, 0), 1400); }
      else if (roll < 0.78) say(pick(TIPS), 4000);
      else if (current.worried && roll < 0.9) float("\u2022", "#82AAFF", 1);
    }
    setTimeout(idle, 3500 + Math.random() * 4500);
  }
  setTimeout(idle, 3000);

  function onState(s) {
    current = s;
    if (soundOn !== s.sound) { soundOn = s.sound; }
    volume = s.volume;
    showMute();
    drawSprite();
    if (!prev) {
      place(maxX() / 2, 1000);
      say("Hi! Click me.", 3000);
    } else if (s.xp > prev.xp) {
      animateOnce("jump");
      play("xp");
      float("+" + (s.xp - prev.xp) + " XP", "#F2B86B", 1);
      if (s.lastLog) say(s.lastLog, 4500);
    } else if (s.hp < prev.hp) {
      animateOnce("shake");
      play("sad");
      if (s.lastLog) say(s.lastLog, 4500);
    } else if (s.lastLogAt && s.lastLogAt !== prev.logAt) {
      animateOnce("squish");
      play("beep");
      say(s.lastLog, 4500);
    }
    prev = { xp: s.xp, hp: s.hp, logAt: s.lastLogAt };
  }
  new ResizeObserver(() => place(Math.min(x, maxX()), 1000)).observe(stage);

  window.addEventListener("message", ({ data: s }) => {
    onState(s);
    $("name").textContent = s.name;
    $("sub").textContent = s.sub;
    $("line").textContent = s.line;
    $("hpText").textContent = s.health + "%";
    const hp = $("hp");
    hp.style.width = s.health + "%";
    hp.style.background = s.health < 30 ? "var(--amber)" : "var(--mint)";
    $("xpText").textContent = s.xpLabel;
    $("xp").style.width = s.xpPct + "%";
    $("streakText").textContent = s.streakDays + (s.streakDays === 1 ? " day" : " days");
    const streak = $("streak");
    streak.replaceChildren(...Array.from({ length: 7 }, (_, i) => {
      const d = document.createElement("span");
      if (i < s.streak) d.className = "on";
      return d;
    }));
    const log = $("log");
    if (!s.log.length) {
      const li = document.createElement("li");
      li.className = "empty";
      li.textContent = "Make a commit or run your tests to wake Byte up.";
      log.replaceChildren(li);
    } else {
      log.replaceChildren(...s.log.map((e) => {
        const li = document.createElement("li");
        const text = document.createElement("span");
        text.textContent = e.text;
        const delta = document.createElement("span");
        delta.className = "delta " + (e.hp < 0 && e.xp === 0 ? "minus" : "plus");
        delta.textContent = e.xp ? "+" + e.xp + " XP" : e.hp ? (e.hp > 0 ? "+" : "\u2212") + Math.abs(e.hp) + " HP" : "";
        li.append(text, delta);
        return li;
      }));
    }
    $("vac").textContent = s.vacation ? "End vacation" : "Vacation mode";
    renderGuard(s.guard);
    renderAudit(s.audit);
    renderSetup(s.setup);
  });
</script>
</body>
</html>`;
  }
}

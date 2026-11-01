import { moodFor, nextStage, stageFor, stageLabel, type Mood, type PetState } from "@byte/pet";
import { ROBOT_WIDTH, chestFor, colorMode, fg, hex, robotPixels, toLines, type Pixel, type RGB } from "./art";

/**
 * `byte pet`: Byte lives in the terminal. It wanders, looks around, blinks,
 * reacts to commits and test runs as they happen, and responds to keys and clicks.
 */

const PINK = hex("#F29BA6");
const AMBER = hex("#F2B86B");
const MINT = hex("#7EE0B5");
const BLUE = hex("#82AAFF");
const GREY = hex("#9AA3B2");

const JUMP = [2, 4, 5, 6, 6, 5, 4, 2, 0]; // pixel heights over time
const PAD = 6; // spare pixel rows above the robot for jumping
const SKY = 3; // text lines above the robot for floating hearts, stars, z's
const FRAME_MS = 90;

interface Particle {
  x: number; // column relative to the robot's left edge
  y: number; // line within the sky, counts down to float up
  text: string;
  color: RGB;
  life: number;
}

const PET_LINES = ["Hehe, that tickles!", "Beep boop, thank you!", "*happy whirring*", "Again! Again!", "You're my favourite human."];
const FEED_LINES = ["Yum, crunchy bits! (Snacks are free. XP comes from commits.)", "Mmm, tasty electrons.", "Om nom nom."];
const POKE_LINES = ["Hey! I'm working here.", "Boop.", "Did you need something?"];
const TIPS = [
  "Tip: small commits with real changes earn full XP.",
  "Tip: `byte guard check` checks your staged changes any time.",
  "Tip: going away? `byte vacation on` keeps me healthy.",
  "Tip: fixing old design issues gives bonus XP.",
];
const pick = <T,>(list: T[]) => list[Math.floor(Math.random() * list.length)];

export async function livePet(load: () => PetState): Promise<void> {
  const out = process.stdout;
  const input = process.stdin;
  const mode = colorMode();
  if (mode === "none" || !input.isTTY) {
    console.log("byte pet needs an interactive terminal with colour.");
    return;
  }

  let state = load();
  let lastLoad = Date.now();
  let cols = out.columns || 80;
  const maxX = () => Math.max(0, Math.min(cols - ROBOT_WIDTH - 2, 70));

  let x = Math.floor(maxX() / 2);
  let target = x;
  let look = 0;
  let jumpQueue: number[] = [];
  let shake = 0;
  let tick = 0;
  let nextIdle = Date.now() + 2500;
  let particles: Particle[] = [];
  let bubble = { text: "Hi! Press p to pet me, or click me.", until: Date.now() + 5000 };
  let happyUntil = 0;
  let dance = 0;
  let showHelp = true;

  const say = (text: string, ms = 3500) => (bubble = { text, until: Date.now() + ms });
  const hop = () => {
    if (!jumpQueue.length) jumpQueue = [...JUMP];
  };
  const burst = (text: string, color: RGB, count = 3) => {
    for (let i = 0; i < count; i++) {
      particles.push({ x: 4 + Math.floor(Math.random() * (ROBOT_WIDTH - 8)), y: SKY - 1, text, color, life: 6 + i * 2 });
    }
  };

  const actions = {
    pet() {
      happyUntil = Date.now() + 2500;
      burst("\u2665", PINK, 4);
      hop();
      say(pick(PET_LINES));
    },
    feed() {
      happyUntil = Date.now() + 2000;
      burst("\u00B7", AMBER, 5);
      say(pick(FEED_LINES), 4500);
    },
    jump() {
      hop();
      burst("\u2726", MINT, 2);
    },
    dance() {
      dance = 24;
      happyUntil = Date.now() + 2600;
      burst("\u266A", MINT, 3);
      say("Dance break!");
    },
    tip() {
      say(pick(TIPS), 5000);
    },
    walkTo(col: number) {
      target = Math.max(0, Math.min(maxX(), col - Math.floor(ROBOT_WIDTH / 2)));
      say(target === x ? pick(POKE_LINES) : "On my way!", 1800);
    },
  };

  // Where does our drawing start on screen? Needed to know what a click hits.
  const height = 1 + SKY + (18 + PAD) / 2 + 2; // header, sky, robot, speech, help
  out.write("\n".repeat(height));
  out.write(`\x1b[${height}A`);
  const top = await cursorRow(input, out);

  const cleanup = () => {
    out.write("\x1b[?1000l\x1b[?1006l\x1b[?25h");
    if (input.isTTY) input.setRawMode(false);
    input.pause();
    out.write(top ? `\x1b[${top + height};1H\n` : "\n");
  };

  out.write("\x1b[?25l"); // hide cursor
  if (top) out.write("\x1b[?1000h\x1b[?1006h"); // mouse clicks, SGR format
  input.setRawMode(true);
  input.resume();
  input.setEncoding("utf8");

  let quit: () => void = () => {};
  const done = new Promise<void>((resolve) => (quit = resolve));

  input.on("data", (chunk: string) => {
    if (chunk === "\u0003" || chunk === "q") return quit();
    const mouse = /\x1b\[<(\d+);(\d+);(\d+)M/.exec(chunk);
    if (mouse && top) {
      const [button, mx, my] = [Number(mouse[1]), Number(mouse[2]) - 1, Number(mouse[3])];
      if (button !== 0) return; // left click only, ignore wheel
      const robotTop = top + 1 + SKY;
      const robotBottom = robotTop + (18 + PAD) / 2;
      const onRobot = mx >= x + 2 && mx < x + 2 + ROBOT_WIDTH && my >= robotTop && my < robotBottom;
      if (onRobot) actions.pet();
      else if (my >= top && my < top + height) actions.walkTo(mx - 2);
      return;
    }
    const key = chunk.toLowerCase();
    if (key === "p") actions.pet();
    else if (key === "f") actions.feed();
    else if (key === "j" || key === " ") actions.jump();
    else if (key === "d") actions.dance();
    else if (key === "t") actions.tip();
    else if (key === "h") showHelp = !showHelp;
    else if (chunk === "\x1b[D") actions.walkTo(x - 4 + Math.floor(ROBOT_WIDTH / 2));
    else if (chunk === "\x1b[C") actions.walkTo(x + 6 + Math.floor(ROBOT_WIDTH / 2));
  });
  out.on("resize", () => {
    cols = out.columns || 80;
    x = Math.min(x, maxX());
    target = Math.min(target, maxX());
  });

  const timer = setInterval(() => {
    const now = Date.now();

    // Pick up real events: commits, tests, guard results
    if (now - lastLoad > 1500) {
      const fresh = load();
      lastLoad = now;
      const dxp = fresh.xp - state.xp;
      const dhp = fresh.health - state.health;
      if (dxp > 0) {
        hop();
        particles.push({ x: 6, y: SKY - 1, text: `+${dxp} XP`, color: AMBER, life: 10 });
        say(fresh.log[0]?.text ?? `+${dxp} XP!`, 4500);
      } else if (dhp < 0) {
        shake = 8;
        say(fresh.log[0]?.text ?? "Ouch.", 4500);
      } else if (fresh.log[0] && fresh.log[0].at !== state.log[0]?.at) {
        // Something happened without XP (daily cap reached, vacation, etc.): still notice it
        hop();
        say(fresh.log[0].text, 4500);
      }
      state = fresh;
    }

    const mood: Mood = now < happyUntil ? "happy" : moodFor(state, new Date());

    // Idle life: wander, look around, hop now and then
    if (now > nextIdle && x === target && !jumpQueue.length && !dance) {
      const roll = Math.random();
      if (mood === "standby") {
        burst("z", GREY, 1);
      } else if (roll < 0.45) {
        target = Math.floor(Math.random() * (maxX() + 1));
      } else if (roll < 0.75) {
        look = look === 0 ? (Math.random() < 0.5 ? -1 : 1) : 0;
      } else if (roll < 0.9) {
        hop();
      } else if (mood === "concerned" || mood === "glitching") {
        particles.push({ x: ROBOT_WIDTH - 4, y: SKY - 1, text: "\u2022", color: BLUE, life: 5 });
      }
      nextIdle = now + 1800 + Math.random() * 3500;
    }

    // Movement
    let walking = false;
    if (x !== target && mood !== "standby") {
      const step = x < target ? 1 : -1;
      x += step;
      look = step;
      walking = true;
    }
    let drawX = x;
    if (dance > 0) {
      drawX = Math.max(0, x + (Math.floor(dance / 3) % 2 ? 1 : -1));
      look = Math.floor(dance / 3) % 2 ? 1 : -1;
      if (dance % 8 === 0) burst("\u266A", MINT, 1);
      dance--;
      if (!dance) look = 0;
    }
    if (shake > 0) {
      drawX = Math.max(0, x + (shake % 2 ? 1 : -1));
      shake--;
    }
    const lift = jumpQueue.length ? jumpQueue.shift()! : 0;

    // Particles float up and fade
    particles = particles
      .map((p) => ({ ...p, life: p.life - 1, y: tick % 3 === 0 ? p.y - 1 : p.y }))
      .filter((p) => p.life > 0 && p.y >= 0);

    // Draw
    const frame = {
      blink: tick % 28 === 13 || tick % 28 === 14,
      glow: Math.floor(tick / 6) % 2 === 0,
      look,
      roll: walking ? Math.floor(tick / 2) % 3 : undefined,
      shift: mood === "glitching" && tick % 9 === 4 ? 1 : 0,
      chest: chestFor(state.auditScore),
    };
    const robot = robotPixels(mood, frame);
    const blank = (): Pixel[] => Array.from({ length: ROBOT_WIDTH }, () => null);
    const rows: Pixel[][] = [...Array.from({ length: PAD - lift }, blank), ...robot, ...Array.from({ length: lift }, blank)];
    const art = toLines(rows, mode);

    const sky: string[] = Array.from({ length: SKY }, () => "");
    const skyCells: string[][] = Array.from({ length: SKY }, () => Array(cols).fill(" "));
    for (const p of particles) {
      const col = 2 + drawX + p.x;
      for (let i = 0; i < p.text.length && col + i < cols; i++) skyCells[p.y][col + i] = (i === 0 ? fg(p.color, mode) : "") + p.text[i] + (i === p.text.length - 1 ? "\x1b[0m" : "");
    }
    for (let i = 0; i < SKY; i++) sky[i] = skyCells[i].join("").replace(/\s+$/, "");

    const lines: string[] = [];
    lines.push(header(state, mood, mode));
    lines.push(...sky);
    for (const row of art) lines.push(" ".repeat(2 + drawX) + row);
    const text = now < bubble.until ? bubble.text : "";
    const bubbleCol = Math.max(0, Math.min(2 + drawX, cols - text.length - 4));
    lines.push(text ? " ".repeat(bubbleCol) + `\x1b[3m\u201C${text}\u201D\x1b[0m` : "");
    lines.push(
      showHelp
        ? "\x1b[2m  p pet  f feed  j jump  d dance  t tip  \u2190\u2192 walk  click: pet/move  h help  q quit\x1b[0m"
        : "",
    );

    const position = top ? `\x1b[${top};1H` : tick === 0 ? "" : `\x1b[${lines.length}A`;
    out.write(position + lines.map((l) => `\x1b[2K${clip(l, cols - 1)}`).join("\n") + (top ? "" : "\n"));
    tick++;
  }, FRAME_MS);

  process.once("SIGTERM", () => quit());
  await done;
  clearInterval(timer);
  cleanup();
}

/** Cuts a line to `width` visible characters, keeping colour codes intact, so nothing wraps. */
function clip(line: string, width: number): string {
  let visible = 0;
  let out = "";
  for (let i = 0; i < line.length; i++) {
    if (line[i] === "\x1b") {
      const end = line.indexOf("m", i);
      if (end !== -1) {
        out += line.slice(i, end + 1);
        i = end;
        continue;
      }
    }
    if (visible >= width) break;
    out += line[i];
    visible++;
  }
  return out + "\x1b[0m";
}

function header(s: PetState, mood: Mood, mode: ReturnType<typeof colorMode>): string {
  const next = nextStage(s.xp);
  const bar = (pct: number, width = 10) => {
    const filled = Math.round((pct / 100) * width);
    return "\u2588".repeat(filled) + "\x1b[2m" + "\u2591".repeat(width - filled) + "\x1b[0m";
  };
  const hp = `${fg(s.health < 30 ? AMBER : MINT, mode)}${bar(s.health)}\x1b[0m`;
  return [
    `  \x1b[1m${s.name}\x1b[0m`,
    `${stageLabel(stageFor(s.xp))}, ${mood.replace("-", " ")}`,
    `${hp} ${s.health}%`,
    `${s.xp} XP${next ? ` (${next.minXp - s.xp} to ${next.label})` : ""}`,
    `streak ${s.streakDays}d`,
    ...(s.auditScore !== null && s.auditScore !== undefined ? [`health check ${s.auditScore}`] : []),
  ].join("\x1b[2m  \u00B7  \x1b[0m");
}

/** Asks the terminal where the cursor is. Returns the 1-based row, or 0 if it doesn't answer. */
function cursorRow(input: NodeJS.ReadStream, out: NodeJS.WriteStream): Promise<number> {
  return new Promise((resolve) => {
    input.setRawMode(true);
    input.resume();
    input.setEncoding("utf8");
    let buffer = "";
    const finish = (row: number) => {
      clearTimeout(timer);
      input.removeListener("data", onData);
      resolve(row);
    };
    const onData = (chunk: string) => {
      buffer += chunk;
      const m = /\x1b\[(\d+);(\d+)R/.exec(buffer);
      if (m) finish(Number(m[1]));
    };
    const timer = setTimeout(() => finish(0), 400);
    input.on("data", onData);
    out.write("\x1b[6n");
  });
}

import { FACES as TEXT_FACES, type Mood } from "@byte/pet";

/**
 * Byte as pixel art, drawn with half-block characters so each text line
 * holds two pixel rows. Same robot as the VS Code panel and the canvas.
 */

export type RGB = [number, number, number];
export const hex = (h: string): RGB => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];

const MINT = hex("#7EE0B5");
const AMBER = hex("#F2B86B");
const DIM = hex("#3E6E58");

// . empty, S steel, D dark steel, J joint, K screen, A antenna, T tread, G/Y/L chest lights
const BODY = [
  "..........AA..........",
  "..........AA..........",
  "..........DD..........",
  "...SSSSSSSSSSSSSSSS...",
  "..SSSSSSSSSSSSSSSSSS..",
  "JJSS..............SSJJ", // rows 5 to 11: the screen face goes in cols 4 to 17
  "JJSS..............SSJJ",
  "JJSS..............SSJJ",
  "JJSS..............SSJJ",
  "JJSS..............SSJJ",
  "..SS..............SS..",
  "..SS..............SS..",
  "..SSSSSSSSSSSSSSSSSS..",
  "...SSSSSSSSSSSSSSSS...",
  "......DDDDDDDDDD......",
  "......DDGDDYDDLD......",
  "......DDDDDDDDDD......",
  "....TTTTTTTTTTTTTT....",
];
const SCREEN_TOP = 5;
const SCREEN_LEFT = 4;

// K screen, E eyes, M mouth, P cheeks (7 rows x 14 cols)
const FACES: Record<Mood | "blink", string[]> = {
  happy: [
    "KKKKKKKKKKKKKK",
    "KKKEEKKKKEEKKK",
    "KKEKKEKKEKKEKK",
    "KKKKKKKKKKKKKK",
    "KPKKMKKKKMKKPK",
    "KKKKKMMMMKKKKK",
    "KKKKKKKKKKKKKK",
  ],
  concerned: [
    "KKEKKKKKKKKEKK",
    "KKKEEKKKKEEKKK",
    "KKKEEKKKKEEKKK",
    "KKKEEKKKKEEKKK",
    "KKKKKKKKKKKKKK",
    "KKKKMMMMMMKKKK",
    "KKKKKKKKKKKKKK",
  ],
  "low-battery": [
    "KKKKKKKKKKKKKK",
    "KKEEEKKKKEEEKK",
    "KKEKEKKKKEKEKK",
    "KKEEEKKKKEEEKK",
    "KKKKKKKKKKKKKK",
    "KKKKKKMMKKKKKK",
    "KKKKKKKKKKKKKK",
  ],
  standby: [
    "KKKKKKKKKKKKKK",
    "KKKKKKKKKKKKKK",
    "KKKKKKKKKKKKKK",
    "KKEEEKKKKEEEKK",
    "KKKKKKKKKKKKKK",
    "KKKKKMMMMKKKKK",
    "KKKKKKKKKKKKKK",
  ],
  glitching: [
    "KKKKKKKKKKKKKK",
    "KKEKEKKKKEKEKK",
    "KKKEKKKKKKEKKK",
    "KKEKEKKKKEKEKK",
    "KKKKKKKKKKKKKK",
    "KKKMKMKMKMKKKK",
    "KKKKKKKKKKKKKK",
  ],
  blink: [
    "KKKKKKKKKKKKKK",
    "KKKKKKKKKKKKKK",
    "KKKKKKKKKKKKKK",
    "KKEEEKKKKEEEKK",
    "KKKKKKKKKKKKKK",
    "KKKKKMMMMKKKKK",
    "KKKKKKKKKKKKKK",
  ],
};

export function faceColor(mood: Mood): RGB {
  if (mood === "standby") return DIM;
  if (mood === "concerned" || mood === "glitching") return AMBER;
  return MINT;
}

export interface Frame {
  look?: number; // -1 left, 1 right: eyes and mouth slide on the screen
  roll?: number; // treads pattern offset, so they look like they turn while walking
  blink?: boolean;
  lift?: boolean; // happy bob: whole robot one pixel up
  glow?: boolean; // antenna bright or dim
  chest?: RGB; // health check light
  shift?: number; // glitch: screen band nudged sideways
}

function palette(mood: Mood, frame: Frame): Record<string, RGB | null> {
  const face = faceColor(mood);
  const antenna = mood === "standby" ? hex("#4A5160") : frame.glow ? face : hex(mood === "happy" ? "#4E9C7B" : "#A87D45");
  return {
    ".": null,
    S: mood === "glitching" ? hex("#A8A29A") : mood === "standby" ? hex("#9AA4B2") : hex("#B8C2CF"),
    D: hex("#8E99A8"),
    J: hex("#6B7484"),
    K: hex("#0F1115"),
    A: antenna,
    T: hex("#2D3340"),
    G: MINT,
    Y: frame.chest ?? AMBER,
    L: hex("#6B7484"),
    E: face,
    M: face,
    P: hex("#F29BA6"),
  };
}

export type Pixel = RGB | null;
export const ROBOT_WIDTH = BODY[0].length;

/** The robot alone, 18 pixel rows, no padding. */
export function robotPixels(mood: Mood, frame: Frame): Pixel[][] {
  const pal = palette(mood, frame);
  const face = frame.blink && mood !== "standby" && mood !== "glitching" ? FACES.blink : FACES[mood];
  return BODY.map((line, y) => {
    const chars = line.split("");
    if (y >= SCREEN_TOP && y < SCREEN_TOP + face.length) {
      const faceRow = face[y - SCREEN_TOP].split("");
      const glitch = frame.shift && y >= SCREEN_TOP + 1 && y <= SCREEN_TOP + 3 ? frame.shift : 0;
      const shift = glitch + (frame.look ?? 0);
      for (let x = 0; x < faceRow.length; x++) chars[SCREEN_LEFT + x] = faceRow[(x - shift + faceRow.length) % faceRow.length];
    }
    if (line.includes("T") && frame.roll !== undefined) {
      for (let x = 0; x < chars.length; x++) if (chars[x] === "T" && (x + frame.roll) % 3 === 0) chars[x] = "J";
    }
    return chars.map((ch) => pal[ch] ?? null);
  });
}

export function pixels(mood: Mood, frame: Frame): Pixel[][] {
  const rows = robotPixels(mood, frame);
  const blank = () => Array.from({ length: BODY[0].length }, () => null as RGB | null);
  // Two spare rows let the robot bob without the height changing
  return frame.lift ? [...rows, blank(), blank()] : [blank(), ...rows, blank()];
}

/* ---------- colour output ---------- */

export type ColorMode = "truecolor" | "256" | "none";

export function colorMode(): ColorMode {
  if (process.env.NO_COLOR || !process.stdout.isTTY) return "none";
  const ct = (process.env.COLORTERM ?? "").toLowerCase();
  const term = process.env.TERM_PROGRAM ?? "";
  if (ct.includes("truecolor") || ct.includes("24bit")) return "truecolor";
  if (["iTerm.app", "vscode", "WezTerm", "ghostty", "Hyper", "WarpTerminal"].includes(term)) return "truecolor";
  return "256";
}

function to256([r, g, b]: RGB): number {
  const q = (v: number) => (v < 48 ? 0 : v < 115 ? 1 : Math.min(5, Math.round((v - 35) / 40)));
  return 16 + 36 * q(r) + 6 * q(g) + q(b);
}

export function fg(c: RGB, mode: ColorMode) {
  return mode === "truecolor" ? `\x1b[38;2;${c[0]};${c[1]};${c[2]}m` : `\x1b[38;5;${to256(c)}m`;
}
function bg(c: RGB, mode: ColorMode) {
  return mode === "truecolor" ? `\x1b[48;2;${c[0]};${c[1]};${c[2]}m` : `\x1b[48;5;${to256(c)}m`;
}

/** Turns pixel rows into text lines, two pixel rows per line. */
export function toLines(px: (RGB | null)[][], mode: ColorMode): string[] {
  const lines: string[] = [];
  for (let y = 0; y < px.length; y += 2) {
    let line = "";
    for (let x = 0; x < px[y].length; x++) {
      const top = px[y][x];
      const bottom = px[y + 1]?.[x] ?? null;
      if (!top && !bottom) line += "\x1b[0m ";
      else if (top && !bottom) line += `\x1b[0m${fg(top, mode)}\u2580`;
      else if (!top && bottom) line += `\x1b[0m${fg(bottom, mode)}\u2584`;
      else line += `${fg(top!, mode)}${bg(bottom!, mode)}\u2580`;
    }
    lines.push(line + "\x1b[0m");
  }
  return lines;
}

/* ---------- putting text next to the robot ---------- */

export interface Caption {
  title: string; // e.g. "Byte: All 5 tests green! +5 XP"
  lines: string[]; // already coloured if wanted
}

function compose(art: string[], caption: Caption, zzz: string | null, accent: RGB, mode: ColorMode): string[] {
  const text = [`${fg(accent, mode)}\x1b[1m${caption.title}\x1b[0m`, ...caption.lines];
  const start = Math.max(0, Math.floor((art.length - text.length) / 2));
  return art.map((row, i) => {
    const pad = "   ";
    const t = text[i - start] ?? "";
    const z = i === 1 && zzz ? `\x1b[2m${zzz}\x1b[0m` : "";
    return `  ${row}${pad}${t || z}`;
  });
}

const plain = (s: string) => s.replace(/\x1b\[[0-9;?]*[A-Za-z]/g, "");

export function chestFor(score: number | null | undefined): RGB | undefined {
  if (score === null || score === undefined) return undefined;
  return score >= 80 ? MINT : score >= 50 ? AMBER : hex("#F28B82");
}

export function renderFrame(mood: Mood, caption: Caption, frame: Frame = { glow: true }, tick = 0): string[] {
  const mode = colorMode();
  if (mode === "none") {
    // Piped output, NO_COLOR, or a dumb terminal: plain text only
    const [top, bottom] = TEXT_FACES[mood];
    const rest = caption.lines.map(plain).filter((l) => l.trim());
    return [`   ${top}   ${plain(caption.title)}`, `   ${bottom}   ${rest[0] ?? ""}`, ...rest.slice(1).map((l) => `             ${l}`)];
  }
  const art = toLines(pixels(mood, frame), mode);
  const zzz = mood === "standby" ? ["z", "z Z", "z Z z", ""][tick % 4] : null;
  return compose(art, caption, zzz, faceColor(mood), mode);
}

/* ---------- animation ---------- */

function frameAt(mood: Mood, tick: number): Frame {
  return {
    blink: tick % 16 === 7,
    lift: mood === "happy" && Math.floor(tick / 3) % 2 === 1,
    glow: Math.floor(tick / 4) % 2 === 0,
    shift: mood === "glitching" && tick % 5 === 2 ? (tick % 2 ? 1 : -1) : 0,
  };
}

export function canAnimate(): boolean {
  return colorMode() !== "none" && !process.env.CI && !process.env.BYTE_NO_ANIMATION;
}

const HIDE = "\x1b[?25l";
const SHOW = "\x1b[?25h";

/**
 * Plays the animation in place for `ms` (or forever when ms is Infinity),
 * then leaves the last frame on screen. `getCaption` is called each frame,
 * so live mode can pick up new state.
 */
export async function animate(getView: () => { mood: Mood; caption: Caption; chest?: RGB }, ms: number): Promise<void> {
  if (!canAnimate()) {
    const { mood, caption, chest } = getView();
    console.log(renderFrame(mood, caption, { glow: true, chest }).join("\n"));
    return;
  }
  const out = process.stdout;
  let height = 0;
  const restore = () => out.write(SHOW);
  const onExit = () => {
    restore();
    out.write("\n");
    process.exit(0);
  };
  process.once("SIGINT", onExit);
  out.write(HIDE);
  const end = Date.now() + ms;
  let tick = 0;
  try {
    do {
      const { mood, caption, chest } = getView();
      const lines = renderFrame(mood, caption, { ...frameAt(mood, tick), chest }, tick);
      if (height) out.write(`\x1b[${height}A`);
      out.write(lines.map((l) => `\x1b[2K${l}`).join("\n") + "\n");
      height = lines.length;
      tick++;
      await new Promise((r) => setTimeout(r, 140));
    } while (Date.now() < end);
    // Settle on a calm frame: eyes open, antenna lit
    const { mood, caption, chest } = getView();
    out.write(`\x1b[${height}A` + renderFrame(mood, caption, { glow: true, chest }).map((l) => `\x1b[2K${l}`).join("\n") + "\n");
  } finally {
    process.removeListener("SIGINT", onExit);
    restore();
  }
}


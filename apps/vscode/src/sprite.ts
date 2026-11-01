import type { Mood, Stage } from "@byte/pet";

const C = {
  steel: "#B8C2CF",
  steelDark: "#8E99A8",
  joint: "#6B7484",
  tread: "#2D3340",
  screen: "#0F1115",
  mint: "#7EE0B5",
  amber: "#F2B86B",
  dim: "#3E6E58",
  rust: "#A8A29A",
  cheek: "#F29BA6",
};

/** What the screen face shows for each mood (viewBox 0 0 120 120, screen at 31..89 x 38..76). */
function face(mood: Mood): string {
  switch (mood) {
    case "happy":
      return `
        <path class="eye" d="M40 60 Q46 50 52 60" stroke="${C.mint}" stroke-width="4" fill="none" stroke-linecap="round"/>
        <path class="eye" d="M68 60 Q74 50 80 60" stroke="${C.mint}" stroke-width="4" fill="none" stroke-linecap="round"/>
        <path d="M50 65 Q60 75 70 65 Z" fill="${C.mint}"/>
        <rect x="36" y="64" width="6" height="3" rx="1.5" fill="${C.cheek}"/>
        <rect x="78" y="64" width="6" height="3" rx="1.5" fill="${C.cheek}"/>`;
    case "concerned":
      return `
        <path d="M40 48 L52 52" stroke="${C.amber}" stroke-width="3" stroke-linecap="round"/>
        <path d="M80 48 L68 52" stroke="${C.amber}" stroke-width="3" stroke-linecap="round"/>
        <rect class="eye" x="42" y="55" width="9" height="8" rx="2" fill="${C.amber}"/>
        <rect class="eye" x="69" y="55" width="9" height="8" rx="2" fill="${C.amber}"/>
        <path d="M52 69 L68 69" stroke="${C.amber}" stroke-width="3" stroke-linecap="round"/>`;
    case "low-battery":
      return `
        <circle class="eye" cx="46" cy="55" r="6" fill="none" stroke="${C.mint}" stroke-width="3"/>
        <circle class="eye" cx="74" cy="55" r="6" fill="none" stroke="${C.mint}" stroke-width="3"/>
        <circle cx="46" cy="55" r="2" fill="${C.mint}"/>
        <circle cx="74" cy="55" r="2" fill="${C.mint}"/>
        <circle cx="60" cy="68" r="3.5" fill="none" stroke="${C.mint}" stroke-width="2.5"/>`;
    case "standby":
      return `
        <path d="M40 58 L52 58" stroke="${C.dim}" stroke-width="4" stroke-linecap="round"/>
        <path d="M68 58 L80 58" stroke="${C.dim}" stroke-width="4" stroke-linecap="round"/>
        <path d="M56 67 L64 67" stroke="${C.dim}" stroke-width="3" stroke-linecap="round"/>`;
    case "glitching":
      return `
        <rect x="33" y="46" width="30" height="2" fill="#3A3F4B"/>
        <rect x="55" y="70" width="32" height="2" fill="#3A3F4B"/>
        <path d="M41 51 L51 61 M51 51 L41 61" stroke="${C.amber}" stroke-width="3.5" stroke-linecap="round"/>
        <path d="M69 51 L79 61 M79 51 L69 61" stroke="${C.amber}" stroke-width="3.5" stroke-linecap="round"/>
        <path d="M46 68 Q50 64 54 68 Q58 72 62 68 Q66 64 70 68 Q72 70 74 68" stroke="${C.amber}" stroke-width="2.5" fill="none" stroke-linecap="round"/>`;
  }
}

function antennaColor(mood: Mood): string {
  if (mood === "standby") return "#4A5160";
  if (mood === "happy") return C.mint;
  return C.amber;
}

function bootCapsule(mood: Mood, chest?: string): string {
  const glow = chest ?? (mood === "standby" ? C.dim : mood === "happy" ? C.mint : C.amber);
  // A small window so even a brand-new Byte can blink, look around and react
  return `
    <ellipse cx="60" cy="108" rx="28" ry="4" fill="#000" opacity="0.35"/>
    <rect x="30" y="20" width="60" height="86" rx="18" fill="${C.steel}"/>
    <rect x="38" y="28" width="44" height="30" rx="8" fill="${C.screen}"/>
    <g class="face"><g transform="translate(19.6 1.4) scale(0.66)">${face(mood)}</g></g>
    <path d="M30 66 L90 66" stroke="${C.steelDark}" stroke-width="2"/>
    <rect x="40" y="78" width="40" height="10" rx="5" fill="${C.screen}"/>
    <rect class="loading" x="42" y="80" width="12" height="6" rx="3" fill="${glow}"/>`;
}

function robot(stage: Stage, mood: Mood, chest?: string): string {
  const head = mood === "glitching" ? C.rust : mood === "standby" ? "#9AA4B2" : C.steel;
  const senior = stage === "senior-dev";
  const antennas = senior
    ? `<path d="M44 28 L40 15 M76 28 L80 15" stroke="${C.steelDark}" stroke-width="3"/>
       <circle cx="40" cy="12" r="4" fill="${antennaColor(mood)}"/><circle cx="80" cy="12" r="4" fill="${antennaColor(mood)}"/>`
    : `<path d="M60 28 L60 15" stroke="${C.steelDark}" stroke-width="3"/>
       <circle class="antenna" cx="60" cy="11" r="5" fill="${antennaColor(mood)}"/>`;
  const headset = senior
    ? `<path d="M22 48 C22 16 98 16 98 48" stroke="${C.tread}" stroke-width="5" fill="none"/>
       <rect x="12" y="46" width="12" height="22" rx="5" fill="${C.amber}"/>
       <rect x="96" y="46" width="12" height="22" rx="5" fill="${C.amber}"/>`
    : `<rect x="14" y="48" width="9" height="18" rx="3" fill="${C.joint}"/>
       <rect x="97" y="48" width="9" height="18" rx="3" fill="${C.joint}"/>`;
  const tilt = mood === "glitching" ? ` transform="rotate(-7 60 70)"` : "";
  const sparks =
    mood === "glitching"
      ? `<path d="M100 30 L106 24 M104 36 L112 36 M98 22 L100 14" stroke="${C.amber}" stroke-width="2.5" stroke-linecap="round"/>`
      : "";
  const zzz =
    mood === "standby"
      ? `<text x="92" y="24" font-family="monospace" font-size="14" font-weight="600" fill="#9AA3B2">z</text>
         <text x="102" y="12" font-family="monospace" font-size="18" font-weight="600" fill="#C3C9D4">Z</text>`
      : "";
  const robotBody = `
    <g${tilt}>
      ${antennas}
      ${headset}
      <rect x="22" y="28" width="76" height="58" rx="14" fill="${head}"/>
      <circle cx="28" cy="34" r="1.8" fill="${C.joint}"/><circle cx="92" cy="34" r="1.8" fill="${C.joint}"/>
      <circle cx="28" cy="80" r="1.8" fill="${C.joint}"/><circle cx="92" cy="80" r="1.8" fill="${C.joint}"/>
      <rect x="31" y="38" width="58" height="38" rx="8" fill="${C.screen}"/>
      <g class="face">${face(mood)}</g>
      <rect x="40" y="88" width="40" height="18" rx="5" fill="${C.steelDark}"/>
      <circle cx="52" cy="97" r="3" fill="${C.mint}"/><circle class="chest" cx="60" cy="97" r="3.4" fill="${chest ?? C.amber}"/><circle cx="68" cy="97" r="3" fill="${C.joint}"/>
    </g>`;
  const scale = stage === "mini-bot" ? ` transform="translate(15 22) scale(0.75)"` : "";
  return `
    <ellipse cx="60" cy="112" rx="30" ry="4" fill="#000" opacity="0.35"/>
    <g${scale}>${robotBody}<rect class="tread" x="34" y="106" width="52" height="5" rx="2.5" fill="${C.tread}"/></g>
    ${sparks}${zzz}`;
}

/** chest: the health check light, green, amber or red. */
export function sprite(stage: Stage, mood: Mood, name: string, chest?: "green" | "amber" | "red"): string {
  const light = chest ? { green: C.mint, amber: C.amber, red: "#F28B82" }[chest] : undefined;
  const body = stage === "boot" ? bootCapsule(mood, light) : robot(stage, mood, light);
  return `<svg class="pet pet-${mood}" viewBox="0 0 120 120" width="148" height="148" role="img" aria-label="${name}, ${mood.replace("-", " ")}">${body}</svg>`;
}

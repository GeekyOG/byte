import type { Mood } from "./types";

/** Two-line terminal faces, matching the robot on the canvas. */
export const FACES: Record<Mood, [string, string]> = {
  happy: ["[ ^_^ ]", "/|_=_|\\"],
  concerned: ["[ >_< ]", "/|_!_|\\"],
  "low-battery": ["[ o_o ]", "/|_._|\\"],
  standby: ["[ -_- ]", "/|_z_|\\"],
  glitching: ["[ x_x ]", "/|_#_|\\"],
};

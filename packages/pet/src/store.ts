import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { applyDecay, createPet } from "./engine";
import type { PetState } from "./types";

export function byteHome(): string {
  return process.env.BYTE_HOME ?? path.join(os.homedir(), ".byte");
}

export function statePath(): string {
  return path.join(byteHome(), "state.json");
}

export function loadState(now = new Date()): PetState {
  try {
    const raw = JSON.parse(fs.readFileSync(statePath(), "utf8"));
    if (raw?.version !== 1) return createPet();
    return applyDecay({ ...createPet(), ...raw }, now);
  } catch {
    return createPet();
  }
}

/** Write to a temp file then rename, so a crash never leaves half a file. */
export function saveState(state: PetState): void {
  const file = statePath();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(state, null, 2));
  fs.renameSync(tmp, file);
}

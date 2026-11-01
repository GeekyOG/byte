import { describe, expect, it } from "vitest";
import { applyDecay, applyEvent, createPet, moodFor, stageFor, weekdaysBetween } from "@byte/pet";

// Wednesday 21 Oct 2026, 10:00 local
const wed = new Date(2026, 9, 21, 10);
const at = (days: number, hour = 10) => new Date(2026, 9, 21 + days, hour);

describe("commits", () => {
  it("gives full XP for real commits and less for tiny ones", () => {
    const a = applyEvent(createPet(), { type: "commit", at: wed, linesChanged: 40 });
    expect(a.xp).toBe(5);
    const b = applyEvent(a.state, { type: "commit", at: wed, linesChanged: 1 });
    expect(b.xp).toBe(1);
  });

  it("caps commit XP per day", () => {
    let s = createPet();
    let total = 0;
    for (let i = 0; i < 20; i++) {
      const r = applyEvent(s, { type: "commit", at: wed, linesChanged: 50 });
      s = r.state;
      total += r.xp;
    }
    expect(total).toBe(30);
  });

  it("keeps the streak over a weekend", () => {
    const fri = new Date(2026, 9, 23, 10);
    const mon = new Date(2026, 9, 26, 10);
    let s = applyEvent(createPet(), { type: "commit", at: fri, linesChanged: 10 }).state;
    s = applyEvent(s, { type: "commit", at: mon, linesChanged: 10 }).state;
    expect(s.streakDays).toBe(2);
  });

  it("resets the streak after a missed weekday", () => {
    let s = applyEvent(createPet(), { type: "commit", at: wed, linesChanged: 10 }).state;
    s = applyEvent(s, { type: "commit", at: at(2), linesChanged: 10 }).state; // Friday, skipped Thursday
    expect(s.streakDays).toBe(1);
  });
});

describe("tests", () => {
  it("rewards a green run once, never twice", () => {
    const a = applyEvent(createPet(), { type: "tests", at: wed, passed: 12, failed: 0, skipped: 0, runId: "r1" });
    expect(a.xp).toBe(12);
    const b = applyEvent(a.state, { type: "tests", at: wed, passed: 12, failed: 0, skipped: 0, runId: "r1" });
    expect(b.xp).toBe(0);
  });

  it("makes Byte concerned when tests fail", () => {
    const r = applyEvent(createPet(), { type: "tests", at: wed, passed: 3, failed: 2, skipped: 0, runId: "r2" });
    expect(r.hp).toBe(-4);
    expect(moodFor(r.state, wed)).toBe("concerned");
  });
});

describe("design guard", () => {
  it("makes Byte concerned on new warnings and rewards fixing old ones", () => {
    const a = applyEvent(createPet(), { type: "guard", at: wed, warnings: 2, fixed: 0 });
    expect(a.hp).toBe(-4);
    expect(moodFor(a.state, wed)).toBe("concerned");
    const b = applyEvent(a.state, { type: "guard", at: wed, warnings: 0, fixed: 3 });
    expect(b.xp).toBe(9);
    expect(b.state.guardWarnings).toBe(0);
  });
});

describe("health check", () => {
  it("rewards a better score and worries about critical issues", () => {
    const a = applyEvent(createPet(), { type: "audit", at: wed, score: 60, critical: 1 });
    expect(a.xp).toBe(0);
    expect(moodFor(a.state, wed)).toBe("concerned");
    const b = applyEvent(a.state, { type: "audit", at: wed, score: 90, critical: 0 });
    expect(b.xp).toBe(15); // capped per day
    expect(b.message).toContain("up from 60 to 90");
    const c = applyEvent(b.state, { type: "audit", at: wed, score: 70, critical: 0 });
    expect(c.hp).toBe(-4);
  });
});

describe("lint", () => {
  it("treats the first reading as a baseline, then rewards fixes", () => {
    const a = applyEvent(createPet(), { type: "lint", at: wed, errors: 10 });
    expect(a.xp).toBe(0);
    const b = applyEvent(a.state, { type: "lint", at: wed, errors: 6 });
    expect(b.xp).toBe(8);
  });
});

describe("decay and moods", () => {
  it("does not count weekends as idle", () => {
    expect(weekdaysBetween("2026-10-23", new Date(2026, 9, 26))).toBe(0); // Fri to Mon
  });

  it("loses a little health per idle weekday, capped, and only once per day", () => {
    const s = applyEvent(createPet(), { type: "commit", at: wed, linesChanged: 10 }).state; // health 82
    const later = applyDecay(s, at(2)); // Friday: Thursday was idle
    expect(later.health).toBe(78);
    expect(applyDecay(later, at(2, 18)).health).toBe(78);
    const muchLater = applyDecay(later, at(30));
    expect(muchLater.health).toBe(62); // total loss capped at 20
  });

  it("never decays on vacation", () => {
    let s = applyEvent(createPet(), { type: "commit", at: wed, linesChanged: 10 }).state;
    s = applyEvent(s, { type: "vacation", at: wed, on: true }).state;
    expect(applyDecay(s, at(14)).health).toBe(s.health);
    expect(moodFor(s, at(14))).toBe("standby");
  });

  it("evolves at the XP thresholds", () => {
    expect(stageFor(0)).toBe("boot");
    expect(stageFor(50)).toBe("mini-bot");
    expect(stageFor(200)).toBe("bot");
    expect(stageFor(500)).toBe("senior-dev");
  });
});

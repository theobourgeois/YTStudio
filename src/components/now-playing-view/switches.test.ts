import { describe, expect, it } from "vitest";
import { LIVE_LOOKS, liveLook, seededRandom } from "@shared/live-looks";
import { BLENDS, GLITCHES, PUNCHES, type SwitchReason, switchFor } from "./switches";

const mood = (intensity: number, character: "chill" | "groove" | "hype" | "heavy" | null = "hype") => ({ intensity, character, sure: 0.8 });
const look = (id: string) => liveLook(id)!;
const BEAT = 60 / 128;

describe("switchFor", () => {
  it("cuts on a drop, is quick on a key, flashes in chaos", () => {
    const r = seededRandom("s");
    expect(switchFor("drop", mood(0.9), look("nebula"), look("wormhole"), BEAT, r)).toMatchObject({ type: null, kind: "cut", lands: "now" });
    expect(switchFor("key", mood(0.9), look("nebula"), look("wormhole"), BEAT, r)).toMatchObject({ type: "cross-dissolve", kind: "quick" });
    expect(switchFor("chaos", mood(0.9), look("nebula"), look("chaos-liquid"), BEAT, r)).toMatchObject({ type: "flash", kind: "quick" });
  });

  it("blends slowly in calm parts, a feedback morph about it, two bars (within reason) landing on the bar", () => {
    const r = seededRandom("calm");
    const calm: [SwitchReason, ReturnType<typeof mood>][] = [
      ["breakdown", mood(0.6)],
      ["quiet", mood(0.05)],
      ["song", mood(0.5, null)],
      ["phrase", mood(0.2)],
      ["fit", mood(0.6, "chill")],
    ];
    for (const [reason, m] of calm) {
      const s = switchFor(reason, m, look("galaxy"), look("aurora"), BEAT, r);
      expect(s.kind, reason).toBe("blend");
      expect(BLENDS).toContain(s.type);
      expect(s.morph).toBe(true);
      expect(s.lands).toBe("bar");
      expect(s.seconds).toBeGreaterThanOrEqual(2);
      expect(s.seconds).toBeLessThanOrEqual(4.5);
    }
  });

  it("punches a beat long in a groove, and glitches only where a glitchy look comes or goes", () => {
    const r = seededRandom("groove");
    const plain = LIVE_LOOKS.filter((l) => !l.suits.glitch);
    for (let i = 0; i < 200; i++) {
      const from = plain[i % plain.length];
      const to = plain[(i * 7 + 3) % plain.length];
      const s = switchFor("phrase", mood(0.75), from, to, BEAT, r);
      expect(GLITCHES).not.toContain(s.type);
      expect(PUNCHES).toContain(s.type);
      expect(s.seconds).toBeLessThanOrEqual(s.type === "light-leak" ? 1.4 : 0.7);
    }
    const glitchy = LIVE_LOOKS.filter((l) => l.suits.glitch);
    expect(glitchy.length).toBeGreaterThan(0);
    for (const g of glitchy) expect(GLITCHES).toContain(switchFor("phrase", mood(0.75), look("nebula"), g, BEAT, r).type);
  });
});

import { describe, expect, it } from "vitest";
import { clipRole, modelLookFor, planClips, shouldBurst } from "./model-motion";

const ROBOT = [
  "RobotArmature|Robot_Dance",
  "RobotArmature|Robot_Death",
  "RobotArmature|Robot_Idle",
  "RobotArmature|Robot_Jump",
  "RobotArmature|Robot_Running",
  "RobotArmature|Robot_Wave",
  "Robot_Dance",
  "Robot_Idle",
];

describe("clipRole", () => {
  it("knows an animation by its name, whatever the rig's called", () => {
    expect(clipRole("RobotArmature|Robot_Dance")).toBe("dance");
    expect(clipRole("CharacterArmature|Idle_Neutral")).toBe("loop");
    expect(clipRole("Flying")).toBe("loop");
    expect(clipRole("Gallop")).toBe("loop");
    expect(clipRole("HitRecieve")).toBe("never");
    expect(clipRole("Death")).toBe("never");
    expect(clipRole("Punch_Right")).toBe("burst");
    expect(clipRole("Clapping")).toBe("burst");
    expect(clipRole("Take 001")).toBe("other");
    expect(clipRole("")).toBe("other");
  });
});

describe("planClips", () => {
  const first = () => 0;

  it("dances while the music's going, idles while it's calm, never dies", () => {
    expect(ROBOT[planClips(ROBOT, 0.7, first).base!]).toBe("RobotArmature|Robot_Dance");
    expect(ROBOT[planClips(ROBOT, 0.1, first).base!]).toBe("RobotArmature|Robot_Idle");
    expect(planClips(ROBOT, 0.7, first).bursts.map((i) => ROBOT[i])).toEqual(["RobotArmature|Robot_Jump", "RobotArmature|Robot_Wave"]);
    for (let r = 0; r < 1; r += 0.1) expect(ROBOT[planClips(ROBOT, r, () => r).base!]).not.toMatch(/Death/);
  });

  it("runs when there's no dance and it's intense; plays whatever there is otherwise", () => {
    expect(planClips(["Idle", "Gallop", "Death"], 0.8, first).base).toBe(1);
    expect(planClips(["Take 001"], 0.5, first).base).toBe(0);
    expect(planClips(["Death"], 0.5, first).base).toBeNull();
    expect(planClips([], 0.5, first)).toEqual({ base: null, bursts: [] });
  });
});

describe("modelLookFor", () => {
  it("rings only objects, and keeps a character turning slowly", () => {
    for (let i = 0; i < 50; i++) {
      const r = i / 50;
      const character = modelLookFor({ animated: true }, 0.5, () => r);
      expect(character.style).not.toBe("ring");
      expect(Math.abs(character.spin)).toBeLessThan(0.09);
    }
    const styles = new Set(Array.from({ length: 50 }, (_, i) => modelLookFor({ animated: false }, 0.5, () => i / 50).style));
    expect(styles).toEqual(new Set(["lit", "chrome", "neon", "ring"]));
  });
});

describe("shouldBurst", () => {
  it("goes on a big kick, not too often", () => {
    expect(shouldBurst(0.9, 5, () => 0.1)).toBe(true);
    expect(shouldBurst(0.5, 5, () => 0.1)).toBe(false);
    expect(shouldBurst(0.9, 1, () => 0.1)).toBe(false);
    expect(shouldBurst(0.9, 5, () => 0.9)).toBe(false);
  });
});

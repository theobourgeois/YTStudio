import { describe, expect, it } from "vitest";
import { LatestOnly } from "./latest.ts";

/** A job that finishes when told to, and says whether it was asked to stop. */
function controllable() {
  let finish!: (value: string | null) => void;
  let current: () => boolean = () => true;
  const job = (isCurrent: () => boolean) => {
    current = isCurrent;
    return new Promise<string | null>((resolve) => (finish = resolve));
  };
  return { job, finish: (v: string | null) => finish(v), stillWanted: () => current() };
}

const tick = () => new Promise((r) => setTimeout(r, 0));

describe("LatestOnly", () => {
  it("keeps a result only while its key is still wanted, then makes the newest", async () => {
    const kept: string[] = [];
    const latest = new LatestOnly<string>((key, result) => kept.push(`${key}=${result}`));
    const a = controllable();
    latest.want("a", a.job);
    expect(latest.isRunning("a")).toBe(true);
    // Rapid edits: b, then c, while a is still running. a is told it isn't wanted.
    const b = controllable();
    latest.want("b", b.job);
    const c = controllable();
    latest.want("c", c.job);
    expect(a.stillWanted()).toBe(false);
    a.finish("A");
    await tick();
    // a's result is thrown away; c (the newest) runs next, never b.
    expect(kept).toEqual([]);
    expect(latest.resultFor("a")).toBeNull();
    expect(latest.isRunning("c")).toBe(true);
    c.finish("C");
    await tick();
    expect(kept).toEqual(["c=C"]);
    expect(latest.resultFor("c")).toBe("C");
  });

  it("doesn't make again what it has, and stops when nothing is wanted", async () => {
    let runs = 0;
    const latest = new LatestOnly<number>(() => {});
    const job = async () => ++runs;
    latest.want("x", job);
    await tick();
    latest.want("x", job);
    await tick();
    expect(runs).toBe(1);
    const slow = controllable();
    latest.want("y", slow.job as never);
    latest.want(null);
    expect(slow.stillWanted()).toBe(false);
    slow.finish("late");
    await tick();
    expect(latest.resultFor("y")).toBeNull();
    // A job that gives up (null) or fails keeps nothing.
    latest.want("z", async () => null);
    await tick();
    expect(latest.resultFor("z")).toBeNull();
    latest.want("w", async () => {
      throw new Error("lost");
    });
    await tick();
    expect(latest.resultFor("w")).toBeNull();
  });
});

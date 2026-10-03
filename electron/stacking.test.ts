import { describe, expect, it } from "vitest";
import { Restacker, WindowStack } from "./stacking.ts";

describe("WindowStack", () => {
  it("puts the window used last in front", () => {
    const stack = new WindowStack();
    stack.raise("a");
    stack.raise("b");
    stack.raise("c");
    stack.raise("a");
    expect(stack.order()).toEqual(["b", "c", "a"]);
  });

  it("puts a new window that isn't in use behind the others, and leaves one that's there where it is", () => {
    const stack = new WindowStack();
    stack.raise("a");
    stack.lower("b");
    expect(stack.order()).toEqual(["b", "a"]);
    stack.lower("a");
    expect(stack.order()).toEqual(["b", "a"]);
  });

  it("forgets a window", () => {
    const stack = new WindowStack();
    stack.raise("a");
    stack.raise("b");
    stack.drop("a");
    expect(stack.order()).toEqual(["b"]);
  });
});

describe("Restacker", () => {
  it("raises the windows from the back to the front, across programs, and drops those that are gone", async () => {
    const stack = new WindowStack();
    for (const key of ["panel:rack", "engine:channel:synth", "panel:playlist", "panel:gone"]) stack.raise(key);
    const raised: string[] = [];
    await new Restacker(stack, async (key) => {
      raised.push(key);
      return key !== "panel:gone";
    }).run();
    expect(raised).toEqual(["panel:rack", "engine:channel:synth", "panel:playlist", "panel:gone"]);
    expect(stack.order()).toEqual(["panel:rack", "engine:channel:synth", "panel:playlist"]);
  });

  it("runs once more, with the latest order, when asked during a run", async () => {
    const stack = new WindowStack();
    stack.raise("a");
    stack.raise("b");
    const raised: string[] = [];
    let restacker!: Restacker;
    restacker = new Restacker(stack, async (key) => {
      raised.push(key);
      if (raised.length === 1) {
        stack.raise("a");
        void restacker.run();
      }
      return true;
    });
    await restacker.run();
    expect(raised).toEqual(["a", "b", "b", "a"]);
  });
});

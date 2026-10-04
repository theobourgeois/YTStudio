import { describe, expect, it } from "vitest";
import { familyGroups, leakingItem, splitByFamily, type FamilyItem } from "./families.ts";

const item = (id: string, ...families: string[]): FamilyItem => ({ id, families });

describe("familyGroups", () => {
  it("keeps unrelated families apart, each sorted", () => {
    expect(familyGroups([item("a", "f1"), item("b", "f2"), item("c", "f1")])).toEqual([["f1"], ["f2"]]);
  });

  it("joins the families of a mix", () => {
    expect(familyGroups([item("voc", "v1"), item("beat", "b1"), item("mix", "v1", "b1"), item("other", "o1")])).toEqual([["b1", "v1"], ["o1"]]);
  });

  it("joins through a chain of mixes", () => {
    expect(familyGroups([item("m1", "a", "b"), item("m2", "b", "c"), item("m3", "d", "e")])).toEqual([["a", "b", "c"], ["d", "e"]]);
  });

  it("is the same whatever the order of the items", () => {
    const items = [item("m1", "a", "b"), item("m2", "c", "d"), item("m3", "b", "c"), item("x", "z")];
    expect(familyGroups([...items].reverse())).toEqual(familyGroups(items));
  });

  it("is empty for nothing", () => {
    expect(familyGroups([])).toEqual([]);
  });
});

describe("splitByFamily", () => {
  const dataset = (families: number, perFamily = 3): FamilyItem[] => Array.from({ length: families }, (_, f) => Array.from({ length: perFamily }, (_, i) => item(`f${f}-${i}`, `fam${f}`))).flat();

  it("puts every item of a family in one split", () => {
    const items = dataset(10);
    const { assignment } = splitByFamily(items, { seed: "s", testFraction: 0.3, devFraction: 0.2 });
    for (let f = 0; f < 10; f++) expect(new Set([0, 1, 2].map((i) => assignment[`f${f}-${i}`])).size).toBe(1);
    expect(leakingItem(items, assignment)).toBeNull();
  });

  it("keeps a mix with the families it's made from", () => {
    const items = [...dataset(8), item("mix-a", "fam0", "fam1"), item("mix-b", "fam1", "fam2")];
    const { assignment } = splitByFamily(items, { seed: "s", testFraction: 0.4 });
    expect(new Set([assignment["f0-0"], assignment["f1-0"], assignment["f2-0"], assignment["mix-a"], assignment["mix-b"]]).size).toBe(1);
    expect(leakingItem(items, assignment)).toBeNull();
  });

  it("is deterministic, and the same whatever the order of the items", () => {
    const items = dataset(12);
    const a = splitByFamily(items, { seed: "s", testFraction: 0.25 }).assignment;
    expect(splitByFamily([...items].reverse(), { seed: "s", testFraction: 0.25 }).assignment).toEqual(a);
    expect(splitByFamily(items, { seed: "s", testFraction: 0.25 }).assignment).toEqual(a);
  });

  it("changes with the seed", () => {
    const items = dataset(20);
    const runs = new Set(["a", "b", "c", "d", "e"].map((seed) => JSON.stringify(splitByFamily(items, { seed, testFraction: 0.3 }).assignment)));
    expect(runs.size).toBeGreaterThan(1);
  });

  it("holds out about the fraction asked, counted in groups", () => {
    const { assignment } = splitByFamily(dataset(10, 1), { seed: "s", testFraction: 0.3, devFraction: 0.2 });
    const counts = { train: 0, dev: 0, test: 0 };
    for (const split of Object.values(assignment)) counts[split]++;
    expect(counts).toEqual({ train: 5, dev: 2, test: 3 });
  });

  it("holds out at least one group for a fraction above zero, and always leaves one in train", () => {
    const two = splitByFamily(dataset(2, 1), { seed: "s", testFraction: 0.01 }).assignment;
    expect(Object.values(two).sort()).toEqual(["test", "train"]);
    const all = splitByFamily(dataset(4, 1), { seed: "s", testFraction: 1, devFraction: 1 }).assignment;
    expect(Object.values(all).filter((s) => s === "train")).toHaveLength(1);
  });

  it("holds nothing out of one group, or when nothing is asked", () => {
    expect(Object.values(splitByFamily(dataset(1), { seed: "s", testFraction: 0.5 }).assignment).every((s) => s === "train")).toBe(true);
    expect(Object.values(splitByFamily(dataset(6), { seed: "s", testFraction: 0 }).assignment).every((s) => s === "train")).toBe(true);
  });

  it("treats a nonsense fraction as none", () => {
    expect(Object.values(splitByFamily(dataset(6), { seed: "s", testFraction: NaN }).assignment).every((s) => s === "train")).toBe(true);
  });

  it("refuses an item with no family, naming it", () => {
    expect(() => splitByFamily([item("lonely")], { seed: "s", testFraction: 0.5 })).toThrow(/Item lonely has no recording family/);
  });

  it("handles no items", () => {
    expect(splitByFamily([], { seed: "s", testFraction: 0.5 })).toEqual({ assignment: {}, groups: [] });
  });
});

describe("leakingItem", () => {
  it("finds an item whose family is on both sides", () => {
    const items = [item("a", "f1"), item("b", "f1"), item("c", "f2")];
    expect(leakingItem(items, { a: "train", b: "test", c: "train" })).toEqual(item("b", "f1"));
    expect(leakingItem(items, { a: "train", b: "train", c: "test" })).toBeNull();
  });

  it("finds a mix that straddles its sources' splits", () => {
    const items = [item("v", "v1"), item("b", "b1"), item("mix", "v1", "b1")];
    expect(leakingItem(items, { v: "train", b: "test", mix: "train" })?.id).toBe("mix");
    expect(leakingItem(items, { v: "train", b: "train", mix: "test" })?.id).toBe("mix");
  });
});

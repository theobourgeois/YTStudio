/**
 * Recording families: a family is one source recording and everything made from it (crops, a dry and a processed
 * version, a mix it's in, generated variations). Splitting a dataset into train and test must never put two of a
 * family on both sides, or "held-out" results are results on audio the model has heard. A mix joins the families
 * of everything in it, so those families stay together too.
 */
import { sha256 } from "../hash.ts";

export interface FamilyItem {
  id: string;
  /** The families this item is made from: one for a recording, several for a mix of recordings. At least one. */
  families: readonly string[];
}

export const SPLITS = ["train", "dev", "test"] as const;
export type Split = (typeof SPLITS)[number];

export interface SplitOptions {
  /** Same seed, same split; any item order. */
  seed: string;
  /** 0..1 of the groups (not the items) held out. A fraction above zero holds out at least one group when there are two or more. */
  testFraction: number;
  devFraction?: number;
}

export interface FamilySplit {
  /** By item id. */
  assignment: Record<string, Split>;
  /** The families that are joined by a mix, as sorted lists, in a stable order. */
  groups: string[][];
}

/** The groups of families connected by the items made from several of them (union-find). Each is sorted; the lists are in order of their first family. */
export function familyGroups(items: readonly FamilyItem[]): string[][] {
  const parent = new Map<string, string>();
  const find = (family: string): string => {
    let root = family;
    while (parent.get(root) !== root) root = parent.get(root) as string;
    // Compress the path.
    for (let at = family; at !== root; ) {
      const next = parent.get(at) as string;
      parent.set(at, root);
      at = next;
    }
    return root;
  };
  for (const item of items) for (const family of item.families) if (!parent.has(family)) parent.set(family, family);
  for (const item of items) {
    const [first, ...rest] = item.families;
    for (const family of rest) parent.set(find(family), find(first));
  }
  const groups = new Map<string, string[]>();
  for (const family of parent.keys()) groups.set(find(family), [...(groups.get(find(family)) ?? []), family]);
  return [...groups.values()].map((g) => g.sort()).sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
}

/**
 * Assigns each item to a split, a whole group of families at a time, so no family is in two. Groups are ordered by
 * a hash of the seed and the group's first family (never by the order of the items), the first go to test, the next
 * to dev and the rest to train; at least one group stays in train.
 */
export function splitByFamily(items: readonly FamilyItem[], options: SplitOptions): FamilySplit {
  for (const item of items) if (item.families.length === 0) throw new Error(`Item ${item.id} has no recording family: every item belongs to one.`);
  const groups = familyGroups(items);
  const ordered = groups
    .map((group) => ({ group, score: sha256(`${options.seed}\u0000${group[0]}`) }))
    .sort((a, b) => (a.score < b.score ? -1 : a.score > b.score ? 1 : 0));

  const n = ordered.length;
  const clamp = (v: number | undefined) => Math.min(1, Math.max(0, Number.isFinite(v) ? (v as number) : 0));
  const want = (fraction: number) => (fraction > 0 && n >= 2 ? Math.max(1, Math.round(fraction * n)) : 0);
  let test = want(clamp(options.testFraction));
  let dev = want(clamp(options.devFraction));
  while (test + dev > Math.max(0, n - 1)) {
    if (dev > 0 && dev >= test) dev--;
    else test--;
  }

  const splitOf = new Map<string, Split>();
  ordered.forEach(({ group }, i) => {
    const split: Split = i < test ? "test" : i < test + dev ? "dev" : "train";
    for (const family of group) splitOf.set(family, split);
  });
  const assignment: Record<string, Split> = {};
  for (const item of items) assignment[item.id] = splitOf.get(item.families[0]) as Split;
  return { assignment, groups };
}

/** The first item whose families are in more than one split, or null: the check a dataset's own split has to pass. */
export function leakingItem(items: readonly FamilyItem[], assignment: Readonly<Record<string, Split>>): FamilyItem | null {
  const splitOfFamily = new Map<string, Split>();
  for (const item of items) {
    const split = assignment[item.id];
    for (const family of item.families) {
      const seen = splitOfFamily.get(family);
      if (seen && seen !== split) return item;
      splitOfFamily.set(family, split);
    }
  }
  return null;
}

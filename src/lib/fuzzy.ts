/**
 * Fuzzy matching for typed searches (the command palette): the query's characters in order, anywhere in
 * the text, scored so the match a person means comes first. Pure, so it's tested.
 */

/** Where the query matched, and how well (higher is better); null if it doesn't. */
export interface FuzzyMatch {
  score: number;
  /** The indexes in the text of the characters matched, to bold them. */
  indexes: number[];
}

const isBoundary = (text: string, index: number) => index === 0 || /[\s\-_/.:›(]/.test(text[index - 1]) || (/[a-z]/.test(text[index - 1]) && /[A-Z]/.test(text[index]));

/**
 * The query (spaces ignored, case too) against the text. A run of characters together scores more than
 * the same characters spread out, a character at a word's start more than one inside it, and an earlier
 * match more than a later one: "pr" finds "Piano roll" before "Open recent", "tog" "Toggle" before "Stop going".
 */
export function fuzzyMatch(query: string, text: string): FuzzyMatch | null {
  const q = query.toLowerCase().replace(/\s+/g, "");
  if (!q) return { score: 0, indexes: [] };
  const lower = text.toLowerCase();
  // A whole run first: the strongest match there is.
  const at = lower.indexOf(q);
  if (at >= 0) {
    const indexes = Array.from({ length: q.length }, (_, i) => at + i);
    return { score: 100 + q.length * 10 + (isBoundary(text, at) ? 40 : 0) - at, indexes };
  }
  // Else each character in order, preferring a word's start for each (greedy, from the left).
  const indexes: number[] = [];
  let from = 0;
  for (const ch of q) {
    let found = -1;
    for (let i = from; i < lower.length; i++) {
      if (lower[i] !== ch) continue;
      if (found < 0) found = i;
      if (isBoundary(text, i)) {
        found = i;
        break;
      }
    }
    if (found < 0) return null;
    indexes.push(found);
    from = found + 1;
  }
  let score = 0;
  indexes.forEach((index, i) => {
    score += isBoundary(text, index) ? 12 : 1;
    if (i > 0 && index === indexes[i - 1] + 1) score += 6;
  });
  return { score: score - indexes[0] * 0.5 - (indexes[indexes.length - 1] - indexes[0]) * 0.2, indexes };
}

/** Something a palette can find: its words, and the extra words it answers to. */
export interface Rankable {
  id: string;
  title: string;
  /** What it's under ("Piano roll"), matched too, a little weaker than the title. */
  group?: string;
  /** Other words for it ("delete" for Remove...), matched as the title is but not shown. */
  keywords?: readonly string[];
}

export interface Ranked<T> {
  item: T;
  /** The title's characters matched (none when the match was in its group or keywords). */
  indexes: number[];
}

/**
 * The items matching the query, best first. With no query, the recently used ones first (most recent
 * first), then the `preferred` ones, then the rest in their order; with one, a recent or preferred
 * item wins a tie.
 */
export function rankItems<T extends Rankable>(items: readonly T[], query: string, recent: readonly string[] = [], preferred?: (item: T) => boolean): Ranked<T>[] {
  const recency = (id: string) => {
    const i = recent.indexOf(id);
    return i < 0 ? 0 : recent.length - i;
  };
  const scored = items.flatMap((item, order) => {
    const title = fuzzyMatch(query, item.title);
    // The group with the title a little weaker than the title alone, the unseen keywords weaker still: a
    // title that matches ("pno": Piano Roll) beats a keyword whose words happen to start with the letters (play notes).
    const weaker = (text: string | undefined, by: number) => {
      const match = text ? fuzzyMatch(query, text) : null;
      return match ? match.score - by : -Infinity;
    };
    const best = Math.max(title?.score ?? -Infinity, weaker(item.group && `${item.group} ${item.title}`, 8), ...(item.keywords ?? []).map((k) => weaker(k, 16)));
    if (best === -Infinity) return [];
    const bonus = recency(item.id) * (query ? 2 : 1000) + (preferred?.(item) ? (query ? 5 : 500) : 0);
    return [{ item, indexes: title?.indexes ?? [], score: best + bonus, order }];
  });
  return scored.sort((a, b) => b.score - a.score || a.order - b.order).map(({ item, indexes }) => ({ item, indexes }));
}

/** The recently used ids with one more at their front (kept to `max`). */
export function remember(recent: readonly string[], id: string, max = 12): string[] {
  return [id, ...recent.filter((r) => r !== id)].slice(0, max);
}

/**
 * The Browser (`docs/fl-studio/browser.md`): the user's own sample folders, the same in every project,
 * listed, searched and previewed. The server keeps the folders and an index of what's in them
 * (`server/music/browser.ts`); the search itself is pure and lives here, so it's tested on its own.
 */

/** A folder the user added to the Browser (dropped from Finder). It stays where it is on disk. */
export interface BrowserRoot {
  /** Absolute. */
  path: string;
  /** The folder's own name. */
  name: string;
  /** It isn't there any more (a drive unplugged, a folder moved): kept, shown greyed. */
  missing: boolean;
}

/** What `GET /api/browser` returns: everything the Browser shows before a folder is opened. */
export interface BrowserState {
  roots: BrowserRoot[];
  /** Files and folders starred, by absolute path, in the order they were starred. */
  favourites: string[];
  /** Files and folders in the index (what the search looks through). */
  indexed: number;
  /** A folder is still being read for the index. */
  indexing: boolean;
}

/** A row of a folder: a folder or an audio file in it. */
export interface BrowserItem {
  /** Absolute. */
  path: string;
  name: string;
  kind: "folder" | "file";
}

/** A search result: the item and where it is (its folder, from its root's name), for the list. */
export interface BrowserHit extends BrowserItem {
  /** The folders it's in, from the root's name down: "Drums/808 Kit". */
  folder: string;
}

export interface BrowserSearchResult {
  hits: BrowserHit[];
  /** Matches in all, of which `hits` are the best. */
  total: number;
}

export interface AddBrowserRootRequest {
  path: string;
}
/**
 * One of the Browser's files into a song (`POST /api/browser/use`): answered with the project's media copy of
 * it. A file in its folders (`path`), or an online clip's sound (`url`, named `title`, else the link's own).
 */
export interface UseBrowserFileRequest {
  projectId: string;
  path?: string;
  url?: string;
  title?: string;
}
export interface SetBrowserFavouriteRequest {
  path: string;
  favourite: boolean;
}

/** The files the Browser shows: what the engine can play (JUCE's formats on macOS). */
export const AUDIO_EXTENSIONS = new Set(["wav", "wave", "aif", "aiff", "aifc", "flac", "mp3", "ogg", "oga", "m4a", "caf"]);

export function isAudioName(name: string): boolean {
  const dot = name.lastIndexOf(".");
  return dot > 0 && AUDIO_EXTENSIONS.has(name.slice(dot + 1).toLowerCase());
}

/** A name without its extension (what's searched, and what a channel is called). */
export function baseName(name: string): string {
  const dot = name.lastIndexOf(".");
  return dot > 0 ? name.slice(0, dot) : name;
}

const COLLATOR = new Intl.Collator(undefined, { numeric: true, sensitivity: "base" });

/** Finder's order: "Kick 2" before "Kick 10", case ignored. */
export const naturalCompare = (a: string, b: string): number => COLLATOR.compare(a, b) || (a < b ? -1 : a > b ? 1 : 0);

/** A folder's rows as the tree shows them: folders first, then files, each in Finder's order. */
export function sortItems(items: BrowserItem[]): BrowserItem[] {
  return items.toSorted((a, b) => (a.kind === b.kind ? naturalCompare(a.name, b.name) : a.kind === "folder" ? -1 : 1));
}

// --- Search ---------------------------------------------------------------------------------------

/** An item made ready to search: its words worked out once, when it's indexed. */
export interface SearchEntry extends BrowserHit {
  /** The name without its extension, lower case. */
  key: string;
  /** The name's words, lower case: "KickHard_808" is kick, hard, 808. */
  words: string[];
  /** The folder, lower case. */
  folderKey: string;
}

/** Words of a name or a query: split at anything but letters and digits, at camelCase and between letters and digits. */
export function wordsOf(text: string): string[] {
  return text
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/([A-Za-z])(\d)|(\d)([A-Za-z])/g, (_m, a, b, c, d) => (a ? `${a} ${b}` : `${c} ${d}`))
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter(Boolean);
}

export function searchEntry(item: BrowserItem, folder: string): SearchEntry {
  const base = item.kind === "file" ? baseName(item.name) : item.name;
  return { ...item, folder, key: base.toLowerCase(), words: wordsOf(base), folderKey: folder.toLowerCase() };
}

/**
 * Whether `a` and `b` are at most `max` edits apart (a letter added, removed, changed, or two swapped).
 * Bounded, so it gives up early on words that are far apart: it runs on every word of a big index.
 */
export function withinEdits(a: string, b: string, max: number): boolean {
  if (Math.abs(a.length - b.length) > max) return false;
  if (a === b) return true;
  const n = b.length;
  let prev2 = new Array<number>(n + 1).fill(0);
  let prev = Array.from({ length: n + 1 }, (_, j) => j);
  let row = new Array<number>(n + 1).fill(0);
  for (let i = 1; i <= a.length; i++) {
    row[0] = i;
    let best = i;
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      let d = Math.min(prev[j] + 1, row[j - 1] + 1, prev[j - 1] + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) d = Math.min(d, prev2[j - 2] + 1);
      row[j] = d;
      if (d < best) best = d;
    }
    if (best > max) return false;
    [prev2, prev, row] = [prev, row, prev2];
  }
  return prev[n] <= max;
}

/** How many typos a word of the query may have: none when it's short (they'd match everything). */
const typosAllowed = (word: string): number => (word.length >= 8 ? 2 : word.length >= 4 ? 1 : 0);

/** How well one word of the query matches an entry: 0 is not at all. */
function wordScore(entry: SearchEntry, word: string): number {
  let best = 0;
  for (const w of entry.words) {
    if (w === word) return 12;
    if (w.startsWith(word)) best = Math.max(best, 10);
  }
  if (best) return best;
  if (entry.key.includes(word)) return 6;
  if (entry.folderKey.includes(word)) return 3;
  const typos = typosAllowed(word);
  if (typos) {
    for (const w of entry.words) {
      // The whole word, or as much of it as has been typed ("snre" for "snare", "kcik" for "kicks").
      if (withinEdits(word, w, typos) || (w.length > word.length && withinEdits(word, w.slice(0, word.length), typos))) return 2;
    }
  }
  return 0;
}

/**
 * The entries matching `query`, best first: every word of it must match the entry's name (a whole word,
 * the start of one, or anywhere in it), its folder, or a word of its name with a typo or two. Words are
 * in any order. Ties go to favourites, then to what's less deep, then to Finder's order.
 */
export function searchEntries(
  entries: readonly SearchEntry[],
  query: string,
  options: { limit?: number; favourites?: ReadonlySet<string> } = {},
): BrowserSearchResult {
  const words = wordsOf(query);
  // "kick808" is also looked for whole, as typed (the words split it).
  const whole = query.trim().toLowerCase();
  if (!words.length) return { hits: [], total: 0 };
  const limit = options.limit ?? 200;
  const scored: { entry: SearchEntry; score: number }[] = [];
  for (const entry of entries) {
    let score = 0;
    for (const word of words) {
      const s = wordScore(entry, word);
      if (!s) {
        score = 0;
        break;
      }
      score += s;
    }
    if (!score) continue;
    if (words.length > 1 && entry.key.includes(whole)) score += 4;
    if (entry.key === whole) score += 4;
    if (options.favourites?.has(entry.path)) score += 3;
    scored.push({ entry, score });
  }
  scored.sort(
    (a, b) =>
      b.score - a.score ||
      depth(a.entry.folder) - depth(b.entry.folder) ||
      naturalCompare(a.entry.name, b.entry.name) ||
      naturalCompare(a.entry.folder, b.entry.folder),
  );
  return {
    hits: scored.slice(0, limit).map(({ entry }) => ({ path: entry.path, name: entry.name, kind: entry.kind, folder: entry.folder })),
    total: scored.length,
  };
}

function depth(folder: string): number {
  let n = 0;
  for (const c of folder) if (c === "/") n++;
  return n;
}

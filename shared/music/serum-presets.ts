/**
 * The Serum player's preset browser (`docs/serum/player.md` §3.2), pure: what a preset in Serum's library is, the
 * category it's listed under, and the list a search and the filters leave, best first. The server indexes the
 * files (`server/music/serum/library.ts`); the tab and the assistant search the same list the same way.
 */
import { naturalCompare, withinEdits, wordsOf } from "./browser.ts";
import type { SerumEnvelope, SerumHistory, SerumLfo, SerumModRoute, SerumOscillator } from "./serum-sound.ts";
import type { SerumFxRack } from "./serum-effects.ts";

/** A preset file in Serum's library: a Serum 2 `.SerumPreset` or a Serum 1 `.fxp` (Serum 2 converts it as it loads it). */
export interface SerumPresetEntry {
  /** The file, whole: what loading it hands the engine (`POST /api/music/serum/load`). */
  path: string;
  name: string;
  /** "" when it says none. */
  author: string;
  description: string;
  /** Serum's own tags (Wavetable, Mono, Multisample…), as the file or Serum's index says. */
  tags: string[];
  /** One of `SERUM_CATEGORIES`, from Serum's index, else the name, else the folder (`serumCategory`). */
  category: SerumCategory;
  /** Its folder within the library ("Factory/Pad", "Serum Starred Presets"); "" at the top. */
  folder: string;
  kind: "serum2" | "serum1";
  /** What Serum keys its ratings by (`serumPresetHash`). */
  hash: string;
  /** Serum's stars, 0 (none) to 5. */
  rating: number;
}

export const SERUM_CATEGORIES = ["Bass", "Lead", "Pad", "Pluck", "Keys", "Synth", "Arp", "Seq", "Chord", "Vocal", "Guitar", "Orchestral", "Drums", "FX", "Other"] as const;
export type SerumCategory = (typeof SERUM_CATEGORIES)[number];

/** A rating from which a preset counts as a favourite (★): 4 and 5 stars do (Théo's choice). */
export const FAVOURITE_RATING = 4;

/** Serum's own categories (its index's `category`, Serum 1's too) as ours. */
const SERUM_CATEGORY: Record<string, SerumCategory> = {
  bass: "Bass",
  "808": "Bass",
  lead: "Lead",
  pad: "Pad",
  soundscape: "Pad",
  pluck: "Pluck",
  mallet: "Pluck",
  keyboard: "Keys",
  keys: "Keys",
  "elec.piano": "Keys",
  piano: "Keys",
  organ: "Keys",
  synth: "Synth",
  hoover: "Synth",
  sawtooth: "Synth",
  midrange: "Synth",
  arpeggio: "Arp",
  arp: "Arp",
  seq: "Seq",
  loop: "Seq",
  chord: "Chord",
  choir: "Vocal",
  vocal: "Vocal",
  guitar: "Guitar",
  brass: "Orchestral",
  string: "Orchestral",
  orchestra: "Orchestral",
  drum: "Drums",
  drumkit: "Drums",
  perc: "Drums",
  sfx: "FX",
  fx: "FX",
  hit: "FX",
  woodwind: "Orchestral",
  wind: "Orchestral",
};

/** Words in a preset's name that say what it is: "MO_SHINJU_LD_Wex", "pl - good", "[PS] pad [sense]", "BA 8bitfwap". */
const NAME_WORDS: Record<string, SerumCategory> = {
  ba: "Bass",
  bs: "Bass",
  bass: "Bass",
  reese: "Bass",
  sub: "Bass",
  ld: "Lead",
  lead: "Lead",
  pd: "Pad",
  pad: "Pad",
  pl: "Pluck",
  pluck: "Pluck",
  bell: "Pluck",
  bl: "Pluck",
  ky: "Keys",
  key: "Keys",
  keys: "Keys",
  ep: "Keys",
  piano: "Keys",
  organ: "Keys",
  sy: "Synth",
  synth: "Synth",
  arp: "Arp",
  seq: "Seq",
  sq: "Seq",
  chord: "Chord",
  chords: "Chord",
  vox: "Vocal",
  vocal: "Vocal",
  choir: "Vocal",
  guitar: "Guitar",
  gtr: "Guitar",
  br: "Orchestral",
  brass: "Orchestral",
  strings: "Orchestral",
  str: "Orchestral",
  drum: "Drums",
  kick: "Drums",
  perc: "Drums",
  fx: "FX",
  sfx: "FX",
  riser: "FX",
};

/** Longer words a name may hold run together with others ("bassssss234", "eselbass", "jumpkey2"), the surest first. */
const NAME_PARTS: [string, SerumCategory][] = [
  ["bass", "Bass"],
  ["lead", "Lead"],
  ["pluck", "Pluck"],
  ["chord", "Chord"],
  ["pad", "Pad"],
  ["arp", "Arp"],
  ["key", "Keys"],
  ["synth", "Synth"],
  ["vox", "Vocal"],
];

/**
 * The category a preset is listed under: Serum's own if its index gives one, else the first word of its name that
 * says one, else its folder's (Factory/Pad), else a word inside its name's ("eselbass"), else Other.
 */
export function serumCategory(name: string, serumOwn: string | null | undefined, folder: string): SerumCategory {
  const own = SERUM_CATEGORY[(serumOwn ?? "").trim().toLowerCase()];
  if (own) return own;
  for (const word of wordsOf(name)) if (NAME_WORDS[word]) return NAME_WORDS[word];
  for (const part of folder.split("/").reverse()) {
    const byFolder = SERUM_CATEGORY[part.trim().toLowerCase()] ?? wordsOf(part).map((w) => NAME_WORDS[w] ?? SERUM_CATEGORY[w]).find(Boolean);
    if (byFolder) return byFolder;
  }
  const lower = name.toLowerCase();
  return NAME_PARTS.find(([part]) => lower.includes(part))?.[1] ?? "Other";
}

/** What the list is narrowed to, besides a search. */
export interface SerumPresetFilter {
  category?: SerumCategory | null;
  /** Rated `FAVOURITE_RATING` or more. */
  favourites?: boolean;
  kind?: "serum2" | "serum1" | null;
  /** A folder of the library and what's inside it. */
  folder?: string | null;
}

/** The words a preset is found by: its name's, then its author's, folder's, category's and tags'. */
interface Searchable {
  entry: SerumPresetEntry;
  name: string;
  nameWords: string[];
  otherWords: string[];
}

const searchable = (entry: SerumPresetEntry): Searchable => ({
  entry,
  name: entry.name.toLowerCase(),
  nameWords: wordsOf(entry.name),
  otherWords: [...wordsOf(entry.author), ...wordsOf(entry.folder), entry.category.toLowerCase(), ...entry.tags.flatMap(wordsOf)],
});

/** How well one word of a query matches a preset (0: not at all): its name first, then the rest, then with a typo. */
function wordScore(item: Searchable, word: string): number {
  let best = 0;
  for (const w of item.nameWords) {
    if (w === word) return 12;
    if (w.startsWith(word)) best = Math.max(best, 10);
  }
  if (best) return best;
  if (item.name.includes(word)) return 7;
  for (const w of item.otherWords) {
    if (w === word) return 6;
    if (w.startsWith(word)) best = Math.max(best, 4);
  }
  if (best) return best;
  const typos = word.length >= 8 ? 2 : word.length >= 4 ? 1 : 0;
  if (typos) for (const w of item.nameWords) if (withinEdits(word, w, typos) || (w.length > word.length && withinEdits(word, w.slice(0, word.length), typos))) return 2;
  return 0;
}

const inFolder = (entry: SerumPresetEntry, folder: string) => entry.folder === folder || entry.folder.startsWith(`${folder}/`);

/**
 * The presets a search and the filters leave, in the list's order: with a query, every word of it must match (the
 * name, the author, folder, category or tags, or the name with a typo), best first, the better rated first among
 * equals; without one, by name. The list the player shows and the arrow keys step through.
 */
export function findSerumPresets(entries: readonly SerumPresetEntry[], query: string, filter: SerumPresetFilter = {}): SerumPresetEntry[] {
  const kept = entries.filter(
    (e) =>
      (!filter.category || e.category === filter.category) &&
      (!filter.favourites || e.rating >= FAVOURITE_RATING) &&
      (!filter.kind || e.kind === filter.kind) &&
      (!filter.folder || inFolder(e, filter.folder)),
  );
  const words = wordsOf(query);
  if (!words.length) return kept.sort((a, b) => naturalCompare(a.name, b.name) || naturalCompare(a.folder, b.folder));
  const whole = query.trim().toLowerCase();
  const scored: { entry: SerumPresetEntry; score: number }[] = [];
  for (const entry of kept) {
    const item = searchable(entry);
    let score = 0;
    for (const word of words) {
      const s = wordScore(item, word);
      if (!s) {
        score = 0;
        break;
      }
      score += s;
    }
    if (!score) continue;
    if (item.name === whole) score += 6;
    else if (words.length > 1 && item.name.includes(whole)) score += 4;
    scored.push({ entry, score });
  }
  return scored
    .sort((a, b) => b.score - a.score || b.entry.rating - a.entry.rating || naturalCompare(a.entry.name, b.entry.name))
    .map(({ entry }) => entry);
}

/**
 * The preset `step` places from `current` in `list` (the arrow keys): the first (or last, going up) when `current`
 * isn't in it; null when the list is empty. Stops at the ends, as a list does.
 */
export function stepSerumPreset(list: readonly SerumPresetEntry[], current: string | null, step: number): SerumPresetEntry | null {
  if (!list.length) return null;
  const at = current === null ? -1 : list.findIndex((e) => e.path === current);
  if (at < 0) return step < 0 ? list[list.length - 1] : list[0];
  return list[Math.max(0, Math.min(list.length - 1, at + step))];
}

/** Whether a channel's plugin is Serum 2: the Serum player is then its window. */
export function isSerum2(plugin: { name: string } | null | undefined): boolean {
  return plugin?.name === "Serum 2";
}

/** Serum 2's macro controls (their VST3 parameter ids, as `parameters` and `setParameter` take them): Macro 1 to 8. */
export const SERUM_MACRO_PARAMS = Array.from({ length: 8 }, (_, i) => String(7_000_000 + i * 1000));

/** One of the macros of the Serum on a channel: its control, the name Serum shows, where it is (0 to 1). */
export interface SerumMacro {
  /** 0 to 7. */
  index: number;
  /** Its parameter's id (`SERUM_MACRO_PARAMS`). */
  param: string;
  /** The preset's name for it, or Serum's ("Macro 3"). */
  name: string;
  value: number;
  text: string;
}

/**
 * What the Serum on a channel has on (`GET /api/music/serum/sound`): its preset as Serum says, its macros, and its
 * mod matrix, envelopes and LFOs (`serum-sound.ts`).
 */
export interface SerumSound {
  /** Null before Serum has said (a channel just added). `path`: the file it was loaded from, when Serum knows it. */
  preset: { name: string; path: string | null } | null;
  macros: SerumMacro[];
  /** The mod matrix's routes; null while Serum's state can't be read (none saved yet). */
  modulation: SerumModRoute[] | null;
  envelopes: SerumEnvelope[];
  lfos: SerumLfo[];
  /** A, B, C, Noise and Sub (none while Serum's state can't be read). */
  oscillators: SerumOscillator[];
  /** The three effect racks, Main, Bus 1 and Bus 2 (none while Serum's state can't be read). */
  effects: SerumFxRack[];
  /** Changed in the player since the preset was loaded. */
  edited: boolean;
  history: SerumHistory;
}

/** `GET /api/music/serum/presets`: the library, or why there's none. */
export interface SerumLibraryResponse {
  /** False: there's no preset folder at all (no Serum 2, and none added). */
  available: boolean;
  presets: SerumPresetEntry[];
}

/** A folder the library lists: Serum 2's own, Serum 1's when Serum links it, or one added in Settings. */
export interface SerumLibraryFolder {
  path: string;
  source: "serum2" | "serum1" | "added";
  /** How many presets are in it (0 while it's missing). */
  presets: number;
  /** An added folder that isn't there now (a drive unplugged): listed again when it's back. */
  missing: boolean;
}

/** `GET /api/music/serum/folders`: what the library lists, and folders of Serum presets found that it doesn't yet. */
export interface SerumLibraryFolders {
  folders: SerumLibraryFolder[];
  /** E.g. Serum 1's library in iCloud Drive, which Serum 2 doesn't see: added with a click. */
  suggested: { path: string; label: string }[];
}

/** `POST /api/music/serum/save`: the sound saved as a preset, and where. */
export interface SerumSaveResult {
  sound: SerumSound;
  /** The `.SerumPreset` written (in Serum 2's `User` folder). */
  path: string;
  /** It replaced a preset of that name. */
  replaced: boolean;
}

/** Why a preset's name can't be a file's name in Serum's `User` folder, or null if it can. */
export function serumPresetNameProblem(name: string): string | null {
  const trimmed = name.trim();
  if (!trimmed) return "Give the preset a name.";
  if (trimmed.length > 100) return "That name is too long: 100 characters at most.";
  if (/[/\\:*?"<>|\u0000-\u001f]/.test(trimmed)) return 'A preset\'s name can\'t have / \\ : * ? " < > or | in it.';
  if (trimmed.startsWith(".")) return "A preset's name can't start with a dot.";
  return null;
}

/** Whether a preset is one the player saves over (a Serum 2 preset in `User`), rather than saving a new one beside it. */
export const isUserSerumPreset = (entry: Pick<SerumPresetEntry, "kind" | "folder"> | null | undefined): boolean =>
  entry?.kind === "serum2" && (entry.folder === "User" || entry.folder.startsWith("User/"));

/** The library's folders, each once, sorted: what the folder filter offers. */
export function serumFolders(entries: readonly SerumPresetEntry[]): string[] {
  return [...new Set(entries.map((e) => e.folder).filter(Boolean))].sort(naturalCompare);
}

/**
 * A preset picked at random from `list` (the player's list as its search and filters leave it), never `current` while
 * there's another to pick; null when the list is empty. `random` is 0 to 1 (Math.random's).
 */
export function randomSerumPreset(list: readonly SerumPresetEntry[], current: string | null, random: () => number = Math.random): SerumPresetEntry | null {
  const others = list.filter((e) => e.path !== current);
  const from = others.length ? others : list;
  if (!from.length) return null;
  return from[Math.min(from.length - 1, Math.floor(random() * from.length))];
}

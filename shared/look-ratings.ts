/**
 * The user's taste in the visualizer's looks (docs/now-playing.md, "Your taste"): looks loved (L) or binned (B) as
 * they play, passed over in the rating mode, or skipped soon after the visualizer put them up, each with the moment it
 * was given (the song, what kind of song it was, how intense). Kept on this computer (`server/look-ratings.ts`); the
 * chooser goes by it, and a pass over them tunes the looks. Looks are ids here: whose they are is the visualizer's.
 * Pure.
 */
import { SONG_CHARACTERS, type SongCharacter } from "./signals/mood.ts";

/**
 * What was said of a look: loved, binned, taken back (`clear`: L or B again), seen in the rating mode with nothing said
 * (`pass`), or left within a few seconds of the visualizer putting it up (`skip`: a small thumbs-down).
 */
export type RatingVerdict = "love" | "bin" | "clear" | "pass" | "skip";
export const RATING_VERDICTS: readonly RatingVerdict[] = ["love", "bin", "clear", "pass", "skip"];

/** What was playing when a look was rated: the kind of song (null: not known yet), how intense (0..1), how slow. */
export interface RatedMoment {
  character: SongCharacter | null;
  intensity: number;
  slow: number;
}

export interface LookRating {
  look: string;
  verdict: RatingVerdict;
  /** When (ms since the epoch; the server's clock). */
  at: number;
  /** Given in the rating mode (the looks one after another), else while watching. */
  rating?: true;
  /** Seconds it had been showing. */
  seconds: number;
  song: { id: string; name: string; artist: string } | null;
  mood: RatedMoment | null;
}

/** A rating as the tab sends it (the server stamps when). */
export type LookRatingInput = Omit<LookRating, "at">;

const LOOK_ID = /^[a-z0-9][a-z0-9_.-]{0,119}$/i;
const text = (v: unknown, most = 200) => (typeof v === "string" ? v.slice(0, most) : "");
const unit = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : 0);

/** A rating from an untrusted body, or null if it isn't one. */
export function normalizeLookRating(raw: unknown): LookRatingInput | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  if (typeof r.look !== "string" || !LOOK_ID.test(r.look)) return null;
  if (!RATING_VERDICTS.includes(r.verdict as RatingVerdict)) return null;
  const seconds = typeof r.seconds === "number" && Number.isFinite(r.seconds) ? Math.round(Math.min(86_400, Math.max(0, r.seconds)) * 10) / 10 : 0;
  const s = r.song && typeof r.song === "object" ? (r.song as Record<string, unknown>) : null;
  const m = r.mood && typeof r.mood === "object" ? (r.mood as Record<string, unknown>) : null;
  return {
    look: r.look,
    verdict: r.verdict as RatingVerdict,
    ...(r.rating === true && { rating: true as const }),
    seconds,
    song: s && typeof s.id === "string" && s.id ? { id: text(s.id), name: text(s.name), artist: text(s.artist) } : null,
    mood: m
      ? {
          character: SONG_CHARACTERS.includes(m.character as SongCharacter) ? (m.character as SongCharacter) : null,
          intensity: Math.round(unit(m.intensity) * 100) / 100,
          slow: Math.round(unit(m.slow) * 100) / 100,
        }
      : null,
  };
}

/** A rating as kept (a file read back: anything that isn't one is dropped). */
export function readLookRating(raw: unknown): LookRating | null {
  const rating = normalizeLookRating(raw);
  const at = (raw as { at?: unknown } | null)?.at;
  return rating && typeof at === "number" && Number.isFinite(at) ? { ...rating, at } : null;
}

/** How much more a loved look is picked than one nobody's said anything of, in the kind of song it was loved in. */
export const LOVED = 3;
/** Loved in another kind of song: liked, but not proven here. */
export const LOVED_ELSEWHERE = 1.5;
/** Each skip since its last verdict makes a look this much less likely, down to `SKIPPED_MOST`. */
export const SKIP_FACTOR = 0.7;
export const SKIPPED_MOST = 0.25;

/**
 * A look's verdict for a kind of song: loved or binned, and whether it was said for that kind (`here`) or follows from
 * what was said in others (a bin anywhere bins it everywhere but where it's loved; loved only elsewhere, it's liked).
 */
export interface LookVerdict {
  verdict: "love" | "bin" | null;
  here: boolean;
}

/** The ratings worked out: what's wanted, and how much. */
export interface Taste {
  verdict(look: string, character: SongCharacter | null): LookVerdict;
  /** How much a look is wanted for a kind of song: 0 never (binned), 1 as any other, more if loved. */
  appeal(look: string, character: SongCharacter | null): number;
  /** Skips since its last verdict. */
  skips(look: string): number;
  /** Whether it was given a verdict or passed over in the rating mode (not only skipped): the rating mode shows the others first. */
  judged(look: string): boolean;
  /** The looks loved and binned somewhere, and the ratings in all. */
  counts(): { loved: number; binned: number; ratings: number };
}

/** Where a verdict is kept: a kind of song, or every kind (`any`: given before the song's kind was known). */
type Where = SongCharacter | "any";

interface Said {
  verdicts: Map<Where, "love" | "bin">;
  skips: number;
  judged: boolean;
}

/**
 * The ratings, in the order they were given, worked out (`Taste`). The latest verdict for a kind of song is the one
 * that counts, and L or B again takes it back; one given before the song's kind was known is the look's as a whole
 * (it replaces those of each kind). Skips since a look's last verdict make it less likely.
 */
export function tasteOf(ratings: readonly LookRating[]): Taste {
  const looks = new Map<string, Said>();
  for (const r of ratings) {
    let said = looks.get(r.look);
    if (!said) looks.set(r.look, (said = { verdicts: new Map(), skips: 0, judged: false }));
    const where: Where = r.mood?.character ?? "any";
    if (r.verdict === "skip") said.skips++;
    else if (r.verdict === "pass") said.judged = true;
    else {
      said.skips = 0;
      said.judged = true;
      if (r.verdict === "clear") said.verdicts.delete(said.verdicts.has(where) ? where : "any");
      else if (where === "any") said.verdicts = new Map([["any", r.verdict]]);
      else said.verdicts.set(where, r.verdict);
    }
  }
  const verdict = (look: string, character: SongCharacter | null): LookVerdict => {
    const said = looks.get(look);
    if (!said) return { verdict: null, here: false };
    const own = character ? said.verdicts.get(character) : undefined;
    if (own) return { verdict: own, here: true };
    const any = said.verdicts.get("any");
    if (any) return { verdict: any, here: true };
    const all = [...said.verdicts.values()];
    return { verdict: all.includes("bin") ? "bin" : all.includes("love") ? "love" : null, here: false };
  };
  return {
    verdict,
    appeal(look, character) {
      const { verdict: v, here } = verdict(look, character);
      if (v === "bin") return 0;
      const skipped = Math.max(SKIPPED_MOST, SKIP_FACTOR ** (looks.get(look)?.skips ?? 0));
      return (v === "love" ? (here ? LOVED : LOVED_ELSEWHERE) : 1) * skipped;
    },
    skips: (look) => looks.get(look)?.skips ?? 0,
    judged: (look) => !!looks.get(look)?.judged,
    counts() {
      const all = [...looks.values()].map((s) => [...s.verdicts.values()]);
      return { loved: all.filter((v) => v.includes("love")).length, binned: all.filter((v) => v.includes("bin")).length, ratings: ratings.length };
    },
  };
}

/** No ratings: every look as wanted as another. */
export const NO_TASTE: Taste = tasteOf([]);

import { type LookRating, normalizeLookRating, readLookRating } from "../shared/look-ratings.ts";
import { log } from "./log.ts";
import { HttpError, readJson, writeJson } from "./storage.ts";

const logger = log("now-playing");

interface RatingsFile {
  version: 1;
  ratings: unknown[];
}

/**
 * The visualizer's ratings (`shared/look-ratings.ts`), every one kept in the order given, in one file of this
 * computer's (`DataPaths.lookRatingsFile`): the chooser goes by them, and they're read over to tune the looks.
 * Writes go one at a time, each the whole file (atomically).
 */
export class LookRatings {
  private ratings: LookRating[] | null = null;
  private writing: Promise<void> = Promise.resolve();

  constructor(private readonly file: string) {}

  async list(): Promise<LookRating[]> {
    if (!this.ratings) {
      const kept = await readJson<RatingsFile>(this.file);
      this.ratings ??= Array.isArray(kept?.ratings) ? kept.ratings.map(readLookRating).filter((r): r is LookRating => r !== null) : [];
    }
    return this.ratings;
  }

  /** A rating from the tab (an untrusted body), kept: as kept, with when. */
  async add(raw: unknown): Promise<LookRating> {
    const input = normalizeLookRating(raw);
    if (!input) throw new HttpError(400, "Not a rating: { look: a look's id, verdict: love, bin, clear, pass or skip, seconds, song?, mood? }.");
    await this.list();
    const rating: LookRating = { ...input, at: Date.now() };
    // Added at once, after any other (the file is written with all of them, in turn).
    const ratings = [...this.ratings!, rating];
    this.ratings = ratings;
    const write = this.writing.then(() => writeJson(this.file, { version: 1, ratings } satisfies RatingsFile));
    this.writing = write.catch(() => {});
    try {
      await write;
    } catch (err) {
      logger.error(`couldn't keep a rating of ${rating.look}`, err);
      throw err;
    }
    return rating;
  }
}

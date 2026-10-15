import { create } from "zustand";
import { toast } from "sonner";
import { errorMessage } from "@shared/errors";
import { type LookRating, type LookRatingInput, NO_TASTE, type Taste, tasteOf } from "@shared/look-ratings";
import { api } from "@/lib/api";
import { log } from "@/lib/log";

const logger = log("now-playing");

interface LookRatingsState {
  /** Every rating, oldest first (the server's, then this tab's as they're given). */
  ratings: LookRating[];
  /** What they come to: how much each look is wanted (the chooser's `appeal`). */
  taste: Taste;
  loaded: boolean;
  /** The rating mode is on (the looks one after another, `rating.ts`): how many looks nobody has judged yet. */
  rating: { left: number } | null;
  /** The rating mode asked for (on or off) by the assistant, for the visualizer to start or stop once it can. */
  asked: boolean | null;
  /** The ratings kept on this computer, once (the visualizer opening, the assistant asking). */
  load(): Promise<void>;
  /** A rating given: counted at once, and kept by the server. */
  rate(rating: LookRatingInput): void;
  setRating(rating: { left: number } | null): void;
  ask(rating: boolean | null): void;
}

let loading: Promise<void> | null = null;

/**
 * The user's ratings of the visualizer's looks (docs/now-playing.md, "Your taste"), in the tab: loaded from the server
 * (`/api/now-playing/ratings`), each new one counted at once and sent to be kept.
 */
export const useLookRatings = create<LookRatingsState>((set) => ({
  ratings: [],
  taste: NO_TASTE,
  loaded: false,
  rating: null,
  asked: null,
  load() {
    loading ??= api
      .lookRatings()
      .then(({ ratings }) => {
        // Any given while they were asked for go after them.
        set((s) => {
          const all = [...ratings, ...s.ratings];
          return { ratings: all, taste: tasteOf(all), loaded: true };
        });
      })
      .catch((err) => {
        loading = null;
        logger.warn(`couldn't read the looks' ratings: ${errorMessage(err)}`);
      });
    return loading;
  },
  rate(input) {
    const rating: LookRating = { ...input, at: Date.now() };
    set((s) => {
      const all = [...s.ratings, rating];
      return { ratings: all, taste: tasteOf(all) };
    });
    api.rateLook(input).catch((err) => {
      set((s) => {
        const all = s.ratings.filter((r) => r !== rating);
        return { ratings: all, taste: tasteOf(all) };
      });
      logger.warn(`couldn't keep a rating of ${input.look}: ${errorMessage(err)}`);
      if (input.verdict !== "skip" && input.verdict !== "pass") toast.error(`Couldn't keep that rating: ${errorMessage(err)}`);
    });
  },
  setRating(rating) {
    set({ rating });
  },
  ask(asked) {
    set({ asked });
  },
}));

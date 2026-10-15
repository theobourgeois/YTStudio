/**
 * How one look gives way to the next, by the music (docs/now-playing.md, step 6): a hard cut on a drop (the kick it
 * lands on); a slow blend in calm parts (a breakdown, a quiet, a song starting, a chill song), its looks melting into
 * each other through a feedback morph; a short punch on the beat in a steady groove; glitches only when a glitchy look
 * comes or goes. Lengths are in beats, so a switch lands on the bar. A key's switch is quick and plain. Pure, and tested.
 */
import type { LiveLook } from "@shared/live-looks";
import type { Mood } from "@shared/signals/mood";

/** Why a look changes: the chooser's reasons, a schedule's, a key's, chaos rolled. */
export type SwitchReason = "drop" | "breakdown" | "song" | "quiet" | "fit" | "phrase" | "schedule" | "key" | "chaos";

export interface Switch {
  /** The editor's transition, or null: a cut. */
  type: string | null;
  seconds: number;
  /** A feedback morph about it (the looks melting into each other). */
  morph: boolean;
  /** Where it lands: now (a key, a drop), or centred on the next downbeat. */
  lands: "now" | "bar";
  /** What sort it is, for the log. */
  kind: "cut" | "blend" | "punch" | "glitch" | "quick";
}

/** Slow and soft, for calm parts. */
export const BLENDS = ["film-dissolve", "blur-dissolve", "luma-dissolve", "additive-dissolve", "morph", "liquid"] as const;
/** A beat long, moving, for a groove. */
export const PUNCHES = ["cross-zoom", "whip", "pull-in", "spin", "zoom-out", "swirl", "light-leak"] as const;
/** Only where a glitchy look comes or goes. */
export const GLITCHES = ["glitch", "datamosh", "rgb-split", "vhs"] as const;
/** Under this intensity it's calm. */
const CALM = 0.35;

const pick = <T>(random: () => number, list: readonly T[]): T => list[Math.floor(random() * list.length) % list.length];

/** The switch for a change of look: by why it's changing, what's heard, the looks, and a beat's length (seconds). */
export function switchFor(
  reason: SwitchReason,
  mood: Pick<Mood, "intensity" | "character" | "sure">,
  from: LiveLook | null,
  to: LiveLook,
  beat: number,
  random: () => number,
): Switch {
  if (reason === "drop") return { type: null, seconds: 0, morph: false, lands: "now", kind: "cut" };
  if (reason === "key") return { type: "cross-dissolve", seconds: 0.35, morph: false, lands: "now", kind: "quick" };
  // vaudio's = is a kick of a flash.
  if (reason === "chaos") return { type: "flash", seconds: 0.4, morph: false, lands: "now", kind: "quick" };
  const chill = mood.character === "chill" && mood.sure >= 0.4;
  if (reason === "breakdown" || reason === "quiet" || reason === "song" || mood.intensity < CALM || chill) {
    // Two bars, within reason (a slow song's two bars are long).
    return { type: pick(random, BLENDS), seconds: Math.min(4.5, Math.max(2, 8 * beat)), morph: true, lands: "bar", kind: "blend" };
  }
  const beatLong = Math.min(0.7, Math.max(0.3, beat));
  if (from?.suits.glitch || to.suits.glitch) return { type: pick(random, GLITCHES), seconds: beatLong, morph: false, lands: "bar", kind: "glitch" };
  const type = pick(random, PUNCHES);
  // A light leak needs a little longer to read.
  return { type, seconds: type === "light-leak" ? 2 * beatLong : beatLong, morph: false, lands: "bar", kind: "punch" };
}

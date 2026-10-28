/**
 * How a 3D model moves and looks in a MilkDrop look (docs/now-playing.md, "Your media"; drawn by `model-stage.ts`):
 * which of its animations it plays (a dance if it has one while the music's going, else a loop of its: idle, flying,
 * walking; never its death or a hit taken), which it punches in on the big kicks (a jump, a wave, a punch), and its
 * style for this look: its own colours in the cover's lights, chrome reflecting the look, a neon wireframe, or (an
 * object without a skeleton) a ring of them. Pure, and tested.
 */

/** What an animation's for, by its name. */
export type ClipRole = "dance" | "loop" | "burst" | "never" | "other";

/** Its name without the rig's ("RobotArmature|Robot_Dance" is "Robot_Dance"), lower case, in words. */
const bare = (name: string) =>
  (name.split("|").at(-1) ?? name)
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/[_\-.]+/g, " ")
    .trim()
    .toLowerCase();

const NEVER = /\b(death|dead|die|dies|dying|hit ?react|hit|recie?ve|damage|hurt|fall|knock|ko|defeat|lose|sad|t ?pose)\b/;
const DANCE = /\b(dance|dancing|groove|party|celebrat\w*|victory|samba|hip ?hop|twerk|disco)\b/;
const LOOP = /\b(idle|fly|flying|flap|swim|swimming|walk|walking|run|running|gallop|trot|hover|float|breath\w*|sway|bounce|spin|loop|stand)\b/;
const BURST = /\b(jump|punch|kick|wave|yes|no|clap\w*|attack|shoot|roar|bite|slash|headbutt|spell|cast|sword|duck|emote|taunt|cheer)\b/;

export function clipRole(name: string): ClipRole {
  const words = bare(name);
  if (!words) return "other";
  if (NEVER.test(words)) return "never";
  if (DANCE.test(words)) return "dance";
  if (BURST.test(words)) return "burst";
  if (LOOP.test(words)) return "loop";
  return "other";
}

/** The animations a model plays: indices into its list. */
export interface ClipPlan {
  /** Played all the while, looping (null: it has none worth playing, or none at all). */
  base: number | null;
  /** Played once over it on a big kick, now and then. */
  bursts: number[];
}

/**
 * Its animations' plan for the moment (`energy` 0..1: calm, or going): a dance while it's going, a calm loop (idle,
 * floating) while it's calm, whichever there is otherwise; the same animation under two names (with and without its
 * rig's) counted once.
 */
export function planClips(names: readonly string[], energy: number, random: () => number): ClipPlan {
  const seen = new Set<string>();
  const by: Record<ClipRole, number[]> = { dance: [], loop: [], burst: [], never: [], other: [] };
  names.forEach((name, i) => {
    const key = bare(name);
    if (seen.has(key)) return;
    seen.add(key);
    by[clipRole(name)].push(i);
  });
  const pick = (list: number[]) => (list.length ? list[Math.floor(random() * list.length)] : null);
  const calm = by.loop.filter((i) => /\b(idle|hover|float|breath\w*|sway|stand|fly|flying|swim|swimming)\b/.test(bare(names[i])));
  const going = by.loop.filter((i) => /\b(run|running|gallop|walk|walking|bounce|spin|flap)\b/.test(bare(names[i])));
  let base: number | null;
  if (energy >= 0.45 && by.dance.length) base = pick(by.dance);
  else if (energy >= 0.6 && going.length) base = pick(going);
  else base = pick(calm) ?? pick(by.loop) ?? pick(by.dance) ?? pick(by.other) ?? null;
  return { base, bursts: by.burst };
}

/** How a model's drawn for a look. */
export type ModelStyle = "lit" | "chrome" | "neon" | "ring";

export interface ModelLook {
  style: ModelStyle;
  /** Turning about itself, turns a second (signed: which way). */
  spin: number;
  /** Seen from a little above (radians down). */
  tilt: number;
  /** Its height, of the frame's. */
  size: number;
}

/**
 * Its style for a look, by what it is (a character or animal: `animated`; an object) and the moment: its own colours
 * most, chrome and neon more as it gets intense; a ring of copies, sometimes, for an object.
 */
export function modelLookFor(model: { animated: boolean }, energy: number, random: () => number): ModelLook {
  const shares: [ModelStyle, number][] = model.animated
    ? [
        ["lit", 0.55 - energy * 0.25],
        ["chrome", 0.25 + energy * 0.1],
        ["neon", 0.2 + energy * 0.15],
      ]
    : [
        ["lit", 0.4 - energy * 0.15],
        ["chrome", 0.25],
        ["neon", 0.15 + energy * 0.1],
        ["ring", 0.2 + energy * 0.05],
      ];
  const total = shares.reduce((sum, [, s]) => sum + s, 0);
  let left = random() * total;
  let style: ModelStyle = shares[0][0];
  for (const [s, share] of shares) {
    style = s;
    if ((left -= share) <= 0) break;
  }
  const way = random() < 0.5 ? -1 : 1;
  // A character turns slowly (it's seen dancing); an object spins.
  const spin = way * (model.animated ? 0.03 + random() * 0.05 : 0.08 + random() * 0.12 + energy * 0.1);
  return {
    style,
    spin: Math.round(spin * 1000) / 1000,
    tilt: Math.round((0.08 + random() * 0.18) * 100) / 100,
    size: style === "ring" ? 0.9 : Math.round((0.62 + random() * 0.18) * 100) / 100,
  };
}

/** Whether a big kick sets off a burst: one at most every `BURST_GAP` seconds, about one kick in three. */
export const BURST_GAP = 3.5;
export const shouldBurst = (hit: number, sinceLast: number, random: () => number) => hit > 0.8 && sinceLast > BURST_GAP && random() < 0.35;

/**
 * Twirl, Pinch and ZigZag: the picture bent about a centre (Distort). Their references are
 * `../../reference/filters/warp.ts`, their WGSL `src/suites/photo/render/filters/warp.ts`.
 */
import type { EffectDefinition } from "../index.ts";
import { choice, diag, kernelFilter, look, n, num, pixels, point } from "../kernel.ts";

/** The largest radius each reads within, in document pixels: what bounds their reach. */
export const MAX_TWIRL_RADIUS = 1800;
export const MAX_PINCH_RADIUS = 2000;
export const MAX_ZIGZAG_RADIUS = 6000;
export const MAX_ZIGZAG_AMOUNT = 500;

/** Pinch's power at 100%: below 1, so the very centre still reads a point rather than a ring. */
export const PINCH_POWER = 0.9;

/** Twirl's rotation at `r` from its centre: Angle (radians) at the centre, falling smoothly to 0 at the radius. */
export const twirlAngle = (angle: number, radius: number, r: number) => {
  const t = Math.max(0, 1 - r / radius);
  return angle * t * t;
};

/** Pinch's scale of the distance from its centre at `t` (a share of the radius): a power of sin(πt/2), smooth at the rim. */
export const pinchScale = (k: number, t: number) => (t > 0 && t < 1 ? Math.pow(Math.sin((Math.PI / 2) * t), -k) : 1);

/** The largest of `f` over [0, R], sampled finely, and a bound on what falls between samples (`slope`, |f'|'s bound). */
function largest(f: (r: number) => number, R: number, slope: number) {
  const steps = 4096;
  let most = 0;
  for (let i = 0; i <= steps; i++) most = Math.max(most, f((i / steps) * R));
  return most + (slope * R) / steps;
}

const centre = point("centre", "Centre", "Where the effect is centred, in document pixels; empty is the canvas's centre.");

const TWIRL = kernelFilter({
  type: "twirl",
  label: "Twirl",
  description:
    "Photoshop's Twirl: the picture turned about a centre, most at the centre and less farther out, falling smoothly to nothing at Radius, so straight lines become spirals. Angle is the turn at the centre in degrees (positive clockwise, negative anticlockwise; past 360° lines wind round more than once). Radius is how far out it reaches, in document pixels; Centre where it turns about (empty: the canvas's centre). Near the canvas's edges it reads the edge rather than past it.",
  category: "Distort",
  params: [
    num("angle", "Angle", "°", -999, 999, 50, "The turn at the centre, in degrees: positive clockwise, negative anticlockwise. It falls to nothing at the radius."),
    pixels("radius", "Radius", 1, MAX_TWIRL_RADIUS, 400, "How far from the centre the picture turns, in document pixels."),
    centre,
  ],
  reach: (p) => {
    const A = (n(p, "angle") * Math.PI) / 180;
    const R = n(p, "radius");
    // A point at r reads the point turned by its angle: 2r·|sin(θ/2)| from it.
    return Math.min(2 * R, largest((r) => 2 * r * Math.abs(Math.sin(twirlAngle(A, R, r) / 2)), R, 2 + 2 * Math.abs(A)));
  },
  isIdentity: (p) => n(p, "angle") === 0,
  summary: (p) => `${n(p, "angle")}°, radius ${n(p, "radius")} px`,
  presets: [
    look("twirl", "Twirl", "Photoshop's: a half-turn swirl in the middle of the picture.", { angle: 180, centre: null }, (c) => ({ radius: diag(0.32, c, 1, MAX_TWIRL_RADIUS) })),
    look("whirlpool", "Whirlpool", "Wound tight: lines spiral into the centre more than twice.", { angle: 900, centre: null }, (c) => ({ radius: diag(0.3, c, 1, MAX_TWIRL_RADIUS) })),
    look("gentle-swirl", "Gentle Swirl", "A soft, wide quarter-turn, barely there at the edges.", { angle: 70, centre: null }, (c) => ({ radius: diag(0.5, c, 1, MAX_TWIRL_RADIUS) })),
    look("galaxy", "Galaxy", "The whole picture wound anticlockwise into a spiral galaxy.", { angle: -600, centre: null }, (c) => ({ radius: diag(0.55, c, 1, MAX_TWIRL_RADIUS) })),
  ],
});

const PINCH = kernelFilter({
  type: "pinch",
  label: "Pinch",
  description:
    "Photoshop's Pinch: the picture squeezed towards a centre or bulged out from it, within Radius of it, smoothly back to as it was at the rim. Amount from −100% to 100%: positive pinches in (the middle shrinks, as if sucked into a hole), negative bulges out (the middle swells, as a fisheye or a magnifying glass). Radius is the circle it works within, in document pixels; Centre where it's centred (empty: the canvas's centre).",
  category: "Distort",
  params: [
    num("amount", "Amount", "%", -100, 100, 50, "Positive pinches the middle in, negative bulges it out."),
    pixels("radius", "Radius", 1, MAX_PINCH_RADIUS, 400, "The circle it works within, in document pixels."),
    centre,
  ],
  reach: (p) => {
    const k = (n(p, "amount") / 100) * PINCH_POWER;
    const R = n(p, "radius");
    // A point at t·R reads the point at t·R·scale on the same line: never past the rim, so never farther than R.
    return Math.min(R, largest((r) => Math.abs(r * pinchScale(k, r / R) - r), R, 4));
  },
  isIdentity: (p) => n(p, "amount") === 0,
  summary: (p) => `${n(p, "amount") >= 0 ? "pinch" : "bulge"} ${Math.abs(n(p, "amount"))}%, radius ${n(p, "radius")} px`,
  presets: [
    look("pinch", "Pinch", "Photoshop's: the middle drawn in, as if sucked into a hole.", { amount: 70, centre: null }, (c) => ({ radius: diag(0.3, c, 1, MAX_PINCH_RADIUS) })),
    look("bulge", "Bulge", "The middle swelling out, as under a magnifying glass.", { amount: -70, centre: null }, (c) => ({ radius: diag(0.3, c, 1, MAX_PINCH_RADIUS) })),
    look("big-bulge", "Big Bulge", "The whole picture ballooned out from the centre, a fisheye lens.", { amount: -100, centre: null }, (c) => ({ radius: diag(0.55, c, 1, MAX_PINCH_RADIUS) })),
    look("subtle", "Subtle", "A gentle pinch in the middle, there if you look.", { amount: 30, centre: null }, (c) => ({ radius: diag(0.35, c, 1, MAX_PINCH_RADIUS) })),
  ],
});

const ZIGZAG = kernelFilter({
  type: "zigzag",
  label: "ZigZag",
  description:
    "Photoshop's ZigZag: rings of ripples about a centre, as a stone dropped in a pond, strongest at the centre and dying away to nothing at Radius. Amount is how far the ripples move the picture, in document pixels (negative turns their phase over). Ridges is how many ripples fit within the radius. Style: Pond Ripples moves the picture both out and around (Photoshop's default); Out From Center moves it in and out along lines from the centre (round ripples); Around Center turns each ring one way then the other, so straight lines zigzag. Radius is how far out the ripples reach, in document pixels; Centre where they start (empty: the canvas's centre). Near the canvas's edges it reads the edge rather than past it.",
  category: "Distort",
  params: [
    num("amount", "Amount", "px", -MAX_ZIGZAG_AMOUNT, MAX_ZIGZAG_AMOUNT, 20, "How far the ripples move the picture at most, in document pixels: negative turns them over.", 0.5, 1),
    num("ridges", "Ridges", "", 1, 50, 8, "How many ripples there are from the centre to the radius."),
    choice("style", "Style", [["pond", "Pond Ripples"], ["out", "Out From Center"], ["around", "Around Center"]], "pond", "Pond Ripples: out and around. Out From Center: in and out, round ripples. Around Center: each ring turned one way then the other."),
    pixels("radius", "Radius", 1, MAX_ZIGZAG_RADIUS, 400, "How far from the centre the ripples reach, in document pixels."),
    centre,
  ],
  reach: (p) => Math.abs(n(p, "amount")),
  isIdentity: (p) => n(p, "amount") === 0,
  summary: (p) => `${p.style}, ${n(p, "amount")} px, ${n(p, "ridges")} ridges`,
  presets: [
    look("pond", "Pond", "Photoshop's Pond Ripples: rings moving out and around, as a pond's surface.", { style: "pond", ridges: 9, centre: null }, (c) => ({ amount: diag(0.022, c, 0.5, MAX_ZIGZAG_AMOUNT), radius: diag(0.5, c, 1, MAX_ZIGZAG_RADIUS) })),
    look("water-drop", "Water Drop", "Fine, tight rings from a drop in the middle, dying away fast.", { style: "out", ridges: 16, centre: null }, (c) => ({ amount: diag(0.014, c, 0.5, MAX_ZIGZAG_AMOUNT), radius: diag(0.35, c, 1, MAX_ZIGZAG_RADIUS) })),
    look("rings", "Rings", "A few big, slow rings across the whole picture.", { style: "out", ridges: 4, centre: null }, (c) => ({ amount: diag(0.04, c, 0.5, MAX_ZIGZAG_AMOUNT), radius: diag(0.75, c, 1, MAX_ZIGZAG_RADIUS) })),
    look("around", "Around", "Each ring turned one way, then the other: straight lines zigzag.", { style: "around", ridges: 7, centre: null }, (c) => ({ amount: diag(0.035, c, 0.5, MAX_ZIGZAG_AMOUNT), radius: diag(0.5, c, 1, MAX_ZIGZAG_RADIUS) })),
  ],
});

export const WARP_FILTERS: EffectDefinition[] = [TWIRL, PINCH, ZIGZAG];

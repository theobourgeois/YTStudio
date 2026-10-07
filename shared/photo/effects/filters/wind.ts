/**
 * Wind and Motion Blur: the picture pulled along one direction (Stylize, Blur). Their references are
 * `../../reference/filters/wind.ts`, their WGSL `src/suites/photo/render/filters/wind.ts`.
 */
import type { EffectDefinition } from "../index.ts";
import { choice, colour, degrees, diag, kernelFilter, look, n, percent, pixels, seed } from "../kernel.ts";

/** The longest streak and the longest blur, in document pixels: what bounds their reach. */
export const MAX_WIND_LENGTH = 2000;
export const MAX_BLUR_DISTANCE = 2000;

const WIND = kernelFilter({
  type: "wind",
  label: "Wind",
  description:
    "Photoshop's Wind, at any angle: wherever the brightness changes sharply along the wind (an edge), thin streaks of the colour on the upwind side blow out downwind, fading along their length, each row of pixels its own random length. Method: Wind makes thin streaks; Blast makes thicker, longer, more solid ones; Stagger breaks them off their edges by random amounts, jagged. Angle is where the wind blows to (0° to the right, 90° down, −90° up, 180° to the left). Length is the longest streak in document pixels (each row's is a random share of it). Threshold is how strong an edge must be to start a streak: lower streaks fainter edges. Streaks: Light blows bright colour into darker areas (Photoshop's look), Dark blows dark colour into lighter areas, Both does both. Tint colours the streaks (Tint Amount how much: 0 keeps their own colour; the tint keeps their brightness, so a warm tint makes flames). Seed picks another pattern of lengths. Streaks crossing transparency give it coverage.",
  category: "Stylize",
  params: [
    choice("method", "Method", [["wind", "Wind"], ["blast", "Blast"], ["stagger", "Stagger"]], "wind", "Wind: thin streaks. Blast: thicker, longer, more solid streaks. Stagger: streaks broken off their edges by random amounts, jagged."),
    degrees("angle", "Angle", 0, "Where the wind blows to: 0° to the right, 90° down, 180° to the left, −90° up."),
    pixels("length", "Length", 2, MAX_WIND_LENGTH, 60, "The longest streak, in document pixels: each row's streaks are a random share of it."),
    percent("threshold", "Threshold", 8, "How sharp a change of brightness along the wind must be to start a streak: lower makes more streaks, from fainter edges."),
    choice("streaks", "Streaks", [["light", "Light"], ["dark", "Dark"], ["both", "Both"]], "light", "Light: bright colour blown into darker areas. Dark: dark colour blown into lighter areas. Both: either."),
    colour("tint", "Tint", "#ff6a1a", "The colour the streaks take with Tint Amount above 0 (their brightness kept)."),
    percent("tintAmount", "Tint Amount", 0, "How much the streaks take the Tint's colour: 0 keeps their own."),
    seed("Which random pattern of streak lengths: another number, another one."),
  ],
  reach: (p) => n(p, "length"),
  summary: (p) => `${p.method}, ${n(p, "angle")}°, ${n(p, "length")} px, ${p.streaks}`,
  presets: [
    look("wind", "Wind", "Photoshop's: thin bright lines blown to the right off every edge.", { method: "wind", angle: 0, threshold: 6, streaks: "light", tintAmount: 0, seed: 1 }, (c) => ({ length: diag(0.07, c, 2, MAX_WIND_LENGTH) })),
    look("blast", "Blast", "A gale: thick, long, solid trails tearing the picture to the right.", { method: "blast", angle: 0, threshold: 6, streaks: "both", tintAmount: 0, seed: 2 }, (c) => ({ length: diag(0.12, c, 2, MAX_WIND_LENGTH) })),
    look("stagger", "Stagger", "Jagged lines thrown off their edges at random, blowing left.", { method: "stagger", angle: 180, threshold: 6, streaks: "both", tintAmount: 0, seed: 3 }, (c) => ({ length: diag(0.09, c, 2, MAX_WIND_LENGTH) })),
    look("fire", "Fire", "Flames: bright edges blown upwards in orange and yellow.", { method: "wind", angle: -90, threshold: 5, streaks: "light", tint: "#ff5a12", tintAmount: 85, seed: 4 }, (c) => ({ length: diag(0.07, c, 2, MAX_WIND_LENGTH) })),
    look("speed", "Speed", "Long, thin lines of light and dark trailing behind, as at speed.", { method: "wind", angle: 180, threshold: 4, streaks: "both", tintAmount: 0, seed: 5 }, (c) => ({ length: diag(0.25, c, 2, MAX_WIND_LENGTH) })),
    look("drip", "Drip", "Colour running down the picture in staggered drips.", { method: "stagger", angle: 90, threshold: 5, streaks: "both", tintAmount: 0, seed: 6 }, (c) => ({ length: diag(0.14, c, 2, MAX_WIND_LENGTH) })),
  ],
});

const MOTION_BLUR = kernelFilter({
  type: "motion-blur",
  label: "Motion Blur",
  description:
    "Photoshop's Motion Blur: each point the even average of the picture along a line through it, as a camera or subject moving during the exposure. Angle is the line's direction (0° horizontal, 90° vertical; with Trail, the way the subject moves: 0° to the right, 90° down). Distance is the line's length in document pixels. Shape: Centred spreads the blur evenly both ways (Photoshop's); Trail smears the picture behind its motion only, fading away from it, a speed trail. Near the canvas's edges it reads the edge rather than past it; on transparency, the blur spreads coverage.",
  category: "Blur",
  params: [
    degrees("angle", "Angle", 0, "The blur's direction: 0° horizontal, 90° vertical. With Trail, where the subject moves to (the trail is left behind it)."),
    pixels("distance", "Distance", 0, MAX_BLUR_DISTANCE, 40, "How long the blur is, in document pixels."),
    choice("shape", "Shape", [["centred", "Centred"], ["trail", "Trail"]], "centred", "Centred: an even blur both ways along the line. Trail: a smear behind the motion only, fading away from the picture."),
  ],
  reach: (p) => (p.shape === "trail" ? n(p, "distance") : n(p, "distance") / 2),
  isIdentity: (p) => n(p, "distance") === 0,
  summary: (p) => `${p.shape}, ${n(p, "angle")}°, ${n(p, "distance")} px`,
  presets: [
    look("motion", "Motion", "Photoshop's: an even horizontal blur, as a panning camera.", { angle: 0, shape: "centred" }, (c) => ({ distance: diag(0.03, c, 0, MAX_BLUR_DISTANCE) })),
    look("speed", "Speed", "A long trail streaming behind a subject rushing to the right.", { angle: 0, shape: "trail" }, (c) => ({ distance: diag(0.16, c, 0, MAX_BLUR_DISTANCE) })),
    look("smear", "Smear", "A diagonal smear rising to the right, the picture dragged across.", { angle: -30, shape: "trail" }, (c) => ({ distance: diag(0.07, c, 0, MAX_BLUR_DISTANCE) })),
    look("vertical-drop", "Vertical Drop", "A long vertical blur, as a fall or a camera dropped.", { angle: 90, shape: "centred" }, (c) => ({ distance: diag(0.08, c, 0, MAX_BLUR_DISTANCE) })),
    look("shake", "Shake", "A short diagonal blur: a shaky hand.", { angle: 45, shape: "centred" }, (c) => ({ distance: diag(0.012, c, 0, MAX_BLUR_DISTANCE) })),
  ],
});

export const WIND_FILTERS: EffectDefinition[] = [WIND, MOTION_BLUR];

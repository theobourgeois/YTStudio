/**
 * Subject filters (docs/photo/effects/scene-maps.md): looks made around the picture's subject, from its subject map
 * (`../../scene.ts`, read as `env.scene` / `scene_at`). Their references are `../../reference/filters/subject.ts`, their
 * WGSL `src/suites/photo/render/filters/subject.ts`.
 *
 * They read only the map around a point, never the content (their reach is 0): glows, rims and outlines are the map
 * blurred, read along a direction or dilated, so a wide aura costs no more of the layer than its own pixel.
 */
import type { EffectDefinition } from "../index.ts";
import { choice, colour, degrees, diag, kernelFilter, look, n, num, percent, pixels, seed } from "../kernel.ts";

const SUBJECT = () => ({ depth: false, subject: true });

const AURA = kernelFilter({
  type: "aura",
  label: "Aura",
  description:
    "Light pouring out from behind the picture's subject (found by Select Subject's model, which it needs): the subject's silhouette blurred wide and glowing around it, never over it. Mode Light adds the light (it can burn out to white, and over transparency it adds coverage, so a cut-out gets a halo); Shadow darkens behind the subject instead, towards the colours. Size is how far it reaches past the subject's edge; Intensity its strength in stops (each doubles it); Colour is the light at the subject's edge, Colour 2 what it fades into farther out (the same colour twice for a plain glow). Wrap lets a little light spill over the subject's own edge, as a strong backlight does. Rays turns the light into god rays streaming out from behind the subject, past its edges and through its gaps, away from its centre (0 is a smooth glow); Ray Count is how many streaks there are around it, Seed which pattern.",
  category: "Subject",
  params: [
    choice("mode", "Mode", [["light", "Light"], ["shadow", "Shadow"]], "light", "Light: a glow added behind the subject. Shadow: the background darkened towards the colours behind it."),
    pixels("size", "Size", 1, 4000, 120, "How far the aura reaches past the subject's edge, in pixels."),
    num("intensity", "Intensity", "stops", -3, 4, 0.1, "How strong it is, in stops: each one doubles the light (or, in Shadow, how dark it gets).", 0.1, 1),
    colour("colour", "Colour", "#ffe7b8", "The light's colour at the subject's edge."),
    colour("colour2", "Colour 2", "#ff9d4a", "The colour it fades into farther out (the same as Colour for a single-colour glow)."),
    percent("wrap", "Wrap", 25, "How much light spills over the subject's own edge, as a strong light behind it does."),
    percent("rays", "Rays", 0, "How much of the light is god rays streaming out from the subject's centre past its edges: 0 is a smooth glow, 100 rays alone."),
    num("rayCount", "Ray Count", "", 4, 120, 36, "How many rays there are around the subject."),
    seed("Which pattern of rays: another number, another one."),
  ],
  reach: () => 0,
  scene: SUBJECT,
  summary: (p) => `${p.mode === "shadow" ? "shadow" : "light"}, ${n(p, "size")} px, ${n(p, "intensity") >= 0 ? "+" : ""}${n(p, "intensity")} stops${n(p, "rays") ? `, rays ${n(p, "rays")}%` : ""}`,
  presets: [
    look("halo", "Halo", "A soft warm glow behind the subject.", { mode: "light", intensity: 0.4, colour: "#fff1d0", colour2: "#ffb060", wrap: 25, rays: 0, rayCount: 36, seed: 1 }, (c) => ({ size: diag(0.12, c) })),
    look("neon", "Neon Aura", "A hot magenta edge fading out into electric blue.", { mode: "light", intensity: 1.4, colour: "#ff3df0", colour2: "#2a4dff", wrap: 35, rays: 0, rayCount: 36, seed: 1 }, (c) => ({ size: diag(0.09, c) })),
    look("holy", "Holy Light", "Golden rays bursting out from behind the subject.", { mode: "light", intensity: 1.2, colour: "#fff3c4", colour2: "#ffb22e", wrap: 30, rays: 75, rayCount: 30, seed: 3 }, (c) => ({ size: diag(0.22, c) })),
    look("dark", "Dark Aura", "A shadow pooling behind the subject, deep violet at its edge.", { mode: "shadow", intensity: 2, colour: "#000000", colour2: "#2a0a3c", wrap: 0, rays: 0, rayCount: 36, seed: 1 }, (c) => ({ size: diag(0.25, c) })),
    look("double", "Double Glow", "A tight cyan edge inside a wide crimson glow.", { mode: "light", intensity: 1.6, colour: "#7af8ff", colour2: "#ff1f4f", wrap: 20, rays: 0, rayCount: 36, seed: 1 }, (c) => ({ size: diag(0.15, c) })),
    look("burst", "Sun Burst", "Fine white rays all around, as a halo seen through haze.", { mode: "light", intensity: 0.8, colour: "#ffffff", colour2: "#9fd2ff", wrap: 15, rays: 90, rayCount: 90, seed: 7 }, (c) => ({ size: diag(0.2, c) })),
  ],
});

const RIM_LIGHT = kernelFilter({
  type: "rim-light",
  label: "Rim Light",
  description:
    "An edge light on the picture's subject (found by Select Subject's model, which it needs), as a light behind it to one side would make: a band along the subject's edges that face the light, lit in a colour and added in linear light (it can burn out to white). Angle is where the light is (0° the right, 90° below, 180° the left, −90° above); Width how deep into the subject the band reaches, in pixels; Softness how gradually it fades inwards (0 a crisp band); Intensity its brightness in stops; Glow a bloom of the same light just outside the lit edges. Second adds a rim from the opposite side in Colour 2, at that share of the first's strength (0: none).",
  category: "Subject",
  params: [
    degrees("angle", "Angle", -45, "Where the light is: 0° the right, 90° below, 180° the left, −90° above."),
    pixels("width", "Width", 0.5, 400, 12, "How deep into the subject the lit band reaches, in pixels."),
    percent("softness", "Softness", 50, "How gradually the band fades into the subject: 0 is a crisp line, 100 a soft falloff."),
    num("intensity", "Intensity", "stops", -3, 4, 1, "How bright the rim is, in stops: each one doubles it.", 0.1, 1),
    colour("colour", "Colour", "#fff2dc", "The rim's colour."),
    percent("glow", "Glow", 30, "A bloom of the rim's light just outside the subject's lit edges."),
    percent("second", "Second", 0, "A second rim from the opposite side, at this share of the first's strength (0: none)."),
    colour("colour2", "Colour 2", "#5ad8ff", "The second rim's colour."),
  ],
  reach: () => 0,
  scene: SUBJECT,
  summary: (p) => `${n(p, "angle")}°, ${n(p, "width")} px, ${n(p, "intensity") >= 0 ? "+" : ""}${n(p, "intensity")} stops${n(p, "second") ? ", two sides" : ""}`,
  presets: [
    look("rim", "Rim", "A clean white edge light from the top right.", { angle: -45, softness: 50, intensity: 1, colour: "#fff6ea", glow: 30, second: 0, colour2: "#5ad8ff" }, (c) => ({ width: diag(0.01, c) })),
    look("neon", "Neon Rim", "Magenta from the left, cyan from the right: a club's lights.", { angle: 180, softness: 35, intensity: 2, colour: "#ff2bd6", glow: 70, second: 100, colour2: "#22e4ff" }, (c) => ({ width: diag(0.012, c) })),
    look("backlight", "Backlight", "A broad soft light from straight behind and above, wrapping the silhouette.", { angle: -90, softness: 80, intensity: 1.5, colour: "#fff0d8", glow: 60, second: 0, colour2: "#5ad8ff" }, (c) => ({ width: diag(0.025, c) })),
    look("golden", "Golden Edge", "Low sun from the left, gilding the subject's edge.", { angle: 160, softness: 45, intensity: 1.8, colour: "#ffb43a", glow: 45, second: 25, colour2: "#6a8cff" }, (c) => ({ width: diag(0.014, c) })),
    look("ice", "Ice Edge", "A thin, crisp cold edge from above.", { angle: -110, softness: 10, intensity: 1.6, colour: "#bfefff", glow: 20, second: 0, colour2: "#5ad8ff" }, (c) => ({ width: diag(0.006, c) })),
  ],
});

const STICKER = kernelFilter({
  type: "sticker",
  label: "Sticker",
  description:
    "The cut-out sticker look around the picture's subject (found by Select Subject's model, which it needs): an outline of Width pixels around the subject in Colour (white, as a die-cut sticker's border), a second outline of Width 2 beyond it in Colour 2 (0: none), and a drop shadow under both, Shadow Opacity strong (0: none), cast Shadow Distance pixels towards Shadow Angle (0° the right, 90° down), softened over Shadow Softness pixels, in Shadow Colour. Background is what's around the sticker: Keep leaves the picture, Colour fills it with Background Colour, Transparent removes it (a cut-out layer, its outline and shadow kept).",
  category: "Subject",
  params: [
    pixels("width", "Width", 0, 400, 10, "The outline's width around the subject, in pixels (0: none)."),
    colour("colour", "Colour", "#ffffff", "The outline's colour."),
    pixels("width2", "Width 2", 0, 400, 0, "A second outline's width beyond the first, in pixels (0: none)."),
    colour("colour2", "Colour 2", "#000000", "The second outline's colour."),
    percent("shadow", "Shadow Opacity", 45, "How dark the drop shadow under the sticker is (0: none)."),
    degrees("shadowAngle", "Shadow Angle", 60, "Which way the shadow falls: 0° the right, 90° down, 180° the left, −90° up."),
    pixels("shadowDistance", "Shadow Distance", 0, 400, 8, "How far the shadow is cast, in pixels."),
    pixels("shadowSoftness", "Shadow Softness", 0, 400, 10, "How soft the shadow's edge is, in pixels."),
    colour("shadowColour", "Shadow Colour", "#000000", "The shadow's colour."),
    choice("background", "Background", [["keep", "Keep"], ["colour", "Colour"], ["transparent", "Transparent"]], "keep", "What's around the sticker: the picture as it is, a flat colour, or nothing (the background removed)."),
    colour("backgroundColour", "Background Colour", "#ffd23f", "The flat colour behind the sticker, with Background Colour."),
  ],
  reach: () => 0,
  scene: SUBJECT,
  isIdentity: (p) => n(p, "width") <= 0 && n(p, "width2") <= 0 && n(p, "shadow") <= 0 && p.background === "keep",
  summary: (p) => `${n(p, "width")} px${n(p, "width2") ? ` + ${n(p, "width2")} px` : ""}${n(p, "shadow") ? `, shadow ${n(p, "shadow")}%` : ""}${p.background === "keep" ? "" : p.background === "colour" ? ", on colour" : ", cut out"}`,
  presets: [
    look("sticker", "Sticker", "A white border and a soft shadow, on the picture.", { colour: "#ffffff", width2: 0, colour2: "#000000", shadow: 50, shadowAngle: 70, shadowColour: "#000000", background: "keep", backgroundColour: "#ffd23f" }, (c) => ({ width: diag(0.011, c), shadowDistance: diag(0.008, c), shadowSoftness: diag(0.012, c) })),
    look("die-cut", "Die-Cut", "The subject cut out with a white border and a soft shadow, the background removed.", { colour: "#ffffff", width2: 0, colour2: "#000000", shadow: 55, shadowAngle: 70, shadowColour: "#000000", background: "transparent", backgroundColour: "#ffd23f" }, (c) => ({ width: diag(0.012, c), shadowDistance: diag(0.007, c), shadowSoftness: diag(0.01, c) })),
    look("double", "Double Outline", "White inside black, a cartoon's ink line.", { colour: "#ffffff", colour2: "#101014", shadow: 0, shadowAngle: 70, shadowColour: "#000000", background: "keep", backgroundColour: "#ffd23f" }, (c) => ({ width: diag(0.008, c), width2: diag(0.005, c), shadowDistance: diag(0.008, c), shadowSoftness: diag(0.012, c) })),
    look("pop", "Pop", "A bold hot-pink border on flat yellow, with a hard offset shadow.", { colour: "#ff2e88", width2: 0, colour2: "#000000", shadow: 85, shadowAngle: 45, shadowColour: "#1b1464", background: "colour", backgroundColour: "#ffd23f" }, (c) => ({ width: diag(0.014, c), shadowDistance: diag(0.014, c), shadowSoftness: 0 })),
    look("neon-cut", "Neon Cut", "A cyan and violet border on black, the subject floating.", { colour: "#3ff3ff", colour2: "#8a2bff", shadow: 0, shadowAngle: 70, shadowColour: "#000000", background: "colour", backgroundColour: "#07060d" }, (c) => ({ width: diag(0.006, c), width2: diag(0.008, c), shadowDistance: diag(0.008, c), shadowSoftness: diag(0.012, c) })),
  ],
});

const SPOTLIGHT = kernelFilter({
  type: "spotlight",
  label: "Spotlight",
  description:
    "The picture's subject lit and the world around it dimmed (the subject is found by Select Subject's model, which it needs): the background darkened by Amount, its colour drained by Desaturate and coloured by Tint (Tint Colour at the background's own brightness), all eased off in a soft pool of light on and around the subject reaching Spread pixels past its edge. Lift brightens the subject and its pool in Light Colour, a little light added on it. Background is everything outside the pool.",
  category: "Subject",
  params: [
    percent("amount", "Amount", 60, "How much darker the background gets: 100 is black."),
    percent("desaturate", "Desaturate", 30, "How much of the background's colour is drained: 100 is black and white."),
    colour("tint", "Tint Colour", "#2a4a8a", "A colour given to the background, at its own brightness."),
    percent("tintAmount", "Tint", 0, "How much of Tint Colour the background takes."),
    pixels("spread", "Spread", 0.5, 2000, 60, "How far the pool of light reaches past the subject's edge, in pixels."),
    percent("lift", "Lift", 20, "How much brighter the subject and its pool get, lit in Light Colour."),
    colour("light", "Light Colour", "#fff4e0", "The colour of the light on the subject."),
  ],
  reach: () => 0,
  scene: SUBJECT,
  isIdentity: (p) => n(p, "amount") <= 0 && n(p, "desaturate") <= 0 && n(p, "tintAmount") <= 0 && n(p, "lift") <= 0,
  summary: (p) => `${n(p, "amount")}% darker${n(p, "desaturate") ? `, ${n(p, "desaturate")}% grey` : ""}${n(p, "tintAmount") ? `, tint ${n(p, "tintAmount")}%` : ""}${n(p, "lift") ? `, lift ${n(p, "lift")}%` : ""}`,
  presets: [
    look("spotlight", "Spotlight", "The background dimmed, the subject in a soft pool of light.", { amount: 60, desaturate: 30, tint: "#2a4a8a", tintAmount: 0, lift: 20, light: "#fff4e0" }, (c) => ({ spread: diag(0.06, c) })),
    look("noir-pop", "Noir Pop", "The world in black and white, the subject in full colour.", { amount: 25, desaturate: 100, tint: "#2a4a8a", tintAmount: 0, lift: 15, light: "#ffffff" }, (c) => ({ spread: diag(0.01, c) })),
    look("stage", "Stage", "A dark theatre, a warm follow-spot on the subject.", { amount: 88, desaturate: 50, tint: "#3a1a5a", tintAmount: 35, lift: 45, light: "#ffd9a0" }, (c) => ({ spread: diag(0.09, c) })),
    look("blue-hour", "Blue Hour", "The background sunk into cold blue, the subject warm.", { amount: 45, desaturate: 40, tint: "#1d4fd8", tintAmount: 75, lift: 30, light: "#ffcf96" }, (c) => ({ spread: diag(0.04, c) })),
    look("red-room", "Red Room", "The world in deep red, the subject untouched and bright.", { amount: 55, desaturate: 60, tint: "#d0102a", tintAmount: 85, lift: 25, light: "#ffffff" }, (c) => ({ spread: diag(0.03, c) })),
  ],
});

export const SUBJECT_FILTERS: EffectDefinition[] = [AURA, RIM_LIGHT, STICKER, SPOTLIGHT];

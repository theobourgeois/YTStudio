/**
 * Fog, Depth Particles and Relight: air, weather and light placed in the picture's depth (Depth), read from its scene maps (docs/photo/effects/scene-maps.md). Their references are
 * `../../reference/filters/atmosphere.ts`, their WGSL `src/suites/photo/render/filters/atmosphere.ts`.
 */
import type { EffectDefinition } from "../index.ts";
import { choice, colour, degrees, diag, kernelFilter, look, n, num, percent, pixels, point, seed } from "../kernel.ts";

/** A point at a share of the canvas: presets' lights, the same on any canvas. */
const at = (fx: number, fy: number) => (c: { width: number; height: number }): [number, number] => [Math.round(c.width * fx), Math.round(c.height * fy)];

const FOG = kernelFilter({
  type: "fog",
  label: "Fog",
  description:
    "Atmosphere by depth (needs the depth model): fog of Colour thickening exponentially with distance beyond Start, the depth it begins at (nearer than Start stays clear; 100 fogs all but the nearest), as thick as Density. Ground Fog adds fog lower in the frame, reaching up by Height (a share of the canvas's height), around near things too. Wisps breaks the fog into drifting banks of seeded noise Scale pixels across (Seed picks the pattern). Glow lights the fog toward a light (Light: a point, empty is the canvas's centre) in Glow Colour, as the sun through haze, Glow its strength and Spread its size (a share of the diagonal); it can go above white. Soften blurs what the fog covers by up to that many pixels (aerial perspective). Over transparency the fog adds coverage.",
  category: "Depth",
  params: [
    percent("density", "Density", 35, "How thick the fog is in the distance: 0 none, 100 the farthest things all but gone."),
    colour("colour", "Colour", "#d6dce4", "The fog's colour."),
    percent("start", "Start", 85, "The depth the fog begins at: things nearer than it stay clear (100: only the nearest is clear; lower keeps more of the picture clear)."),
    percent("ground", "Ground Fog", 0, "Extra fog lying low in the frame, around near things too."),
    percent("height", "Height", 25, "How far up the frame Ground Fog reaches, as a share of the canvas's height.", 1, 100),
    percent("wisps", "Wisps", 30, "Breaks the fog into drifting banks and wisps: 0 is an even veil."),
    pixels("scale", "Scale", 4, 4000, 250, "The size of the wisps and banks, in document pixels."),
    percent("glow", "Glow", 0, "How brightly the fog is lit around the light, as the sun through haze; above 100 burns past white.", 0, 300),
    colour("glowColour", "Glow Colour", "#fff0d0", "The colour of the light in the fog."),
    point("light", "Light", "Where the light in the fog is, in document pixels; empty is the canvas's centre."),
    percent("spread", "Spread", 35, "How far the light spreads through the fog, as a share of the canvas's diagonal.", 2, 150),
    pixels("soften", "Soften", 0, 50, 0, "Blurs what the fog covers by up to this many document pixels, more where it's thicker: distance going soft."),
    seed("Which pattern of wisps: another number, another one."),
  ],
  reach: (p) => n(p, "soften"),
  scene: () => ({ depth: true, subject: false }),
  isIdentity: (p) => n(p, "density") === 0 && n(p, "ground") === 0,
  summary: (p) => `density ${n(p, "density")}%${n(p, "ground") ? `, ground ${n(p, "ground")}%` : ""}${n(p, "glow") ? `, glow ${n(p, "glow")}%` : ""}`,
  presets: [
    look("mist", "Mist", "A soft grey-blue veil over the distance, drifting in loose banks.", { density: 35, colour: "#d6dce4", start: 85, ground: 0, height: 25, wisps: 30, glow: 0, glowColour: "#fff0d0", light: null, spread: 35, seed: 1 }, (c) => ({ scale: diag(0.25, c, 4, 4000), soften: 0 })),
    look("dense", "Dense Fog", "Thick fog swallowing everything but the foreground, the distance gone soft.", { density: 85, colour: "#b8bfc6", start: 95, ground: 20, height: 35, wisps: 45, glow: 0, glowColour: "#fff0d0", light: null, spread: 35, seed: 3 }, (c) => ({ scale: diag(0.3, c, 4, 4000), soften: diag(0.004, c, 0, 50) })),
    look("ground", "Ground Fog", "Fog lying low over the ground and water, rolling in banks.", { density: 15, colour: "#dfe5ec", start: 60, ground: 85, height: 20, wisps: 65, glow: 0, glowColour: "#fff0d0", light: null, spread: 35, seed: 5 }, (c) => ({ scale: diag(0.18, c, 4, 4000), soften: 0 })),
    look("smoke", "Smoke", "Dark, billowing smoke filling the air behind.", { density: 70, colour: "#4a4643", start: 92, ground: 30, height: 45, wisps: 85, glow: 0, glowColour: "#ffb070", light: null, spread: 35, seed: 8 }, (c) => ({ scale: diag(0.12, c, 4, 4000), soften: diag(0.002, c, 0, 50) })),
    look("golden-haze", "Golden Haze", "Warm haze lit by a low sun, glowing gold around it.", { density: 40, colour: "#c99a78", start: 92, ground: 10, height: 30, wisps: 25, glow: 90, glowColour: "#ffd28a", spread: 22, seed: 2 }, (c) => ({ scale: diag(0.3, c, 4, 4000), soften: diag(0.002, c, 0, 50), light: at(0.38, 0.45)(c) })),
    look("night", "Night Fog", "Deep blue night fog, a cold light glowing through it.", { density: 55, colour: "#16223f", start: 88, ground: 25, height: 30, wisps: 50, glow: 100, glowColour: "#8fd0ff", spread: 22, seed: 4 }, (c) => ({ scale: diag(0.2, c, 4, 4000), soften: diag(0.002, c, 0, 50), light: at(0.62, 0.3)(c) })),
  ],
});

/** Depth Particles' kinds, as the WGSL numbers them. */
export const PARTICLE_KINDS: Record<string, number> = { snow: 0, dust: 1, embers: 2, rain: 3, bokeh: 4 };

const DEPTH_PARTICLES = kernelFilter({
  type: "depth-particles",
  label: "Depth Particles",
  description:
    "Snow, dust, embers, rain or bokeh placed in the picture's depth (needs the depth model): Layers of seeded particles at depths between Far and Near (0 the farthest, 100 the nearest); a particle is hidden where the picture is nearer than it, so they fall behind the subject and in front of it. Nearer particles are bigger (Size is the nearest's radius in pixels), and softer the farther their depth is from Focus, by Blur. Kind: Snow (soft flakes covering the picture), Dust (motes lit where the picture behind is bright), Embers (hot glowing specks), Rain (thin streaks along Angle) or Bokeh (large out-of-focus discs of light). Amount is how many; Angle the direction they move (0° straight down, positive leaning right, 180° rising), Streak how drawn out they are along it (motion). Each particle takes a colour between Colour and Colour 2; Intensity is their brightness in stops (Snow: its opacity); Glow adds a halo of light round each. Seed picks the pattern. Over transparency particles add coverage.",
  category: "Depth",
  params: [
    choice("kind", "Kind", [["snow", "Snow"], ["dust", "Dust"], ["embers", "Embers"], ["rain", "Rain"], ["bokeh", "Bokeh"]], "snow", "What falls or floats: Snow covers, the others add light (Dust lit where the picture is bright, Embers glowing, Rain in streaks, Bokeh as big soft discs)."),
    percent("amount", "Amount", 55, "How many particles: 0 none."),
    pixels("size", "Size", 0.5, 400, 6, "The nearest particles' radius in document pixels; farther ones are smaller."),
    num("layers", "Layers", "", 1, 6, 4, "How many layers of particles at different depths, between Far and Near."),
    percent("far", "Far", 0, "The depth of the farthest particles (0: the farthest in the picture)."),
    percent("near", "Near", 100, "The depth of the nearest particles (100: in front of everything)."),
    percent("focus", "Focus", 35, "The depth in sharp focus: particles nearer or farther are softer."),
    percent("blur", "Blur", 50, "How soft particles out of focus become, growing into faint discs."),
    degrees("angle", "Angle", 10, "The direction they move: 0° straight down, positive leaning right, 180° rising."),
    percent("streak", "Streak", 0, "How drawn out they are along Angle, as by motion (Rain is always streaked)."),
    colour("colour", "Colour", "#ffffff", "The particles' colour."),
    colour("colour2", "Colour 2", "#dfe8ff", "Each particle takes a colour between Colour and this one."),
    num("intensity", "Intensity", "stops", -3, 4, 0, "How bright they are, in stops (Snow: how opaque).", 0.1, 1),
    percent("glow", "Glow", 20, "A halo of light around each particle.", 0, 300),
    seed("Which pattern of particles: another number, another one."),
  ],
  reach: () => 0,
  scene: () => ({ depth: true, subject: false }),
  isIdentity: (p) => n(p, "amount") === 0,
  summary: (p) => `${p.kind}, ${n(p, "amount")}%, ${n(p, "layers")} layers, size ${n(p, "size")} px`,
  presets: [
    look("snowfall", "Snowfall", "Soft snow falling behind and in front of the subject, the nearest flakes big and blurred.", { kind: "snow", amount: 55, layers: 4, far: 0, near: 100, focus: 40, blur: 55, angle: 10, streak: 0, colour: "#ffffff", colour2: "#dfe8ff", intensity: 0, glow: 20, seed: 1 }, (c) => ({ size: diag(0.006, c, 0.5, 400) })),
    look("embers", "Embers", "Hot embers rising through the air, glowing orange and red.", { kind: "embers", amount: 20, layers: 4, far: 10, near: 100, focus: 50, blur: 60, angle: 165, streak: 30, colour: "#ffc060", colour2: "#ff3000", intensity: 1, glow: 60, seed: 3 }, (c) => ({ size: diag(0.0022, c, 0.5, 400) })),
    look("dust", "Dust in the Light", "Fine dust motes hanging in the air, catching the light.", { kind: "dust", amount: 25, layers: 5, far: 20, near: 100, focus: 55, blur: 45, angle: 40, streak: 0, colour: "#fff2d6", colour2: "#ffd090", intensity: 0.8, glow: 40, seed: 2 }, (c) => ({ size: diag(0.0022, c, 0.5, 400) })),
    look("rain", "Rain", "Falling rain, thin lines slanting down through every depth.", { kind: "rain", amount: 45, layers: 4, far: 0, near: 100, focus: 40, blur: 30, angle: 12, streak: 60, colour: "#d6e6ff", colour2: "#ffffff", intensity: 0.3, glow: 0, seed: 6 }, (c) => ({ size: diag(0.0011, c, 0.5, 400) })),
    look("fireflies", "Fireflies", "Fireflies drifting in the dark, green-gold specks with soft halos.", { kind: "embers", amount: 14, layers: 3, far: 25, near: 95, focus: 45, blur: 50, angle: 0, streak: 0, colour: "#e4ff6a", colour2: "#7dff9a", intensity: 1, glow: 160, seed: 9 }, (c) => ({ size: diag(0.0035, c, 0.5, 400) })),
    look("bokeh", "Bokeh", "Big soft discs of out-of-focus light floating in front.", { kind: "bokeh", amount: 75, layers: 2, far: 60, near: 100, focus: 0, blur: 0, angle: 0, streak: 0, colour: "#ffd080", colour2: "#ff5aa8", intensity: 0.3, glow: 0, seed: 4 }, (c) => ({ size: diag(0.02, c, 0.5, 400) })),
  ],
});

const RELIGHT = kernelFilter({
  type: "relight",
  label: "Relight",
  description:
    "New lighting from the picture's depth (needs the depth model): its surface's slopes, from the depth map (Relief: how much its shape bends the light; Smoothness: over how many pixels the slopes are taken), lit by a coloured point light at Light (a point; empty is the canvas's centre), Height in front of the picture (a share of the diagonal: low grazes across it, high lights it flat), Intensity bright in stops, dimming with distance by Falloff (0 none, 100 as a real light's inverse square). Ambient is how much of the picture's own light is kept where the new light doesn't reach (0 black), tinted by Ambient Colour. Rim adds a rim of Rim Colour light round the edges of near things, from behind, opposite the light. Works in linear light; light can go above white.",
  category: "Depth",
  params: [
    point("light", "Light", "Where the light is, in document pixels; empty is the canvas's centre."),
    colour("colour", "Colour", "#fff1dc", "The light's colour."),
    num("intensity", "Intensity", "stops", -3, 4, 1.5, "How bright the light is, in stops: each one doubles it.", 0.1, 1),
    percent("height", "Height", 20, "How far in front of the picture the light is, as a share of the diagonal: low grazes across it, high lights it flatly.", 1, 200),
    percent("falloff", "Falloff", 80, "How the light dims with distance: 0 not at all, 100 as a real light does (inverse square)."),
    percent("ambient", "Ambient", 12, "How much of the picture's own light is kept where the new light doesn't reach: 0 goes black."),
    colour("ambientColour", "Ambient Colour", "#ffffff", "The colour of the light kept in the shadows."),
    percent("relief", "Relief", 60, "How much the picture's shape (from its depth) bends the light: 0 lights it as a flat print.", 0, 200),
    pixels("smoothness", "Smoothness", 1, 200, 8, "Over how many document pixels the shape's slopes are taken: more is smoother, broader shading."),
    percent("rim", "Rim", 0, "A rim of light round the edges of near things, from behind, opposite the light.", 0, 300),
    colour("rimColour", "Rim Colour", "#ffffff", "The rim light's colour."),
  ],
  reach: () => 0,
  scene: () => ({ depth: true, subject: false }),
  summary: (p) => `${n(p, "intensity") >= 0 ? "+" : ""}${n(p, "intensity")} stops, ambient ${n(p, "ambient")}%${n(p, "rim") ? `, rim ${n(p, "rim")}%` : ""}`,
  presets: [
    look("spotlight", "Key Light", "A warm pool of light on what's near, the rest falling into shadow.", { light: null, colour: "#fff1dc", intensity: 1.5, height: 20, falloff: 80, ambient: 12, ambientColour: "#ffffff", relief: 60, rim: 0, rimColour: "#ffffff" }, (c) => ({ smoothness: diag(0.008, c, 1, 200) })),
    look("neon-night", "Neon Night", "A magenta key from the side and a cyan rim from behind, in blue night.", { colour: "#ff2bd0", intensity: 1.6, height: 25, falloff: 55, ambient: 22, ambientColour: "#4a5ad8", relief: 80, rim: 220, rimColour: "#2ef0ff" }, (c) => ({ smoothness: diag(0.008, c, 1, 200), light: at(0.15, 0.4)(c) })),
    look("golden-hour", "Golden Hour Side Light", "Low golden sun grazing from the left, cool blue shadows.", { colour: "#ffb35c", intensity: 1.3, height: 12, falloff: 25, ambient: 35, ambientColour: "#7d8fc4", relief: 90, rim: 50, rimColour: "#ffcf8a" }, (c) => ({ smoothness: diag(0.01, c, 1, 200), light: at(-0.05, 0.35)(c) })),
    look("moody", "Moody", "A single soft light from above, deep shadows all round.", { colour: "#ffe4c4", intensity: 1.2, height: 25, falloff: 90, ambient: 6, ambientColour: "#506088", relief: 70, rim: 40, rimColour: "#a8c0ff" }, (c) => ({ smoothness: diag(0.01, c, 1, 200), light: at(0.68, 0.22)(c) })),
    look("under-lit", "Under-lit", "Firelight from below: an eerie orange glow on what's near, a dark sky.", { colour: "#ff7a36", intensity: 1.5, height: 14, falloff: 65, ambient: 12, ambientColour: "#283058", relief: 80, rim: 0, rimColour: "#ffffff" }, (c) => ({ smoothness: diag(0.008, c, 1, 200), light: at(0.5, 1.02)(c) })),
  ],
});

export const ATMOSPHERE_FILTERS: EffectDefinition[] = [FOG, DEPTH_PARTICLES, RELIGHT];

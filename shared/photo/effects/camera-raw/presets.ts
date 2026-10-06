/**
 * Camera Raw's built-in presets (docs/photo/camera-raw.md, "CR3"): the Color Grade filter's looks redone with Camera
 * Raw's own controls (its wheels for the split toning, the point curve for the fade), and a few of Camera Raw's own
 * (Glow's, Clarity's). Each is only what it changes: applied, the rest of the settings are the defaults.
 */
import type { CurvePoints, EffectParamValue } from "../../types.ts";
import type { EffectPreset } from "../params.ts";
import { identityCurveSet } from "../params.ts";

/** A matte fade on the point curve: blacks lifted, whites lowered a little (as Color Grade's Fade). */
const fade = (amount: number, white = amount / 4) => ({ pointCurve: { ...identityCurveSet(), rgb: [[0, Math.round(amount * 0.6)], [255, Math.round(255 - white * 0.6)]] as CurvePoints } });

const preset = (id: string, label: string, description: string, values: Record<string, EffectParamValue>): EffectPreset => ({
  id,
  label,
  description,
  params: () => structuredClone(values),
});

export const CAMERA_RAW_PRESETS: readonly EffectPreset[] = [
  preset("faded-film", "Faded Film", "Lifted, milky blacks, muted colour and warm highlights: an old print.", {
    temperature: 8,
    saturation: -25,
    contrast: 15,
    shadowsHue: 200,
    shadowsSaturation: 22,
    highlightsHue: 32,
    highlightsSaturation: 25,
    ...fade(65),
  }),
  preset("teal-orange", "Teal & Orange", "The blockbuster grade: teal shadows, orange skin and highlights, punchy.", {
    temperature: 4,
    vibrance: 15,
    contrast: 35,
    shadowsHue: 185,
    shadowsSaturation: 45,
    highlightsHue: 26,
    highlightsSaturation: 35,
    gradingBalance: 10,
  }),
  preset("pink-dream", "Pink Dream", "Hazy soft magenta highlights over lifted lilac blacks.", {
    temperature: 6,
    saturation: 10,
    contrast: -15,
    shadowsHue: 312,
    shadowsSaturation: 30,
    highlightsHue: 323,
    highlightsSaturation: 35,
    gradingBalance: 50,
    clarity: -20,
    ...fade(55),
  }),
  preset("cold-night", "Cold Night", "Cool blue, desaturated and dark: moonlight.", {
    temperature: -40,
    exposure: -0.4,
    saturation: -25,
    contrast: 25,
    shadowsHue: 221,
    shadowsSaturation: 35,
    highlightsHue: 220,
    highlightsSaturation: 15,
    gradingBalance: -10,
    ...fade(15),
  }),
  preset("cross-process", "Cross Process", "Slide film in the wrong chemicals: blue shadows, green-yellow highlights, hard contrast.", {
    temperature: -5,
    saturation: 30,
    contrast: 65,
    shadowsHue: 228,
    shadowsSaturation: 45,
    highlightsHue: 73,
    highlightsSaturation: 40,
  }),
  preset("bleach-bypass", "Bleach Bypass", "Silver left in: desaturated, harsh, metallic.", {
    saturation: -65,
    contrast: 70,
    clarity: 30,
    shadowsHue: 202,
    shadowsSaturation: 12,
    ...fade(8),
  }),
  preset("golden-hour", "Golden Hour", "Warm low sun: amber highlights, brown shadows.", {
    temperature: 30,
    vibrance: 15,
    contrast: 15,
    shadowsHue: 41,
    shadowsSaturation: 35,
    highlightsHue: 47,
    highlightsSaturation: 35,
    gradingBalance: 40,
    glow: 25,
    glowStyle: "bloom",
    glowWarmth: 50,
    ...fade(8),
  }),
  preset("vaporwave", "Vaporwave", "Pink highlights, cyan shadows, a soft fade: 80s retro-futurism.", {
    saturation: 30,
    contrast: 15,
    shadowsHue: 186,
    shadowsSaturation: 50,
    highlightsHue: 320,
    highlightsSaturation: 45,
    gradingBalance: 60,
    ...fade(25),
  }),
  preset("vivid", "Vivid", "More colour and local contrast, highlights held: Camera Raw's punchy look.", {
    vibrance: 35,
    contrast: 15,
    highlights: -30,
    shadows: 20,
    clarity: 20,
    texture: 15,
    dehaze: 10,
  }),
  preset("dreamy", "Dreamy", "Soft and luminous: clarity down, a diffused glow, lifted shadows.", {
    exposure: 0.15,
    clarity: -40,
    shadows: 30,
    glow: 50,
    glowStyle: "diffusion",
    glowRange: 60,
    ...fade(20),
  }),
  preset("film-halation", "Film Halation", "Red fringes round the lights, grain and a gentle fade: motion-picture film.", {
    contrast: 10,
    glow: 70,
    glowStyle: "halation",
    glowRange: 40,
    grain: 25,
    shadowsHue: 190,
    shadowsSaturation: 12,
    ...fade(12),
  }),
  preset("matte-bw", "Matte B&W", "Black and white with soft, lifted blacks and a little grain.", {
    treatment: "bw",
    contrast: 25,
    clarity: 15,
    grain: 20,
    ...fade(40),
  }),
];

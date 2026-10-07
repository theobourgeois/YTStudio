/**
 * Hue/Saturation (docs/photo/hue-saturation.md): Photoshop's Image › Adjustments › Hue/Saturation (⌘U), a filter on a
 * layer or an adjustment layer, as Camera Raw is. Master's Hue, Saturation and Lightness, then the same three for each
 * of six colour ranges (Reds, Yellows, Greens, Cyans, Blues, Magentas: Photoshop's ranges at their default widths);
 * Colorize gives every pixel one hue and saturation, keeping its lightness. Its reference is
 * `../reference/hue-saturation.ts`, its WGSL `src/suites/photo/render/hue-saturation.ts`.
 */
import type { EffectParamValue } from "../types.ts";
import type { EffectDefinition } from "./index.ts";
import { boolean, look, num } from "./kernel.ts";
import type { NumberParam, ParamSpec } from "./params.ts";

/** Photoshop's Edit menu's ranges, each centred on its hue (degrees: red 0, yellow 60…). */
export const HUE_RANGES = [
  { id: "reds", label: "Reds", centre: 0 },
  { id: "yellows", label: "Yellows", centre: 60 },
  { id: "greens", label: "Greens", centre: 120 },
  { id: "cyans", label: "Cyans", centre: 180 },
  { id: "blues", label: "Blues", centre: 240 },
  { id: "magentas", label: "Magentas", centre: 300 },
] as const;
export type HueRange = (typeof HUE_RANGES)[number]["id"];
/** What the window's Edit menu picks: Master or one range. */
export type HueChannel = "master" | HueRange;

/**
 * A range's full strength either side of its centre, and where its falloff ends (degrees): Photoshop's default
 * sliders (Reds: 345°/15° inside, 315°/45° outside). Neighbouring ranges' falloffs cross, so their weights sum to 1.
 */
export const RANGE_INNER = 15;
export const RANGE_OUTER = 45;

/** The keys of a channel's three sliders ("hue", or "redsHue"…). */
export const channelKeys = (channel: HueChannel) =>
  channel === "master" ? { hue: "hue", saturation: "saturation", lightness: "lightness" } : { hue: `${channel}Hue`, saturation: `${channel}Saturation`, lightness: `${channel}Lightness` };

const sliders = (channel: HueChannel, name: string): NumberParam[] => {
  const k = channelKeys(channel);
  const of = channel === "master" ? "every colour" : `the ${name.toLowerCase()}`;
  return [
    num(k.hue, channel === "master" ? "Hue" : `${name} Hue`, "°", -180, 180, 0, `Turns ${of} round the colour wheel by this many degrees.`),
    num(k.saturation, channel === "master" ? "Saturation" : `${name} Saturation`, "", -100, 100, 0, `More (positive) or less colour in ${of}: −100 is grey, +100 as saturated as it can be.`),
    num(k.lightness, channel === "master" ? "Lightness" : `${name} Lightness`, "", -100, 100, 0, `Mixes ${of} towards white (positive) or black (negative): ±100 is white or black.`),
  ];
};

export const HUE_SATURATION_PARAMS: readonly ParamSpec[] = [
  ...sliders("master", "Master"),
  ...HUE_RANGES.flatMap((r) => sliders(r.id, r.label)),
  boolean("colorize", "Colorize", false, "Every pixel takes one hue and saturation (colorizeHue, colorizeSaturation), keeping its lightness; Lightness still applies, the other sliders don't."),
  num("colorizeHue", "Colorize Hue", "°", 0, 360, 0, "Colorize's hue: 0 red, 60 yellow, 120 green, 180 cyan, 240 blue, 300 magenta."),
  num("colorizeSaturation", "Colorize Saturation", "", 0, 100, 25, "Colorize's saturation: 0 is grey."),
];

const n = (p: Record<string, EffectParamValue>, key: string) => (p[key] as number | undefined) ?? 0;

/** The sliders that change something (Colorize's while it's on, the others' while it's off; Lightness either way). */
export function changedSliders(p: Record<string, EffectParamValue>): string[] {
  if (p.colorize === true) return ["colorize", ...(n(p, "lightness") !== 0 ? ["lightness"] : [])];
  return HUE_SATURATION_PARAMS.filter((s) => s.kind === "number" && !s.key.startsWith("colorize") && n(p, s.key) !== 0).map((s) => s.key);
}

const signed = (v: number) => `${v > 0 ? "+" : ""}${v}`;

/** Photoshop's preset names; the values are ours (Photoshop doesn't say its own). */
const HUE_SATURATION_PRESETS = [
  look("default", "Default", "No change.", {}),
  look("cyanotype", "Cyanotype", "A blueprint's Prussian blue.", { colorize: true, colorizeHue: 205, colorizeSaturation: 30, lightness: -5 }),
  look("increase-saturation", "Increase Saturation", "A little more colour.", { saturation: 15 }),
  look("further-increase-saturation", "Further Increase Saturation", "More colour.", { saturation: 30 }),
  look("strong-saturation", "Strong Saturation", "Much more colour.", { saturation: 50 }),
  look("old-style", "Old Style", "A faded, brownish old print.", { colorize: true, colorizeHue: 38, colorizeSaturation: 18, lightness: -8 }),
  look("red-boost", "Red Boost", "Reds stronger, a touch darker.", { redsSaturation: 40, redsLightness: -5 }),
  look("sepia", "Sepia", "Warm brown tones.", { colorize: true, colorizeHue: 35, colorizeSaturation: 25 }),
  look("yellow-boost", "Yellow Boost", "Yellows stronger.", { yellowsSaturation: 40 }),
];

export const HUE_SATURATION: EffectDefinition = {
  type: "hue-saturation",
  version: 1,
  kind: "adjustment",
  kinds: ["adjustment", "filter"],
  kernel: true,
  label: "Hue/Saturation",
  description:
    "Photoshop's Hue/Saturation (⌘U), on the sRGB-encoded colour as Photoshop's: hue (degrees, −180 to 180), saturation and lightness (−100 to 100) for every colour, and the same for one range at a time (reds<Hue|Saturation|Lightness>, yellows…, greens…, cyans…, blues…, magentas…: Photoshop's ranges at their default widths, a range's own settings added to Master's). colorize: true gives every pixel colorizeHue (0–360) and colorizeSaturation (0–100), keeping its lightness. A filter on a layer, or an adjustment layer over everything below.",
  params: HUE_SATURATION_PARAMS,
  presets: HUE_SATURATION_PRESETS,
  region: "pointwise",
  reach: () => 0,
  isIdentity: (p) => changedSliders(p).length === 0,
  // On encoded values, and not linear.
  commutesWithReduction: () => false,
  summary: (p) => {
    if (p.colorize === true) return `colorized ${n(p, "colorizeHue")}°, saturation ${n(p, "colorizeSaturation")}${n(p, "lightness") !== 0 ? `, lightness ${signed(n(p, "lightness"))}` : ""}`;
    const parts: string[] = [];
    for (const channel of ["master", ...HUE_RANGES.map((r) => r.id)] as HueChannel[]) {
      const k = channelKeys(channel);
      const values = [
        n(p, k.hue) !== 0 && `hue ${signed(n(p, k.hue))}°`,
        n(p, k.saturation) !== 0 && `saturation ${signed(n(p, k.saturation))}`,
        n(p, k.lightness) !== 0 && `lightness ${signed(n(p, k.lightness))}`,
      ].filter(Boolean);
      if (values.length) parts.push(channel === "master" ? values.join(", ") : `${HUE_RANGES.find((r) => r.id === channel)!.label}: ${values.join(", ")}`);
    }
    return parts.join("; ") || "no change";
  },
};

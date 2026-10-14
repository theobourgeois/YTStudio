/**
 * A cover's colours, for pictures that take on each song's look (Now Playing's visualizer): the cover's pixels
 * grouped into a few colours (k-means in OKLab, where distances are as the eye sees them), then given roles. A
 * look uses roles, not colours, so the same look is red for one song and teal for the next. Colours meant to glow
 * are made vivid enough to (a dull brown cover still gets an amber); the background is the cover's own hue, deep.
 * Pure: the tests feed it made-up pictures.
 */

export interface AlbumPalette {
  /** Deep and dark: what a look draws on. */
  background: string;
  /** The cover's most striking colour. */
  primary: string;
  /** Another of its colours, of another hue. */
  secondary: string;
  /** The boldest, for hits and highlights. */
  accent: string;
  /** Near white, in the cover's hue: lines, sparks, type. */
  light: string;
  /** A black-and-white cover (its roles are greys and a cool accent). */
  mono: boolean;
}

/** What a look uses before a cover has been read (or without one). */
export const DEFAULT_PALETTE: AlbumPalette = {
  background: "#0a0820",
  primary: "#38bdf8",
  secondary: "#a855f7",
  accent: "#ff4fd8",
  light: "#eef6ff",
  mono: false,
};

export const PALETTE_ROLES = ["background", "primary", "secondary", "accent", "light"] as const;
export type PaletteRole = (typeof PALETTE_ROLES)[number];

type Lab = [l: number, a: number, b: number];

const toLinear = (c: number) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
const toGamma = (c: number) => (c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055);

/** sRGB (0..255) to OKLab. */
export function rgbToOklab(r: number, g: number, b: number): Lab {
  const [lr, lg, lb] = [toLinear(r / 255), toLinear(g / 255), toLinear(b / 255)];
  const l = Math.cbrt(0.4122214708 * lr + 0.5363325363 * lg + 0.0514459929 * lb);
  const m = Math.cbrt(0.2119034982 * lr + 0.6806995451 * lg + 0.1073969566 * lb);
  const s = Math.cbrt(0.0883024619 * lr + 0.2817188376 * lg + 0.6299787005 * lb);
  return [
    0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  ];
}

/** OKLab to linear sRGB (may be out of gamut). */
function oklabToLinear([L, A, B]: Lab): [number, number, number] {
  const l = (L + 0.3963377774 * A + 0.2158037573 * B) ** 3;
  const m = (L - 0.1055613458 * A - 0.0638541728 * B) ** 3;
  const s = (L - 0.0894841775 * A - 1.291485548 * B) ** 3;
  return [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  ];
}

/** OKLch (lightness 0..1, chroma, hue in radians) as `#rrggbb`, its chroma lowered until it fits sRGB. */
export function oklchHex(l: number, c: number, h: number): string {
  let chroma = c;
  let rgb = oklabToLinear([l, chroma * Math.cos(h), chroma * Math.sin(h)]);
  for (let i = 0; i < 24 && rgb.some((v) => v < -1e-4 || v > 1 + 1e-4); i++) {
    chroma *= 0.85;
    rgb = oklabToLinear([l, chroma * Math.cos(h), chroma * Math.sin(h)]);
  }
  return `#${rgb.map((v) => Math.round(Math.min(1, Math.max(0, toGamma(Math.min(1, Math.max(0, v))))) * 255).toString(16).padStart(2, "0")).join("")}`;
}

interface Cluster {
  lab: Lab;
  weight: number;
  chroma: number;
  hue: number;
}

/** A seeded random number generator, so a cover always gets the same palette. */
function seeded(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 0x100000000;
  };
}

const distance = (p: Lab, q: Lab) => (p[0] - q[0]) ** 2 + (p[1] - q[1]) ** 2 + (p[2] - q[2]) ** 2;

/** `points` grouped into `k` colours (k-means, started k-means++ style). */
function kMeans(points: Lab[], k: number): Cluster[] {
  const random = seeded(points.length * 31 + 7);
  const centres: Lab[] = [points[Math.floor(random() * points.length)]];
  while (centres.length < k) {
    const d = points.map((p) => Math.min(...centres.map((c) => distance(p, c))));
    const total = d.reduce((a, b) => a + b, 0);
    if (total <= 1e-12) break;
    let pick = random() * total;
    let i = 0;
    for (; i < d.length - 1 && pick > d[i]; i++) pick -= d[i];
    centres.push(points[i]);
  }
  const owner = new Int32Array(points.length);
  for (let round = 0; round < 12; round++) {
    points.forEach((p, i) => {
      let best = 0;
      for (let c = 1; c < centres.length; c++) if (distance(p, centres[c]) < distance(p, centres[best])) best = c;
      owner[i] = best;
    });
    const sums = centres.map(() => [0, 0, 0, 0]);
    points.forEach((p, i) => {
      const s = sums[owner[i]];
      s[0] += p[0];
      s[1] += p[1];
      s[2] += p[2];
      s[3]++;
    });
    sums.forEach((s, c) => {
      if (s[3]) centres[c] = [s[0] / s[3], s[1] / s[3], s[2] / s[3]];
    });
  }
  const weights = new Array<number>(centres.length).fill(0);
  for (const o of owner) weights[o]++;
  return centres
    .map((lab, c) => ({ lab, weight: weights[c] / points.length, chroma: Math.hypot(lab[1], lab[2]), hue: Math.atan2(lab[2], lab[1]) }))
    .filter((c) => c.weight > 0);
}

/** How far apart two hues are, in degrees (0..180). */
const hueGap = (a: number, b: number) => {
  const d = Math.abs(((a - b) * 180) / Math.PI) % 360;
  return d > 180 ? 360 - d : d;
};

/** Below this chroma a colour is a grey; but a big area this colourful still sets the mood. */
const GREY = 0.025;
const FAINT = 0.012;

/** A colour that glows: the cluster's hue, at least this vivid and this light. */
const vivid = (hue: number, chroma: number, lightness: number) => oklchHex(Math.min(0.84, Math.max(0.64, lightness)), Math.max(0.13, chroma * 1.15), hue);

/** The palette of a picture's pixels (RGBA, as a canvas gives them; a small one is plenty: 48 × 48). */
export function paletteFromPixels(rgba: ArrayLike<number>): AlbumPalette {
  const points: Lab[] = [];
  for (let i = 0; i + 3 < rgba.length; i += 4) if (rgba[i + 3] > 127) points.push(rgbToOklab(rgba[i], rgba[i + 1], rgba[i + 2]));
  if (points.length < 4) return DEFAULT_PALETTE;
  const clusters = kMeans(points, 8);
  const colourful = clusters.filter((c) => c.chroma >= GREY);
  const darkest = clusters.reduce((a, b) => (b.lab[0] < a.lab[0] ? b : a));

  if (!colourful.length || colourful.reduce((sum, c) => sum + c.weight, 0) < 0.02) {
    // Black and white: greys, and a cool accent to light things up.
    return {
      background: oklchHex(0.13, 0, 0),
      primary: oklchHex(0.92, 0, 0),
      secondary: oklchHex(0.66, 0, 0),
      accent: oklchHex(0.78, 0.09, (230 * Math.PI) / 180),
      light: oklchHex(0.97, 0, 0),
      mono: true,
    };
  }
  // Striking: plenty of it, colourful, not too dark.
  const striking = (c: Cluster) => Math.sqrt(c.weight) * (c.chroma + 0.02) * (0.4 + Math.min(1, c.lab[0] / 0.6));
  const ranked = [...colourful].sort((a, b) => striking(b) - striking(a));
  const primary = ranked[0];
  // Another hue: a colourful one, else a big faint one (a dark field's green beside a fire's orange).
  const tinted = clusters.filter((c) => c.chroma >= FAINT && c.weight >= 0.15).sort((a, b) => b.weight - a.weight);
  const secondary = ranked.find((c) => hueGap(c.hue, primary.hue) >= 35) ?? tinted.find((c) => hueGap(c.hue, primary.hue) >= 35);
  const accent = [...colourful]
    .filter((c) => c !== primary && c !== secondary && hueGap(c.hue, primary.hue) >= 25)
    .sort((a, b) => b.chroma * b.lab[0] - a.chroma * a.lab[0])[0];
  // Without colours of their own, a neighbour of the primary's hue (an accent stays the cover's, hotter and lighter).
  const secondHue = secondary?.hue ?? primary.hue - (40 * Math.PI) / 180;
  const accentHue = accent?.hue ?? primary.hue + (25 * Math.PI) / 180;
  const backgroundHue = darkest.chroma >= GREY ? darkest.hue : primary.hue;
  return {
    background: oklchHex(0.15, Math.min(0.06, Math.max(0.03, darkest.chroma)), backgroundHue),
    primary: vivid(primary.hue, primary.chroma, primary.lab[0]),
    secondary: vivid(secondHue, secondary?.chroma ?? primary.chroma, secondary?.lab[0] ?? primary.lab[0] - 0.08),
    accent: vivid(accentHue, Math.max(0.16, accent?.chroma ?? 0.18), accent?.lab[0] ?? 0.84),
    light: oklchHex(0.96, 0.03, primary.hue),
    mono: false,
  };
}

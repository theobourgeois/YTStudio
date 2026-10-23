/**
 * YTStudio's app icon: the YT collective's banner (a yen inside a tressure of fleurs-de-lis), or the earlier design,
 * three translucent ribbons of sound waving through a V. Drawn as SVG on Apple's icon grid (an 824 px
 * continuous-corner tile on a 1024 px canvas), rendered to PNG by headless Chromium.
 *
 *   pnpm tsx scripts/make-icon.ts [--design yt|wave] [--variant light|dark] [--out dir]
 *   pnpm tsx scripts/make-icon.ts --app video|music|photo|visualizer|all
 *
 * Writes icon.svg and icon.png (1024 px, what electron-builder turns into .icns/.ico) into resources/ by default,
 * and the light one as the web app's favicon (public/favicon.png). `--app` draws an app's own (docs/apps.md): the
 * banner in its colours, with a silver tressure, into resources/apps/<app>.svg and .png.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { chromium } from "playwright-core";
import sharp from "sharp";
import { type AppId, APPS, isAppId } from "../shared/apps.ts";

const ROOT = path.resolve(import.meta.dirname, "..");
const arg = (name: string) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? process.argv[i + 1] : undefined;
};
const variant = (arg("variant") ?? "light") as "light" | "dark";
/** yt: the YT collective's banner, the app's icon. wave: the ribbons it had before. */
const design = (arg("design") ?? "yt") as "yt" | "wave";
const outDir = path.resolve(arg("out") ?? path.join(ROOT, "resources"));

const SIZE = 1024;
const TILE = 824;
const INSET = (SIZE - TILE) / 2;

/**
 * A macOS tile: a rounded square whose corners ease into the sides (Apple's continuous corners), drawn as a
 * superellipse in each corner only, so the sides stay straight.
 */
function squircle(x: number, y: number, size: number): string {
  return `M${squirclePoints(x, y, size).map(([px, py]) => `${px.toFixed(2)},${py.toFixed(2)}`).join("L")}Z`;
}

/** The squircle's outline as points, clockwise from the top of its right-hand corner. */
function squirclePoints(x: number, y: number, size: number, radius = size * 0.2237, n = 4.2, steps = 48): [number, number][] {
  const points: [number, number][] = [];
  // Each corner is a quarter superellipse of 1.6x the radius, which looks like a circle of `radius` but smoother.
  const r = Math.min(radius * 1.6, size / 2);
  const corners = [
    { cx: x + size - r, cy: y + r, from: -Math.PI / 2 },
    { cx: x + size - r, cy: y + size - r, from: 0 },
    { cx: x + r, cy: y + size - r, from: Math.PI / 2 },
    { cx: x + r, cy: y + r, from: Math.PI },
  ];
  for (const { cx, cy, from } of corners) {
    for (let i = 0; i <= steps; i++) {
      const t = from + (i / steps) * (Math.PI / 2);
      const c = Math.cos(t);
      const s = Math.sin(t);
      points.push([cx + r * Math.sign(c) * Math.abs(c) ** (2 / n), cy + r * Math.sign(s) * Math.abs(s) ** (2 / n)]);
    }
  }
  return points;
}

/** A ribbon's colours, back to front, and how it mixes with what's behind it. */
type Ribbon = { light: string; deep: string; opacity: number };

const PALETTES = {
  light: {
    tileTop: "#ffffff",
    tileBottom: "#dfe5ef",
    rimTop: "#ffffff",
    rimBottom: "#b9c3d4",
    glow: "#3d7bff",
    sheen: 0.7,
    blend: "multiply",
    ribbons: [
      { light: "#cfeaff", deep: "#7cc0ff", opacity: 0.85 },
      { light: "#8fd0ff", deep: "#2f7dff", opacity: 0.82 },
      { light: "#5aa2ff", deep: "#0b3ff0", opacity: 0.9 },
    ] as Ribbon[],
  },
  dark: {
    tileTop: "#2b313b",
    tileBottom: "#12151a",
    rimTop: "#5b6575",
    rimBottom: "#0b0d10",
    glow: "#2f6bff",
    sheen: 0.1,
    blend: "screen",
    ribbons: [
      { light: "#2a64b0", deep: "#1a3f86", opacity: 0.9 },
      { light: "#4aa6ff", deep: "#1f5fe0", opacity: 0.85 },
      { light: "#9ad8ff", deep: "#3f7dff", opacity: 0.9 },
    ] as Ribbon[],
  },
} as const;

/**
 * One ribbon of the wave: a cosine under a bell, so it dips deepest in the middle (the V) and rises either side,
 * settling towards the edges. Its height is vertical, so it thins on the slopes like a ribbon turning.
 */
type Wave = { amplitude: number; halfPeriod: number; spread: number; thickness: number; shift: number };

const WAVES: Wave[] = [
  { amplitude: 175, halfPeriod: 0.36, spread: 0.68, thickness: 84, shift: -30 },
  { amplitude: 230, halfPeriod: 0.44, spread: 0.66, thickness: 118, shift: 0 },
  { amplitude: 185, halfPeriod: 0.54, spread: 0.72, thickness: 100, shift: 34 },
];

const WAVE_LEFT = 116;
const WAVE_RIGHT = SIZE - WAVE_LEFT;
/** Where the waves settle: above the middle, since the V hangs below it. */
const BASELINE = 470;

function ribbonPath(w: Wave, steps = 480): string {
  const top: string[] = [];
  const bottom: string[] = [];
  for (let i = 0; i <= steps; i++) {
    const x = WAVE_LEFT + ((WAVE_RIGHT - WAVE_LEFT) * i) / steps;
    const u = (x - SIZE / 2) / ((WAVE_RIGHT - WAVE_LEFT) / 2); // -1..1
    const bell = Math.exp(-(Math.abs(u / w.spread) ** 3));
    const y = BASELINE + w.shift * bell + w.amplitude * bell * Math.cos((Math.PI * u) / w.halfPeriod);
    // Thick through the V, tapering to a thread at the edges.
    const h = w.thickness * (0.18 + 0.82 * Math.exp(-((u / 0.62) ** 2)));
    top.push(`${x.toFixed(2)},${(y - h / 2).toFixed(2)}`);
    bottom.push(`${x.toFixed(2)},${(y + h / 2).toFixed(2)}`);
  }
  return `M${top.join("L")}L${bottom.reverse().join("L")}Z`;
}

function iconSvg(p: (typeof PALETTES)[keyof typeof PALETTES]): string {
  const tile = squircle(INSET, INSET, TILE);
  const ribbons = WAVES.map((w) => ribbonPath(w));
  const gradients = p.ribbons
    .map(
      (r, i) => `<linearGradient id="ribbon${i}" gradientUnits="userSpaceOnUse" x1="0" y1="270" x2="0" y2="740">
      <stop offset="0" stop-color="${r.light}"/>
      <stop offset="1" stop-color="${r.deep}"/>
    </linearGradient>`,
    )
    .join("\n    ");
  const drawn = ribbons
    .map((d, i) => `<path d="${d}" fill="url(#ribbon${i})" fill-opacity="${p.ribbons[i].opacity}" style="mix-blend-mode:${p.blend}"/>`)
    .join("\n      ");
  // Each ribbon's top edge catches the light, which is what makes it read as glass rather than paint.
  const shine = ribbons.map((d) => `<path d="${d}" fill="url(#shine)"/>`).join("");

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${SIZE}" height="${SIZE}" viewBox="0 0 ${SIZE} ${SIZE}">
  <defs>
    <linearGradient id="tile" x1="0" y1="0" x2="0.2" y2="1">
      <stop offset="0" stop-color="${p.tileTop}"/>
      <stop offset="0.55" stop-color="${p.tileTop}" stop-opacity="0.96"/>
      <stop offset="1" stop-color="${p.tileBottom}"/>
    </linearGradient>
    <!-- Light falling on the tile from above: a soft sheen over its top half. -->
    <radialGradient id="sheen" cx="0.5" cy="0" r="0.9">
      <stop offset="0" stop-color="#ffffff" stop-opacity="${p.sheen}"/>
      <stop offset="1" stop-color="#ffffff" stop-opacity="0"/>
    </radialGradient>
    <!-- Its edge: lit along the top, shaded along the bottom (Tahoe's glass rim). -->
    <linearGradient id="rim" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="${p.rimTop}" stop-opacity="1"/>
      <stop offset="0.35" stop-color="${p.rimTop}" stop-opacity="0"/>
      <stop offset="0.7" stop-color="${p.rimBottom}" stop-opacity="0"/>
      <stop offset="1" stop-color="${p.rimBottom}" stop-opacity="0.8"/>
    </linearGradient>
    ${gradients}
    <linearGradient id="shine" gradientUnits="userSpaceOnUse" x1="0" y1="270" x2="0" y2="520">
      <stop offset="0" stop-color="#ffffff" stop-opacity="0.35"/>
      <stop offset="1" stop-color="#ffffff" stop-opacity="0"/>
    </linearGradient>
    <!-- The ribbons fade into the tile at either end. -->
    <linearGradient id="fade" gradientUnits="userSpaceOnUse" x1="${WAVE_LEFT}" y1="0" x2="${WAVE_RIGHT}" y2="0">
      <stop offset="0" stop-color="#fff" stop-opacity="0"/>
      <stop offset="0.16" stop-color="#fff" stop-opacity="1"/>
      <stop offset="0.84" stop-color="#fff" stop-opacity="1"/>
      <stop offset="1" stop-color="#fff" stop-opacity="0"/>
    </linearGradient>
    <mask id="ends" maskUnits="userSpaceOnUse" x="0" y="0" width="${SIZE}" height="${SIZE}">
      <rect width="${SIZE}" height="${SIZE}" fill="url(#fade)"/>
    </mask>
    <!-- The tile floating over the desktop (macOS icons carry their own shadow). -->
    <filter id="drop" x="-20%" y="-20%" width="140%" height="140%">
      <feGaussianBlur in="SourceAlpha" stdDeviation="16"/>
      <feOffset dy="14"/>
      <feComponentTransfer><feFuncA type="linear" slope="0.3"/></feComponentTransfer>
      <feMerge><feMergeNode/><feMergeNode in="SourceGraphic"/></feMerge>
    </filter>
    <filter id="blur-glow" x="-20%" y="-40%" width="140%" height="180%"><feGaussianBlur stdDeviation="34"/></filter>
    <filter id="blur-shadow" x="-20%" y="-40%" width="140%" height="180%"><feGaussianBlur stdDeviation="14"/></filter>
    <clipPath id="tileClip"><path d="${tile}"/></clipPath>
  </defs>

  <g filter="url(#drop)">
    <path d="${tile}" fill="url(#tile)"/>
  </g>
  <g clip-path="url(#tileClip)">
    <path d="${tile}" fill="url(#sheen)"/>
    <!-- Light the ribbons cast on the tile, then the shade under them, so they float a little above it. -->
    <ellipse cx="${SIZE / 2}" cy="730" rx="130" ry="56" fill="${p.glow}" opacity="0.3" filter="url(#blur-glow)"/>
    <g mask="url(#ends)">
      <g transform="translate(0 22)" opacity="0.28" filter="url(#blur-shadow)" fill="${p.glow}">${ribbons.map((d) => `<path d="${d}"/>`).join("")}</g>
      <g style="isolation:isolate">
      ${drawn}
      </g>
      ${shine}
    </g>
    <path d="${tile}" fill="none" stroke="url(#rim)" stroke-width="5"/>
  </g>
</svg>`;
}

/**
 * The banner's colours: the tile, the lines, the yen, and what fills the lilies and the band between the lines (the
 * tile's own colour, or silver: a light gradient, lines of grey). `picture` is drawn on the tile under it all.
 */
interface YtPalette {
  tile: string;
  line: string;
  yen: string;
  silver?: boolean;
  picture?: string;
}

const YT_PALETTES = {
  light: { tile: "#ffffff", line: "#000000", yen: "#8418f5" },
  dark: { tile: "#000000", line: "#ffffff", yen: "#8418f5" },
} satisfies Record<string, YtPalette>;

/** Each app's colours (Théo's recolourings of the banner): the yen in its own colour on a field of another. */
const APP_PALETTES: Record<AppId, YtPalette> = {
  video: { tile: "#2b1c8f", line: "#7e7f88", yen: "#f6f1dc", silver: true },
  music: { tile: "#000000", line: "#7e7f88", yen: "#7a22f0", silver: true },
  photo: { tile: "#6a22e4", line: "#7e7f88", yen: "#ffffff", silver: true },
  // A frame of its own looks (the README's picture of Now Playing) for the field.
  visualizer: { tile: "#000000", line: "#7e7f88", yen: "#ffffff", silver: true, picture: "visualizer" },
};

/** The Visualizer's field: a square of one of its looks, darkened at the edges so the silver reads on it. */
async function visualizerPicture(): Promise<string> {
  const jpeg = await sharp(path.join(ROOT, "docs", "readme", "now-playing.jpg"))
    .extract({ left: 960, top: 0, width: 480, height: 450 })
    .resize(TILE, TILE)
    .modulate({ saturation: 1.15 })
    .jpeg({ quality: 92 })
    .toBuffer();
  return `data:image/jpeg;base64,${jpeg.toString("base64")}`;
}

/**
 * The banner's lily, traced from it (each piece is a region its outline encloses, out to the middle of the line), so
 * it's drawn as the banner draws it: outlines filled with the field. The head stands on the origin pointing up, 100
 * tall; the foot is what shows on the tressure's other side, also turned to point up.
 */
const FLEUR_HEAD = [
  "M16.04,-0.97C18.98,-4.24 28.60,-30.84 30.88,-42.06C33.93,-56.98 31.83,-65.84 22.55,-77.38C16.92,-84.38 1.20,-98.56 -0.09,-97.82C-2.94,-96.18 -15.92,-84.09 -20.14,-79.15C-27.87,-70.10 -30.73,-64.03 -31.13,-55.89C-31.65,-45.28 -27.35,-28.48 -19.31,-9.65C-14.60,1.39 -16.55,0.39 0.28,0.39C13.15,0.39 14.96,0.23 16.04,-0.97Z",
  "M-56.25,-0.42C-55.69,-0.99 -55.90,-2.16 -56.96,-4.29C-58.82,-8.05 -58.29,-12.28 -55.80,-13.61C-49.55,-16.96 -35.02,-12.06 -25.57,-3.42C-23.28,-1.33 -20.71,0.39 -19.87,0.39C-16.34,0.39 -16.51,-1.22 -21.27,-13.34C-23.80,-19.78 -25.87,-25.38 -25.87,-25.78C-25.87,-27.61 -35.87,-35.35 -42.39,-38.57C-66.96,-50.71 -92.98,-43.98 -93.03,-25.48C-93.05,-15.90 -82.18,-4.05 -70.00,-0.36C-66.96,0.55 -57.19,0.51 -56.25,-0.42Z",
  "M24.76,-2.01C27.99,-5.42 35.09,-10.13 39.86,-12.01C54.11,-17.62 62.61,-13.83 57.64,-4.07C55.69,-0.25 56.57,0.39 63.77,0.39C69.17,0.39 70.27,0.10 76.00,-2.77C96.88,-13.22 100.17,-33.14 82.47,-42.00C65.46,-50.51 30.73,-38.33 25.45,-22.01C24.70,-19.67 22.59,-14.13 20.76,-9.70C18.28,-3.69 17.64,-1.38 18.27,-0.62C19.68,1.08 22.38,0.51 24.76,-2.01Z",
  "M-25.94,-0.69C-23.53,-3.59 -40.13,-13.42 -48.54,-14.08C-57.43,-14.78 -60.52,-9.11 -54.74,-2.70L-51.94,0.39L-39.39,0.39C-29.59,0.39 -26.63,0.15 -25.94,-0.69Z",
  "M54.90,-1.55C61.76,-8.41 58.63,-14.95 48.92,-14.07C43.48,-13.58 34.86,-9.52 29.51,-4.93C23.87,-0.10 24.85,0.39 40.28,0.39C52.79,0.39 52.99,0.36 54.90,-1.55Z",
];
const FLEUR_FOOT = [
  "M3.87,-62.82C9.51,-56.58 13.51,-44.13 13.51,-32.84L13.51,-27.39L17.95,-29.63C26.91,-34.14 39.46,-36.99 41.19,-34.89C41.96,-33.97 41.26,-33.08 37.20,-29.78C28.68,-22.87 24.68,-16.36 22.73,-6.25C21.55,-0.09 22.67,-0.39 0.39,-0.39C-21.69,-0.39 -20.71,-0.15 -21.63,-5.79C-23.12,-14.97 -28.55,-23.79 -36.59,-30.11C-40.44,-33.13 -41.14,-34.02 -40.40,-34.92C-38.69,-36.97 -26.09,-34.12 -17.30,-29.69L-12.97,-27.51L-12.48,-34.99C-11.92,-43.51 -10.40,-49.92 -7.52,-55.81C-5.51,-59.91 -0.80,-66.02 0.36,-66.02C0.70,-66.02 2.28,-64.58 3.87,-62.82Z",
];

/** Arial's ¥ (the banner's), in font units: 2048 to the em, y up, 1466 tall. */
const ARIAL_YEN =
  "M477 0V325H62V464H477V607H62V755H403L-3 1466H197L487 950Q536 862 563 796Q586 849 645 959L919 1466H1133L728 755H1069V607H657V464H1069V325H657V0Z";

/** Where along a closed outline (0..1 of its length) a point is, and the way out of it there. */
function alongOutline(points: [number, number][], fraction: number): { x: number; y: number; nx: number; ny: number } {
  const lengths = [0];
  for (let i = 1; i <= points.length; i++) {
    const [ax, ay] = points[i - 1];
    const [bx, by] = points[i % points.length];
    lengths.push(lengths[i - 1] + Math.hypot(bx - ax, by - ay));
  }
  const at = (((fraction % 1) + 1) % 1) * lengths[points.length];
  let i = 1;
  while (lengths[i] < at) i++;
  const [ax, ay] = points[i - 1];
  const [bx, by] = points[i % points.length];
  const t = (at - lengths[i - 1]) / (lengths[i] - lengths[i - 1] || 1);
  const len = Math.hypot(bx - ax, by - ay) || 1;
  // Clockwise on screen, so outward is the tangent turned left.
  return { x: ax + (bx - ax) * t, y: ay + (by - ay) * t, nx: (by - ay) / len, ny: -(bx - ax) / len };
}

/** A squircle's outline measured from the middle of its top, so what's spaced along it falls symmetrically. */
function outlineFromTop(inset: number): [number, number][] {
  const points = squirclePoints(INSET + inset, INSET + inset, TILE - inset * 2);
  return [[SIZE / 2, points[0][1]], ...points];
}

/**
 * The YT collective's banner (the Royal Banner of Scotland with Arial's ¥ for its lion) on a flat tile: a tressure
 * of four lines following the tile's corners, flory-counter-flory, and the yen in the middle. No shading: the
 * banner is line art, and so is this.
 */
function ytSvg(p: YtPalette, LINES: number): string {
  const tile = squircle(INSET, INSET, TILE);
  const weight = 5;
  const first = 96; // the outermost line, in from the tile's edge
  // The banner has four lines; two, further apart, read better at the Dock's size.
  const spacing = ({ 2: 20, 3: 17 } as Record<number, number>)[LINES] ?? 13;
  const last = first + spacing * (LINES - 1);
  const ring = (inset: number) => squircle(INSET + inset, INSET + inset, TILE - inset * 2);
  const lines = Array.from({ length: LINES }, (_, i) => {
    const inset = first + i * spacing;
    return `<path d="${ring(inset)}"/>`;
  }).join("");

  // Lilies through the tressure at the corners and the sides' middles: the head outside, the foot inside.
  const outer = outlineFromTop(first);
  const inner = outlineFromTop(last);
  const scale = 0.62;
  // Half the head's width: where the corners' curve falls away from under its lobes.
  const reach = 56 * scale;
  const draw = (shapes: string[], outline: [number, number][], fraction: number, outwards: boolean) => {
    let { x, y, nx, ny } = alongOutline(outline, fraction);
    if (outwards) {
      // A head stands on a straight base; on a corner the line curves away under it, so it sinks into the tressure
      // until its lobes reach the line again (what sinks in is hidden between the lines).
      let sink = 0;
      for (const [qx, qy] of outline) {
        const along = (qx - x) * -ny + (qy - y) * nx;
        if (Math.abs(along) <= reach && Math.hypot(qx - x, qy - y) < reach * 2) sink = Math.max(sink, -((qx - x) * nx + (qy - y) * ny));
      }
      x -= nx * sink;
      y -= ny * sink;
    }
    const [dx, dy] = outwards ? [nx, ny] : [-nx, -ny];
    const angle = (Math.atan2(dx, -dy) * 180) / Math.PI;
    const transform = `translate(${x.toFixed(2)} ${y.toFixed(2)}) rotate(${angle.toFixed(2)}) scale(${scale})`;
    return `<g transform="${transform}" stroke-width="${(weight / scale).toFixed(2)}">${shapes.map((d) => `<path d="${d}"/>`).join("")}</g>`;
  };
  const COUNT = 8;
  const fleurs = Array.from({ length: COUNT }, (_, i) => draw(FLEUR_HEAD, outer, i / COUNT, true) + draw(FLEUR_FOOT, inner, i / COUNT, false)).join(
    "\n    ",
  );

  // The yen, centred on its box, as tall as half the tile.
  const yenScale = 410 / 1466;
  const yenX = SIZE / 2 - ((1133 - 3) / 2) * yenScale - -3 * yenScale;
  const yenY = SIZE / 2 + (1466 / 2) * yenScale;

  // Silver: lit from above, as metal is.
  const fill = p.silver ? "url(#silver)" : p.tile;
  const field = p.picture
    ? `<g clip-path="url(#tileClip)">
    <image href="${p.picture}" x="${INSET}" y="${INSET}" width="${TILE}" height="${TILE}" preserveAspectRatio="xMidYMid slice"/>
    <path d="${tile}" fill="url(#vignette)"/>
  </g>`
    : "";

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${SIZE}" height="${SIZE}" viewBox="0 0 ${SIZE} ${SIZE}">
  <defs>
    <linearGradient id="silver" gradientUnits="userSpaceOnUse" x1="0" y1="${INSET}" x2="0" y2="${INSET + TILE}">
      <stop offset="0" stop-color="#ffffff"/>
      <stop offset="0.5" stop-color="#e4e5ea"/>
      <stop offset="1" stop-color="#c3c5cc"/>
    </linearGradient>
    <radialGradient id="vignette" cx="0.5" cy="0.5" r="0.72">
      <stop offset="0.45" stop-color="#000" stop-opacity="0.15"/>
      <stop offset="1" stop-color="#000" stop-opacity="0.75"/>
    </radialGradient>
    <clipPath id="tileClip"><path d="${tile}"/></clipPath>
    <filter id="lift" x="-30%" y="-30%" width="160%" height="160%">
      <feGaussianBlur in="SourceAlpha" stdDeviation="16"/>
      <feComponentTransfer><feFuncA type="linear" slope="0.85"/></feComponentTransfer>
      <feMerge><feMergeNode/><feMergeNode in="SourceGraphic"/></feMerge>
    </filter>
  </defs>
  <path d="${tile}" fill="${p.tile}"/>
  ${field}
  <g fill="${fill}" stroke="${p.line}" stroke-linejoin="round">
    ${fleurs}
  </g>
  <path d="${ring(first)} ${ring(last)}" fill="${fill}" fill-rule="evenodd"/>
  <g fill="none" stroke="${p.line}" stroke-width="${weight}">${lines}</g>
  <path d="${ARIAL_YEN}" transform="translate(${yenX.toFixed(2)} ${yenY.toFixed(2)}) scale(${yenScale.toFixed(5)} ${(-yenScale).toFixed(5)})"
    fill="${p.yen}" stroke="${p.line}" stroke-width="${((weight * 2) / yenScale).toFixed(2)}" stroke-linejoin="miter" paint-order="stroke"${p.picture ? ' filter="url(#lift)"' : ""}/>
</svg>`;
}

/** Draw an SVG to a PNG of its size. */
async function render(page: import("playwright-core").Page, svg: string, file: string, size = SIZE) {
  await page.setViewportSize({ width: size, height: size });
  await page.setContent(`<html><body style="margin:0;background:transparent">${svg}</body></html>`);
  await page.waitForLoadState("load");
  await page.screenshot({ path: file, omitBackground: true, clip: { x: 0, y: 0, width: size, height: size } });
  console.log(`Wrote ${path.relative(process.cwd(), file)}`);
}

let browser;
try {
  browser = await chromium.launch();
} catch {
  browser = await chromium.launch({ channel: "chrome" });
}
const page = await browser.newPage({ viewport: { width: SIZE, height: SIZE } });

const appArg = arg("app");
if (appArg) {
  const apps = appArg === "all" ? (Object.keys(APPS) as AppId[]) : [appArg];
  const dir = path.resolve(arg("out") ?? path.join(ROOT, "resources", "apps"));
  mkdirSync(dir, { recursive: true });
  for (const id of apps) {
    if (!isAppId(id)) throw new Error(`No app called ${id}: ${Object.keys(APPS).join(", ")} or all.`);
    const palette = APP_PALETTES[id];
    const picture = palette.picture ? await visualizerPicture() : undefined;
    const svg = ytSvg({ ...palette, picture }, Number(arg("lines") ?? 2));
    writeFileSync(path.join(dir, `${id}.svg`), svg);
    await render(page, svg, path.join(dir, `${id}.png`));
    // The page's copy: the Dock's and Settings' "Its own" icon (shared/app-icons.ts), smaller.
    if (!arg("out")) {
      const PAGE = 512;
      mkdirSync(path.join(ROOT, "public", "app-icons", "apps"), { recursive: true });
      const small = svg.replace(`width="${SIZE}" height="${SIZE}"`, `width="${PAGE}" height="${PAGE}"`);
      await render(page, small, path.join(ROOT, "public", "app-icons", "apps", `${id}.png`), PAGE);
    }
  }
} else {
  mkdirSync(outDir, { recursive: true });
  const svg = design === "yt" ? ytSvg(YT_PALETTES[variant], Number(arg("lines") ?? 2)) : iconSvg(PALETTES[variant]);
  const suffix = (design === "yt" ? "" : `-${design}`) + (variant === "light" ? "" : `-${variant}`);
  writeFileSync(path.join(outDir, `icon${suffix}.svg`), svg);
  await render(page, svg, path.join(outDir, `icon${suffix}.png`));
  // The web app's favicon is the light icon too, drawn small rather than scaled down from the PNG.
  if (design === "yt" && variant === "light" && !arg("out")) {
    const FAVICON = 128;
    const small = svg.replace(`width="${SIZE}" height="${SIZE}"`, `width="${FAVICON}" height="${FAVICON}"`);
    await render(page, small, path.join(ROOT, "public", "favicon.png"), FAVICON);
  }
}
await browser.close();

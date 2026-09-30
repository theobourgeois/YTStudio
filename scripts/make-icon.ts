/**
 * Vaudio's app icon: a V drawn as a row of level-meter pills (video + audio) raised out of a soft, neumorphic
 * macOS tile. Drawn as SVG on Apple's icon grid (an 824 px continuous-corner tile on a 1024 px canvas, with room
 * for its shadow), rendered to PNG by headless Chromium.
 *
 *   pnpm tsx scripts/make-icon.ts [--variant light|dark] [--out dir]
 *
 * Writes icon.svg and icon.png (1024 px, what electron-builder turns into .icns/.ico) into resources/ by default.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { chromium } from "playwright-core";

const ROOT = path.resolve(import.meta.dirname, "..");
const arg = (name: string) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? process.argv[i + 1] : undefined;
};
const variant = (arg("variant") ?? "light") as "light" | "dark";
/** What the pills rise from: nothing (the tile itself), a round well, or a screen-shaped one. */
const wellShape = (arg("well") ?? "circle") as "none" | "circle" | "rect";
const outDir = path.resolve(arg("out") ?? path.join(ROOT, "resources"));

const SIZE = 1024;
const TILE = 824;
const INSET = (SIZE - TILE) / 2;

/**
 * A macOS tile: a rounded square whose corners ease into the sides (Apple's continuous corners), drawn as a
 * superellipse in each corner only, so the sides stay straight.
 */
function squircle(x: number, y: number, size: number, radius = size * 0.2237, n = 4.2, steps = 48): string {
  const points: string[] = [];
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
      points.push(`${(cx + r * Math.sign(c) * Math.abs(c) ** (2 / n)).toFixed(2)},${(cy + r * Math.sign(s) * Math.abs(s) ** (2 / n)).toFixed(2)}`);
    }
  }
  return `M${points.join("L")}Z`;
}

const PALETTES = {
  light: {
    tileTop: "#f8fafc",
    tileBottom: "#dfe4ec",
    well: "#e6eaf0",
    lightShadow: "#ffffff",
    darkShadow: "#a7b1c2",
    pillTop: "#6fa8f7",
    pillBottom: "#2f6be0",
    rim: "#ffffff",
  },
  dark: {
    tileTop: "#2a2f37",
    tileBottom: "#16191d",
    well: "#1d2127",
    lightShadow: "#343a44",
    darkShadow: "#07080a",
    pillTop: "#8cc0f7",
    pillBottom: "#3b7ae8",
    rim: "#4a5260",
  },
} as const;

function iconSvg(p: (typeof PALETTES)[keyof typeof PALETTES]): string {
  const tile = squircle(INSET, INSET, TILE);
  // The V: seven pills stepping down to the middle and back up, like a level meter.
  const count = 5;
  const pillWidth = 78;
  const gap = 32;
  const pillHeight = 212;
  const drop = 100; // how far each pill sits below the previous one, towards the middle
  const total = count * pillWidth + (count - 1) * gap;
  const left = SIZE / 2 - total / 2;
  const middle = (count - 1) / 2;
  // A V is heavier at the top, so it sits a little low to look centred.
  const top = SIZE / 2 - (pillHeight + middle * drop) / 2 + 18;
  const pills = Array.from({ length: count }, (_, i) => {
    const x = left + i * (pillWidth + gap);
    const y = top + (middle - Math.abs(i - middle)) * drop;
    return `<rect x="${x}" y="${y}" width="${pillWidth}" height="${pillHeight}" rx="${pillWidth / 2}"/>`;
  }).join("");
  // The well the pills rise from, pressed into the tile.
  const wellPad = 60;
  const box = { x: left - wellPad, y: top - wellPad, w: total + wellPad * 2, h: pillHeight + middle * drop + wellPad * 2 };
  const wellRadius = 330;
  const well =
    wellShape === "circle"
      ? `<circle cx="${SIZE / 2}" cy="${SIZE / 2}" r="${wellRadius}" fill="${p.well}" filter="url(#inset)"/>`
      : wellShape === "rect"
        ? `<rect x="${box.x}" y="${box.y}" width="${box.w}" height="${box.h}" rx="${Math.min(box.h, box.w) * 0.26}" fill="${p.well}" filter="url(#inset)"/>`
        : "";

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${SIZE}" height="${SIZE}" viewBox="0 0 ${SIZE} ${SIZE}">
  <defs>
    <linearGradient id="tile" x1="0" y1="0" x2="0.35" y2="1">
      <stop offset="0" stop-color="${p.tileTop}"/>
      <stop offset="1" stop-color="${p.tileBottom}"/>
    </linearGradient>
    <linearGradient id="pill" x1="0" y1="0" x2="0.3" y2="1">
      <stop offset="0" stop-color="${p.pillTop}"/>
      <stop offset="1" stop-color="${p.pillBottom}"/>
    </linearGradient>
    <linearGradient id="rim" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="${p.rim}" stop-opacity="0.9"/>
      <stop offset="0.5" stop-color="${p.rim}" stop-opacity="0"/>
    </linearGradient>
    <linearGradient id="gloss" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#ffffff" stop-opacity="0.55"/>
      <stop offset="0.45" stop-color="#ffffff" stop-opacity="0"/>
    </linearGradient>
    <!-- The tile floating over the desktop (Big Sur icons carry their own shadow). -->
    <filter id="drop" x="-20%" y="-20%" width="140%" height="140%">
      <feGaussianBlur in="SourceAlpha" stdDeviation="14"/>
      <feOffset dy="12"/>
      <feComponentTransfer><feFuncA type="linear" slope="0.32"/></feComponentTransfer>
      <feMerge><feMergeNode/><feMergeNode in="SourceGraphic"/></feMerge>
    </filter>
    <!-- Neumorphic: light from the top left, soft shade to the bottom right. -->
    <filter id="raised" x="-40%" y="-40%" width="180%" height="180%">
      <feGaussianBlur in="SourceAlpha" stdDeviation="16" result="blur"/>
      <feOffset in="blur" dx="14" dy="16" result="down"/>
      <feFlood flood-color="${p.darkShadow}" flood-opacity="0.85"/>
      <feComposite in2="down" operator="in" result="dark"/>
      <feOffset in="blur" dx="-12" dy="-12" result="up"/>
      <feFlood flood-color="${p.lightShadow}" flood-opacity="0.9"/>
      <feComposite in2="up" operator="in" result="light"/>
      <feMerge><feMergeNode in="dark"/><feMergeNode in="light"/><feMergeNode in="SourceGraphic"/></feMerge>
    </filter>
    <!-- Pressed in: shade inside the top left edge, light inside the bottom right. -->
    <filter id="inset" x="-10%" y="-10%" width="120%" height="120%">
      <feFlood flood-color="${p.darkShadow}" flood-opacity="0.9"/>
      <feComposite in2="SourceAlpha" operator="out" result="outside"/>
      <feGaussianBlur in="outside" stdDeviation="14" result="blurDark"/>
      <feOffset in="blurDark" dx="12" dy="14" result="darkOff"/>
      <feComposite in="darkOff" in2="SourceAlpha" operator="in" result="darkIn"/>
      <feFlood flood-color="${p.lightShadow}" flood-opacity="1"/>
      <feComposite in2="SourceAlpha" operator="out" result="outsideLight"/>
      <feGaussianBlur in="outsideLight" stdDeviation="12" result="blurLight"/>
      <feOffset in="blurLight" dx="-10" dy="-10" result="lightOff"/>
      <feComposite in="lightOff" in2="SourceAlpha" operator="in" result="lightIn"/>
      <feMerge><feMergeNode in="SourceGraphic"/><feMergeNode in="darkIn"/><feMergeNode in="lightIn"/></feMerge>
    </filter>
    <clipPath id="tileClip"><path d="${tile}"/></clipPath>
  </defs>

  <g filter="url(#drop)">
    <path d="${tile}" fill="url(#tile)"/>
  </g>
  <g clip-path="url(#tileClip)">
    <path d="${tile}" fill="none" stroke="url(#rim)" stroke-width="6"/>
    ${well}
    <g filter="url(#raised)" fill="url(#pill)">${pills}</g>
    <g fill="url(#gloss)">${pills}</g>
  </g>
</svg>`;
}

mkdirSync(outDir, { recursive: true });
const svg = iconSvg(PALETTES[variant]);
const suffix = variant === "light" ? "" : `-${variant}`;
writeFileSync(path.join(outDir, `icon${suffix}.svg`), svg);

let browser;
try {
  browser = await chromium.launch();
} catch {
  browser = await chromium.launch({ channel: "chrome" });
}
const page = await browser.newPage({ viewport: { width: SIZE, height: SIZE } });
await page.setContent(`<html><body style="margin:0;background:transparent">${svg}</body></html>`);
await page.screenshot({ path: path.join(outDir, `icon${suffix}.png`), omitBackground: true, clip: { x: 0, y: 0, width: SIZE, height: SIZE } });
await browser.close();
console.log(`Wrote ${path.relative(process.cwd(), path.join(outDir, `icon${suffix}.png`))}`);

/**
 * Calibrates the bevel and satin reference against Photoshop's renders (bevel-fixtures.json): prints each fixture's
 * largest and mean error in 8-bit levels along its row and column.
 *
 *   pnpm tsx scripts/photoshop-probes/fit-bevel.ts [filter]
 */
import fixtures from "../../shared/photo/reference/bevel-fixtures.json" with { type: "json" };
import { type BevelOptions, bevelHeight, bevelShade, satinAt, shadowOffset, signedDistance, tent } from "../../shared/photo/reference/style.ts";

const W = 320;
const shape = (kind: string) => {
  const a = new Float32Array(W * W);
  for (let y = 0; y < W; y++)
    for (let x = 0; x < W; x++) {
      const cov = kind === "disc" ? Math.min(1, Math.max(0, 80 - Math.hypot(x + 0.5 - 160, y + 0.5 - 160) + 0.5)) : x >= 90 && x < 230 && y >= 90 && y < 230 ? 1 : 0;
      a[y * W + x] = Math.round(cov * 255) / 255;
    }
  return a;
};
const shapes = { disc: shape("disc"), square: shape("square") };
const sds = { disc: signedDistance(shapes.disc, W, W), square: signedDistance(shapes.square, W, W) };

/** What the fixture's pixel would be: the grey layer on black, the bevel's white and black over it, encoded mixing. */
function bevelPixel(alpha: Float32Array, H: Float32Array, o: BevelOptions & { depth: number }, x: number, y: number) {
  const i = y * W + x;
  const a = alpha[i];
  let v = a * 128;
  const at = (xx: number, yy: number) => H[Math.min(W - 1, Math.max(0, yy)) * W + Math.min(W - 1, Math.max(0, xx))];
  const neighbours = { left: at(x - 1, y), right: at(x + 1, y), up: at(x, y - 1), down: at(x, y + 1) };
  const parts: [number, number][] =
    o.style === "inner-bevel" ? [[a, 1]] : o.style === "outer-bevel" ? [[1 - a, 1]] : o.style === "emboss" ? [[1, 1]] : [[1 - a, -1], [a, 1]];
  for (const [weight, sign] of parts) {
    if (weight <= 0) continue;
    const s = bevelShade(neighbours, { depth: o.depth / 100, size: o.size, style: o.style, down: false, angle: 120, altitude: 30, slopeScale: 1, sign }, (l) => l);
    v = v + (255 - v) * s.highlight * weight;
    v = v * (1 - s.shadow * weight);
  }
  return v;
}

const filter = process.argv[2] ?? "";
const rows = fixtures.rows as Record<string, { row: number[]; column: number[]; rowGreen?: number[]; columnGreen?: number[] }>;
for (const [key, f] of Object.entries(rows)) {
  if (!key.includes(filter)) continue;
  const kind = key.includes("disc") ? "disc" : "square";
  const alpha = shapes[kind];
  let got: (x: number, y: number) => number;
  if (key.startsWith("bevel-")) {
    const [, styleKey, tech, , extra] = key.split("-");
    const style = ({ outerBevel: "outer-bevel", innerBevel: "inner-bevel", emboss: "emboss", pillowEmboss: "pillow-emboss" } as Record<string, BevelOptions["style"]>)[styleKey];
    const technique = ({ softMatte: "smooth", preciseMatte: "chisel-hard", slopeLimitMatte: "chisel-soft" } as Record<string, BevelOptions["technique"]>)[tech];
    const num = (name: string, fallback: number) => (extra?.startsWith(name) ? Number(extra.slice(name.length)) : fallback);
    const o = { style, technique, size: num("size", 20), soften: num("soften", 0), depth: num("depth", 100) };
    const H = bevelHeight(alpha, sds[kind], W, W, o);
    got = (x, y) => bevelPixel(alpha, H, o, x, y);
  } else {
    // Satin: red, Normal, 100% over the grey layer, angle 19, distance 11, size 14.
    const G = tent(alpha, W, W, 14, 0);
    const blurred = (x: number, y: number) => {
      const xi = Math.round(x - 0.5);
      const yi = Math.round(y - 0.5);
      return xi < 0 || yi < 0 || xi >= W || yi >= W ? 0 : G[yi * W + xi];
    };
    const off = shadowOffset(19, 11);
    const invert = key.includes("invert");
    got = (x, y) => {
      const a = alpha[y * W + x];
      const m = satinAt(blurred, (v) => v, x + 0.5, y + 0.5, off, invert) * a;
      return a * 128 + (255 - 128) * m; // red channel: grey towards 255 by the satin's coverage
    };
  }
  let max = 0;
  let total = 0;
  let n = 0;
  let worst = "";
  for (let k = 0; k < 221; k++) {
    for (const [want, x, y] of [[f.row[k], 50 + k, 160], [f.column[k], 160, 50 + k]] as const) {
      const e = Math.abs(Math.round(got(x, y)) - want);
      total += e;
      n++;
      if (e > max) [max, worst] = [e, `(${x}, ${y}) ${Math.round(got(x, y))} vs ${want}`];
    }
  }
  console.log(`${key.padEnd(52)} max ${String(max).padStart(3)}  mean ${(total / n).toFixed(2)}  worst ${worst}`);
}

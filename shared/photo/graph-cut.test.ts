import { describe, expect, it } from "vitest";
import { GridCut } from "./graph-cut.ts";

/** A seeded generator, so a failure repeats. */
function random(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
}

interface Problem {
  width: number;
  height: number;
  source: number[];
  sink: number[];
  right: number[];
  down: number[];
}

const energy = (p: Problem, labels: ArrayLike<number>) => {
  let e = 0;
  for (let i = 0; i < labels.length; i++) {
    e += labels[i] ? p.sink[i] : p.source[i];
    const x = i % p.width;
    if (x + 1 < p.width && labels[i] !== labels[i + 1]) e += p.right[i];
    if (i + p.width < labels.length && labels[i] !== labels[i + p.width]) e += p.down[i];
  }
  return e;
};

function solve(p: Problem) {
  const cut = new GridCut(p.width, p.height);
  for (let i = 0; i < p.width * p.height; i++) {
    cut.setTerminals(i, p.source[i], p.sink[i]);
    if (i % p.width < p.width - 1) cut.setEdge(i, false, p.right[i]);
    if (i + p.width < p.width * p.height) cut.setEdge(i, true, p.down[i]);
  }
  return cut.solve();
}

describe("GridCut", () => {
  it("finds the minimum energy of every labelling, on random small grids", () => {
    for (let seed = 1; seed <= 300; seed++) {
      const r = random(seed);
      const width = 1 + Math.floor(r() * 4);
      const height = 1 + Math.floor(r() * 4);
      const n = width * height;
      // Whole numbers keep the comparison exact; some hard constraints, some ties.
      const value = () => (r() < 0.1 ? 1000 : Math.floor(r() * 10));
      const p: Problem = { width, height, source: Array.from({ length: n }, value), sink: Array.from({ length: n }, value), right: Array.from({ length: n }, () => Math.floor(r() * 8)), down: Array.from({ length: n }, () => Math.floor(r() * 8)) };
      let best = Infinity;
      for (let m = 0; m < 1 << n; m++) best = Math.min(best, energy(p, Array.from({ length: n }, (_, i) => (m >> i) & 1)));
      expect(energy(p, solve(p)), `seed ${seed}`).toBe(best);
    }
  });

  it("cuts along the weakest edges between two seeds", () => {
    // A 40 × 20 grid: the left column is foreground, the right background; edges are cheap only along x = 25.
    const width = 40;
    const height = 20;
    const n = width * height;
    const p: Problem = { width, height, source: new Array(n).fill(0), sink: new Array(n).fill(0), right: new Array(n).fill(50), down: new Array(n).fill(50) };
    for (let y = 0; y < height; y++) {
      p.source[y * width] = 1e9;
      p.sink[y * width + width - 1] = 1e9;
      p.right[y * width + 25] = 1;
    }
    const labels = solve(p);
    for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) expect(labels[y * width + x]).toBe(x <= 25 ? 1 : 0);
  });

  it("solves a big grid quickly", () => {
    const width = 400;
    const height = 400;
    const r = random(7);
    const cut = new GridCut(width, height);
    for (let i = 0; i < width * height; i++) {
      const x = i % width;
      const y = Math.floor(i / width);
      const inside = Math.hypot(x - 200, y - 200) < 120;
      cut.setTerminals(i, inside ? 2 + r() : r(), inside ? r() : 2 + r());
      if (x < width - 1) cut.setEdge(i, false, 3 * r());
      if (y < height - 1) cut.setEdge(i, true, 3 * r());
    }
    const started = performance.now();
    const labels = cut.solve();
    const ms = performance.now() - started;
    expect(labels[200 * width + 200]).toBe(1);
    expect(labels[5 * width + 5]).toBe(0);
    expect(ms).toBeLessThan(1500);
  });
});

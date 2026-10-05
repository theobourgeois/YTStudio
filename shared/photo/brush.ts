/**
 * The round brush's geometry: pointer samples (document pixels) become evenly spaced dabs, wherever the
 * samples fall and whatever the zoom, so the same input always paints the same pixels (ux.md, "Selections,
 * masks and brushes"). The GPU stamps the dabs; this decides where they go.
 */
import type { TileSize } from "./lab.ts";

export interface BrushSettings {
  /** Radius in document pixels. */
  radius: number;
  /** 0..1: the share of the radius painted at full strength before the edge falls off. */
  hardness: number;
  /** 0..1: how much each dab covers at its centre. */
  strength: number;
  /** Distance between dabs as a fraction of the diameter (Photoshop's Spacing; 0.1 = 10%). */
  spacing: number;
}

export interface Dab {
  x: number;
  y: number;
  radius: number;
  hardness: number;
  strength: number;
}

/** The first dab lands on the first sample; the rest every `step` pixels along the path between samples. */
export class DabSpacer {
  private last: { x: number; y: number } | null = null;
  /** Distance travelled since the last dab. */
  private travelled = 0;

  constructor(readonly brush: BrushSettings) {}

  private get step() {
    return Math.max(0.5, this.brush.spacing * 2 * this.brush.radius);
  }

  private dab(x: number, y: number): Dab {
    const { radius, hardness, strength } = this.brush;
    return { x, y, radius, hardness, strength };
  }

  /** The dabs this sample adds. */
  add(x: number, y: number): Dab[] {
    if (!this.last) {
      this.last = { x, y };
      this.travelled = 0;
      return [this.dab(x, y)];
    }
    const out: Dab[] = [];
    const dx = x - this.last.x;
    const dy = y - this.last.y;
    const length = Math.hypot(dx, dy);
    const step = this.step;
    // The next dab is `step - travelled` along this segment.
    let at = step - this.travelled;
    while (at <= length) {
      const t = at / length;
      out.push(this.dab(this.last.x + dx * t, this.last.y + dy * t));
      at += step;
    }
    this.travelled = length - (at - step);
    this.last = { x, y };
    return out;
  }
}

/** Every dab of a stroke through `samples`. */
export function strokeDabs(brush: BrushSettings, samples: readonly { x: number; y: number }[]): Dab[] {
  const spacer = new DabSpacer(brush);
  return samples.flatMap((s) => spacer.add(s.x, s.y));
}

/** The tiles a dab can touch (its square bounds), as "tx,ty" keys with their coordinates. */
export function tilesUnder(dabs: readonly Dab[], tile: TileSize): Map<string, { tx: number; ty: number }> {
  const out = new Map<string, { tx: number; ty: number }>();
  for (const d of dabs) {
    const x0 = Math.floor((d.x - d.radius) / tile);
    const x1 = Math.floor((d.x + d.radius) / tile);
    const y0 = Math.floor((d.y - d.radius) / tile);
    const y1 = Math.floor((d.y + d.radius) / tile);
    for (let ty = y0; ty <= y1; ty++) for (let tx = x0; tx <= x1; tx++) out.set(`${tx},${ty}`, { tx, ty });
  }
  return out;
}

/**
 * How much of a dab covers a point `distance` from its centre: full inside `hardness × radius`, then a
 * smooth fall to nothing at the radius. The GPU's stamp computes the same curve (kernels/stamp).
 */
export function dabCoverage(dab: Pick<Dab, "radius" | "hardness" | "strength">, distance: number): number {
  const inner = dab.radius * Math.min(0.999, Math.max(0, dab.hardness));
  if (distance <= inner) return dab.strength;
  if (distance >= dab.radius) return 0;
  const t = (distance - inner) / (dab.radius - inner);
  return dab.strength * (1 - t * t * (3 - 2 * t));
}

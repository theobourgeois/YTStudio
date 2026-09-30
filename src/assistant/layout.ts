/**
 * Where things are on the canvas, written for a model (`get_layout`): each clip's box, what
 * a text's letters cover, and where its anchor is, in px of the canvas at 1080p. With it the
 * assistant can size a box to a title or line two things up without guessing from frames.
 */
import { clipKind } from "@shared/effects";
import { clipName } from "@shared/timeline";
import { type Size, toCanvas } from "@shared/transform";
import type { MediaAsset, Vec2 } from "@shared/types";
import { type OnCanvas, boxCorners } from "@/components/preview/placement";
import { secs } from "./input";

const px = (n: number) => String(Math.round(n));
const fraction = (n: number) => String(Math.round(n * 1000) / 1000);

interface Bounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** The upright box around some canvas points. */
export function boundsOf(points: readonly Vec2[]): Bounds {
  const xs = points.map((p) => p[0]);
  const ys = points.map((p) => p[1]);
  const [x, y] = [Math.min(...xs), Math.min(...ys)];
  return { x, y, width: Math.max(...xs) - x, height: Math.max(...ys) - y };
}

const boxText = (b: Bounds) => `x ${px(b.x)} y ${px(b.y)} w ${px(b.width)} h ${px(b.height)}`;

/** One clip's box on the canvas (as the camera sees it, for a 3D layer), and for a text the box around its letters alone. */
export function clipBoxes(c: OnCanvas): { box: Bounds; letters?: Bounds } {
  const box = boundsOf(c.corners3d ?? boxCorners(c));
  if (!c.text || c.corners3d) return { box };
  // The frame has a margin around the letters (for strokes, shadows, animators): this is the block of lines itself.
  const t = c.text;
  const at = (x: number, y: number) => toCanvas(c.placement, [x, y]);
  const letters = boundsOf([at(t.x, t.y), at(t.x + t.blockWidth, t.y), at(t.x + t.blockWidth, t.y + t.blockHeight), at(t.x, t.y + t.blockHeight)]);
  return { box, letters };
}

/**
 * What's on the canvas at timeline time `time`, top layer first (`clips`: placed on a canvas
 * of `canvas` px, the video's size at 1080p). Only `only` when given.
 */
export function describeLayout(clips: readonly OnCanvas[], assets: Readonly<Record<string, MediaAsset>>, canvas: Size, time: number, only?: readonly string[]): string {
  const shown = only ? clips.filter((c) => only.includes(c.clip.id)) : clips;
  const lines = [
    `Canvas ${px(canvas.width)}×${px(canvas.height)} px at ${secs(time)}s. Boxes are upright bounds in px from the top left (y down); ` +
      `as motion position fractions, x / ${px(canvas.width)} and y / ${px(canvas.height)}. Top layer first.`,
  ];
  if (!shown.length) {
    lines.push(only ? "None of those clips is on the canvas at that time (see get_timeline for when they play)." : "Nothing is on the canvas at that time.");
    return lines.join("\n");
  }
  for (const c of shown) {
    const kind = clipKind(c.clip);
    const { box, letters } = clipBoxes(c);
    const p = c.placement;
    const what =
      kind === "text"
        ? `text ${JSON.stringify(clipName(c.clip, undefined))}`
        : kind === "media"
          ? `${assets[c.clip.assetId]?.kind ?? "media"} ${JSON.stringify(clipName(c.clip, assets[c.clip.assetId]))}`
          : kind === "shape"
            ? "shape layer (its box is what it draws)"
            : kind === "adjustment"
              ? "adjustment layer"
              : kind === "null"
                ? "null object"
                : kind;
    const centre: Vec2 = [box.x + box.width / 2, box.y + box.height / 2];
    const parts = [
      `box ${boxText(box)}`,
      `centre (${px(centre[0])}, ${px(centre[1])}) = [${fraction(centre[0] / canvas.width)}, ${fraction(centre[1] / canvas.height)}]`,
      ...(letters ? [`letters ${boxText(letters)}`] : []),
      `anchor at (${px(p.x)}, ${px(p.y)})`,
      ...(Math.abs(p.scaleX - 1) > 1e-3 || Math.abs(p.scaleY - 1) > 1e-3
        ? [`scale ${p.scaleX === p.scaleY ? `${px(p.scaleY * 100)}%` : `${px(p.scaleX * 100)}% × ${px(p.scaleY * 100)}%`}`]
        : []),
      ...(Math.abs(p.rotation) > 1e-3 ? [`rotated ${fraction(p.rotation)}°`] : []),
      ...(c.corners3d ? ["3D layer (as the camera sees it)"] : []),
      ...(c.clip.parent ? [`carried by its parent ${c.clip.parent.id}`] : []),
    ];
    lines.push(`${c.clip.id}  ${what}  ${parts.join(" · ")}`);
  }
  lines.push(
    "To put a shape behind a text: a shape layer on a track below it, its vector-shape `position` the letters' centre as fractions and `size` their w and h plus padding (in px). " +
      "To line things up, give them the same centre x or y. Boxes move with animation: ask again at another time.",
  );
  return lines.join("\n");
}

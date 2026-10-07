/**
 * A shape layer's thumbnail in Layers: what it draws, fitted to the thumbnail (a small arrow on a big canvas would
 * vanish in a thumbnail of the canvas), as SVG from the same paths the canvas draws, its strokes kept legible.
 */
import { useMemo } from "react";
import { pathData, shapeDrawing } from "@shared/photo/shape-drawing";
import type { ShapeLayer } from "@shared/photo/types";

/** The thumbnail's side, in CSS pixels (as the other layers' thumbnails). */
const SIDE = 32;

export function ShapeThumb({ layer }: { layer: ShapeLayer }) {
  const drawing = useMemo(() => shapeDrawing(layer), [layer]);
  const b = drawing.bounds;
  if (!b) {
    return <span className="block size-8 shrink-0 rounded-sm bg-surface-2" aria-hidden data-thumbnail="shape" />;
  }
  const side = Math.max(b.x1 - b.x0, b.y1 - b.y0);
  const pad = side * 0.08;
  const cx = (b.x0 + b.x1) / 2;
  const cy = (b.y0 + b.y1) / 2;
  const half = side / 2 + pad;
  const scale = SIDE / (2 * half);
  return (
    <svg viewBox={`${cx - half} ${cy - half} ${2 * half} ${2 * half}`} className="size-8 shrink-0 rounded-sm bg-surface-2" aria-hidden data-thumbnail="shape">
      {drawing.items.map((item, i) =>
        item.kind === "fill" ? (
          <path key={i} d={pathData(item.path)} fill={item.colour} />
        ) : (
          <path
            key={i}
            d={pathData(item.path)}
            fill="none"
            stroke={item.colour}
            // Legible at a thumbnail's size: as drawn, but between 1 and 3 screen pixels.
            strokeWidth={Math.min(3, Math.max(1, item.width * scale)) / scale}
            strokeLinecap={item.cap}
            strokeLinejoin={item.join}
          />
        ),
      )}
    </svg>
  );
}

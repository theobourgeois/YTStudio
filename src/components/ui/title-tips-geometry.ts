/** Where a title's tip goes (`title-tips.tsx`): pure, and tested. */

export interface TipRect {
  left: number;
  top: number;
  width: number;
  height: number;
}

/** Room kept between the tip and its control, and between the tip and the window's edges. */
export const TIP_GAP = 6;
export const TIP_MARGIN = 4;

/**
 * The tip's top-left corner for a control at `anchor`: centred under it, or over it when there's no room
 * below, and kept inside the window (`view`) either way.
 */
export function placeTip(anchor: TipRect, tip: { width: number; height: number }, view: { width: number; height: number }): { left: number; top: number; side: "bottom" | "top" } {
  const below = anchor.top + anchor.height + TIP_GAP;
  const above = anchor.top - TIP_GAP - tip.height;
  const fitsBelow = below + tip.height <= view.height - TIP_MARGIN;
  const side = fitsBelow || above < TIP_MARGIN ? "bottom" : "top";
  const centred = anchor.left + anchor.width / 2 - tip.width / 2;
  const left = Math.max(TIP_MARGIN, Math.min(centred, view.width - TIP_MARGIN - tip.width));
  const top = side === "bottom" ? Math.min(below, Math.max(TIP_MARGIN, view.height - TIP_MARGIN - tip.height)) : above;
  return { left: Math.round(left), top: Math.round(top), side };
}

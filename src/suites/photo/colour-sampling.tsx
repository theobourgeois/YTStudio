/**
 * Sampling the canvas's colours (docs/photo/tools/eyedropper.md): what the Eyedropper's press does (a drag following
 * the pointer, Photoshop's sampling ring showing the new colour over the one it replaces), and, as in Photoshop's
 * Color Picker, every colour picker open in the photo editor an eyedropper over the canvas (`photoColourSampler`): a
 * press there samples into it, whatever the tool. Kept apart from the tool's kit (`toolbox/eyedropper.tsx`), which
 * the canvas and the workspace reach through the toolbox.
 */
import { createPortal } from "react-dom";
import type { PointerEvent as ReactPointerEvent } from "react";
import { create } from "zustand";
import { averageColour, eyedropperBox } from "@shared/photo/eyedropper";
import type { ColorSampler, ColorTarget } from "@/components/color-picker";
import { startPointerDrag } from "@/lib/pointer-drag";
import { EYEDROPPER_CURSOR } from "./canvas/cursors";
import { useColours } from "./colours";
import { liveRenderer } from "./live";
import { sampledLayer } from "./selecting";
import { currentDoc } from "./store";
import { useEyedropperOptions } from "./toolbox/eyedropper-options";
import type { DocPointOf } from "./toolbox/kit";

/**
 * The colour at document point `at` ("#rrggbb") as the options read it (the Eyedropper's, unless given), or null off
 * the canvas or on transparency.
 */
export async function sampleColourAt(at: { x: number; y: number }, o: { sampleSize: number; sampleAll: boolean } = useEyedropperOptions.getState()): Promise<string | null> {
  const doc = currentDoc();
  const pending = liveRenderer();
  if (!doc || !pending) return null;
  const box = eyedropperBox(at, o.sampleSize, doc.canvas);
  if (!box) return null;
  const renderer = await pending;
  return averageColour(await renderer.sampleView(doc, { zoom: 1, ...box }, sampledLayer(doc, o.sampleAll)));
}

/** The sampling ring while a press samples: where (client pixels), the colour now and the one it replaces. */
interface Ring {
  x: number;
  y: number;
  now: string;
  before: string;
}

const useSamplingRing = create<{ ring: Ring | null }>(() => ({ ring: null }));

/**
 * A press sampling the canvas into `target`: the colour under the pointer as it moves, one gesture of the target's
 * (`begin` at the press, `end` once the last sample is in); Escape puts the colour back. Samples are rendered one at a
 * time, the latest point wins.
 */
export function startSampling(e: ReactPointerEvent<HTMLElement>, docPoint: DocPointOf, target: ColorTarget) {
  const before = target.value();
  let now = before;
  let client = { x: e.clientX, y: e.clientY };
  let next: { x: number; y: number } | null = null;
  let running: Promise<void> | null = null;
  let dropped = false;
  const showRing = () => useSamplingRing.setState({ ring: useEyedropperOptions.getState().ring ? { ...client, now, before } : null });
  const pump = async () => {
    while (next && !dropped) {
      const at = next;
      next = null;
      const hex = await sampleColourAt(at).catch(() => null);
      if (!hex || dropped) continue;
      now = hex;
      target.edit.set(hex);
      showRing();
    }
    running = null;
  };
  const sample = (ev: { clientX: number; clientY: number }) => {
    client = { x: ev.clientX, y: ev.clientY };
    next = docPoint(ev.clientX, ev.clientY);
    running ??= pump();
    showRing();
  };
  const finish = (keep: boolean) => {
    dropped = !keep;
    void (running ?? Promise.resolve()).then(() => {
      if (!keep && now !== before) target.edit.set(before);
      target.edit.end();
      useSamplingRing.setState({ ring: null });
    });
  };
  target.edit.begin();
  sample(e);
  startPointerDrag(e, {
    threshold: 0,
    cursor: EYEDROPPER_CURSOR,
    onMove: sample,
    onEnd: () => finish(true),
    onClick: () => finish(true),
    onCancel: () => finish(false),
  });
}

/** The foreground or background colour (the tool strip's) as something to sample into. */
export const colourSwatch = (which: "foreground" | "background"): ColorTarget => ({
  edit: { begin: () => {}, set: (hex) => useColours.getState().set({ [which]: hex }), end: () => {} },
  value: () => useColours.getState()[which],
});

/** The colour pickers shown in the photo editor, the last shown last: a press on the canvas samples into it. */
export const useColourTargets = create<{ targets: ColorTarget[] }>(() => ({ targets: [] }));

/** What the photo workspace gives its colour pickers (`ColorSamplerContext`): the canvas to sample from. */
export const photoColourSampler: ColorSampler = {
  claim: (target) => {
    useColourTargets.setState((s) => ({ targets: [...s.targets, target] }));
    return () => useColourTargets.setState((s) => ({ targets: s.targets.filter((t) => t !== target) }));
  },
  hint: "Click the photo to pick a colour from it",
};

/** The picker a press on the canvas samples into, if one is open. */
export const colourTarget = (): ColorTarget | null => useColourTargets.getState().targets.at(-1) ?? null;

/**
 * Photoshop's sampling ring around the pointer while it samples: the new colour on top, the one it replaces below,
 * in a grey ring so either reads against the photo.
 */
export function SamplingRing() {
  const ring = useSamplingRing((s) => s.ring);
  if (!ring) return null;
  return createPortal(
    <svg
      width={120}
      height={120}
      viewBox="0 0 120 120"
      className="pointer-events-none fixed z-[100]"
      style={{ left: ring.x - 60, top: ring.y - 60 }}
      data-sampling-ring
      data-now={ring.now}
      data-before={ring.before}
      aria-hidden
    >
      <circle cx={60} cy={60} r={50} fill="none" stroke="#7f7f7f" strokeWidth={22} />
      <path d="M 18 60 A 42 42 0 0 1 102 60" fill="none" stroke={ring.now} strokeWidth={18} />
      <path d="M 102 60 A 42 42 0 0 1 18 60" fill="none" stroke={ring.before} strokeWidth={18} />
    </svg>,
    document.body,
  );
}

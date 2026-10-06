/**
 * V8's gate: a simulated clip's frame is the same however it's reached. Drawn by the export's own
 * compositor in headless Chromium: every frame in order (as the export draws), straight to a frame (the
 * export's plan stepping what it skipped), and seeking about as the preview does (catching up from the
 * newest state or checkpoint). Skipped when there's no Chromium.
 */
import { afterAll, describe, expect, it } from "vitest";
import { addEffect } from "../shared/effects.ts";
import { normalizeProject } from "../shared/normalize.ts";
import { createDefaultProject, newLayerClip } from "../shared/timeline.ts";
import type { ParamValues, Project } from "../shared/types.ts";
import { GlSession } from "./gl-browser.ts";
import { type FrameLayer, planRender } from "./render.ts";

let session: GlSession | null = null;
try {
  session = await GlSession.open();
} catch {
  session = null;
}

const SIZE = { width: 96, height: 160 };
const opts = { ...SIZE, fps: 30 };

/** A solid with a moving generator on it, then `effects` (type and values) in order. */
function project(effects: [string, ParamValues][]): Project {
  const main = createDefaultProject();
  const clip = { ...newLayerClip("solid", 0, 4), trackId: main.tracks[0].id };
  let p: Project = normalizeProject({ ...main, clips: [clip] }, {});
  p = addEffect(p, [clip.id], "radio-waves").project;
  for (const [type, values] of effects) p = addEffect(p, [clip.id], type, values).project;
  return p;
}

/** The largest difference of any channel between two frames. */
function maxDiff(a: Uint8Array, b: Uint8Array): number {
  let most = 0;
  for (let i = 0; i < a.length; i++) most = Math.max(most, Math.abs(a[i] - b[i]));
  return most;
}

/** How much of a frame isn't black: so a test knows its simulation drew something. */
const lit = (a: Uint8Array) => a.filter((v, i) => i % 4 !== 3 && v > 24).length / ((a.length / 4) * 3);

describe.skipIf(!session)("simulations reach the same frame however it's reached", () => {
  afterAll(() => session?.close());

  /** Every frame 0..last planned in order, and the frame `last` planned on its own (a fresh plan). */
  const plans = (p: Project, last: number) => {
    const inOrder = planRender(p, {}, opts);
    const frames: FrameLayer[][] = [];
    for (let f = 0; f <= last; f++) frames.push(inOrder.frame(f));
    const alone = planRender(p, {}, opts).frame(last);
    return { shaders: inOrder.shaders, frames, alone };
  };

  it("Feedback (a trail that never quite forgets): straight to a frame, and seeking about, as drawn in order", async () => {
    const p = project([["feedback", { trailLength: 4, zoom: 1.5, rotation: 60, hueShift: 90, mode: "screen" }]]);
    const N = 75;
    const { shaders, frames, alone } = plans(p, N);
    const ordered = await session!.frames({ ...SIZE, shaders, frames, order: frames.map((_, f) => f) });
    expect(lit(ordered[N])).toBeGreaterThan(0.05);

    // The export starting there: its plan steps every frame before (the warm-ups), then draws it.
    const [straight] = await session!.frames({ ...SIZE, shaders, frames: [alone], order: [0] });
    expect(maxDiff(straight, ordered[N])).toBeLessThanOrEqual(2);

    // The preview seeking: later, back (from a checkpoint), forward again.
    const order = [N, 31, 64, 40];
    const seeks = await session!.frames({ ...SIZE, shaders, frames, order, catchUp: true });
    order.forEach((f, i) => expect(maxDiff(seeks[i], ordered[f]), `frame ${f}`).toBeLessThanOrEqual(2));
  });

  it("Feedback that forgets (a short trail): replays only as far back as it remembers", async () => {
    const p = project([["feedback", { trailLength: 0.2, zoom: 2, rotation: 90 }]]);
    const N = 90;
    const { shaders, frames, alone } = plans(p, N);
    // Its memory is under a second: the plan steps only that much before frame N.
    expect(alone.filter((l) => l.kind === "advance").length).toBeLessThan(30);
    const ordered = await session!.frames({ ...SIZE, shaders, frames, order: frames.map((_, f) => f) });
    const [straight] = await session!.frames({ ...SIZE, shaders, frames: [alone], order: [0] });
    expect(maxDiff(straight, ordered[N])).toBeLessThanOrEqual(2);
  });

  it("a 3D scene (its state stepped in TypeScript, its afterimage on the GPU) is the same straight to a frame", async () => {
    const p = project([["tesseract", { detail: 0.3 }]]);
    const N = 40;
    const { shaders, frames, alone } = plans(p, N);
    const ordered = await session!.frames({ ...SIZE, shaders, frames, order: frames.map((_, f) => f) });
    expect(lit(ordered[N])).toBeGreaterThan(0.02);
    const [straight] = await session!.frames({ ...SIZE, shaders, frames: [alone], order: [0] });
    expect(maxDiff(straight, ordered[N])).toBeLessThanOrEqual(2);
    const seeks = await session!.frames({ ...SIZE, shaders, frames, order: [N, 12], catchUp: true });
    expect(maxDiff(seeks[0], ordered[N])).toBeLessThanOrEqual(2);
    expect(maxDiff(seeks[1], ordered[12])).toBeLessThanOrEqual(2);
  }, 60_000);
});

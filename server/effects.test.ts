/**
 * Every video effect's shader, run for real in the headless browser the export
 * uses: it must compile and visibly change the picture, at the defaults and at
 * its card's values. Skipped when there's no Chromium.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { VIDEO_EFFECTS } from "../shared/effects.ts";
import { effectRows, timeEffectRows } from "./effect-rows.ts";
import { GlSession } from "./gl-browser.ts";

let session: GlSession | null = null;
try {
  session = await GlSession.open();
} catch {
  session = null;
}

describe.skipIf(!session)("video effect shaders", () => {
  beforeAll(() => {
    if (!session) throw new Error("no browser");
  });
  afterAll(() => session?.close());

  it("compile and change the picture", async () => {
    for (const cell of [{ width: 90, height: 160 }, { width: 160, height: 90 }]) {
      const { results } = await session!.effects({ rows: effectRows(VIDEO_EFFECTS), cell });
      for (const r of results) {
        expect(r.error, r.label).toBeUndefined();
        expect({ label: r.label, changed: r.max >= 16 }).toEqual({ label: r.label, changed: true });
      }
    }
  });

  it("compile and change a moving picture over earlier frames (time effects)", async () => {
    const { results } = await session!.layers({ rows: timeEffectRows(VIDEO_EFFECTS), cell: { width: 90, height: 160 } });
    expect(results.length).toBeGreaterThan(0);
    for (const r of results) {
      expect(r.error, r.label).toBeUndefined();
      expect({ label: r.label, changed: r.end >= 16 }).toEqual({ label: r.label, changed: true });
    }
  });
});

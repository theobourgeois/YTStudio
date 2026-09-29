/**
 * Every transition's shader, run for real in the headless browser the export
 * uses: it must compile and show exactly the outgoing picture at the start
 * and the incoming one at the end. Skipped when there's no Chromium.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { fragmentSource, transitionUniforms } from "../shared/transition-gl.ts";
import { TRANSITIONS, defaultTransitionParams } from "../shared/transitions.ts";
import { GlSession } from "./gl-browser.ts";

let session: GlSession | null = null;
try {
  session = await GlSession.open();
} catch {
  session = null;
}

describe.skipIf(!session)("transition shaders", () => {
  beforeAll(() => {
    if (!session) throw new Error("no browser");
  });
  afterAll(() => session?.close());

  it("compile, start on the outgoing picture and end on the incoming one", async () => {
    const passthrough = (side: "From" | "To") => ({
      key: `__${side}`,
      source: fragmentSource({ params: [], glsl: `vec4 transition(vec2 uv) { return get${side}Color(uv); }` }),
    });
    for (const cell of [{ width: 90, height: 160 }, { width: 160, height: 90 }]) {
      const results = await session!.check({
        rows: TRANSITIONS.map((d) => ({
          label: d.type,
          shader: { key: d.type, source: fragmentSource(d) },
          uniforms: transitionUniforms(d, defaultTransitionParams(d)),
        })),
        from: passthrough("From"),
        to: passthrough("To"),
        cell,
      });
      for (const r of results) {
        expect(r.error, r.label).toBeUndefined();
        expect({ label: r.label, start: r.start <= 2, end: r.end <= 2 }).toEqual({ label: r.label, start: true, end: true });
      }
    }
  });
});

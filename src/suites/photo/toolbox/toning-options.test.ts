import { describe, expect, it } from "vitest";
import { TONING_DEFAULTS, sanitizeToning, toningStroke } from "./toning-options";
import { sanitizeEraser } from "./eraser-options";

describe("toning options", () => {
  it("are Photoshop's by default, and clean up what's stored", () => {
    expect(sanitizeToning({})).toEqual(TONING_DEFAULTS);
    const o = sanitizeToning({ dodge: { range: "nonsense", exposure: 3, size: 0.2 }, sponge: { mode: "saturate", flow: 0 } });
    expect(o.dodge).toMatchObject({ range: "midtones", exposure: 1, size: 1 });
    expect(o.sponge).toMatchObject({ mode: "saturate", flow: 0.01 });
  });

  it("make a stroke: Dodge capped at its Exposure, Alt swapping it for Burn", () => {
    const options = sanitizeToning({ dodge: { exposure: 0.2, range: "shadows", size: 80, hardness: 0.5 } });
    const dodge = toningStroke(options, "dodge");
    expect(dodge).toMatchObject({ effect: { tool: "dodge", range: "shadows", protect: true }, cap: 0.2, airbrush: false });
    expect(dodge.brush).toMatchObject({ radius: 40, hardness: 0.5, strength: 1 });
    expect(toningStroke(options, "dodge", true).effect).toMatchObject({ tool: "burn", range: "shadows" });
    expect(toningStroke(options, "burn", true).effect.tool).toBe("dodge");
  });

  it("make Sponge's Flow a rate, and Airbrush a fraction of the Exposure a dab", () => {
    const sponge = toningStroke(TONING_DEFAULTS, "sponge");
    expect(sponge.cap).toBe(1);
    expect(sponge.brush.strength).toBeLessThan(0.2);
    const air = toningStroke(sanitizeToning({ burn: { airbrush: true } }), "burn");
    expect(air.brush.strength).toBeLessThan(1);
    expect(air.cap).toBe(0.5);
  });
});

describe("Background Eraser options", () => {
  it("are Photoshop's by default, and clean up what's stored", () => {
    expect(sanitizeEraser({})).toMatchObject({ sampling: "continuous", limits: "contiguous", tolerance: 50, protectForeground: false, hardness: 1 });
    expect(sanitizeEraser({ tolerance: 140, limits: "edges", sampling: "x" })).toMatchObject({ tolerance: 100, limits: "edges", sampling: "continuous" });
  });
});

import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { decodeCbor, encodeCbor } from "./cbor.ts";
import { metadataJson, readXfer, writeXfer } from "./container.ts";
import { memoryBlockDecode, memoryBlockEncode, presetAsState, readPluginState, stateSettings, writePluginState } from "./plugin-state.ts";

describe("Xfer's container", () => {
  it("writes the metadata as Serum does: compact, sorted, whole numbers with .0", () => {
    expect(metadataJson({ version: 4, fileType: "SerumPreset", tags: ["Poly", "Lead"], presetName: "A/B \"x\"" })).toBe(
      '{"fileType":"SerumPreset","presetName":"A/B \\"x\\"","tags":["Poly","Lead"],"version":4.0}',
    );
  });

  it("lays out magic, length, JSON, sizes and zstd, with the zstd's MD5 as the hash", () => {
    const settings = encodeCbor({ Global0: { plainParams: { kParamMasterVolume: 0.25 } } });
    const bytes = writeXfer({ fileType: "SerumPreset", version: 11 }, settings);
    const buf = Buffer.from(bytes);
    expect(buf.subarray(0, 9).toString("latin1")).toBe("XferJson\0");
    const length = Number(buf.readBigUInt64LE(9));
    const meta = JSON.parse(buf.subarray(17, 17 + length).toString("utf8"));
    expect(buf.readUInt32LE(17 + length)).toBe(settings.length);
    expect(buf.readUInt32LE(21 + length)).toBe(2);
    const zstd = buf.subarray(25 + length);
    expect(zstd.subarray(0, 4).toString("hex")).toBe("28b52ffd");
    expect(meta.hash).toBe(createHash("md5").update(zstd).digest("hex"));
    const back = readXfer(bytes);
    expect(Buffer.from(back.settings).equals(Buffer.from(settings))).toBe(true);
    expect(back.meta.version).toBe(11);
  });
});

describe("Serum's plugin state", () => {
  it("encodes JUCE MemoryBlocks both ways", () => {
    for (const bytes of [new Uint8Array([]), new Uint8Array([0]), new Uint8Array([1, 2, 3, 250, 251]), new Uint8Array(1000).map((_, i) => (i * 37) & 255)]) {
      expect(memoryBlockDecode(memoryBlockEncode(bytes))).toEqual(bytes);
    }
    expect(memoryBlockEncode(new Uint8Array([1, 2, 3]))).toBe("3.AHv.");
  });

  it("loads a preset's settings as the processor's, with the processor's own fields", () => {
    const processor = writeXfer(
      { component: "processor", version: 11 },
      encodeCbor({ component: "processor", modMatrixLocked: false, scalarCurvesLocked: [false, false], Global0: { plainParams: {} } }),
    );
    const controller = writeXfer({ component: "controller", presetName: " - Init - " }, encodeCbor({ Macro0: { name: "" } }));
    const xml = `<?xml version="1.0" encoding="UTF-8"?> <VST3PluginState><IComponent>${memoryBlockEncode(processor)}</IComponent><IEditController>${memoryBlockEncode(controller)}</IEditController></VST3PluginState>`;
    const template = writePluginState({ xml, component: processor, controller }, processor);
    const preset = encodeCbor({ Global0: { plainParams: { kParamMasterVolume: 0.5 } }, presetName: "Test" });
    const state = presetAsState(template, preset);
    const settings = decodeCbor(stateSettings(state)) as Record<string, unknown>;
    expect(settings.component).toBe("processor");
    expect(settings.scalarCurvesLocked).toEqual([false, false]);
    expect(settings.Global0).toEqual({ plainParams: { kParamMasterVolume: 0.5 } });
    expect(readXfer(readPluginState(state).component).meta.component).toBe("processor");
    expect(readPluginState(state).controller).toEqual(controller);
  });
});

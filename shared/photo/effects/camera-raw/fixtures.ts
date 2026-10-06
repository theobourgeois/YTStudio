/**
 * Camera Raw's CR0 fixtures (`shared/photo/reference/camera-raw-fixtures.json`) read for the tests: each run's
 * settings in our parameters, and where its ramp and patches were on the chart (scripts/photoshop-probes/camera_raw.py).
 */
import fixtures from "../../reference/camera-raw-fixtures.json" with { type: "json" };
import type { CurvePoints, EffectParamValue } from "../../types.ts";
import { defaultParams, identityCurveSet } from "../params.ts";
import { CAMERA_RAW_PARAMS, MIXER_COLOURS } from "./params.ts";

export interface FixtureRun {
  name: string;
  params: Record<string, EffectParamValue>;
  /** Grey ramp: [input code, x, y] → measured [r, g, b]. */
  ramp: { input: number; x: number; y: number; out: number[] }[];
  /** Patches: input [r, g, b] at (x, y) → measured. */
  patches: { input: number[]; x: number; y: number; out: number[] }[];
}

/** The chart's size and layout (camera_raw.py's `chart`). */
export const CHART = { width: 512, height: 32 + 8 + 16 * 16 + 8 };
const CHART_ROWS = [5, 7, 13, 15]; // FIXTURE_SV's rows of CHART_SV
const HUES = 24;

const NAMES: Record<string, string> = {
  Exposure2012: "exposure",
  Contrast2012: "contrast",
  Whites2012: "whites",
  Blacks2012: "blacks",
  Temperature: "temperature",
  Tint: "tint",
  Vibrance: "vibrance",
  Saturation: "saturation",
  ParametricShadows: "curveShadows",
  ParametricDarks: "curveDarks",
  ParametricLights: "curveLights",
  ParametricHighlights: "curveHighlights",
  ParametricShadowSplit: "curveShadowSplit",
  ParametricMidtoneSplit: "curveMidtoneSplit",
  ParametricHighlightSplit: "curveHighlightSplit",
  PostCropVignetteAmount: "vignette",
  ColorGradeBlending: "gradingBlending",
  SplitToningBalance: "gradingBalance",
  SplitToningShadowHue: "shadowsHue",
  SplitToningShadowSaturation: "shadowsSaturation",
  SplitToningHighlightHue: "highlightsHue",
  SplitToningHighlightSaturation: "highlightsSaturation",
  ColorGradeShadowLum: "shadowsLuminance",
  ColorGradeMidtoneHue: "midtonesHue",
  ColorGradeMidtoneSat: "midtonesSaturation",
  ColorGradeMidtoneLum: "midtonesLuminance",
  ColorGradeHighlightLum: "highlightsLuminance",
  ColorGradeGlobalHue: "globalHue",
  ColorGradeGlobalSat: "globalSaturation",
  ColorGradeGlobalLum: "globalLuminance",
  ...Object.fromEntries(
    MIXER_COLOURS.flatMap((c) => [
      [`HueAdjustment${c}`, `hue${c}`],
      [`SaturationAdjustment${c}`, `saturation${c}`],
      [`LuminanceAdjustment${c}`, `luminance${c}`],
    ]),
  ),
};

/** Our parameters for a run's Camera Raw settings, or null when it uses something we don't have yet. */
export function paramsOf(settings: Record<string, unknown>): Record<string, EffectParamValue> | null {
  const params = defaultParams(CAMERA_RAW_PARAMS);
  // A run's grading without Blending is at the legacy Split Toning's (100): what the probe's XMP leaves out.
  if (Object.keys(settings).some((k) => k.startsWith("SplitToning") || k.startsWith("ColorGrade"))) params.gradingBlending = 100;
  for (const [k, v] of Object.entries(settings)) {
    if (NAMES[k]) params[NAMES[k]] = v as number;
    else if (k === "ConvertToGrayscale") params.treatment = v ? "bw" : "color";
    else if (k === "ToneCurvePV2012") params.pointCurve = { ...identityCurveSet(), rgb: v as CurvePoints };
    else return null;
  }
  return params;
}

export function fixtureRuns(): FixtureRun[] {
  const f = fixtures as unknown as {
    rampLevels: number[];
    patchInputs: number[][];
    settings: Record<string, Record<string, unknown>>;
    runs: Record<string, { ramp: number[][]; patches: number[][] }>;
  };
  const out: FixtureRun[] = [];
  for (const [name, run] of Object.entries(f.runs)) {
    const params = paramsOf(f.settings[name]);
    if (!params) continue;
    out.push({
      name,
      params,
      ramp: f.rampLevels.map((input, i) => ({ input, x: 2 * input + 1, y: 16, out: run.ramp[i] })),
      patches: f.patchInputs.map((input, i) => ({
        input,
        x: 8 + (i % HUES) * 20 + 8,
        y: 40 + CHART_ROWS[Math.floor(i / HUES)] * 16 + 8,
        out: run.patches[i],
      })),
    });
  }
  return out;
}

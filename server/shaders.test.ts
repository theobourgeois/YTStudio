/**
 * The Shader effect's dialects (V6), run for real in the headless browser the export uses: known ISF and
 * Shadertoy shaders (written as those communities write them: their own hash and noise, texelFetch on the
 * sound, IMG_PIXEL, texture2D, long and point2D inputs...) and ours must compile and change the picture,
 * and a compiler's errors must land on the user's own lines. Skipped when there's no Chromium.
 */
import { afterAll, describe, expect, it } from "vitest";
import { effectPass, effectShader } from "../shared/effect-gl.ts";
import { shaderDefinition } from "../shared/effects.ts";
import { defaultParams } from "../shared/params.ts";
import { SHADER_EXAMPLES, compileProblems } from "../shared/shader-code.ts";
import type { ShaderCode } from "../shared/types.ts";
import { GlSession } from "./gl-browser.ts";

let session: GlSession | null = null;
try {
  session = await GlSession.open();
} catch {
  session = null;
}

/** Shaders as they're found in the wild, one per feature the dialects adapt. */
const KNOWN: { label: string; shader: ShaderCode }[] = [
  {
    label: "Shadertoy: own hash and noise, #define, texelFetch and textureSize on the sound",
    shader: {
      dialect: "shadertoy",
      code: `#define BARS 32.0
float hash(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
float noise(in vec2 p) {
    vec2 i = floor(p), f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    return mix(mix(hash(i), hash(i + vec2(1, 0)), f.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), f.x), f.y);
}
void mainImage(out vec4 fragColor, in vec2 fragCoord) {
    vec2 uv = fragCoord / iResolution.xy;
    int bin = int(floor(uv.x * BARS) / BARS * 512.0);
    float fft = texelFetch(iChannel0, ivec2(bin, 0), 0).x;
    ivec2 size = textureSize(iChannel0, 0);
    float n = noise(fragCoord * 0.05 + iTime);
    vec3 col = mix(vec3(0.05), vec3(1.0, 0.4, 0.1), step(uv.y, fft + 0.1)) + n * 0.1;
    col *= float(size.x) / 512.0 * iChannelResolution[0].x / 512.0;
    fragColor = vec4(col, 1.0);
}
`,
    },
  },
  {
    label: "Shadertoy: a filter on the clip's picture (iChannel0 input), textureLod and iFrame",
    shader: {
      dialect: "shadertoy",
      code: `// @iChannel0 input
void mainImage(out vec4 fragColor, in vec2 fragCoord) {
    vec2 uv = fragCoord / iResolution.xy;
    vec2 d = (uv - 0.5) * 0.04;
    float r = texture(iChannel0, uv + d).r;
    float g = textureLod(iChannel0, uv, 0.0).g;
    float b = texture(iChannel0, uv - d).b;
    fragColor = vec4(1.0 - vec3(r, g, b) + float(iFrame % 2) * 0.0, 1.0);
}
`,
    },
  },
  {
    label: "ISF: IMG_PIXEL, IMG_SIZE, RENDERSIZE, gl_FragCoord, long, point2D and event inputs",
    shader: {
      dialect: "isf",
      code: `/*{
    "CREDIT": "after the ISF test shaders",
    "ISFVSN": "2",
    "CATEGORIES": ["Stylize"],
    "INPUTS": [
        { "NAME": "inputImage", "TYPE": "image" },
        { "NAME": "cellSize", "TYPE": "float", "MIN": 2.0, "MAX": 64.0, "DEFAULT": 12.0 },
        { "NAME": "shape", "TYPE": "long", "VALUES": [0, 1], "LABELS": ["Square", "Circle"], "DEFAULT": 1 },
        { "NAME": "center", "TYPE": "point2D", "DEFAULT": [0.5, 0.5] },
        { "NAME": "flash", "TYPE": "event" }
    ]
}*/

void main() {
    vec2 px = gl_FragCoord.xy;
    vec2 cell = floor(px / cellSize) * cellSize + cellSize * 0.5;
    vec4 c = IMG_PIXEL(inputImage, cell);
    vec2 local = (px - cell) / cellSize;
    float inside = shape == 1 ? step(length(local), 0.5) : 1.0;
    vec2 size = IMG_SIZE(inputImage);
    float vignette = 1.0 - length(vv_FragNormCoord - center) * (size.x / RENDERSIZE.x);
    gl_FragColor = vec4(c.rgb * inside * vignette + (flash ? 0.5 : 0.0), 1.0);
}
`,
    },
  },
  {
    label: "ISF: GLSL ES 1.0 style (texture2D, precision), an audio input, a colour",
    shader: {
      dialect: "isf",
      code: `/*{
    "DESCRIPTION": "Draws the waveform",
    "ISFVSN": "2",
    "INPUTS": [
        { "NAME": "waveImage", "TYPE": "audio", "MAX": 256 },
        { "NAME": "thickness", "TYPE": "float", "DEFAULT": 0.04, "MIN": 0.0, "MAX": 0.2 },
        { "NAME": "lineColor", "TYPE": "color", "DEFAULT": [0.2, 1.0, 0.6, 1.0] }
    ]
}*/
precision mediump float;

void main() {
    vec2 uv = isf_FragNormCoord;
    float w = texture2D(waveImage, vec2(uv.x, 0.25)).r;
    float d = abs(uv.y - w);
    gl_FragColor = d < thickness ? lineColor : vec4(0.0, 0.0, 0.0, 1.0);
}
`,
    },
  },
  ...SHADER_EXAMPLES.map((ex) => ({ label: `Example: ${ex.label}`, shader: ex.shader })),
];

describe.skipIf(!session)("shader dialects", () => {
  afterAll(() => session?.close());

  it("compile and change the picture, for known ISF and Shadertoy shaders and ours", async () => {
    const rows = KNOWN.map(({ label, shader }) => {
      const def = shaderDefinition(shader);
      expect(def.shader!.parsed!.problems, label).toEqual([]);
      const values = defaultParams(def.params);
      return { label, passes: [0.5, 1.25].map((t) => effectPass(def, values, t)!) };
    });
    const { results } = await session!.effects({ rows, cell: { width: 120, height: 160 } });
    for (const r of results) {
      expect(r.error, r.label).toBeUndefined();
      expect({ label: r.label, changed: r.max >= 16 }).toEqual({ label: r.label, changed: true });
    }
  });

  it("report errors on the user's own lines", async () => {
    const broken: [ShaderCode, number][] = [
      [{ dialect: "native", code: "// @param amount number 0 1 0.5\n\nvec4 effect(vec2 uv) {\n  return getColor(uv) * amout;\n}" }, 4],
      [{ dialect: "shadertoy", code: "void mainImage(out vec4 c, in vec2 p) {\n  c = vec4(p / iResolution.xy, 0.0, 1.0)\n}" }, 3],
      [{ dialect: "isf", code: '/*{ "INPUTS": [] }*/\nvoid main() {\n  gl_FragColor = vec3(1.0);\n}' }, 3],
    ];
    const sources = Object.fromEntries(broken.map(([code], i) => [String(i), effectShader(shaderDefinition(code))!.source]));
    const failed = await session!.compile(sources);
    broken.forEach(([code, line], i) => {
      const problems = compileProblems(failed[String(i)] ?? "");
      expect(problems.length, code.dialect).toBeGreaterThan(0);
      expect(problems[0].line, `${code.dialect}: ${failed[String(i)]}`).toBe(line);
    });
    // And the examples don't fail.
    const fine = Object.fromEntries(SHADER_EXAMPLES.map((ex) => [ex.id, effectShader(shaderDefinition(ex.shader))!.source]));
    expect(await session!.compile(fine)).toEqual({});
  });
});

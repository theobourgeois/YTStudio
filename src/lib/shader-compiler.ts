/**
 * Compiling the user's shaders (the Shader effect, `shared/shader-code.ts`) before anything draws them: on a
 * hidden WebGL 2 context of its own, synchronously (`gl.compileShader` with its status asked at once), its
 * log read back onto the user's lines. Shaders that don't compile are left out of the preview
 * (`provideShaderCheck`), so the clip shows without them; Properties and the shader editor show why.
 *
 * It also remembers which of them were drawn last, so a shader that hangs the GPU (the browser then loses
 * every WebGL context) can be named and turned off (`suspectShader`).
 */
import type { Shader } from "@shared/compositor";
import type { EffectDefinition } from "@shared/effects";
import { effectShader, provideShaderCheck } from "@shared/effect-gl";
import { type ShaderProblem, compileProblems } from "@shared/shader-code";

/** Results kept (each edit of a shader's code is another). */
const KEPT = 200;

const results = new Map<string, ShaderProblem[]>();
let gl: WebGL2RenderingContext | null | undefined;

function context(): WebGL2RenderingContext | null {
  if (gl && !gl.isContextLost()) return gl;
  // Lost (or never made): another one, unless the browser has none.
  if (gl === null || typeof document === "undefined") return null;
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = 1;
  gl = canvas.getContext("webgl2", { failIfMajorPerformanceCaveat: false });
  return gl && !gl.isContextLost() ? gl : null;
}

/**
 * What's wrong with a shader when compiled (empty when it compiles), or null when it can't be checked
 * (no WebGL here).
 */
export function compileShader(shader: Shader): ShaderProblem[] | null {
  const known = results.get(shader.key);
  if (known) {
    // The most recently asked stay.
    results.delete(shader.key);
    results.set(shader.key, known);
    return known;
  }
  const g = context();
  if (!g) return null;
  const s = g.createShader(g.FRAGMENT_SHADER);
  if (!s) return null;
  g.shaderSource(s, shader.source);
  g.compileShader(s);
  const ok = g.getShaderParameter(s, g.COMPILE_STATUS) === true;
  const log = ok ? "" : (g.getShaderInfoLog(s) ?? "");
  g.deleteShader(s);
  // A context lost meanwhile says nothing true: ask again later.
  if (g.isContextLost()) return null;
  const problems = ok ? [] : compileProblems(log);
  if (!ok && !problems.length) problems.push({ line: null, message: "It doesn't compile." });
  results.set(shader.key, problems);
  for (const old of results.keys()) {
    if (results.size <= KEPT) break;
    results.delete(old);
  }
  return problems;
}

/**
 * Everything wrong with a Shader effect's definition: its declarations' problems (`@param` lines, an ISF
 * header), then the compiler's. Empty when it draws.
 */
export function shaderProblems(def: EffectDefinition): ShaderProblem[] {
  const parsed = def.shader?.parsed;
  const shader = effectShader(def);
  if (!parsed || !shader) return [];
  return [...parsed.problems, ...(compileShader(shader) ?? [])];
}

/** When each of the user's shaders was first drawn and last drawn (ms), for naming one that hangs the GPU. */
const drawn = new Map<string, { first: number; last: number }>();

provideShaderCheck((shader) => {
  const problems = compileShader(shader);
  if (problems?.length) return false;
  const now = performance.now();
  const seen = drawn.get(shader.key);
  if (seen) seen.last = now;
  else drawn.set(shader.key, { first: now, last: now });
  if (drawn.size > KEPT) drawn.delete(drawn.keys().next().value!);
  return true;
});

/**
 * The shader most likely to have just lost the GPU: of those `among` (the ones on now) drawn lately (the browser's watchdog takes some
 * seconds to give up on a draw), the one first drawn most recently (a new shader that never ends). Null when
 * none was being drawn.
 */
export function suspectShader(among: ReadonlySet<string>, within = 20_000): string | null {
  const now = performance.now();
  let suspect: string | null = null;
  let newest = -Infinity;
  for (const [key, { first, last }] of drawn) {
    if (!among.has(key) || now - last > within || first < newest) continue;
    newest = first;
    suspect = key;
  }
  return suspect;
}

/** Forget a shader's drawing (it was turned off), so it isn't suspected again. */
export function forgetDrawn(key: string): void {
  drawn.delete(key);
}

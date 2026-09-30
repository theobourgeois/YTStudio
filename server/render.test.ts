import { describe, expect, it } from "vitest";
import { addEffect, defaultEffects, setEffectEnabled, setParams, textEffects } from "../shared/effects.ts";
import { createDefaultProject, newLayerClip, setClipSpeed } from "../shared/timeline.ts";
import { addPresetLayer } from "../shared/presets.ts";
import { placeClip, placementAffine } from "../shared/transform.ts";
import type { Clip, Keyframe, ParamValues, Project } from "../shared/types.ts";
import { createTransition } from "../shared/transitions.ts";
import { normalizeProject } from "../shared/normalize.ts";
import { keyframeValue } from "../shared/keyframes.ts";
import {
  type FrameLayer,
  type RenderAsset,
  SAMPLE_RATE,
  audioArgs,
  encoderArgs,
  tempoFilters,
  lumaWeights,
  planRender,
  sourceFrameBytes,
} from "./render.ts";

const assets: Record<string, RenderAsset> = {
  vid: { path: "/media/vid.mp4", kind: "video", hasVideo: true, hasAudio: true, width: 1920, height: 1080, duration: 10 },
  mute: { path: "/media/silent clip.mov", kind: "video", hasVideo: true, hasAudio: false, width: 1080, height: 1920, duration: 10 },
  song: { path: "/media/song.mp3", kind: "audio", hasVideo: false, hasAudio: true, width: null, height: null, duration: 60 },
  photo: { path: "/media/photo.png", kind: "image", hasVideo: true, hasAudio: false, width: 1000, height: 1000, duration: 5 },
  big: { path: "/media/big.jpg", kind: "image", hasVideo: true, hasAudio: false, width: 4000, height: 3000, duration: 5 },
  back: {
    path: "/media/back.mp4", reversedPath: "/media/back-reversed.mp4",
    kind: "video", hasVideo: true, hasAudio: true, width: 1920, height: 1080, duration: 10,
  },
};
const library = assets;

let n = 0;
/** A clip, optionally with effect parameters, e.g. `{ motion: { rotation: 90 } }`. */
const clip = (
  assetId: string,
  trackId: string,
  start: number,
  inPoint: number,
  out: number,
  params: Record<string, ParamValues> = {},
): Clip => ({
  id: `c${n++}`, assetId, trackId, start, in: inPoint, out,
  effects: defaultEffects().map((e) => (params[e.type] ? { ...e, params: { ...e.params, ...params[e.type] } } : e)),
});

function project(clips: Clip[], patch: (p: Project) => Project = (p) => p): Project {
  return normalizeProject(patch({ ...createDefaultProject(), clips }), library);
}
const withTop = (d: Project): Project => ({ ...d, tracks: [{ id: "top", kind: "video", name: "Video 2", muted: false }, ...d.tracks] });

const opts = { width: 1080, height: 1920, fps: 30 };
const canvas = { width: 1080, height: 1920 };
const vf = (argv: string[]) => argv[argv.indexOf("-vf") + 1];
const arg = (argv: string[], flag: string) => argv[argv.indexOf(flag) + 1];
const inputsOf = (argv: string[]) => argv.filter((_, i) => argv[i - 1] === "-i");
const pictures = (layers: FrameLayer[]) => layers.flatMap((l) => (l.kind === "picture" ? [l.picture] : []));

describe("planRender", () => {
  it("runs each shown clip's video effects, in order, and sends their shaders", () => {
    const c = clip("vid", "main", 0, 0, 2);
    let p = project([c]);
    p = addEffect(p, [c.id], "gaussian-blur").project;
    p = addEffect(p, [c.id], "film-grain").project;
    p = addEffect(p, [c.id], "sepia").project;
    p = setEffectEnabled(p, c.id, "sepia", false);
    const plan = planRender(p, assets, opts);
    expect(Object.keys(plan.shaders).sort()).toEqual(["fx:film-grain", "fx:gaussian-blur"]);
    const [picture] = pictures(plan.frame(30));
    expect(picture.effects?.map((e) => [e.shader, e.passes])).toEqual([["fx:gaussian-blur", 2], ["fx:film-grain", 1]]);
    // Moving effects know the moment (the clip's source time).
    expect(picture.effects?.[1].uniforms).toContainEqual({ name: "time", type: "float", value: expect.closeTo(1, 3) });
    expect(pictures(planRender(project([clip("vid", "main", 0, 0, 2)]), assets, opts).frame(0))[0].effects).toBeUndefined();
  });

  it("decodes each visible clip once, for exactly the frames it's drawn in", () => {
    // Durations that aren't whole frames: 1.01 + 0.77 + 2.345 = 4.125s.
    const p = project([
      clip("vid", "main", 0, 0, 1.01),
      clip("vid", "main", 1.01, 2, 2.77),
      clip("vid", "main", 1.78, 4, 6.345),
    ]);
    const plan = planRender(p, assets, { ...opts, ffmpegPath: "/bin/ffmpeg" });
    expect(plan.frames).toBe(Math.ceil(4.125 * 30));
    expect(plan.sources.map((s) => [s.first, s.end])).toEqual([[0, 31], [31, 54], [54, 124]]);
    const [first, second] = plan.sources;
    expect(first.argv[0]).toBe("/bin/ffmpeg");
    expect(inputsOf(first.argv)).toEqual(["/media/vid.mp4"]);
    expect([arg(first.argv, "-ss"), arg(first.argv, "-t")]).toEqual(["0.000000", `${(31 / 30 + 0.25).toFixed(6)}`]);
    // Clip 2 starts at 1.01s, on frame 31 (1.033s): its first frame shows its in-point.
    expect(arg(second.argv, "-ss")).toBe("2.000000");
    expect(vf(second.argv)).toMatch(/,tpad=stop_mode=clone:stop=23,trim=end_frame=23$/);
    // Every frame shows the one clip under it.
    expect([0, 30, 31, 53, 54, 123].map((f) => pictures(plan.frame(f)).map((pic) => pic.key))).toEqual([
      ["s0"], ["s0"], ["s1"], ["s1"], ["s2"], ["s2"],
    ]);
  });

  it("decodes a clip at its speed, and a reversed one forwards from its media's reversed copy", () => {
    const fast = clip("vid", "main", 0, 2, 6);
    const back = clip("back", "main", 2, 2, 6);
    const p = setClipSpeed(setClipSpeed(project([fast, back]), [fast.id], { speed: 2 }), [back.id], { reversed: true });
    const plan = planRender(p, assets, opts);
    expect(plan.sources.map((s) => [s.first, s.end])).toEqual([[0, 60], [60, 180]]);
    const [f, b] = plan.sources;
    // 60 frames at twice the speed: 4s of media from the in-point.
    expect([inputsOf(f.argv)[0], arg(f.argv, "-ss"), arg(f.argv, "-t")]).toEqual(["/media/vid.mp4", "2.000000", "4.250000"]);
    expect(vf(f.argv)).toMatch(/^setpts=\(PTS-STARTPTS\)\/2,fps=30,/);
    // Backwards from source 6s: 4s into the 10s reversed copy.
    expect([inputsOf(b.argv)[0], arg(b.argv, "-ss")]).toEqual(["/media/back-reversed.mp4", "4.000000"]);
    expect(vf(b.argv)).toMatch(/^setpts=PTS-STARTPTS,fps=30,/);
    // Without the reversed copy there's nothing to decode.
    expect(() => planRender(p, { ...assets, back: { ...assets.back, reversedPath: undefined } }, opts)).toThrow(/reversed copy/);
  });

  it("decodes video as YUV at the size it's shown, in its own colour matrix", () => {
    const p = project([clip("vid", "main", 0, 0, 1), clip("mute", "main", 1, 0, 1)]);
    const plan = planRender(p, { ...assets, vid: { ...assets.vid, colorSpace: "smpte170m" } }, opts);
    const [landscape, portrait] = plan.sources;
    // 1920x1080 fitted into 1080x1920: 1080x608.
    expect(landscape).toMatchObject({ still: false, width: 1080, height: 608, luma: [0.299, 0.114] });
    expect(vf(landscape.argv)).toBe(
      "setpts=PTS-STARTPTS,fps=30,scale=1080:608:out_range=tv,format=yuv420p,tpad=stop_mode=clone:stop=30,trim=end_frame=30",
    );
    expect(landscape.argv.slice(-4)).toEqual(["rawvideo", "-pix_fmt", "yuv420p", "pipe:1"]);
    expect(sourceFrameBytes(landscape)).toBe(1080 * 608 * 1.5);
    // Untagged HD is BT.709.
    expect(portrait).toMatchObject({ width: 1080, height: 1920, luma: [0.2126, 0.0722] });
  });

  it("never decodes a picture bigger than its media, and never an odd-sized video", () => {
    const p = project([
      clip("vid", "main", 0, 0, 1, { motion: { scale: 10 } }),
      clip("vid", "main", 1, 0, 1, { motion: { scale: 0.2501 } }),
      clip("big", "main", 2, 0, 1),
    ]);
    const [zoomed, small, photo] = planRender(p, assets, opts).sources;
    expect(zoomed).toMatchObject({ width: 1920, height: 1080 });
    // 1080x607.5 at 25.01%: 270.1x151.9, rounded up (to even).
    expect(small).toMatchObject({ width: 272, height: 152 });
    // A 4000x3000 photo fitted to 1080 wide is decoded at 1080x810, once, as RGBA.
    expect(photo).toMatchObject({ still: true, width: 1080, height: 810, luma: null });
    expect(photo.argv).toEqual([
      "ffmpeg", "-hide_banner", "-nostdin", "-loglevel", "error", "-i", "/media/big.jpg", "-frames:v", "1",
      "-vf", "scale=1080:810,format=rgba", "-an", "-sn", "-f", "rawvideo", "-pix_fmt", "rgba", "pipe:1",
    ]);
  });

  it("places, turns and fades each clip like the preview, bottom track first", () => {
    const p = project(
      [
        clip("vid", "main", 0, 0, 2, { motion: { rotation: 90 }, opacity: { opacity: 0.5 } }),
        clip("photo", "top", 1, 0, 1, { motion: { position: [0.25, 0.5], scale: 0.5 } }),
      ],
      withTop,
    );
    const plan = planRender(p, assets, opts);
    expect(pictures(plan.frame(0)).map((pic) => pic.key)).toEqual(["s0"]);
    const [bottom, top] = pictures(plan.frame(45));
    expect(bottom).toEqual({
      key: "s0",
      opacity: 0.5,
      affine: placementAffine(
        placeClip(canvas, { width: 1920, height: 1080 }, { fit: "contain", position: [0.5, 0.5], scaleX: 1, scaleY: 1, rotation: 90, anchor: [0.5, 0.5] }),
        canvas,
      ),
    });
    expect(top.key).toBe("s1");
    expect(top.opacity).toBe(1);
    // Half of 1080x1080, centred at x = 270.
    const [a, , , d, e, f] = top.affine;
    expect([a * 1080, d * 1920, e * 1080, f * 1920].map((v) => Math.round(v))).toEqual([540, 540, 0, 690]);
  });

  it("leaves out what can't be seen: off the canvas, transparent or scaled to nothing", () => {
    const p = project([
      clip("vid", "main", 0, 0, 1, { motion: { position: [3, 0.5] } }),
      clip("vid", "main", 1, 0, 1, { opacity: { opacity: 0 } }),
      clip("vid", "main", 2, 0, 1, { motion: { scale: 0 } }),
    ]);
    const plan = planRender(p, assets, opts);
    expect(plan.sources).toEqual([]);
    expect(plan.frame(15)).toEqual([]);
  });

  it("draws a transition from both clips, running into their handles", () => {
    // "a" plays source 2..4 of a 10 s file; "b" starts at the beginning of its file.
    const p = project([
      { ...clip("vid", "main", 0, 2, 4), transitionOut: createTransition("cross-dissolve", 1) },
      clip("vid", "main", 2, 0, 2),
    ]);
    const plan = planRender(p, assets, opts);
    expect(Object.keys(plan.shaders)).toEqual(["cross-dissolve"]);
    const [a, b] = plan.sources;
    // The transition covers 1.5..2.5s: frames 45..74. "a" shows past its out-point until then...
    expect([a.first, a.end, b.first, b.end]).toEqual([0, 75, 45, 120]);
    // ...and "b" holds its first frame (the media has nothing before 0) for the first 15.
    expect(arg(b.argv, "-ss")).toBe("0.000000");
    expect(vf(b.argv)).toContain("tpad=start_mode=clone:start=15:stop_mode=clone:stop=75,trim=end_frame=75");
    const [layer] = plan.frame(60);
    expect(layer).toMatchObject({ kind: "transition", shader: "cross-dissolve", from: { key: "s0" }, to: { key: "s1" } });
    expect(layer.kind === "transition" && layer.progress).toBeCloseTo(0.5, 2);
    expect(plan.frame(44)[0].kind).toBe("picture");
    expect(plan.frame(75)[0].kind).toBe("picture");
  });

  it("rejects an empty timeline and missing media", () => {
    expect(() => planRender(project([]), assets, opts)).toThrow(/empty/);
    expect(() => planRender(project([clip("vid", "main", 0, 0, 1)]), {}, opts)).toThrow(/Missing media/);
  });
});

describe("text clips", () => {
  const text: Clip = {
    id: "t1", assetId: "", trackId: "main", start: 1, in: 0, out: 2,
    effects: textEffects({ text: "Hi" }),
  };
  const drawing = (from?: number, width = 400): RenderAsset => ({
    path: "", png: Buffer.from(`png ${from}`), kind: "image", hasVideo: true, hasAudio: false,
    width: width * 2, height: 200, duration: 0, frame: { width, height: 100 }, ...(from === undefined ? {} : { from }),
  });

  it("are drawn from their image as it is (decoded by the page), placed at their own frame size", () => {
    const plan = planRender(project([clip("vid", "main", 3, 0, 2), text]), assets, opts, { t1: [drawing()] });
    const source = plan.sources.find((s) => s.clipId === "t1")!;
    expect(source).toMatchObject({ still: true, width: 800, height: 200, first: 30, end: 90, argv: [] });
    expect(source.png!.toString()).toBe("png undefined");
    // The 800px drawing lands 400px wide (its frame at 100%), centred on the canvas.
    const [pic] = pictures(plan.frame(45));
    expect(pic.affine.map((v, i) => Math.round(v * (i % 2 ? 1920 : 1080)) || 0)).toEqual([400, 0, 0, 100, 340, 910]);
  });

  it("switch drawings where an animated look changes, each placed at its own size", () => {
    const plan = planRender(project([text]), assets, opts, { t1: [drawing(), drawing(0.5, 500)] });
    expect(plan.sources.map((s) => [s.first, s.end, s.png!.toString()])).toEqual([[30, 45, "png undefined"], [45, 90, "png 0.5"]]);
    expect(pictures(plan.frame(44))[0].key).toBe("s0");
    const [pic] = pictures(plan.frame(45));
    expect(pic.key).toBe("s1");
    expect(Math.round(pic.affine[0] * 1080)).toBe(500);
  });

  it("need their drawing", () => {
    expect(() => planRender(project([text]), assets, opts)).toThrow(/text/i);
  });

  it("can be a side of a transition", () => {
    const plan = planRender(project([{ ...text, transitionIn: createTransition("cross-dissolve", 0.5) }]), assets, opts, { t1: [drawing()] });
    expect(plan.frame(0)).toEqual([]);
    const [layer] = plan.frame(31);
    expect(layer).toMatchObject({ kind: "transition", from: null, to: { key: "s0" } });
  });
});

describe("animation", () => {
  it("places every frame with its Motion and Opacity then", () => {
    const moving = clip("photo", "main", 0, 0, 2);
    moving.effects = moving.effects.map((e) =>
      e.type === "motion"
        ? { ...e, keyframes: { position: [{ time: 0, value: [0.25, 0.5], easing: "linear" }, { time: 1, value: [0.75, 0.5], easing: "linear" }] } }
        : e.type === "opacity"
          ? { ...e, keyframes: { opacity: [{ time: 0, value: 0, easing: "linear" }, { time: 1, value: 1, easing: "hold" }] } }
          : e,
    );
    const plan = planRender(project([moving]), assets, opts);
    const at = (f: number) => pictures(plan.frame(f))[0];
    expect(at(0).opacity).toBeLessThan(0.01);
    const centreX = (f: number) => {
      const [a, , c, , e] = at(f).affine;
      return (e + (a + c) / 2) * 1080;
    };
    expect(centreX(15)).toBeCloseTo(540, 0);
    expect(at(15).opacity).toBeCloseTo(0.5, 2);
    expect(centreX(30)).toBeCloseTo(810, 0);
    expect(at(45).opacity).toBe(1);
  });
});

describe("solids and adjustment layers", () => {
  it("draw a solid from its colour, and adjust what's below, without decoding anything", () => {
    const solid = { ...newLayerClip("solid", 0, 1, { color: "#ff8000" }), trackId: "top" };
    const adjust = { ...newLayerClip("adjustment", 1, 1), trackId: "top" };
    let p = project([clip("vid", "main", 0, 0, 2), solid, adjust], withTop);
    p = addEffect(p, [adjust.id], "invert").project;
    p = setParams(p, solid.id, "opacity", { opacity: 0.5, blendMode: "screen" });
    const plan = planRender(p, assets, opts);
    expect(plan.sources.map((s) => s.clipId)).toEqual([p.clips[0].id]);
    const [below, over] = plan.frame(15);
    expect(below.kind).toBe("picture");
    expect(over).toMatchObject({
      kind: "picture",
      picture: { key: "", opacity: 0.5, blend: 7, solid: { color: [1, 128 / 255, 0, 1], width: 1080, height: 1920 } },
    });
    const [, adjusted] = plan.frame(45);
    expect(adjusted).toMatchObject({ kind: "adjustment", adjustment: { opacity: 1, effects: [{ shader: "fx:invert" }] } });
    expect(Object.keys(plan.shaders)).toEqual(["fx:invert"]);
    // Silent: nothing to mix but the video's own sound.
    expect(inputsOf(audioArgs(p, assets, { outputPath: "/tmp/mix.flac" }))).toEqual(["/media/vid.mp4"]);
  });

  it("average moments over the shutter with motion blur, as many as the move needs", () => {
    const moving = clip("photo", "main", 0, 0, 2, { motion: { motionBlur: true, shutterAngle: 180 } });
    const key = (time: number, value: [number, number]) => ({ time, value, easing: "linear" as const });
    moving.effects = moving.effects.map((e) =>
      e.type === "motion" ? { ...e, keyframes: { position: [key(0, [0, 0.5]), key(2, [1, 0.5])] } } : e,
    );
    const still = clip("photo", "main", 2, 0, 1, { motion: { motionBlur: true } });
    const plan = planRender(project([moving, still]), assets, opts);
    const [picture] = pictures(plan.frame(30));
    // 540 px a second = 18 px a frame, half of it over a 180° shutter: 9 px in 1.5 px steps.
    expect(picture.samples).toHaveLength(6);
    const xs = picture.samples!.map((s) => s.affine[4] * 1080);
    expect(xs[5] - xs[0]).toBeCloseTo(9 * (5 / 6), 1);
    expect((xs[0] + xs[5]) / 2).toBeCloseTo(picture.affine[4] * 1080, 1);
    // Standing still, there's nothing to blur.
    expect(pictures(plan.frame(75))[0].samples).toBeUndefined();
  });
});

describe("presets", () => {
  it("export a transition preset as a motion-blurred adjustment layer over the cut", () => {
    const p = addPresetLayer(project([clip("vid", "main", 0, 0, 2), clip("vid", "main", 2, 4, 6)]), "spin", 2).project;
    const plan = planRender(p, assets, opts);
    // At the cut (frame 60) the layer spins fastest: many moments, each turned a little further.
    const layers = plan.frame(60);
    const adjustment = layers.find((l) => l.kind === "adjustment");
    expect(adjustment?.kind).toBe("adjustment");
    const samples = adjustment?.kind === "adjustment" ? adjustment.adjustment.samples : undefined;
    expect(samples?.length).toBeGreaterThan(20);
    expect(adjustment?.kind === "adjustment" && adjustment.adjustment.edges).toBe(1);
    // Before and after the layer, nothing adjusts the picture.
    expect(plan.frame(30).some((l) => l.kind === "adjustment")).toBe(false);
  });
});

describe("audioArgs", () => {
  const out = { outputPath: "/tmp/mix.flac" };
  const graphOf = (argv: string[]) => argv[argv.indexOf("-filter_complex") + 1].split(";");

  it("cuts each clip to its exact samples, delays it to its start and mixes over silence", () => {
    const p = project([
      clip("vid", "main", 0, 0, 1.01),
      clip("mute", "main", 1.01, 0, 0.77),
      clip("vid", "main", 1.78, 4, 6.345),
    ]);
    const argv = audioArgs(p, assets, { ...out, ffmpegPath: "/bin/ffmpeg" });
    expect(argv[0]).toBe("/bin/ffmpeg");
    // The silent clip has no input.
    expect(inputsOf(argv)).toEqual(["/media/vid.mp4", "/media/vid.mp4"]);
    const graph = graphOf(argv);
    expect(graph[0]).toBe(
      `anullsrc=r=48000:cl=stereo,aformat=sample_fmts=fltp:sample_rates=48000:channel_layouts=stereo,atrim=end_sample=${Math.round(4.125 * SAMPLE_RATE)}[abase]`,
    );
    expect(graph.find((f) => f.endsWith("[m1]"))).toContain(
      `atrim=end_sample=${Math.round(4.125 * SAMPLE_RATE) - Math.round(1.78 * SAMPLE_RATE)},adelay=delays=${Math.round(1.78 * SAMPLE_RATE)}S:all=1`,
    );
    expect(graph.at(-1)).toBe("[abase][m0][m1]amix=inputs=3:duration=first:normalize=0,alimiter=limit=0.98:level=0:latency=1[aout]");
    expect(argv.slice(argv.indexOf("-map"))).toEqual(["-map", "[aout]", "-c:a", "flac", "-t", "4.125000", "-y", "/tmp/mix.flac"]);
  });

  it("skips the sound of muted tracks, video or audio", () => {
    const clips = [clip("vid", "main", 0, 0, 2), clip("song", "audio_1", 0, 0, 2)];
    const muted = (id: string) => audioArgs(project(clips, (d) => ({ ...d, tracks: d.tracks.map((t) => ({ ...t, muted: t.id === id })) })), assets, out);
    expect(inputsOf(muted("main"))).toEqual(["/media/song.mp3"]);
    expect(inputsOf(muted("audio_1"))).toEqual(["/media/vid.mp4"]);
  });

  it("applies clip volume (and omits it at unity gain)", () => {
    const p = project([clip("vid", "main", 0, 0, 1, { volume: { level: 0.25 } }), clip("song", "audio_1", 0, 0, 1)]);
    const graph = graphOf(audioArgs(p, assets, out));
    expect(graph.find((f) => f.endsWith("[m0]"))).toContain("volume=0.25");
    expect(graph.find((f) => f.endsWith("[m1]"))).not.toContain("volume=");
  });

  it("follows animated volume with an exact curve of the clip's time", () => {
    const loud = clip("vid", "main", 2, 4, 8);
    const levels: Keyframe[] = [
      { time: 5, value: 0, easing: "linear" },
      { time: 6, value: 1, easing: "ease" },
      { time: 7, value: 0.5, easing: "hold" },
      { time: 7.5, value: 0.2, easing: "linear" },
    ];
    loud.effects = loud.effects.map((e) => (e.type === "volume" ? { ...e, keyframes: { level: levels } } : e));
    const graph = graphOf(audioArgs(project([loud]), assets, out));
    const chain = graph.find((f) => f.endsWith("[m0]"))!;
    const expr = /volume=volume='([^']+)':eval=frame/.exec(chain)![1];
    expect(chain).toContain("asetnsamples=n=64:p=0,volume=");
    // Evaluate it like ffmpeg would (t: seconds since the clip's in-point, 4).
    const evaluate = new Function("t", "if_", "lt", `return ${expr.replace(/\bif\(/g, "if_(")};`) as (
      t: number, if_: (c: number, a: number, b: number) => number, lt: (a: number, b: number) => number) => number;
    for (const s of [4, 5, 5.25, 5.5, 6, 6.3, 6.9, 7.2, 7.5, 8]) {
      expect(evaluate(s - 4, (c, a, b) => (c ? a : b), (a, b) => Number(a < b))).toBeCloseTo(keyframeValue(levels, s) as number, 5);
    }
  });

  it("follows a snappy (high influence) volume curve closely", () => {
    const loud = clip("vid", "main", 0, 0, 4);
    const levels: Keyframe[] = [
      { time: 1, value: 0, easing: "ease", influence: 0.9 },
      { time: 3, value: 1, easing: "ease", influence: 0.9 },
    ];
    loud.effects = loud.effects.map((e) => (e.type === "volume" ? { ...e, keyframes: { level: levels } } : e));
    const chain = graphOf(audioArgs(project([loud]), assets, out)).find((f) => f.endsWith("[m0]"))!;
    const expr = /volume=volume='([^']+)':eval=frame/.exec(chain)![1];
    const evaluate = new Function("t", "if_", "lt", `return ${expr.replace(/\bif\(/g, "if_(")};`) as (
      t: number, if_: (c: number, a: number, b: number) => number, lt: (a: number, b: number) => number) => number;
    // Within a hundredth (the curve is followed in straight pieces).
    for (let s = 0; s <= 4; s += 0.1) {
      const error = Math.abs(evaluate(s, (c, a, b) => (c ? a : b), (a, b) => Number(a < b)) - (keyframeValue(levels, s) as number));
      expect(error).toBeLessThan(0.01);
    }
  });

  it("plays retimed sound at its speed, keeping its pitch unless told not to", () => {
    expect(tempoFilters(1, true)).toEqual([]);
    expect(tempoFilters(2, true)).toEqual(["atempo=2"]);
    expect(tempoFilters(0.2, true)).toEqual(["atempo=0.5", "atempo=0.5", "atempo=0.8"]);
    expect(tempoFilters(1.5, false)).toEqual(["asetrate=72000", "aresample=48000"]);
    const c = clip("vid", "main", 1, 2, 6);
    const p = setClipSpeed(project([c]), [c.id], { speed: 2 });
    const argv = audioArgs(p, assets, out);
    expect([arg(argv, "-ss"), arg(argv, "-t")]).toEqual(["2.000000", "4.000000"]);
    // The tempo changes after the gain, then it's cut to its 2s on the timeline.
    expect(graphOf(argv).find((f) => f.endsWith("[m0]"))).toContain(`atempo=2,apad=whole_len=${2 * SAMPLE_RATE}`);
  });

  it("plays reversed sound from the reversed copy, its volume following the clip's own time", () => {
    const c = clip("back", "main", 0, 2, 6);
    const levels: Keyframe[] = [
      { time: 3, value: 0, easing: "linear" },
      { time: 5, value: 1, easing: "ease" },
    ];
    c.effects = c.effects.map((e) => (e.type === "volume" ? { ...e, keyframes: { level: levels } } : e));
    const argv = audioArgs(setClipSpeed(project([c]), [c.id], { reversed: true }), assets, out);
    // The clip's out-point (6s) is 4s into the 10s reversed copy.
    expect([inputsOf(argv)[0], arg(argv, "-ss"), arg(argv, "-t")]).toEqual(["/media/back-reversed.mp4", "4.000000", "4.000000"]);
    const expr = /volume=volume='([^']+)':eval=frame/.exec(graphOf(argv).find((f) => f.endsWith("[m0]"))!)![1];
    const evaluate = new Function("t", "if_", "lt", `return ${expr.replace(/\bif\(/g, "if_(")};`) as (
      t: number, if_: (c: number, a: number, b: number) => number, lt: (a: number, b: number) => number) => number;
    // t seconds into the reversed sound is source time 6 - t.
    for (const t of [0, 0.5, 1, 1.7, 2, 3, 4]) {
      expect(evaluate(t, (k, a, b) => (k ? a : b), (a, b) => Number(a < b))).toBeCloseTo(keyframeValue(levels, 6 - t) as number, 5);
    }
  });

  it("is silence for a timeline without sound", () => {
    expect(graphOf(audioArgs(project([clip("photo", "main", 0, 0, 2)]), assets, out)).at(-1)).toBe("[abase]anull[aout]");
  });
});

describe("encoderArgs", () => {
  const encode = (width: number, height: number) =>
    encoderArgs({ width, height, fps: 30, frames: 120 }, { audioPath: "/tmp/mix.flac", outputPath: "/out/x.mp4" });

  it("encodes BT.709 YUV frames from stdin with the mixed sound", () => {
    const argv = encode(1080, 1920);
    expect(argv.slice(argv.indexOf("-f"), argv.indexOf("-i") + 2)).toEqual([
      "-f", "rawvideo", "-pix_fmt", "yuv420p", "-s", "1080x1920", "-framerate", "30",
      "-colorspace", "bt709", "-color_primaries", "bt709", "-color_trc", "bt709", "-color_range", "tv", "-i", "pipe:0",
    ]);
    expect(inputsOf(argv)).toEqual(["pipe:0", "/tmp/mix.flac"]);
    expect(arg(argv, "-frames:v")).toBe("120");
    expect(argv.at(-1)).toBe("/out/x.mp4");
  });

  it("picks the quality from the output size", () => {
    expect(arg(encode(720, 1280), "-crf")).toBe("23");
    expect(arg(encode(1080, 1920), "-crf")).toBe("20");
  });
});

describe("lumaWeights", () => {
  it("follows the video's matrix, else what players assume for its size", () => {
    expect(lumaWeights("bt709", 480)).toEqual([0.2126, 0.0722]);
    expect(lumaWeights("bt470bg", 1080)).toEqual([0.299, 0.114]);
    expect(lumaWeights("bt2020nc", 2160)).toEqual([0.2627, 0.0593]);
    expect(lumaWeights(null, 1080)).toEqual([0.2126, 0.0722]);
    expect(lumaWeights(undefined, 480)).toEqual([0.299, 0.114]);
  });
});

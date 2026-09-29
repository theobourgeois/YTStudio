import { describe, expect, it } from "vitest";
import { defaultEffects, textEffects } from "../shared/effects.ts";
import { createDefaultProject } from "../shared/timeline.ts";
import { placeClip } from "../shared/transform.ts";
import type { Clip, ParamValues, Project } from "../shared/types.ts";
import { createTransition } from "../shared/transitions.ts";
import { normalizeProject } from "../shared/normalize.ts";
import { type RenderAsset, SAMPLE_RATE, buildRenderArgs, planPiece, planTransitions } from "./render.ts";

const assets: Record<string, RenderAsset> = {
  vid: { path: "/media/vid.mp4", kind: "video", hasVideo: true, hasAudio: true, width: 1920, height: 1080, duration: 10 },
  mute: { path: "/media/silent clip.mov", kind: "video", hasVideo: true, hasAudio: false, width: 1080, height: 1920, duration: 10 },
  song: { path: "/media/song.mp3", kind: "audio", hasVideo: false, hasAudio: true, width: null, height: null, duration: 60 },
  photo: { path: "/media/photo.png", kind: "image", hasVideo: true, hasAudio: false, width: 1000, height: 1000, duration: 5 },
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

const opts = { width: 1080, height: 1920, fps: 30, outputPath: "/out/x.mp4" };
const graphOf = (argv: string[]) => argv[argv.indexOf("-filter_complex") + 1].split(";");
const inputsOf = (argv: string[]) => argv.filter((_, i) => argv[i - 1] === "-i");
const sumOf = (graph: string[], re: RegExp) =>
  graph.reduce((s, f) => s + Number(re.exec(f)?.[1] ?? 0), 0);

describe("buildRenderArgs", () => {
  it("makes one accurately-seeked input per clip and one segment per clip or gap", () => {
    const p = project([
      clip("vid", "main", 0, 1, 3),
      clip("mute", "main", 2, 0, 1.5),
      clip("vid", "main", 4, 5, 6),
    ]);
    const argv = buildRenderArgs(p, assets, { ...opts, ffmpegPath: "/bin/ffmpeg" });
    expect(argv[0]).toBe("/bin/ffmpeg");
    expect(inputsOf(argv)).toEqual(["/media/vid.mp4", "/media/silent clip.mov", "/media/vid.mp4"]);
    expect(argv.slice(argv.indexOf("-ss"), argv.indexOf("-ss") + 4)).toEqual(["-ss", "1.000000", "-t", "2.000000"]);

    const graph = graphOf(argv);
    // clip, clip, gap 3.5..4, clip
    expect(graph).toContain("[c0_0][c0_1][g0_2][c0_3]concat=n=4:v=1:a=0[t0]");
    expect(graph.find((f) => f.endsWith("[g0_2]"))).toMatch(/^color=c=black@0:.*format=yuva420p.*trim=end_frame=15\[/);
    expect(graph).toContain("[bg][t0]overlay=x=0:y=0:format=yuv420:eof_action=pass[o0]");
    expect(graph).toContain("[o0]format=yuv420p[vout]");
    expect(graph.some((f) => f.startsWith("[1:a]"))).toBe(false); // no audio in that asset
    expect(graph).toContain("[abase][m0][m1]amix=inputs=3:duration=first:normalize=0,alimiter=limit=0.98:level=0:latency=1[aout]");
    expect(argv[argv.indexOf("-t", argv.indexOf("-filter_complex")) + 1]).toBe("5.000000");
    expect(argv.at(-1)).toBe("/out/x.mp4");
  });

  it("cuts segments to exact frame/sample counts that add up to the total", () => {
    // Durations that aren't whole frames: 1.01 + 0.77 + 2.345 = 4.125s.
    const p = project([
      clip("vid", "main", 0, 0, 1.01),
      clip("vid", "main", 1.01, 2, 2.77),
      clip("vid", "main", 1.78, 4, 6.345),
    ]);
    const graph = graphOf(buildRenderArgs(p, assets, opts));
    expect(sumOf(graph, /trim=end_frame=(\d+)\[[cg]\w+\]$/)).toBe(Math.ceil(4.125 * 30));
    expect(graph.find((f) => f.endsWith("[bg]"))).toContain(`trim=end_frame=${Math.ceil(4.125 * 30)}`);
    // Clip 2 starts at 1.01s: frames 31..53 (timestamps 1.033..1.767).
    expect(graph.find((f) => f.endsWith("[c0_1]"))).toContain("tpad=stop_mode=clone:stop=23,trim=end_frame=23");
    // Each clip's audio is cut to exactly its own samples and delayed to its start.
    expect(graph.find((f) => f.endsWith("[m1]"))).toContain(
      `atrim=end_sample=${Math.round(1.78 * SAMPLE_RATE) - Math.round(1.01 * SAMPLE_RATE)},adelay=delays=${Math.round(1.01 * SAMPLE_RATE)}S:all=1`,
    );
  });

  it("layers video tracks bottom-up over the background, padding each to the full length", () => {
    const p = project(
      [clip("vid", "main", 0, 0, 2), clip("vid", "top", 1, 0, 1), clip("song", "audio_1", 1, 10, 15)],
      (d) => ({
        ...d,
        tracks: [{ id: "top", kind: "video", name: "Video 2", muted: false }, ...d.tracks],
      }),
    );
    const argv = buildRenderArgs(p, assets, opts);
    const graph = graphOf(argv);
    expect(graph[0]).toBe("color=c=black:s=1080x1920:r=30,setsar=1,format=yuv420p,trim=end_frame=180[bg]");
    // Bottom track ("main") first: its clip then a gap to the end (6s).
    expect(graph).toContain("[c0_0][g0_1]concat=n=2:v=1:a=0[t0]");
    expect(graph.find((f) => f.endsWith("[g0_1]"))).toContain("trim=end_frame=120");
    // Top track: gap, clip, gap.
    expect(graph).toContain("[g1_0][c1_1][g1_2]concat=n=3:v=1:a=0[t1]");
    expect(graph).toContain("[bg][t0]overlay=x=0:y=0:format=yuv420:eof_action=pass[o0]");
    expect(graph).toContain("[o0][t1]overlay=x=0:y=0:format=yuv420:eof_action=pass[o1]");
    expect(graph).toContain("[o1]format=yuv420p[vout]");
    const music = graph.find((f) => f.endsWith("[m2]"))!;
    expect(music).toContain(`atrim=end_sample=${5 * SAMPLE_RATE},adelay=delays=${SAMPLE_RATE}S:all=1[m2]`);
    expect(graph).toContain(`anullsrc=r=48000:cl=stereo,aformat=sample_fmts=fltp:sample_rates=48000:channel_layouts=stereo,atrim=end_sample=${6 * SAMPLE_RATE}[abase]`);
    expect(argv[argv.indexOf("-t", argv.indexOf("-filter_complex")) + 1]).toBe("6.000000");
  });

  it("renders an audio-only timeline over the background", () => {
    const graph = graphOf(buildRenderArgs(project([clip("song", "audio_1", 0, 0, 3)]), assets, opts));
    expect(graph).toContain("[bg]format=yuv420p[vout]");
    expect(graph).toContain("[abase][m0]amix=inputs=2:duration=first:normalize=0,alimiter=limit=0.98:level=0:latency=1[aout]");
  });

  it("skips the sound of muted tracks, video or audio", () => {
    const clips = [clip("vid", "main", 0, 0, 2), clip("song", "audio_1", 0, 0, 2)];
    const mutedMain = buildRenderArgs(
      project(clips, (d) => ({ ...d, tracks: d.tracks.map((t) => ({ ...t, muted: t.id === "main" })) })),
      assets,
      opts,
    );
    expect(graphOf(mutedMain).some((f) => f.startsWith("[0:a]"))).toBe(false);
    expect(graphOf(mutedMain).some((f) => f.startsWith("[0:v]"))).toBe(true);
    expect(graphOf(mutedMain)).toContain("[abase][m0]amix=inputs=2:duration=first:normalize=0,alimiter=limit=0.98:level=0:latency=1[aout]");

    const mutedAudio = buildRenderArgs(
      project(clips, (d) => ({ ...d, tracks: d.tracks.map((t) => ({ ...t, muted: t.id !== "main" })) })),
      assets,
      opts,
    );
    expect(inputsOf(mutedAudio)).toEqual(["/media/vid.mp4"]);
    expect(graphOf(mutedAudio)).toContain("[abase][m0]amix=inputs=2:duration=first:normalize=0,alimiter=limit=0.98:level=0:latency=1[aout]");
  });

  it("fits (letterboxes) or fills the canvas, padding transparently", () => {
    const p = project([clip("vid", "main", 0, 0, 1), clip("vid", "main", 1, 0, 1, { motion: { fit: "cover" } })]);
    const graph = graphOf(buildRenderArgs(p, assets, opts));
    const [contain, cover] = [graph.find((f) => f.endsWith("[c0_0]"))!, graph.find((f) => f.endsWith("[c0_1]"))!];
    // 1920x1080 in 1080x1920: 1080x608, centred vertically; nothing to crop.
    expect(contain).toBe(
      "[0:v]setpts=PTS-STARTPTS,fps=30,scale=1920:1080,setsar=1,scale=1080:608,format=rgba," +
        "pad=1080:1920:0:656:color=black@0,format=yuva420p,setsar=1,tpad=stop_mode=clone:stop=30,trim=end_frame=30[c0_0]",
    );
    // Filling: only the middle of the source (plus a pixel of margin) is scaled, then cut to the canvas.
    expect(cover).toContain("crop=610:1080:655:0:exact=1,scale=1084:1920,format=rgba,crop=1080:1920:2:0,pad=1080:1920:0:0:");
  });

  it("scales, rotates, positions and fades clips by their motion and opacity", () => {
    const p = project([
      clip("vid", "main", 0, 0, 1, { motion: { rotation: 90 }, opacity: { opacity: 0.5 } }),
      clip("vid", "main", 1, 0, 1, { motion: { position: [0.25, 0.5], scale: 0.5 } }),
    ]);
    const graph = graphOf(buildRenderArgs(p, assets, opts));
    const [turned, moved] = [graph.find((f) => f.endsWith("[c0_0]"))!, graph.find((f) => f.endsWith("[c0_1]"))!];
    // 1080x608 turned a quarter: 608x1080, centred on the canvas.
    expect(turned).toContain(`scale=1080:608,format=rgba,rotate=a=${(Math.PI / 2).toFixed(9)}:ow=608:oh=1080:c=black@0,colorchannelmixer=aa=0.5,pad=1080:1920:236:420:`);
    // Half size (540x304) centred at x=270.
    expect(moved).toContain("scale=540:304,format=rgba,pad=1080:1920:0:808:");
  });

  it("treats clips that are off the canvas or invisible as gaps", () => {
    const p = project([
      clip("vid", "main", 0, 0, 1, { motion: { position: [3, 0.5] } }),
      clip("vid", "main", 1, 0, 1, { opacity: { opacity: 0 } }),
      clip("vid", "main", 2, 0, 1, { motion: { scale: 0 } }),
    ]);
    const argv = buildRenderArgs(p, assets, opts);
    // Nothing to draw on the track at all, but the clips' sound still plays.
    expect(graphOf(argv)).toContain("[bg]format=yuv420p[vout]");
    expect(graphOf(argv).filter((f) => f.includes(":v]"))).toEqual([]);
    expect(graphOf(argv).filter((f) => /^\[\d+:a\]/.test(f))).toHaveLength(3);
  });

  it("loops a still image for the length of its clip", () => {
    const p = project([clip("photo", "main", 0, -1, 1.5)]);
    const argv = buildRenderArgs(p, assets, opts);
    expect(argv.slice(argv.indexOf("-loop"), argv.indexOf("-i") + 2)).toEqual([
      "-loop", "1", "-framerate", "30", "-t", "2.500000", "-i", "/media/photo.png",
    ]);
    expect(argv).not.toContain("-ss");
    // 1000x1000 fitted to the width: 1080x1080.
    expect(graphOf(argv).find((f) => f.endsWith("[c0_0]"))).toContain("scale=1000:1000,setsar=1,scale=1080:1080,format=rgba,pad=1080:1920:0:420:");
  });

  it("applies clip volume (and omits it at unity gain)", () => {
    const p = project([clip("vid", "main", 0, 0, 1, { volume: { level: 0.25 } }), clip("song", "audio_1", 0, 0, 1)]);
    const graph = graphOf(buildRenderArgs(p, assets, opts));
    expect(graph.find((f) => f.endsWith("[m0]"))).toContain("volume=0.25");
    expect(graph.find((f) => f.endsWith("[m1]"))).not.toContain("volume=");
  });

  it("picks the encoder quality from the output size", () => {
    const crf = (w: number, h: number) => {
      const argv = buildRenderArgs(project([clip("vid", "main", 0, 0, 1)]), assets, { ...opts, width: w, height: h });
      return argv[argv.indexOf("-crf") + 1];
    };
    expect(crf(720, 1280)).toBe("23");
    expect(crf(1080, 1920)).toBe("20");
  });

  it("only scales up the part of a zoomed-in clip that can be seen", () => {
    const canvas = { width: 1080, height: 1920 };
    const media = { width: 1920, height: 1080 };
    const piece = planPiece(canvas, media, placeClip(canvas, media, {
      fit: "cover", position: [0.5, 0.5], scaleX: 10, scaleY: 10, rotation: 30, anchor: [0.5, 0.5],
    }))!;
    // The canvas (rotated) covers a small part of the source...
    expect(piece.crop.w).toBeLessThan(150);
    expect(piece.crop.h).toBeLessThan(150);
    // ...so the scaled piece stays around the canvas's size, not 10x it.
    expect(piece.scaled.w).toBeLessThan(2 * 1920);
    expect(piece.visible).toEqual({ x: piece.visible.x, y: piece.visible.y, w: 1080, h: 1920 });
  });

  it("plans nothing for a clip that misses the canvas", () => {
    const canvas = { width: 100, height: 100 };
    const media = { width: 100, height: 100 };
    const at = (position: [number, number]) =>
      planPiece(canvas, media, placeClip(canvas, media, { fit: "contain", position, scaleX: 1, scaleY: 1, rotation: 0, anchor: [0.5, 0.5] }));
    expect(at([1.6, 0.5])).toBeNull();
    // Half off the right edge: only the left half is kept.
    expect(at([1, 0.5])).toMatchObject({ crop: { x: 0, w: 51 }, at: { x: 50 }, visible: { x: 0, w: 50 } });
  });

  it("rejects an empty timeline and unknown media", () => {
    expect(() => buildRenderArgs(project([]), assets, opts)).toThrow(/empty/);
    const p = project([clip("vid", "main", 0, 0, 1)]);
    expect(() => buildRenderArgs(p, {}, opts)).toThrow(/Missing media/);
  });
});

describe("text clips", () => {
  const text: Clip = {
    id: "t1", assetId: "", trackId: "main", start: 1, in: 0, out: 2,
    effects: textEffects({ text: "Hi" }),
  };
  const drawn: RenderAsset = {
    path: "/tmp/t1.png", kind: "image", hasVideo: true, hasAudio: false, width: 800, height: 200, duration: 0,
    frame: { width: 400, height: 100 },
  };

  it("are placed from their drawn image at their own frame size", () => {
    const p = project([clip("vid", "main", 3, 0, 2), text]);
    const argv = buildRenderArgs(p, assets, opts, { t1: drawn });
    expect(inputsOf(argv)).toContain("/tmp/t1.png");
    const graph = graphOf(argv);
    // The 800px drawing lands 400px wide (its frame at 100%), centred on the canvas.
    expect(graph.some((f) => f.includes("scale=400:100") && f.includes("pad=1080:1920:340:910"))).toBe(true);
  });

  it("need their drawing", () => {
    expect(() => buildRenderArgs(project([text]), assets, opts)).toThrow(/text/i);
  });

  it("can be a side of a transition, drawn from their image", () => {
    const p = project([{ ...text, transitionIn: createTransition("cross-dissolve", 0.5) }]);
    const [job] = planTransitions(p, assets, opts, { t1: drawn });
    expect(job.sides[0]).toBeNull();
    const argv = job.sides[1]!;
    expect(inputsOf(argv)).toEqual(["/tmp/t1.png"]);
    expect(argv).toContain("-loop");
    expect(argv[argv.indexOf("-vf") + 1]).toContain("scale=400:100");
  });
});

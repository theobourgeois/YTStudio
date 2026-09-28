import { describe, expect, it } from "vitest";
import { createDefaultProject, normalizeProject } from "../shared/timeline.ts";
import type { Clip, Project } from "../shared/types.ts";
import { type RenderAsset, SAMPLE_RATE, buildRenderArgs } from "./render.ts";

const assets: Record<string, RenderAsset> = {
  vid: { path: "/media/vid.mp4", hasVideo: true, hasAudio: true },
  mute: { path: "/media/silent clip.mov", hasVideo: true, hasAudio: false },
  song: { path: "/media/song.mp3", hasVideo: false, hasAudio: true },
};
const durations = { vid: 10, mute: 10, song: 60 };
const library = Object.fromEntries(
  Object.entries(assets).map(([id, a]) => [id, { ...a, duration: durations[id as keyof typeof durations] }]),
);

let n = 0;
const clip = (assetId: string, trackId: string, start: number, inPoint: number, out: number, extra: Partial<Clip> = {}): Clip => ({
  id: `c${n++}`, assetId, trackId, start, in: inPoint, out, volume: 1, fit: "contain", ...extra,
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
  it("makes one accurately-seeked input and segment per main clip", () => {
    const p = project([
      clip("vid", "main", 0, 1, 3),
      clip("mute", "main", 2, 0, 1.5),
      clip("vid", "main", 3.5, 5, 6),
    ]);
    const argv = buildRenderArgs(p, assets, { ...opts, ffmpegPath: "/bin/ffmpeg" });
    expect(argv[0]).toBe("/bin/ffmpeg");
    expect(inputsOf(argv)).toEqual(["/media/vid.mp4", "/media/silent clip.mov", "/media/vid.mp4"]);
    expect(argv.slice(argv.indexOf("-ss"), argv.indexOf("-ss") + 4)).toEqual(["-ss", "1.000000", "-t", "2.000000"]);

    const graph = graphOf(argv);
    expect(graph).toContain("[v0][v1][v2]concat=n=3:v=1:a=0[vout]");
    expect(graph).toContain("[a0][a1][a2]concat=n=3:v=0:a=1[amain]");
    expect(graph.some((f) => f.startsWith("[1:a]"))).toBe(false); // no audio in that asset
    expect(graph.find((f) => f.endsWith("[a1]"))).toMatch(/^anullsrc=/);
    expect(graph.some((f) => f.includes("[vfill]"))).toBe(false);
    expect(argv[argv.indexOf("-t", argv.indexOf("-filter_complex")) + 1]).toBe("4.500000");
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
    expect(sumOf(graph, /trim=end_frame=(\d+)\[v\w+\]$/)).toBe(Math.ceil(4.125 * 30));
    expect(sumOf(graph, /atrim=end_sample=(\d+)\[a\w+\]$/)).toBe(Math.round(4.125 * SAMPLE_RATE));
    // Segment 2 starts at 1.01s: frames 31..53 (timestamps 1.033..1.767).
    expect(graph.find((f) => f.endsWith("[v1]"))).toContain("tpad=stop_mode=clone:stop=23,trim=end_frame=23");
  });

  it("adds a background filler when an audio track outlasts the main track", () => {
    const p = project(
      [clip("vid", "main", 0, 0, 2), clip("song", "audio_1", 1, 10, 15)],
      (d) => ({ ...d, settings: { ...d.settings, background: "#112233" } }),
    );
    const argv = buildRenderArgs(p, assets, opts);
    const graph = graphOf(argv);
    expect(graph).toContain("color=c=0x112233:s=1080x1920:r=30,setsar=1,format=yuv420p,trim=end_frame=120[vfill]");
    expect(graph).toContain(`anullsrc=r=48000:cl=stereo,aformat=sample_fmts=fltp:sample_rates=48000:channel_layouts=stereo,atrim=end_sample=${4 * SAMPLE_RATE}[afill]`);
    expect(graph).toContain("[v0][vfill]concat=n=2:v=1:a=0[vout]");
    const music = graph.find((f) => f.startsWith("[1:a]"))!;
    expect(music).toContain(`atrim=end_sample=${5 * SAMPLE_RATE},adelay=delays=${SAMPLE_RATE}S:all=1[m0]`);
    expect(graph).toContain("[amain][m0]amix=inputs=2:duration=first:normalize=0[aout]");
    expect(argv[argv.indexOf("-t", argv.indexOf("-filter_complex")) + 1]).toBe("6.000000");
  });

  it("renders an audio-only timeline over a filler", () => {
    const graph = graphOf(buildRenderArgs(project([clip("song", "audio_1", 0, 0, 3)]), assets, opts));
    expect(graph).toContain("[vfill]concat=n=1:v=1:a=0[vout]");
    expect(graph).toContain("[afill]concat=n=1:v=0:a=1[amain]");
  });

  it("silences a muted main track and skips muted audio tracks", () => {
    const clips = [clip("vid", "main", 0, 0, 2), clip("song", "audio_1", 0, 0, 2)];
    const mutedMain = graphOf(
      buildRenderArgs(project(clips, (d) => ({ ...d, tracks: d.tracks.map((t) => ({ ...t, muted: t.id === "main" })) })), assets, opts),
    );
    expect(mutedMain.some((f) => f.startsWith("[0:a]"))).toBe(false);
    expect(mutedMain.find((f) => f.endsWith("[a0]"))).toMatch(/^anullsrc=/);
    expect(mutedMain.some((f) => f.includes("amix"))).toBe(true);

    const mutedAudio = buildRenderArgs(
      project(clips, (d) => ({ ...d, tracks: d.tracks.map((t) => ({ ...t, muted: t.id !== "main" })) })),
      assets,
      opts,
    );
    expect(inputsOf(mutedAudio)).toEqual(["/media/vid.mp4"]);
    expect(graphOf(mutedAudio)).toContain("[amain]anull[aout]");
  });

  it("scales + pads for contain and scales + crops for cover", () => {
    const p = project([clip("vid", "main", 0, 0, 1), clip("vid", "main", 1, 0, 1, { fit: "cover" })]);
    const graph = graphOf(buildRenderArgs(p, assets, opts));
    const [contain, cover] = [graph.find((f) => f.endsWith("[v0]"))!, graph.find((f) => f.endsWith("[v1]"))!];
    expect(contain).toContain("scale=1080:1920:force_original_aspect_ratio=decrease");
    expect(contain).toContain("pad=1080:1920:(ow-iw)/2:(oh-ih)/2:color=0x000000");
    expect(contain).not.toContain("crop=");
    expect(cover).toContain("scale=1080:1920:force_original_aspect_ratio=increase");
    expect(cover).toContain("crop=1080:1920");
    expect(cover).not.toMatch(/,pad=/);
    for (const f of [contain, cover]) expect(f).toMatch(/fps=30,.*setsar=1,format=yuv420p/);
  });

  it("applies clip volume (and omits it at unity gain)", () => {
    const p = project([clip("vid", "main", 0, 0, 1, { volume: 0.25 }), clip("song", "audio_1", 0, 0, 1)]);
    const graph = graphOf(buildRenderArgs(p, assets, opts));
    expect(graph.find((f) => f.endsWith("[a0]"))).toContain("volume=0.25");
    expect(graph.find((f) => f.endsWith("[m0]"))).not.toContain("volume=");
  });

  it("picks the encoder quality from the output size", () => {
    const crf = (w: number, h: number) => {
      const argv = buildRenderArgs(project([clip("vid", "main", 0, 0, 1)]), assets, { ...opts, width: w, height: h });
      return argv[argv.indexOf("-crf") + 1];
    };
    expect(crf(720, 1280)).toBe("23");
    expect(crf(1080, 1920)).toBe("20");
  });

  it("rejects an empty timeline and unknown media", () => {
    expect(() => buildRenderArgs(project([]), assets, opts)).toThrow(/empty/);
    const p = project([clip("vid", "main", 0, 0, 1)]);
    expect(() => buildRenderArgs(p, {}, opts)).toThrow(/Missing media/);
  });
});

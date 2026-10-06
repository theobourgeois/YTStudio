import { describe, expect, it } from "vitest";
import { createSignalReader, beatAt } from "./audio-signals.ts";
import { DEFAULT_VISUALIZER_OPTIONS, type SongHandoff, VISUALIZER_LOOKS, type VisualizerOptions, guessRole, normalizeVisualizerOptions } from "./handoff.ts";
import { normalizeProject } from "./normalize.ts";
import { videoFromSong } from "./song-video.ts";
import type { Clip, Effect, MediaAsset, Project } from "./types.ts";

/** A song at 120 BPM, 8 seconds: a kick stem and a bus, the kick's and the snare's notes, a drop. */
const handoff = (over: Partial<SongHandoff> = {}): SongHandoff => ({
  kind: "song",
  name: "Night drive",
  length: 8,
  tempo: { bpm: 120, timeSignature: [4, 4], beats: Array.from({ length: 19 }, (_, i) => i * 0.5) },
  mix: { file: "/tmp/mix.flac" },
  stems: [
    { name: "Kick", color: "#ff0000", role: "kick", file: "/tmp/kick.flac" },
    { name: "Bus", color: "#00ff00", file: "/tmp/bus.flac" },
  ],
  notes: [
    { channel: "808 Kick", color: "#ff0000", role: "kick", events: [{ time: 0, velocity: 1, length: 0.1, key: 60 }, { time: 1, velocity: 0.8, length: 0.1, key: 60 }] },
    { channel: "Clap", color: "#0000ff", role: "snare", events: [{ time: 0.5, velocity: 1, length: 0.1, key: 60 }] },
    { channel: "Silent", color: "#0000ff", events: [] },
  ],
  markers: [{ time: 4, label: "Drop" }, { time: 99, label: "Past the end" }],
  origin: { projectId: "project_song" },
  ...over,
});

const asset = (id: string, duration = 9): MediaAsset => ({ id, projectId: "p", name: id, kind: "audio", duration, width: null, height: null, fps: null, hasVideo: false, hasAudio: true, size: 1, createdAt: 0, status: "ready", src: "", poster: null, filmstrip: null, waveform: null });
const media = { mix: asset("media_mix"), stems: [asset("media_kick"), asset("media_bus")] };
const make = (options: Partial<VisualizerOptions> = {}, song = handoff()) => videoFromSong(song, song.stems.length ? media : { mix: media.mix, stems: [] }, { ...DEFAULT_VISUALIZER_OPTIONS, ...options });
const assets = Object.fromEntries([media.mix, ...media.stems].map((a) => [a.id, a]));

const effectOf = (clip: Clip, type: string): Effect | undefined => clip.effects.find((e) => e.type === type);
/** The clip on the video track with this effect. */
const withEffect = (p: Project, type: string) => p.clips.find((c) => effectOf(c, type))!;

describe("a song made into a video", () => {
  it("plays the mix, keeps each stem silent on a track named after it, and is as long as the song rings", () => {
    const p = make();
    expect(p.name).toBe("Night drive");
    expect(p.settings).toEqual({ aspectRatio: "9:16", fps: 30 });
    const audio = p.tracks.filter((t) => t.kind === "audio");
    expect(audio.map((t) => [t.name, t.muted])).toEqual([
      ["Mix", false],
      ["Kick", true],
      ["Bus", true],
    ]);
    const mix = p.clips.find((c) => c.assetId === "media_mix")!;
    expect(mix).toMatchObject({ trackId: audio[0].id, start: 0, in: 0, out: 9 });
    expect(p.clips.find((c) => c.assetId === "media_kick")?.trackId).toBe(audio[1].id);
    // Video tracks first, every layer as long as the song.
    expect(p.tracks.slice(0, 4).every((t) => t.kind === "video")).toBe(true);
    expect(p.clips.filter((c) => !c.assetId).every((c) => c.start === 0 && c.out === 9)).toBe(true);
  });

  it("makes each channel's notes an events signal with its role, its beat exact, its arrangement markers", () => {
    const p = make();
    expect(p.signals?.map((s) => [s.name, s.kind, s.role, s.color])).toEqual([
      ["808 Kick", "events", "kick", "#ff0000"],
      ["Clap", "events", "snare", "#0000ff"],
    ]);
    expect(p.tempo).toEqual({ assetIds: ["media_mix", "media_kick", "media_bus"], beatsPerBar: 4, beats: handoff().tempo.beats });
    expect(p.markers?.map((m) => [m.time, m.label])).toEqual([[4, "Drop"]]);
    // The beat is the song's, at once.
    expect(beatAt(createSignalReader(p, new Map()), null, 1.25)).toMatchObject({ bpm: 120, beat: 2.5 });
  });

  it("binds its look to the song by role: the notes first, then a stem, then the mix", () => {
    const scale = (p: Project) => effectOf(withEffect(p, "audio-circle"), "motion")!.links!.scale.signal;
    const pulse = make();
    expect(scale(pulse)).toEqual({ id: pulse.signals!.find((s) => s.role === "kick")!.id });
    // The snare's split too.
    expect(effectOf(withEffect(pulse, "rgb-split"), "rgb-split")!.links!.amount.signal).toEqual({ id: pulse.signals!.find((s) => s.role === "snare")!.id });
    // No notes: the kick's stem's onsets.
    const stemOnly = make({}, handoff({ notes: [] }));
    const kickTrack = stemOnly.tracks.find((t) => t.name === "Kick")!.id;
    expect(scale(stemOnly)).toEqual({ name: "onset", source: { kind: "track", trackId: kickTrack } });
    // Neither: the mix's low hits.
    expect(scale(make({}, handoff({ notes: [], stems: [] })))).toEqual({ name: "onsetLow" });

    // A visualizer listening to the kick listens to its stem.
    const burst = (p: Project) => effectOf(withEffect(p, "audio-burst"), "audio-burst")!.params;
    const bars = make({ look: "bars" });
    expect(burst(bars)).toMatchObject({ source: `t:${bars.tracks.find((t) => t.name === "Kick")!.id}`, hits: "any" });
    expect(burst(make({ look: "bars" }, handoff({ stems: [] })))).toMatchObject({ source: "master", hits: "kicks" });
  });

  it("makes every look a valid video, nothing of it dropped when it's loaded", () => {
    for (const { id: look } of VISUALIZER_LOOKS) {
      for (const aspectRatio of ["9:16", "16:9"] as const) {
        const p = make({ look, aspectRatio, fps: 60 });
        expect(normalizeProject(p, assets), look).toEqual(p);
      }
    }
    // Nothing yet: the song, and an empty video track.
    const empty = make({ look: "none" });
    expect(empty.tracks.filter((t) => t.kind === "video")).toHaveLength(1);
    expect(empty.clips.every((c) => c.assetId)).toBe(true);
  });
});

describe("handoff options and roles", () => {
  it("takes the options it knows, the defaults for the rest", () => {
    expect(normalizeVisualizerOptions({ look: "bars", aspectRatio: "1:1", fps: 60 })).toEqual({ look: "bars", aspectRatio: "1:1", fps: 60 });
    expect(normalizeVisualizerOptions({ look: "disco", aspectRatio: "2:1", fps: 24 })).toEqual(DEFAULT_VISUALIZER_OPTIONS);
    expect(normalizeVisualizerOptions(null)).toEqual(DEFAULT_VISUALIZER_OPTIONS);
  });

  it("guesses what a channel is from its name or its sample's", () => {
    expect(guessRole("Kick")).toBe("kick");
    expect(guessRole("KickDrum_01.wav")).toBe("kick");
    expect(guessRole("808 Kick")).toBe("kick");
    expect(guessRole("808")).toBe("bass");
    expect(guessRole("Sub Bass")).toBe("bass");
    expect(guessRole("Clap 2")).toBe("snare");
    expect(guessRole("Snare2")).toBe("snare");
    expect(guessRole("hi-hat open")).toBe("hats");
    expect(guessRole("Lead Vox")).toBe("vocal");
    expect(guessRole("Serum")).toBeUndefined();
    expect(guessRole("Insert 3", "Pluck")).toBe("lead");
    expect(guessRole(null, undefined)).toBeUndefined();
  });
});

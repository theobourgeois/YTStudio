import { describe, expect, it } from "vitest";
import { solidEffects, findEffect } from "@shared/effects";
import { SignalAnalyser } from "@shared/signals/analyse";
import { MAIN_TRACK_ID, createDefaultProject, getClip } from "@shared/timeline";
import { defaultEffects } from "@shared/effects";
import type { Clip, MediaAsset, Project } from "@shared/types";
import { describeClips, describeTimeline } from "./describe";
import { EDITS, type EditEnv } from "./edits";

const RATE = 48_000;

/** A kick every half second from 0.25 s, `seconds` long, with a steady beat. */
function kickSong(seconds: number) {
  const n = seconds * RATE;
  const samples = new Float32Array(n * 2);
  for (let i = 0; i < n; i++) {
    const t = i / RATE;
    const since = t < 0.25 ? -1 : (t - 0.25) % 0.5;
    const v = since < 0 ? 0 : 0.9 * Math.sin(2 * Math.PI * (50 * since + (100 / 30) * (1 - Math.exp(-30 * since)))) * Math.exp(-since / 0.05);
    samples[i * 2] = v;
    samples[i * 2 + 1] = v;
  }
  const a = new SignalAnalyser(RATE, seconds);
  a.push(samples);
  const beats = Array.from({ length: seconds * 2 }, (_, k) => 0.25 + k * 0.5).filter((t) => t < seconds);
  return a.finish({ bpm: 120, confidence: 0.9, beats, downbeats: beats.filter((_, k) => k % 4 === 0), sections: [{ start: 0, end: seconds, db: -6, level: 1 }], drops: [] });
}

const song: MediaAsset = {
  id: "song", projectId: "p1", name: "song.wav", kind: "audio", duration: 4, width: 0, height: 0, fps: 0,
  hasVideo: false, hasAudio: true, size: 1, createdAt: 0, status: "ready", src: "", poster: null, filmstrip: null, waveform: null,
};
const store = new Map([["song", kickSong(4)]]);
const base = createDefaultProject();
const project: Project = {
  ...base,
  tracks: [...base.tracks, { id: "a1", kind: "audio", name: "Music", muted: false }],
  clips: [
    { id: "solid", assetId: "", trackId: MAIN_TRACK_ID, start: 0, in: 0, out: 4, effects: solidEffects() },
    { id: "s", assetId: "song", trackId: "a1", start: 0, in: 0, out: 4, effects: defaultEffects() } as Clip,
  ],
};
const env: EditEnv = { assets: { song }, playhead: 0, signals: { store, document: (view) => view } };
const deaf: EditEnv = { assets: { song }, playhead: 0 };

describe("link_param", () => {
  it("links a parameter and says how far it moves over the clip", () => {
    const out = EDITS.link_param(project, { clipIds: ["solid"], effect: "motion", param: "scale", link: { signal: "bass", amount: 0.3 } }, env);
    const link = findEffect(getClip(out.project, "solid")!, "motion")?.links?.scale;
    expect(link).toMatchObject({ signal: { name: "bass" }, mode: "add", amount: 0.3 });
    expect(out.text).toMatch(/scale \(motion\) now follows "bass": solid moves 1–1\.\d+, furthest at /);
    expect(describeTimeline(out.project, { song }, { playhead: 0, selectedClipIds: [] })).toContain('scale linked to "bass" add 0.3');
    expect(JSON.parse(describeClips(out.project, { song }, ["solid"]))[0].effects[0].links.scale.amount).toBe(0.3);
    const unlinked = EDITS.link_param(out.project, { clipIds: ["solid"], effect: "motion", param: "scale", link: null }, env);
    expect(findEffect(getClip(unlinked.project, "solid")!, "motion")?.links).toBeUndefined();
  });

  it("takes points, maps, hit shapes and sources", () => {
    const point = EDITS.link_param(project, { clipIds: ["solid"], effect: "motion", param: "position", link: { signal: "onsetLow", amount: [0, -0.05], hit: { decay: 0.2 } } }, env);
    expect(findEffect(getClip(point.project, "solid")!, "motion")?.links?.position).toMatchObject({ amount: [0, -0.05], hit: { attack: 0.005, hold: 0, decay: 0.2 } });
    const map = EDITS.link_param(project, { clipIds: ["solid"], effect: "opacity", param: "opacity", link: { signal: "level", source: "Music", mode: "map", to: 0.2 } }, env);
    expect(findEffect(getClip(map.project, "solid")!, "opacity")?.links?.opacity).toMatchObject({ mode: "map", to: 0.2, signal: { name: "level", source: { kind: "track", trackId: "a1" } } });
  });

  it("says what's wrong", () => {
    const link = (l: object, param = "scale", effect = "motion") => () => EDITS.link_param(project, { clipIds: ["solid"], effect, param, link: l }, env);
    expect(link({ signal: "kick", amount: 1 })).toThrow(/no signal "kick". Built-in ones: level.*no signals of its own yet/);
    expect(link({ signal: "bass" })).toThrow(/`link.amount` must be a number/);
    expect(link({ signal: "bass", mode: "map" })).toThrow(/needs `to`/);
    expect(link({ signal: "bass", amount: 1, hit: {} })).toThrow(/"bass" isn't hits/);
    expect(link({ signal: "bass", amount: 1 }, "fit")).toThrow(/can't be linked \(its numbers and points can: position/);
    expect(link({ signal: "bass", amount: 1, source: "Drums" })).toThrow(/no track or clip "Drums"/);
    expect(EDITS.link_param(project, { clipIds: ["solid"], effect: "motion", param: "scale", link: { signal: "bass", amount: 0.3 } }, deaf).text).toMatch(/the sound isn't loaded/);
  });
});

describe("the video's own signals", () => {
  it("defines a band with onsets and says what it hears", () => {
    const out = EDITS.define_signal(project, { name: "Kick", kind: "band", low: 40, high: 120, threshold: 0.4, onsets: true, role: "kick" }, env);
    const def = out.project.signals![0];
    expect(def).toMatchObject({ name: "Kick", kind: "band", low: 40, high: 120, autoGain: true, onsets: true, role: "kick", source: { kind: "master" } });
    expect(out.text).toMatch(/Made "Kick" \(sig_\w+\): a band, 40–120 Hz of the mix, with onsets; over the video it averages .*; 8 hits: 0\.2[3-9], 0\.7/);
    // Changed by name; a name taken by another is refused.
    const changed = EDITS.define_signal(out.project, { signal: "Kick", name: "Kick", threshold: 0.6 }, env);
    expect(changed.project.signals![0]).toMatchObject({ id: def.id, threshold: 0.6, low: 40 });
    const two = EDITS.define_signal(changed.project, { name: "Hats", kind: "band", low: 8000, high: 16000 }, env).project;
    expect(() => EDITS.define_signal(two, { signal: "Hats", name: "kick" }, env)).toThrow(/already a signal "Kick"/);
    expect(() => EDITS.define_signal(project, { name: "X", kind: "band" }, env)).toThrow(/needs `low` and `high`/);
    expect(() => EDITS.define_signal(project, { name: "X" }, env)).toThrow(/Give `kind`/);
    expect(describeTimeline(two, { song }, { playhead: 0, selectedClipIds: [] })).toMatch(/own signals \(define_signal\): sig_\w+ "Kick" \(kick\): band 40–120 Hz of the mix, threshold 0.6/);
  });

  it("places hits on the beat, every other one, quantised, and links to them", () => {
    const placed = EDITS.set_events(project, { signal: "Flash", at: "beats", every: 2, from: 1, to: 3 }, env);
    const def = placed.project.signals![0];
    expect(def.kind === "events" && def.events.map((e) => e.time)).toEqual([1.25, 2.25]);
    expect(placed.text).toMatch(/"Flash" \(sig_\w+\) has 2 hits \(1.25–2.25s\)/);
    const more = EDITS.set_events(placed.project, { signal: "Flash", add: [{ time: 3.1, velocity: 0.5 }], quantize: 2 }, env).project;
    const after = more.signals![0];
    expect(after.kind === "events" && after.events.map((e) => [e.time, e.velocity])).toEqual([[1.25, 1], [2.25, 1], [3, 0.5]]);
    const cleared = EDITS.set_events(more, { signal: "Flash", remove: { from: 2, to: 4 } }, env).project.signals![0];
    expect(cleared.kind === "events" && cleared.events.length).toBe(1);
    const linked = EDITS.link_param(more, { clipIds: ["solid"], effect: "opacity", param: "opacity", link: { signal: "Flash", amount: -1, hit: { decay: 0.1 } } }, env);
    expect(findEffect(getClip(linked.project, "solid")!, "opacity")?.links?.opacity.signal).toEqual({ id: def.id });
    expect(linked.text).toMatch(/solid moves 0(\.\d+)?–1, furthest at (1|2)\.2\d*s/);
    expect(() => EDITS.set_events(project, { signal: "X", at: "beats" }, deaf)).toThrow(/isn't loaded/);
    const band = EDITS.define_signal(project, { name: "Low", kind: "band", low: 40, high: 120 }, env).project;
    expect(() => EDITS.set_events(band, { signal: "Low", clear: true }, env)).toThrow(/is a band signal/);
  });

  it("deletes signals and the links to them", () => {
    const p = EDITS.set_events(project, { signal: "Flash", add: [{ time: 1 }] }, env).project;
    const linked = EDITS.link_param(p, { clipIds: ["solid"], effect: "opacity", param: "opacity", link: { signal: "Flash", amount: 1 } }, env).project;
    const out = EDITS.delete_signal(linked, { signals: ["flash"] }, env);
    expect(out.project.signals).toBeUndefined();
    expect(findEffect(getClip(out.project, "solid")!, "opacity")?.links).toBeUndefined();
    expect(() => EDITS.delete_signal(out.project, { signals: ["Flash"] }, env)).toThrow(/no signal "Flash"/);
  });
});

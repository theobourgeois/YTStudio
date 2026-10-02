import { describe, expect, it } from "vitest";
import { compileSong, faderGain, levelGain, mixerPanGains, panGains, soundingChannels, stereoGains, swungTick, trackOrder } from "./compile.ts";
import { addChannels, addPattern, addPluginChannel, setMainVolume, setPatternLength, setStepNote, setSteps, setSwing, setTempo, setTimeSignature, updateChannel } from "./edits.ts";
import { editNotes, setNoteProps } from "./notes.ts";
import { addMixerTracks, routeChannels, sendOnly, setEffect, setSend, updateEffect, updateMixerTrack } from "./mixer.ts";
import { type NewClip, addAudioClips, addClips, editClips, sliceClips, soloTrack } from "./playlist.ts";
import { DEFAULT_VOLUME, FIRST_PATTERN_ID, MASTER_TRACK_ID, createMusicProject } from "./project.ts";
import { controlAt, createAutomation, editPoints, updateAutomation } from "./automation.ts";

const P = FIRST_PATTERN_ID;
const rack = () =>
  addChannels(createMusicProject("Beat"), [
    { id: "chan_kick", name: "Kick", sampleId: "media_kick" },
    { id: "chan_hat", name: "Hat", sampleId: "media_hat" },
  ]);

describe("compileSong", () => {
  it("gives the engine the loop: tempo, length, and every note in order", () => {
    let song = setTempo(rack(), 140);
    song = setSteps(song, P, "chan_hat", [2, 0], true);
    song = setSteps(song, P, "chan_kick", [0, 8], true);
    const compiled = compileSong(song, P);
    expect(compiled).toMatchObject({ tempo: 140, ppq: 96, loopTicks: 384, beatTicks: 96, barTicks: 384 });
    expect(compiled.channels.map((c) => c.sample)).toEqual(["media_kick", "media_hat"]);
    expect(compiled.notes.map((n) => [n.tick, n.channel])).toEqual([
      [0, 0],
      [0, 1],
      [48, 1],
      [192, 0],
    ]);
    expect(compiled.notes[0]).toEqual({ channel: 0, tick: 0, length: 24, pitch: 0, gain: 1, key: 60, velocity: 0.78, pan: 0 });
  });

  it("plays the pattern asked for, or the first", () => {
    let song = addPattern(rack(), { id: "pat_2" });
    song = setSteps(song, "pat_2", "chan_kick", [20], true);
    expect(compileSong(song, "pat_2")).toMatchObject({ loopTicks: 768, notes: [{ tick: 480 }] });
    expect(compileSong(song, "pat_none").notes).toEqual([]);
    expect(compileSong(song, null).loopTicks).toBe(384);
  });

  it("loops a pattern over its length: automatic (the bars with notes), or set, but never leaving notes out", () => {
    const song = setSteps(rack(), P, "chan_kick", [0, 20, 40], true);
    // Three bars of notes loop over four (Auto rounds up to two bars); a set length only to their bar.
    expect(compileSong(song, P)).toMatchObject({ loopTicks: 64 * 24, notes: [{ tick: 0 }, { tick: 480 }, { tick: 960 }] });
    const short = compileSong(setPatternLength(song, P, 24), P);
    expect(short.loopTicks).toBe(48 * 24);
    expect(short.notes.map((n) => n.tick)).toEqual([0, 480, 960]);
    expect(compileSong(setPatternLength(setSteps(rack(), P, "chan_kick", [0, 20], true), P, 24), P).loopTicks).toBe(24 * 24);
    expect(compileSong(setPatternLength(song, P, 64), P).loopTicks).toBe(64 * 24);
  });

  it("plays only a part of the pattern when asked (the time selection), counting from its start", () => {
    const song = setSteps(rack(), P, "chan_kick", [0, 4, 8, 12], true);
    const part = compileSong(song, P, { start: 96, end: 288 });
    expect(part).toMatchObject({ loopTicks: 192, offsetTicks: 96 });
    expect(part.notes.map((n) => n.tick)).toEqual([0, 96]);
    // A range that's no range plays the whole pattern.
    expect(compileSong(song, P, { start: 96, end: 96 })).toMatchObject({ loopTicks: 384, offsetTicks: 0 });
  });

  it("leaves muted notes out, and passes each note's pan on", () => {
    let song = setSteps(rack(), P, "chan_kick", [0, 4], true);
    song = editNotes(song, P, "chan_kick", (notes) => setNoteProps(setNoteProps(notes, new Set([notes[0].id]), { muted: true }), new Set([notes[1].id]), { pan: -0.5 }));
    expect(compileSong(song, P).notes).toMatchObject([{ tick: 96, pan: -0.5 }]);
  });

  it("passes on cut self and what's done to the sample, when anything is", () => {
    const song = rack();
    expect(compileSong(song, P).channels[0]).toMatchObject({ cutSelf: false, precomputed: null });
    const edited = updateChannel(song, "chan_kick", { cutSelf: true, precomputed: { reverse: true, fadeOut: 0.5 } });
    expect(compileSong(edited, P).channels[0]).toMatchObject({
      cutSelf: true,
      precomputed: { normalize: false, reverse: true, start: 0, length: 1, fadeIn: 0, fadeOut: 0.5 },
    });
  });

  it("plays a plugin channel's notes as MIDI notes with a velocity", () => {
    let song = addPluginChannel(rack(), { id: "VST3-Synth-1", name: "Synth", format: "VST3" }, "chan_synth");
    song = setSteps(song, P, "chan_synth", [4], true);
    song = setStepNote(song, P, "chan_synth", 4, { pitch: 64, velocity: 0.5 });
    const compiled = compileSong(song, P);
    expect(compiled.channels[2]).toMatchObject({ id: "chan_synth", sample: null, plugin: { id: "VST3-Synth-1", state: "" }, gainLeft: 1, gainRight: 1 });
    expect(compiled.channels[0].plugin).toBeNull();
    expect(compiled.notes[0]).toMatchObject({ channel: 2, tick: 96, length: 24, key: 64, velocity: 0.5 });
    // Its PITCH moves the keys it's sent, by whole semitones, within MIDI's.
    expect(compileSong(updateChannel(song, "chan_synth", { pitch: -12.4 }), P).notes[0].key).toBe(52);
    expect(compileSong(updateChannel(setStepNote(song, P, "chan_synth", 4, { pitch: 120 }), "chan_synth", { pitch: 24 }), P).notes[0].key).toBe(127);
  });

  it("turns volume, pan, mute and velocity into gains", () => {
    expect(levelGain(0.78, 0.78)).toBe(1);
    expect(levelGain(0, 0.78)).toBe(0);
    expect(levelGain(1, 0.78)).toBeCloseTo(1.64, 2);
    expect(panGains(0)).toEqual([1, 1]);
    expect(panGains(-1)).toEqual([1, 0]);
    expect(panGains(0.5)).toEqual([0.5, 1]);

    let song = setSteps(rack(), P, "chan_kick", [0], true);
    song = setStepNote(song, P, "chan_kick", 0, { velocity: 0.39, pitch: 67 });
    song = updateChannel(song, "chan_kick", { pan: 1, pitch: -12, envelope: { enabled: true, release: 0.3 } });
    song = updateChannel(song, "chan_hat", { muted: true });
    const compiled = compileSong(song, P);
    expect(compiled.channels[0]).toMatchObject({ gainLeft: 0, gainRight: 1, pitch: -12, envelope: { attack: 0, decay: 0.2, sustain: 1, release: 0.3 } });
    expect(compiled.channels[1]).toMatchObject({ gainLeft: 0, gainRight: 0, envelope: null });
    expect(compiled.notes[0]).toMatchObject({ pitch: 7, gain: 0.25 });
  });

  it("swings every second step late, up to half a step", () => {
    expect(swungTick(24, 1)).toBe(36);
    expect(swungTick(24, 0)).toBe(24);
    expect(swungTick(48, 1)).toBe(48);
    const song = setSwing(setSteps(rack(), P, "chan_hat", [0, 1, 2, 3], true), 0.5);
    expect(compileSong(song, P).notes.map((n) => n.tick)).toEqual([0, 30, 48, 78]);
  });

  it("counts beats and bars by the time signature", () => {
    expect(compileSong(setTimeSignature(rack(), [6, 8]), P)).toMatchObject({ beatTicks: 48, barTicks: 288 });
    expect(compileSong(setTimeSignature(rack(), [3, 4]), P)).toMatchObject({ beatTicks: 96, barTicks: 288 });
  });
});

describe("the mixer, compiled", () => {
  const order = (song: ReturnType<typeof rack>) => compileSong(song, P).tracks.map((t) => t.id);

  it("runs every track after those sending to it, otherwise in the mixer's order, and the master last", () => {
    const song = rack();
    expect(order(song)).toEqual([...song.mixer.tracks.slice(1).map((t) => t.id), MASTER_TRACK_ID]);
    // 1 → 3 → 2: 2 has to wait for 3, which waits for 1.
    let routed = sendOnly(song, "insert_1", "insert_3");
    routed = sendOnly(routed, "insert_3", "insert_2");
    expect(order(routed).slice(0, 3)).toEqual(["insert_1", "insert_3", "insert_2"]);
    const compiled = compileSong(routed, P);
    const at = (id: string) => compiled.tracks.findIndex((t) => t.id === id);
    expect(compiled.tracks[at("insert_1")].sends).toEqual([{ track: at("insert_3"), gain: 1 }]);
    expect(compiled.tracks[at("insert_2")].sends).toEqual([{ track: at(MASTER_TRACK_ID), gain: 1 }]);
    expect(compiled.tracks.at(-1)).toMatchObject({ id: MASTER_TRACK_ID, name: "Master", sends: [] });
    // Every send goes to a later track.
    for (const [i, track] of compiled.tracks.entries()) for (const send of track.sends) expect(send.track).toBeGreaterThan(i);
  });

  it("orders 500 tracks in a long chain quickly", () => {
    let song = addMixerTracks(rack(), null, 484);
    const tracks = song.mixer.tracks;
    for (let i = tracks.length - 1; i > 1; i--) song = sendOnly(song, tracks[i].id, tracks[i - 1].id);
    const started = performance.now();
    const ordered = trackOrder(song.mixer.tracks);
    expect(performance.now() - started).toBeLessThan(100);
    expect(ordered.map((t) => t.id)).toEqual([...tracks.slice(1).reverse().map((t) => t.id), MASTER_TRACK_ID]);
  });

  it("turns the main volume (the toolbar's knob) into the master's gain, after its fader", () => {
    const master = (song: ReturnType<typeof rack>) => compileSong(song, P).tracks.at(-1)!.gains;
    expect(master(rack())).toEqual([1, 0, 0, 1]);
    const quieter = master(setMainVolume(rack(), DEFAULT_VOLUME / 2));
    expect(quieter[0]).toBeCloseTo(0.25, 6);
    expect(quieter[3]).toBeCloseTo(0.25, 6);
    expect(master(setMainVolume(rack(), 0))[0]).toBe(0);
    // Only the master's: the other tracks are as they were.
    expect(compileSong(setMainVolume(rack(), 0), P).tracks[0].gains).toEqual([1, 0, 0, 1]);
  });

  it("sends each channel into its track", () => {
    const song = routeChannels(rack(), ["chan_hat"], "insert_2");
    const compiled = compileSong(song, P);
    expect(compiled.channels.map((c) => compiled.tracks[c.track].id)).toEqual([MASTER_TRACK_ID, "insert_2"]);
  });

  it("turns the fader, pan and mute into a track's gains, and a send's level into its gain", () => {
    expect(faderGain(0.8)).toBe(1);
    expect(faderGain(0)).toBe(0);
    expect(20 * Math.log10(faderGain(1))).toBeCloseTo(5.8, 1);
    expect(mixerPanGains(0)).toEqual([1, 0, 0, 1]);
    // Fully right: both sides on the right.
    expect(mixerPanGains(1).map((g) => Math.round(g * 1000) / 1000)).toEqual([0, 0, 1, 1]);
    expect(mixerPanGains(-1).map((g) => Math.round(g * 1000) / 1000)).toEqual([1, 1, 0, 0]);
    // Halfway: the left side is a centred mono sound, -3 dB on each side.
    expect(mixerPanGains(0.5)[0]).toBeCloseTo(Math.SQRT1_2, 6);

    let song = updateMixerTrack(rack(), "insert_1", { volume: 0.4, pan: 1 });
    song = updateMixerTrack(song, "insert_2", { muted: true });
    song = setSend(song, "insert_1", "insert_3", 0.5);
    const compiled = compileSong(song, P);
    const track = (id: string) => compiled.tracks.find((t) => t.id === id)!;
    const one = track("insert_1");
    expect(one.gains.map((g) => Math.round(g * 1000) / 1000)).toEqual([0, 0, 0.125, 0.125]);
    expect(one.sends.map((s) => s.gain)).toEqual([1, 0.25]);
    expect(track("insert_2").gains).toEqual([0, 0, 0, 0]);
  });

  it("inverts, swaps and narrows or widens a track's sound before its fader and pan", () => {
    const plain = { invert: false, swap: false, stereo: 0 };
    expect(stereoGains(plain)).toEqual([1, 0, 0, 1]);
    expect(stereoGains({ ...plain, invert: true })).toEqual([-1, 0, 0, -1]);
    expect(stereoGains({ ...plain, swap: true })).toEqual([0, 1, 1, 0]);
    // Narrowed all the way: both sides are their average (mono); widened all the way, the difference doubles.
    expect(stereoGains({ ...plain, stereo: 1 })).toEqual([0.5, 0.5, 0.5, 0.5]);
    expect(stereoGains({ ...plain, stereo: -1 })).toEqual([1.5, -0.5, -0.5, 1.5]);
    // Swapped, then narrowed halfway.
    expect(stereoGains({ ...plain, swap: true, stereo: 0.5 })).toEqual([0.25, 0.75, 0.75, 0.25]);

    // Then the pan: swapped and panned hard right, the left side (now on the right) and the right both end up right.
    const song = updateMixerTrack(updateMixerTrack(rack(), "insert_1", { swap: true, pan: 1 }), "insert_2", { invert: true });
    const tracks = compileSong(song, P).tracks;
    expect(tracks[0].gains.map((g) => Math.round(g * 1000) / 1000)).toEqual([0, 0, 1, 1]);
    expect(tracks[1].gains.map((g) => g + 0)).toEqual([-1, 0, 0, -1]);
  });

  it("lists each track's effects in order, bypassed ones too, without empty slots", () => {
    let song = setEffect(rack(), "insert_1", 3, { id: "VST3-Pro-Q", name: "Pro-Q", format: "VST3" }, "fx_eq");
    song = setEffect(song, "insert_1", 1, { id: "AU-EchoBoy", name: "EchoBoy", format: "AudioUnit" }, "fx_echo");
    song = updateEffect(song, "insert_1", 1, { enabled: false, mix: 0.4 });
    song = updateMixerTrack(song, "insert_1", { name: "Lead" });
    expect(compileSong(song, P).tracks[0]).toMatchObject({
      id: "insert_1",
      name: "Lead",
      effects: [
        { id: "fx_echo", plugin: { id: "AU-EchoBoy", state: "" }, enabled: false, mix: 0.4 },
        { id: "fx_eq", plugin: { id: "VST3-Pro-Q", state: "" }, enabled: true, mix: 1 },
      ],
    });
  });
});

describe("inputs, compiled", () => {
  it("give an insert's device channels, heard while armed (FL's default), always or never, and armed only when the tab says", () => {
    let song = updateMixerTrack(rack(), "insert_1", { input: { channel: 0, stereo: false } });
    song = updateMixerTrack(song, "insert_2", { input: { channel: 2, stereo: true }, monitor: "on" });
    song = updateMixerTrack(song, "insert_3", { input: { channel: 1, stereo: false }, monitor: "off" });
    const inputs = (armed: string[]) => Object.fromEntries(compileSong(song, P, null, "pattern", undefined, new Set(armed)).tracks.map((t) => [t.id, t.input]));
    expect(inputs([])).toMatchObject({
      insert_1: { channels: [0], monitor: false, armed: false },
      insert_2: { channels: [2, 3], monitor: true, armed: false },
      insert_3: { channels: [1], monitor: false, armed: false },
      insert_4: null,
      [MASTER_TRACK_ID]: null,
    });
    expect(inputs(["insert_1", "insert_3", MASTER_TRACK_ID])).toMatchObject({
      insert_1: { channels: [0], monitor: true, armed: true },
      insert_3: { channels: [1], monitor: false, armed: true },
      [MASTER_TRACK_ID]: null,
    });
  });
});

describe("soundingChannels", () => {
  it("are the unmuted channels with a note sounding at a tick, at least a step long, swung", () => {
    let song = setSteps(rack(), P, "chan_kick", [0, 4], true);
    song = setSteps(song, P, "chan_hat", [1], true);
    const at = (tick: number, s = song) => [...soundingChannels(s, s.patterns[0], tick)].sort();
    expect(at(0)).toEqual(["chan_kick"]);
    expect(at(30)).toEqual(["chan_hat"]);
    expect(at(60)).toEqual([]);
    expect(at(100)).toEqual(["chan_kick"]);
    // Swing moves the hat later.
    const swung = setSwing(song, 1);
    expect(at(30, swung)).toEqual([]);
    expect(at(50, swung)).toEqual(["chan_hat"]);
    expect(at(0, updateChannel(song, "chan_kick", { muted: true }))).toEqual([]);
  });
});

describe("compileSong in song mode", () => {
  const BAR = 384;
  /** The kick on every beat of a one-bar pattern, the hat on the off-beats of a second. */
  const beat = () => {
    let song = addPattern(rack(), { id: "pat_hat", name: "Hats" });
    song = setSteps(song, P, "chan_kick", [0, 4, 8, 12], true);
    song = setSteps(song, "pat_hat", "chan_hat", [2, 6, 10, 14], true);
    return song;
  };
  const place = (song: ReturnType<typeof beat>, clips: NewClip[]) => editClips(song, (list) => addClips(list, clips).clips);
  const ticks = (compiled: ReturnType<typeof compileSong>) => compiled.notes.map((n) => [n.tick, n.channel]);

  it("plays the playlist: each clip's pattern where it is, to the end of the last clip's bar", () => {
    const song = place(beat(), [
      { kind: "pattern", ref: P, track: 0, start: 0 },
      { kind: "pattern", ref: "pat_hat", track: 1, start: BAR },
    ]);
    const compiled = compileSong(song, P, null, "song");
    expect(compiled).toMatchObject({ loopTicks: 2 * BAR, offsetTicks: 0, audioClips: [] });
    expect(ticks(compiled)).toEqual([
      [0, 0],
      [96, 0],
      [192, 0],
      [288, 0],
      [BAR + 48, 1],
      [BAR + 144, 1],
      [BAR + 240, 1],
      [BAR + 336, 1],
    ]);
    // An empty playlist is a silent bar.
    expect(compileSong(beat(), P, null, "song")).toMatchObject({ loopTicks: BAR, notes: [] });
  });

  it("plays a clip's window of its pattern, and nothing past the pattern's end (Théo)", () => {
    // From the second beat, two bars long: three kicks, then a bar and a quarter of nothing.
    const song = place(beat(), [{ kind: "pattern", ref: P, track: 0, start: BAR, offset: 96, length: 2 * BAR }]);
    const compiled = compileSong(song, P, null, "song");
    expect(compiled.loopTicks).toBe(3 * BAR);
    expect(ticks(compiled)).toEqual([
      [BAR, 0],
      [BAR + 96, 0],
      [BAR + 192, 0],
    ]);
  });

  it("cuts notes off at a clip's end, and plays one a slice went through from the slice", () => {
    let song = rack();
    song = editNotes(song, P, "chan_kick", () => [{ id: 1, start: 0, length: 300, pitch: 60, velocity: 0.78, pan: 0, muted: false }]);
    song = place(song, [
      { kind: "pattern", ref: P, track: 0, start: 0, length: 96 },
      { kind: "pattern", ref: P, track: 1, start: BAR, offset: 100, length: 284 },
    ]);
    expect(compileSong(song, P, null, "song").notes.map((n) => [n.tick, n.length])).toEqual([
      [0, 96],
      [BAR, 200],
    ]);
  });

  it("leaves out muted clips and the clips of muted tracks (solo is a state of those)", () => {
    let song = place(beat(), [
      { kind: "pattern", ref: P, track: 0, start: 0 },
      { kind: "pattern", ref: "pat_hat", track: 1, start: 0, muted: true },
      { kind: "pattern", ref: "pat_hat", track: 2, start: 0 },
    ]);
    expect(compileSong(song, P, null, "song").notes.filter((n) => n.channel === 1)).toHaveLength(4);
    song = soloTrack(song, 0);
    expect(compileSong(song, P, null, "song").notes.map((n) => n.channel)).toEqual([0, 0, 0, 0]);
  });

  it("swings each pattern's own off-steps, wherever its clip is", () => {
    const hats = setSteps(beat(), "pat_hat", "chan_hat", [1], true);
    const song = setSwing(place(hats, [{ kind: "pattern", ref: "pat_hat", track: 0, start: 24 }]), 1);
    // The hat's second step (an off-step) is half a step late, the third (on the beat's half) isn't.
    expect(compileSong(song, P, null, "song").notes.slice(0, 2).map((n) => n.tick)).toEqual([24 + 24 + 12, 24 + 48]);
  });

  it("plays only the time selection, counting from its start", () => {
    const song = place(beat(), [
      { kind: "pattern", ref: P, track: 0, start: 0 },
      { kind: "pattern", ref: P, track: 0, start: BAR },
    ]);
    const part = compileSong(song, P, { start: 288, end: BAR + 192 }, "song");
    expect(part).toMatchObject({ loopTicks: 288, offsetTicks: 288 });
    expect(part.notes.map((n) => n.tick)).toEqual([0, 96, 192]);
  });

  it("plays audio clips from their channel's file, streamed, at their offset", () => {
    // At 120 BPM, a bar is two seconds.
    const { song } = addAudioClips(setTempo(rack(), 120), [{ name: "Vocal", sampleId: "media_vox", seconds: 4, channelId: "chan_vox" }], { start: BAR, track: 2 });
    const sliced = editClips(song, (clips, ctx) => sliceClips(clips, 2 * BAR, 0, 5, ctx).clips);
    const compiled = compileSong(sliced, P, null, "song");
    expect(compiled.channels[2]).toMatchObject({ id: "chan_vox", sample: "media_vox", stream: true, precomputed: null, envelope: null });
    expect(compiled.channels[0].stream).toBe(false);
    expect(compiled.audioClips).toEqual([
      { channel: 2, tick: BAR, length: BAR, seconds: 0, speed: 1 },
      { channel: 2, tick: 2 * BAR, length: BAR, seconds: 2, speed: 1 },
    ]);
    // A loop starting inside a clip: the clip began before it (its tick is negative).
    expect(compileSong(sliced, P, { start: BAR + 96, end: 3 * BAR }, "song").audioClips[0]).toEqual({ channel: 2, tick: -96, length: BAR, seconds: 0, speed: 1 });
    // Pitched an octave up, the channel plays its file twice as fast (FL's Resample).
    const up = compileSong(updateChannel(sliced, "chan_vox", { pitch: 12 }), P, null, "song");
    expect(up.audioClips.map((c) => c.speed)).toEqual([2, 2]);
    // Pattern mode plays none.
    expect(compileSong(sliced, P).audioClips).toEqual([]);
  });

  it("flattens a long arrangement quickly", () => {
    let song = setSteps(rack(), P, "chan_hat", Array.from({ length: 16 }, (_, i) => i), true);
    song = place(song, Array.from({ length: 1000 }, (_, i) => ({ kind: "pattern" as const, ref: P, track: i % 10, start: Math.floor(i / 10) * BAR })));
    const started = performance.now();
    const compiled = compileSong(song, P, null, "song");
    expect(compiled.notes).toHaveLength(16_000);
    expect(performance.now() - started).toBeLessThan(400);
  });
});

describe("automation", () => {
  const BAR = 384;
  /** The Kick's volume automated: from 0 to full over a bar, starting at bar 2, and a pattern clip so the song has length. */
  function automated() {
    let song = editClips(rack(), (clips) => addClips(clips, [{ kind: "pattern", ref: P, track: 0, start: 0, length: BAR * 4 }]).clips);
    const made = createAutomation(song, { kind: "channel", channel: "chan_kick", control: "volume" }, { start: BAR, length: BAR }, { id: "auto_vol" });
    song = editPoints(made.song, "auto_vol", () => [
      { tick: 0, value: 0, tension: 0, curve: "single" },
      { tick: BAR, value: 1, tension: 0, curve: "single" },
    ]);
    return song;
  }
  /** A lane's values at a tick, as the engine draws them (straight lines, the later of two points on one tick). */
  function laneAt(lane: { ticks: number[]; values: number[] }, size: number, tick: number): number[] {
    let i = 0;
    while (i + 1 < lane.ticks.length && lane.ticks[i + 1] <= tick) i++;
    const at = (k: number) => lane.values.slice(k * size, k * size + size);
    if (i + 1 >= lane.ticks.length || tick <= lane.ticks[i]) return at(i);
    const f = (tick - lane.ticks[i]) / (lane.ticks[i + 1] - lane.ticks[i]);
    return at(i).map((v, c) => v + (at(i + 1)[c] - v) * f);
  }

  it("plays only in song mode", () => {
    const song = automated();
    expect(compileSong(song, P).lanes).toEqual([]);
    expect(compileSong(song, P, null, "song").lanes).toHaveLength(1);
  });

  it("is the control's own value before the clip, the curve on it, the last value after: in the channel's gains", () => {
    const song = automated();
    const [lane] = compileSong(song, P, null, "song").lanes;
    expect(lane.target).toEqual({ kind: "channel", channel: 0 });
    const own = levelGain(DEFAULT_VOLUME, DEFAULT_VOLUME);
    expect(laneAt(lane, 2, 0)).toEqual([own, own]);
    // The jump to the clip's first value, at its start.
    expect(laneAt(lane, 2, BAR - 0.01)[0]).toBeCloseTo(own);
    expect(laneAt(lane, 2, BAR)[0]).toBeCloseTo(0);
    for (const at of [1.1, 1.25, 1.5, 1.77, 1.99]) expect(laneAt(lane, 2, BAR * at)[0]).toBeCloseTo(levelGain(at - 1, DEFAULT_VOLUME), 2);
    expect(laneAt(lane, 2, BAR * 3)[0]).toBeCloseTo(levelGain(1, DEFAULT_VOLUME));
    // Straight stretches are two points, not hundreds.
    expect(lane.ticks.length).toBeLessThan(80);
  });

  it("counts from the loop's start, and leaves out controls held by the hand", () => {
    const song = automated();
    const [lane] = compileSong(song, P, { start: BAR, end: BAR * 2 }, "song").lanes;
    expect(lane.ticks[0]).toBe(0);
    expect(laneAt(lane, 2, BAR / 2)[0]).toBeCloseTo(levelGain(0.5, DEFAULT_VOLUME), 2);
    expect(compileSong(song, P, null, "song", new Set(["channel:chan_kick:volume"])).lanes).toEqual([]);
  });

  it("leaves a held control at its own value inside a lane other controls still drive", () => {
    let song = automated();
    song = createAutomation(song, { kind: "channel", channel: "chan_kick", control: "pan" }, { start: 0, length: BAR * 4 }, { id: "auto_pan", value: 0.5 }).song;
    const [lane] = compileSong(song, P, null, "song", new Set(["channel:chan_kick:volume"])).lanes;
    // The pan's clip still plays; the volume is the hand's (its own 78%: the sample as it is), not the curve's 0 at bar 2.
    expect(laneAt(lane, 2, BAR)).toEqual([1, 1]);
  });

  it("makes one lane of a channel's volume and pan, and a track's matrix of its fader, pan and the main volume", () => {
    let song = automated();
    song = createAutomation(song, { kind: "channel", channel: "chan_kick", control: "pan" }, { start: 0, length: BAR }, { id: "auto_pan", value: 1 }).song;
    song = createAutomation(song, { kind: "main" }, { start: 0, length: BAR }, { id: "auto_main", value: 0 }).song;
    const lanes = compileSong(song, P, null, "song").lanes;
    expect(lanes.map((l) => l.target)).toEqual([{ kind: "channel", channel: 0 }, { kind: "track", track: 16 }]);
    // Panned hard right: no left.
    expect(laneAt(lanes[0], 2, 10)).toEqual([0, levelGain(DEFAULT_VOLUME, DEFAULT_VOLUME)]);
    // The main volume at 0 silences the master.
    expect(laneAt(lanes[1], 4, 10)).toEqual([0, 0, 0, 0]);
  });

  it("drives a send's gain and an effect's mix, by their place in the engine's lists", () => {
    let song = automated();
    song = setSend(song, "insert_1", "insert_2", 1);
    song = setEffect(song, "insert_1", 3, { id: "VST3-a", name: "A", format: "VST3" }, "fx_a");
    song = createAutomation(song, { kind: "send", track: "insert_1", to: "insert_2" }, { start: 0, length: BAR }, { id: "auto_send", value: 0.5 }).song;
    song = createAutomation(song, { kind: "effect", effect: "fx_a" }, { start: 0, length: BAR }, { id: "auto_mix", value: 0.25 }).song;
    const compiled = compileSong(song, P, null, "song");
    const send = compiled.lanes.find((l) => l.target.kind === "send")!;
    const track = compiled.tracks.findIndex((t) => t.id === "insert_1");
    expect(send.target).toEqual({ kind: "send", track, send: compiled.tracks[track].sends.findIndex((s) => s.track === compiled.tracks.findIndex((t) => t.id === "insert_2")) });
    expect(laneAt(send, 1, 0)).toEqual([levelGain(0.5, 1)]);
    const mix = compiled.lanes.find((l) => l.target.kind === "mix")!;
    expect(mix.target).toEqual({ kind: "mix", track, effect: 0 });
    expect(laneAt(mix, 1, 0)).toEqual([0.25]);
  });

  it("leaves a plugin its own value (-1) before any clip of its parameter", () => {
    let song = addPluginChannel(automated(), { id: "VST3-synth", name: "Synth", format: "VST3" }, "chan_synth");
    const target = { kind: "plugin", owner: "channel", id: "chan_synth", param: "cutoff", index: 4, name: "Cutoff" } as const;
    song = createAutomation(song, target, { start: BAR * 2, length: BAR }, { id: "auto_cut", value: 0.3 }).song;
    const lane = compileSong(song, P, null, "song").lanes.find((l) => l.target.kind === "param")!;
    expect(lane.target).toEqual({ kind: "param", owner: "channel", id: "chan_synth", param: "cutoff", index: 4 });
    expect(laneAt(lane, 1, BAR)).toEqual([-1]);
    expect(laneAt(lane, 1, BAR * 2)[0]).toBeCloseTo(0.3);
    expect(laneAt(lane, 1, BAR * 3.5)[0]).toBeCloseTo(0.3);
  });

  it("draws curves within a thousandth of what they are, steps and LFOs too", () => {
    let song = automated();
    song = editPoints(song, "auto_vol", () => [
      { tick: 0, value: 0, tension: 0, curve: "single" },
      { tick: 96, value: 1, tension: 0.8, curve: "double" },
      { tick: 192, value: 0.2, tension: 0, curve: "stairs" },
      { tick: 288, value: 0.9, tension: 0.3, curve: "wave" },
    ]);
    song = updateAutomation(song, "auto_vol", { lfo: { enabled: true, speed: 3, level: 0.4 } });
    const [lane] = compileSong(song, P, null, "song").lanes;
    const exact = (tick: number) => levelGain(controlAt(song, { kind: "channel", channel: "chan_kick", control: "volume" }, tick)!, DEFAULT_VOLUME);
    for (let tick = BAR; tick < BAR * 2; tick += 0.37) {
      // Within a thousandth of what it is within the lane's finest look (an eighth of a tick: a corner, a step).
      const near = [-0.125, -0.0625, 0, 0.0625, 0.125].map((d) => exact(tick + d));
      const drawn = laneAt(lane, 2, tick)[0];
      expect(drawn).toBeGreaterThan(Math.min(...near) - 1e-3);
      expect(drawn).toBeLessThan(Math.max(...near) + 1e-3);
    }
  });

  it("bends a sampler's pitch in semitones, and moves a plugin channel's notes by whole ones where each starts", () => {
    let song = automated();
    const kickPitch = createAutomation(song, { kind: "channel", channel: "chan_kick", control: "pitch" }, { start: 0, length: BAR }, { id: "auto_pitch" });
    // Up an octave across the bar (0.5 is no change: the knob's middle, ±24 semitones either side).
    song = editPoints(kickPitch.song, "auto_pitch", () => [
      { tick: 0, value: 0.5, tension: 0, curve: "single" },
      { tick: BAR, value: 0.75, tension: 0, curve: "single" },
    ]);
    const lane = compileSong(song, P, null, "song").lanes.find((l) => l.target.kind === "pitch")!;
    expect(lane.target).toEqual({ kind: "pitch", channel: 0 });
    expect(laneAt(lane, 1, 0)[0]).toBeCloseTo(0, 3);
    expect(laneAt(lane, 1, BAR / 2)[0]).toBeCloseTo(6, 2);
    expect(laneAt(lane, 1, BAR * 3)[0]).toBeCloseTo(12, 3);
    // Held by the hand: left out.
    expect(compileSong(song, P, null, "song", new Set(["channel:chan_kick:pitch"])).lanes.some((l) => l.target.kind === "pitch")).toBe(false);

    // A plugin channel: no lane; its notes' keys moved by what the pitch is where each starts, rounded.
    song = addPluginChannel(song, { id: "VST3-synth", name: "Synth", format: "VST3" }, "chan_synth");
    song = setSteps(song, P, "chan_synth", [0, 8], true);
    // The pattern every bar (a clip plays its pattern once).
    song = editClips(song, (clips) => addClips(clips, [1, 2, 3].map((bar) => ({ kind: "pattern" as const, ref: P, track: 1, start: BAR * bar }))).clips);
    const synthPitch = createAutomation(song, { kind: "channel", channel: "chan_synth", control: "pitch" }, { start: BAR, length: BAR }, { id: "auto_synth" });
    song = editPoints(synthPitch.song, "auto_synth", () => [{ tick: 0, value: 0.5 + 7 / 48, tension: 0, curve: "hold" }]);
    const compiled = compileSong(song, P, null, "song");
    expect(compiled.lanes.filter((l) => l.target.kind === "pitch")).toHaveLength(1);
    const keys = compiled.notes.filter((n) => n.channel === 2).map((n) => [n.tick, n.key]);
    // Bar 1 before the clip: its own pitch; from bar 2 a fifth up, and held there after.
    expect(keys.slice(0, 4)).toEqual([
      [0, 60],
      [BAR / 2, 60],
      [BAR, 67],
      [BAR * 1.5, 67],
    ]);
    expect(keys.at(-1)).toEqual([BAR * 3.5, 67]);
    // In pattern mode, none of it.
    expect(compileSong(song, P).notes.filter((n) => n.channel === 2).map((n) => n.key)).toEqual([60, 60]);
  });
});

describe("a sampler's own settings, compiled", () => {
  it("swings each channel by its share of the song's swing", () => {
    let song = setSwing(setSteps(rack(), P, "chan_kick", [1], true), 1);
    song = setSteps(song, P, "chan_hat", [1], true);
    song = updateChannel(song, "chan_hat", { swingMix: 0.5 });
    const ticks = compileSong(song, P).notes.map((n) => [n.channel, n.tick]);
    expect(ticks).toContainEqual([0, 24 + 12]);
    expect(ticks).toContainEqual([1, 24 + 6]);
  });

  it("sends a sampler's loop, filter and the envelopes and LFOs that are on; the filter's targets only with the filter", () => {
    let song = updateChannel(rack(), "chan_kick", {
      loop: { enabled: true, start: 0.1, end: 0.6 },
      mods: { cutoff: { envelope: { enabled: true } }, pitch: { lfo: { enabled: true, speed: 5 } }, volumeLfo: { enabled: true } },
    });
    let engine = compileSong(song, P).channels[0];
    expect(engine.loop).toMatchObject({ enabled: true, start: 0.1, end: 0.6 });
    expect(engine.filter).toBeUndefined();
    expect(Object.keys(engine.mods ?? {}).sort()).toEqual(["pitch", "volumeLfo"]);
    expect(engine.mods?.pitch).toEqual({ lfo: expect.objectContaining({ speed: 5 }) });
    song = updateChannel(song, "chan_kick", { filter: { type: "lowpass" } });
    engine = compileSong(song, P).channels[0];
    expect(engine.filter).toMatchObject({ type: "lowpass" });
    expect(engine.mods?.cutoff?.envelope).toMatchObject({ enabled: true });
    // A channel with none of it sends none of it.
    expect(compileSong(rack(), P).channels[0]).not.toHaveProperty("loop");
  });
});

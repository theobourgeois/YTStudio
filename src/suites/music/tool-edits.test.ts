import { describe, expect, it } from "vitest";
import { addChannels, stepString } from "@shared/music/edits";
import { FIRST_PATTERN_ID, createMusicProject } from "@shared/music/project";
import type { MediaAsset } from "@shared/types";
import { describeSong, songContext } from "./context";
import { addPatternTool, editStep, removeChannelTool, removePatternTool, setStepsTool, updateChannelTool, updatePatternTool, updateSong } from "./tool-edits";

const env = { patternId: FIRST_PATTERN_ID };
const rack = () =>
  addChannels(createMusicProject("Beat"), [
    { id: "chan_kick", name: "Kick", sampleId: "media_kick" },
    { id: "chan_hat", name: "Hat", sampleId: null },
  ]);
const asset = (id: string, name: string) => ({ id, name, hasAudio: true }) as MediaAsset;

describe("the assistant's song edits", () => {
  it("set the song's settings, refusing what can't be", () => {
    const { song, text } = updateSong(rack(), { tempo: 140, swing: 0.5, timeSignature: [6, 8] }, env);
    expect(song.settings).toEqual({ tempo: 140, swing: 0.5, timeSignature: [6, 8] });
    expect(text).toBe("The song is at 140 BPM in 6/8, swing 50%.");
    expect(() => updateSong(rack(), { tempo: 5 }, env)).toThrow(/from 20 to 999/);
    expect(() => updateSong(rack(), { timeSignature: [4, 5] }, env)).toThrow(/unit of 1, 2, 4/);
  });

  it("find a channel by id or by name, and say which exist when it isn't one", () => {
    const byName = setStepsTool(rack(), { channel: "kick", steps: "x--- x---" }, env);
    expect(stepString(byName.song.patterns[0], "chan_kick")).toBe("x---x---x---x---");
    expect(byName.text).toBe('"Kick" in "Pattern 1": x---x---x---x---');
    expect(() => setStepsTool(rack(), { channel: "snare", steps: "x" }, env)).toThrow(/The channels are: "Kick", "Hat"/);
    expect(() => setStepsTool(rack(), { channel: "chan_kick", steps: "  " }, env)).toThrow(/drawing/);
    expect(() => setStepsTool(rack(), { channel: "chan_kick", steps: "x", pattern: "Chorus" }, env)).toThrow(/The patterns are: "Pattern 1"/);
  });

  it("change a channel, and one step of it", () => {
    const changed = updateChannelTool(rack(), { channel: "Hat", volume: 0.5, pan: -0.25, muted: true, envelope: { enabled: true, release: 0.2 } }, env);
    expect(changed.song.channels[1]).toMatchObject({ volume: 0.5, pan: -0.25, muted: true, envelope: { enabled: true, release: 0.2, sustain: 1 } });
    expect(changed.text).toContain("volume 50%, pan 25% left, muted, envelope");
    expect(() => updateChannelTool(rack(), { channel: "Hat", volume: 3 }, env)).toThrow(/"volume" must be a number from 0 to 1/);

    const drawn = setStepsTool(rack(), { channel: "Hat", steps: "--x-" }, env).song;
    const step = editStep(drawn, { channel: "Hat", step: 3, velocity: 0.4, pitch: 12 }, env);
    expect(step.song.patterns[0].notes.chan_hat[0]).toMatchObject({ velocity: 0.4, pitch: 72 });
    expect(() => editStep(drawn, { channel: "Hat", step: 1, velocity: 0.4 }, env)).toThrow(/Step 1 of "Hat" is off \(its steps are --x---x---x---x-\)/);
    expect(() => editStep(drawn, { channel: "Hat", step: 99 }, env)).toThrow(/from 1 to 16/);
    expect(removeChannelTool(drawn, { channel: "Hat" }, env).song.channels.map((c) => c.name)).toEqual(["Kick"]);
  });

  it("add, change and remove patterns", () => {
    const added = addPatternTool(rack(), { name: "Fill", steps: 8 }, env);
    expect(added.song.patterns[1]).toMatchObject({ name: "Fill", steps: 8, id: added.showPattern });
    expect(updatePatternTool(added.song, { pattern: "Fill", steps: 32, name: "Long fill" }, env).text).toBe('The pattern "Long fill" is 32 steps long.');
    // Without a pattern, the one shown.
    expect(updatePatternTool(added.song, { steps: 32 }, env).song.patterns[0].steps).toBe(32);
    expect(removePatternTool(added.song, { pattern: "Fill" }, env).song.patterns).toHaveLength(1);
    expect(() => removePatternTool(rack(), { pattern: "Pattern 1" }, env)).toThrow(/at least one pattern/);
  });

  it("describe the song for the model: channels, every pattern's steps, spare files", () => {
    const song = setStepsTool(addPatternTool(rack(), { name: "Fill" }, env).song, { channel: "Kick", steps: "x---" }, env).song;
    const text = describeSong(song, [asset("media_kick", "kick.wav"), asset("media_snare", "snare.wav")], FIRST_PATTERN_ID);
    expect(text).toContain('Song: "Beat", 120 BPM, 4/4, swing 0%.');
    expect(text).toContain('- "Kick" (id chan_kick), sample kick.wav, volume 78%');
    expect(text).toContain('- "Hat" (id chan_hat), no sample (silent), volume 78%');
    expect(text).toContain(`- "Pattern 1" (id ${FIRST_PATTERN_ID}, 16 steps), shown in the rack: it's the one that plays\n    x---x---x---x---  Kick\n    ----------------  Hat`);
    expect(text).toContain("- snare.wav (mediaId media_snare)");
    expect(text).not.toContain("kick.wav (mediaId");
    expect(songContext(song, FIRST_PATTERN_ID)).toEqual({
      context: 'Song: "Beat", 120 BPM, 4/4, 2 channels (Kick, Hat). The channel rack shows the pattern "Pattern 1".',
      label: "120 BPM, 4/4",
    });
  });
});

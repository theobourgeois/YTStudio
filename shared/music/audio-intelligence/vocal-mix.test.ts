import { describe, expect, it } from "vitest";
import { createMusicProject } from "../project.ts";
import { addAudioClips } from "../playlist.ts";
import { addMixerTracks, updateMixerTrack } from "../mixer.ts";
import { acceptVocalAlternative, vocalAlternative, vocalRevision, VOCAL_VARIANTS, type VocalMixRun } from "./vocal-mix.ts";

const song = () => {
  const base = addAudioClips(addMixerTracks(createMusicProject(), null, 2, ["insert_vocal", "insert_beat"]),
    [{ channelId: "chan_vocal", name: "Vocal", sampleId: "media_vocal", seconds: 40 },
      { channelId: "chan_beat", name: "Instrumental", sampleId: "media_beat", seconds: 40 }], { start: 0, track: 0 }).song;
  return { ...base, channels: base.channels.map(c => ({ ...c, mixerTrack: c.id === "chan_vocal" ? "insert_vocal" : "insert_beat" })) };
};
const run = (base: ReturnType<typeof song>): VocalMixRun => ({ schema: 1, id: "mixrun_test", projectId: "proj_test", goal: "Vocal balance",
  vocalTrackId: "insert_vocal", baseSnapshotId: "snapshot_test", baseRevision: vocalRevision(base),
  passages: [{ startTick: 0, endTick: 1920 }, { startTick: 3840, endTick: 5760 }], status: "ready", error: null, createdAt: 0,
  candidates: VOCAL_VARIANTS.map(variant => ({ variant, snapshotId: "snapshot_test", renders: [0, 1].map(i => ({ jobId: `job_${i}`, analysisJobId: "analysis", artifactId: "audio", reportId: "report", auditionGainDb: -3, peakDbfs: -6, rmsDbfs: -20, fullScaleFraction: 0 })) })) });

describe("vocal candidate acceptance", () => {
  it("changes only the chosen vocal insert and leaves the instrumental, arrangement and baseline intact", () => {
    const base = song(), candidate = vocalAlternative(base, "insert_vocal", "presence", "mixrun_test");
    expect(candidate.channels).toBe(base.channels);
    expect(candidate.playlist).toBe(base.playlist);
    expect(candidate.mixer.tracks.find(t => t.id === "insert_beat")).toBe(base.mixer.tracks.find(t => t.id === "insert_beat"));
    expect(base.mixer.tracks.find(t => t.id === "insert_vocal")!.effects.every(e => e === null)).toBe(true);
    expect(vocalAlternative(base, "insert_vocal", "baseline", "mixrun_test")).toBe(base);
    expect(candidate.mixer.tracks.find(t => t.id === "insert_vocal")!.effects.filter(Boolean).map(e => e!.plugin.id)).toEqual(["vaudio:pro-c", "vaudio:pro-q"]);
  });
  it("rejects musical edits made while rendering, but permits a harmless song rename", () => {
    const base = song(), comparison = run(base);
    expect(() => acceptVocalAlternative(updateMixerTrack(base, "insert_beat", { pan: .2 }), comparison, "lift")).toThrow(/changed/);
    const renamed = { ...base, name: "New name" };
    expect(acceptVocalAlternative(renamed, comparison, "lift").name).toBe("New name");
  });
  it("requires both passage reports and refuses full-scale alternatives while retaining no-change", () => {
    const base = song(), comparison = run(base);
    comparison.candidates[1].renders[1].reportId = null;
    expect(() => acceptVocalAlternative(base, comparison, "lift")).toThrow(/Both passage/);
    comparison.candidates[1].renders[1].reportId = "report";
    comparison.candidates[1].renders[1].fullScaleFraction = .01;
    expect(() => acceptVocalAlternative(base, comparison, "lift")).toThrow(/headroom/);
    expect(acceptVocalAlternative(base, comparison, "baseline")).toBe(base);
  });
});

import { describe, expect, it } from "vitest";
import { compileSong } from "./compile.ts";
import { sendOnly, setMixerMuted, setMixerSolo, setSend, setSoloSafe } from "./mixer.ts";
import { MASTER_TRACK_ID, createMusicProject } from "./project.ts";
import { cutOffBy, hearing, heardMixer } from "./solo.ts";
import type { MusicProject } from "./types.ts";

/**
 * Inserts 1 and 2 (drums) go to bus 3, which goes to the master; insert 4 (bass) goes straight to the master;
 * insert 5 is a reverb return that 1 sends to as well; insert 6 sidechains to 4 (a send at 0).
 */
function routed(): MusicProject {
  let song = createMusicProject();
  song = sendOnly(song, "insert_1", "insert_3");
  song = sendOnly(song, "insert_2", "insert_3");
  song = setSend(song, "insert_1", "insert_5", 0.4);
  song = setSend(song, "insert_6", "insert_4", 0);
  return song;
}
const out = (song: MusicProject) => [...hearing(song.mixer)].filter(([, h]) => h.soloedOut).map(([id]) => id).slice(0, 7);
const silencedOf = (song: MusicProject) => out(song).filter((id) => ["insert_1", "insert_2", "insert_3", "insert_4", "insert_5", "insert_6"].includes(id));

describe("solo, following the routing", () => {
  it("keeps on a soloed track's buses on its way to the master, and nothing else that feeds them", () => {
    const song = setMixerSolo(routed(), ["insert_1"], true);
    // 1 is heard through bus 3 and its reverb 5; 2 (into the same bus), 4 and 6 are silenced.
    expect(silencedOf(song)).toEqual(["insert_2", "insert_4", "insert_6"]);
    const h = hearing(song.mixer);
    expect([h.get("insert_3")!.implied, h.get("insert_5")!.implied, h.get("insert_1")!.implied, h.get(MASTER_TRACK_ID)!.implied]).toEqual([true, true, false, false]);
  });

  it("keeps on every track feeding a soloed bus", () => {
    const song = setMixerSolo(routed(), ["insert_3"], true);
    expect(silencedOf(song)).toEqual(["insert_4", "insert_5", "insert_6"]);
  });

  it("doesn't count a sidechain (a send at 0) as a way for the sound", () => {
    const song = setMixerSolo(routed(), ["insert_4"], true);
    expect(silencedOf(song)).toContain("insert_6");
  });

  it("never silences a solo safe track, nor what it goes through", () => {
    let song = setSoloSafe(routed(), ["insert_5"], true);
    song = setMixerSolo(song, ["insert_4"], true);
    expect(silencedOf(song)).toEqual(["insert_1", "insert_2", "insert_3", "insert_6"]);
  });

  it("silences nothing when nothing is soloed, and says what's cut off further down", () => {
    const song = setMixerMuted(routed(), ["insert_3"], true);
    expect(silencedOf(song)).toEqual([]);
    const h = hearing(song.mixer);
    // 2 isn't muted, but its only way out (bus 3) is: it isn't heard. 1 still is, through its reverb.
    expect([h.get("insert_2")!.silent, h.get("insert_2")!.heard, h.get("insert_1")!.heard, h.get("insert_3")!.heard]).toEqual([false, false, true, false]);
  });

  it("is what's played: the tracks it silences are muted for the engine, the song's own mutes untouched", () => {
    const song = setMixerSolo(routed(), ["insert_1"], true);
    expect(heardMixer(routed())).toEqual(routed());
    expect(heardMixer(song).mixer.tracks.filter((t) => t.muted).map((t) => t.id).slice(0, 3)).toEqual(["insert_2", "insert_4", "insert_6"]);
    expect(song.mixer.tracks.some((t) => t.muted)).toBe(false);
    const gains = new Map(compileSong(song, null).tracks.map((t) => [t.id, t.gains.some((g) => g !== 0)]));
    expect([gains.get("insert_1"), gains.get("insert_2"), gains.get("insert_3"), gains.get("insert_4")]).toEqual([true, false, true, false]);
  });
});

describe("what cuts a track off", () => {
  it("is the first silent track on each of its ways out", () => {
    const song = setMixerMuted(routed(), ["insert_3"], true);
    expect(cutOffBy(song.mixer, "insert_2", hearing(song.mixer))).toEqual(["insert_3"]);
    // Heard (through its reverb), or silent itself: nothing.
    expect(cutOffBy(song.mixer, "insert_1", hearing(song.mixer))).toEqual([]);
    expect(cutOffBy(song.mixer, "insert_3", hearing(song.mixer))).toEqual([]);
    const master = setMixerMuted(routed(), [MASTER_TRACK_ID], true);
    expect(cutOffBy(master.mixer, "insert_2", hearing(master.mixer))).toEqual([MASTER_TRACK_ID]);
  });
});

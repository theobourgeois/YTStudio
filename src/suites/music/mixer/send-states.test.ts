import { describe, expect, it } from "vitest";
import { sendOnly, setSend } from "@shared/music/mixer";
import { MASTER_TRACK_ID, createMusicProject } from "@shared/music/project";
import { sendStates, sendToggle } from "./send-states";

const M = MASTER_TRACK_ID;

describe("the send row, for the selected tracks", () => {
  it("is the current track's alone when it's the only one selected", () => {
    const song = setSend(createMusicProject(), "insert_1", "insert_3", 0.5);
    const states = sendStates(song.mixer, ["insert_1"]);
    expect(states.get("insert_1")).toEqual({ kind: "source" });
    expect(states.get("insert_3")).toEqual({ kind: "sending", level: 0.5, owner: "insert_1", partial: false });
    expect(states.get(M)).toEqual({ kind: "sending", level: 1, owner: "insert_1", partial: false });
    expect(states.get("insert_2")).toEqual({ kind: "available" });
    // Insert 3 now gets insert 1's sound: it can't send back.
    expect(sendStates(song.mixer, ["insert_3"]).get("insert_1")).toEqual({ kind: "unavailable" });
  });

  it("says when only some of them send there, and shows the current track's level first", () => {
    let song = setSend(createMusicProject(), "insert_2", "insert_5", 0.3);
    song = setSend(song, "insert_1", "insert_5", 0.8);
    expect(sendStates(song.mixer, ["insert_1", "insert_2", "insert_3"]).get("insert_5")).toEqual({ kind: "sending", level: 0.8, owner: "insert_1", partial: true });
    expect(sendStates(song.mixer, ["insert_3", "insert_2", "insert_1"]).get("insert_5")).toEqual({ kind: "sending", level: 0.3, owner: "insert_2", partial: true });
    expect(sendStates(song.mixer, ["insert_1", "insert_2"]).get("insert_5")).toMatchObject({ partial: false });
  });

  it("leaves out the ones that can't send there: a loop isn't partial", () => {
    // Insert 4 feeds insert 2: insert 2 can't send to it, so insert 1 sending there is all that can.
    let song = sendOnly(createMusicProject(), "insert_4", "insert_2");
    song = setSend(song, "insert_1", "insert_4", 1);
    expect(sendStates(song.mixer, ["insert_1", "insert_2"]).get("insert_4")).toMatchObject({ kind: "sending", partial: false });
    expect(sendStates(song.mixer, ["insert_2", M]).get("insert_4")).toEqual({ kind: "unavailable" });
  });

  it("adds the missing sends on a click, and takes them all away once they're all there", () => {
    const song = setSend(createMusicProject(), "insert_1", "insert_5", 1);
    expect(sendToggle(song.mixer, ["insert_1", "insert_2", M], "insert_5")).toEqual({ remove: [], add: ["insert_2"] });
    const both = setSend(song, "insert_2", "insert_5", 1);
    expect(sendToggle(both.mixer, ["insert_1", "insert_2"], "insert_5")).toEqual({ remove: ["insert_1", "insert_2"], add: [] });
    expect(sendToggle(both.mixer, ["insert_1"], "insert_1")).toEqual({ remove: [], add: [] });
  });
});

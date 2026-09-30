import { createMusicProject, normalizeMusicProject } from "../../shared/music/project.ts";
import { isObject } from "../storage.ts";
import type { SuiteBackend } from "./suite.ts";

/** The music suite (a DAW): `MusicProject` documents (`shared/music/`). A shell for now. */
export const musicSuite: SuiteBackend<"music"> = {
  suite: "music",
  create: (name) => createMusicProject(name),
  normalize(doc) {
    if (!isObject(doc)) throw new Error("Not a song.");
    return normalizeMusicProject(doc);
  },
  stats: (doc) => ({ name: doc.name, duration: 0, tempo: doc.settings.tempo, coverAssetId: null }),
  // Songs don't use media yet.
  remapMedia: (doc) => doc,
  assistant: {
    context: "what the song is like at the moment they sent it",
    background: "nothing is selected",
    instructions: `\
Tools for a local music editor (a DAW, like Ableton Live or Logic). They act on the song open in the editor \
tab (unless you're told otherwise), live: the user sees every change as it happens.

The music editor is new: for now a song only has a name, a tempo and a time signature, and there are no \
tracks, clips, instruments or plugins yet. Use get_song to read it. If asked to make or change music, say \
plainly that the music editor can't do that yet.`,
  },
};

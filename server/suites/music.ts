import { createMusicProject, normalizeMusicProject } from "../../shared/music/project.ts";
import { isObject } from "../storage.ts";
import type { SuiteBackend } from "./suite.ts";

/** The music suite (a DAW): `MusicProject` documents (`shared/music/`), whose samples are the project's media. */
export const musicSuite: SuiteBackend<"music"> = {
  suite: "music",
  create: (name) => createMusicProject(name),
  normalize(doc, media) {
    if (!isObject(doc)) throw new Error("Not a song.");
    return normalizeMusicProject(doc, (id) => media[id]?.hasAudio === true);
  },
  stats: (doc) => ({ name: doc.name, duration: 0, tempo: doc.settings.tempo, coverAssetId: null }),
  remapMedia: (doc, ids) => ({
    ...doc,
    channels: doc.channels.map((c) => (c.sampleId ? { ...c, sampleId: ids.get(c.sampleId) ?? null } : c)),
  }),
  assistant: {
    context: "what the song is like at the moment they sent it",
    background: "nothing is selected",
    instructions: `\
Tools for a local music editor (a DAW that works like FL Studio). They act on the song open in the editor \
tab (unless you're told otherwise), live: the user sees and hears every change as it happens, and can undo it.

So far a song is a channel rack and patterns. A channel is a sampler playing one audio file, or an instrument \
plugin of the user's (a synth, whose sound is set in its own window, not by you); a pattern holds each \
channel's notes and loops while it plays. Drums are usually steps (set_steps: sixteenth notes drawn as text); \
melodies, chords and bass lines are notes (set_notes, get_notes: the Piano roll's). There's no playlist or \
mixer yet: if asked for those, say plainly that the music editor can't do that yet.

Start with get_song. To make a beat: add_channel for each sound (the starter kit has kick, clap, hat and \
snare), then set_steps to draw each channel's steps as text ("x---x---x---x---"). update_song sets the tempo \
and swing; edit_step changes one step's velocity or pitch; add_pattern makes another pattern. You can't hear \
the song: play_song starts it for the user, so ask them how it sounds rather than claiming it sounds good.`,
  },
};

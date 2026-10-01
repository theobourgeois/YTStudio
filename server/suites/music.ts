import { createMusicProject, normalizeMusicProject, withSongOptions } from "../../shared/music/project.ts";
import { isObject } from "../storage.ts";
import type { SuiteBackend } from "./suite.ts";

/** The music suite (a DAW): `MusicProject` documents (`shared/music/`), whose samples are the project's media. */
export const musicSuite: SuiteBackend<"music"> = {
  suite: "music",
  create: (name) => createMusicProject(name),
  withOptions: (doc, options) => withSongOptions(doc, options),
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

A song is a channel rack, patterns, a playlist and a mixer. A channel is a sampler playing one audio file, or an \
instrument plugin of the user's (a synth, whose sound is set in its own window, not by you); a pattern holds \
each channel's notes and loops while it plays. Drums are usually steps (set_steps: sixteenth notes drawn as \
text); melodies, chords and bass lines are notes (set_notes, get_notes: the Piano roll's).

The mixer is FL Studio's: every channel plays into a mixer track (the master unless routed: route_channels), \
and each track's sound goes through its effect plugins (add_mixer_effect, from list_plugins with kind \
"effect"; their settings are the user's, in the plugin's window), its fader and pan (update_mixer_track, \
levels in dB), then to the master and any tracks it sends to (set_send: a reverb bus is a track the others \
send to). get_mixer shows it all.

The playlist arranges the song (get_playlist): numbered tracks, bound to nothing, with clips on them. A pattern \
clip plays its pattern where it's placed (as long as the pattern unless resized; past its pattern it plays \
nothing); an audio clip plays an audio file (add_audio_clip: a vocal, a loop), streamed. place_clips arranges \
patterns by bar (repeat to fill a section), update_clips moves, resizes and mutes, slice_clips cuts, chop_clips chops into bars or beats, \
split_by_channel turns one pattern into one per channel (each on its own track), update_playlist_track names, \
colours, mutes and solos tracks. To arrange: build the parts as patterns, split the beat by channel if each \
part should come in on its own, then place them by section (intro, verse, drop...). play_song with mode "song" \
plays the arrangement, "pattern" loops the pattern shown.

The user's own samples are in the Browser: their sample folders, the same in every song. search_samples \
finds files by name ("808 kick", "vocal chop"), list_samples shows the folders, their favourites and what's \
in a folder; preview_sample plays one to them (you can't hear it), and load_sample puts files into the song, \
as new channels or as a sampler channel's sample. Prefer their samples to the starter kit when they have some.

Start with get_song. To make a beat: add_channel for each sound (the starter kit has kick, clap, hat and \
snare), then set_steps to draw each channel's steps as text ("x---x---x---x---"). update_song sets the tempo \
and swing; edit_step changes one step's velocity or pitch; add_pattern makes another pattern. You can't hear \
the song: play_song starts it for the user, so ask them how it sounds rather than claiming it sounds good.`,
  },
};

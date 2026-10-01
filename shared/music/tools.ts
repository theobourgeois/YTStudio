/**
 * The music suite's tools for AI agents (see `shared/tool-spec.ts`; handlers in
 * `src/suites/music/tools.ts`, their edits in `tool-edits.ts`). Add a tool with each feature.
 */
import { type ToolSpec, arr, bool, int, num, obj, oneOf, str, tool } from "../tool-spec.ts";

const channel = str('A channel: its id (from get_song) or its name ("Kick").');
const pattern = str("A pattern: its id or its name. Default: the pattern shown in the channel rack.");
const mixerTrack = (what = "A mixer track") =>
  ({ description: `${what}: its id, its number (0 or "M" is the master, 1 the first insert), "master", or its name ("Drums", "Insert 3").`, anyOf: [{ type: "string" }, { type: "integer" }] }) as const;
const slot = int("An effect slot of the track, 1 to 10 (as the mixer numbers them).");

/** The starter kit's sounds (`public/kit/`). */
export const KIT_SOUNDS = ["kick", "clap", "hat", "snare"] as const;

export const MUSIC_TOOLS = [
  tool({
    name: "get_song",
    title: "Read the song",
    kind: "look",
    description:
      "The song: its tempo, time signature and swing, the channel rack's channels (id, sample, volume, pan, pitch, mute), " +
      "every pattern with each channel's steps drawn as text (x = a step on, - = off), and the audio files in the project. Start here.",
    inputSchema: obj({}),
  }),
  tool({
    name: "update_song",
    title: "Change the song's settings",
    kind: "edit",
    description: "Set the tempo, the swing or the time signature. Only what's given changes.",
    inputSchema: obj({
      tempo: num("Beats per minute (20 to 999)."),
      swing: num("0 to 1: how late every second sixteenth step plays. 0 is straight; about 0.66 is a triplet feel."),
      timeSignature: arr(int("A number"), "[beats per bar, the note that gets the beat]: [4, 4], [3, 4], [6, 8].", { minItems: 2, maxItems: 2 }),
    }),
  }),
  tool({
    name: "add_channel",
    title: "Add a channel",
    kind: "action",
    description:
      "Add a channel to the channel rack. A sampler playing one of the starter kit's drums (`kit`) or an audio file already in the project " +
      "(`mediaId`, from get_song's list of files); or an instrument plugin installed on this computer (`plugin`, from list_plugins), whose own " +
      "window the user opens from the rack. With none of them, an empty sampler (silent until the user gives it a sample).",
    inputSchema: obj({
      plugin: str("An instrument plugin: its name or its id, from list_plugins."),
      kit: oneOf(KIT_SOUNDS, "A starter-kit drum."),
      mediaId: str("An audio file of the project."),
      name: str("The channel's name (default: the sample's)."),
    }),
  }),
  tool({
    name: "list_plugins",
    title: "List the plugins",
    kind: "look",
    description:
      "The plugins (VST3 and Audio Units) found on this computer: instruments (the default), which add_channel puts in the rack, or effects, which add_mixer_effect puts in a mixer track's slots.",
    inputSchema: obj({ kind: oneOf(["instrument", "effect"], "Which plugins (default: instruments).") }),
  }),
  tool({
    name: "update_channel",
    title: "Change a channel",
    kind: "edit",
    description: "Rename a channel, or set its volume, pan, pitch, mute or volume envelope. Only what's given changes.",
    inputSchema: obj(
      {
        channel,
        name: str("A new name."),
        volume: num("0 to 1. 0.78 (the default) plays the sample at its own level; 1 is about 4 dB louder."),
        pan: num("-1 (left) to 1 (right); 0 is the centre."),
        pitch: num("Semitones added to every note (-48 to 48; fractions are cents)."),
        muted: bool("Whether the channel is muted."),
        cutSelf: bool("On: each new note silences the channel's notes still sounding (a closed hat cutting an open one)."),
        sample: obj(
          {
            normalize: bool("Raise the sample's level until its loudest point is full scale."),
            reverse: bool("Play the sample backwards."),
            start: num("Where the sample starts, 0 to 0.99 of its length (0 is the whole sample)."),
            length: num("How much of what's left after `start` is kept, 0.01 to 1."),
            fadeIn: num("A fade in, 0 to 1 of the kept part."),
            fadeOut: num("A fade out, 0 to 1 of the kept part."),
          },
          [],
          "What's done to the sample before it plays (FL Studio's precomputed effects). Only what's given changes.",
        ),
        envelope: obj(
          {
            enabled: bool("On: a note sounds for its own length, then fades. Off (the default): every note plays the whole sample."),
            attack: num("Seconds to reach full level."),
            decay: num("Seconds to fall to the sustain level."),
            sustain: num("0 to 1: the level held until the note ends."),
            release: num("Seconds to fade after the note ends."),
          },
          [],
          "The volume envelope.",
        ),
      },
      ["channel"],
    ),
  }),
  tool({
    name: "remove_channel",
    title: "Remove a channel",
    kind: "edit",
    description: "Remove a channel from the rack, with its notes in every pattern. The user can undo it.",
    inputSchema: obj({ channel }, ["channel"]),
  }),
  tool({
    name: "solo_channel",
    title: "Solo a channel",
    kind: "edit",
    description: "Solo a channel: every other channel is muted and this one unmuted. Soloing the channel that's already alone unmutes them all.",
    inputSchema: obj({ channel }, ["channel"]),
  }),
  tool({
    name: "move_channel",
    title: "Move a channel",
    kind: "edit",
    description: "Move a channel one place up or down the rack.",
    inputSchema: obj({ channel, direction: oneOf(["up", "down"], "Which way.") }, ["channel", "direction"]),
  }),
  tool({
    name: "set_steps",
    title: "Set a channel's steps",
    kind: "edit",
    description:
      'Draw a channel\'s steps in a pattern as text, one character per sixteenth-note step: "x" is a step on, "-" off. ' +
      'Four on the floor in a one-bar pattern is "x---x---x---x---"; offbeat hats are "--x---x---x---x-". Spaces are ignored, so beats can be ' +
      'grouped ("x--- x--- x--- x---"). A drawing shorter than the pattern repeats to fill it ("x-" is every other step); "-" clears the channel. ' +
      "A drawing longer than the pattern is drawn in full, and a pattern of automatic length grows to the last bar with a step in it " +
      "(32 characters make a two-bar pattern). Steps that stay on keep their velocity and pitch.",
    inputSchema: obj({ channel, steps: str('The drawing, e.g. "x---x---x---x---".'), pattern }, ["channel", "steps"]),
  }),
  tool({
    name: "get_notes",
    title: "Read a channel's notes",
    kind: "look",
    description:
      "A channel's notes in a pattern (what the Piano roll shows): each note's pitch (C5 is middle C, MIDI 60), start and length in " +
      "sixteenth-note steps from the pattern's start (4 steps are a beat, 16 a bar of 4/4), velocity, pan and whether it's muted.",
    inputSchema: obj({ channel, pattern }, ["channel"]),
  }),
  tool({
    name: "set_notes",
    title: "Write a channel's notes",
    kind: "edit",
    description:
      "Write notes for a channel in a pattern (a melody, chords, a bass line): the Piano roll's notes, which any instrument plays. " +
      'Each note has a pitch ("C5" is middle C; "F#4", "Bb3"; or a MIDI number), a start and a length in sixteenth-note steps from the ' +
      "pattern's start (fractions allowed: 0.5 is a 32nd), and optionally a velocity (0 to 1, default 0.78). Notes at the same start make a " +
      'chord. mode "replace" (the default) replaces the channel\'s notes in the pattern; "add" keeps them. The pattern grows to hold them.',
    inputSchema: obj(
      {
        channel,
        pattern,
        notes: arr(
          obj(
            {
              pitch: { description: 'A note name ("C5") or a MIDI number (60).', anyOf: [{ type: "string" }, { type: "integer" }] },
              start: num("Steps from the pattern's start."),
              length: num("Steps."),
              velocity: num("0 to 1."),
            },
            ["pitch", "start", "length"],
          ),
          "The notes.",
        ),
        mode: oneOf(["replace", "add"], "Replace the channel's notes (the default), or add to them."),
      },
      ["channel", "notes"],
    ),
  }),
  tool({
    name: "transpose_channels",
    title: "Transpose channels",
    kind: "edit",
    description:
      "Move every note of one or more channels in a pattern up or down by a number of semitones (12 is an octave; negative is down): " +
      "the channel rack's Transpose selected. Notes stop at the ends of the MIDI range.",
    inputSchema: obj({ channels: arr(channel, "The channels."), semitones: int("Semitones: positive up, negative down."), pattern }, ["channels", "semitones"]),
  }),
  tool({
    name: "edit_step",
    title: "Change a step",
    kind: "edit",
    description: "Set the velocity or the pitch of one step that's on (the graph editor). Steps count from 1.",
    inputSchema: obj(
      {
        channel,
        step: int("Which step, from 1."),
        velocity: num("0 to 1. 0.78 (the default) plays the sample at its own level."),
        pitch: int("Semitones from the sample's own pitch (0 is unchanged, 12 an octave up)."),
        pattern,
      },
      ["channel", "step"],
    ),
  }),
  tool({
    name: "add_pattern",
    title: "Add a pattern",
    kind: "edit",
    description:
      "Add an empty pattern and show it in the channel rack (the engine loops the pattern shown). Its length is automatic: a bar, growing with the steps put in it.",
    inputSchema: obj({ name: str("Its name (default: Pattern N).") }),
  }),
  tool({
    name: "update_pattern",
    title: "Change a pattern",
    kind: "edit",
    description:
      'Rename a pattern or set its length. A length is a number of sixteenth-note steps (1 to 512; 16 is a bar of 4/4), or "auto" (the default): ' +
      "as long as the last bar with a step in it. Steps past a set length stay but aren't played.",
    inputSchema: obj({ pattern, name: str("A new name."), length: { description: 'A number of steps, or "auto".', anyOf: [{ type: "integer" }, { type: "string", enum: ["auto"] }] } }),
  }),
  tool({
    name: "remove_pattern",
    title: "Remove a pattern",
    kind: "edit",
    description: "Remove a pattern (a song keeps at least one). The user can undo it.",
    inputSchema: obj({ pattern: str("The pattern: its id or its name.") }, ["pattern"]),
  }),
  tool({
    name: "show_pattern",
    title: "Show a pattern",
    kind: "action",
    description: "Show a pattern in the channel rack; it's the one that plays. Only for the song open in the editor.",
    inputSchema: obj({ pattern: str("The pattern: its id or its name.") }, ["pattern"]),
  }),
  tool({
    name: "get_mixer",
    title: "Read the mixer",
    kind: "look",
    description:
      "The mixer (FL Studio's): the master and every insert track with its number, id, name, colour, level (dB), pan, mute, phase, swap, " +
      "stereo separation and delay offset; the channels playing into it; its effects slot by slot (on or bypassed, mix, whether the engine " +
      "has loaded the plugin, and how much it delays the sound); and where it sends its sound (each send's level). Tracks nothing uses are summed up in one line.",
    inputSchema: obj({}),
  }),
  tool({
    name: "route_channels",
    title: "Route channels to the mixer",
    kind: "edit",
    description:
      "Send channels' sound to a mixer track (every channel starts on the master). `track` is the track, or \"free\": each channel gets a free " +
      "insert track of its own, named after it (FL Studio's Ctrl+L). Several channels can share a track (drums to a drum bus).",
    inputSchema: obj({ channels: arr(channel, "The channels."), track: mixerTrack('The track, or "free"') }, ["channels", "track"]),
  }),
  tool({
    name: "update_mixer_track",
    title: "Change a mixer track",
    kind: "edit",
    description:
      "Set a mixer track's name, colour, fader level, pan, mute, phase, sides, stereo separation or delay offset. Only what's given changes. " +
      "Its level is after its effects; the master's is the whole song's.",
    inputSchema: obj(
      {
        track: mixerTrack(),
        name: str("A new name (empty: back to its number, \"Insert 3\")."),
        color: str(`A colour: ${["red", "orange", "yellow", "lime", "green", "teal", "blue", "indigo", "purple", "pink", "brown", "grey"].join(", ")}, a "#rrggbb", or "none".`),
        level: num('The fader in dB: 0 leaves the sound as it is (the default), up to +5.8; -60 or lower is silent ("muted" mutes instead).'),
        pan: num("-1 (left) to 1 (right); 0 is the centre. Fully to one side puts both sides there."),
        muted: bool("Whether the track is muted."),
        invert: bool("Flip its phase (a sound out of phase with another thins them both)."),
        swap: bool("Swap its left and right."),
        stereo: num("Stereo separation, -1 to 1: 0 as it is, towards 1 narrower (1 is mono), towards -1 wider."),
        latencyOffset: num("Milliseconds (-1000 to 1000) added to the delay its plugins report, for one that reports it wrong: positive if its sound is late against the others."),
      },
      ["track"],
    ),
  }),
  tool({
    name: "set_send",
    title: "Send a track to another",
    kind: "edit",
    description:
      "Make a mixer track send its sound (after its fader) to another track, change the send's level, or remove it. Every insert sends to the " +
      "master to begin with; a reverb or delay bus is a track the others send to. `only` makes it send there and nowhere else (FL's \"Route to " +
      "this track only\"). A send that would loop back to its own track isn't possible; the master sends nowhere.",
    inputSchema: obj(
      {
        from: mixerTrack("The track sending"),
        to: mixerTrack("The track it sends to"),
        level: num("0 to 1 (1, the default, sends it as it is; 0 keeps the link silent: a sidechain)."),
        remove: bool("Remove the send instead."),
        only: bool("Send to this track alone, removing its other sends (the master's too)."),
      },
      ["from", "to"],
    ),
  }),
  tool({
    name: "solo_mixer_track",
    title: "Solo a mixer track",
    kind: "edit",
    description:
      "Solo a mixer track: every other insert is muted (never the master); soloing the track that's already alone unmutes them all. " +
      "`withRouted` keeps the tracks routed to and from it on too (FL's Alt solo), so its whole path is heard.",
    inputSchema: obj({ track: mixerTrack(), withRouted: bool("Keep the tracks routed to and from it on.") }, ["track"]),
  }),
  tool({
    name: "add_mixer_track",
    title: "Add a mixer track",
    kind: "edit",
    description: "Add an insert track (a new song has 16; up to 500), after a track or at the end, optionally named. It sends to the master.",
    inputSchema: obj({ after: mixerTrack("The track it goes after (default: the last)"), name: str("Its name.") }),
  }),
  tool({
    name: "remove_mixer_track",
    title: "Remove a mixer track",
    kind: "edit",
    description: "Remove an insert track (never the master). Its channels go to the master; a track left sending nowhere sends to the master. The user can undo it.",
    inputSchema: obj({ track: mixerTrack() }, ["track"]),
  }),
  tool({
    name: "move_mixer_track",
    title: "Move a mixer track",
    kind: "edit",
    description: "Move an insert track one place left or right (its channels and sends go with it). The master stays first.",
    inputSchema: obj({ track: mixerTrack(), direction: oneOf(["left", "right"], "Which way.") }, ["track", "direction"]),
  }),
  tool({
    name: "add_mixer_effect",
    title: "Add an effect",
    kind: "action",
    description:
      "Put an effect plugin installed on this computer (list_plugins with kind \"effect\") in a mixer track's slot: the first empty one, or the " +
      "slot given (replacing what's there). Its sound goes through the track's effects in slot order, before its fader. Its settings are the " +
      "plugin's own, in its window, which the user opens from the mixer: you can't set them.",
    inputSchema: obj({ track: mixerTrack(), plugin: str("The effect plugin: its name or its id, from list_plugins."), slot }, ["track", "plugin"]),
  }),
  tool({
    name: "update_mixer_effect",
    title: "Change an effect",
    kind: "edit",
    description: "Bypass an effect in a mixer track's slot or turn it back on, set its mix (how much of it is heard against the dry sound), or move it a slot up or down.",
    inputSchema: obj(
      {
        track: mixerTrack(),
        slot,
        enabled: bool("On, or bypassed (false)."),
        mix: num("0 to 1: 1 (the default) is all effect, 0.5 half and half."),
        move: oneOf(["up", "down"], "Move it a slot up or down (swapping with what's there)."),
      },
      ["track", "slot"],
    ),
  }),
  tool({
    name: "remove_mixer_effect",
    title: "Remove an effect",
    kind: "edit",
    description: "Empty a mixer track's effect slot. The user can undo it (the plugin comes back as it was).",
    inputSchema: obj({ track: mixerTrack(), slot }, ["track", "slot"]),
  }),
  tool({
    name: "copy_track_state",
    title: "Copy a track's effects",
    kind: "action",
    description:
      "Copy a mixer track's state onto another track: its effects (copies, with their plugins' settings as they are now) and its level, pan, " +
      "phase, sides, stereo separation and delay offset; not its name, colour, channels or sends. What the other track had is replaced.",
    inputSchema: obj({ from: mixerTrack("The track copied"), to: mixerTrack("The track it's copied onto") }, ["from", "to"]),
  }),
  tool({
    name: "play_song",
    title: "Play or stop",
    kind: "action",
    description: "Start the song playing (the pattern shown, looped, from its start) or stop it, so the user hears it. You can't hear it yourself.",
    inputSchema: obj({ action: oneOf(["play", "stop"], "What to do.") }, ["action"]),
  }),
] as const satisfies readonly ToolSpec[];

export type MusicToolName = (typeof MUSIC_TOOLS)[number]["name"];

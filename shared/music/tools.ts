/**
 * The music suite's tools for AI agents (see `shared/tool-spec.ts`; handlers in
 * `src/suites/music/tools.ts`, their edits in `tool-edits.ts`). Add a tool with each feature.
 */
import { type ToolSpec, arr, bool, int, num, obj, oneOf, str, tool } from "../tool-spec.ts";

const channel = str('A channel: its id (from get_song) or its name ("Kick").');
const pattern = str("A pattern: its id or its name. Default: the pattern shown in the channel rack.");

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
    description: "The instrument plugins (VST3 and Audio Units) found on this computer, which add_channel can put in the rack.",
    inputSchema: obj({}),
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
    name: "play_song",
    title: "Play or stop",
    kind: "action",
    description: "Start the song playing (the pattern shown, looped, from its start) or stop it, so the user hears it. You can't hear it yourself.",
    inputSchema: obj({ action: oneOf(["play", "stop"], "What to do.") }, ["action"]),
  }),
] as const satisfies readonly ToolSpec[];

export type MusicToolName = (typeof MUSIC_TOOLS)[number]["name"];

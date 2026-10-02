/**
 * The music suite's tools for AI agents (see `shared/tool-spec.ts`; handlers in
 * `src/suites/music/tools.ts`, their edits in `tool-edits.ts`). Add a tool with each feature.
 */
import { type ToolSpec, arr, bool, int, num, obj, oneOf, str, tool } from "../tool-spec.ts";
import { CHOP_PATTERNS } from "./chop.ts";
import { EXPORT_FORMATS } from "./export.ts";
import { OTT_TOOL_CONTROL_NAMES } from "./ott-presets.ts";
import { CURVE_TYPES } from "./types.ts";

const channel = str('A channel: its id (from get_song) or its name ("Kick").');
const pattern = str("A pattern: its id or its name. Default: the pattern shown in the channel rack.");
const mixerTrack = (what = "A mixer track") =>
  ({ description: `${what}: its id, its number (0 or "M" is the master, 1 the first insert), "master", or its name ("Drums", "Insert 3").`, anyOf: [{ type: "string" }, { type: "integer" }] }) as const;
const slot = int("An effect slot of the track, 1 to 10 (as the mixer numbers them).");
/** Which Gross Beat a tool acts on, and its slots. */
const grossRef = {
  effect: str("The Gross Beat: its effect id (from get_mixer or get_gross_beat). Or give `track` (and `effectSlot` if it has several). Default: the song's only one."),
  track: mixerTrack("The mixer track it's on"),
  effectSlot: int("Its effect slot on the track, 1 to 10."),
} as const;
const grossKind = oneOf(["time", "volume"], "A time slot or a volume slot.");
/** Which Pro-Q a tool acts on. */
const eqRef = {
  effect: str("The Pro-Q: its effect id (from get_mixer or get_pro_q). Or give `track` (and `effectSlot` if it has several). Default: the song's only one."),
  track: mixerTrack("The mixer track it's on"),
  effectSlot: int("Its effect slot on the track, 1 to 10."),
} as const;
const grossSlot = { description: "A slot: its number, 1 to 36, or its name (\"1/2 Speed\").", anyOf: [{ type: "string" }, { type: "integer" }] } as const;
/** Which Auto-Tune a tool acts on. */
const tuneRef = {
  effect: str("The Auto-Tune: its effect id (from get_mixer or get_auto_tune). Or give `track` (and `effectSlot` if it has several). Default: the song's only one."),
  track: mixerTrack("The mixer track it's on"),
  effectSlot: int("Its effect slot on the track, 1 to 10."),
} as const;
/** Which OTT a tool acts on. */
const ottRef = {
  effect: str("The OTT: its effect id (from get_mixer or get_ott). Or give `track` (and `effectSlot` if it has several). Default: the song's only one."),
  track: mixerTrack("The mixer track it's on"),
  effectSlot: int("Its effect slot on the track, 1 to 10."),
} as const;
/** Which EchoBoy a tool acts on. */
const echoRef = {
  effect: str("The EchoBoy: its effect id (from get_mixer or get_echo_boy). Or give `track` (and `effectSlot` if it has several). Default: the song's only one."),
  track: mixerTrack("The mixer track it's on"),
  effectSlot: int("Its effect slot on the track, 1 to 10."),
} as const;
const echoTime = (what: string) => ({ description: `${what}: a note value at the tempo ("1/8", "1/8 dot", "1/16 tri"; 1/2 to 1/64) or milliseconds ("350 ms", or a number), up to 15 s.`, anyOf: [{ type: "string" }, { type: "number" }] }) as const;
const playlistTrack = int("A playlist track's number, 1 for the first (as the Playlist numbers them).");
const clipIds = arr(int("A clip's id"), "Clips, by their ids from get_playlist.");

const automationRef = str("An automation clip: its id or its name (from get_automation).");
/** What names a control to automate (`add_automation`, `list_controls`). */
const controlFields = {
  control: oneOf(
    [
      "volume",
      "pan",
      "stereo",
      "send",
      "mix",
      "main volume",
      "parameter",
      "time slot",
      "volume slot",
      "time mix",
      "volume mix",
      "gross attack",
      "gross release",
      "gross tension",
      "retune speed",
      "humanize",
      "flex-tune",
      "natural vibrato",
      "transpose",
      "throat",
      "key",
      ...["eq frequency", "eq gain", "eq q", "eq range", "eq output"],
      ...["echo mix", "echo feedback", "echo time 1", "echo time 2", "echo low cut", "echo high cut", "echo saturation", "echo input", "echo output", "echo groove", "echo feel", "echo width"],
      ...OTT_TOOL_CONTROL_NAMES,
    ],
    "Which control: a channel's or mixer track's volume or pan, a track's stereo separation, a send's level, an effect slot's mix, the main volume, " +
      "a plugin's own parameter, a Gross Beat's (the effect in `track`'s `slot`): its time slot or volume slot playing (values 1 to 36: " +
      "use hold curves, so each bar plays a slot: that's how chops are arranged), its time or volume knob, or its attack and release " +
      "(\"gross attack\", \"gross release\": seconds, 0 to 0.5 and 0 to 1) or tension (\"gross tension\", -1 to 1); an Auto-Tune's (likewise): " +
      "its retune speed (ms, 0 to 400), humanize and flex-tune (0 to 100), natural vibrato (dB, -12 to 12), transpose (semitones, -12 to 12), " +
      "throat (50 to 180) or key (0 C .. 11 B, with hold curves: a key change); or an EchoBoy's (\"echo ...\": " +
      "mix and feedback 0 to 1, cuts in Hz, saturation 0 to 1, input and output dB, groove and feel -1 to 1, width 0 to 1, an echo time's " +
      "knob 0 to 1: automating a Time echo bends its pitch like tape, a note value steps through 1/2 .. 1/64); " +
      "or a Pro-Q's (the effect in `track`'s `slot`, \"eq ...\"): a band's (`band`) frequency (values in Hz: a filter sweep), gain or " +
      "dynamic range (dB) or Q, or its output (dB); or an OTT's (\"ott ...\"): depth 0 to 1, time 0 to 10 (1 is 100%), in and out gain dB, " +
      "upward and downward 0 to 2 (1 is 100%), a band's threshold 0 to 2 or gain dB.",
  ),
  channel: str("A channel (volume, pan), or a plugin channel (its parameters): id or name."),
  track: mixerTrack("A mixer track (its volume, pan, stereo separation; a send from it; an effect in it)"),
  to: mixerTrack("The track a send goes to"),
  slot: int("An effect slot of the track, 1 to 10 (its mix, or its plugin's parameters)."),
  parameter: str("A plugin's parameter: its name or id, from list_controls."),
  band: int("A Pro-Q band's number (from get_pro_q), for its eq controls."),
} as const;
const automationPoints = arr(
  obj(
    {
      at: num("Bars from the clip's start (0 is its start)."),
      value: num("The control's value there, as its knob has it: a volume 0 to 1 (0.78 plays as it is), a pan -1 (left) to 1 (right), a send or mix 0 to 1, a plugin parameter 0 to 1 of its range."),
      curve: oneOf(CURVE_TYPES, "How the line gets here from the point before (FL's curve types; default single: straight, or bent by tension). hold steps, stairs and pulse step, wave and smooth curve."),
      tension: num("-1 to 1: how the segment bends; for stairs, pulse and wave how many steps or cycles. 0 is straight."),
    },
    ["at", "value"],
    "A point of the curve.",
  ),
  "The curve's points, in order: the first is at 0.",
);

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
    description: "Set the tempo, the swing, the time signature or the main volume (the toolbar's knob). Only what's given changes.",
    inputSchema: obj({
      volume: num("0 to 1: the main volume, everything the song puts out (after the master track). 0.78 leaves it as it is; 1 is about +4 dB."),
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
    name: "replace_channel",
    title: "Replace a channel's instrument",
    kind: "action",
    description:
      "FL Studio's Replace: put another instrument in a channel's place, an instrument plugin (`plugin`, from list_plugins) or, without one, " +
      "an empty sampler. It keeps the channel's notes in every pattern, its volume, pan, mute and mixer track; it's named after the new " +
      "instrument and gets a new id. Not for audio clips' channels.",
    inputSchema: obj({ channel, plugin: str("An instrument plugin: its name or its id, from list_plugins. Leave it out for a sampler.") }, ["channel"]),
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
    description: "Rename a channel, or set its volume, pan, pitch, mute, colour or volume envelope. Only what's given changes.",
    inputSchema: obj(
      {
        channel,
        name: str("A new name."),
        volume: num("0 to 1. 0.78 (the default) plays the sample at its own level; 1 is about 4 dB louder."),
        pan: num("-1 (left) to 1 (right); 0 is the centre."),
        pitch: num("Semitones added to every note (-48 to 48; fractions are cents, 0.01 a cent). An audio clip's channel plays its file faster or slower with it, as FL's Resample does (12: an octave up, twice as fast)."),
        muted: bool("Whether the channel is muted."),
        cutSelf: bool("On: each new note silences the channel's notes still sounding (a closed hat cutting an open one)."),
        color: str('A colour, "#rrggbb", or "none" for the usual. An audio clip\'s clips on the playlist take its channel\'s colour.'),
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
    name: "chop_notes",
    title: "Chop notes",
    kind: "edit",
    description:
      "The Piano roll's Chopper: cut a channel's long notes in a pattern into a rhythm (a held hi-hat into a roll, a pad into a gate). " +
      "Rhythms: " +
      CHOP_PATTERNS.map((p) => `"${p.id}" (${p.hint})`).join(", ") +
      ". Some leave rests (what of a note falls there is cut out) and give pieces their own velocity or pan, which `velocity_levels` " +
      "and `pan_levels` apply (0, the default, none of it; 1 all of it). Acts on every note of the channel, or those `from`/`to` and `pitch` pick.",
    inputSchema: obj(
      {
        channel,
        pattern,
        rhythm: oneOf(
          CHOP_PATTERNS.map((p) => p.id),
          'The chop pattern (default "default": pieces `grid` steps long).',
        ),
        grid: num('For "default": how long each piece is, in steps (default 1, a sixteenth; 0.5 is a 32nd, 2/3 a sixteenth triplet).'),
        time_mul: num("How much faster the rhythm goes: 2 is twice as fast (pieces half as long), 0.5 half as fast. 1/4 to 4; default 1."),
        velocity_levels: num("0 to 1: how much of the rhythm's accents the pieces get (default 0)."),
        pan_levels: num("0 to 1: how much of the rhythm's panning the pieces get (default 0)."),
        absolute: bool("Count the rhythm from the pattern's start, so pieces fall on the same beats whatever the note's start (the default); false starts it at each note."),
        from: num("Only notes starting at or after this step."),
        to: num("Only notes starting before this step."),
        pitch: { description: 'Only notes of this pitch: a note name ("F#5") or a MIDI number.', anyOf: [{ type: "string" }, { type: "integer" }] },
      },
      ["channel"],
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
      'Rename a pattern, colour it or set its length. A length is a number of sixteenth-note steps (1 to 512; 16 is a bar of 4/4), or "auto" (the default): ' +
      "as long as the last bar with a step in it. Steps past a set length stay but aren't played. Its clips on the playlist take its colour.",
    inputSchema: obj({
      pattern,
      name: str("A new name."),
      color: str('A colour, "#rrggbb", or "none" for the usual.'),
      length: { description: 'A number of steps, or "auto".', anyOf: [{ type: "integer" }, { type: "string", enum: ["auto"] }] },
    }),
  }),
  tool({
    name: "remove_pattern",
    title: "Remove a pattern",
    kind: "edit",
    description: "Remove a pattern and its clips on the playlist. Removing the last one leaves an empty \"Pattern 1\", as a new song has. The user can undo it.",
    inputSchema: obj({ pattern: str("The pattern: its id or its name.") }, ["pattern"]),
  }),
  tool({
    name: "transpose_patterns",
    title: "Transpose patterns",
    kind: "edit",
    description:
      "Move every note of one or more patterns, every channel's, up or down by a number of semitones (12 is an octave; negative is down): " +
      "the Playlist's Picker's Transpose selected. Notes stop at the ends of the MIDI range. For some channels of one pattern, use transpose_channels.",
    inputSchema: obj({ patterns: arr(str("A pattern: its id or its name."), "The patterns."), semitones: int("Semitones: positive up, negative down.") }, ["patterns", "semitones"]),
  }),
  tool({
    name: "move_pattern",
    title: "Move a pattern",
    kind: "edit",
    description: "Move a pattern one place up or down the song's list of patterns (the Picker's order, Alt+Up / Down). Its clips stay where they are.",
    inputSchema: obj({ pattern: str("The pattern: its id or its name."), direction: oneOf(["up", "down"], "Up (earlier in the list) or down.") }, ["pattern", "direction"]),
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
      "Set a mixer track's name, colour, fader level, pan, mute, phase, sides, stereo separation, delay offset, dock or divider, or what it " +
      "records: its input on the audio device (FL's Input: an insert records the input it takes when it's armed, see arm_tracks and " +
      "record_audio), when that input is heard through it, and its input offset. Only what's given changes. " +
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
        dock: oneOf(["left", "middle", "right"], "Which of the mixer's docks it's shown in: the left and right ones stay put while the middle scrolls (the master is always left)."),
        separator: bool("A divider before it, to set tracks apart."),
        input: str(
          'The device input it records (list_audio_inputs has them): "1" for input 1 alone (mono, heard on both sides), "1-2" for inputs 1 and 2 as a stereo pair, or "none". Never on the master.',
        ),
        monitor: oneOf(["off", "armed", "on"], "When its input is heard, through its effects: never, while it's armed (the default), or always."),
        inputOffset: num("Milliseconds (-1000 to 1000) its takes are moved earlier (negative: later), for latency the device doesn't report."),
      },
      ["track"],
    ),
  }),
  tool({
    name: "list_audio_inputs",
    title: "List the audio inputs",
    kind: "look",
    description:
      "The audio device's inputs that mixer tracks can record (the input device is chosen in Settings), which tracks take which, " +
      "and which are armed. Recording (FL's): give an insert an input (update_mixer_track), arm it (arm_tracks), then record_audio.",
    inputSchema: obj({}),
  }),
  tool({
    name: "arm_tracks",
    title: "Arm tracks to record",
    kind: "action",
    description:
      "Arm mixer tracks to record, or disarm them (the editor's state, not the song's). Only a track with an input can be armed; an armed " +
      "track's input is heard while it's armed (unless its monitoring is off) and recorded by record_audio.",
    inputSchema: obj({ tracks: arr(mixerTrack("A track to arm"), "The tracks."), armed: bool("Arm (true, the default) or disarm.") }, ["tracks"]),
  }),
  tool({
    name: "record_audio",
    title: "Record",
    kind: "action",
    description:
      "Start or stop recording the armed mixer tracks (the user plays or sings: you can't hear it). It records the song (song mode) from " +
      "`bar`, after a count-in of the metronome's clicks; with `loop` it goes round the Playlist's time selection (or the song), a take each " +
      "pass, until stopped. Stopping puts each take on the Playlist as an audio clip where it was recorded (on the track's audio track if it " +
      "has one, else the first track it fits on), on a channel of its own routed back into the track that recorded it; with `loop` all but the " +
      "last pass are muted unless `blend`. Answers, on stop, with the clips made.",
    inputSchema: obj(
      {
        action: oneOf(["start", "stop"], "What to do."),
        bar: num("Where to start, a bar (1 is the start; default: where play starts)."),
        countIn: int("Bars of count-in: 0 (none), 1, 2 or 4 (default: the user's choice, at first 1). It's kept as the user's choice (the toolbar's count-in switch)."),
        loop: bool("Loop record: a take each pass round the loop (default: the user's choice)."),
        blend: bool("With loop: hear (and keep unmuted) the earlier passes (default: the user's choice)."),
      },
      ["action"],
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
    name: "group_mixer_tracks",
    title: "Group mixer tracks",
    kind: "edit",
    description:
      "Put mixer tracks in a named group (FL's Create group: a band with its name across their tops, dividers at its edges), taking them out of any " +
      "other; or take them out of their groups (`ungroup`). Grouping is only how the mixer shows them: it doesn't route anything (set_send does).",
    inputSchema: obj({ tracks: arr(mixerTrack(), "The tracks."), name: str("The group's name (default: Group N)."), ungroup: bool("Take them out of their groups instead.") }, ["tracks"]),
  }),
  tool({
    name: "add_mixer_effect",
    title: "Add an effect",
    kind: "action",
    description:
      "Put an effect in a mixer track's slot: the first empty one, or the slot given (replacing what's there). Its sound goes through the track's " +
      "effects in slot order, before its fader. Either one of ours, whose settings you set: Pro-Q (plugin \"Pro-Q\": FabFilter's " +
      "Pro-Q 3, a 24-band EQ with dynamic bands, mid/side, zero latency, natural or linear phase, set with set_pro_q_bands and " +
      "update_pro_q), EchoBoy (plugin \"EchoBoy\": Soundtoys' echo: " +
      "tape, analogue, digital, radio, chorus and diffused echoes in 31 styles, Single, Dual, Ping-Pong and Rhythm Echo, set with " +
      "update_echo_boy), Gross Beat (plugin \"Gross Beat\": chops, repeats, stutters, half speed, tape stops, scratches, gates and " +
      "sidechain pumping in time with the song, set with update_gross_beat and set_gross_beat_slot) or Auto-Tune (plugin \"Auto-Tune\": " +
      "pitch correction for vocals, from the hard-tuned sound to natural, set with update_auto_tune; put it on the vocal's track), or " +
      "an effect plugin installed on this computer (list_plugins with kind \"effect\"), whose settings are its own, in its window, which the " +
      "user opens from the mixer: you can't set them. OTT (plugin \"OTT\": Xfer's multiband upward/downward compressor, the squashed, " +
      "bright, loud sound; set with update_ott) is ours as well.",
    inputSchema: obj({ track: mixerTrack(), plugin: str('"Pro-Q", "OTT", "EchoBoy", "Gross Beat", "Auto-Tune", or an effect plugin: its name or its id, from list_plugins.'), slot }, ["track", "plugin"]),
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
    name: "get_pro_q",
    title: "Read a Pro-Q",
    kind: "look",
    description:
      "A Pro-Q (FabFilter's Pro-Q 3 EQ, ours, in a mixer track's slot): its processing mode and latency, output, Gain Scale and Auto Gain, " +
      "its bands (shape, frequency, gain, Q, slope, placement, dynamics) and the curve they make, in dB at each octave's centre.",
    inputSchema: obj({ ...eqRef }),
  }),
  tool({
    name: "set_pro_q_bands",
    title: "Shape a Pro-Q",
    kind: "edit",
    description:
      "Add, change or remove a Pro-Q's bands (24 at most). A band without `band` is added (give its frequency); with `band` (its number), " +
      "only what's given changes, or `remove` takes it out. Shapes: bell, lowShelf, lowCut, highShelf, highCut, notch, bandPass, tiltShelf " +
      "(tilts round its frequency: -gain/2 below, +gain/2 above), flatTilt (a straight tilt over the whole spectrum: gain/5 dB per octave). " +
      "Q is Pro-Q's: 1 is the default width (a Bell 1.9 octaves wide at half its gain; Q 2 is 1 octave), higher is narrower; on a cut it's " +
      "resonance (1 is flat Butterworth, 0.71 is -6 dB at the frequency). Slope in dB/oct, 6 to 96 (Bell and Notch from 12), or brickwall on " +
      "cuts. A dynamic band (`range` not 0, Bell and shelves) moves its gain toward gain + range when the sound in its range is loud " +
      "(negative: tame a resonance, de-ess; positive: bring out what's loud); its threshold is auto by default. Placement puts a band on " +
      "the left, right, mid or side only. Returns the new curve.",
    inputSchema: obj({
      ...eqRef,
      clear: bool("Remove every band first (start from flat)."),
      bands: arr(
        obj(
          {
            band: int("An existing band's number, to change or remove it; leave it out to add a band."),
            remove: bool("Remove this band."),
            shape: oneOf(["bell", "lowShelf", "lowCut", "highShelf", "highCut", "notch", "bandPass", "tiltShelf", "flatTilt"], "Its shape (default bell)."),
            frequency: num("Hz, 10 to 30000."),
            gain: num("dB, -30 to 30 (bell, shelves, tilts)."),
            q: num("0.025 to 40 (default 1)."),
            slope: { description: "dB/oct: 6, 12, 18, 24, 30, 36, 48, 72, 96, or \"brickwall\" (cuts only). Default 12.", anyOf: [{ type: "integer" }, { type: "string" }] },
            placement: oneOf(["stereo", "left", "right", "mid", "side"], "Which part of the sound (default stereo)."),
            range: num("dB, -30 to 30: a dynamic band's movement when loud (0: static)."),
            threshold: { description: 'A dynamic band\'s threshold in dB (-60 to 0), or "auto" (the default: it follows the level in its range).', anyOf: [{ type: "number" }, { type: "string" }] },
            dynamics: bool("A dynamic band's dynamics on (default) or bypassed."),
            enabled: bool("On (default), or bypassed."),
          },
          [],
          "A band to add, change or remove.",
        ),
        "The bands, in order.",
      ),
    }),
  }),
  tool({
    name: "update_pro_q",
    title: "Change a Pro-Q",
    kind: "edit",
    description:
      "Set a Pro-Q's processing mode (zeroLatency; naturalPhase: analog phase, 7.3 ms late; linearPhase: no phase change, more latency by " +
      "resolution, and dynamic bands only up to high), output level and pan, phase, Auto Gain, Gain Scale (scales every band's gain), Gain-Q " +
      "interaction, display range; load a factory preset; or switch or copy A/B.",
    inputSchema: obj({
      ...eqRef,
      mode: oneOf(["zeroLatency", "naturalPhase", "linearPhase"], "The processing mode."),
      resolution: oneOf(["low", "medium", "high", "veryHigh", "maximum"], "Linear Phase's resolution (Medium is the usual)."),
      output: num("dB, -60 (silent) to 36."),
      pan: num("-1 to 1: the output's balance."),
      panMode: oneOf(["lr", "ms"], "What the pan balances: left/right or mid/side."),
      invert: bool("Flip the output's phase."),
      autoGain: bool("Take back the level the curve adds or removes (an estimate from the curve)."),
      gainScale: num("Percent, 0 to 200: every band's gain (and range) scaled."),
      gainQ: bool("Gain-Q interaction: a Bell narrows as it's boosted, as an analog EQ's does."),
      displayRange: int("±dB the display shows: 3, 6, 12 or 30."),
      preset: str("A factory preset's name (it replaces the bands): Default Setting, Flat 7 Bands, Equalize, Clean Low End, Kick Punch, Snare Crack, Overheads, Bass Definition, Mono Lows, Vocal Presence, De-Ess, Telephone, Radio, Lo-Fi, Air, Gentle Tilt, Mastering Clean-Up, Wide Highs."),
      ab: oneOf(["switch", "copy"], "Switch to the other A/B state, or copy this one to it."),
    }),
  }),
  tool({
    name: "get_ott",
    title: "Read an OTT",
    kind: "look",
    description:
      "An OTT (Xfer's multiband upward and downward compressor, ours, in a mixer track's slot): its depth, time, in and out gain, upward " +
      "and downward strength, each band's (low below 88 Hz, mid, high above 2.5 kHz) threshold, gain and which compressors are on, where " +
      "each band's upward and downward ranges start, and what it does to a band at a few levels; the presets.",
    inputSchema: obj({ ...ottRef }),
  }),
  tool({
    name: "update_ott",
    title: "Change an OTT",
    kind: "edit",
    description:
      "Set an OTT's knobs or load a preset. Depth is how much of it there is (0 leaves the sound alone; 0.2 to 0.5 is a common amount, " +
      "1 is OTT's over-the-top default). Time scales the release (1 is OTT's own, 100%; lower pumps faster). In gain pushes the sound into " +
      "the downward compression (more squash), out gain makes up level after. Upward lifts quiet sound, downward pushes loud sound down " +
      "(each 0 to 2, 1 is 100%). Each band (low, mid, high) has a threshold (0 to 2, 1 is 100%: higher moves both its thresholds up, more " +
      "lift for quiet sound and less push on loud), a gain (dB, -24 to 6), and its upward and downward compressors on or off.",
    inputSchema: obj({
      ...ottRef,
      preset: str("A preset's name (it sets everything): Default, Gentle, Half, Upward only, Downward only, Bright, Sub tamer, Vocal glue, Drum smash, Pad bloom."),
      depth: num("0 to 1."),
      time: num("0 to 10 (1 is 100%, OTT's own)."),
      input: num("In gain, dB, -24 to 19.1."),
      output: num("Out gain, dB, -24 to 19.1."),
      upward: num("Upward strength, 0 to 2 (1 is 100%)."),
      downward: num("Downward strength, 0 to 2 (1 is 100%)."),
      bands: arr(
        obj(
          {
            band: oneOf(["low", "mid", "high"], "Which band."),
            threshold: num("0 to 2 (1 is 100%)."),
            gain: num("dB, -24 to 6."),
            upward: bool("Its upward compressor on."),
            downward: bool("Its downward compressor on."),
          },
          ["band"],
          "A band's changes.",
        ),
        "Bands to change.",
      ),
    }),
  }),
  tool({
    name: "get_echo_boy",
    title: "Read an EchoBoy",
    kind: "look",
    description:
      "An EchoBoy (Soundtoys' echo, ours, in a mixer track's slot): its mode, echo times (and what they are at the tempo), mix, feedback, " +
      "cuts, saturation and levels, groove and feel, its mode's Tweak controls, Rhythm Echo's taps, its style (and, edited or asked for, " +
      "the style's settings), and the styles and presets to choose from.",
    inputSchema: obj({ ...echoRef, style: bool("Say the style's settings even if it hasn't been edited.") }),
  }),
  tool({
    name: "update_echo_boy",
    title: "Change an EchoBoy",
    kind: "edit",
    description:
      "Set an EchoBoy: load a preset (first, then the rest applies over it), its mode and echo times, its knobs, its style, Rhythm Echo's " +
      "pattern or taps, and the Style Editor's settings (it then says Custom). How it sounds: each repeat goes round again through the style " +
      "(its EQ's Decay darkens or thins every repeat, its saturation dirties it), so feedback makes the repeats change, not just repeat. " +
      "Single Echo is one time (stereo, Width spreads it); Dual is Echo 1 left, Echo 2 right; Ping-Pong is Ping left then Pong right after it; " +
      "Rhythm Echo is up to 16 taps on a beat grid, the whole pattern fed back. Mix 0.5 is dry and echo both full (above it the dry falls): " +
      "on a send, use 1. Feedback past about 0.87 runs away (self-oscillation, held by the saturation).",
    inputSchema: obj({
      ...echoRef,
      preset: str("A factory preset's name (get_echo_boy lists them): loaded first."),
      mode: oneOf(["single", "dual", "pingPong", "rhythm"], "Single Echo, Dual Echo, Ping-Pong or Rhythm Echo."),
      echo1: echoTime("Single's Echo Time, Dual's Echo 1, Ping-Pong's Ping"),
      echo2: echoTime("Dual's Echo 2, Ping-Pong's Pong"),
      mix: num("0 (dry) to 1 (echo only); 0.5: both full."),
      feedback: num("0 to 1: more repeats; past about 0.87, runaway."),
      lowCut: { description: 'Hz, 20 to 2000, or "off": the repeats\' lows cut (more each repeat).', anyOf: [{ type: "number" }, { type: "string" }] },
      highCut: { description: 'Hz, 500 to 20000, or "off": the repeats darkened (more each repeat).', anyOf: [{ type: "number" }, { type: "string" }] },
      primeNumbers: bool("Times nudged to prime numbers of ms, so lines never ring together (chorus, flange, reverb-like sounds)."),
      saturation: num("0 to 1: the style's saturation driven less or more (0.5 is the style as made)."),
      input: num("dB, -24 to 24: into the echo (pushing it dirties it)."),
      output: num("dB, -24 to 24: the echo's level out (the dry sound is untouched)."),
      style: str("An Echo Style: Studio Tape, Space Echo, Memory Man, DM-2, TelRay, Telephone, Digital Delay... (get_echo_boy lists all 31)."),
      tempo: { description: '"song" to follow the song\'s tempo, or EchoBoy\'s own BPM (30 to 300).', anyOf: [{ type: "string" }, { type: "number" }] },
      groove: num("-1 (shuffle: every other repeat later) to 1 (swing: earlier); 0 straight."),
      feel: num("-1 (rushin': every echo up to 30 ms early) to 1 (draggin': late)."),
      width: num("0 (mono echo) to 1 (wider than the speakers); 0.75 is full stereo."),
      offset: num("ms, 0 to 25: the right side's echoes later (heard with width up)."),
      accent: num("-1 to 1: odd repeats louder (+) or even ones (-). Dual's Accent 1."),
      accent2: num("-1 to 1: Dual's Accent 2."),
      balance: num("-1 (left) to 1 (right): Dual's and Ping-Pong's echoes' balance."),
      feedbackMix: num("0 (each echo feeds itself) to 1 (each feeds the other): Dual's FB Mix."),
      feedbackBalance: num("-1 to 1: Dual's feedback shared more to the left or the right."),
      rhythm: obj(
        {
          pattern: str("A factory pattern: 1/8 Notes, 1/16 Triplets, Gallop, Clave, Tresillo, Bounce, Complex Pedal Pattern..."),
          time: echoTime("The Rhythm knob: taps laid out evenly this far apart"),
          repeats: int("1 to 16: how many taps the Rhythm knob lays out."),
          taps: arr(obj({ beat: num("Beats from the pattern's start (0 is the One, heard only as the pattern comes round)."), level: num("0 to 1.") }, ["beat"]), "The taps, replacing them."),
          length: num("The pattern's length in beats, 1 to 8: fed back whole."),
          shape: oneOf(["decay", "reverse", "swell", "fade", "nonLin"], "A level shape across the taps."),
          shapeAmount: num("0 to 1: how much the shape sets the levels."),
          panShape: oneOf(["double", "center", "alt1", "alt2", "alt3", "sweepL", "sweepR", "pan"], "Where the taps sit left to right (double: 8 stereo pairs)."),
          accent: num("-1 to 1: Accent (with a note value) or Warp (with ms: taps drawn to the start or end)."),
          grid: int("The grid's note value: 2, 4, 8, 16, 32 or 64."),
        },
        [],
        "Rhythm Echo's pattern.",
      ),
      styleEdit: obj(
        {
          low: obj({ freq: num("Hz, 20 to 2000."), gain: num("dB, -40 to 18: the first repeat."), decay: num("-40 to 18: each further repeat (-40 is -6 dB a repeat, -16 about -1 dB).") }, [], "The low shelf."),
          mid: obj({ freq: num("Hz, 20 to 5000."), res: num("-12 to 24: narrower and deeper."), gain: num("dB, -40 to 18."), decay: num("-40 to 18.") }, [], "The mid peak."),
          high: obj({ freq: num("Hz, 500 to 12000."), gain: num("dB, -40 to 18."), decay: num("-40 to 18: negative darkens every repeat more.") }, [], "The high shelf."),
          diffusion: obj({ amount: num("0 to 1."), size: num("0 to 50."), loop: bool("In the loop (each repeat more smeared), or after it.") }, [], "Diffusion."),
          wobble: obj(
            {
              depth: num("Cents, 0 to 1200."),
              rate: num("Hz, 0.01 to 50."),
              sync: num("-1 (paths at different rates) to 1 (left and right out of phase)."),
              shape: oneOf(["triangle", "sine", "square", "randomWalk", "randomHold"], "The wobble's shape."),
              feedback: bool("On the repeats."),
              out: bool("On the output."),
            },
            [],
            "Wow and flutter.",
          ),
          saturation: obj(
            {
              decay: num("dB, -24 to 24: the repeats driven (each again)."),
              out: num("dB, -24 to 24: the echo's output driven."),
              type: oneOf(["clean", "tape", "warm", "pump", "dirt", "hardLimit", "softLimit", "warmLimit", "brightLimit"], "The kind of saturation."),
            },
            [],
            "Saturation.",
          ),
        },
        [],
        "The Style Editor's changes: the style becomes Custom.",
      ),
      revertStyle: bool("Drop the Style Editor's edits: the style as it's made."),
    }),
  }),
  tool({
    name: "get_gross_beat",
    title: "Read a Gross Beat",
    kind: "look",
    description:
      "A Gross Beat (FL Studio's time and volume effect, in a mixer track's slot): what it plays, its knobs and options, its 36 time and 36 " +
      "volume slots by name, and slots' envelopes (the two playing, or those asked for). A slot is a bar (4 beats) that repeats while it plays. " +
      "A time envelope says how many beats back the sound is read from (0 is now, 8 the most): flat is normal speed, down 1 beat per beat is " +
      "paused, down 2 per beat is backwards at normal speed, a step down is a jump back (a repeat), up is faster. A volume envelope is a level.",
    inputSchema: obj({
      ...grossRef,
      slots: arr(obj({ kind: grossKind, slot: grossSlot }, ["kind", "slot"]), "Slots whose envelopes to read (default: the two playing)."),
    }),
  }),
  tool({
    name: "update_gross_beat",
    title: "Change a Gross Beat",
    kind: "edit",
    description:
      "Pick which time and volume slots a Gross Beat plays (from its next TRIG SYNC point, while the song plays), turn its knobs and set its " +
      "options. To change slots over the song (a chop arrangement), automate them: add_automation with control \"time slot\" or \"volume slot\".",
    inputSchema: obj({
      ...grossRef,
      timeSlot: grossSlot,
      volumeSlot: grossSlot,
      time: num("0 to 1: how much of the time envelope is used (the Time knob; 0.5 reaches half as far back)."),
      volume: num("0 to 1: how much of the volume envelope is used (the Volume knob)."),
      attack: num("Milliseconds, 0 to 500: the volume's rises smoothed (ATT)."),
      release: num("Milliseconds, 0 to 1000: the volume's falls smoothed (REL)."),
      tension: num("-1 to 1: how that smoothing bends (TNS)."),
      linkSlots: bool("Picking a time slot picks the volume slot of the same number, and back."),
      oneShot: bool("A slot plays once (a bar), then slot 1."),
      hold: oneOf(["off", "last", "next"], "What the HOLD button repeats while the user holds it: nothing, the bar just played, or the next bar."),
      trigSync: num("Beats: a slot picked while playing starts on the next multiple of it: 0 (at once), 0.25, 0.5, 1, 2 or 4."),
      posSync: num("Beats: where in its envelope a slot starts is where the song is inside this length: 0 (its start), 0.25, 0.5, 1, 2 or 4 (in line with the bars)."),
      clickReduction: bool("A jump fades across 3 ms (on by default)."),
      attackCompensation: bool("What a jump lands on is read the attack time earlier, so its start isn't lost under the attack's smoothing."),
      removeDc: bool("A 10 Hz high-pass, for after a pause."),
      hq: bool("Sinc resampling: cleaner pitch changes, more CPU."),
    }),
  }),
  tool({
    name: "set_gross_beat_slot",
    title: "Draw a Gross Beat slot",
    kind: "edit",
    description:
      "Draw a Gross Beat slot's envelope (a custom chop, stutter, gate...), name it, clear it (empty: a time slot at now, a volume slot at full), " +
      "or give it back its preset (`reset`). It's picked so it plays, unless `pick` is false. Points are in order of `beat` (0 to 4, across " +
      "the bar; the first is at 0): for a time slot `back` (beats back the sound is read from, 0 to 8), for a volume slot `level` (0 to 1). " +
      "A point's `curve` is how the line gets there from the point before: single (straight, or bent by tension), hold (stays at the last " +
      "value, then jumps here: steps, repeats, gates), double, altSingle, altDouble, stairs, smoothStairs, pulse, wave, halfSine (a tape stop). " +
      "Two points on one beat are a jump. Examples: repeat the first beat all bar: time points { beat 0, back 0 } { beat 1, back 1, hold } " +
      "{ beat 2, back 2, hold } { beat 3, back 3, hold } { beat 4, back 3, hold }; half speed: { beat 0, back 0 } { beat 4, back 2 }; an " +
      "eighth-note gate: volume steps of hold between level 1 and 0 every half beat.",
    inputSchema: obj(
      {
        ...grossRef,
        kind: grossKind,
        slot: grossSlot,
        points: arr(
          obj(
            {
              beat: num("0 to 4: where in the bar."),
              back: num("A time slot's: how many beats back the sound is read from there, 0 (now) to 8."),
              level: num("A volume slot's: its level there, 0 (silent) to 1 (full)."),
              curve: oneOf(CURVE_TYPES, "How the line gets here from the point before (default single)."),
              tension: num("-1 to 1: how the segment bends; for stairs, pulse and wave how many steps or cycles. 0 is straight."),
            },
            ["beat"],
            "A point of the envelope.",
          ),
          "The envelope's points, replacing the slot's.",
        ),
        name: str("The slot's new name."),
        clear: bool("Empty it first."),
        reset: bool("Give it back its preset (its points and name as Gross Beat comes)."),
        pick: bool("Pick it so it plays (default true)."),
      },
      ["kind", "slot"],
    ),
  }),
  tool({
    name: "get_auto_tune",
    title: "Read an Auto-Tune",
    kind: "look",
    description:
      "An Auto-Tune (Antares Auto-Tune Pro's Auto mode, ours, in a mixer track's slot): its input type, key and scale and each note's state " +
      "(tuned to, bypassed: left as sung, removed: never a target), detune, retune speed, humanize, flex-tune, natural vibrato, tracking, " +
      "transpose, formant and throat, classic mode, created vibrato, the preset its sound matches and the presets there are, the key the song's " +
      "notes suggest, and what it heard lately (the notes sung and how far they were corrected) while sound went through it.",
    inputSchema: obj({ ...tuneRef }),
  }),
  tool({
    name: "update_auto_tune",
    title: "Change an Auto-Tune",
    kind: "edit",
    description:
      "Set an Auto-Tune. Retune speed is how fast a note is pulled to its target: 0 ms is the hard-tuned, robotic sound (T-Pain, modern rap), " +
      "10 to 20 tight modern pop, 30 to 80 natural, more is barely there. Humanize slows it on long notes only; flex-tune only corrects what's " +
      "sung near a note (0 corrects everything). Set the key and scale to the song's (or `detectKey`: from the song's notes): a note not in " +
      "the scale is never a target. A preset sets the sound (retune, humanize, flex-tune, vibrato, transpose, formant...) and leaves the key, " +
      "scale and input type; other fields given with it apply after it. A new key or scale resets edited notes, unless `notes` is given.",
    inputSchema: obj({
      ...tuneRef,
      preset: str("A preset's name, applied first (get_auto_tune lists them: Hard Tune, Classic Hard Tune, Robot, Modern Pop, Natural Vocal, Gentle Fix, Ballad, Vibrato Lead, Octave Up, Octave Down, Chipmunk, Monster)."),
      input: oneOf(["soprano", "altoTenor", "lowMale", "instrument", "bass"], "The input type: the voice's range (where pitch is listened for). Alto/Tenor by default."),
      key: { description: 'The key: a note name ("A", "F#", "Bb") or 0 (C) to 11 (B).', anyOf: [{ type: "string" }, { type: "integer" }] },
      scale: oneOf(
        ["chromatic", "major", "minor", "harmonicMinor", "melodicMinor", "dorian", "phrygian", "lydian", "mixolydian", "locrian", "majorPentatonic", "minorPentatonic", "blues", "wholeTone", "diminished"],
        "The scale (chromatic: every note a target).",
      ),
      detectKey: bool("Set the key and scale (major or minor) from the song's notes."),
      notes: {
        type: "object",
        description: 'Notes of the scale to change, by name: { "C#": "remove", "E": "bypass", "G": "tune" }. tune: a target; bypass: passed as sung; remove: never a target. Or "all": "tune" | "bypass" | "remove".',
        additionalProperties: { type: "string", enum: ["tune", "bypass", "remove"] },
      },
      detune: num("Cents, -100 to 100: the tuning reference moved from A4 = 440 Hz."),
      retuneSpeed: num("Milliseconds, 0 to 400 (0: instant, the hard-tuned sound)."),
      humanize: num("0 to 100: retune slowed on sustained notes."),
      flexTune: num("0 to 100: only what's near a note is corrected (0: everything)."),
      naturalVibrato: num("dB, -12 to 12: the singer's vibrato narrower or wider."),
      tracking: num("0 (choosy) to 100 (relaxed): how unclear a pitch may be and still be tracked (50 by default; relax it for breathy or noisy takes)."),
      transpose: int("Semitones, -12 to 12."),
      formant: bool("Keep the voice's formants (its character) when its pitch moves (on by default); off, they move with it (a chipmunk up, a giant down)."),
      throat: num("50 to 180 (100 as sung): the throat modelled longer (deeper) or shorter (brighter). Needs formant on."),
      classic: bool("Classic mode: the Auto-Tune 5 sound, sharper steps between notes (no formant, throat, transpose or flex-tune)."),
      ignoreVibrato: bool("The target note is chosen from the sung pitch's centre, so a wide vibrato doesn't flip between notes."),
      vibrato: obj(
        {
          shape: oneOf(["none", "sine", "square", "saw"], "Its shape (none: off)."),
          rate: num("Hz, 0.1 to 10."),
          delay: num("Milliseconds, 0 to 1500, from a note's start before it begins."),
          onset: num("Milliseconds, 0 to 1500, to come in fully."),
          variation: num("0 to 100: how much its rate and depth wander."),
          pitch: num("Cents, 0 to 100: its depth."),
          amplitude: num("0 to 30: how much the level moves with it."),
          formant: num("0 to 100: how much the formants move with it."),
        },
        [],
        "Create Vibrato: a vibrato added to each tuned note (restarted on every new note).",
      ),
    }),
  }),
  tool({
    name: "list_samples",
    title: "Browse the samples",
    kind: "look",
    description:
      "The Browser: the user's own sample folders (the same in every song) and their favourites; or, given a `folder`, what's in it " +
      "(its subfolders and audio files, with full paths). For a sound by name, search_samples is quicker.",
    inputSchema: obj({ folder: str("A folder's full path: one of the Browser's folders or a folder inside one. Default: the Browser's folders and favourites.") }),
  }),
  tool({
    name: "search_samples",
    title: "Search the samples",
    kind: "look",
    description:
      "Search every audio file and folder in the user's sample folders by name: words in any order, matched in the file's name or its " +
      'folders, small typos forgiven ("808 kick", "snare tight", "vox chop"). The best first, with full paths, which load_sample and preview_sample take.',
    inputSchema: obj({ query: str("What to look for."), limit: int("At most this many results (default 30, up to 200).") }, ["query"]),
  }),
  tool({
    name: "preview_sample",
    title: "Play a sample",
    kind: "action",
    description:
      "Play one of the Browser's audio files to the user once, outside the song (it cuts off the last preview). You can't hear it: ask the user. " +
      'With `stop`, stop the preview instead.',
    inputSchema: obj({ path: str("The file's full path (from search_samples or list_samples)."), start: num("Seconds into the file to start from (default 0)."), stop: bool("Stop the preview playing.") }),
  }),
  tool({
    name: "load_sample",
    title: "Load a sample",
    kind: "action",
    description:
      "Put the user's audio files (the Browser's, by full path) into the song: as the sample of an existing sampler channel (`channel`: its " +
      "sample is replaced, its steps and notes stay), or as new channels, one per file, at the end of the rack. The file is copied into the " +
      "project the first time; using it again reuses the copy.",
    inputSchema: obj(
      {
        paths: arr(str("A file's full path."), "The files (from search_samples or list_samples). With `channel`, only the first is used."),
        channel: str('A sampler channel to give the first file to: its id or its name ("Kick"). Default: new channels.'),
        name: str("A new channel's name (default: the file's name). Only for a single new channel."),
      },
      ["paths"],
    ),
  }),
  tool({
    name: "add_sample_folder",
    title: "Add a sample folder",
    kind: "action",
    description:
      "Add a folder of the user's to the Browser (for every song), so its audio files can be browsed and searched. Only when the user asks for a " +
      "folder: give its full path (~ is their home folder). A folder inside one already added, or a whole drive, is refused.",
    inputSchema: obj({ path: str("The folder's full path.") }, ["path"]),
  }),
  tool({
    name: "star_sample",
    title: "Star a sample",
    kind: "action",
    description: "Add one of the Browser's files or folders to the user's favourites (shown at the top of the Browser), or remove it (`favourite: false`).",
    inputSchema: obj({ path: str("The file's or folder's full path."), favourite: bool("true (the default) to star it, false to unstar it.") }, ["path"]),
  }),
  tool({
    name: "get_playlist",
    title: "Read the playlist",
    kind: "look",
    description:
      "The playlist: the song's arrangement (what plays in song mode). Its tracks (numbered from 1, bound to nothing: any clip goes on any " +
      "track) and every clip on them: its id, what it plays (a pattern, or an audio clip's file), where it starts (a bar, 1 is the first, " +
      "fractions are beats in), how long it is in bars, how far into its content it starts, and whether it's muted. Also the song's length " +
      "and whether the editor plays the pattern or the song.",
    inputSchema: obj({}),
  }),
  tool({
    name: "place_clips",
    title: "Place clips on the playlist",
    kind: "edit",
    description:
      "Put clips on the playlist, to arrange the song. Each is a pattern (by id or name), an audio clip already in the song (its channel, " +
      "from get_playlist; add_audio_clip brings in a new file) or an automation clip (another clip of its curve; add_automation makes one), on a track, at a bar. A pattern clip is as long as its pattern unless `length` " +
      "says otherwise (stretched past its pattern, it plays nothing more); `repeat` places it that many times, one after another. Clips can " +
      "overlap, but keep each part of the arrangement on its own track.",
    inputSchema: obj(
      {
        clips: arr(
          obj(
            {
              pattern: str("A pattern: its id or its name."),
              audio: str("An audio clip's channel: its id or its name."),
              automation: str("An automation clip: its id or its name (from get_automation)."),
              track: playlistTrack,
              bar: num("Where it starts: a bar, 1 for the first (1.5 is half a bar in)."),
              length: num("Its length in bars (default: its pattern's, or the audio clip's)."),
              offset: num("How far into its content it starts, in bars (default 0)."),
              repeat: int("Place it this many times, one after another (default 1)."),
              muted: bool("Muted (default false)."),
            },
            ["track", "bar"],
            "A clip: `pattern`, `audio` or `automation`, a track and a bar.",
          ),
          "The clips to place.",
        ),
      },
      ["clips"],
    ),
  }),
  tool({
    name: "update_clips",
    title: "Change clips on the playlist",
    kind: "edit",
    description:
      "Move clips (to another bar or track: `move_bars` and `move_tracks` move them all together, or `bar` and `track` put one clip there), resize " +
      "them, slip their content, or mute and unmute them. Only what's given changes.",
    inputSchema: obj(
      {
        ids: clipIds,
        bar: num("Where it starts, for a single clip: a bar, 1 for the first."),
        track: playlistTrack,
        move_bars: num("Move them all this many bars later (negative: earlier)."),
        move_tracks: int("Move them all this many tracks down (negative: up)."),
        length: num("Their length in bars."),
        offset: num("How far into their content they start, in bars."),
        muted: bool("Muted, or not."),
      },
      ["ids"],
    ),
  }),
  tool({
    name: "remove_clips",
    title: "Remove clips from the playlist",
    kind: "edit",
    description: "Remove clips from the playlist: by id, or every clip on a track, or every clip of a pattern, audio clip or automation clip. The patterns (and curves) themselves stay.",
    inputSchema: obj({
      ids: clipIds,
      track: playlistTrack,
      pattern: str("Every clip of this pattern (id or name)."),
      audio: str("Every clip of this audio clip (its channel's id or name)."),
      automation: str("Every clip of this automation clip (id or name)."),
    }),
  }),
  tool({
    name: "slice_clips",
    title: "Slice clips",
    kind: "edit",
    description: "Cut clips in two at a bar (FL's slice tool): every clip crossing it, on the tracks given (default: every track). Each part plays its part of the content.",
    inputSchema: obj({ bar: num("Where to cut: a bar, 1 for the first (fractions are beats in)."), tracks: arr(playlistTrack, "The tracks (default: all).") }, ["bar"]),
  }),
  tool({
    name: "chop_clips",
    title: "Chop clips",
    kind: "edit",
    description: "Chop clips into pieces (FL's clip menu's Chop): each clip is cut at every bar, beat or step of the song inside it. Each piece plays its part of the content.",
    inputSchema: obj({ ids: clipIds, every: oneOf(["bar", "beat", "step"], "Where to cut: every bar, every beat or every step (a sixteenth).") }, ["ids", "every"]),
  }),
  tool({
    name: "split_by_channel",
    title: "Split a pattern by channel",
    kind: "edit",
    description:
      "FL's Split by channel: the pattern is replaced by one pattern per channel that has notes in it (each named after its channel), and each " +
      "of its clips on the playlist by one clip per channel, on its track and the free tracks below. Use it to arrange the parts of a beat on " +
      "tracks of their own. The user can undo it.",
    inputSchema: obj({ pattern: str("The pattern: its id or its name.") }, ["pattern"]),
  }),
  tool({
    name: "make_clip_unique",
    title: "Make a clip unique",
    kind: "edit",
    description:
      "Give a pattern clip a copy of its pattern of its own (\"Verse #2\"), so editing it changes no other clip; an audio clip a channel of its own " +
      "(FL's Make unique as sample: the same file), so its pitch or volume can change without the other clips'.",
    inputSchema: obj({ id: int("The clip's id.") }, ["id"]),
  }),
  tool({
    name: "update_playlist_track",
    title: "Change a playlist track",
    kind: "edit",
    description:
      "Rename a playlist track, colour it, mute or solo it (a muted track's clips are silent), change its height, or insert an empty track before " +
      "it, delete it (and its clips) or move it up or down (with its clips). Only what's given changes.",
    inputSchema: obj(
      {
        track: playlistTrack,
        name: str("A new name (empty: back to \"Track N\")."),
        color: str('A colour, "#rrggbb", or "" for none.'),
        muted: bool("Muted, or not."),
        solo: bool("Solo it (every other track is muted; soloing the one already alone unmutes them all)."),
        size: num("Its height, 0.25 to 4 times the usual."),
        insert: bool("Insert an empty track before it (it and those below move down)."),
        delete: bool("Delete it and its clips (those below move up)."),
        move: oneOf(["up", "down"], "Move it a place up or down, with its clips."),
        audioTrack: mixerTrack('Make it an audio track (FL\'s) of this mixer track: its takes land on it and its header shows the track\'s arm. "none" makes it an ordinary track again'),
      },
      ["track"],
    ),
  }),
  tool({
    name: "add_audio_clip",
    title: "Add an audio clip",
    kind: "action",
    description:
      "Put audio files on the playlist as audio clips (FL's): a vocal, a loop, a whole song. Each gets a channel of its own (in the rack's " +
      "Audio group, routed to a mixer track like any channel) and a clip as long as the file, streamed from disk when it plays. Files from " +
      "the Browser (by full path), or already in the project (`mediaId`). Several are placed on the tracks below each other, or one after " +
      "another on one track (`after`).",
    inputSchema: obj(
      {
        paths: arr(str("A file's full path."), "The Browser's files (from search_samples or list_samples)."),
        mediaId: str("An audio file already in the project (from get_song)."),
        track: playlistTrack,
        bar: num("Where it starts: a bar, 1 for the first."),
        after: bool("Several files one after another on the track (default: each on the track below)."),
      },
      ["track", "bar"],
    ),
  }),
  tool({
    name: "get_automation",
    title: "Read the automation",
    kind: "look",
    description:
      "The song's automation clips (FL's): curves over time for one control each (a volume, a pan, a send, an effect's mix, a plugin's parameter), " +
      "placed on the playlist as clips. For each: what it drives, its points (bars from its start, values as the control shows them, each segment's " +
      "curve type), its range and LFO, and its clips. Automation plays in song mode only.",
    inputSchema: obj({ automation: automationRef }),
  }),
  tool({
    name: "list_controls",
    title: "List what can be automated",
    kind: "look",
    description:
      "The controls of the song that can be automated: the main volume, each channel's volume and pan, the mixer's faders, pans, stereo separation, " +
      "sends and effects' mixes, and the plugins (plugin channels and mixer effects). With a plugin (`channel`, or `track` and `slot`), its own " +
      "parameters, as the plugin names them, with their values now (only once it's loaded); `query` narrows them (\"cutoff\").",
    inputSchema: obj({
      channel: str("A plugin channel: its parameters."),
      track: mixerTrack("A mixer track, with `slot`: the effect there's parameters"),
      slot: int("An effect slot of the track, 1 to 10."),
      query: str("Words to look for in the parameters' names."),
    }),
  }),
  tool({
    name: "add_automation",
    title: "Automate a control",
    kind: "action",
    description:
      "FL's Create automation clip: make an automation clip for a control and put it on the playlist (a track below the others, or `playlistTrack`), " +
      "from `bar` for `length` bars (default: the whole song). Without `points` it's flat at the control's value now; with them, it follows them " +
      "(e.g. a filter sweep: [{at: 0, value: 0.1}, {at: 8, value: 0.9, curve: \"single\", tension: 0.4}]). It plays in song mode only: before it the " +
      "control is its own value, after it it holds its last value. A plugin parameter is named by `parameter` (list_controls has them).",
    inputSchema: obj(
      {
        ...controlFields,
        bar: num("Where the clip starts: a bar, 1 for the first (default 1)."),
        length: num("How long it is, in bars (default: to the song's end)."),
        playlistTrack,
        points: automationPoints,
        name: str("Its name (default: the control's, as \"Volume (Kick)\")."),
      },
      ["control"],
    ),
  }),
  tool({
    name: "update_automation",
    title: "Change an automation clip",
    kind: "edit",
    description:
      "Change an automation clip's curve (`points`, replacing them all), its range (`min`/`max`, fractions of the control's range: FL's Min / Max), " +
      "its LFO (an oscillator added to the curve, or multiplying it), its length, its name or colour; run one of FL's tools on it (flip, normalize, louder, " +
      "quieter, decimate, smooth); or delete it with its clips (`remove`). Every clip of it changes: make_clip_unique gives one a curve of its own.",
    inputSchema: obj(
      {
        automation: automationRef,
        points: automationPoints,
        min: num("0 to 1: the bottom of its range, of the control's."),
        max: num("0 to 1: the top of its range."),
        lfo: obj({
          enabled: bool("On or off."),
          speed: num("Cycles a bar, 1/16 to 32."),
          tension: num("-1 (peaky) to 1 (square); 0 a triangle."),
          skew: num("0 to 1: where in its cycle it peaks (0.5 even; the ends are saws)."),
          level: num("-1 to 1: how much of it (negative: upside down)."),
          multiply: bool("It scales the curve (a volume) rather than adding to it (a pan)."),
        }),
        length: num("Its curve's length, in bars."),
        name: str("A new name."),
        color: str('A colour, "#rrggbb", or "" for the usual.'),
        tool: oneOf(["flip", "normalize", "louder", "quieter", "decimate", "smooth"], "One of FL's tools on its curve."),
        remove: bool("Delete it and every clip of it."),
      },
      ["automation"],
    ),
  }),
  tool({
    name: "play_song",
    title: "Play or stop",
    kind: "action",
    description:
      "Start playing or stop, so the user hears it (you can't hear it yourself). `mode` chooses what plays, as the toolbar's PAT / SONG does: " +
      "the pattern shown, looped (\"pattern\"), or the playlist (\"song\", from `bar`, going round at its end). Default: as the editor is.",
    inputSchema: obj({ action: oneOf(["play", "stop"], "What to do."), mode: oneOf(["pattern", "song"], "What plays."), bar: num("In song mode, the bar to play from (1 is the start).") }, ["action"]),
  }),
  tool({
    name: "export_song",
    title: "Export the song",
    kind: "action",
    description:
      "Render the open song to files, as the export window does (⌘R): the playlist (\"song\") or the pattern shown (\"pattern\"), in any of " +
      "WAV, MP3, FLAC, OGG, M4A and MIDI (the notes), with `stems` a file per mixer track too, all from one render (seconds, much faster than real time). " +
      "If the user has a time selection on the Playlist (song) or the Piano roll (pattern), only that part is exported. The export window opens and lists " +
      "the files for the user to download or show in Finder. Settings left out are the user's last ones. Playback stops while it renders; editing can go " +
      "on. Answers with the files, their sizes, how long it took and anything that couldn't be heard (a plugin not installed).",
    inputSchema: obj({
      formats: arr(oneOf(EXPORT_FORMATS, "A format."), "The formats to write (default: the user's last ones, at first WAV)."),
      mode: oneOf(["song", "pattern"], "The playlist, or the pattern shown."),
      tail: oneOf(["cut", "ring"], "Stop on the song's last sample, or let reverbs and long notes ring out until it's quiet."),
      stems: bool("A file for each mixer track that has sound, besides the mix."),
      wavBits: int("WAV bit depth: 16, 24 or 32 (floating point)."),
      mp3Bitrate: int("MP3 kilobits a second, 64 to 320."),
      preventClipping: bool("Turn the whole render down if it goes over full scale, so it doesn't clip (default: on)."),
    }),
  }),
] as const satisfies readonly ToolSpec[];

export type MusicToolName = (typeof MUSIC_TOOLS)[number]["name"];

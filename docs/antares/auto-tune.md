# Auto-Tune

Antares **Auto-Tune Pro**'s Auto mode, from Antares' own manuals (Auto-Tune Pro 11, Pro X, the 2018
Auto-Tune Pro guide, and Auto-Tune 7 and 8, whose wording and ranges the Pro manuals keep without
restating them), and what producers use it for: the hard-tuned sound (T-Pain, modern rap and pop) at
Retune Speed 0, and transparent correction at slower speeds. The last sections are ours: [what's
decided](#decided), [where Vaudio differs](#where-vaudio-differs) and [how it's built](#how-its-built).

Sources: [Auto-Tune Pro 11 User Guide](https://antares-web-frontend.sfo3.cdn.digitaloceanspaces.com/documentation/pdfs/Auto-Tune_Pro_11_User_Guide.pdf),
[Auto-Tune Pro X User Guide](https://antares-web-frontend.sfo3.cdn.digitaloceanspaces.com/documentation/pdfs/Auto-Tune_Pro_X_User_Guide_Version_10.3.1.pdf),
[Auto-Tune 8 Owner's Manual](https://images.equipboard.com/uploads/item/manual/51166/antares-auto-tune-8-manual.pdf).
Anything neither in them nor confirmed by Théo is marked **(unverified)**.

## What it is

- An effect on a vocal (or a monophonic instrument): it hears the pitch, decides the note it should be
  and moves it there. "At any given moment, the target pitch will be the active scale tone that is
  closest to the detected input pitch."
- **Auto mode** does it as the sound goes through, from the key and scale and its knobs. (Graph mode,
  note-by-note editing on a timeline, is the other half of Auto-Tune Pro: not here, see below.)

## The controls

| Control | Range | Default | What it does |
| --- | --- | --- | --- |
| Input Type | Soprano, Alto/Tenor, Low Male, Instrument, Bass Instrument | (unverified) | The voice's range: where it listens for a pitch. Detection reaches C6; all but Bass down to A1 (55 Hz); Bass down to 25 Hz, unreliable above A4 |
| Key | C .. B | (unverified) | The scale's first note |
| Scale | Chromatic, Major, Minor, Harmonic Minor, Jazz Melodic Minor, Dorian, Phrygian, Lydian, Mixolydian, Locrian, Major / Minor Pentatonic, Blues, Whole Tone, Diminished (Pro 11's "modern" set) | | The notes it tunes to |
| Detune | ±100 cents (shown in Hz too) | 0 (A4 = 440 Hz) | Moves the tuning's reference |
| Tracking | Choosy .. Relaxed | 50 | How much a waveform may vary and still be a pitch: relaxed for breathy or noisy takes; choosier if it clicks |
| Retune Speed | 0 .. 400 ms (400 unverified) | 20 | How fast a note is pulled to its target. "A value of zero will cause instantaneous changes from one tone to another and will completely suppress a vibrato." 10–50 typical for vocals; 0–5 the robotic effect |
| Humanize | 0 .. 100 | 0 | "Lets you apply a slower Retune Speed just to the sustained notes": short notes snap, long ones keep their life |
| Flex-Tune | 0 .. 100 | 0 | "When Flex-Tune is engaged, it only applies correction as the performer approaches the target note. As you move the control toward higher values, the correction area around the scale note gets smaller" |
| Natural Vibrato | ±12 (dB unverified) | 0 | Narrows or widens the singer's own vibrato, separately from correction (it works on bypassed notes too) |
| Transpose | ±12 semitones | 0 | Moves the tuned pitch |
| Formant | on / off | off (unverified) | Keeps the voice's resonances from shifting with its pitch |
| Throat Length | 50 .. 180 | 100 | With Formant on: above 100 a longer throat (deeper), below a shorter one (brighter) |
| Classic Mode | on / off | off | The Auto-Tune 5 sound: brighter, a sharper attack between notes at fast speeds; turns off Formant, Throat, Transpose and Flex-Tune |
| Mix | 0 .. 100 | 100 | Dry against processed (Pro X and later) |

**The Pitch Change meter**: the correction in cents, ±100; "if the indicator bar has moved to the left
to −50, it indicates that the input pitch is 50 cents too sharp and Auto-Tune is lowering the pitch by 50
cents." Pro 11 lights sharp orange (left) and flat blue (right). **Hold** freezes it. The **Pitch
Display** names the note being output; the **keyboard** shows the detected pitch in blue and each key's
state: On, Bypass (orange) or Remove (grey).

**Edit Scale**: each note On, **Bypass** (passed through uncorrected) or **Remove** (never a target: the
next closest scale note is), the same in every octave; Set All, Bypass All, Remove All, Set Major / Set
Minor. **Targeting Ignores Vibrato** stops a wide vibrato switching the target to the next note.

**Create Vibrato** (applied after the Retune Speed, restarted on every new target note):

| Control | Range | Default |
| --- | --- | --- |
| Shape | None, Sine, Square, Sawtooth | None |
| Rate | 0.1 .. 10 Hz | 5.5 Hz |
| Variation | 0 .. 100 (random change to rate and amount, note to note) | 20 |
| Onset Delay | 0 .. 1500 ms from the note's start | 500 ms |
| Onset Rate | 0 .. 1500 ms to full depth | 500 ms |
| Pitch Amount | 0 .. 100 cents | 18 |
| Amplitude Amount | 0 .. 30 | 10 |
| Formant Amount | 0 .. 100 | 70 |

**MIDI**: Target Notes via MIDI (the held notes are the scale), Learn Scale from MIDI. **Low Latency**
trades quality for a smaller delay, for tracking live.

## Decided

Built from Théo's request (2026-10-02: "an actual pro-quality auto-tune… select the key, the tune range,
the amount of tunage… tune level max by default, alto tenor by default"; the agent should be able to use
it). What was chosen, to check with him:

- **A stock effect of ours**, like Gross Beat: chosen from an effect slot's picker (Built in →
  Auto-Tune), its settings **in the song** (undone, saved, read and set by the assistant).
- **Defaults**: Alto/Tenor, **Retune Speed 0** (hard-tuned, as asked; Antares' is 20), Humanize and
  Flex-Tune 0, C **Chromatic** (every note a target, so it works on any song until its key is set),
  **Formant on** (Antares' is off: on, Transpose keeps the voice's character, and it costs nothing here).
- **Its window** is Auto-Tune Pro's Auto mode in our look, plus what Auto mode lacks before AutoTune
  2026: a **live pitch graph** (the last five seconds, sung against tuned, over a keyboard of the scale).
- **Detect key**: the song's key from its own notes (Krumhansl–Schmuckler, drums left out), a button and
  the assistant's `detectKey`. Antares sells key detection separately (Auto-Key, from audio); ours reads
  the song.
- **Presets** of our own (Hard Tune, Classic Hard Tune, Robot, Modern Pop, Natural Vocal, Gentle Fix,
  Ballad, Vibrato Lead, Octave Up / Down, Chipmunk, Monster). A preset sets the sound, never the key, scale
  or voice.
- **Mix** is the slot's mix knob (every effect slot has one); its dry sound is held back as long as the
  tuned sound, so it doesn't comb.

## Where Vaudio differs

| What | Auto-Tune Pro | Vaudio |
| --- | --- | --- |
| Graph mode (note-by-note editing, time correction) | Yes | Not yet |
| Target Notes / Learn Scale via MIDI | Yes | Not yet: effects hear no MIDI (MIDI input is a later step) |
| Low Latency mode | Yes | No: it always looks ahead (about 50 ms for Alto/Tenor at 48 kHz, more for lower voices), and the mixer compensates |
| Scales | The modern set, plus 29 legacy ones (microtonal, historical temperaments) | The modern set (12-note scales) |
| Input Type Learn, Vocal Range Auto Detect | Yes | No: chosen by hand |
| Detect key | Auto-Key, a separate plugin, from audio | From the song's notes |
| Automating | Every parameter | Every knob: Retune Speed, Humanize, Flex-Tune, Natural Vibrato, Transpose, Throat, Detune, Tracking, Create Vibrato's seven, and the key (song mode, as all automation). Not the switches (Formant, Classic, the input type, the scale) |
| Pitch graph in Auto mode | AutoTune 2026's | Ours, from Pro 11's meter colours |

## How it's built

- **The document**: `MixerEffect.autoTune` (`shared/music/types.ts`) on an effect whose plugin is
  `AUTO_TUNE_PLUGIN` (`vaudio:auto-tune`): the input type, key, scale and each pitch class's note (`notes`:
  the scale's until edited; a new key or scale makes them again), the knobs in their own units (ms, dB,
  semitones; 0..1 for Auto-Tune's 0–100 amounts; throat 0.5..1.8), Classic, Ignore vibrato, Create
  Vibrato. Validated by `normalizeAutoTune`; constants, scales, presets and the controls' ranges in
  `auto-tune-presets.ts`; edits, presets, `detectKey` and what the engine gets (`engineAutoTune`: Tracking
  as YIN's threshold, Detune as A4's Hz, Natural Vibrato as a gain, the input type as Hz) in
  `auto-tune.ts`. Tested.
- **Compiling** (`compile.ts`): `EngineEffect.autoTune`; its automatable controls as lanes
  (`kind: "tune"`, in the engine's units by `engineControlValue`), set at each slice's start.
- **The engine** (`engine/src/AutoTune.cpp`), a native effect in its slot, its state kept across songs
  by effect id (`tune::Registry`; the export has its own):
  - **Hearing the pitch**: the mono sum, DC removed, low-passed (4th-order Butterworth) and decimated to
    about 12 kHz; every ~2.7 ms YIN over two of the lowest periods, the first dip under Tracking's
    threshold, parabolic, then refined at the full rate around it; a pitch an octave from the last is
    checked against the last; three frames' hangover inside a note. Each frame is timed at the middle of
    what YIN compared, less the filter's delay (a vibrato's timing matters to the cent).
  - **Deciding the note** (per frame): Natural Vibrato scales what moves around a slow follower of the
    pitch; the target is the nearest note not removed (hysteresis of 0.12 semitones, none in Classic;
    from the follower with Ignore vibrato); bypassed notes aren't pulled; Flex-Tune fades the pull out
    away from the note; Retune Speed is a one-pole glide reaching the note in its time, Humanize slowing it
    on a note's sustain; Create Vibrato after it, restarted on each new note; Transpose last.
  - **Moving it**: TD-PSOLA. Analysis marks a period apart, each nudged to where the waveform after the
    last one comes again, **to a fraction of a sample** (whole samples drift a few cents). Grains
    (Hann, two periods) are laid down a tuned period apart, from the mark nearest; that period comes from
    the same frame as the ratio, so the output pitch is exactly the target's. Each grain resampled by a
    stretch: the throat with Formant on, the inverse ratio with Formant off (formants move with the
    pitch), gain-compensated. Unpitched sound and untouched notes take each mark's grain back where it
    was: the sound as it is.
  - **Latency**: fixed by the input type (the longest grain, stretched as far as it goes, from the
    nearest mark, and two frames' slack), reported to `Song::compensate`; the dry sound for the mix is
    read as late.
  - **What it says**: its latest readings (sung, tuned, target; every ~5 ms) in each transport event
    (`EngineTransport.autoTunes`).
  - Tested offline to the cent (`server/music/auto-tune.integration.test.ts`): a sung vowel 39 cents
    sharp tuned to A3 within a cent, compensated and exported in time, key, removed and bypassed notes,
    Detune, Retune Speed, a ±40-cent vibrato flattened to ±1.2 at 0 ms, Flex-Tune, transpose with and
    without Formant, Throat, Create Vibrato, noise passed through, level, the mix.
- **The tab** (`src/suites/music/auto-tune/`): `auto-tune-window.tsx` (the window, opened from the slot's
  name), `pitch-history.ts` (the readings, outside React, timed for smooth scrolling), `draw.ts` +
  `geometry.ts` (the graph and the meter, drawn every frame), `actions.ts`, `store.ts` (open windows; the
  panel shown, Hold), `tool-edits.ts` (`get_auto_tune`, `update_auto_tune`; `add_mixer_effect` takes
  "Auto-Tune", `add_automation` its controls). Its colours are theme tokens (`--tune-*`; the tuned line
  is the accent).

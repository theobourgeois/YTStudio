# Pitch Wheel

QuikQuak's **Pitchwheel** (by Dave Hoskins), from its own [User guide, version 5.2](https://www.quikquak.com/media/Pitchwheel/Pitchwheel_User_Guide_5.pdf)
and [product page](https://www.quikquak.com/Prod_Pitchwheel.html), and Théo's screenshot of it (2026-10-02). The last
sections are ours: [what's decided](#decided), [where Vaudio differs](#where-vaudio-differs) and
[how it's built](#how-its-built). Anything in neither the guide nor the screenshot is marked **(unverified)**.

## What it is

"The Pitchwheel plug-in freely alters the pitch of a sound without changing its length." A pitch shifter
played by hand: a great big wheel, turned like a dial (a click and drag from anywhere inside the circle),
and a second wheel for the **timbre** (the sound's spectral envelope: its formants). "The user pointer acts
as a desired pitch change, and the actual pitch is produced by gravity and inertia controls. Pitchwheel
moves towards the desired pitch at sample accuracy." "A DJ turntable feel can be created, but … the tempo
remains the same." Mono and stereo; MIDI notes play it (eight-note chords: vocal harmonies from one take).

Uses from the guide: tuning and vibrato, huge swings ("massive ranges can be achieved by swinging the
dial"), Doppler effects, odd alien sounds and character changes, pitching vocals without the chipmunk
sound (the Timbre wheel at 0), helium voices (Pitch at 0, Timbre up), thickening a drum loop (several keys
held near the origin), harmonies laid out as MIDI notes in the host.

## The controls

The window is two panels side by side: **Pitchwheel** (left) and **Timbrewheel** (right), each a big wheel
with **Range** (top left) and **Snap** (top right) above it and three blue knobs under it: **gravity**,
**inertia**, **smooth**. Between them a vertical **Timbre** tab, **On** when the Timbre panel is open. Under
the Pitchwheel: **info** (Off/On), the **MIDI** light and **Single / Multi**, the input keyboard, the
**input** light and the **mix** knob.

| Control | Range | What it does |
| --- | --- | --- |
| The wheel (pointer) | 270°, left to right; the Range's semitones across it | "This wheel controls the pitch." The triangular pointer "always reflects the user position of the wheel". Fractions of a semitone with Snap off |
| Range | 48, 24, 12, 6, 4, 2 semitones | What the 270° covers: "These ranges enable the user to increase accuracy while mouse operating." The ticks around the wheel change with it. (Screenshot: Range 24 reads −12 … +12, Range 12 reads −6 … +6) |
| Snap | On / Off | "The glowing light always remains at exact semi-tone values near the pointer": the wheel quantised to the nearest semitone |
| Inner ring indicator | all the way round | "A glowing ring that is brighter at one point": **the actual note the effect is playing**, which lags, overshoots and swings past the pointer as gravity, inertia and smooth have it. "This pointer can spin all around the dial" |
| Centre display | | The actual pitch offset value (e.g. `2.00`). Right-click (Ctrl-click) it to type a value: "The wheel will instantly jump to that value, ignoring any gravity or inertia values" |
| Gravity | knob | "The amount of influence the user's wheel position has on the actual pitch. Set high values and the pitch will be clamped hard to the user position … a piece of elastic tied between the actual pitch and the user's pitch. Set at low levels the elastic is weak, the pitch will swing wildly until settling down on the desired pitch value." (Once called Dampen.) |
| Inertia | knob | "The speed at which the actual pitch heads towards the user pointer. … you will only see this effect when Gravity is set to low values … high valued Gravity overrides Inertia by clamping the pitch to the pointer all the time." |
| Smooth | knob | "The reaction time for the underlying values of the user pointer … smooths out the user pointer locations … nice transitions between pitches." "Using high smooth values will override the gravity and inertia controls." Keep it at a minimum for inertia play |
| Timbre (tab) | open (On) / closed | Open: the Timbrewheel sets the spectral envelope on its own; closed: "normal pitch shifting mode", the formants move with the pitch (the chipmunk). Replaced the old Lock button that tied the wheels together |
| Timbrewheel | as the Pitchwheel | "Acts exactly the same as the Pitchwheel", with its own Range, Snap, gravity, inertia, smooth. At 0 the formants stay where they are ("natural vocal pitch changes"); up with Pitch at 0, the helium voice |
| Mix | knob | "The output mix between the original source and the effected audio. The original signal is delayed to match the effected output." |
| MIDI: Single / Multi | | Single: "its normal state is to always transform incoming audio"; the MIDI note sets the pitch offset ("Mono - Constant: the first singular MIDI note sent will determine the pitch offset"). Multi ("8 Channel MIDI"): "you will not hear any incoming audio until a note is played", up to 8 notes at once, "8 times the input signal" |
| Input keyboard | | Shows the current offset, the **origin** note and every incoming MIDI note. The origin "is the zero offset origin note, and all pitch changes are relative to this note. Click on it to change the value": origin F4 and F#4 played is a semitone up. The origin is a small blue dot; the actual offset is the highlighted key |
| input light | | "Just shows you if there's any incoming audio" (in Multi with no notes, the centre's glow says so) |
| MIDI light | | Any acceptable MIDI input (note on, pitch bend) |
| info | Off / On | (unverified: help text over the controls) |

The wheel and MIDI add up: "At the same time as playing the sample on the keyboard the wheel [can] also be
moved to create vocal slides." "You can use extremes of pitch change when using MIDI, and combined with low
Gravity values causes it to go a little crazy."

**The swing experiment** (the guide's): gravity lowest, the rest at their defaults; swing the wheel to the
extreme right and the inner ring flies straight past the arrow; as it slows, spin the wheel all the way left
and it accelerates down; "keep going left and right in this swinging action and you can achieve huge octave
leaps in pitch".

**Latency**: 2048 samples below 48 kHz, 4096 up to 96 kHz, 8192 above (46 ms at 44.1 kHz).

**Defaults** (unverified, read off the screenshots): gravity about two-thirds, inertia about half, smooth
near its minimum; Pitch Range 24 (12 in the guide's picture), Snap on; Timbre On, its Range 12, Snap on.

## Decided

Built from Théo's request (2026-10-02: "recreate it in our UI style … make it sound perfect … make the
pitch logic and engineering better than the actual Pitchwheel"). To check with him:

- **A stock effect of ours**, like Auto-Tune: Built in → Pitch Wheel in an effect slot's picker; its
  settings **in the song** (undone, saved, automated, read and set by the assistant).
- **The same controls and the same behaviour**: the two wheels, Range (2–48), Snap, gravity, inertia,
  smooth on each, the Timbre tab, Single / Multi, the origin, the keyboard, the typed jump, the mix (the
  slot's mix knob, shown in the window; its dry sound delayed to match).
- **Timbre opens by default** (as in Théo's screenshot): turning Pitch then keeps the voice's character.
  Closing it is the classic, tape-like shift.
- **Its notes come from a channel of the song** (`notesFrom`): effects hear no MIDI yet, so a Pitch
  Wheel *follows* a channel's notes (FL does this with a MIDI Out channel). Mute that channel to hear only
  the harmonies. The window's keyboard plays it too: hold keys with the mouse while the song plays.
- **Better than Pitchwheel** (Théo asked for it), each one tested offline:
  - **Phase-locked shifting** (Laroche and Dolson's): each spectral peak and the bins around it move as
    one, at the exact new frequency (by a fraction of a bin: the window's lobe rebuilt between bins, not
    rounded to whole ones, so glides don't step and nothing beats at the hop's rate). A sine shifted is a
    sine, to the cent; at 0 the sound comes out exactly as it went in.
  - **Stereo stays put**: both sides share one set of phase decisions, so the image doesn't smear.
  - **Transients kept**: a drum hit resets the phases, so it lands as sharply as it came.
  - **A true spectral envelope** for the Timbre wheel (an iterated cepstrum whose detail follows the
    pitch it hears: half its period), so formants close together stay apart and don't pick up the
    harmonics; one gain per partial, and the loudness kept (the wheel changes the colour, not the level).
  - **Sample-accurate moves**: the physics run every sample and each frame's phase advance is the integral
    of the pitch over its hop, so glides and swings don't step.
  - **Sample-accurate notes**: in Multi each note is its own shifted copy, gated on its very sample with
    a 3 ms fade (no clicks), velocity as its level.
  - **Snap to octaves** as well as semitones (DJ jumps); **Resolution**: **Wide by default** (4096
    samples, ~85 ms at 48 kHz, compensated: notes 45 Hz apart stay apart, a shifted chord's other sound
    55 dB down, drum hits still 38 dB clean ahead) or Tight (Pitchwheel's 2048, ~43 ms: for playing it
    live; close notes blur, about 18 dB down).
  - **Seamless modes**: Single's voice is always made, so Single and Multi change over at once.
  - **Presets**.
- **How the physics are modelled** (ours; the guide only describes them): Smooth is a one-pole follower
  of the target (0 to 1.5 s); the actual pitch is a mass on a spring towards it. Inertia sets the spring's
  natural frequency (30 Hz at 0, 0.25 Hz at 1); Gravity its damping (ζ 0.02, a near-endless swing, up to
  critical) and stiffness (×41 at the top), and at 1 it clamps outright. The actual pitch stops at ±48
  semitones.

## Where Vaudio differs

| What | Pitchwheel | Vaudio |
| --- | --- | --- |
| MIDI | Notes and pitch bend sent to the plug-in | A channel's notes (`notesFrom`), and the window's keyboard; no pitch bend (effects hear no MIDI yet) |
| Snap | On / Off | Off, Semitone, Octave |
| Latency | Fixed by the sample rate | Wide (twice Pitchwheel's, the default) or Tight (Pitchwheel's) |
| info | Help over the controls | Hover hints (every control has a title) |
| Stereo | (unverified) | One set of phase decisions for both sides |
| Automation | Every parameter (host) | Both wheels and their gravity, inertia, smooth (song mode, as all automation) |
| Presets | None | Ours |
| The window | QuikQuak's skin | Our look, in each theme |

## How it's built

- **The document**: `MixerEffect.pitchWheel` (`shared/music/types.ts`) on an effect whose plugin is
  `PITCH_WHEEL_PLUGIN` (`vaudio:pitch-wheel`): `pitch` and `timbre` (each a `Wheel`: value, range, snap,
  gravity, inertia, smooth), `timbreOn`, `midiMode`, `notesFrom`, `origin`, `resolution`. Validated by
  `normalizePitchWheel`; constants, defaults (Wide), presets and the controls' ranges in `pitch-wheel-presets.ts`;
  edits, presets, the physics (`stepWheel`, also run by the window when the engine is silent) and what the
  engine gets (`enginePitchWheel`) in `pitch-wheel.ts`. Tested.
- **Compiling** (`compile.ts`): `EngineEffect.pitchWheel` (its notes' channel by id); its automatable
  controls as lanes (`kind: "wheel"`).
- **The engine** (`engine/src/PitchWheel.cpp`), a native effect in its slot, kept across songs by effect id
  (`wheel::Registry`; the export has its own):
  - **Physics**, every sample, in the input's time: each voice's target (the wheel, snapped, plus its
    note less the origin) through Smooth, then the spring; the Timbre wheel the same. A ring of each
    voice's pitch per sample, which frames read.
  - **Analysis**: a Hann-windowed, zero-phase FFT of each side every hop (an eighth of the window); peaks
    of the two sides' summed power; each peak's true frequency from its phase advance.
  - **Shifting**: each peak's region moves to the new frequency by its exact (fractional) number of bins,
    the complex spectrum read between bins by Catmull-Rom (the padding makes it smooth), turned by a phase
    that advances by the hop's integral of (ratio − 1) × the peak's frequency, carried from the region the
    peak was in last frame (Laroche and Dolson's identity phase locking). The same turn on both sides.
    Onsets (the energy above 1.5 kHz up 4 dB on the last frame, at most once a window) reset the phases
    of what's above 250 Hz.
  - **Timbre**: the envelope of the two sides' power on a 60 dB floor, a true envelope (Röbel and
    Rodet's: cepstrum, liftered, raised to the peaks, eight times); the lifter at 0.55 of the pitch period
    the cepstrum shows (1 to 8 ms; 1 ms with no clear pitch), gliding frame to frame. Each partial's region
    scaled by the envelope where the Timbre wheel wants it at its new frequency over the envelope it
    brought (±24 dB at most), then all of them back to the frame's loudness (gliding). Closed, nothing is
    done: the formants move with the pitch.
  - **Voices**: the first is Single's, always made (gated shut in Multi, so the modes change over at
    once); Multi has one a note (eight held at most, twelve slots for their tails), each synthesised from
    the same analysis and gated on its sample (3 ms fades) after the frames. A new voice starts where it's
    going (a chord's notes don't scoop in).
  - **Latency**: the window (2048 or 4096 samples at 48 kHz, scaled with the rate), reported to
    `Song::compensate`; the dry sound for the mix is read as late.
  - **Live**: `pitchWheel` commands hold the wheels where the hand is while it drags (renewed, they lapse
    a quarter-second after the last), jump, and play the keyboard's notes.
  - **What it says**: the actual pitch and timbre, each note's voice, whether sound comes in, in each
    transport event (`EngineTransport.pitchWheels`).
  - Tested offline (`server/music/pitch-wheel.integration.test.ts`): exact at 0 (to -80 dB), shifts to
    a cent with the level kept, snapping, formants kept, moved and moved alone, stereo correlation kept
    (-0.999), drum hits 20 dB clean ahead, a chord's other sound under -48 dB (Wide), the physics as
    `stepWheel` says (the swing's peak within a semitone and 40 ms), Multi's voices on their sample and
    silent without notes, Single following notes and holding, latency, bypass and the mix in time, the
    hand's hold and jump. It runs at about 70 times real time (Multi with four notes, 40).
- **The tab** (`src/suites/music/pitch-wheel/`): `pitch-wheel-window.tsx` (the window), `dial.tsx` (a
  wheel), `geometry.ts` (angles, ticks; tested), `live.ts` (what the rings show: the engine's readings,
  or the physics run here when it's silent), `actions.ts`, `store.ts`, `tool-edits.ts`
  (`get_pitch_wheel`, `update_pitch_wheel`; `add_mixer_effect` takes "Pitch Wheel", `add_automation` its
  controls). Its colours are theme tokens (`--wheel-*`).

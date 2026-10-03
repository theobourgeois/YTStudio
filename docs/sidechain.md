# Sidechaining

How one track's sound (or a channel's notes) shapes another's, for every effect and every control. Built
2026-10-03 at Théo's request ("general sidechaining … the best UX, best industry standard", not only FL's
way). Read with `docs/fl-studio/mixer.md` (sends, delay compensation) and `docs/fabfilter/pro-c.md` 8.3
(the first external key, which this generalises).

## What the DAWs do

| DAW | Audio key into an effect | Modulation from a level |
| --- | --- | --- |
| **FL Studio** | Make a send at 0% ("Sidechain only to this track"), then pick it in the plugin (Fruity Limiter's SC number, a VST's wrapper input). Two steps, in two places | **Fruity Peak Controller** on the source track (Base, Volume, Tension, Decay; an LFO), then *Link to controller* on any knob |
| **Ableton Live** | The device's own Sidechain section: *Audio From* any track, *Pre FX / Post FX / Post Mixer* | Envelope Follower (Max for Live), mapped to any parameter |
| **Logic Pro** | The plugin header's *Side Chain* menu: any track, bus or input | — |
| **Bitwig** | The device's sidechain picker | *Audio Sidechain* and *Note* modulators, added to any parameter's value (a ring shows the range) |
| **Pro Tools / Studio One** | The plugin's key input menu (a bus) / the plugin header's sidechain button | — |

They agree on three things, which are ours:

1. **The source is chosen on the effect**, in one step. No send to make first; the routing follows.
2. **Two tools**: an *audio key* (the effect hears another track: the best ducking, a compressor's own
   attack and knee) and *modulation* (a level drives any control: pumping a filter, a reverb's mix, a bus).
3. **Every plugin**: a third-party compressor's sidechain input is fed the key.

## The flow (kick ducking the bass)

1. **From the bass's compressor**: Pro-C on the bass's track; its Side Chain section's External → *Key
   from* → *1 Kick* (or the slot's menu → *Sidechain input ▸ 1 Kick*). Choosing a source turns External on. A dashed cable runs from Kick
   to Bass in the Mixer and the slot shows a key with the source's number. Load *Sidechain – Duck to Kick*.
   Any plugin with a sidechain input: the slot's menu → *Sidechain input ▸ 1 Kick*.
2. **From the kick** (the quickest): the Kick strip's menu → *Sidechain to ▸ 2 Bass ▸ Duck with a new
   Pro-C* (Pro-C in the next free slot, the Duck preset, keyed by Kick: one undo step), or one of Bass's
   effects that takes a key.
3. **Without a compressor**: right-click any automatable control (a fader, a knob of ours, a plugin's
   parameter) → *Modulate ▸ Follow track ▸ 1 Kick* (or *Follow notes ▸ Kick*). Its amount starts
   negative (the control dips on each hit); the Modulator window sets the follower and every link's amount.

## The key (audio sidechain)

**The document**: `MixerEffect.sidechain?: { track, tap }` on any slot (`shared/music/sidechain.ts`).

- `track`: the source mixer track (never the master, never the effect's own).
- `tap`: where its sound is taken, Ableton's three: `preFx` (before its effects), **`postFx`** (after its
  effects, before its fader: the default), `postFader` (what leaves it: FL's). After its effects but before
  the fader, moving or muting the kick's fader doesn't change the ducking: a *ghost kick* is a muted track.
- **No send is needed.** The key is a link of its own, which orders the tracks (the source runs first) and
  is refused when it would make a loop through sends and other keys (`canKey`; `canSend` sees keys too).
  `normalizeMusicProject` drops a key that names no track or makes a loop; removing a track drops the keys
  from it. FL's 0% sends still exist and still order tracks, but nothing needs them any more.
- **Solo**: a source silenced by another track's solo still feeds its keys, at every tap (the post-fader
  tap takes its fader as if it weren't soloed out). A muted source is silent at the post-fader tap only.
- Pro-C's External trigger reads its slot's key (songs from before keep theirs: `proC.sidechain.track`
  becomes the slot's key, tapped post-fader, as it was heard).

**Which effects take one** (`takesKey`): Pro-C (External), Pro-Q (a dynamic band set to External), and
any plugin with a sidechain input (the engine reports it: `EngineEffects.loaded[].sidechain`). Choosing a
key on a plugin that has none is allowed (it's kept and heard once the plugin has one) but the menu says so.

**The engine** (`Song.cpp`, `Sequencer.cpp`):

- An effect's key is its source's index (always an earlier track: the song is ordered with keys as edges,
  and `parse` keeps only those) and tap. The stages (the export's threads) put a keyed track after its source.
- Taps are buffers the song allocates: `preFx` a copy before the effects, `postFx` the pre-fader buffer
  (shared with pre-fader sends), `postFader` the track's own buffer (or, for a source soloed out, a copy
  through its unsoloed gains).
- **Delay compensation** treats a key as a path into its track, as FL does ("sends and sidechains
  included"): where the effect is, the track's sound is `arrival + (the effects before it)` late, the key
  `arrival[source]` (pre FX) or `out[source]` late. If the key is earlier, it waits in a `DelayLine` (kept
  by effect id across songs while its length holds); if it's later, the keyed track's inputs wait for it.
- A plugin's sidechain bus is turned on when it's loaded (`configurePlugin`: its second input bus,
  stereo, else mono) and filled with the key each block (`runEffect`); a plugin without one gets nothing.

## Modulators (Peak Controller, generalised)

**The document**: `MusicProject.modulators: Modulator[]` (`shared/music/modulation.ts`):

```
Modulator { id, name, source, attack, release, gain, tension, links }
  source: { kind: "track", track, tap } | { kind: "notes", channel }
  links:  { target: AutomationTarget, amount }[]     amount: -1..1 of the control's range
```

- **The follower** (FL's Peak Controller, Bitwig's Audio Sidechain): the source's peak (both sides) times
  `gain` (dB), followed with `attack` and `release` (seconds, one-pole), clipped to 1 and bent by `tension`:
  `e` in 0..1. A notes source is a gate: a note's velocity while any of the channel's notes sound (so a
  muted kick channel still drives it), through the same attack and release.
- **A link** moves its control from where it is: `fraction = clamp(own + amount × e)`, `own` being what the
  song (or, in song mode, its automation) says. Bitwig's way, not FL's (whose controller replaces the
  value): automation and modulation work together. A control has one link at most (linking it again
  replaces it); an engine lane made of several controls (a track's fader, pan and separation) follows the
  first modulator linked to any of them.
- **Every automatable control** can be linked (`AutomationMenuItems` gives every one *Modulate*), except
  the tempo. Modulation plays **in both modes**, playing or not (automation is song mode only).

**Compiling** (`compileSong`): each engine lane with a linked control is compiled as a grid over `e`: at each
of its points (its automation's, or one point when it isn't automated) the values at `e` = 0 … 1 in `steps`
even steps (17, fewer for wide lanes: a point holds at most `Lane::maxSize` values), and its `base` grid (its
own values, used while the song is stopped). A plugin parameter is linked in its own 0..1, so the engine
adds `amount × e` to the value it has. What a value *means* stays in TypeScript.

**The engine**: modulators are followed after each block's mix, on the audio thread (their state kept by
id across songs). Modulated lanes are applied every 64 samples (`modSlice`, counted from where play started,
so live and exported sound alike), from the follower's value at the end of the slice before: modulation is
**one slice (1.3 ms at 48 kHz) behind** the source, and needs no order between tracks (a modulator can even
drive its own source). Gains glide across each slice. The follower's values go to the tab in each transport
event (`EngineTransport.modulators`), so linked knobs move with them.

## The assistant

`set_sidechain` (any effect: source, tap, or none), `duck_with_sidechain` (the one-gesture duck: a Pro-C keyed
by a track, with the Duck preset), `get_mixer` says each effect's key, `add_modulator`, `update_modulator`,
`link_modulator` (a control and an amount; `amount: null` unlinks), `remove_modulator`, and `get_song` lists
the modulators. `set_pro_c_sidechain` is kept and goes through the same key.

## Where we differ from FL Studio, and what's not built

- **No 0% send to make**: the effect names its source (FL's sends at 0 still work and still order tracks).
- **Taps**: FL only keys post-fader; ours defaults to after the effects, before the fader.
- **Modulators aren't effects in a slot**: they're the song's, with a source (FL's Peak Controller sits in
  the source track's slot and passes its sound on). Their links *add* to the control rather than replace it.
- **Modulation isn't delay-compensated**: it follows the source as the source is late (with no plugin delay,
  it's 1.3 ms behind). The audio key is compensated.
- Not yet: a key from an audio input or a channel directly (only mixer tracks), the Peak Controller's LFO
  (Gross Beat and Pro-C's Host Sync pump on the beat), a modulator from MIDI CCs, a sidechain picker in a
  plugin's own window (it's in the slot's menu), keys for EchoBoy / OTT / PanMan / Gross Beat (their
  originals have none, but for PanMan's trigger).

## Built (2026-10-03), and where it differs from the plan above

All of it, in one pass, with these differences and gaps:

- **Where a key is chosen**: the slot's menu (*Sidechain input ▸*, its arrow's and its right-click's), Pro-C's
  External *Key from*, and the source strip's *Sidechain to ▸*. There's no Sidechain chip in effect windows'
  title bars yet (a plugin's window is the engine's: its picker is the slot's menu).
- **A notes modulator hears the song's notes** (the sequencer's), not a MIDI keyboard's or the rack's preview.
- **Modulation in an export**: the export plays the same `Sequencer`, so it's modulated as playback is; the
  offline tests check playback (and that blocks don't change it), not an export file.
- **Choices made without Théo** (to check): the default tap after the effects (FL keys after the fader); a new
  link's amount −60%; a modulator's defaults 2 ms / 150 ms / 0 dB; Bitwig's add rather than FL's replace;
  modulation a 64-sample slice behind its source and not delay-compensated; keys no longer make 0% sends.


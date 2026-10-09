# The Serum player

A window of our own for a Serum 2 channel in the music suite, in place of Serum's: find a preset fast, play it,
and change only what's worth changing while playing (the macros, the modulation, and if asked the envelopes,
LFOs and effects). Serum 2 itself makes the sound, hosted by our engine with its window closed, so the sound is
Serum's to the sample, and Serum's updates and new sounds arrive by themselves. The assistant designs and edits
sounds in it.

This is the plan, written before building, with what was measured on Serum 2.1.5 to make it. Nothing here is
built yet.

## Contents

1. [What's decided](#1-whats-decided)
2. [What the checks found](#2-what-the-checks-found)
3. [The design](#3-the-design)
4. [The steps](#4-the-steps)
5. [Open questions](#5-open-questions)

## 1. What's decided

Théo's choices (2026-10-09):

- **Built on the real Serum 2, not a remake.** He owns it and wants its updates and new sounds. A remake that sounds
  the same and can be sent to people may come later. The player is built so that its engine could be swapped,
  because it works from our preset spec (`preset-format.md`), not from Serum's controls.
- **Why:** Serum 2's window is overwhelming, and finding a preset means going through subfolders.
- **No knobs for the sound itself.** The macros and the modulation are the controls, as a preset's maker meant
  them to be.
- **Envelopes and LFOs can be changed, but are hidden by default** behind a toggle.
- **Effects get a cleaner panel of our own.** Serum's effects are among what he uses most, and their layout is
  good: keep its idea and make it calmer.
- **Serum 1 presets (`.fxp`) count as much as Serum 2's.** Most of his favourites are Serum 1 presets.

## 2. What the checks found

These were measured on 2026-10-09 with Serum 2.1.5 in the offline engine (silent: no device, no window). The probes
are in `data/serum-research/generated/probes/player/` (the main checkout's data folder, not in git).

### 2.1 What can change live

Serum gives the host 541 automatable controls (`catalogue.ts`). A host can set them while a note plays without any
reload. These matter here:

| What | Controls |
| --- | --- |
| Macros | `Macro 1`–`Macro 8` |
| Modulation amounts | `Mod 1 Amount`–`Mod 64 Amount`: one for each of the 64 mod slots |
| Envelopes | Attack, hold, decay, sustain, release and the three curves for each of the 4 envelopes |
| LFOs | Rate, smooth, rise, delay and phase for each of the 10 LFOs |
| Effects | `FX Main/Bus 1/Bus 2 Param 1–16`: **generic slots, not the effects' knobs** |

These are **not** controls, so changing them needs a reload (§2.2):

- a mod route's source or destination;
- an LFO's shape or mode;
- an effect being added, removed or moved;
- **any effect knob, for now.**

The 16 effect slots per rack read 0 whatever the rack holds (`fxparams.mts`). Serum's binary says why: "A maximum of
%d FX parameters may be automated per FX bus." An effect's knob is *assigned* to a slot in Serum's window.

None of the 1047 `.SerumPreset` files on this Mac stores such an assignment (`scankeys.mts`), so it's kept in the
plugin state, probably the controller's (Serum's code has `loadFXParamsFromJson` and `unmapFXParameterFromProxy`).
To find out, Théo assigns one effect knob in Serum's window once, and we compare the state before and after. If we
can write assignments ourselves, effect knobs become live too (§4, step 0).

### 2.2 Reloading Serum while it plays

`reload.mts` and `reload2.mts` loaded a new state into Serum while a note was held:

- **A load is synchronous and quick.**

  | State loaded | Time |
  | --- | --- |
  | The init patch | 10 ms |
  | Most presets | 20–67 ms |
  | PD - Pacific Rain (granular and spectral) | 132–162 ms |

  The next note plays the new sound from its first sample (`loadtime.mts`).
- **A load cuts every held note at once**, even when the new state is identical to the old one. The output goes from
  0.12 to 0 between two samples, an audible click, and the note never comes back. Effect tails go too.

So browsing presets is fine: Serum itself cuts notes when the preset changes. Editing something that needs a reload
(§2.1) while a chord rings needs the engine's help:

1. fade the channel out over a few milliseconds;
2. load the state;
3. play the held notes again;
4. fade back in.

A dragged edit that needs a reload is applied when the drag ends, not on every move.

The offline engine loads between blocks. Live, the load runs on the message thread while the audio thread plays, so
step 0 also checks that path.

### 2.3 Serum 1 presets (`.fxp`)

**Serum 2 doesn't take an `.fxp` from the host by any route we found** (`fxp.mts`, `fxp2.mts`, `programs.mts`). Its
state stayed on the init patch after each of these:

- the raw file as its state;
- the file, or its zlib chunk, in place of the processor state;
- the file inside an Xfer container;
- the controller's `selectedPresetPath` pointing at the file (the controller keeps the path, but nothing loads);
- the host's "programs", which are placeholders named `Prog 1`, `Prog 2`… with nothing behind them.

Serum 2 reads `.fxp` files only through its own browser. (Its binary knows the format: `CcnK`, "It Is Too Small to be
a Valid fxp File".) That's how the 86 starred ones were converted on 2026-10-07: Théo clicked through them in Serum's
window while `watch.py` saved each state.

**The library:**

- **878 `.fxp`** in Serum 1's folder (`~/Library/Mobile Documents/com~apple~CloudDocs/Documents/Serum Presets/Presets`);
- **about 70 more** in sample kits under `Desktop/Music/kits`;
- **86** in `~/Downloads/Serum Starred Presets`, beside his 32 starred `.SerumPreset`s.

A Serum 1 chunk is zlib: 6.5 KB unpacks to 173 KB (parameters and embedded tables).

**The ways to play them, best first:**

1. **Hand Serum the file as if it were dropped on its window.** The engine owns Serum's editor and could open it
   hidden, then call its view's drop handler with the file, all inside its own process. This is unverified: it's
   step 0's spike. If it works, any `.fxp` loads in one click, converted by Serum itself.
2. **Convert once through Serum's window**, as on 2026-10-07: an "Import Serum 1 presets" session opens Serum on the
   folder, Théo steps through with the arrow keys, and each state Serum shows is kept as a `.SerumPreset`. It's
   exact but tedious for 900 presets.
3. **Our own converter.** We already have 86 pairs of `.fxp` and Serum's conversion to check it against. It's a
   project of its own: Serum 1's parameters are mapped into Serum 2's.

### 2.4 Macro names

Serum takes macro names from the controller part of the state we hand it, and **the host sees them as the controls'
names**: `Macro 1` reads "SPACE" (`macros.mts`). So the earlier note in `preset-format.md` that names couldn't be
seen was about `presetAsState`, which keeps the template's controller rather than the preset's.

But Serum's own re-save of that state drops the names when its window has never been open. The project's state file
is that re-save, so the player keeps a preset's names itself and hands them back with each load.

### 2.5 What's on disk

- **1047 `.SerumPreset` files.** These include duplicates: the starred copies, and the `User/Claude` iterations.
- **Serum 2's factory library:** `/Library/Audio/Presets/Xfer Records/Serum 2 Presets/Presets/Factory`.
- **Serum's own index of it**, an SQLite file (`System/presets.db`: 663 presets with author, category and tags such
  as Bass, Pad, Mono, Multisample, Granular). It has no user ratings. Read it from a copy, never in place.

## 3. The design

### 3.1 Where it lives

**In the music suite, as a Serum 2 channel's window.** Clicking a Serum 2 channel's button in the channel rack opens
the player, a `MusicWindow` like the other windows, instead of Serum's own window. **Open Serum** in its title bar
shows Serum's window for anything the player doesn't do. Other plugins are unchanged.

Because it is a channel, it plays in patterns and songs, records, follows automation, and saves with the project. The
assistant reaches it as it reaches the rest of the song.

```
┌ Serum 2 · Lead ───────────────────────────────────────── ★  Save  Open Serum  ✕ ┐
│ ◀ ▶  MO_SHINJU_LD_Wex · @shinju_09 · Serum 1 · edited                           │
├──────────────────────────┬──────────────────────────────────────────────────────┤
│ 🔍 search…               │  MACROS                                              │
│ All  ★  Bass Lead Pad …  │  ( FILTER ) ( DIST AMT ) ( ROOM ) ( MOD RATE ) …     │
│ Pack ▾  Author ▾         │                                                      │
│ ───────────────────────  │  MODULATION                                          │
│ ★ MO_SHINJU_LD_Wex   S1  │  LFO 9 (1/4) → Osc A Warp            ━━━━━━○  34%    │
│   MO_SHINJU_LD_Walker S1 │  Macro 1 FILTER → Filter 1 Cutoff    ━━━○     50%    │
│ ★ synth [ari]        S1  │  + add                                               │
│   PL - Chiller…      S2  │                                                      │
│   …                      │  ▸ Envelopes and LFOs                                │
│                          │                                                      │
│                          │  EFFECTS   Main │ Bus 1 │ Bus 2                      │
│                          │  [Distortion · Rectify]  [Reverb · Hall 18%]  + add  │
└──────────────────────────┴──────────────────────────────────────────────────────┘
```

### 3.2 The browser

The main fix: every preset on the computer in one flat list.

- **Where it reads:**
  - Serum 2's preset folder (factory, packs, `User`);
  - Serum 1's folder;
  - folders added in Settings, e.g. `Downloads/Serum Starred Presets` and the kits.

  As with the Browser's sample folders, the server reads nothing outside these (`server/music/browser.ts`'s rules).
- **The index (the server's):** built with our reader (`readSerumFile`) and kept up to date while the folders change.
  Each preset has:
  - its name, author, tags, pack (its top folder) and kind (Serum 1 or 2);
  - a category (Bass, Lead, Pad…), from Serum's tags, else the name's prefix (`BS`, `LD`, `PL -`, `[PS] pad`…), else
    its folder;
  - what it uses: oscillator types, wavetables, effects;
  - a hash, so the same preset in two places is listed once.
- **Search:** typo-tolerant, ranked (the Browser's search in `shared/music/browser.ts`), with filters by category,
  pack, author and Serum 1 / 2.
- **Favourites (★):** this computer's, kept by the server as the Browser's are. The starred folder seeds them.
- **Keys:** ↑/↓ load the next preset at once, which is a reload (§2.2): browsing *is* hearing. Typing searches.
- **What a step plays:** whatever is being held or played. With nothing held, a short phrase can play, chosen by
  the preset's category (§5, Q3).

### 3.3 Macros

The 8 macros as knobs, with their names (from the preset: §2.4) and what each one moves (from the mod list).

- They change live (`setParameter`, §3.7) and are automatable like any plugin parameter.
- A macro with nothing on it is hidden.

### 3.4 Modulation

The mod matrix as readable rows: `source (aux) → destination: amount`, grouped by source.

- **Amount:** drag it, live (`Mod N Amount`). Bipolar is a toggle.
- **Add or remove a route, or change its source or destination:** a reload (§2.2).
- **Names:** Serum's (`destinations.ts`). Destinations are picked from a searchable list, not a tree.

### 3.5 Envelopes and LFOs (hidden by default)

Behind **Envelopes and LFOs**, remembered per computer:

- **Envelopes 1–4:** drawn as shapes you can drag (ADSR, hold, curves), all live.
- **LFOs 1–10:** rate, smooth, rise, delay and phase, live. The shape (points, as the spec's `shape.points`) and
  the mode reload when the drag ends.
- **Only what's in use:** an LFO or envelope nothing is routed from is listed but folded.

### 3.6 Effects

The three racks (Main, Bus 1, Bus 2) as tabs, each a row of cards in order:

- **A card:** the effect's name and mode, a bypass, and its main controls.
- **Main controls:** a few chosen for each of the 13 effects (Reverb: type, size, decay, wet; Distortion: mode,
  drive, wet…). All of its settings are under the card's expand.
- **Add, remove, reorder, change a knob:** a reload (§2.2), applied when the drag ends, until effect knobs can be
  live (§2.1).
- **The look:** Serum's layout, calmer, in our theme tokens.

### 3.7 How it works

**Serum's state stays the truth.** It is the channel's `plugins/<channel id>.bin`, as for any plugin, saved by the
engine. The player reads it into our spec (`plugin-state.ts` → `bodyToSpec`).

The channel's document gets only what Serum's state can't hold:

- the preset it started from (its path, name and hash);
- the macro names;
- whether it has been edited since.

**An edit goes one of two ways:**

- **Live:** the engine's new `setParameter` command (owner, parameter id, value, with a touch start and end, so
  automation recording and `held` work as for a plugin's own window).
- **Reload:** the tab sends a spec change. The server:
  1. asks the engine to save the channel's state;
  2. applies the change to the body (`specToBody`, the spec's validation);
  3. writes the state, with the controller's names (§2.4);
  4. sends the engine's new `setState`, which fades out, loads, plays the held notes again and fades in (§2.2).

  `PluginHost::loadPreset` already loads a state into a channel's instance. `setState` is it, plus the fade and the
  notes.

**Changes made in Serum's own window** are read back when the engine next saves the state (it does so every few
seconds, and when the window closes).

### 3.8 Saving

- **Save** writes a `.SerumPreset` into Serum 2's `User` folder, so the preset also shows in Serum anywhere. It
  carries the controller part, so names and description show in Serum too.
- **Save as** asks for a name.
- **A factory or Serum 1 preset is never overwritten.** Saving an edited one saves a new file.
- **Unsaved edits** live in the project, as any plugin's settings do.

### 3.9 The assistant

New tools in `shared/music/tools.ts`, for parity with the window:

| Tool | Does |
| --- | --- |
| `search_serum_presets` | Searches the index (query, category, favourites) |
| `load_serum_preset` | Loads a preset onto a channel |
| `get_serum_sound` | Returns the channel's sound as a spec |
| `edit_serum_sound` | Applies a spec change: macros, modulation, envelopes, LFOs, effects |
| `save_serum_preset` | Saves the sound as a preset |

- **Errors:** they're the spec's own (`SpecError`), which already say what's allowed.
- **Taste:** the `serum-presets` skill's research (`taste.md`, the scores in `feedback.md`) is what it designs from.
- **"A darker one":** the assistant can search the library for "something like X but darker", using the index's
  facts.

### 3.10 Tests

- **Pure logic in vitest:** the index's categories and dedupe, the spec edits, the name handling.
- **The stand-in engine** (`fake-engine.mjs`) answers `setParameter` and `setState`, and lists a "Serum 2" plugin
  with Serum's control names, so `e2e/music.spec.ts` can open the player and browse a fixture folder.
- **The real Serum:** an integration test, skipped when Serum isn't installed, checks a reload while a note is held.
  The note goes on and there's no step in the output.
- **The engine's fade and retrigger** are tested on the test synth, offline.

## 4. The steps

0. **Three short spikes.**
   - Can the engine make Serum load an `.fxp` as if it were dropped on its hidden window (§2.3, way 1)?
   - Where Serum keeps an effect knob's slot assignment: one assignment by Théo in Serum's window, and the states
     compared (§2.1).
   - A reload while the engine plays live (not offline): does Serum load safely on the message thread, and how long
     does the audio thread wait?
1. **The engine:**
   - `setParameter`;
   - `setState` with the fade and the held notes played again;
   - `presetAsState` carries a preset's controller part (names).
2. **The browser, loading and macros:** the index, search and filters, favourites, arrow keys. This is the part that
   fixes the main pain.
3. **Modulation:** the rows, live amounts, adding and removing routes.
4. **Envelopes and LFOs**, hidden by default.
5. **Effects:** the racks and cards. Live knobs, if step 0 found how.
6. **Saving and the assistant's tools.**
7. **The Serum 1 library:** by step 0's way 1 if it works, else an import session through Serum's window (§2.3,
   way 2).

## 5. Open questions

- **Q1. Are the player's edits undo steps?** Today what's turned in a plugin's window isn't, as in FL Studio. The
  player could keep its own undo, a history of states for the channel, since it knows every edit.
- **Q2. Favourites:** are the starred folder's 118 the starting favourites, or does he star from scratch?
- **Q3. What plays while browsing with nothing held?** Silence, a phrase chosen by category (bass: low notes, pad: a
  chord), or the pattern's own notes looped?
- **Q4. Converted Serum 1 presets:** kept as `.SerumPreset` copies where (Serum's `User/Serum 1`, so Serum sees them
  too, or a cache of ours), or converted each time they load (only possible with §2.3's way 1)?
- **Q5. Later:** a player outside a song, e.g. a Sounds screen on Home to browse and play with no project open?

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
5. [Questions](#5-questions)

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
- an effect being added, removed or moved (which also changes what the effect slots point at).

**Effect knobs become live once linked to a slot.** The 16 effect slots per rack read 0 whatever the rack holds
(`fxparams.mts`), because a slot means nothing until an effect's knob is linked to it. In Serum's window that's a
knob's right-click › **Automate** ("A maximum of %d FX parameters may be automated per FX bus").

No preset stores a link (none of the 1047 on this Mac: `scankeys.mts`): the plugin state's controller part does.
Théo clicked Automate once with Serum's window open (`assign.mts`), and the state then held:

```
controller › FXRack0 › proxyParams: { "0": { "fxID": 0, "paramIndex": 1 } }
```

That means slot 1 is the rack's first effect (`fxID`, its place in the rack), parameter 1.

**We can write links ourselves** (`proxy.mts`):

- Twelve links written headless into a state's controller made the host's slots read "FX 1: Dist Enable = On",
  "FX 1: Dist Wet = 50", "FX 1: Dist Drive = 40", "FX 2: Rev Size = 50"…, each with the knob's current value.
- Serum's re-save keeps them.
- A parameter's index is its place in the effect's list (the Distortion's: 0 Enable, 1 Wet, 2 Drive, 3 LPHP…).

So the player links the knobs it shows to slots: up to 16 a rack, re-linked whenever a rack changes. Then turning
them is `setParameter`, live.

Still to check: that a slot set by the host moves the effect's sound, not only its readout. This is step 1's test,
once `setParameter` exists. And Serum's own Automate on Drive linked parameter 1, which reads Wet: an off-by-one of
Serum's, or the click landed on Mix.

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

**Solved (step 0, 2026-10-09): the engine drops the file on Serum's invisible window** (`drop*.mts`, `grid.mts`).

- **How:** the engine makes Serum's window fully transparent and ignoring the mouse. It then hands Serum's view the
  file as Finder's drag and drop would (`dropFiles` in `engine/src/MacWindow.cpp`: a pasteboard with the file, an
  object answering as `NSDraggingInfo`, then `draggingEntered:`, `draggingUpdated:`, `performDragOperation:`).
- **The pointer matters:** Serum decides where a drop lands from where the real pointer is, not from the drop's
  point. With the window anywhere else, nowhere in it takes the file. So the invisible window is moved under the
  pointer first. Then anywhere in it takes an `.fxp`, and nothing on the screen changes.
- **The result:** 8 of the starred `.fxp`s loaded on the first try, in 20–200 ms, with their names. Each was what
  Serum's own browser made of it on 2026-10-07. The only differences:
  - HyperD's LFO phases, which are random on every load;
  - one control at its default, written out or left out;
  - macros 5–8 left over from the previous preset in the 10-07 captures (Serum 1 has 4 macros, so a converted
    preset leaves the others as they were).

  The player sets macros 5–8 to 0 before a Serum 1 preset loads, so they never carry over.
- **Serum's own path for Serum 2 presets too:** the same drop loads a `.SerumPreset` with its names and everything,
  exactly as Serum's browser does. Loading from the browser can use it for both kinds; `presetAsState` stays for
  the player's edits.
- **macOS only:** Windows needs its own version (an `IDropTarget` call on the plugin's window), later.

So no conversions need keeping: every `.fxp` loads as it is, converted by Serum each time.

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
  - later, folders added in Settings (the kits).

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
- **Ratings (★):** Serum's own, read from its databases and written back, so the player and Serum agree (§5, Q2).
- **Keys:** ↑/↓ load the next preset at once, which is a reload (§2.2): browsing *is* hearing. Typing searches.
- **What a step plays:** nothing by itself. A held note is played again with the new preset; otherwise only what
  he plays sounds (§5, Q3).

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
- **Turning a knob:** live, through the slot it's linked to (§2.1). The player links the knobs shown, up to 16 a
  rack; a knob beyond that reloads when its drag ends.
- **Add, remove, reorder:** a reload (§2.2), with the links written again. Any of the 13 effects can be added to any
  rack: the writer already handles them all (`preset-format.md`). **+ add** also offers Serum's saved chains
  (`Effect Chains` in its preset folder), to drop in a whole rack at once.
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

0. **Done (2026-10-09).** Effect knob links: §2.1. `.fxp` by a drop on Serum's invisible window: §2.3. A reload
   while the engine plays live: designed away in step 1, since the audio thread stops calling Serum (after a fade)
   while it loads, so Serum is never loaded and played at once.
1. **The engine:**
   - `setParameter`;
   - `setState` with the fade and the held notes played again;
   - `presetAsState` carries a preset's controller part (names, and the effect knobs' links);
   - test that a slot set by the host moves its effect's sound (§2.1).
2. **The browser, loading and macros:** the index, search and filters, favourites, arrow keys. This is the part that
   fixes the main pain.
3. **Modulation:** the rows, live amounts, adding and removing routes.
4. **Envelopes and LFOs**, hidden by default.
5. **Effects:** the racks and cards, their knobs live through linked slots.
6. **Saving and the assistant's tools.**
7. **The Serum 1 library:** every `.fxp` in Serum's folders loads by the drop (§2.3), listed with the rest.

## 5. Questions

Théo's answers (2026-10-09):

- **Q1. Undo: yes.** Player edits are undo steps. The player keeps a history of the channel's states: a live
  change is one step when its drag ends, a reload one step too.
- **Q2. Favourites are Serum's ratings, plus his own.**
  - **Show:** the stars he gave presets in Serum (4 and 5 stars count as favourites).
  - **Star in the player:** stars set in the player must show in Serum too.
  - **The library is what's in Serum's preset folders.** More folders can be added later.
  - **Where Serum keeps ratings:** Serum 2's `System/presets.db` (`UserData`: a preset's hash and its rating) and
    Serum 1's `presetdb.dat` (`SerumPresetTable.Rating`). Serum 2 imports Serum 1's (its "Import Preset Ratings
    from Serum 1" preference is on).
  - **Both are empty on this Mac** (2026-10-09: no `UserData` rows, all 797 Serum 1 ratings 0). Before step 2,
    find out where his stars are, e.g. by rating one preset in Serum and seeing what changes.
  - Writing to Serum's database while Serum is open needs care: it's SQLite, and Serum may hold it.
- **Q3. Nothing plays by itself.** Browsing only loads. Sound comes from what he plays (a MIDI keyboard, the typing
  keyboard, the Piano roll's keys).
- **Q4. Converted Serum 1 presets: none.** Step 0 worked, so an `.fxp` loads as it is, converted by Serum each time,
  as in Serum's own browser.
- **Q5. Later:** a player outside a song, e.g. a Sounds screen on Home to browse and play with no project open?

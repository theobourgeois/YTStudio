---
name: serum-presets
description: Design new Serum 2 presets in Théo's taste and hand them over for scoring as an audition page. Use when asked to make Serum presets, sounds or patches (a round, an iteration, "make me a bass/lead/pluck/pad/keys"), to score or log a round's results, or to read, write or check a .SerumPreset file.
---

# Serum presets for Théo

Théo uses Serum 2 for nearly everything. We design presets in his taste, he listens on an audition page and
scores them, and every round's verdicts feed the next. The aim is presets he'd put in his own songs.

## Where everything is

- **The tools are in the repo:**
  - the writer: `server/music/serum/`, with the CLI `scripts/serum-preset.ts` (`read`, `write`, `verify`);
  - Serum in the offline engine: `scripts/serum-readout.ts`;
  - the audition page: `scripts/serum-audition.ts`.
- **The docs:** `docs/serum/preset-format.md`, the spec, its units and what's verified; read it before writing a spec. `docs/serum/taste.md`, his 118 starred presets analysed: categories, recipes, rules.
- **The history is outside git, on this Mac only:** `~/code/editor/data/serum-research/` (the main checkout's data folder; a worktree's own `data/` doesn't have it):
  - `feedback.md`: **every verdict so far, with his notes. Read all of it before designing anything.**
  - `all-cards.md`, `out/<name>.json`: readouts of his 118 starred presets;
  - `converted/<name>.bin`: the 86 Serum 1 favourites as Serum 2 states, converted by Serum itself; the CLI's `read` takes them;
  - `generated/batchN/`: each round's specs, presets and `session.json` (good examples).
- **Where the output goes:**
  - presets: `/Library/Audio/Presets/Xfer Records/Serum 2 Presets/Presets/User/Claude/Iteration N/`, a new folder per round; never change an earlier one;
  - the page: `~/Music/Claude Serum/Iteration N/`.
- **His originals** are in `~/Downloads/Serum Starred Presets/`: read them, never change them.

## What he likes (from the scores; `feedback.md` has the rest)

- **His Serum 1 favourites are the taste** (shinju, tda, the `[PS]` banks). Recipes from scratch drifted to "mid", "boring" and "cheap". Starting from one of his favourites and changing one to three things meaningfully works better (round 7's approach).
- **One note means one note**: no unison stacks (octave or fifth), no chords built into a preset.
- **A bass is a bass**: mono, centred, energy below ~300 Hz, no wide or bright layer on top. Every note re-attacks (no mono-legato smear), and loops for a bass have no tied notes.
- **Vary the family each round.** One winning formula repeated (four trance plucks: 8, 7, 6, then 4) wears out.
- **Bold, classic gestures done cleanly beat clever concepts.**
- **No rhythmic volume LFOs on sounds played live**: a synced LFO in Free mode freezes when FL's transport is stopped. Use one only on a macro that starts at 0.

## A round, step by step

1. Read `feedback.md`, the relevant parts of `taste.md`, and `preset-format.md`.
2. **Pick one preset per role** (lead, pluck, keys, pad, bass) unless he asks otherwise. For each, start from one of his favourites, `pnpm tsx scripts/serum-preset.ts read "<research>/converted/<name>.bin" --out spec.json`, or from a recipe in `taste.md`, and make it a sibling: changed meaningfully, still his.
3. **Write each preset** with `pnpm tsx scripts/serum-preset.ts write spec.json --out "<NAME>.SerumPreset"`. Name it in his style: `LD`, `PL`, `KY`, `PD`, `BS` plus a short evocative name. Give it three or four macros named for what they do (FILTER, ROOM, DUST, DRIVE…), mostly on effect mixes.
4. **Check it in Serum** with `pnpm tsx scripts/serum-preset.ts verify --specs a.json --specs b.json --out <dir>` (one `--specs` per file). Known checker quirks, not errors: "0% [-∞ dB]" against 0, and a WT Pos frame number on long tables.
5. **Write a session** (see `scripts/serum-audition.ts`'s header; copy `generated/batch7/session.json`):
   - a fresh phrase per role in a new key, at **120 BPM** (see the traps);
   - bass in octaves 1–2, lead and pluck in 4–5, chords in 3–4, remembering presets built an octave or two down;
   - a bass over the `bed` (quiet chords) for context.
   - Putting his original before your variation ("Reference — <name>") lets him compare.
6. **Render it**: `pnpm tsx scripts/serum-audition.ts session.json`. Level-match first: render without drums and set each preset's `global.volume` so the solo RMS is about 0.08–0.13 with no peak above ~0.75; then render the page. Listen with numbers where you can't with ears: band energies (sub <100, low 100–300, mid 300–2k, high >2k), side/mid width, onset pitch. Compare to his original.
7. **Install** the presets in the new `Iteration N` folder, `open` the page, and tell him what each one is and what changed, briefly.
8. **When he pastes his scores** (JSON from the page's "Copy scores" button), log them in `feedback.md` as a table with his notes word for word, and add any lesson they teach.

## Traps (each cost a round)

- **LFO shapes: y is measured from the top** (0 is the LFO's full value), and a shape should end at its start's height.
- **PWM's display runs backwards**: knob 0 shows 100, a full-width pulse; knob 100 squeezes the wave to nearly nothing.
- **Tempo:** the engine doesn't give hosted plugins a playhead yet, so Serum assumes 120 BPM in renders. Render at 120 until that's fixed; in FL his presets get FL's tempo.
- **Silence:** a filter shut at 8–30 Hz needs its envelope at ~95–100% to open, or the preset is nearly silent. Always check the solo RMS.
- **The writer refuses bad specs** and lists what's valid: read the message, don't guess names.
- **In a worktree**, the engine isn't built: set `EDITOR_ENGINE_PATH` to the main checkout's (`~/code/editor/engine/build/VaudioEngine_artefacts/Release/Vaudio Engine.app/Contents/MacOS/Vaudio Engine`).
- **Never** open Serum's window, play sound out loud, or take screenshots of his screen. The engine always runs offline.

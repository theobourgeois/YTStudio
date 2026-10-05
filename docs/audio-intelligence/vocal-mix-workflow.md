# First local vocal mixing workflow

Implemented on 2026-10-05. B's real-audio path has been verified through the
actual app's project-bound MCP tools: live capture → native passage render →
local measurement → report. A first bounded comparison workflow builds on it.

## Using it

Open a song with the vocal routed to a dedicated mixer insert and its instrumental
playing alongside it. Click **Vocal mix** in the music toolbar. Choose the vocal
insert and two nonoverlapping active passages of 5–20 seconds each, then render
the alternatives:

| Alternative | Changes to the vocal insert |
| --- | --- |
| Keep current mix | None |
| Vocal +2 dB | Fader +2 dB |
| Gentle vocal compression | Add YT-C clean, 3:1, -24 dBFS threshold, 6 dB knee, 10 ms attack, 150 ms release, 12 dB range; auto gain/release off; fader +1 dB |
| Gentle compression + presence EQ | Same compressor/fader proposal, followed by YT-EQ bell at 3 kHz, +1.5 dB, Q 0.7, dynamics/auto gain off |

These are fixed, bounded audition proposals, not genre-trained recommendations.
No objective quality score or preferred candidate is invented. The accompaniment,
arrangement, routing and existing effect slots are preserved. Two empty vocal
effect slots and fader room are required. The first version refuses an automated
or modulated vocal fader, mixer solos and outside plugins.

Compare both passages using the single audio player. Switching alternatives
preserves the position relative to the passage, skipping recorded warm-up. Tails
remain audible. By default all alternatives in each passage are attenuated to
a common body RMS with at least 1 dB peak headroom. Matching is approximate,
not LUFS, and only affects player volume. Turn it off to check original levels.

Keep the baseline or apply your chosen alternative. Apply requires completed
reports for both passages and measured sample headroom, rechecks the current
source bytes/render conditions on the server, then checks the live musical
revision again inside the edit. A stale comparison is refused. Only the chosen
vocal fader and new built-in effects are committed, as **one Undo step**. Undo
restores their full document settings; no external plugin-state file is changed.

## Assistant tools and background work

- `get_vocal_mixing_workflow`: prerequisites, procedure, alternatives and limits.
- `create_vocal_mix_run`: captured snapshot, vocal insert and two passage ranges
  in song ticks; creates four alternatives × two passages without editing the song.
- `get_vocal_mix_run`: durable progress, original artifact/report ids, sample
  peaks/RMS and playback-only matching gains.
- `cancel_vocal_mix_run` / `retry_vocal_mix_run`: cancel jobs or explicitly retry
  interrupted/failed attempts within B's retry limits.
- `review_vocal_mix_run`: open playback in this song's editor.
- `apply_vocal_mix_candidate`: apply an explicitly chosen alternative in the open
  song with the same validation/Undo behaviour as the dialog.

Capture/render/measure reuse B's storage and serial engine queue. Candidate
snapshots fork the preserved source copies, not newly edited live media. The
server starts measurements after rendering even with no tab polling. Comparison
records persist in `data/audio-intelligence/<projectId>/vocal-mixes/`. Queued B
jobs resume after restart; interrupted jobs require an explicit retry. Closing
the dialog leaves work running. Cancelling stops queued work and requests that
active jobs release the engine safely. Interrupted preparation needs a fresh run.

The workflow has a fixed maximum of three changed candidates plus baseline, two
passages each, maximum 20-second bodies, an eight-beat lead-in policy and up to
four seconds of ring-out. The engine records actual tail lengths. It does not
run AFx-Rep, ST-ITO or a hosted perception request, so it adds no resident neural
model to ordinary editing.

## Real-audio verification

`scripts/prepare-vocal-mix-pilot.py` prepares aligned 40-second excerpts from
“Lead Me” by The DoneFors, pinned Mix Evaluation Dataset revision
`ac28ccd742b5cf1380838098b7921f4ebc82d041`. The song-specific dataset licence is
CC BY 3.0. The lead vocal is separate; accompaniment sums recorded bass,
acoustic guitar, kick, snare, hi-hat and keys at the same source time. Four new
full raw stems were downloaded (~250 MB); three existing raw files were reused.

The accompaniment is a documented six-stem reconstruction, **not the original
engineer's finished mix**. This acoustic recording validates plumbing and state
correctness, not EDM/trap/hip-hop mixing quality. Resampling, scalar calibration,
accompaniment summing/pan and boundary fades are recorded as modifications. No
synthetic sources or Python effects are included. All effects use native plugins.

The isolated real-engine app lives under gitignored `data/vocal-mix-pilot/app`.
It does not change user projects. With its song open in the collaborative preview,
`scripts/verify-vocal-mix-pilot.ts` calls the real MCP endpoint, captures the live
document, reads the rendered measurement report, creates the eight-result
comparison and opens its player through the assistant tool. Artifacts, reports,
source provenance and the complete comparison are in `assistant-verification.json`
and `source-manifest.json`. Raw outputs are the normal project-scoped B artifacts.

Browser checks on the real app covered muted playback, switching at the same
position, applying compression and restoring the original vocal fader/effects
with one Undo. Unit/service tests additionally cover instrumental preservation,
headroom/two-passage requirements, stale documents and source bytes, closed-tab
analysis completion, restart readability, project isolation and cancellation.
The browser suite covers rendering without live edits, the EQ/compressor choice,
single-step Undo and stale comparison refusal.

## Scope remaining

This implements a first D procedure and a bounded part of E. General D
[workflow/example/profile retrieval](workflows-and-examples.md) and F
[ordinary-package intake](ordinary-package-ingestion.md) have since been added.
Persistent generic `MixRun` phase/budget orchestration, learned candidate
generation, outside-plugin support and subjective quality acceptance on
previously unseen genre recordings remain pending. Hosted perception
quality remains unverified. AFx-Rep/ST-ITO are separate research pilots; their
on-demand workers are not integrated into this workflow yet.

The next quality evaluation should use cleared, separate vocals and finished
EDM/trap/hip-hop instrumentals, with matched-level listening comparisons and a
no-change option. This is a test target, not a requirement to use the current
local comparison feature.

# Vocal mixing workflow: measured, proposed, auditioned

First built 2026-10-05 as four fixed alternatives; rebuilt the same day to measure first and propose from the
measurements (version 2). B's real-audio path was verified through the app's project-bound MCP tools before.

## What it does

1. **Measure.** The beat (the song with the vocal's insert muted) and the song with the vocal's stem (its track
   after its fader, from the same pass) are rendered over two passages. `analyseVocal`
   (`shared/music/audio-intelligence/vocal-analysis.ts`) measures, per passage, while the vocal sings:
   - where it sits: vocal minus beat, LU (integrated, and per second: median, P10, P90);
   - masking: how often the beat is 6 dB or more over the vocal between 1 and 4 kHz;
   - phrase spread: momentary loudness, P90 − P10;
   - its own spectrum: mud (low mids over mids), rumble (energy under 80 Hz), harshness (upper mids over
     mids), sibilance (sung frames with more 5–9 kHz than 1–4 kHz), each with the frequency it peaks at;
   - the mix's loudness (LUFS) and true peak.
2. **Propose.** `vocalFindings` tests each against a stated starting point (`VOCAL_THRESHOLDS`; the level against
   a target the user picks: forward −1, balanced −3, blended −6 LU). A finding counts only when **both** passages
   show it. `proposeVocalChanges` turns them into up to three candidates: the level alone (fader), the tone and
   dynamics fixes alone (YT-C clean 3:1 from 6 dB under the loud words' peaks with 2 dB make-up; YT-EQ: a low cut
   at 80 Hz, a cut at the mud's or the edge's peak, presence at 3 kHz when masked, a dynamic band on the esses
   from the sibilance band's usual level), and both. The assistant can pass its own candidates instead (at most
   three, checked in the effects' units by `checkVocalChange`), or `[]` to measure only. Nothing passing means
   no candidates: keeping the mix is then the measured answer, said as such.
3. **Render and measure again.** Each candidate is rendered over both passages and measured over the
   **baseline's singing moments** (`VocalAnalysis.sounding`: a compressor lowering the vocal must not let its
   breaths count as singing). `candidateEffects` says what moved, against the baseline, in numbers.
4. **Level-match once.** A candidate whose compressor or EQ moved the vocal against the beat by 1 LU or more than
   its fader meant is rendered again with its fader making up the difference (`levelMatch`; the run's one
   revision round), so the comparison is of tone and dynamics, not of loudness.
5. **Listen and choose.** Playback matches every render to the quietest one's integrated loudness, never past
   −1 dBTP (`auditionGains`); original levels are one switch away. Applying refuses a stale song or sources and a
   true peak at 0 dBTP, and is one undo step; keeping the baseline is always offered.

Every step moves the run's `MixRun` (`run.ts`): capture → inspect → hypothesise → propose → render → compare
(→ propose → render → compare, for level matching) → present → accepted or discarded; nothing to propose ends it
`abandoned: no-change`. Its budgets cap candidates (3) and render time (600 s for the run's up to ten renders).

The fader is **cubic** (`faderGain`): a change of *x* dB moves its position by 10^(x/60) (`faderMoved`). The first
version assumed a squared law, so its "+2 dB" was about +3 dB.

## Using it

Click **Vocal mix** in the music toolbar. Choose the vocal's insert, two nonoverlapping passages of 5–20 seconds
where it sings, and where it should sit, then **Measure and render alternatives**. The window shows what the
measurements found per passage, then each alternative's reasons and measured effects, a player for both passages,
and Keep current mix / Apply selected alternative.

## Assistant tools and background work

- `get_vocal_mixing_workflow`: what's measured, the thresholds and level targets, what may change, the limits.
- `create_vocal_mix_run`: captured snapshot, the vocal's insert, two passages in song ticks, `level`, and optional
  `candidates` (the assistant's own, or `[]` to measure only). Doesn't edit the song.
- `get_vocal_mix_run`: status (`analysing`, `rendering`, `ready`), findings, candidates with reasons, changes,
  measured effects and level matching, playback gains, and the `MixRun`.
- `cancel_vocal_mix_run` / `retry_vocal_mix_run`; `review_vocal_mix_run` opens the window.
- `apply_vocal_mix_candidate` (by `candidateId`; `"baseline"` keeps the mix): one undo step, after which the tab
  records the choice (`conclude_vocal_mix_run`, the run's outcome).
- `render_audio_passage` takes `stemTrackId`; `analyse_audio_artifact` reports LUFS, loudness range, true peak,
  band balance and timed changes for any passage.

The server moves a run on by itself (no tab needed). Runs persist in
`data/audio-intelligence/<projectId>/vocal-mixes/`; a run from the first version is left alone and reading it asks
for a fresh one.

## Verified on real recordings (2026-10-05)

`scripts/verify-vocal-run.ts` builds songs from the hearing benchmark's real stems (*Not Alone*, Fredy V;
*Red To Blue*, Broken Crank; CC BY 3.0): the vocal stem on its own insert, bass, kick, snare and the rest on
another. Through the real engine, offline, each run takes about ten seconds:

- *Not Alone*: sibilance in both passages (12% and 11% of sung frames, around 6.3 kHz) → a dynamic band from the
  band's usual level: sibilant frames 11 → 8%, the vocal's level 0.5 LU lower, the mix's loudness unchanged.
- *Red To Blue*: uneven phrases in both (9.5 and 11.1 LU) → compression: phrase spread 10.3 → 7.9 LU, the beat
  over the vocal at 1–4 kHz 26 → 23% of sung frames, the vocal within 1 LU of where it was.
- Accepting each and rendering the accepted song again measures exactly as its candidate did (vocal and mix
  LUFS to 0.05), and only the vocal's insert changed.

The measurements caught the first proposals failing, which is what they're for: a compressor threshold taken from
the vocal's RMS took 8.6 LU off it (detectors follow peaks); a de-esser on Auto threshold moved nothing; and
phrase spread measured over each render's own singing rose under compression. All three are fixed as above.

## The first version's real-audio verification

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

Whether the proposals sound better is G's question: blind listening on held-out genre recordings, with ties and
no-change. Only the vocal's insert changes (not the beat, no sends or automation); outside plugins can't be
rendered faithfully yet. Thresholds and level targets are starting points, not standards.

# Hearing benchmark (Slice C acceptance)

Slice C's [pipeline](hosted-perception.md) is built. A listening task is promoted only by this benchmark:
cleared real recordings, the app's own hearing pipeline, and blind review by two people. The gate itself
(`hearing-benchmark.ts`, `hearing-heldout-v1`) is unchanged: per task, at least 10 held-out real cases from 5
families, no-change controls from 2 families, 2 provider trials per case, 2 complete blind reviews of all three
arms per trial, no flagged inaccurate/unsupported listening result, and combined evidence more useful than DSP
alone on at least 60% of the non-control cases.

## Recordings

[Mix Evaluation Dataset 2.0](https://huggingface.co/datasets/sparrowreivun/Mix-Evaluation-Dataset-2.0), pinned
to revision `ac28ccd742b5cf1380838098b7921f4ebc82d041`. Only the songs its `songs.xml` licenses under Creative
Commons are used (CC BY 3.0 from the Open Multitrack Testbed, CC BY-NC 4.0 from Shaking Through); its copyrighted
songs, and songs it doesn't list, are left out. Every file is checked against the repository's SHA-256, and each
song's licence against `songs.xml`, when it is downloaded.

- **Mixes**: engineers' mixed excerpts (MP3, 192 kbps, 43–80 s).
- **Stems**: one engineer's (McG-A) aligned stems of a whole song (16-bit 44.1 kHz WAV): vocal, bass, kick, snare and
  the rest, for *Not Alone* and *Red To Blue*; acoustic guitar and bass for *Lead Me*.

A **recording family is an artist**: songs by one band may share a studio, players and engineer. Seven families
are held out (The DoneFors, Fredy V, Broken Crank, Torres, Filthybird, The Districts, The Tontons); two are for
development only (Creepoid, Purling Hiss), used to choose a provider and never counted by the gate.

## Cases

Each case is a 20-second stereo 48 kHz clip and one question per task, the same for every case of that task so
the question never gives the answer away (`BENCHMARK_QUESTIONS`). Most cases are changed in a known way, so a
reviewer can check claims against the truth; the reviewer is told exactly what was done (`knownFacts`).

| Task | Non-control cases | No-change controls |
| --- | --- | --- |
| Context | A stem group (vocal, bass, or kick + snare) leaves or enters at a stated time, the other stems throughout; untouched mixes (truth by listening) | One stem alone |
| Tone | From a stated time, a shelf, peak, high-pass or band-pass (duller, brighter, boomier, thinner, harsher, boxier, telephone) | An untouched steady passage |
| Dynamics | From a stated time, a level step or ramp (7 to 18 dB) on a steady passage | An untouched steady passage |

Changes land between 7 and 13 seconds (by the case id), crossfaded over 50 ms. "Steady" is the 20-second span
with the least spread of 1-second RMS levels; reviewers are told that spread. A clip that would clip is scaled
down as a whole (never up), so changes inside it are exactly as stated.

## Running it

```sh
pnpm tsx scripts/hearing-benchmark.ts fetch      # download, verify hashes and licences (~1.3 GB)
pnpm tsx scripts/hearing-benchmark.ts prepare    # cases.json, cases/*.wav, recordings.html
pnpm tsx scripts/hearing-benchmark.ts sheets     # http://127.0.0.1:5345: recordings.html (check these) and compare.html
pnpm tsx scripts/hearing-benchmark.ts run --provider=qwen --split=development
pnpm tsx scripts/hearing-benchmark.ts compare    # compare.html: development runs side by side
pnpm tsx scripts/hearing-benchmark.ts run --provider=qwen --split=heldout     # two trials a case
pnpm tsx scripts/hearing-benchmark.ts review --run=heldout-qwen               # http://127.0.0.1:5346
pnpm tsx scripts/hearing-benchmark.ts score --run=heldout-qwen [--certify=data/hearing-certification.json]
```

Everything is in the gitignored `data/hearing-benchmark/`. Runs go through `AudioIntelligence` itself (the same
preparation, prompt, validation and receipts as the assistant's `hear_audio_artifact`), each repeat in a project
of its own so a repeat is never answered from the cache. A run resumes where it stopped and refuses to mix
models. The three arms are the local measurements (DSP), the provider's validated findings (audio), and both
(combined). Each reviewer sees a trial's arms as A, B and C in an order of their own. Reviews are saved per
reviewer as they're given; nothing here writes a review. A certificate is written only if a task passes; load it
with `EDITOR_HEARING_CERTIFICATION`.

## Limits

- The clips are real recordings, but most of their changes are made by us: the benchmark asks whether the model
  hears a stated change, not whether it judges a mix. Untouched-mix context cases are the exception, judged by
  listening.
- The provider hears a mono downmix (the pipeline's), so stereo isn't tested.
- MP3 mixes are band-limited (about 16 kHz and up are missing); that's the same for every arm.
- Reviewers are told the truth of each case. That helps them check claims; it doesn't tell them which arm is which.
- Reviewers can tell the arms apart by their shape (measurements only, findings only, or both); the labels and
  order are blind, the content can't be. That is the preregistered three-arm design.

## Runs, 2026-10-05

**Providers.** The Gemini key is on Google's free tier: Gemini 3.8 Flash returned HTTP 503 ("high demand") for
every audio request, 3.1 Pro and Omni 1.1 Flash are refused (0 tokens a minute on the free tier), and 2.5 Flash is
gone. Gemini 3.5 Flash answers (about 13 s a clip) but hit 429/503 on 2 of 10 development requests. Qwen 3.8 Omni
Flash completed everything, but its reasoning streams ~1,600 tokens for a 20-second clip: about 160 s a request, so
the adapter's old 45-second limit never finished; it is now 240 s.

**Development** (10 cases, not counted). Neither provider heard a stated change in tone (treble −10 dB, +8 dB);
neither heard a −16 dB fade (Gemini didn't answer it). Gemini heard the −9 dB step roughly, then invented a
build-up, and invented changes in all three untouched clips (a "boomy drone", "the full band entering", "a drop at
6 s"; their bands measure flat). Qwen called all three untouched clips steady (right) and every changed clip
steady too (wrong). Qwen went on to the held-out run: it invents least and completes reliably.

**Held-out, Qwen 3.8 Omni Flash** (38 cases × 2 trials, 76/76 completed, ~98,000 tokens). Read against the known
truth before any review (an operator's screen, not a review; nothing was certified):

| Task | Constructed changes heard (both trials) | Controls |
| --- | --- | --- |
| Context | Vocal leaving at 7.0 s and entering at 8.0 s: both trials, to the second. Bass leaving (twice) and drums leaving: missed in both; drums entering: missed, or a drop-out invented | All 3 solo stems: "only a voice / bass / acoustic guitar", both trials |
| Tone | None of 8 (duller, brighter, boomier, thinner, harsher ×2, boxier, telephone): every trial says the balance stays consistent | Described as consistent |
| Dynamics | 2 of 8, late or in one trial (+9 dB ramp, +7 dB step); missed −9, +8, −10 and −8 dB steps and −18, −15 dB ramps | Mostly steady; some natural phrase swells described |

**The local measurements on the same clips** (`ears`: `listen` from `spectrum.ts`, scored automatically against
the constructed truth, ±1.5 s): level changes 8/8 (every step and ramp, the ramps' full size measured over four
seconds) and no loudness change on any of the 4 untouched dynamics clips; tonal changes 4/8 at their time, two
more in the right band and direction about 2 s late, and none on the 4 untouched tone clips; a stem leaving or
entering 3/6 (it can't name the instrument). Development: level 2/2 and 2/2, tone 1/2 and 1/2.

Under the gate, one flagged factual error fails a task, so a full review is expected to promote nothing. Hearing
stays measurements-only. The one capability that held up is narrow: whether a voice is present, and when it
enters or leaves. A future benchmark could test that as a task of its own.

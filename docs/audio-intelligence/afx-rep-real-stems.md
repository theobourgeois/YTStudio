# AFx-Rep with real stems and native plugins — 2026-10-04

AFx-Rep matched processing labels in **72/126 comparisons (57.1%)**, against
**19/126 (15.1%)** for the spectral baseline. Delay and the combined chain were
strongest. Subtle EQ and dry audio remained difficult across different sources.
This supports reference-processing comparison as a potential use, but does not
establish that AFx-Rep can judge mix quality or choose good plugin settings.

This follow-up replaces the earlier pilot's synthetic source and Python effects
with real multitrack recordings and the application's actual native export API.

## Recordings and preparation

Six complete raw recordings were downloaded from the
[Mix Evaluation Dataset mirror](https://huggingface.co/datasets/sparrowreivun/Mix-Evaluation-Dataset-2.0),
pinned to revision `ac28ccd742b5cf1380838098b7921f4ebc82d041`:

| Song / artist | Raw stems |
| --- | --- |
| Lead Me / The DoneFors | LeadVoc.wav, Bass DI.wav, Act Guit.L.wav |
| In The Meantime / Fredy V | BG1.wav, EGtr1a.wav, Sn.wav |

The dataset's [song-specific licence records](https://huggingface.co/datasets/sparrowreivun/Mix-Evaluation-Dataset-2.0/resolve/ac28ccd742b5cf1380838098b7921f4ebc82d041/Evaluation/MixEvaluation/songs.xml)
identify both songs as **CC BY 3.0**, originally from the Open Multitrack Testbed.
Credits, licence links and modifications accompany the exported audio.
The six original files total **491,400,252 bytes (~491 MB)** and remain unchanged.

Inputs are real 96 kHz mono recordings. Preparation selects each stem's most
active 16-second window, resamples to 48 kHz, calibrates input peaks to -6 dBFS,
adds short boundary fades and appends four seconds of silence for effect tails.
Native exports discard the first four seconds as plugin warm-up, leaving twelve
seconds of performance and four seconds of tails. Selection times, gains, file
hashes and original formats are recorded in `prepared-manifest.json`.

The six excerpts have independently selected times. They are individual stem
tests, **not a time-aligned six-track mix**. Native exports are stereo, but the
original sources are mono; this does not test captured stereo instruments.

## Actual app processing

`scripts/render-afx-real-stems.ts` calls `AudioEngine.renderExport` from
`server/music/engine.ts`, using the built Vaudio engine in an isolated workspace.
No live project is changed. Native engine settings and binary hash are saved in
`render-manifest.json`; the engine binary passed the source freshness check.
All 42 exports completed without missing plugins or sources.

| Treatment | Native processing |
| --- | --- |
| Dry | No effects |
| EQ darker | YT-EQ, 5 kHz high shelf, -6 dB, Q 0.71 |
| EQ brighter | YT-EQ, 5 kHz high shelf, +4 dB, Q 0.71 |
| Compression | YT-C, clean, -26 dB threshold, 4:1 ratio, 6 dB knee, 10 ms attack, 150 ms release, 18 dB range, fully wet, no auto gain/release |
| Plate reverb | YT-R, plate, 25 ms predelay, 1.4 s decay, 30% wet |
| Delay | YT-Delay, single, 250 ms time mode, 25% feedback/wet, no saturation |
| Chain | YT-EQ high shelf -2 dB → same YT-C → same YT-R at 15% wet |

These are controlled settings for matching tests, not proposed final mixes.
Python prepares sources and computes embeddings; it does not generate the
effects in this test. Native passages are floating-point WAVs with preserved
gain and effect tails. Every processed variant differs from dry. All 42 passages
are finite, 48 kHz, 16 seconds long and have zero full-scale samples.

## Matching results

Each query is compared with all seven treatments of a stem from the other song.
Three stems per song, both directions and seven labels give 126 comparisons.
Matching the same label counts as correct; matching the same waveform is excluded.
The encoder uses upstream peak normalization and mid-vector cosine similarity.
The spectral baseline uses 32 log-spaced power bands, mean-centred dB profiles
and cosine similarity, on exactly the same files and candidate sets.

| Target label | AFx-Rep correct / comparisons |
| --- | --- |
| Dry | 1/18 |
| EQ darker | 8/18 |
| EQ brighter | 8/18 |
| Compression | 11/18 |
| Plate reverb | 9/18 |
| Delay | 18/18 |
| Chain | 17/18 |
| Total | **72/126** |

Uniform random selection averages 18/126. Comparing only matching instrument
families across songs (vocals and guitars) gives 19/28 correct. The overall
comparison includes difficult pairs such as bass versus snare. These are
dependent comparisons over six excerpts from two songs, not a general accuracy
estimate. Training-set overlap has not been ruled out.

CPU and Apple MPS both produced the same 72 correct matches and identical
candidate selections. Maximum normalized embedding component difference was
`3.25e-7`. Median inference for a complete 16-second passage was approximately
129 ms on CPU and 137 ms on MPS on this machine. Repeat inputs reproduced the
same vectors. A -12 dB input gain change did not change vectors, as expected
from upstream peak normalization. Silence still produces a unit embedding;
reject silence using signal measurements before requesting a reference match.

The checkpoint and source revisions are documented in [the original pilot](afx-rep-pilot.md).
This test does not validate settings prediction, multi-track balance, or listener
preference. The lower result than the original pilot is useful: moderate native
effects on varied real sources are a harder and more relevant retrieval problem.

## Listening and reproduction

The audition package is in `~/Downloads/AFx-Rep-real-stems`. Open `listen.html`
for six players with seven treatments each. Switching effects preserves playback
position; playing another stem pauses the previous player. It works offline.

`raw/` contains the 42 actual native passages. `volume-matched/` contains 42
copies with only a scalar gain adjustment, matching performance RMS within each
stem with at least 1 dB peak headroom. This is approximate level matching, not
LUFS matching. Full manifests and audition gains are included. Browser playback
and switching at the same position were checked in the collaborative preview.

From the repository root, with the existing Python environment and built engine:

```sh
data/afx-rep-runtime/venv/bin/python scripts/prepare-afx-real-stems.py
pnpm exec tsx scripts/render-afx-real-stems.ts
data/afx-rep-runtime/venv/bin/python scripts/afx-rep-pilot.py --device mps --render-manifest data/afx-rep-real-stems/render-manifest.json --output data/afx-rep-real-stems/afx-mps.json
data/afx-rep-runtime/venv/bin/python scripts/afx-rep-pilot.py --device cpu --render-manifest data/afx-rep-real-stems/render-manifest.json --output data/afx-rep-real-stems/afx-cpu.json
data/afx-rep-runtime/venv/bin/python scripts/export-afx-audition.py
```

Audio and result artifacts are gitignored in `data/afx-rep-real-stems` (~1.1 GiB);
the separate audition package is approximately 493 MiB. Rerunning the exporter
creates a numbered folder rather than overwriting an existing audition package.
No Gemini or other hosted inference API is involved.

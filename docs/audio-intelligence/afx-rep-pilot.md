# Local AFx-Rep pilot — 2026-10-04

Follow-up: [real stems and native app plugins](afx-rep-real-stems.md) replaces
the synthetic-source/Python-effect test below with full-resolution recordings,
42 native renders, cross-song comparisons and an offline listening player.

**Verdict: promising for comparing processing character against a reference.
It does not diagnose a mix, choose settings, or measure mix quality.**

The published checkpoint downloaded successfully and inference runs on both
Apple MPS and CPU. The checkpoint is **1,156,477,784 bytes: 1.16 GB / 1.08 GiB**.
The local installation occupies approximately **2.25 GB**, including Python
dependencies, upstream source, reports, and rendered test WAVs. Shared uv and
managed-Python caches are outside that directory.

## Setup and rerun

Everything lives in gitignored `data/afx-rep-runtime`:

- Isolated Python 3.11 environment: `venv`.
- Reviewed upstream source: `source`; git revision recorded in `source-revision.txt`.
  Tested revision: `ec50e0cc647cc3637d0cbbfc01d059c682c9fb27`.
- Published checkpoint and config: `weights`, from
  `csteinmetz1/afx-rep` revision `6582cb5414094146759319819a4242967ecc7e39`.
- Installed versions: `requirements-frozen.txt`.
- Final reports: `results-mps.json` and `results-cpu.json`.
- Final audio: `fixtures/mps` and `fixtures/cpu`.

```sh
data/afx-rep-runtime/venv/bin/python scripts/afx-rep-pilot.py
data/afx-rep-runtime/venv/bin/python scripts/afx-rep-pilot.py --device cpu
```

The runner downloads the pinned checkpoint if missing. It imports the author's
`Cnn14` encoder from the local source and loads only `encoder.*` weights with
strict key matching. Checkpoint loading uses `weights_only=True`, `mmap=True`,
and a scan for unsupported serialized globals. It does not initialize the
training framework, Wandb, VST plugins, or other hosted models.

On another machine, use a Python 3.11 environment, clone
[the author's source](https://github.com/csteinmetz1/st-ito), record its revision,
and install `torch`, `torchlibrosa`, `soundfile`, `scipy`, `pyyaml`, and
`huggingface-hub`. Librosa/Numpy arrive through torchlibrosa. This setup also
installed torchaudio, but inference here does not import it. The test sources
must be present at the paths below; the installed environment already has them.

## Test design

Three source excerpts, up to six seconds each:

1. Real drums: MixAssist `Group2/cut_12.wav`.
2. Real music: MixAssist `Group5/cut_2.wav`.
3. Our deterministic generated voice-like signal mixed with a drum beat.

The two real recordings are from
[Zenodo record 15848443](https://zenodo.org/records/15848443), CC BY 4.0,
associated with Michael Clemens and Ana Marasović's
[MixAssist dataset](https://huggingface.co/datasets/mclemcrew/MixAssist).
They were downloaded during the MixAssist pilot. This test does not establish
whether their underlying songs overlap AFx-Rep's original training corpora.

Each source is decoded/resampled to 48 kHz, retaining its channels, and its
peak set to -6 dBFS before making six processing variants:

| Variant | Known processing |
| --- | --- |
| Dry | No change |
| Lowpass | Fourth-order 2 kHz lowpass |
| Highpass | Fourth-order 300 Hz highpass |
| Compression | Linked peak detector; -35 dBFS threshold, 4:1 ratio, 1 ms attack, 100 ms release |
| Distortion | `tanh(8*x)` saturation |
| Reverb | Fixed-seed diffuse IR, 30 ms predelay, approximately 0.7 s decay, 35% wet |

Every processed clip receives the author's per-file peak normalization before
embedding extraction. The encoder produces separate 512-dimensional mid/side
vectors, each L2-normalized. Comparisons here use **mid only**, because both
real source files are mono. The real sources were originally 16 kHz; upsampling
does not restore content above 8 kHz. This test does not validate stereo width
matching or full-band high-frequency behavior.

For each ordered pair of different recordings, a processed query is compared
with all six versions of the other recording. The closest cosine match is
counted correct if it has the same processing label: six ordered source pairs
times six labels gives 36 comparisons. Identical-waveform matches are excluded
from this retrieval count.

A simple DSP baseline uses 32 log-spaced spectral power bands from 20 Hz to
20 kHz, with a 2048-point FFT/1024-sample hop, mean-centered dB profiles, and
L2 cosine comparison. It receives the same clips and candidate sets. This is
a basic spectral comparator, not our entire DSP measurement system.

## Findings

AFx-Rep found the correct processing type in **26/36 comparisons (72.2%)**.
The simple spectral baseline found **15/36 (41.7%)**; uniformly random selection
would average 6/36 (16.7%). Restricting the comparison to the two real recordings
gave **11/12 correct**. These are dependent comparisons over just three excerpts,
not a broad accuracy benchmark or an estimate of subjective mixing quality.

| Processing target | Correct AFx-Rep matches |
| --- | --- |
| Dry | 1/6 |
| Lowpass | 6/6 |
| Highpass | 6/6 |
| Compression | 4/6 |
| Distortion | 3/6 |
| Reverb | 6/6 |

Dry/processed confusion remains substantial, and compression/distortion were
less consistent than EQ/reverb. The first test used a -20 dBFS threshold and
10 ms attack, which barely engaged on the quiet band excerpt. Its matching
result was 23/36. The final test lowered the threshold and shortened the attack
so all recordings underwent measurable compression. Initial output records
are retained as `results-*-initial.json`; their old WAV paths are not the final
verified audio artifacts. A compression treatment here is a known transformation,
not a claim that its settings improve the recording or reduce every crest factor.

Control results:

- Repeated extraction produced identical vectors on the same backend.
- Reducing input gain by approximately 12 dB left embeddings unchanged, as
  expected from peak normalization. AFx-Rep must not be used as a level meter.
- Exact silence still produced a finite, unit-length embedding. Silence must
  be rejected by DSP rather than inferred from an embedding's norm.
- CPU and MPS selected the same reference candidates. Their normalized vector
  components differed by less than `1e-6` in the completed verification.
- All final saved WAV hashes match their report records.

Warm extraction of a six-second excerpt took approximately **23 ms on MPS**
and **34 ms on CPU** at the median. These times cover the encoder, normalization,
and output transfer; they exclude file decoding, resampling, effects rendering,
and input tensor creation. First-use MPS calls took longer due to initialization.
Model loading took approximately eight seconds. The encoder has 81.9 million
parameters; reported MPS allocation was approximately 0.33 GB of live tensors
and 1.15 GB in driver allocations after the test. These are not total system RAM
or a sampled peak-memory measurement.

`verification.json` records checks of all 36 final backend-specific WAV hashes,
identical backend candidate selections, CPU/MPS embedding agreement, repeat
determinism, and gain invariance. Python syntax validation passed. The app's
required typecheck and unit tests are recorded in `app-tests.log`; this pilot
changes no UI behavior.

## Application implication

Keep AFx-Rep as a candidate **reference similarity** component alongside existing
DSP constraints and listening comparisons. The next useful experiment is a
small ST-ITO search over known effects, checking whether its rendered result
approaches a target without introducing clipping or unwanted artifacts.

AFx-Rep itself provides no text explanation, plugin settings, musical balance
judgment, or guarantee that a closer embedding means a better mix. No project
edits or automatic effect application were introduced by this pilot.

The [official ST-ITO project](https://csteinmetz1.github.io/st-ito/) describes how
these learned representations are used for optimization. The
[published AFx-Rep weights](https://huggingface.co/csteinmetz1/afx-rep) are local
downloads; no API key or audio upload was required.

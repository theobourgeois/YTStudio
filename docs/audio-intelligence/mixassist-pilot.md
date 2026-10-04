# Local MixAssist pilot — 2026-10-04

This pilot evaluates the author's **reconstructed LoRA adapter**, not the original
CUDA NF4 merged release. It runs locally on Apple MPS, with no API key or audio
upload. It produces advice and saved evaluation records; it does not change the
DAW, render an improved mix, or execute plugin settings.

## Installed setup

- Python 3.11 environment: `data/mixassist-runtime/venv`.
- Author's source: `data/mixassist-runtime/source` (commit recorded in
  `source-revision.txt`).
- Base: `Qwen/Qwen2-Audio-7B-Instruct`, revision
  `0a095220c30b7b31434169c3086508ef3ea5bf0a`.
- Adapter: `mclemcrew/Qwen2-Audio-MixAssist-LoRA`, revision
  `fe1acc1c3d1e7b28ba90a2a9fc6002e93296db34`.
- Model cache: `data/mixassist-runtime/models`. Weight payloads total
  16,811,092,488 bytes (16.81 GB / 15.66 GiB), plus tokenizer files and dependencies.
- Transformers 4.49.0, PEFT 0.14.0, Accelerate 1.4.0; all installed package
  versions recorded in `requirements-frozen.txt`.

Downloads and outputs are gitignored. The repository retains the runner and
this report. Models load from safetensors without remote Python model code.

## Run again

The installed environment can be used directly:

```sh
pnpm tsx scripts/make-audio-fixtures.ts --out data/mixassist-runtime/fixtures
data/mixassist-runtime/venv/bin/python scripts/mixassist-pilot.py
# Restrict evaluation to a case, preserving other reports:
data/mixassist-runtime/venv/bin/python scripts/mixassist-pilot.py \
  --case matched-steady --output results-matched.json
```

On another Apple Silicon machine, create an isolated Python 3.11 environment
with uv, clone [the author's repository](https://github.com/mclemcrew/MixAssist),
and install `torch` plus its `training/requirements.txt`. The runner downloads
the pinned model revisions on first use. `--download-only` skips inference.
Running on CPU silently is prohibited by this pilot. No system Python packages
or application dependencies are changed.

## Evaluation method

The adapter and base model receive identical audio, system prompt, producer
question, and seed 17. Dynamics and silence adapter cases also use seed 29.
Generation uses the author's sampling settings: temperature 0.7, top-k 20,
top-p 0.5, repetition penalty 1.1, up to 300 new tokens. Greedy decoding is not
used because the author reports repetitive degeneration with that setting.

Audio is resampled to 16 kHz mono and capped at 30 seconds, without gain
normalization. Mono preprocessing means this evaluation cannot validate advice
about stereo placement or width. Reports retain prompts, responses, durations,
generation times, token counts, input SHA-256 hashes, prepared peak/RMS, memory
allocation, and token-limit flags.

Controlled cases are deterministic generated signals, not real vocal recordings:

| Case | Known properties |
| --- | --- |
| Uneven phrases | Four synthesized voice-like phrases, peaks -6, -18, -9, -22 dBFS |
| Matched steady | Identical phrase material, each phrase set to -9 dBFS |
| Existing steady fixture | Different synthesized material, phrase peaks within 1.5 dB |
| Beat | Kick/snare/hats at 120 BPM, no bass line or melodic instrument |
| Tone | 1 kHz sine wave, no instruments or music arrangement |
| Mix | Uneven synthesized phrases mixed with the beat |
| Silence | Exact digital zero |

Two optional real examples are selected from the author's `has_content` test
split, with their original producer questions and conversation history. WAVs
come from [Zenodo record 15848443](https://zenodo.org/records/15848443), CC BY 4.0;
the source dataset is [mclemcrew/MixAssist](https://huggingface.co/datasets/mclemcrew/MixAssist).
Their references and expert targets are retained in `real-cases.json`. Selected
examples use groups 2 and 5; neither group appears in the released
`has_content` training or validation splits (verified from the downloaded
Arrow tables). These are two held-out session examples, not a broad benchmark.
Their text already names sounds and goals, so good replies alone do not prove
the model inferred those properties by listening.

## Interpretation

**Verdict: fast locally, but this reconstruction did not demonstrate dependable
audio-grounded mixing advice or a useful improvement over the base model.**

Completed 26 generations across 11 audio cases: 15 adapter replies and 11 base
replies. Results are in `results.json` (19 replies), `results-matched.json`
(3 replies), and `results-gain.json` (4 replies). All completed without hitting
the 300-token limit. Loading took 21.6 seconds; median generation time was
3.05 seconds, range 1.00–13.86 seconds. Maximum reported MPS driver allocation
was 18.80 GB, with approximately 16.87 GB of live tensors. These figures are
GPU allocations, not total system RAM. The local runtime directory occupies
approximately 18.23 GB / 16.97 GiB, excluding shared uv/Python caches.

| Check | MixAssist reconstruction | Base model |
| --- | --- | --- |
| Exact silence | Invented female vocals, instruments, noise, and processing needs on both seeds | Invented female singing and recommended reverb |
| Uneven synthesized phrases | Detected inconsistency but gave the wrong half-to-half direction on both seeds | Called levels generally consistent |
| Existing steady phrases | Repeated the same inconsistent/first-half-quieter diagnosis on both seeds | Called levels generally consistent, still suggested reverb |
| Matched steady phrases | Again claimed first half quieter on both seeds | Called levels generally consistent, still suggested reverb |
| 12 dB real-drum gain swaps | Said first half quieter for both opposite gain arrangements; only one direction was correct | Called both arrangements equal |
| Sine tone | Correctly identified a sine wave and said no adjustment needed | Also said no adjustment needed, but invented a 10-second duration |
| Drum beat | Identified drums; rhythm description was inaccurate and gain advice unverified | Identified kick/snare/hats; rhythm description was inaccurate and mix advice unverified |
| Synthesized voice + beat | Described a synth bassline/drum machine and proposed making drums more organic; no useful diagnosis of the known phrase-level problem | Generic advice about depth and character |
| Held-out overhead dialogue | Repeated “bring in the overheads” three times, without a useful procedure | Longer generic overhead advice |
| Held-out compression dialogue | Restated the producer's suggestion to compress drums generally | Longer restatement of the same suggestion |

The final gain control uses the same 6.6-second real drum excerpt twice,
resampled to 16 kHz before applying gains, making a 13.2-second input. One
version has the first half 12 dB louder; the other has the second half 12 dB
louder. Prepared half RMS values were respectively -17.63 / -29.63 dBFS and
-29.63 / -17.63 dBFS. The same question and seed were used for both. MixAssist
said “The first half is quieter” in the first case and “The first half is a
little quieter” in the reversed case. Raising the first half in the first
version, as it recommended, would increase the existing imbalance.

`feature-audit.json` verifies exact-zero silence PCM, finite extracted features,
and the 12 dB contrasts after preparation. `prepared-audio-audit.json` also
records synthesized phrase and half RMS levels. Resampling reduces their
high-frequency consonant peaks: the matched control has equal **source peaks**,
not perfectly equal prepared RMS. Its prepared phrase RMS range is 2.12 dB,
versus 14.48 dB for the uneven input. The first half is actually louder by
3.86 dB in the uneven input and 0.80 dB in the matched control, contradicting
the adapter's direction claim. This limitation motivated the exact-content,
12 dB real-audio control above.

The findings support keeping this as an experimental advice generator, with
silence detection and DSP measurements deciding when advice is admissible.
They do not support connecting its suggestions directly to plugin controls.
There was no measured or auditioned improvement to any mix in this experiment.

Validation: `pnpm typecheck`, all 217 test files / 2,533 app tests, Python syntax
validation, and the live local inference runs passed. UI behavior was not
changed, so browser tests were not needed.

This is a small practical screening exercise, not a mixing-quality benchmark.
Signal controls can reveal invented sources, missed level differences, or
unnecessary advice; they cannot prove how effective the suggestions would be
on real sessions. A useful text response is not evidence that applying its
suggested settings improves the audio. Actual changes still need measured
constraints, a rendered comparison, and audition.

The [adapter model card](https://huggingface.co/mclemcrew/Qwen2-Audio-MixAssist-LoRA)
documents the reconstruction: the original training script was lost and some
hyperparameters are reconstructed defaults. Its outputs must not be presented
as reproduction of the original paper's model or scores.

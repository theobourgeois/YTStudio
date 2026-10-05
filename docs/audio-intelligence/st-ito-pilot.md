# ST-ITO with real stems and native plugins — 2026-10-04

**Verdict: a working local settings-search prototype, most promising for delay
in this small test. Cross-song chain and EQ optimization did not beat the best
random starting settings on held-out audio.**

[ST-ITO](https://csteinmetz1.github.io/st-ito/) uses AFx-Rep to measure production
style and a gradient-free optimizer to search an effect chain's parameters.
It is the optimization step built around the representation we already tested,
rather than another independent mixing model.

## Size and installation

The existing AFx-Rep checkpoint is **1,156,477,784 bytes (1.16 GB / 1.08 GiB)**.
Its shared inference environment, source and existing AFx pilot artifacts occupy
approximately 2.25 GB, as documented in [the AFx-Rep pilot](afx-rep-pilot.md).
ST-ITO reused that checkpoint and upstream source; neither was redownloaded.

The only new package download was **CMA 4.4.4, approximately 328 KB**. Installed
package files occupy 2,649,275 bytes (~2.65 MB). Bootstrapping pip from Python's
bundled wheel added approximately 14.50 MB locally, with no model download.
The source checkout occupies approximately 41.24 MB and was already present.
This is a minimal inference setup, not the full upstream training/optional-model
dependency stack. There is no hosted API or API key involved.

The new runtime and audio artifacts occupy approximately 146 MiB, plus a separate
235 MiB audition package in Downloads. Those audio artifacts are optional;
they are not additional model weights. Measured byte counts are saved in
`data/st-ito-runtime/installation-size.json`.

## What actually ran

`scripts/st-ito-pilot.py` executes the **unmodified upstream `run_es` function**
from [the author's source](https://github.com/csteinmetz1/st-ito), revision
`ec50e0cc647cc3637d0cbbfc01d059c682c9fb27`. It also uses the author's
`get_param_embeds`, including per-file peak normalization and separate mid/side
embeddings. Only those reviewed functions are loaded, avoiding imports and
downloads for unrelated optional models. The encoder checkpoint uses strict
tensor loading with `weights_only=True` and an unsupported-globals check.

The upstream `process_audio` and `parameters_to_dict` callbacks are replaced by
an adapter to `scripts/st-ito-native-render.ts`. Every candidate calls our real
`AudioEngine.renderExport` API. The native engine passed the source freshness
check; its binary hash, exact songs and plugin settings accompany the results.
The upstream checkout itself was not modified.

Audio comes from the [real-stems AFx follow-up](afx-rep-real-stems.md): lead vocal
and acoustic guitar from “Lead Me” by The DoneFors, plus backing vocal and electric
guitar from “In The Meantime” by Fredy V. Both songs are CC BY 3.0 according to
the pinned dataset's song-specific licence records. Original source provenance,
excerpts and modifications are preserved in the report and audition package.
There are no synthetic sources or Python-generated effects.

Native rendering retains the calibrated -6 dBFS input, four-second warm-up,
twelve-second performance and four-second tail padding. Because upstream ST-ITO
normalizes its input, the callback restores the original scalar calibration
before passing it to native plugins. A hash check verifies that the optimizer
uses the same complete input throughout the run. Its native output callback
returns only the first eight seconds for optimization. Final selected settings
are re-rendered over the complete input for listening and held-out evaluation.

Search spaces deliberately remain small:

| Case family | Search parameters and bounds | Fixed native configuration |
| --- | --- | --- |
| Chain | High-shelf gain -8 to +6 dB; frequency 1–10 kHz; threshold -36 to -6 dB; ratio 1:1–6:1; reverb mix 0–40%; decay 0.3–2.5 s; predelay 0–60 ms | YT-EQ → YT-C clean → YT-R plate; Q 0.71, compressor attack 10 ms/release 150 ms, knee 6 dB, range 18 dB, no auto gain/release |
| Delay | Wet 0–40%; time 80–500 ms; feedback 0–40% | YT-Delay single, time mode, no saturation |
| EQ | High-shelf gain -8 to +6 dB; frequency 1–10 kHz | YT-EQ, Q 0.71, no auto gain |

Frequency, decay and delay time use logarithmic normalized mappings. The
optimizer chooses settings within the specified family; it does not choose
which plugins to add, their modes or arbitrary EQ shapes.

Runs used CPU, six Torch threads, population 12, random-initialization search,
sigma 0.1, no dropout, no random cropping and a maximum of 25 iterations. The
unmodified upstream early-stop rule ended the cases after 12–13 iterations.
Initialization uses fixed NumPy seeds; CMA's automatic seeds are recorded in
`run.log`, so rerunning is stochastic. There were **636 scored candidates** plus
native re-renders for outputs and controls, taking approximately **160 seconds**
in total for the four cases, excluding initial model load and packaging.

## Results

Distance is the mean of `1 - cosine_similarity` over AFx-Rep's mid/side embeddings.
Lower is closer to the reference in this model. The first eight seconds drive
the search. The held-out segment contains the remaining four seconds of
performance and four seconds of tails; it never selects settings. This is a
temporal check within the same recording, not independent-song generalization.

| Case | Held-out dry | Best initial random | ST-ITO | Known reference settings on input | Runtime |
| --- | ---: | ---: | ---: | ---: | ---: |
| Same vocal, EQ/compression/reverb control | 0.4408 | 0.0055 | **0.0006** | ~0 | 49.7 s |
| Different-song vocal chain | 0.5427 | **0.3663** | 0.3674 | 0.2986 | 50.7 s |
| Different-song vocal delay | 0.8582 | 0.4402 | **0.1660** | 0.1372 | 41.7 s |
| Different-song guitar EQ | 0.4029 | **0.3495** | 0.3510 | 0.3660 | 18.1 s |

The random control is the best of the same 12 initial candidates used by ST-ITO,
selected using training distance, not held-out distance. The known-settings
control applies the reference's original settings to the input. For different
performances it is a useful control, not a guaranteed objective optimum.

The same-source control approached the processed reference very closely,
showing that optimization can control our actual plugins. It did not recover
the exact original parameters: for example, the selected shelf frequency was
7.61 kHz rather than 5 kHz and predelay was 56.4 ms rather than 25 ms. Small
embedding distance should not be presented as exact parameter recovery.

Delay was the strongest practical result: approximately **80.7% lower held-out
distance than dry** and **62.3% lower than the best initial random settings**.
Chosen values were 197 ms, 26.5% wet and 35.5% feedback, versus the reference's
250 ms, 25% wet and 25% feedback. The difference in performances can influence
which settings minimize the embedding distance.

The cross-song chain selected a +2.26 dB shelf even though its reference used a
-2 dB shelf. Guitar EQ reached almost the lower search bound (-8 dB). These
results illustrate content/timbre confounding and the limits of treating model
similarity as an instruction to copy processing. Both had slightly worse
held-out results than the best initial random candidate despite better training
distance. Broader bounds or more iterations are not established remedies here.

All selected outputs are finite, 48 kHz, 16 seconds and unclipped. All 636 scored
candidates were below full scale. Re-rendering every selected candidate produced
the identical native WAV hash. Known settings on the same vocal scored effectively
zero; tiny negative distances in raw JSON are floating-point round-off.

These are four controlled examples, including one same-source control, with
single optimizer runs. No listener preference test, full mix balancing test or
training-overlap audit has been performed. This pilot supports auditionable
reference-based proposals, especially delay, rather than automatic final mixing.

## Listening and rerunning

Open `~/Downloads/ST-ITO-real-stems/listen.html`. It offers dry input, reference,
ST-ITO output, best initial random settings and known reference settings on input.
There are 20 native WAVs and 20 scalar-gain audition copies. Volume matching uses
12-second performance RMS with at least 1 dB peak headroom; it is not LUFS matching.
Native levels remain available. The browser preview passed muted playback,
same-position switching, single-player playback and raw-mode checks.

The player also works offline. For HTTP playback, the included loopback-only
server supports byte ranges so browsers can seek reliably:

```sh
data/afx-rep-runtime/venv/bin/python -m pip install cma==4.4.4
data/afx-rep-runtime/venv/bin/python scripts/st-ito-pilot.py
data/afx-rep-runtime/venv/bin/python scripts/export-st-ito-audition.py
python3 scripts/serve-audio-audition.py ~/Downloads/ST-ITO-real-stems
```

The existing built engine, pinned upstream source/checkpoint and real-stem
manifests are required. Results live in gitignored `data/st-ito-runtime`:
`results.json`, per-case candidate histories/settings, native WAVs, runtime logs,
frozen requirements and `verification.json`. Rerunning the optimizer replaces
its runtime results; exporting creates a numbered Downloads folder if needed.

Validation: `pnpm typecheck` and all 217 test files / 2,533 tests passed, alongside
the real native renders, audio/hash checks and browser playback checks. No app UI
or live project was changed.

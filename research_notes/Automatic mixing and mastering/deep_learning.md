# Deep-learning approaches to automatic music mixing and mastering (state as of 2026-10-29)

Scope: neural and differentiable automatic mixing (the priority) and mastering, from Mix-Wave-U-Net and FxNorm-Automix up to the ISMIR 2026 papers. For each system: how it works, its inputs and outputs (audio or interpretable parameters), its results, whether code and weights are released and under what licence, and its training data. Written for someone building an auto-mixer inside their own DAW: a native C++ engine with its own effects, a TypeScript app, and a local GPU.

Method note: these notes come from about 30 searches and page fetches: arXiv abstract and HTML pages, GitHub READMEs and project pages. Where a page did not say something (weights, licence, numbers), the gap is marked as a gap, not guessed. Several 2026 papers were readable only as abstracts. Their numbers are missing and are listed under Gaps.

---

## 1. Direct-transformation models (audio in, audio out): Mix-Wave-U-Net, Koo et al. Music Mixing Style Transfer (MixFXcloner), FxNorm-Automix, Sony's line

### Takeaway
Direct-transformation models take stems and output mixed audio from a neural network. There are no effect parameters to read off. Sony's line (Martínez-Ramírez, Koo, Liao, Mitsufuji) has the most usable open releases: FxNorm-Automix (MIT, trained models in the repo) and Koo's MixFXcloner (MIT, weights, trained on MUSDB18). But listeners in the 2025 MEGAMI test penalised the artifacts of these audio-to-audio systems. None of them can drive a DAW's own effects, so for this use case they are at most baselines or sources of ideas (for example, effects normalisation of wet training data).

### Cited Findings
- **FxNorm-Automix** (Martínez-Ramírez et al., ISMIR 2022, arXiv 24 Aug 2022): it trains automatic mixing on *out-of-domain* data, meaning wet (already processed) multitracks rather than dry stems. A "novel data preprocessing method" makes this possible. The paper's listening test used a redesigned method with "highly experienced mixing engineers as participants". The abstract gives no numeric result. — [arXiv 2208.11428](https://arxiv.org/abs/2208.11428)
- FxNorm-Automix's repo is under the **MIT licence** and ships trained models in `training/results` (`ours_S_La`, `ours_S_Lb`, `ours_S_pretrained`, and a Wave-U-Net baseline `wun_S_Lb`). The effects-normalisation pipeline is `scripts/data_normalization.sh`: it computes average features on the training data, then normalises it. MUSDB18 is used for the precomputed average features. The training impulse responses are not public "for copyright reasons". — [github.com/sony/FxNorm-automix](https://github.com/sony/FxNorm-automix)
- **Koo et al. "Music Mixing Style Transfer: A Contrastive Learning Approach to Disentangle Audio Effects"** (ICASSP 2023): an end-to-end mixing style transfer system. Its encoder is pre-trained with a contrastive objective to extract only effects-related information from a reference recording. — [Koo project page](https://jhtonykoo.github.io/MixingStyleTransfer); [Sony AI summary via search](https://ai.sony/publications/Fx-Encoder++-Extracting-Instrument-Wise-Audio-Effects-Representations-from-Mixtures)
- Its repo releases two pretrained models, the **FXencoder** (Φp.s., with FX normalisation and probability scheduling) and **MixFXcloner** (the mixing style converter), both trained on **MUSDB18**, under the **MIT licence**. Inputs are stereo, 44.1 kHz, 16-bit WAVs organised by song. The README warns against overly loud samples and does not mention mastering. — [github.com/jhtonyKoo/music_mixing_style_transfer](https://github.com/jhtonyKoo/music_mixing_style_transfer)
- **MEGAMI's benchmark (Sony AI/Aalto, Nov 2025)** retrained the older systems and scored them by Kernel Audio Distance (KAD) to human mixes (lower is better), on 59 internal dry/wet multitracks (590 segments of 11.9 s):

  | System | AFxRep | FxEnc | FxEnc++ | CLAP |
  |---|---|---|---|---|
  | Equal Loudness | 38.08 | 49.31 | 35.74 | 4.96 |
  | FxNorm-AutoMix S | 14.22 | 6.00 | 18.37 | 2.38 |
  | FxNorm-AutoMix L | 11.77 | 2.64 | 8.02 | 1.31 |
  | MixWaveUNet (retrained on internal I-S) | 12.99 | 57.96 | 23.45 | 1.76 |
  | DMC (Steinmetz 2021; gain and pan only) | 9.93 | 75.74 | 36.7 | 3.16 |
  | E2E-Flow (flow-matching end-to-end) | 17.15 | 5.44 | 14.98 | 5.48 |

  In MEGAMI's listening test, participants **penalised artifacts in FxNorm-AutoMix and E2E-Flow**. FxNorm-AutoMix and MixWaveUNet are limited to 4 stems in that benchmark ("NN" = 4). — [arXiv 2511.08040](https://arxiv.org/html/2511.08040)
- MEGAMI's authors describe the two prior families this way: direct audio-to-audio transforms "can introduce artifacts", while parameter-estimation systems are "limited to fixed, differentiable effect chains". Both treat mixing as deterministic regression, which leads to conservative "regression-to-the-mean" mixes. — [arXiv 2511.08040](https://arxiv.org/html/2511.08040)

### Inferences
- For a DAW auto-mixer, these models fit best as (a) baselines to beat, (b) a style-reference embedding source (Koo's FXencoder, MIT), and (c) a source of the FxNorm idea: normalising wet stems so that wet data can stand in for dry data. Their audio output cannot be edited in the DAW's own effects, so the user could not adjust the mix afterwards.
- MIT licensing on FxNorm and MixFXcloner makes them the most permissive of the Sony releases. The weights were still trained on MUSDB18 or undisclosed data, so their training-data terms remain a question for commercial use (see Q6).

### Gaps
- No numeric listening-test results for FxNorm-Automix (ISMIR 2022) or Mix-Wave-U-Net (2021) were retrieved, only the MEGAMI retraining benchmark. The original Mix-Wave-U-Net paper was not fetched.
- Which dataset FxNorm's released `ours_S_*` weights were trained on is not stated in the README.
- I found no distinct Sony product or paper named "MixFX" beyond Koo's MixFXcloner.

---

## 2. Differentiable effects and parameter estimation: DMC, DeepAFx(-ST), dasp-pytorch, Diff-MST, mixing graphs and GRAFX, ST-ITO, mastering (ITO-Master)

### Takeaway
This family outputs **interpretable effect parameters**, the right shape for a DAW with its own effects. Diff-MST (ISMIR 2024) predicts gain, parametric EQ, compressor and pan per track, plus a master-bus EQ and compressor. It handles any number of tracks and is CC BY-NC-SA. But it had no listening test of its own, and in a 2026 independent test (Shi, Reiss et al.) it scored far below MEGAMI and a training-free equal-loudness baseline (about 20–30/100 against about 55–65). ST-ITO (training-free, works with any black-box effect chain, gradient-free search on a learned style metric) and GRAFX mixing-graph pruning are the most transferable ideas for driving your own C++ effects. On mastering, the reference-based work is Sony's ITO-Master (ISMIR 2025).

### Cited Findings
**Diff-MST (Vanka, Steinmetz, Rolland, Reiss, Fazekas; ISMIR 2024)**
- It has three parts: a differentiable mixing console, a transformer controller, and an audio-production-style loss. It takes any number of input tracks with no source labels. The output is console parameters given a reference song. — [arXiv 2407.08889](https://arxiv.org/html/2407.08889v1); [project page](https://sai-soum.github.io/projects/diffmst)
- **The console:** per-track gain, parametric EQ, compressor and stereo pan, into a master bus with a stereo EQ and compressor. It is built on **dasp-pytorch** and has **no reverb**. The controller has two spectrogram encoders (tracks and reference) feeding a transformer with a learned master-bus token, and MLP heads that predict parameters. The paper states 190M trainable parameters. — [arXiv 2407.08889](https://arxiv.org/html/2407.08889v1)
- **Training data:** MedleyDB (196 songs) and Cambridge.mt (535 songs), split 4:1:1, plus MTG-Jamendo (more than 55k songs) as unpaired real references. — [arXiv 2407.08889](https://arxiv.org/html/2407.08889v1)
- **Objective results:** on 100 examples (Cambridge tracks, MUSDB18 references), Diff-MST AF-16 reached AF loss 3.26e-2 and FAD 15.1, against Koo's MST at 7.85e-2 and 17.9, and equal loudness at 6.55 and 17.6. The paper ran **no listening tests**. Its stated limitations: it degrades with more tracks than seen in training, has no reverb, has trouble with full-song inference, and its settings are static over time. The fetched text also suggests an inconsistency between the paper's tables and its conclusion about the MRSTFT+AF variant. — [arXiv 2407.08889](https://arxiv.org/html/2407.08889v1)
- **Code:** github.com/sai-soum/Diff-MST, **CC BY-NC-SA 4.0**. The README does not say where to download checkpoints (it refers only to `ckpt_path`). Configs are named `medley+cambridge-8.yaml` and `medley+cambridge+jamendo-8.yaml`. — [GitHub sai-soum/Diff-MST](https://github.com/sai-soum/Diff-MST)
- **Independent 2026 evaluation** (Shi, Hua, Xie, Li, Liu, Reiss; ISMIR 2026): 26 listeners, 18 retained after a reliability check, 1,170 ratings on a 1–100 scale adapted from BS.1534. The stimuli were three dense Cambridge pop/rock excerpts with 23–27 tracks, none in either model's training set.
  - Intra-group mixing: equal local loudness (ELL, training-free) **61.08**, MEGAMI 55.47, Diff-MST **21.36**.
  - Full mix of more than 20 tracks: MEGAMI 54.65 and Diff-MST 19.44. Two-stage versions (submix groups first) improved both, to 61.57 and 28.69, both significant.
  - The authors suggest Diff-MST's uniformly low scores "may reflect a floor effect". — [arXiv 2609.02835](https://arxiv.org/html/2609.02835v1)

**DeepAFx-ST (Steinmetz, Bryan, Reiss 2022) and its foundations**
- DeepAFx-ST is style transfer of audio effects with differentiable signal processing: a parametric EQ and a compressor driven by predicted parameters. — [arXiv 2207.08759](https://arxiv.org/pdf/2207.08759)
- The repo compares four ways to train through effects: autodiff (DSP in PyTorch), neural proxy, SPSA gradient estimation, and end-to-end TCN baselines. Checkpoints (v0.1.0 release) include music models trained on MTG-Jamendo. The licence is the **Adobe Research License** (not open for commercial use). — [github.com/adobe-research/DeepAFx-ST](https://github.com/adobe-research/DeepAFx-ST)
- **DMC** (Steinmetz et al., ICASSP 2021, "differentiable mixing console of neural audio effects") appears as a baseline in MEGAMI's benchmark, retrained on internal data with gain and pan only (see the table in Q1). — [arXiv 2511.08040](https://arxiv.org/html/2511.08040)

**Mixing graphs (Sungho Lee et al., SNU and Sony AI)**
- **GRAFX** (DAFx 2024 demo; arXiv 2408.03204) is an open-source PyTorch library for audio processing graphs. It computes graphs, signals and processor parameters in parallel on the GPU, and its music mixing example optimises every processor's parameters in a large graph by gradient descent. Code: github.com/sh-lee97/grafx. — [arXiv 2408.03204](https://arxiv.org/pdf/2408.03204)
- **"Searching for Music Mixing Graphs: A Pruning Approach"** (DAFx 2024; arXiv 2406.01049) reverse-engineers a mix from its dry tracks and the final mix. It starts from a console with every processor on every chain, then alternates pruning and fine-tuning, with differentiable processors and pruning. The result is a sparse graph with "nearly identical matching quality". The authors collect these graphs as a possible training dataset for neural mixing systems. Demo: sh-lee97.github.io/grafx-prune. — [arXiv 2406.01049](https://arxiv.org/abs/2406.01049)

**ST-ITO (Steinmetz et al., ISMIR 2024)**
- ST-ITO does style transfer by **searching the parameters of an arbitrary effect chain at inference time**, including unseen and **non-differentiable** effects. It uses a gradient-free optimiser against a self-supervised production-style metric, **AFx-Rep**. The authors open-sourced the code, datasets and benchmark: github.com/csteinmetz1/st-ito (`run_optim.py` takes an input and a target file, with optimiser and effect-type options; it also extracts AFx-Rep embeddings). — [arXiv 2410.21233](https://arxiv.org/html/2410.21233v1); [project page](https://csteinmetz1.github.io/st-ito)
- StemFX (2026) reports running "over 4000 times faster than iterative optimisation" (the ST-ITO-style approach), which shows ITO's cost: seconds to minutes of search per song. — [arXiv 2607.15634](https://arxiv.org/abs/2607.15634)

**Mastering**
- **ITO-Master** (Koo, Martínez-Ramírez, Liao, Fabbro, Mancusi, Mitsufuji; ISMIR 2025; arXiv 2506.16889, June 2025): reference-based mastering style transfer. A "Mastering Style Converter" is combined with inference-time optimisation of the reference embedding for finer user control. The authors explore both black-box and white-box modelling of mastering processors and propose "a more realistic differentiable mastering processor chain". Evaluation covered objective metrics, listening tests and CLAP text conditioning. The abstract gives no numbers or code licence. — [arXiv 2506.16889](https://arxiv.org/abs/2506.16889); [ISMIR 2025 poster](https://ismir2025program.ismir.net/poster_59.html)
- **NablAFx** (arXiv 2502.11668, 2025) is a framework for differentiable black-box and gray-box modelling of audio effects. — [arXiv 2502.11668](https://arxiv.org/pdf/2502.11668)

### Inferences
- **The most practical path for a C++ DAW is parameter estimation into your own effects.** Either (a) predict parameters with a network trained through differentiable versions of your own effects (the Diff-MST and DeepAFx approach: you would need PyTorch twins of the C++ EQ, compressor and pan, in the style of dasp-pytorch), or (b) ST-ITO-style search that calls your real C++ effects as black boxes and scores against a learned embedding. Option (b) needs no differentiable twins and no training, but costs search time per song.
- Diff-MST's poor showing in the 2026 independent test, below a training-free loudness balancer, is a warning: a parameter-estimation model trained on about 730 songs with a static console does not yet beat simple rules on dense real sessions.
- The GRAFX pruning work suggests a way to make your own training data: reverse-engineer parameter sets for your DAW's effect graph from dry/wet multitrack pairs.

### Gaps
- No public Diff-MST checkpoint URL was found. Diff-MSTC (a named successor) was not found in searches and may not exist under that name.
- GRAFX's licence, and whether the pruning paper's code and graph dataset are public, were not verified.
- dasp-pytorch's licence was not verified (Steinmetz's repo).
- ITO-Master's chain contents (whether it has a limiter), code release and numeric results were not retrieved.
- Neither "Reverse engineering of a mix" papers older than Lee 2024, nor a dedicated neural limiter or loudness paper for mastering, were found.
- Sony's "Music mastering style transfer" (Koo et al., ICASSP 2023 era, if distinct from ITO-Master) was not separately verified.

---

## 3. Generative, diffusion, flow-matching and LLM/agentic approaches (2025–2026)

### Takeaway
The 2025–2026 frontier is generative. The leading system is **MEGAMI** (Sony AI/Aalto, Nov 2025; reported elsewhere as ICASSP 2026). A diffusion model generates a per-track *effect embedding* for any number of unlabelled tracks, and a neural effects processor renders it. Its weights are public (CC BY-NC-SA 4.0), and in a 12-listener test it "approached" human mixes. ISMIR 2026 added Diff2Mix (diffusion plus a differentiable console: interpretable parameters, reference control), Sequential Stem Blending (latent flow matching, one stem at a time), two-stage subgrouping analysis, and StemFX. LLM agents (LLM2Fx, LLM2Fx-Tools, RIME, InstructFX2FX) map text to effect parameters. They are promising for an assistant-driven DAW but are not yet full automixers.

### Cited Findings
**MEGAMI ("Automatic Music Mixing using a Generative Model of Effect Embeddings"; Moliner, Martínez-Ramírez, Koo, Liao, Cheuk, Serrà, Välimäki, Mitsufuji; arXiv 11 Nov 2025)**
- **How it works:** a conditional diffusion model (EDM, probability-flow ODE sampling) generates one effect embedding per track, conditioned on CLAP content embeddings of the dry tracks.
  - The effect embedding is FxEncoder++ (2048-d) plus 64-d Fourier features of log-RMS, crest factor, dynamic spread, stereo width and imbalance.
  - The score model is a transformer of about 70M parameters, with self-attention across tracks. It is permutation-equivariant and pads sets to 14 tracks with masking.
  - A track-agnostic TCN of about 9M parameters with FiLM conditioning renders each mono track to stereo with the predicted effects.
  - A domain-adaptation MLP maps the CLAP embeddings of wet tracks toward dry ones, so the generator can train on **wet-only** stems. — [arXiv 2511.08040](https://arxiv.org/html/2511.08040)
- **Inputs and outputs:** dry multitracks at 44.1 kHz in 11.9 s segments. The output is **processed audio per track**, summed with no master-bus effects. There are **no interpretable parameters**: parameter estimation is listed as future work, and the embeddings are time-invariant. — [arXiv 2511.08040](https://arxiv.org/html/2511.08040)
- **Data:** Internal-Small (about 400 songs of dry/wet pairs), Internal-Large (about 20k songs of wet stems, mostly Western pop), and Public (248 MoisesDB and MedleyDB multitracks), plus dry single-track sets (MedleyDB, OpenSinger, IDMT-SMT, GuitarSet, Aalto anechoic orchestra) with synthetic effect chains. — [arXiv 2511.08040](https://arxiv.org/html/2511.08040)
- **Results (KAD, lower is better):** MEGAMI trained on I-L scored AFxRep 5.21, FxEnc 1.72, FxEnc++ 3.90, CLAP 0.84. The best baseline, FxNorm-AutoMix L, scored 11.77, 2.64, 8.02, 1.31. The publicly trainable MEGAMI-P scored 7.32, 3.28, 9.85, 1.12. The authors note that FxEnc++ and CLAP are MEGAMI's own components, so those columns are biased in its favour. — [arXiv 2511.08040](https://arxiv.org/html/2511.08040)
- **Listening test:** 12 listeners (6 with production experience), 7 songs, 5 stimuli per page (human, Equal Loudness, E2E-Flow, FxNorm-L, MEGAMI-L).
  - MEGAMI "approaches human-mix quality" and beats the baselines in most cases. It was rated *above* the human mix on some songs (Grunge, BritPop).
  - Equal Loudness did "unexpectedly well" on a Disco song. Confidence intervals were wide and results strongly song-dependent.
  - The results appear only as boxplots, with no numeric means. — [arXiv 2511.08040](https://arxiv.org/html/2511.08040)
- **Release:** github.com/SonyResearch/MEGAMI ships `CLAP_DA_public.pt`, `FxGenerator_public.pt` and `FxProcessor_public.pt` (release v0). The project is **CC BY-NC-SA 4.0**, with a contact for commercial licensing. It requires Python 3.13 and takes a folder of 44.1 kHz dry WAVs through `run_inference.sh`. — [GitHub SonyResearch/MEGAMI](https://github.com/SonyResearch/MEGAMI)
- The public checkpoint was trained on examples of up to 14 tracks, so sessions of more than 20 tracks needed label-driven grouping first (Shi et al. 2026). — [arXiv 2609.02835](https://arxiv.org/html/2609.02835v1)

**ISMIR 2026 and other 2026 work**
- **Diff2Mix** (Zong, Shi, Reiss; accepted to ISMIR 2026; arXiv 5 Aug 2026): a diffusion model plus a differentiable mixing console. A reference clip optionally sets the overall style, and the console exposes explicit effect parameters for interpretability and adjustment. The authors claim "competitive" objective and subjective results, but the abstract gives no numbers. Code and audio are at zys711.github.io/Diff2Mix. The paper is CC BY-NC-ND 4.0, and weight status is unknown. — [arXiv 2608.05442](https://arxiv.org/abs/2608.05442)
- **"Rethinking Automatic Music Mixing as Sequential Stem Blending"** (Yeh, Chan, Hung, Yang; arXiv 6 Aug 2026; a search listing says ISMIR 2026): each stem is blended into a growing submix by a latent flow-matching model conditioned on that submix, so the track count is unbounded. Training data is synthesised by degrading existing multitrack and separation datasets. Demo: sequential-mixing-demo.vercel.app. Code and weights are not stated. — [arXiv 2608.05506](https://arxiv.org/abs/2608.05506)
- **"Understanding Automatic Mixing: A Subtask-Oriented Analysis of Two-Stage Mixing System"** (Shi et al., incl. Reiss; ISMIR 2026): both two-stage variants significantly beat their single-stage versions. Bad grouping clearly degrades the result (MEGAMI scored 65.39 with 7 groups against 50.59 with 4). Loudness-balance errors mattered less. The authors conclude that "separating local balance from global mix coordination is a useful design principle". Code and audio are at sparrowreivun.github.io/TwoStageMixingAnalysis. — [arXiv 2609.02835](https://arxiv.org/html/2609.02835v1)
- **AiLive Mixer** (arXiv 2603.15995, 2026): a zero-latency deep-learning automixer for live performance. It simulates acoustic bleed on isolated-instrument data and currently predicts **mono gains only**. — [arXiv 2603.15995](https://arxiv.org/html/2603.15995)
- **StemFX** (Cheng, Wu et al., arXiv 2607.15634, 2026): a transformer decoder **autoregressively predicts tokenised FX chains** per separated stem, with a band-split CNN encoder and FiLM. It trained on pseudo-stems from about 105K songs, separated and augmented with "MultiAFx" (85 effects from 7 Python libraries).
  - It reports 86.8% Top-1 retrieval for the autoregressive formulation against 77.8% for contrastive learning, the best spectral fidelity and listener preference in style transfer, and more than 4000x the speed of iterative optimisation.
  - It is limited to 4 stems and to effects in its training set. A PyPI package (`stemfx`) separates internally with SCNet and outputs a 512-d embedding. — [arXiv 2607.15634](https://arxiv.org/abs/2607.15634); [pypi.org/project/stemfx](https://pypi.org/project/stemfx/)

**LLM and agentic**
- **LLM2Fx** (Doh et al., WASPAA 2025): zero-shot LLMs predict EQ and reverb parameters from text with no task-specific training. — [arXiv 2505.20770](https://arxiv.org/pdf/2505.20770); [demo](https://seungheondoh.github.io/llm2fx-demo/)
- **LLM2Fx-Tools** (Doh et al., ICLR 2026, as described by RIME): a text-only LLM tool-calling agent fine-tuned to derive FX chains from instructions, on a MedleyDB benchmark of random FX chains. — [RIME arXiv 2607.19605](https://arxiv.org/html/2607.19605)
- **Text2FX** (Chu et al., ICASSP 2025) uses CLAP to steer effects from text. **InstructFX2FX** (arXiv 2606.22005, 2026) does multi-turn text-to-effect refinement. Only titles and snippets were seen. — [search result: InstructFX2FX](https://arxiv.org/pdf/2606.22005)
- **RIME** (Schaffer and Singh, Dartmouth; arXiv v3 30 Sep 2026): "agentic post-production". It generates (input, edited, instruction) triples. Its POEMS toolkit has 20+ operators exposed over **MCP**: Demucs 6-stem separation, Pedalboard effects (EQ, compressor, limiter, reverb, delay, de-esser…), CREPE and PSOLA pitch, and gain, pan and fades.
  - On 15,000 triples, Gemma 3n after supervised fine-tuning scored Graph F1 0.858 and 69.0% parameter accuracy.
  - Parameter recovery collapses as instructions get abstract: 74.6% at abstraction level 0 to 10.9% at level 2 for GPT-Audio-Mini.
  - There is no comparison to MEGAMI, Diff-MST or human engineers. Code: github.com/sahaslab/RIME. — [arXiv 2607.19605](https://arxiv.org/html/2607.19605)
- **MixAssist** (COLM 2025) is a dataset of 431 audio-grounded conversational turns from 12 producers. Fine-tuned Qwen-Audio gave the best mixing advice among the models tested. — [arXiv 2507.06329](https://arxiv.org/html/2507.06329)
- **WildFX** (arXiv 2507.10534, 2025): a DAW-powered pipeline for in-the-wild audio FX graph modelling (title and snippet only). — [arXiv 2507.10534](https://arxiv.org/pdf/2507.10534)

### Inferences
- MEGAMI is the current best-documented automixer, but its non-commercial licence, audio-only output and 14-track training limit mean it cannot be the shipped engine of a DAW whose point is editable mixes. It could serve as a "target generator": render a MEGAMI mix, then fit the DAW's own effect parameters to it by ITO or GRAFX-style matching.
- Diff2Mix (diffusion plus console parameters) is architecturally the closest published fit to the user's goal. Its code is said to be public, but the CC BY-NC-ND paper licence and unknown weight status need checking.
- RIME's MCP-tool design matches this repo's assistant architecture: an MCP server with a tool per edit. Its numbers show LLMs do well on explicit instructions and poorly on abstract ones ("make it punchier"), which supports using LLMs as an interface layer over an automixer rather than as the mixer.

### Gaps
- No numeric listening results were retrieved for Diff2Mix, Sequential Stem Blending or ITO-Master.
- MEGAMI's venue as ICASSP 2026 is a secondary attribution (another paper's reference list).
- No diffusion-based *remixing* of full stereo songs, text-to-mix system, or use of Meta or Stability models for mastering was found. "MusicMagus" and "Diff-A-Riff" (generative stem models) were not researched for mixing use: they are music-editing and accompaniment-generation work, not mixing.
- No 2025–2026 DAFx or AES automixing paper was found in these searches.

---

## 4. Representation learning and evaluation of mixes: Fx-Encoder, Fx-Encoder++, AFx-Rep, CLAP, KAD, challenges

### Takeaway
Effect-representation encoders are now the backbone of both generation (MEGAMI conditions on FxEncoder++) and evaluation (KAD over FxEnc, FxEnc++, AFx-Rep and CLAP embeddings). They are the most reusable assets for a DAW: as a style metric for parameter search, or as a reference-matching objective. Evaluation is still weak. Listening tests are small (12–26 listeners, 3–7 songs), and objective metrics computed in a model's own embedding space are biased in its favour.

### Cited Findings
- **Fx-Encoder++** (Yeh, Koo, Martínez-Ramírez, Liao, Yang, Mitsufuji; ISMIR 2025; arXiv 2507.02273) extracts *instrument-wise* effect representations from a full mixture. Contrastive learning plus an "extractor" takes an audio or text instrument query and turns mixture-level effect embeddings into per-instrument ones. It was evaluated on retrieval and on effect-parameter matching. — [arXiv 2507.02273](https://arxiv.org/html/2507.02273v1)
- MEGAMI's README links FXEncoder++ and LAION-CLAP (music) checkpoints on their Hugging Face pages. — [GitHub SonyResearch/MEGAMI](https://github.com/SonyResearch/MEGAMI)
- **AFx-Rep** is ST-ITO's self-supervised production-style representation. Its authors report it "better captures attributes related to audio production". A 2025 paper describes ST-ITO with AFx-Rep as state of the art for effects style transfer. — [arXiv 2410.21233](https://arxiv.org/html/2410.21233v1); [search summary of arXiv 2505.11315](https://arxiv.org/pdf/2505.11315.pdf)
- **KAD over effect embeddings is now the de facto objective metric** (MEGAMI, 2025). Its authors caution that metrics computed with a system's own components are potentially biased. — [arXiv 2511.08040](https://arxiv.org/html/2511.08040)
- **StemFX** representation (2026): autoregressive FX-chain prediction beat contrastive learning for mixing-style retrieval (86.8% against 77.8% Top-1). — [arXiv 2607.15634](https://arxiv.org/abs/2607.15634)
- The Diff-MST evaluation used an "audio feature" (AF) loss and FAD. It admits that metrics may miss creative choices, masking and balance nuances. — [arXiv 2407.08889](https://arxiv.org/html/2407.08889v1)
- The listening-test protocol of the 2026 two-stage study: a 1–100 scale adapted from ITU-R BS.1534-3, hidden-repeat reliability screening (r > 0.75), 18 of 26 listeners retained. — [arXiv 2609.02835](https://arxiv.org/html/2609.02835v1)
- Steinmetz maintains a living, categorised bibliography of automatic mixing papers (knowledge-based, ML, overviews). The ISMIR 2022 "Deep Learning for Automatic Mixing" tutorial lists new systems, evaluation methods and dataset availability as open directions. — [Automatic mixing papers](https://csteinmetz1.github.io/AutomaticMixingPapers); [DL4AM tutorial](https://dl4am.github.io/tutorial/landing-page.html)

### Inferences
- For a local GPU DAW, the cheapest high-value building block is an effects encoder (FxEncoder++ or AFx-Rep) used as (a) a reference-matching loss for parameter search over the DAW's own effects, and (b) an automatic "does this mix resemble pro mixes in genre X" score.
- Learned mix-quality assessment remains immature. No standard learned MOS-like predictor for mixes was found.

### Gaps
- No public automatic-mixing *challenge* (an ISMIR, ICASSP or MDX-style automix track) or its winners were found. The MDX and SDX challenges were source-separation challenges.
- "AFX-Rep" licence, "Audio effect chain recommendation" papers and any MERT-based mix-quality predictor were not found or verified.

---

## 5. Stem separation as a front end (stereo MP3, then stems, then remix and master)

### Takeaway
On MUSDB18-HQ, RoFormer-family separators (BS-RoFormer, Mel-RoFormer) clearly beat htdemucs: about 9.65 dB average SDR for a 4-stem BS-RoFormer against about 9.0–9.2 dB for Demucs v4, and up to 12–13 dB on vocals. Separation front ends are already used in 2026 mixing research (StemFX on SCNet stems, RIME on Demucs 6-stem). Their licences are a patchwork: some community weights have no stated licence, and weights trained only on MUSDB18-HQ inherit questions about their training data.

### Cited Findings
- On MUSDB18-HQ, ZFTurbo's Music-Source-Separation-Training pretrained-model table lists **HTDemucs4 at an average of 9.16 dB**. A guide cites Demucs v4 at 9.00 dB (base) and 9.20 dB (fine-tuned). — [ZFTurbo pretrained_models.md](https://github.com/ZFTurbo/Music-Source-Separation-Training/blob/main/docs/pretrained_models.md); [BS-RoFormer guide](https://tomodahinata.com/en/blog/bs-roformer-mel-band-roformer-vocal-separation-guide)
- ZFTurbo's 4-stem **BS-RoFormer (ep_17): 9.65 dB** average SDR on the MUSDB18 test set. The repo is MIT, and the author answered "MIT" to a paid-app question. But it was trained only on MUSDB18-HQ, so commercial use of the *training data* is "not guaranteed". — [hodomia PR #1](https://github.com/tobyapi/hodomia/pull/1)
- In the Mel-RoFormer paper, vocal SDR at matched settings was BS-RoFormer 11.49 against **Mel-RoFormer 12.08**, and a stronger-trained Mel-RoFormer reached 13.29. — [ar5iv 2310.01809](https://ar5iv.labs.arxiv.org/html/2310.01809)
- viperx's BS-RoFormer ep_317 (vocals SDR 12.97) has **no stated licence**. Kimberley Jensen's Mel-RoFormer is listed as MIT on its model card. — [hodomia PR #1](https://github.com/tobyapi/hodomia/pull/1); [HF arraypress/stems-roformer](https://huggingface.co/arraypress/stems-roformer)
- BS-RoFormer original paper (ByteDance; arXiv 2309.02612). ByteDance also holds a granted US patent on "audio source separation using band-split transformers". — [arXiv 2309.02612](https://arxiv.org/pdf/2309.02612); [USPTO 12542148](https://image-ppubs.uspto.gov/dirsearch-public/print/downloadPdf/12542148)
- Mixing research uses separation front ends. StemFX's PyPI package separates mixtures internally with **SCNet** into 4 stems and admits separation errors may carry into its representation. RIME uses Demucs 6-stem, and its authors found SAM Audio separation gave poor results. — [arXiv 2607.15634](https://arxiv.org/abs/2607.15634); [arXiv 2607.19605](https://arxiv.org/html/2607.19605)
- Diffusion or consistency refinement of separator outputs is an active direction (arXiv 2412.06965). — [arXiv 2412.06965](https://arxiv.org/pdf/2412.06965)

### Inferences
- Separate, then remix, then master is technically viable for *coarse* re-balancing (vocal up, drums down, a new master) because 4-stem SDR of about 9–10 dB is good. Bleed and artifacts make heavy per-stem processing (strong EQ, compression, soloing) audible. Remix gently, and keep a residual (mixture minus the sum of stems) to restore what the separator lost. RIME's "stem-residual mixing" operator does exactly this.
- For shipping in a DAW: htdemucs (Meta's Demucs, generally MIT-licensed code) is the safe default. RoFormer weights give better quality, but check each checkpoint's licence and training data. Export to ONNX for the C++ engine.

### Gaps
- Demucs's licence and the MDX23C and UVR licences were not verified directly in this pass. No listening study of separate-then-remix artifacts specifically was found.
- No per-stem SDR (bass, drums, other) table was retrieved for the RoFormer models.

---

## 6. Datasets for training and evaluation, and their licences

### Takeaway
Public multitrack data is small (hundreds of songs) and almost all **non-commercial**: MedleyDB and MoisesDB are CC BY-NC-SA, and MUSDB18 is research-only. The best 2025 results (MEGAMI-L) used about 20k internal Sony songs of wet stems, a scale no public dataset approaches. The 2025–2026 workaround is synthetic data: random effect chains on dry tracks (MEGAMI, StemFX's MultiAFx with 85 effects), wet-to-dry domain adaptation, and separation-derived pseudo-stems (105K songs in StemFX).

### Cited Findings
- **MoisesDB:** 240 previously unreleased songs by 47 artists, free for **non-commercial research only, CC BY-NC-SA 4.0**. — [Moises blog](https://music.ai/blog/news/introducing-moisesdb-the-ultimate-multitrack-dataset-for-source-separation-beyond-4-stems); [arXiv 2307.15913](https://arxiv.org/pdf/2307.15913)
- **MedleyDB:** royalty-free multitracks for "noncommercial and academic research". mirdata lists a Zenodo subset as CC BY-NC-SA 4.0. — [NYU MARL MedleyDB](https://steinhardt.nyu.edu/marl/research/resources/medleydb); [mirdata](https://mirdata.readthedocs.io/en/0.3.1/_modules/mirdata/datasets/medleydb_pitch.html)
- **Diff-MST** trained on MedleyDB (196 songs) and Cambridge.mt (535 songs), with MTG-Jamendo (more than 55k songs) as references. — [arXiv 2407.08889](https://arxiv.org/html/2407.08889v1)
- **MEGAMI** data: about 400 internal dry/wet songs, about 20k internal wet-stem songs, and 248 public MoisesDB and MedleyDB multitracks. Dry sources were OpenSinger, IDMT-SMT, GuitarSet and the Aalto anechoic orchestra. Impulse responses came from ReverbFX, ASH and Arni. — [arXiv 2511.08040](https://arxiv.org/html/2511.08040)
- **Koo's MixFXcloner and FXencoder** trained on MUSDB18. — [GitHub jhtonyKoo](https://github.com/jhtonyKoo/music_mixing_style_transfer)
- **DeepAFx-ST** used MTG-Jamendo (music), LibriTTS and VCTK. Full preparation needs about 1 TB. — [GitHub DeepAFx-ST](https://github.com/adobe-research/DeepAFx-ST)
- **The 2026 two-stage study** used Cambridge Multitrack Library excerpts with 23–27 tracks as an out-of-training test set. — [arXiv 2609.02835](https://arxiv.org/html/2609.02835v1)
- **Mixing-graph data:** Lee et al. propose collecting the pruned graphs reverse-engineered from dry/wet pairs as a training dataset. **RIME** generates 15,000 synthetic (input, edit, instruction) triples. **MixAssist** has 431 conversational turns. — [arXiv 2406.01049](https://arxiv.org/abs/2406.01049); [arXiv 2607.19605](https://arxiv.org/html/2607.19605); [arXiv 2507.06329](https://arxiv.org/html/2507.06329)

### Inferences
- A commercial or shipping product cannot legally train on MedleyDB, MoisesDB or MUSDB18 without permission. The realistic options are: (1) license data or commission multitracks; (2) synthetic augmentation of dry recordings the user owns, with the DAW's own effects (the ground-truth parameters then come for free); (3) training-free methods (ST-ITO search, rule-based balancing) that need no mix dataset.
- Rendering random parameter settings through the DAW's own C++ effects produces unlimited (dry, wet, parameters) triples, which is the StemFX and MultiAFx recipe.

### Gaps
- **The Cambridge-MT (Mixing Secrets) licence could not be verified**: cambridge-mt.com returned 403. It is widely used in research, but its terms on ML training and commercial use are unconfirmed here.
- No licences were verified for MUSDB18(-HQ), DSD100, ENST-drums or FMA. No "MixParam" dataset or 2025–2026 public dataset of mixes *with parameters* was found, beyond the graph-collection proposal and synthetic sets.

---

## 7. Honest assessment: what beats a loudness-normalised sum or rule-based mix, where the methods fail, and the field's consensus; what is usable for this DAW

### Takeaway
As of late 2026, only **MEGAMI**-class generative systems have shown listener preference over simple baselines, and narrowly: 12 listeners, wide confidence intervals, song-dependent, with equal loudness winning on some songs. In the one independent 2026 test on dense real sessions, **a training-free equal-loudness balancer scored as well as MEGAMI (61 against 55, not significant) and far above Diff-MST (21)**. The recurring failure modes are track count, grouping, genre and data scarcity. For this DAW the realistic design is a **hybrid**:
1. rule-based or loudness-based balancing and functional grouping (submixes);
2. per-track and bus parameter estimation into the DAW's own effects, by search on a learned style metric (ST-ITO-style) or a model trained on synthetic renders of those effects;
3. optional reference-track style matching (FxEncoder++ or AFx-Rep);
4. a separate mastering stage;
5. an LLM or assistant layer for instructions.

### Cited Findings
- **The independent evidence (ISMIR 2026, Reiss's group):**
  - Full mixes of more than 20 tracks: MEGAMI 54.65, 2S-MEGAMI 61.57, Diff-MST 19.44, 2S-Diff-MST 28.69.
  - Intra-group mixing: ELL (training-free) 61.08 against MEGAMI 55.47 (n.s.) and Diff-MST 21.36.
  - Inappropriate grouping clearly degrades results.
  - Its limits: three pop/rock excerpts and mostly production-experienced listeners. — [arXiv 2609.02835](https://arxiv.org/html/2609.02835v1)
- **MEGAMI's own test:** "approaches human-mix quality". Equal Loudness was "unexpectedly" good on Disco, results were "strongly song-dependent", and the training data was mostly Western pop. The model makes time-invariant decisions, handles up to 14 tracks, and outputs no parameters. — [arXiv 2511.08040](https://arxiv.org/html/2511.08040)
- **Diff-MST's own admissions:** no listening test, degradation with more tracks than seen in training, no reverb, static settings, metrics that miss creative choices and masking. — [arXiv 2407.08889](https://arxiv.org/html/2407.08889v1)
- **Steinmetz and colleagues' longer-term view:** classical ML is held back by the "absence of large scale parametric data", and these systems "often fail to generalize to real-world music production use cases" (Colonel and Steinmetz slides). Deep learning has "potential to outperform" expert systems "but brings unique challenges" (ISMIR 2022 tutorial). — [Deep learning approaches to multitrack mixing (slides)](https://csteinmetz1.github.io/AutomaticMixingPapers/resources/deep_learning_approaches_to_multitrack_mixing.pdf); [DL4AM tutorial](https://dl4am.github.io/tutorial/landing-page.html)
- De Man, Reiss and Stables' "Ten Years of Automatic Mixing" (2017) documents the field's move from knowledge-based systems to ML and more complex systems. — [BCU open access](https://www.open-access.bcu.ac.uk/4968/)
- **Sony's (Martínez-Ramírez, Koo et al.) position**, as stated in MEGAMI: mixing is one-to-many, so deterministic regression yields conservative mixes. Generative modelling of effects is their answer. — [arXiv 2511.08040](https://arxiv.org/html/2511.08040)
- **LLM agents** recover explicit parameters well (up to 69% exact parameter accuracy after supervised fine-tuning) but collapse on abstract instructions (74.6% down to 10.9%). — [arXiv 2607.19605](https://arxiv.org/html/2607.19605)
- **Usability matrix (code, weights, licence, output):**

  | System | Output | Code | Weights | Licence |
  |---|---|---|---|---|
  | FxNorm-Automix | audio | yes | yes, in repo | MIT ([repo](https://github.com/sony/FxNorm-automix)) |
  | Koo MixFXcloner + FXencoder | audio / embedding | yes | yes | MIT, trained on MUSDB18 ([repo](https://github.com/jhtonyKoo/music_mixing_style_transfer)) |
  | MEGAMI | audio | yes | yes, release v0 | CC BY-NC-SA 4.0 ([repo](https://github.com/SonyResearch/MEGAMI)) |
  | Diff-MST | parameters (gain, EQ, compressor, pan, master EQ and compressor) | yes | download not found | CC BY-NC-SA 4.0 ([repo](https://github.com/sai-soum/Diff-MST)) |
  | DeepAFx-ST | parameters (EQ, compressor) | yes | yes | Adobe Research License ([repo](https://github.com/adobe-research/DeepAFx-ST)) |
  | ST-ITO / AFx-Rep | parameters for any chain | yes | encoder yes, per the paper ("open source datasets, benchmark, code") | not verified ([arXiv](https://arxiv.org/html/2410.21233v1)) |
  | GRAFX | parameters, graph | yes | n/a | not verified ([arXiv](https://arxiv.org/pdf/2408.03204)) |
  | Diff2Mix | parameters + audio | code said to be public | unknown | paper CC BY-NC-ND ([arXiv](https://arxiv.org/abs/2608.05442)) |
  | StemFX | embedding / FX-chain tokens | PyPI package | yes, via package | not verified ([PyPI](https://pypi.org/project/stemfx/)) |
  | RIME | agent tool calls (Pedalboard) | yes | n/a | code licence not stated ([arXiv](https://arxiv.org/html/2607.19605)) |

### Inferences
- **No neural automixer reliably beats a well-built loudness or rule-based balancer on dense real sessions yet.** The best generative model only matches it on intra-group balance and wins modestly once grouping is right. A strong *rule-based baseline* (loudness balance per functional group, then bus-level balance) should therefore be built first and kept as the floor.
- Practical recommended architecture for this C++/TS DAW, inferred from the evidence above:
  1. Functional grouping of tracks: drums, bass, vocals, harmonic, FX. This can use instrument-tagging or Fx-Encoder++ text queries, and could reuse the repo's audio intelligence.
  2. Intra-group loudness balance (ELL), which was as good as MEGAMI.
  3. Per-track EQ, compressor and pan parameters estimated against a target, where the target is a reference song's FxEncoder++/AFx-Rep embedding or genre statistics. Use gradient-free search over the real C++ effects (ST-ITO, CMA-ES) or a small network trained on synthetic renders of the DAW's own effects (StemFX/MultiAFx recipe).
  4. A bus/mastering stage: EQ, glue compressor, limiter to a LUFS target. ITO-Master's style transfer is research-only.
  5. The assistant (LLM via MCP, as RIME does) for "brighter vocal" or "more space" refinements.
- MEGAMI's non-commercial weights can still be used *offline in development* as a target generator, to see what a "good" parameter fit should sound like, but not shipped without a licence from Sony.
- Expect failures in genres outside Western pop/rock, sessions with more than 14–20 tracks without grouping, time-varying decisions (automation), creative effects and reverb (missing from Diff-MST), and inputs that are already mixed (separated stems carry artifacts).

### Gaps
- No direct quotes were retrieved from Steinmetz, Reiss or Martínez-Ramírez in 2025–2026 talks or theses on the state of the field. Steinmetz's PhD thesis was not fetched.
- No study pits neural automixers against a *commercial* rule-based or assistive mixer (iZotope Neutron, RoEx, LANDR) in a controlled test. Commercial systems are outside this note's scope and were not researched.
- No listening-test numbers were found for neural mastering against a simple loudness-normalise-plus-limiter chain.

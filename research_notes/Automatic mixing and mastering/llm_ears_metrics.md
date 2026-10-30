# LLMs for mixing and mastering: giving a text-only LLM "ears", and judging a mix without a listener

Research notes, gathered 2026-10-29. Scope: (a) LLM-based mixing/mastering research and products, (b) audio-language models (ALMs) and measurement pipelines that tell a text-only LLM what a mix sounds like, (c) objective metrics and learned predictors that can drive an automatic feedback loop, and (d) the division of labour between LLM and DSP/ML. Context: Claude Code / Codex driving a DAW through MCP tools, currently guessing effect settings because it cannot hear.

## 1. LLM-based mixing and mastering research and products (2024-2026)

### Takeaway
The research line has moved fast from "LLM predicts one effect's parameters from text" (LLM2Fx, mid-2025) to "LLM listens through an effects encoder, plans with chain-of-thought and calls effect tools" (LLM2Fx-Tools, Dec 2025), to hybrid "LLM is the brain, an embedding objective is the ear" refinement loops (InstructFX2FX, DAFx 2026), and to explicit learned critics of vocal-mix issues (MixJudge, Oct 2026). Every paper so far works on single tracks or vocal-plus-backing, not full multitrack mixes, and the strongest systems pair the LLM with something that actually measures or listens; text-only reprompting is repeatedly shown to be unreliable.

### Cited Findings

**LLM2Fx (Doh et al., Sony AI / KAIST; arXiv 2505.20770, v2 17 Jul 2025)**
- Asks whether LLMs can map natural-language timbre words to effect parameters zero-shot; outputs structured JSON for a 6-band parametric EQ (18 params) and a noise-shaped reverb (25 params) from the DASP library — [arXiv 2505.20770v2](https://arxiv.org/html/2505.20770v2)
- Models tested: Llama 3.2 1B/3B, Llama 3.1 8B, Llama 3.3 70B, Mistral-7B, GPT-4o — [arXiv 2505.20770v2](https://arxiv.org/html/2505.20770v2)
- Results (MMD on Fx-encoder embeddings, lower is better): random params EQ 0.53 / reverb 0.75; Text2FX-style CLAP optimisation 0.55 / 0.45; GPT-4o zero-shot 0.22 / 0.70; Llama 3.3 70B 0.24 / 0.52; Mistral-7B 0.30 / 0.45; ground truth 0.09 / 0.05. So LLMs beat CLAP optimisation on EQ but not clearly on reverb — [arXiv 2505.20770v2](https://arxiv.org/html/2505.20770v2)
- In-context "audio DSP features" given to the LLM as a JSON object: sample rate, RMS energy, crest factor, dynamic spread, spectral centroid, spectral flatness, spectral bandwidth, estimated RT60 — [arXiv 2505.20770v2](https://arxiv.org/html/2505.20770v2)
- Context ablation (Mistral-7B): DSP features alone improved EQ (0.27) but worsened reverb (0.55); DSP code alone EQ 0.23 / reverb 0.77; few-shot examples EQ 0.23 / reverb 0.28; all combined best, EQ 0.22 / reverb 0.27. Authors attribute the reverb problem to reverb algorithms differing widely while EQ is standardised — [arXiv 2505.20770v2](https://arxiv.org/html/2505.20770v2)
- Stated limitations: one effect at a time, single-track instruments only, not multitrack mixes — [arXiv 2505.20770v2](https://arxiv.org/html/2505.20770v2)

**LLM2Fx-Tools (Doh, Koo, Martínez-Ramírez, Choi, Liao, Mitsufuji, Wu, Nam; arXiv 2512.01559, 1 Dec 2025; described elsewhere as an ICLR 2026 paper)**
- Reframes Fx-chain estimation as "listen, plan, call tools": Fx-Encoder++ audio encoder (patch embeddings) → transformer adapter (32 learned queries) → Qwen3-4B fine-tuned with LoRA; emits chain-of-thought then JSON tool calls — [arXiv 2512.01559](https://arxiv.org/html/2512.01559v1); ICLR 2026 attribution from [Papernotes](https://en.papernotes.org/ICLR2026/image_generation/llm2fx-tools_tool_calling_for_music_post-production/)
- 9 tools / 26 parameters: Pedalboard compressor, distortion, reverb, delay, limiter, gain, plus custom 3-band EQ, stereo widener, panner. Tool calling lets it use non-differentiable plugins — [arXiv 2512.01559](https://arxiv.org/html/2512.01559v1)
- LP-Fx dataset: 100,800 conversations (chains of length 1-9) on MedleyDB audio; conversations written by Gemini 2.5 Flash-Lite, CoT by Gemini 2.5 Flash, filtered by Gemini 2.5 Pro — [arXiv 2512.01559](https://arxiv.org/html/2512.01559v1)
- Reverse engineering (dry/wet pair → chain): effect-type accuracy 80% vs Gemini 2.5 Flash 78%; ordering Spearman 0.56 vs 0.54; parameter MAE 0.23 vs 0.32; AFx-Rep similarity 0.68 vs 0.56 — [arXiv 2512.01559](https://arxiv.org/html/2512.01559v1)
- MUSHRA (16 listeners): hidden reference 81.5, LLM2Fx-Tools 62.8, Gemini 2.5 Flash 56.5, DeepAFx-ST 54.8, no Fx 39.1 — [arXiv 2512.01559](https://arxiv.org/html/2512.01559v1)
- Tool-call success: Qwen2.5-Omni-7B 0.2%, base Qwen3-4B 73.7%, Gemini 2.5 Flash 100%, LLM2Fx-Tools 99.8% (GPT-5 as judge) — [arXiv 2512.01559](https://arxiv.org/html/2512.01559v1)
- Removing CoT drops chain accuracy 80% → 67% and ordering correlation 0.56 → 0.49 — [arXiv 2512.01559](https://arxiv.org/html/2512.01559v1)
- Limitations: single-instrument sources only, unseen effects / VST plugins untested, small eval set; paper licence CC BY-NC-SA 4.0; only a demo page, no code/weights release stated; the paper has internal inconsistencies (text vs table numbers) — [arXiv 2512.01559](https://arxiv.org/html/2512.01559v1)

**Text2FX (Chu et al., Northwestern; arXiv 2409.18847, ICASSP 2025) and FxSearcher (arXiv 2511.14138, Nov 2025)**
- Text2FX: CLAP embeddings + differentiable DSP, single-instance optimisation of EQ and reverb toward an open-vocabulary prompt, no retraining; outputs interpretable parameters — [Text2FX arXiv](https://arxiv.org/html/2409.18847); [ICASSP PDF](https://interactiveaudiolab.github.io/assets/papers/chu2025icassp.pdf)
- FxSearcher: gradient-free Bayesian optimisation guided by a CLAP score, searching chains (EQ, reverb, distortion, pitch shift, bitcrush) of non-differentiable effects; adds a guiding prompt to reduce artefacts and an AI-based evaluation said to track human preference — [arXiv 2511.14138](https://ar5iv.arxiv.org/html/2511.14138); [project page](https://hojoonki.github.io/FxSearcher)

**InstructFX2FX (Yu, Liessens Dujardin, Cai, Zhang, Cruz, Wagner, Cella, UC Berkeley CNMAT; DAFx26 demo, Sept 2026)**
- Multi-turn, stateful refinement: "the LLM serves as a high-level planner that selects effects and proposes the initial parameter state"; CLAP-guided optimisation (gradient descent for differentiable effects, Bayesian optimisation otherwise) then refines the existing state. Framed explicitly as "pairing a brain with an ear" — [DAFx26 paper](https://www.dafx.de/paper-archive/2026/papers/DAFx26_demo_74.pdf)
- Argues naive LLM reprompting per turn "is unreliable: the model regenerates parameters non-deterministically, may perturb settings the user did not intend to change across iterations, and cannot hear the sound it is editing" — [DAFx26 paper](https://www.dafx.de/paper-archive/2026/papers/DAFx26_demo_74.pdf)
- Preliminary result: CLAP-guided refinement beat LLM+LLM initialise-then-reprompt on DSP-feature MMD for 9 of 10 SocialFX descriptor pairs; code at github.com/vaclisinc/InstructFX2FX; paper CC BY 4.0 — [DAFx26 paper](https://www.dafx.de/paper-archive/2026/papers/DAFx26_demo_74.pdf)

**MixAssist (Clemens & Marasović; arXiv 2507.06329, Jul 2025, COLM 2025)**
- 431 audio-grounded expert turns from 7 live collaborative mixing sessions with 12 producers (241 train / 34 dev / 156 test) — [arXiv 2507.06329](https://arxiv.org/html/2507.06329); COLM 2025 per [arXiv PDF header](https://arxiv.org/pdf/2507.06329)
- Fine-tuned Qwen-Audio-Instruct-7B, LTU and MU-LLaMA (LoRA, 1 epoch). o3-mini judge: Qwen avg score 7.06/10, ranked first 50.4%; LTU 6.48, 44.4%; MU-LLaMA 1.46, 5.2% — [arXiv 2507.06329](https://arxiv.org/html/2507.06329)
- Human: in 100 comparisons generated responses preferred 40% vs expert 33% (both good 12%, both bad 15%) — [arXiv 2507.06329](https://arxiv.org/html/2507.06329)
- Crucially, participants found the agent's audio analysis limited, "few insights based on the provided audio"; one said "It would have been more helpful had it been able to analyze the audio". Producers wanted the "why", feedback shown inside their DAW, and more creative suggestions — [arXiv 2507.06329](https://arxiv.org/html/2507.06329)
- Dataset listed on Hugging Face, audio on Zenodo, eval code on GitHub; dataset licence not explicitly stated (paper CC BY 4.0) — [arXiv 2507.06329](https://arxiv.org/html/2507.06329)

**MixJudge (Ho, Cheng, Yeh, Yang; arXiv 2610.30783, 22 Oct 2026)** — the newest and most directly relevant work; detail in section 2 and 5.
- A CLAP-based, language-queryable critic that takes backing, vocal and blend and answers whether the mix shows an issue from an 11-label vocabulary (too loud/quiet, muddy/thin, harsh/dull, too wet/dry, over/under-compressed, masking), mono only — [arXiv 2610.30783](https://arxiv.org/html/2610.30783)
- Used as a selector over a menu of 31 rendered processing candidates for a raw vocal, it picks an improving candidate 77.1% of the time (where one exists) — [arXiv 2610.30783](https://arxiv.org/html/2610.30783)

**RIME / POEMS (Schaffer & Singh; arXiv 2607.19605, Jul 2026, v3 30 Sep 2026)**
- Rule-based generation of 15,000 instruction-audio pairs following studio production practice, using POEMS, a toolkit of stem separation, mixing and studio effects "for use by multimodal agents"; testing existing multimodal LLMs as post-production agents "revealed persistent limitations", and SFT on the synthetic data improved them — [arXiv 2607.19605](https://arxiv.org/abs/2607.19605)

**SonicMaster (Melechovsky, Mehrish, Herremans, SUTD AMAAI; arXiv 2508.03448; ICML 2026)**
- A single flow-matching generative model for restoration and mastering, text-controlled or automatic, covering 19 degradations in EQ, dynamics, reverb, amplitude and stereo groups; corpus of 25k Jamendo segments × 7 degradations = 175k pairs; reports objective gains and listener preference over baselines; model and demo on GitHub — [arXiv 2508.03448](https://arxiv.org/html/2508.03448v1); [ICML 2026 poster](https://icml.cc/virtual/2026/poster/63870); [project page](https://amaai-lab.github.io/SonicMaster)
- Note: it regenerates audio rather than setting DAW plugin parameters, so it is a "delegate mastering to a model" option, not an explainable chain.

**Non-LLM automatic mixing baselines an assistant could call (2025-2026)**
- MEGAMI (Moliner et al., Aalto + Sony AI; arXiv 2511.08040, Nov 2025): diffusion model generating per-track effect embeddings (CLAP content + FxEncoder++ effect), track-agnostic TCN processor; listening test (12 listeners, 7 songs) "approaches the quality of human mixes", wide confidence intervals, song-dependent (an Equal Loudness baseline scored unexpectedly well on Disco); code github.com/SonyResearch/MEGAMI — [arXiv 2511.08040](https://arxiv.org/html/2511.08040)
- Sequential stem blending (Yeh, Chan, Hung, Yang; arXiv 2608.05506, Aug 2026): latent flow matching conditioned on a growing submix, mixing one stem at a time "like human engineers", any number of tracks; demo only — [arXiv 2608.05506](https://arxiv.org/abs/2608.05506)
- StemFX (Cheng et al.; arXiv 2607.15634, ISMIR 2026): predicts variable-length FX chains per source-separated stem with a Transformer decoder; MultiAFx toolkit of 85 effects from 7 Python libraries; best listener preference in paired style transfer; "over 4000 times faster than iterative optimization" — [arXiv 2607.15634](https://arxiv.org/abs/2607.15634)
- TimberAgent (arXiv 2603.09332, Mar 2026): retrieves editable plugin presets via Gram matrices of Wav2Vec2 activations (1,063 guitar presets, 26-person listening study); no LLM component confirmed — [arXiv 2603.09332](https://arxiv.org/html/2603.09332v1)

**Products**
- iZotope Neutron 5 ships an AI "Mix Assistant", plus Tonal Balance curve metering and Audiolens integration in Elements; Ozone 12 has a "Master Assistant" with a customisable flow and a Bass Control module; vendor line: tools "guide, not decide" — [MusicTech](https://musictech.com/products/izotope-neutron-5-mixing-suite/); [Native Instruments](https://www.native-instruments.com/en/products/izotope/mix-and-master-bundle-standard); [Plugin Boutique](https://www.pluginboutique.com/products/17245-Elements-Suite-12)

### Inferences
- The best evidence (LLM2Fx-Tools MUSHRA, InstructFX2FX, MixJudge) says a general LLM can supply a sensible starting chain and the intent, but the improvement comes from something that measures the rendered audio. A DAW assistant that only reasons in text is exactly the failure case the literature describes.
- Fine-tuning a small ALM on effect-encoder features (LLM2Fx-Tools) beats Gemini on reverse-engineering effects, but that is research code without released weights; for a Claude/Codex assistant the practical analogue is: give it measurements and a critic as tools, not a new encoder.
- Reverb is the hardest thing for a text LLM to set (LLM2Fx), so reverb/delay amounts are prime candidates for optimisation or measured feedback rather than LLM guessing.

### Gaps
- Not researched in this pass (no sources fetched): WavCraft, AudioGPT, Loop Copilot, MusicAgent, WeaveMuse (arXiv 2509.11183 surfaced but not read), RoEx Automix, LANDR, Masterchannel. These are mostly 2023-2024 "LLM orchestrates audio tools" systems; none was found to evaluate mixing quality specifically.
- No paper found (to Oct 2026) on an LLM agent mixing a full multitrack song in a DAW and being evaluated by listeners. RIME's numeric results were not visible on its abstract page.
- How Neutron/Ozone assistants work internally is not public.

## 2. Audio-language models that can listen: can they judge a mix?

### Takeaway
Not reliably, as of late 2026. Several 2026 benchmarks (SonicBench, VocalGrad, AcousticBench, MRMAD, MixJudge's critic exam) agree that ALMs recognise coarse content but sit near chance on relative loudness, dynamic range, severity ordering and "which of two is more X" judgments, which is exactly what mixing needs. The information is often present in the audio encoder but lost in the language decoder, and targeted fine-tuning closes much of the gap. Gemini 3.1 Pro is the strongest general model on acoustic perception; for local use Qwen2.5-Omni / Qwen3-Omni (Apache 2.0) are the open options, while NVIDIA's Flamingo models are non-commercial.

### Cited Findings

**Mixing-specific evaluation**
- MixJudge's critic exam compared generative ALMs (Music Flamingo, Audio Flamingo Next, Qwen2.5-Omni) scored by YES-NO logit margin, plus frozen CLAP. Opposite-issue discrimination and severity ordering stayed "near or below chance for several systems": Audio Flamingo Next severity correlation 0.175, Music Flamingo 0.235; Qwen2.5-Omni strongest generative baseline (opposite-issue accuracy 0.374, severity ρ 0.309). Adapted MixJudge: opposite-issue 0.839, severity ρ 0.971 — [arXiv 2610.30783](https://arxiv.org/html/2610.30783)
- In MixJudge's menu-selection task (choose the best of 31 processed vocals, judged by distance to a professional mix): MixJudge "closer rate" 0.727 vs best baseline 0.523 (Audio Flamingo Next), chance 0.380; whole-menu correlation 0.730 vs 0.350 — [arXiv 2610.30783](https://arxiv.org/html/2610.30783)
- Authors caution this "does not prove these models lack mixing knowledge", only that they do not reliably solve the critic tasks through this interface; GPT-4o / Gemini / Qwen2-Audio were not evaluated — [arXiv 2610.30783](https://arxiv.org/html/2610.30783)
- MixAssist users found fine-tuned Qwen-Audio's audio analysis "limited" — [arXiv 2507.06329](https://arxiv.org/html/2507.06329)
- LLM2Fx-Tools: Qwen2.5-Omni-7B achieved 0.2% tool-call success on the effects task; Gemini 2.5 Flash 78% effect-type accuracy on reverse-engineering effects from dry/wet pairs — [arXiv 2512.01559](https://arxiv.org/html/2512.01559v1)

**Acoustic-perception benchmarks (2026)**
- SonicBench (arXiv 2601.11039, Jan 2026): 12 physical attributes (incl. pitch, loudness) in 5 perceptual dimensions; most models near chance; unlike humans they do no better on comparisons than on recognition; explicit reasoning adds little; linear probes on frozen audio encoders recover the cues at ≥60%, so the bottleneck is alignment/decoding in the LLM — [arXiv 2601.11039](https://arxiv.org/html/2601.11039v1)
- VocalGrad (arXiv 2610.23745, NeurIPS 2026): binary "direction of temporal change in an acoustic feature" task; humans high, SOTA ALMs near chance; probing shows information present but unused by the LM head for some categories — [NeurIPS poster](https://neurips.cc/virtual/2026/poster/139190); [aggregator](https://www.opentrain.ai/papers/vocalgrad-evaluating-acoustic-perception-in-audio-language-models--arxiv-2610.23745/)
- AcousticBench (NeurIPS 2026): 3,200 two-choice questions incl. relative loudness, dynamic range, channel degradation; Gemini-3.1-Pro best on every aggregate, no model reaches humans, open-weight models lag most on relative loudness, dynamic range and channel degradation; LoRA fine-tuning Kimi-Audio's backbone (encoder frozen) took relative acoustic discrimination 69.2% → 98.7% — [NeurIPS poster](https://neurips.cc/virtual/2026/poster/139542)
- MRMAD (arXiv 2608.22236, Aug 2026): 18 ALMs on multi-turn degradation diagnosis across speech, music, sound; models "recognize coarse content while failing to diagnose, compare, or reason about degradations reliably"; large gap to human listeners — [arXiv 2608.22236](https://arxiv.org/pdf/2608.22236); [summary](https://qubitsok.com/papers/2608.22236)
- MMAU-Pro (arXiv 2508.13992, Aug 2025): Gemini 2.5 Flash 59.2%, Audio Flamingo 3 51.7%, Qwen2.5-Omni-7B 52.2%, humans ~78%; dataset CC BY-NC 4.0 — [arXiv 2508.13992](https://arxiv.org/abs/2508.13992); [dataset card](https://hf-mirror.492719920.workers.dev/datasets/gamma-lab-umd/MMAU-Pro/blob/main/README.md?code=true)

**Models, licences, local deployability**
- Qwen3-Omni-30B-A3B (base, Thinking, Captioner) released under Apache 2.0; the Captioner is fine-tuned for "detailed, low-hallucination captions for arbitrary audio" — [arXiv 2509.17765](https://arxiv.org/html/2509.17765v1)
- Music Flamingo (NVIDIA, Nov 2025): music-specialised, up to 15-minute tracks; reported 74.6% MuChoMusic / 76.8% MMAU-Music (third-party summary, unverified); "non-commercial research purposes only"; card notes a newer checkpoint exists — [HF model card](https://huggingface.co/nvidia/music-flamingo-hf); [NVIDIA page](https://research.nvidia.com/labs/adlr/MF); [review](https://www.themoonlight.io/review/music-flamingo-scaling-music-understanding-in-audio-language-models)
- Audio Flamingo 3: Qwen2.5-7B backbone, up to 10 minutes of audio in 30 s windows, NVIDIA OneWay Noncommercial License, "non-commercial research purposes only" — [HF model card](https://huggingface.co/nvidia/audio-flamingo-3)

### Inferences
- An ALM is currently best used as a *describer* (genre, instrumentation, section structure, "is there a vocal", vibe words) that feeds the text LLM context, not as a *judge* of balance, loudness, compression or reverb amount. Measurements do those better.
- If a listening model is wanted for mix critique, a small purpose-trained critic (MixJudge-style, CLAP + fusion, trained on synthetic degradations of stems) beats general ALMs by a wide margin and is cheap to run locally; general ALMs would need fine-tuning (AcousticBench's Kimi-Audio result suggests it works).
- For a desktop app shipped to users, Apache-2.0 Qwen Omni models are the only fully permissive local ALMs found here; Flamingo models are research-only. Gemini (cloud) is the strongest at acoustic perception.

### Gaps
- Not checked in this pass: SALMONN, LTU licence, MU-LLaMA, Kimi-Audio and Step-Audio licences, Mellow, GPT-4o audio on mixing tasks, MuChoMusic/AIR-Bench leaderboards for the newest models.
- No benchmark found that asks ALMs "vocals too quiet / low-mids muddy" on full commercial mixes other than MixJudge's vocal-plus-backing setup.

## 3. Measurement as ears: which numbers describe a mix to a text model

### Takeaway
Feeding an LLM compact DSP features measurably helps it set EQ (LLM2Fx), and mix-comparison research consistently uses level (LUFS/RMS) plus octave-band energy as the distance to a professional reference (MixJudge, Martínez-Ramírez et al.). But global features of a stereo mixdown barely predict listener preference (Mix Evaluation Dataset analysis), so features should be presented as *deltas against a target or reference* and per stem, letting the LLM reason about intent, not as a quality score.

### Cited Findings
- LLM2Fx's in-context feature set (RMS, crest factor, dynamic spread, spectral centroid, flatness, bandwidth, RT60, as JSON) improved EQ prediction but hurt reverb when used alone; combined with DSP code and few-shot examples it gave the best results on both — [arXiv 2505.20770v2](https://arxiv.org/html/2505.20770v2)
- MixJudge measures closeness to a professional vocal mix with "RMS level difference plus octave-band log-energy difference" — a minimal, defensible acoustic distance — [arXiv 2610.30783](https://arxiv.org/html/2610.30783)
- MixJudge's critic is relational: it uses backing, vocal and blend embeddings plus differences (vocal − backing, blend − backing), i.e. per-stem-vs-rest comparisons, not the blend alone; masking ("backing obscures the vocal") is one of its 11 issues — [arXiv 2610.30783](https://arxiv.org/html/2610.30783)
- Martínez-Ramírez et al. (arXiv 2208.11428) evaluate automatic mixes against references with spectral descriptors (centroid, bandwidth, flatness…), dynamics and LUFS loudness; loudness matched references more closely than spectral features, meaning EQ/reverb differences remained — [arXiv 2208.11428](https://arxiv.org/pdf/2208.11428)
- StemFX computes per-stem representations covering level balancing and spatialisation on source-separated stems — [arXiv 2607.15634](https://arxiv.org/abs/2607.15634)
- Mix Evaluation Dataset: 180 mixes, ~5,000 preference ratings and free-text descriptions — [DAFx 2017](https://dafx.de/paper-archive/details/UnYR1t0GX1zguWmAtrpMFg). Colonel & Reiss (AES 2019) on 184 mixes / 19 songs found "virtually no correlation" between embedded features of stereo mixdowns and average preference, and principal axes did not match simple "width" or "loudness" — [AES e-Brief 20549](https://joshreiss.github.io/documents/2019/20549.pdf); an earlier De Man et al. (AES 138, 2015) with expert raters reported several features correlating with quality — [De Man & Reiss AES138](https://joshreiss.github.io/documents/2015/DeMan%20Reiss%20-%20AES138.pdf)
- Delivery targets the LLM can check against: Spotify normalises to −14 LUFS integrated (ITU-R BS.1770), recommends true peak ≤ −1 dBTP (≤ −2 dBTP if louder than −14 LUFS); Premium Loud −11, Quiet −19 LUFS — [Spotify for Artists](https://support.spotify.com/us/artists/article/loudness-normalization/)
- Spectrogram images: GPT-4o reached ~59% few-shot on ESC-10 environmental sounds from spectrogram images (Gemini 1.5 49.6%); zero-shot GPT-4V hedged on a mel spectrogram — evidence for coarse classification only, nothing for mix judgments — [arXiv 2411.12058](https://arxiv.org/pdf/2411.12058); [arXiv 2310.16534](https://arxiv.org/pdf/2310.16534)

### Inferences
- A useful "mix report" tool for the assistant, consistent with the above (the specific list is a recommendation, not a tested result): per stem and per bus — integrated and max short-term LUFS, true peak, LRA, crest factor/PLR; octave or third-octave band energy relative to the mix and to a genre/reference curve (a Tonal-Balance-style delta, cf. Neutron/Ozone); spectral tilt; per-band stereo correlation and width, low-end (< ~120 Hz) mono check; a masking matrix (for each stem pair, the bands where both are within a few dB and one is louder than the other); vocal-to-instrumental loudness ratio; sibilance (5-10 kHz) energy on the vocal; per-section values (verse vs chorus) because preference studies analysed sections. Present it as a small table of *deltas* ("vocal 2.1 LU below reference relative to the instrumental; 250-500 Hz +3 dB vs reference") rather than raw spectra.
- Text LLMs are reasonably good at reasoning over such tables (LLM2Fx's EQ results); they are poor at mapping words to reverb amount, so time-domain/reverb measures (DRR, RT60 estimate, wet/dry energy) should be paired with an optimiser.
- Because global features don't predict preference, the features are for diagnosis and for checking that a requested change happened, not for deciding whether the mix is "good".

### Gaps
- No paper found that compares formats for presenting audio features to an LLM (table vs prose vs JSON vs spectrogram image) for mixing decisions.
- Masking-matrix, per-band stereo, DRR and punch metrics were not individually researched here (no sources fetched on e.g. masking-based automatic EQ literature).

## 4. Closed-loop optimisation: render → measure → adjust

### Takeaway
Inference-time optimisation of real (non-differentiable) plugin parameters against a learned similarity or text-audio score is established and works: ST-ITO (production-style embedding, gradient-free), Text2FX/FxSearcher (CLAP, gradient or Bayesian), InstructFX2FX (LLM init then CLAP refinement), MixJudge (score a menu of rendered candidates and pick the best). Known failure: optimising an embedding distance alone drifts to unrealistic settings, fixed by a prior on plausible presets. Amortised models (StemFX) are thousands of times faster than iterative search.

### Cited Findings
- ST-ITO (Steinmetz, Singh, Comunità, Ibnyahya, Yuan, Benetos, Reiss; ISMIR 2024): optimises control parameters of arbitrary effects with "a gradient-free optimizer" against a self-supervised learned production-style metric; handles non-differentiable and unseen effects; code github.com/csteinmetz1/st-ito (code licence not stated) — [arXiv 2410.21233](https://arxiv.org/abs/2410.21233); [review](https://themoonlight.io/review/st-ito-controlling-audio-effects-for-style-transfer-with-inference-time-optimization)
- The embedding is AFx-Rep; a reviewer doubted it handles combinations of effects since it was trained one effect at a time — [ISMIR 2024 poster](https://ismir2024program.ismir.net/poster_249.html); [arXiv 2505.11315](https://arxiv.org/html/2505.11315v1)
- "Improving ITO for vocal effects style transfer with a Gaussian prior" (arXiv 2505.11315, 2025): minimising embedding distance alone gives unrealistic or biased parameters; a prior fitted to the DiffVox vocal-preset dataset improves MedleyDB vocal transfer — [arXiv 2505.11315](https://arxiv.org/html/2505.11315v1)
- FxSearcher: Bayesian optimisation with a CLAP score for non-differentiable chains — [arXiv 2511.14138](https://ar5iv.arxiv.org/html/2511.14138)
- InstructFX2FX: LLM proposes chain + initial parameters; CLAP gradient descent / Bayesian optimisation refines while preserving earlier instructions; beat LLM reprompting 9/10 — [DAFx26](https://www.dafx.de/paper-archive/2026/papers/DAFx26_demo_74.pdf)
- MixJudge menu selection: render 31 candidates (no edit, 18 single-control, 12 two-control), score each by summed issue evidence, pick the lowest; improving choice 77.1% of the time when one exists (83/88 menus had one) — [arXiv 2610.30783](https://arxiv.org/html/2610.30783)
- StemFX amortised prediction is "over 4000 times faster than iterative optimization" — [arXiv 2607.15634](https://arxiv.org/abs/2607.15634)

### Inferences
- For a DAW assistant the cheapest robust loop is MixJudge's: the LLM proposes a few candidate settings (or a parameter range), the app renders short excerpts offline, a measurement/critic scores them, the LLM sees the scores and picks or refines. This keeps the LLM in charge and avoids long black-box searches.
- For "match this reference" requests, run a gradient-free optimiser (CMA-ES, Bayesian, Nevergrad-style) over the plugin parameters the LLM chose, with an objective of LUFS + band-energy delta (plus optionally an Fx-embedding distance), and a prior/bounds from presets or the LLM's own starting point so it doesn't drift.

### Gaps
- Could not confirm which optimiser ST-ITO uses (CMA-ES is commonly attributed but the abstract only says "gradient-free"). No source fetched on Nevergrad/CMA-ES applied to commercial VST parameters with a perceptual loss.

## 5. Objective mix-quality metrics and how well they track listeners

### Takeaway
There is no validated single number for "mix quality". Distribution metrics (FAD, and its better-behaved successor KAD) with effect-aware embeddings (AFx-Rep, FxEncoder/FxEncoder++) or CLAP are what 2025-2026 mixing papers report, but none of them reports correlation with listeners for mixing specifically, and they compare *sets* of mixes, not one mix. General "aesthetics" predictors (Audiobox Aesthetics PQ, SongEval) are trained on general listener MOS or generated songs and an independent test found PQ insensitive to codec and mastering fidelity. The most mixing-specific, validated signal found is a reference-relative acoustic distance (loudness + octave-band energy) and issue-specific learned critics (MixJudge).

### Cited Findings
- KAD ("No More FAD!", arXiv 2502.15602, Feb 2025): MMD-based, distribution-free, unbiased, fast with small samples, "stronger alignment with human perceptual judgments" than FAD; kadtk toolkit — [arXiv 2502.15602](https://pdf.arxiv.org/abs/2502.15602)
- MEGAMI reports KAD with AFxRep, FxEncoder, FxEncoder++ and CLAP embeddings, warns FxEncoder++ and CLAP are biased for its own system (it uses them), and reports no objective-subjective correlation — [arXiv 2511.08040](https://arxiv.org/html/2511.08040)
- FAD for music generation (Gui et al., Microsoft): unbiased FAD with suitable embeddings and reference sets improves correlation with human ratings of musical and acoustic quality; sensitive to sample size and reference choice; per-song FAD can flag outliers — [arXiv 2311.01616](https://arxiv.org/pdf/2311.01616); [Microsoft Research](https://www.microsoft.com/en-us/research/publication/adapting-frechet-audio-distance-for-generative-music-evaluation/)
- Correlations vary by task: MERT-embedding metrics ρ > 0.65 for bass stems in source separation — [arXiv 2604.20270](https://arxiv.org/html/2604.20270); FAD-MERT best at only ρ = 0.44 in an adversarial-audio listening test — [arXiv 2509.04985](https://arxiv.org/html/2509.04985)
- LLM2Fx-Tools reports AFx-Rep and FxEnc similarities alongside a MUSHRA test; ordering of systems is broadly consistent (LLM2Fx-Tools best on AFx-Rep 0.68 and MUSHRA 62.8) but no correlation statistic is given — [arXiv 2512.01559](https://arxiv.org/html/2512.01559v1)
- Audiobox Aesthetics (Meta, arXiv 2502.05139, Feb 2025): four axes — Production Quality, Production Complexity, Content Enjoyment, Content Usefulness; PQ covers clarity/fidelity, dynamics, frequency balance, spatialisation; validated against general MOS — [arXiv 2502.05139](https://arxiv.org/html/2502.05139v1). Code mostly CC-BY 4.0 (some MIT), `pip install audiobox_aesthetics`, outputs CE/CU/PC/PQ per file (example values in the 1-10 range); weights licence not separately stated — [GitHub](https://github.com/facebookresearch/audiobox-aesthetics)
- Independent test (Cyanite, Feb 2026, updated Oct 2026; Cyanite sells competing products): PQ "insensitive to codec degradation and mastering fidelity"; most scores across very different artists fell ~7-8; female-vocal tracks scored significantly higher on CE/CU/PQ; the model "appears to reward constant spectral activity and conventional pop characteristics" — [Cyanite](https://cyanite.ai/blog/meta-audiobox-aesthetics-review/)
- SongEval (ASLP-lab, arXiv 2505.10793, 2025): ~2,399 full-length *generated* songs (~140 h), 16 trained annotators, five axes (coherence, memorability, vocal breathing/phrasing naturalness, structure clarity, musicality); targets song aesthetics, not mix engineering — [arXiv 2505.10793](https://arxiv.org/pdf/2505.10793); [challenge dataset page](https://aslp-lab.github.io/Automatic-Song-Aesthetics-Evaluation-Challenge/dataset)
- Mix Evaluation Dataset analyses: global stereo-mix features show "virtually no correlation" with preference (2019) — [AES e-Brief](https://joshreiss.github.io/documents/2019/20549.pdf)
- MixJudge (Oct 2026): issue-specific critic; adapted variant severity ordering ρ 0.971 on synthetic data and 0.730 whole-menu correlation with distance to professional vocal mixes on 88 real MedleyDB pairs; code "will be made publicly available" — [arXiv 2610.30783](https://arxiv.org/html/2610.30783)

### Inferences
- For a single-mix feedback loop, use (1) hard technical checks (true peak, integrated LUFS vs target, LRA, low-end mono, clipping), (2) reference-relative deltas (LUFS and band energy per stem vs a reference track or genre curve), (3) optionally an issue critic (MixJudge once released, or a similar CLAP-based classifier), and only (4) Audiobox PQ as a weak sanity signal (it can flag a broken render, not a balance problem). FAD/KAD belong in evaluating the *assistant* across many songs, not inside the per-song loop.
- PEAQ/ViSQOL/PEMO-Q are reference-based codec-fidelity metrics; in a mixing loop there is no "correct" reference mix, so they are of little use except for checking that a mastering limiter did not audibly damage a premaster (inference; not researched here).

### Gaps
- No study found reporting correlation between any objective metric and listener ratings *for mixing* specifically (as opposed to generation or separation). MusicEval and PEAQ/ViSQOL/PEMO-Q were not researched in this pass.

## 6. Practical recommendation: division of labour between LLM and DSP/ML

### Takeaway
The literature converges on "LLM as brain, measurement/optimisation as ear": the LLM handles intent, arrangement-aware priorities, choice of processors and explanation; DSP measures every render and reports deltas; a critic or optimiser closes the loop on parameters the LLM is bad at guessing (reverb, exact EQ gains, compression amount). General ALMs are not yet trustworthy judges of balance or dynamics.

### Cited Findings
- InstructFX2FX: LLM "selects effects and proposes the initial parameter state"; CLAP optimisation "provides a more stable and robust refinement mechanism than LLM reprompting" — [DAFx26](https://www.dafx.de/paper-archive/2026/papers/DAFx26_demo_74.pdf)
- LLM2Fx: LLMs beat CLAP optimisation on EQ from text (GPT-4o 0.22 vs 0.55 MMD) but not on reverb; DSP features + code + few-shot examples in the prompt help most — [arXiv 2505.20770v2](https://arxiv.org/html/2505.20770v2)
- LLM2Fx-Tools: CoT before tool calls raises chain accuracy 67% → 80% — [arXiv 2512.01559](https://arxiv.org/html/2512.01559v1)
- MixJudge: rendering a menu of candidates and letting a critic choose recovers ~2/3 of the gap to a professional vocal mix (median recovery 0.665-0.684 vs best ALM baseline 0.290-0.305) — [arXiv 2610.30783](https://arxiv.org/html/2610.30783)
- ALMs near chance on relative loudness/dynamics comparisons (SonicBench, VocalGrad, AcousticBench) — [arXiv 2601.11039](https://arxiv.org/html/2601.11039v1); [VocalGrad](https://neurips.cc/virtual/2026/poster/139190); [AcousticBench](https://neurips.cc/virtual/2026/poster/139542)
- Producers want the "why" and feedback inside the DAW; ALM audio analysis was the weakest part — [arXiv 2507.06329](https://arxiv.org/html/2507.06329)
- Unconstrained embedding optimisation drifts to unrealistic settings; priors from presets fix it — [arXiv 2505.11315](https://arxiv.org/html/2505.11315v1)

### Inferences (concrete design for the user's MCP assistant)
- **Tell it**: the processors available with their parameter units/ranges and what they do (LLM2Fx found DSP code in context helps); genre and delivery target (e.g. −14 LUFS, −1 dBTP); a few worked examples of measurement → action; the rule that it must measure after every change and never claim a result it has not measured.
- **Measure for it** (an `analyze_mix` tool): per-stem/bus LUFS (integrated, short-term max), true peak, LRA, crest/PLR, third-octave energy vs mix and vs reference/genre curve, spectral tilt, per-band correlation/width and low-end mono, masking pairs, vocal-to-instrumental ratio, sibilance energy, per section; return a short delta table. Add an `compare_to_reference` tool for a user-supplied track.
- **Delegate to it**: (a) a `try_candidates` tool that renders N short excerpts with the LLM's candidate settings and returns measured deltas (and a critic score once available), so the LLM picks; (b) an `optimise_params` tool that runs a bounded gradient-free search over chosen parameters toward a measurable target (loudness/band deltas or a reference); (c) optionally an ALM (Qwen3-Omni Captioner, Apache 2.0, local; or Gemini cloud) only to describe the song (genre, instruments, sections) — not to judge balance.
- **Keep for the LLM**: what matters in this arrangement (which element leads, which sections need lift), processor choice and order, translating user words ("warmer", "more punch") into measurable targets, explaining changes in the user's vocabulary.
- An assistant built this way is a measured-feedback loop rather than "hearing"; the literature suggests that is currently more reliable than any general listening model.

### Gaps
- No end-to-end study found of a general LLM (Claude/GPT/Gemini) driving a real DAW with a measurement tool loop and being judged by listeners; the design above is an inference from component results.

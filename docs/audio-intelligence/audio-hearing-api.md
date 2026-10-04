# Plan 2: Audio hearing API for the existing assistant

Status: proposal; no implementation. See [the overview](README.md) and [dataset ingestion](dataset-ingestion.md).

## Product outcome and service boundary

Give the existing LLM a tool that analyzes actual audio and returns evidence useful for mixing. The assistant can inspect a song, compare references, retrieve an engineer profile, and use its existing editing tools. The hearing service itself is read-only with respect to song edits. The user selected hosted-first audio perception, with a path to self-hosting later; local DSP remains part of the initial design.

Do not replace the current assistant provider or send a full audio attachment through every chat turn. A separate service owns audio preparation, measurements, audio-model calls, optional separation, comparisons, and result validation. Return compact text/JSON through the current tool-result channel, with links to richer local reports.

Describe the capability as analysis of rendered audio, not continuous live listening. A report applies to a particular artifact/song snapshot and selected time range. Playback starting for the user does not mean the assistant heard it.

## Layers of hearing

| Layer | Responsibility | Authority |
| --- | --- | --- |
| Full-resolution DSP | Loudness, peaks, spectral distribution, stereo relationships, timing and dynamics descriptors | Numerical observations under a defined method |
| Native audio model | Audible characterization and contextual interpretation | Fallible listening observations |
| Optional source separator | Estimated vocal/instrument sources | Derived evidence with possible artifacts |
| Reference/profile retrieval | Relevant engineer examples and reviewed tendencies | Scope-limited historical guidance |
| Existing LLM | Explain findings and choose actions supported by evidence | Reasoning, not an independent audio measurement |

An audio model's generated description is not a measurement. Low crest factor is not proof of a compressor setting. A spectral change is not proof that an engineer applied EQ. Keep causal claims narrower than the evidence permits.

## Model candidates and selection

### Hosted candidate: Gemini native audio understanding

Gemini documents audio question answering and timestamped analysis. Its current audio documentation also says multichannel inputs are combined into one channel; it should not be the authority for stereo width or pan. The documented preprocessing wording about resolution is ambiguous, so verify effective bandwidth experimentally rather than translating it into an assumed sample rate. [Google audio documentation](https://ai.google.dev/gemini-api/docs/audio)

Use as a candidate for context and audible character, with full-resolution stereo DSP alongside it. Verify that the selected model actually accepts audio bytes and supports the needed structured-output workflow. Do not select a speech-only or TTS endpoint by name similarity.

### Later self-hosted candidate: Qwen3-Omni

Qwen publishes native audio capabilities and music-analysis examples. This is a practical evaluation candidate, not evidence of professional mixing accuracy. Benchmark text-only analysis output; generated speech is irrelevant to this service. [Qwen repository](https://github.com/QwenLM/Qwen3-Omni)

Inspect the exact input processor's sample rate, channel reduction, crop limits, GPU memory, batching, runtime, and license for the pinned weights. Output speech sample rate must not be confused with input audio fidelity. Do not assume this model will run acceptably on the user's Mac; measure a deployment on suitable hardware before making a local-product commitment.

### Supporting models

Demucs is a candidate separator for vocals/drums/bass/accompaniment. CLAP embeddings are a candidate for broad audio-reference retrieval. Neither substitutes for an engineer-quality mix evaluator, and CLAP similarity is not a validated mixing-style score. [Demucs](https://github.com/facebookresearch/demucs), [CLAP](https://github.com/LAION-AI/CLAP)

Music effects/style encoders are a later research track. Existing mixing-style-transfer research supports investigating them, but production use requires checking licenses, effect coverage, domain shift, and correlation with engineer judgments. [Mixing style transfer research](https://arxiv.org/abs/2211.02247)

### Decision rule

For version one, benchmark hosted audio perception against DSP-only and combined baselines. Select a hosted provider that meets the task-specific capability, cost, and latency gates. Local DSP plus hosted perception is the agreed deployment direction; evaluating or deploying self-hosted weights does not block release. When a self-hosted adapter is introduced later, evaluate it on the same corpus and require the same evidence contract. Unsupported perception tasks remain DSP-only or explicitly unavailable.

Capabilities attach to the provider/model/processor version, not a marketing label. Suggested capability fields: audio question answering, multi-clip input, temporal localization, relative-level sensitivity, tonal-change sensitivity, spatial sensitivity, effective sample rate/channel handling, maximum duration, structured output, and supported language.

## Exact audio capture in this app

For an uploaded mix, use its immutable artifact ID. For the current song:

1. Capture the chat-bound project ID and document revision, selected range, tempo map, routing, automation, and engine/plugin configuration.
2. Flush and copy required plugin-state files into an immutable snapshot. Document hashes alone do not identify plugin sound: states currently live outside the song document.
3. Request a master render and, only as needed, genuine track/bus outputs using a defined tap point. Record sample rate, origin, tail, latency compensation, and missing plugins.
4. Hash the actual rendered audio and attach its snapshot identity to every result.
5. If the user edits during analysis, show that the report belongs to an earlier revision and offer a new analysis. Never silently apply recommendations as if the report described the current sound.

The current `AudioEngine.renderExport` stops playback during rendering. For the first version, make that interruption visible and serialize engine render jobs. Background imported-file analysis need not stop playback. A second isolated engine process is a later investigation because plugin instances, licensing, memory, and deterministic state complicate it.

An isolated vocal heard after soloing can differ from its contribution in the real mix: sidechains, bus compression, shared reverbs, and automation may behave differently. Prefer stems captured while the full song graph runs. Verify existing export tap semantics before claiming solo-context or in-context analysis.

Raw audio input analysis can ship before project-snapshot rendering. Exact source/stem capture is a separate integration gate, not an assumption about the existing engine.

## Preprocessing and measurements

Keep originals and DSP inputs at their original/full useful resolution, preserving stereo. Derive model-specific copies separately and record resampling, channel mixing, gain changes, and time mappings. Model input restrictions must not contaminate full-resolution measurements.

Select roughly 10–30-second sections around the user's question, with enough leading context for compression/reverb and effect tails. Use overlapping windows for longer passages; combine them with source timestamps. Intro/verse/chorus detection is a suggestion until confirmed. Do not infer stable style from a single convenient clip.

Proposed first measurements:

- Integrated and short-term LUFS, loudness range where duration permits, sample/true peak, clipping counts, RMS and crest-factor distributions.
- Log-frequency/band energy distributions, spectral slopes and time variation, with methodology and units.
- Stereo channel correlation, mid/side energy by band, interchannel level balance, and mono fold-down changes.
- Active-vocal/beat balance when genuine sources exist; explicitly provisional when estimated sources are used.
- Relative before/after differences for verified pairs and same-source A/B comparisons.

Use ffmpeg for decoding and suitable existing filters; evaluate Essentia or a small dedicated DSP worker where needed. Its algorithms include loudness/spectral/panning analysis, but its distribution license and individual algorithm suitability must be reviewed before adding it. [Essentia algorithms](https://essentia.upf.edu/algorithms_overview.html)

Reverb time, exact compression behavior, masking, de-essing, and distortion attribution are advanced tasks. A reverb impulse-response estimator already in this repo is not automatically valid on arbitrary music. Label proxies honestly and validate them against controlled examples before release.

## A/B and reference comparison

Distinguish comparisons of the same source from unrelated reference songs. Same-source A/B can isolate a change; different singers, microphones, beats, and arrangements confound causal conclusions.

Create level-matched listening derivatives using fixed gains and record those gains. Preserve original-level metrics so vocal-level changes are not normalized away. Never independently normalize every stem when the question concerns balance. For nonlinear processing comparisons, provide original and matched versions as needed.

Randomize blind A/B order in evaluation; check order swaps and repeated trials. Use comparable sections and spectral/level measurements alongside native listening. Return similarities, differences, limitations, and confidence rather than a universal style-match percentage.

## API contract

The orchestration service lives in the local Express app. GPU inference can run in a separate Python/runtime service accessed only through a provider adapter; the TypeScript app owns artifacts and provenance. Keep local workers and hosted calls interchangeable.

| Endpoint proposal | Input | Output |
| --- | --- | --- |
| `GET /api/music/hearing/capabilities` | Provider configuration | Verified capabilities, limitations, versions |
| `POST /api/music/hearing/analyses` | Artifact or project snapshot, range, question/task, optional reference/profile, budget | Job ID and normalized scope |
| `GET /api/music/hearing/jobs/:id` | Job ID | Progress, stage, results/error, cost usage |
| `POST /api/music/hearing/jobs/:id/cancel` | Job ID | Cancellation state |
| `GET /api/music/hearing/reports/:id` | Report ID | Full immutable evidence report |

Client requests use artifact/project IDs rather than arbitrary remote URLs or filesystem paths. Validate ranges, size, channel layout, provider selection, and budget before work. A future remotely deployed API would need authenticated tenant-scoped storage and quotas; this proposal initially fits the existing local app.

Analysis request fields: schema version, task (`describe`, `inspect`, `compare`, `profile-evidence`), artifact/snapshot references, source ranges, question, reference ranges, requested measurements, separation mode, provider policy, and time/cost limits.

Report fields:

| Group | Required contents |
| --- | --- |
| Identity | Report/job ID, request version, artifact hashes, snapshot revision |
| Scope | Actual analyzed ranges, channel handling, preprocessing, processing stage |
| Measurements | Name, value/unit, range, method/version, applicability |
| Listening observations | Claim, relevant timestamps, source/model, supporting evidence, limitations |
| Findings | Severity, evidence IDs, measured versus inferred status, confidence category |
| Comparison | Reference IDs, matching gains, meaningful differences, confounds |
| Availability | Completed/partial, unsupported tasks, skipped inputs, quality warnings |
| Operations | Runtime, audio seconds, provider usage, estimated/actual cost when known |

Use `null` with a reason for unavailable values; never zero-fill. Validate output shape and time bounds; reject hallucinated artifact IDs or out-of-range evidence. Store raw provider output separately for diagnosis. Model self-reported confidence is not calibrated confidence; initial categories indicate evidence strength and validation status.

Suggestions are optional and separate from findings. They should explain the issue and a bounded candidate action, not pretend the model recovered the friend's exact settings.

## Assistant integration

Proposed music tools:

| Tool | Purpose |
| --- | --- |
| `analyze_audio` | Start analysis of an uploaded/dataset artifact |
| `analyze_song` | Capture/render the chat's song range and start analysis |
| `compare_audio` | Compare explicit artifacts/ranges under a defined matching policy |
| `get_audio_analysis` | Read job state or compact completed findings |
| `get_engineer_profile` | Retrieve a pinned/reviewed style profile and relevant examples |

Tools that render or call providers are `action` tools; getting existing reports is `look`. Return a job ID quickly and use progress events for useful updates. Persistent background work must outlive tab/tool timeouts; don't make a 120-second bridge call responsible for an entire dataset analysis.

Keep audio bytes inside the hearing service. The current `ToolContent` supports text/images, so the existing LLM can receive the evidence as validated JSON/text without changing its modality support. Expose a full report in the UI, with compact findings in chat. Visual spectra can supplement audio evidence, but are not a replacement for native audio perception.

Update `server/suites/music.ts` only after analysis works. New instructions should require a successful report before auditory claims, identify the heard revision/range, distinguish DSP from model observations, respect capability limits, and use reference style as conditional guidance.

Later mixing loop: analyze → retrieve relevant profile examples → choose a small reversible edit → render the changed snapshot → compare → retain/revert. Bound iterations and cost. Stop when evidence is inconclusive or changes plateau; don't chase noisy model scores indefinitely. Current built-in EQ/compression/reverb/mixer tools offer actionable controls, while arbitrary third-party plugin state still has its own access limitations.

## Jobs, caching, and failure behavior

Persist jobs with queued/running/partial/completed/failed/canceled states and substage checkpoints. Separate resource limits for engine rendering, CPU decoding/DSP, GPU separation/inference, and hosted requests. Honor cancellation, timeouts, and provider rate limits without deleting completed local evidence.

Cache measurements by PCM hash/range/method/version. Cache model observations by prepared audio hash, provider/model/processor, prompt/schema, task, and references. Cache profile aggregation by its complete evidence/review versions. Refreshing a profile does not invalidate unrelated measurements.

Missing plugins, decode failures, low-quality separation, unavailable providers, or malformed model output produce explicit partial results where possible. Never replace missing listening output with a fabricated description based only on filenames or transcript text. Lyrics are contextual data, not instructions to the assistant or service.

Keep credentials in server settings/appropriate platform credential storage, never browser responses. Hosted uploads use opaque identifiers and minimum relevant audio; implement provider upload cleanup/expiry handling. Save the selected data-use policy and permission scope with the job. Local-only settings must never silently fall back to cloud processing.

## Quality evaluation before provider commitment

Create a consented benchmark separate from profile-building material. Ask the engineer to help label it. Include controlled alterations and authentic mixing decisions, with the engineer blinded to model identity and A/B order.

| Task | Controlled examples | Expected evaluation |
| --- | --- | --- |
| Vocal balance | Same song with ±1, ±3, ±6 dB vocal changes | Direction accuracy, threshold sensitivity |
| Tone | Known low-mid buildup, presence/air changes, low/high cuts | Direction/band identification, false positives |
| Dynamics | Different compression amounts, transient flattening, clipping | Observable differences; reject invented settings |
| Ambience | Dry/wet changes, darker/brighter returns, different delay patterns | Direction/type/temporal observations |
| Stereo | Pan, width, mono collapse, phase problems | DSP accuracy; provider capability limits respected |
| Unchanged pairs | Identical renders and gain-matched duplicates | Low false-positive and invented-difference rates |
| Difficult material | Dense arrangements, unusual vocals, lossy files, separated stems | Useful abstention and limitation reporting |
| End-to-end mixing | New songs excluded from profile building | Engineer preference versus baseline assistant |

Evaluate three baselines: DSP-only, audio model-only, and combined evidence. This establishes whether the model adds useful listening ability beyond measurements. Compare profile-guided mixing with the existing assistant without that profile and a simple reference/DSP baseline.

Suggested initial acceptance targets, to agree before seeing results:

- Numerical metrics agree with trusted meters within documented tolerances; stereo fixtures and known timing mappings are correct.
- At least 90% correct direction on clear ±3/±6 dB balance changes, with enough independent songs to report uncertainty.
- At most 5% substantive invented differences on unchanged pairs; use enough negatives that this rate is meaningful.
- Unsupported spatial/parameter claims are consistently rejected or attributed to valid DSP/session evidence.
- Engineer labels most reported high-priority issues useful and correctly grounded; report inter-rater disagreement if more engineers participate.
- Measure p50/p95 latency, memory/GPU footprint, and total cost for the actual workloads before declaring operational suitability.

±1 dB differences are exploratory initially. These targets are proposed release gates, not claims that any candidate already achieves them. If a task fails, narrow the advertised capability rather than lowering the gate after seeing the results.

## Workload and cost planning

Support explicit per-job limits for source seconds, clip count, separation, model calls, retries, and output length. Dataset batch analysis and interactive song analysis use different budgets.

Example pilot workload: 20 songs × 3 sections × 20 seconds = 1,200 seconds of model audio for one mix-only pass. An extra vocal pass roughly doubles submitted duration; comparisons and retries add more. Google currently documents 32 audio tokens/second, implying roughly 38,400 audio input tokens for that one pass, before text/output/retries. Price must use the selected model's current audio-input rate. [Audio token accounting](https://ai.google.dev/gemini-api/docs/audio), [current pricing](https://ai.google.dev/gemini-api/docs/pricing)

Full-song DSP and optional separation have separate CPU/GPU costs. Audio tokens are not the whole bill. For self-hosting, measure GPU time, idle capacity, model loading, throughput, memory, and hosting/storage overhead; avoid calling it free merely because weights are downloadable.

User-visible estimates should be a range with assumptions. Do not invent dollar prices or latency promises before choosing a deployment and measuring it.

## Work packages and acceptance

1. **Evaluation protocol and hosted provider spike:** pin hosted candidate versions, verify preprocessing, run controlled benchmark, record cost/latency and capability matrix. Gate: useful validated tasks established. A self-hosted spike is deferred until after the hosted release or an explicit change of scope.
2. **Artifact/DSP service:** immutable IDs, ranges, stereo-preserving measurements, structured evidence, durable jobs/cache. Gate: trusted-meter and timing fixtures pass.
3. **Perception adapters:** actual audio submission, bounded prompts, response validation, partial failures, permissions and provider policy. Gate: no unsupported claims escape validation rules.
4. **Standalone API/UI:** upload analysis, comparisons, progress/cancellation, full report and playback links. Gate: usable without datasets or assistant edits.
5. **Project snapshot renderer and assistant tools:** plugin-state capture, correct chat binding, stale report handling, engine serialization. Gate: reports match the render actually analyzed and leave project edits untouched.
6. **Dataset evidence integration:** batch analyses and reviewed profiles using the other plan's records. Gate: every profile finding traces to source audio and reviews.
7. **Reversible mixing loop:** bounded candidate edits, A/B evaluation, rollback, held-out engineer feedback. Gate: demonstrated improvement over baseline.

Verification covers offline/error modes, corrupt input, channel loss, stale document/plugin states, simultaneous chats, render interruption, crash/restart, cancellation, schema failures, false timestamps, cache versioning, provider drift, order bias, and local-only behavior. Required repository checks apply when implementation begins; no runtime tests are warranted for these planning documents alone.

## Decisions still requiring evidence

- Hosted provider/model, acceptable paid-analysis budget, and data-use policy. Hosting direction is settled: hosted first; GPU hardware matters only for later self-hosting.
- Which audio capabilities survive each provider's actual preprocessing.
- Model sensitivity to subtle mixing differences and rate of confident false claims.
- Existing engine stem tap behavior and snapshot fidelity under third-party plugins.
- Useful interactive latency and acceptable dataset batch budget.
- Whether richer DAW/session evidence materially improves held-out results.

The architecture deliberately permits a hearing API with strong measurements and limited perception. Professional-quality hearing remains something to demonstrate through the benchmark, not something to promise from a model's music-captioning demo.

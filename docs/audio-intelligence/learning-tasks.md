# What the mixing assistant needs to learn

The user's two categories are useful: how processing changes audio, and how people choose processing. For planning, separate four capabilities without assuming four separately trained models.

| Capability | Question | Useful evidence |
| --- | --- | --- |
| Perception | What is happening in this recording and mix? | Audio, measurements, validated descriptions of harshness, dynamics, masking, intelligibility, and timing |
| Effect behavior | What happens if a control changes? | Aligned input/output recordings, known plugin/device identity, complete control state, input level, timing, and parameter units |
| Mixing decisions | Which action fits this source, arrangement, style, and requested goal? | Human sessions/settings with source audio and musical context; processing order, routing, automation, and engineer intent when available |
| Evaluation | Did the change improve the requested result? | Level-matched before/after comparisons, context with the beat, preference judgments, artifact checks, and measurements |

Example: the assistant hears an uneven vocal with sharp peaks (perception), predicts how attack/release will affect consonants and sustain (behavior), proposes a setting that keeps the vocal clear over this beat (decision), and compares the render against the original at matched loudness (evaluation).

The decision is not a fixed recipe. Threshold depends on input level; processing order and sidechain/routing matter; a setting that works solo may fail in the full mix. Several settings can produce similar audio, so identifying exact controls from a finished waveform is a separate, potentially ambiguous inverse problem.

## Dataset placement

- MixParams provides observed human decisions, with limited coverage and imperfect annotation. It becomes stronger when paired to verified source/mix audio and quality judgments. A settings row by itself does not explain why the engineer chose it.
- CL 1B provides controlled compressor behavior rather than artistic preference. The inspected 2022 archive metadata lists ratio and threshold only, not attack/release. It does not provide EQ examples or cover every compressor.
- Mix Evaluation ratings can support the evaluation task where recording and mix identities can be joined reliably. Ratings are context-dependent rather than universal truth.
- MixAssist can support descriptions/conversation; its annotations do not establish exact parameter estimation or reliable perception without a held-out evaluation.

For EQ, a future controlled dataset can pair cleared source audio with renders at known frequency, gain, Q, and filter type. This would teach effect behavior. Human contextual EQ choices and listener preferences remain separate evidence. Generating this data is a future option, not implemented here.

## Proposed first version

Use the hosted hearing API plus measurements for perception, a small verified settings library for reference, existing DSP/plugins for candidate renders, and a level-matched comparison loop for evaluation. The LLM coordinates tools and goals. Dataset ingestion supplies provenance and context; the hearing API supplies observations. Training a new model is not a prerequisite for this plan.

Split evaluations by source song/recording family, not random neighboring clips or mix variants. Keep effect-accuracy tests separate from musical-preference tests; success on one does not establish success on the other.

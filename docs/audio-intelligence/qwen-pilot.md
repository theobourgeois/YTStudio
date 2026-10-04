# Qwen live pilot — 2026-10-04

The Singapore DashScope key was accepted; its model list includes `qwen3.8-omni-flash`. All four generated-audio requests completed with one attempt each, using the same preparation and validation pipeline as Gemini. The application default remains Gemini; Qwen is selectable in the pilot only.

| Case | Fixture audit |
| --- | --- |
| Uneven voice dynamics | Failed: described consistent volume despite verified uploaded phrase peaks of −6, −18, −9 and −22 dBFS. |
| Steady voice tone | Unreviewed subjective descriptions; guessed square/pulse synthesis despite a request not to guess the source. |
| Drum-only context | Correctly described an electronic drum loop, kick, snare/clap and hi-hats without added melody. |
| Silence | Correctly returned an empty findings list. |

The dynamics failure is not caused by level normalization in our preparation. The uploaded mono 48 kHz PCM16 WAV retains phrase peaks at −6.0005, −18.0005, −9.0004 and −21.9995 dBFS. Provider-internal preprocessing is unknown.

Qwen is a promising context-description candidate. This pilot does not establish dependable tonal/dynamic mixing judgement or superiority over Gemini on real music. The earlier Gemini 3.7 voice-only response invented drums/bass; Qwen's dynamics response avoided those added sources but missed the known level changes. This is a comparison of different model versions on one shared generated case, not a controlled multi-case ranking.

Total reported usage: 893 input tokens and 1,642 output tokens (including provider-reported reasoning usage where applicable). Dollar cost remains unknown. Raw outputs, receipts, local measurements and fixture audits are in the ignored `data/hearing-pilot-qwen/pilot.json` and its referenced artifact files. No provider task has been certified; assistant observations remain withheld.

Rerun with `pnpm tsx scripts/hearing-pilot.ts --provider=qwen`. Configure `DASHSCOPE_API_KEY` and optionally `DASHSCOPE_BASE_URL` in `.env`; the adapter allows the official Singapore and Beijing compatible endpoints, with a key from the same region. `EDITOR_QWEN_HEARING_MODEL` can pin a supported 3.8 Omni Flash snapshot. Requests use inline WAV, text-only streaming, medium reasoning, a 4,096-token output limit, 45 seconds per attempt and at most two attempts. SSE responses are capped at 1 MB, output text at 32,000 characters. Actual usage is retained before validating findings; cancelled/time-out attempts can still incur charges.

Before promoting tasks, compare blinded outputs on cleared real recordings held out by source family, with DSP-only controls and no-change cases. The current generated results favor keeping DSP authoritative for dynamics and treating Qwen context descriptions as experimental.

References: [Qwen-Omni API](https://www.alibabacloud.com/help/en/model-studio/qwen-omni), [regional endpoints](https://www.alibabacloud.com/help/en/model-studio/base-url).

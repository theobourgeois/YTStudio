# Hosted perception pilot (Slice C)

Implemented: a replaceable byte adapter, durable hearing jobs, per-song upload permission, provider-specific audio derivatives, timestamp validation, attempt/usage receipts, cancellation, bounded retries, scoped caching and local-only fallback. **Quality acceptance remains pending.** No Gemini task is certified or exposed as listening evidence by default.

## Configuration and use

The server loads the repository's `.env` without replacing existing environment variables. Set `GEMINI_API_KEY`; optionally set `EDITOR_HEARING_MODEL` (default `gemini-3.8-flash`). Credentials stay server-side; `.env` is ignored by Git. Restart the server after replacing a key. A configured key means a value exists, not that Google has accepted it.

In Settings → Music → Assistant listening, explicitly enable **Allow Gemini audio analysis for this song**. The assistant cannot grant that permission. Each song defaults to disabled. Disabling cancels queued/running hearing jobs; already-sent requests may still be processed or billed. The settings endpoints are `GET`/`PATCH /api/music/audio/:projectId/hearing`; they are absent from the MCP tool catalogue.

1. Capture/render a passage or register a project WAV with the Slice B tools.
2. Call `get_hearing_capabilities`, then `hear_audio_artifact` with `artifactId`, `task` (`context`, `tone`, `dynamics`) and a task-specific `question` (up to 1000 characters).
3. Poll `get_audio_job`; retrieve `get_audio_report` and `get_hearing_receipt` after completion. A succeeded job can have **local-only fallback**: inspect coverage, limitations and the receipt's `unavailableReason`.

Provider observations and full-resolution local measurements occupy separate report fields. Observations name their provider/model/adapter, prepared artifact and bounded timestamps. Hypotheses/settings/edits are not produced. The current default task gate withholds all provider findings; raw responses are local evaluation artifacts, not assistant evidence. `verifiedTasks` is a trusted adapter configuration intended for a reviewed benchmark, never a model self-assessment or assistant-controlled flag. Production promotion needs that benchmark and wiring its reviewed result into configuration.

## Audio and network bounds

Original WAVs and their permissions remain immutable. Explicit song permission creates a separate authorized artifact, then a passage-only mono 48 kHz PCM16 derivative. Trimming, downmixing, resampling and encoding are recorded; no independent gain normalization occurs. Stereo averaging can cancel opposing channels, so this input cannot establish spatial qualities and may hide material. DSP still reads the original stereo/full-resolution audio. The receipt maps provider seconds back to original artifact seconds; the prepared artifact's passage maps to the song clock.

Audio is inline base64 in `POST https://generativelanguage.googleapis.com/v1beta/interactions`, with `store:false`, no provider tools and no remote file uploads to clean up. This is not a guarantee about Google's logging or retention policies. Limits: 120 seconds, 12 MB before base64, 45 seconds per attempt, at most two attempts. Only HTTP 429/5xx, network errors and timeouts retry. Consent and provider identity are checked before each send. Redirects are refused. Responses are capped at 1 MB and answer text at 32,000 characters.

Structure and time bounds are validated. Known unsupported numerical/spatial/plugin-setting claims are suppressed; this filter is not a general truth verifier. Findings also require task certification. There is no automatic model fallback that changes the upload destination.

Cache entries are project-scoped and keyed by prepared artifact identity, provider/model/adapter/task certification, question/task, prompt version and UTC day. Matching jobs are deduplicated. Permission must still be valid to reuse output. A provider-unavailable local fallback permits a new request rather than trapping the user in a cached failure. Consent revisions prevent old queued work from inheriting a later grant.

Receipts persist pending attempts before the network request, then status, timestamps and actual token counts when supplied. Unknown cost is `null`; no pricing estimate or zero charge is invented. A cancelled or interrupted request can still be billed. Running jobs recover as interrupted and require explicit retry; provider-side requests cannot be resumed. Raw bounded responses are saved separately, including structured responses whose findings fail validation. Non-JSON/oversized output is rejected without retaining unbounded data.

## Qwen comparison adapter

A separate Qwen3.8-Omni-Flash adapter is available to the pilot with `--provider=qwen`; it does not change the application's default or certify tasks. Set `DASHSCOPE_API_KEY` and `DASHSCOPE_BASE_URL` (default official Singapore compatible endpoint). The adapter uses inline WAV and bounded text-only SSE output, medium reasoning and a 4,096-token limit. See the [live Qwen pilot results](qwen-pilot.md): all four requests completed, context/silence were correct, and known dynamics were missed. The original DSP measurements and quality gate remain in effect.

## Pilot and quality gate

Run `pnpm tsx scripts/hearing-pilot.ts [output-directory]`. Default output is ignored `data/hearing-pilot/`. It sends at most four generated cases: uneven dynamics, steady tone, rhythmic context and silence. It uses the actual service/preparation pipeline, stops after an unavailable API and leaves a `pilot.json` with full-resolution DSP-only evidence, raw audio-only output paths, combined gated reports, known fixture properties, families and receipts. Repeating after a new consent grant can reuse successful provider output within the daily cache.

These are smoke inputs, not held-out real music. Reviewer fields intentionally remain null. Before promoting any task, use cleared real recordings split by recording family, task-specific human labels, blind DSP-only/audio-only/combined review, no-change controls, repeated trials and order swaps where relevant. Demonstrate useful evidence beyond DSP and audit factual/unsupported claims. Do not certify context, tone or dynamics from a successful API call or a model's confidence.

Live tests on 2026-10-04 initially returned `API_KEY_INVALID`. After the user replaced the key, Google's model-list endpoint accepted it and listed Gemini 3.8 Flash, but 3.8 audio requests returned HTTP 503/high demand. An explicit test-only override to `gemini-3.7-flash` completed one 8-second synthetic-voice dynamics case (304 input / 170 output tokens); the next case returned HTTP 503 and the pilot stopped. Its raw response claimed introduced bass/808 and layered rhythms absent from the voice-only fixture, and a later loudness increase unsupported by the known phrase peaks. The fixture audit records no useful evidence beyond DSP for that case. Findings stayed withheld. This validates connectivity and the gate, not listening quality. Records are local in `data/hearing-pilot/` and `data/hearing-pilot-3.7/`; the default model remains 3.8.

Tests cover inline requests, no remote storage/tools, actual usage, retries, malformed/out-of-range responses, unsupported claims, permission defaults/isolation/revocation, preprocessing without normalization, original preservation, cached reuse, unavailable-provider retry, durable receipts and gated evidence. Browser tests cover the per-song toggle and persistence without using a real provider key.

API references: [Google audio understanding](https://ai.google.dev/gemini-api/docs/audio), [Interactions API](https://ai.google.dev/api/interactions-api), [structured outputs](https://ai.google.dev/gemini-api/docs/structured-output).

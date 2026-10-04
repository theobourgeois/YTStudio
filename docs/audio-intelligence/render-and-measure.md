# Slice B: render and measure through tools

Implemented locally. The assistant can capture its current song, request a passage render, start measurements, poll durable jobs, and read evidence without changing the song. Hosted perception remains Slice C.

## Tools and scope

| Tool | Result |
| --- | --- |
| `capture_audio_snapshot` | Snapshot id, musical revision, render settings and capture coverage; uses the chat's live document through the tab bridge |
| `render_audio_passage` | Durable render job id; requires snapshot id, `startTick`, `endTick` (96 ticks per quarter note) |
| `register_audio_artifact` | Private immutable artifact from a WAV in the current project's media |
| `analyse_audio_artifact` | Durable local measurement job id |
| `get_audio_job` | Status, stages, progress, errors, artifact/snapshot/evidence ids |
| `cancel_audio_job` | Cancellation request; poll until the worker has stopped |
| `retry_audio_job` | Explicit retry after failure/interruption, with at most three attempts |
| `get_audio_report` | Validated report with artifact hashes, inspected spans, method versions and limitations |

All tools bind to the chat's project. Capture uses the tab to include unsaved edits. The other tools dispatch on the server for a project-bound MCP chat, so they continue to work when the editor tab closes. A client without a chat binding uses the existing tab bridge.

Typical sequence: capture → render → poll → analyse the returned artifact → poll → read the evidence id. Each long operation returns immediately with a job id. Repeating an identical request returns its existing job; retry is explicit, and a cancelled request can be started again.

HTTP routes live under `/api/music/audio/:projectId`: `capture`, `tools/:name`, `artifacts/:id`, and `artifacts/:id/audio`. The artifact audio route supports local playback/download; no separate comparison UI is included.

## Storage and recovery

`data/audio-intelligence/<projectId>/` holds snapshot manifests and hashed source copies, immutable artifact WAVs/manifests, evidence reports, and mutable job manifests. Records use Slice A's validators and content identities. Job manifests are written atomically, including the request parameters needed to retry. Immutable records/audio are published from temporary files with exclusive links.

Capture copies the source bytes and verifies their hashes. Render uses the preserved media rather than later project media. The worker rechecks source hashes before rendering and artifact hashes before measuring. Snapshot document hashes and job request identities are validated when read. Files are never addressed by a model-supplied arbitrary path.

On server restart, running jobs become `interrupted`; jobs with a pending cancellation become `cancelled`. Queued jobs resume. Interrupted jobs await an explicit retry, so a server restart does not silently restart playback-disrupting work. Completed results remain readable. Closing a browser tab does not cancel server work.

## Render behavior and limits

- Song mode; built-in processors and samplers/audio clips. Outside instruments/effects are refused because live-instance state restoration is not verified.
- Engine renders are serialized with ordinary exports. Canceling a queued export prevents it from starting; canceling active analysis waits for the engine to release its render.
- `leadInTicks` defaults to 768 (two 4/4 bars), truncated at the song start. The full-resolution artifact retains lead-in and ring-out; measurements inspect only the passage.
- `tailSeconds` defaults to 5, with a maximum of 10; zero cuts the tail. The engine controls the actual ring-out length, which is recorded in frames.
- Up to 120 seconds including lead-in/tail. Registered and measured WAVs are limited to 128 MiB, mono/stereo PCM16, PCM24 or float32. Other media can be used by the engine as snapshot sources, but direct artifact registration currently accepts WAV only.
- Capture records the engine's sample rate. If it changes before rendering, the job fails and asks for a fresh capture. Resampling is sinc.
- Playback stops during render. Cold starts, notes that begin before the lead-in, and processor history remain limitations; lead-in does not prove convergence. The rendered artifact records cold start, latency trimmed by the engine, unknown block size/plugin load states, and any missing source ids.
- Reports describe immutable snapshots/audio, not later song edits. Recapture when the song changes.

## Supported measurements

Per channel: sample peak and unweighted RMS in dBFS, sample peak/RMS crest factor, DC offset, fraction of samples at/above full scale, 50 ms RMS p90–p10 spread, broad 200 Hz one-pole lowpass/complement energies, and first/last activity above −60 dBFS. Stereo: uncentered left/right correlation and side/mid energy ratio.

Each finding names its method and version, channel and exact inspected artifact span. Undefined logarithmic/silence values are null with a reason. Full-scale samples are not asserted to be audible clipping; filter energies are not tonal judgements; activity is not beat detection. Reports contain no listening observations or musical hypotheses.

LUFS, oversampled true peak, standardized loudness range and beat/phrase timing are explicitly unavailable. Local measurement tools do not perform hosted listening; the separate [hosted perception pilot](hosted-perception.md) adds consent-gated uploads and currently withholds unverified findings. Permissions default to local analysis only: no upload, retrieval display or training authorization is implied.

## Verification

Known sine levels/crest/stereo polarity and silence fixtures validate the DSP; passage lead-in/tail exclusion, non-finite samples and cancellation are checked. Service tests cover source preservation, durable results, project isolation, hash corruption, restart recovery, retries and cancellation. A native-engine integration test renders a known tone from preserved media after changing the original source, verifies passage clock/lead-in/tail, checks an automated-tempo passage beginning inside an audio clip, and obtains a local measurement report. Browser/MCP coverage captures through the live tab, closes it during rendering, then retrieves measurements and checks another project's access is refused.

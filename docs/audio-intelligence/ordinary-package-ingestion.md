# Generic folder/ZIP import infrastructure

Scope correction (2026-10-05): F now targets public datasets. This document
records existing generic import infrastructure, not completion of F. Engineer
package/profile commands below are legacy capabilities outside the selected
scope; dataset-specific adapters and acceptance remain pending.

Implemented: user-selected local folders/files and ZIP uploads, immutable source
preservation, durable project-scoped import jobs, discovery hints, reviewed
song/version/role/family metadata and pair relationships, honest extraction
coverage, source-linked profiles and integration with D retrieval/B measurements.
The contributor sends their ordinary package; no capture companion or DAW
installation is required for intake.

## Local intake and review

Start the editor server, then use the local user/operator command:

```sh
pnpm tsx scripts/engineer-package.ts import --project <project-id> --path '/absolute/path/to/package'
pnpm tsx scripts/engineer-package.ts show --project <project-id> --package <package-id>
pnpm tsx scripts/engineer-package.ts draft --project <project-id> --package <package-id> --out data/package-review.json
```

Fill the review draft with the actual reviewer, song/version and recording
families. Confirm filename-based role guesses. Processing stage, mastering
status and common time origin can remain unknown. For each raw/processed pair,
record offset, gain difference, input/output tap points, latency review and the
review note; filenames and equal durations do not prove correspondence.

Permissions start local/private. Grant retrieval/display separately only for
material that may appear in examples/profiles. Hosted analysis is a separate
source permission; training remains disabled in this slice.

```sh
pnpm tsx scripts/engineer-package.ts review --project <project-id> --package <package-id> --file data/package-review.json
pnpm tsx scripts/engineer-package.ts profile --project <project-id> --package <package-id> --name 'Engineer name'
```

The review command refuses unfinished placeholders. Saving checks the expected
review revision; stale edits are rejected. A changed review invalidates all
derived package references/profiles, including when display permission is
revoked. Rebuild after reviewing the new state.

An automatically built profile reports supported facts about the supplied
exports, with applicability, exceptions and source example/audio links. It does
not infer unknown compressor settings, causality, intent, quality or general
engineer style. Decision examples retain these gaps; reviewed pairs additionally
become effect examples with unknown processor/control fields. Broader curated
findings can be supplied through D's reviewed example/profile endpoint.

## API and assistant tools

User/operator endpoints under `/api/music/audio/:projectId`:

- `POST /datasets/import-path` with `{ "path": "/absolute/local/path" }`.
- `POST /datasets/upload?name=package.zip` with raw ZIP bytes.
- `GET /datasets/:packageId` for inventory, review and readiness.
- `PATCH /datasets/:packageId/review` with `{ expectedRevision, review }`.
- `POST /datasets/:packageId/profile` with `{ name, expectedRevision }`.
- `GET /datasets/:packageId/assets/:assetId` for preserved original bytes.

The assistant can inspect registered IDs with `list_dataset_packages`,
`get_dataset_package`, `get_dataset_import`, `cancel_dataset_import` and
`retry_dataset_import`. These dispatch on the server and continue with the tab
closed. Local path selection, review, grants and profile building are user
operations, not assistant self-approval tools. Donor notes are untrusted source
data, never application workflows or executable code.

`register_dataset_audio` creates a bounded excerpt from a reviewed mono/stereo
PCM WAV, preserving the exact parent bytes/family and frame-based crop plus
encoding provenance. Sources are limited to 128 MiB; excerpts to 120 seconds,
defaulting to the first 20. Use `analyse_audio_artifact` / `get_audio_report` next.
Hosted hearing needs both dataset-source upload permission and per-song consent;
the source grant is rechecked before every provider attempt and cached reuse.

Other audio formats are inventoried/preserved, including AIFF, FLAC, MP3, OGG and
M4A. Their analysis registration is not implemented yet. Multichannel sources
are retained but B's mono/stereo analysis does not accept them.

## Preservation, jobs and coverage

Storage lives separately from songs under
`data/audio-intelligence/:projectId/datasets/`: hash-addressed `blobs/`, immutable
`packages/`, durable `imports/`, revisioned `reviews/` and D's example index.
The original ZIP is preserved too. Repeating an unchanged import produces the
same package identity. Changing source bytes during a folder copy is rejected.
Files are copied and hashed; no source project, media or settings are edited.

Imports report progress, cancellation, failure and interrupted recovery. Queued
jobs resume; running jobs recover as interrupted and require explicit retry,
with at most three attempts. Decode failures retain original bytes and do not
discard otherwise useful audio. Readiness distinguishes usable audio,
unreviewed roles, unknown time origins, unpaired raw/processed vocals, reviewed
pair completeness, structured session coverage, parameter readability and
reproduction readiness.

Limits: 1,000 files, 256 MiB per file/ZIP, 512 MiB total expanded files, bounded
directory count/depth. ZIP32 stored/deflated entries are supported; encrypted,
multi-disk, ZIP64, unsafe/duplicate paths, links/special files and corrupt
checksums/sizes are refused. This is a bounded ordinary-package importer, not a
universal archive extractor. Large packages need smaller exported subsets for
this version.

## Native session compatibility

| Material | Current capability | Unknown/unsupported |
| --- | --- | --- |
| FLP / PTX / PTS / PTF | Preserve original bytes and discover packaged audio | Version-specific session graph, parameters, routing, automation and dependencies |
| Plugin state/presets | Preserve opaque original bytes | Readable controls and restoration/render compatibility |
| Standard audio exports | Hash/preserve/probe; reviewed WAV passage measurement | Export tap/origin/mastering until reviewed; compressed-source passage registration |

No native extraction adapter is enabled without a declared tested
format/version/plugin matrix. Coverage records `extracted`, `preserved-opaque`,
`unsupported`, `missing`, `failed` and `not-applicable` independently. A preserved
blob never appears as known compressor settings or reproducible playback.

## Verification

Unit/service checks cover folder/ZIP intake, original byte hashes, corruption,
traversal/link/size handling, partial audio failures, repeat imports, project
isolation, cancellation, recovery/retry, stale reviews, permission revocation,
profile provenance and WAV source/crop registration. Browser integration checks
the real project-bound MCP catalogue and tools after closing the tab, reviews,
profile/example retrieval and original source links.

Real-audio preservation/registration/measurement verification used the existing
cleared “Lead Me” vocal and reconstructed accompaniment described in
[vocal-mix-workflow.md](vocal-mix-workflow.md). Both original WAV hashes were
retained; a 10-second 48 kHz vocal excerpt registered with its exact parent and
crop, then returned ten local measurements through B. No hosted requests or
human listening approvals were made. Local records:
`data/dataset-verification/verification.json` and its isolated `storage/`.
This checks real-audio plumbing, not subjective engineer-style usefulness.

Final checks (2026-10-05): `pnpm typecheck` passed; `pnpm test` passed with
2,338 tests (250 skipped); the complete `music-audio.spec.ts` passed four tests
and the complete `music.spec.ts` passed 63. The source-download route was fixed
to permit the editor's hidden data directory. The existing stretch browser test
now closes a revealed channel rack before double-clicking the covered clip.
The CLI was also exercised against an isolated live server: import/show/draft
passed, and an unfinished review was refused. Records are under ignored
`data/operator-verification/`; no user song or hosted provider was used.

Intake/review currently uses the CLI/local API. A dedicated dataset workspace UI,
larger/ZIP64 intake and native DAW extraction are separate follow-up work.

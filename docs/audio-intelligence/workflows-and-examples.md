# Workflows and reviewed examples (Slice D)

Implemented: application-owned workflow discovery, separate effect/decision/preference
records, project-scoped reviewed example and engineer-profile storage, bounded
context/use filtering and native-value retrieval. These tools work through the
server-owned MCP dispatcher with the tab closed.

Use `list_mix_workflows`, then `get_mix_workflow` for `vocal-compression`,
`vocal-eq` or `engineer-reference`. Procedures declare prerequisites, actual
tools, comparisons and stopping rules. The EQ workflow compares the existing
steady/presence alternatives with the same compressor/fader; it is a fixed
presence audition, not arbitrary corrective EQ. Existing capture/render/apply
services enforce state and undo safety.

Use `search_mix_examples` with role/plugin/goal/context filters and optional
kind/purpose. Results are capped at five and carry provenance, native values,
unit status, missing fields, use eligibility and weak genre-match warnings.
`get_mix_example` retrieves details. Unknown intent/units stay null/unverified;
reference retrieval never returns an executable proposal. Private/unreviewed
records are excluded. Effect comparisons require reviewed alignment and tap
points; preference retrieval requires level matching and listening context.

`list_engineer_profiles` / `get_engineer_profile` retrieve operator-reviewed
tendencies, applicability and exceptions backed by eligible source example IDs.
Missing/private/unreviewed sources prevent profile storage and retrieval. No
settings average or model-generated engineer rationale is treated as truth.

## Adding reviewed material

POST a JSON body containing `examples` and/or `profiles` to
`/api/music/audio/:projectId/examples`. This is a local user/operator operation,
not an assistant tool. Records use the shared `createMixExample` /
`createEngineerProfile` builders; validation refuses changed content identities
and malformed controls. Storage is separate from the song under
`data/audio-intelligence/:projectId/datasets/example-index.json`.

To bridge A's local MixParams subset, run:

```sh
pnpm tsx scripts/prepare-mix-reference-examples.ts
```

It writes an import body under ignored `data/` and refuses overwriting an existing
output. Import that body through the endpoint above. Annotations are reviewed
for data fidelity only; physical units, engineer intent, listening quality and
training eligibility are not inferred. No dataset rows are bundled in Git.

The library may be empty. No-match is an explicit valid result, not a reason to
manufacture examples. Donor notes remain source data and cannot enter the
application-owned workflow catalogue or override tool instructions.

Validation covers unknown-unit retention, weak matches, use filters, data
identity, project isolation/restart retrieval, private/unreviewed exclusion,
profile provenance and the Slice A bridge. No hearing provider is required.

Final validation (2026-10-05): type checking and the full 2,338-test unit/server
suite passed. All four audio browser tests and all 63 music browser tests passed,
including closed-tab workflow/example/profile retrieval through the actual MCP
dispatcher. Real musical quality and hosted hearing certification remain C/G
evaluation work.

/**
 * The audio-intelligence contracts (`docs/audio-intelligence/audio-engineering-harness.md`): the records
 * the assistant's hearing, measuring and mixing tools stand on. All of them are plain JSON, immutable once
 * made, and identified by what's in them (a hash), so anything the assistant says can be traced to the exact
 * song, state and audio it came from:
 *
 *   MixSnapshot ── what the song was (document, media and plugin states, by hash; and what we couldn't capture)
 *   AudioArtifact ── audio rendered from a snapshot (or a fixture), by the hash of its bytes
 *   EvidenceReport ── what was measured, heard and guessed about artifacts: kept apart, with their limits
 *   AudioJob ── a long operation (render, analyse...) with durable stages, cancellation and bounded retries
 *   MixRun ── one mixing task: goal, snapshot, evidence, candidates and the budgets that cap it
 *
 * Unknown stays unknown: a value we couldn't read is `null` or a coverage entry saying so, never a guess.
 * Pure, no Node: the tab and the server build and check the same records.
 */

/** Bumps when a record's meaning changes (not for an added optional field). */
export const AUDIO_INTELLIGENCE_SCHEMA = 1;

/** 64 lower-case hex digits (`shared/music/hash.ts`). */
export type Hash = string;

// ---------------------------------------------------------------------------------------------------------
// Coverage: what a record captured, and what it could not.

/** What a record can say about one part of what it describes. */
export const COVERAGE_STATUSES = ["captured", "partial", "unavailable", "notApplicable"] as const;
export type CoverageStatus = (typeof COVERAGE_STATUSES)[number];

export interface CoverageEntry {
  status: CoverageStatus;
  /** Why, when it isn't plainly `captured` or `notApplicable`: shown to the model, so say what to do about it. */
  note?: string;
}

/**
 * How a plugin parameter, or a dataset's setting, can be read (the dataset plan's vocabulary): an exact readout
 * from the processor, a value a person annotated, one estimated by eye or by ear, saved state we hold but
 * can't read (a plugin's blob), or nothing.
 */
export const PARAMETER_READABILITY = ["exact", "annotated", "estimated", "opaque", "unavailable"] as const;
export type ParameterReadability = (typeof PARAMETER_READABILITY)[number];

// ---------------------------------------------------------------------------------------------------------
// Snapshots

/** The parts of a song's document a snapshot hashes one by one, so a later edit says *which* part changed. */
export const SNAPSHOT_PARTS = ["settings", "channels", "patterns", "playlist", "mixer", "automations", "modulators"] as const;
export type SnapshotPart = (typeof SNAPSHOT_PARTS)[number];

/** What a snapshot says it did and didn't capture, by aspect. */
export const COVERAGE_ASPECTS = [
  // The song's document: notes, arrangement, settings.
  "document",
  // Every sample and audio file the song plays, hashed.
  "media",
  // Which channel plays into which track, sends, keys (sidechains), modulators.
  "routing",
  // Automation clips and the tempo map.
  "automation",
  // Our own effects (Pro-C, Pro-Q, ...), whose settings are in the document.
  "builtInEffects",
  // Which plugins the song uses: their id, name, format and version. Partial while a version isn't known.
  "pluginIdentity",
  // A plugin's saved settings file, hashed. Opaque: it can be restored, not read.
  "pluginState",
  // The sample rate, resampling and mode a render would use.
  "renderSettings",
] as const;
export type CoverageAspect = (typeof COVERAGE_ASPECTS)[number];

export type SnapshotCoverage = Record<CoverageAspect, CoverageEntry>;

/** One file the song plays. `sha256` is null when it couldn't be read: then `status` says why. */
export interface MediaRef {
  /** The project's media id (a channel's `sampleId`). */
  id: string;
  /** Channels that play it. */
  channels: string[];
  status: "hashed" | "missing" | "unreadable";
  sha256: Hash | null;
  bytes: number | null;
}

/** A plugin's saved settings, or the lack of them. A built-in effect's settings are in the document: `document`. */
export interface PluginStateRef {
  owner: { kind: "channel" | "effect"; id: string };
  /** `version` is the plugin's own, when the engine said it: null when it didn't (today it doesn't), and then the state can't be tied to a build. */
  plugin: { id: string; name: string; format: string; version: string | null };
  /**
   * `file`: its state is a file beside the project (`plugins/<id>.bin`), hashed when it was there.
   * `document`: one of our own effects, whose settings are in the document.
   */
  storage: "file" | "document";
  /** For a file: `hashed`, `absent` (none written yet: the plugin's defaults, or its settings not yet saved) or `unreadable`. */
  state: "hashed" | "absent" | "unreadable" | "inDocument";
  sha256: Hash | null;
  bytes: number | null;
}

/** What a render would use (`SetSongRequest.resampling`, the output's format). */
export interface RenderSettings {
  sampleRate: number;
  channelLayout: "stereo";
  resampling: "linear" | "hermite" | "sinc";
  /** Pattern mode plays the shown pattern; song mode the playlist. */
  mode: "pattern" | "song";
  /** The engine's own version string, when it says one; null when it doesn't. */
  engineVersion: string | null;
}

/** How the song keeps time. Tempo clips in the playlist warp it (`shared/music/tempo.ts`). */
export interface Timing {
  tempo: number;
  timeSignature: [number, number];
  swing: number;
  /** An automation clip moves the tempo: ticks no longer map to seconds at one rate. */
  tempoAutomated: boolean;
}

/** Where a capture came from, and whether the tab had edits the server didn't have. Not part of a snapshot's identity. */
export interface CaptureProvenance {
  origin: "saved-document" | "live-document";
  /** The live document differed from the last saved one, or null when not known. */
  unsavedEdits: boolean | null;
  /** The tab's edit counter, when it has one. */
  editCount?: number;
}

/**
 * The song as it was when captured. Immutable: the id is a hash of everything but `createdAt` and `capture`,
 * so capturing an unchanged song again gives the same id. The document itself is stored separately
 * (`SnapshotBundle`); this record has its hashes.
 */
export interface MixSnapshot {
  schema: typeof AUDIO_INTELLIGENCE_SCHEMA;
  /** `snap_` + the first 20 hex digits of the identity hash. */
  id: string;
  projectId: string;
  /** Epoch milliseconds. */
  createdAt: number;
  capture: CaptureProvenance;
  /**
   * The revision an edit is checked against: the hash of the song's musical content (its name left out:
   * renaming changes no sound) and each part's own.
   */
  document: { sha256: Hash; parts: Record<SnapshotPart, Hash> };
  timing: Timing;
  media: MediaRef[];
  plugins: PluginStateRef[];
  render: RenderSettings;
  coverage: SnapshotCoverage;
  /** `complete` only when every aspect is `captured` or `notApplicable`. */
  completeness: "complete" | "partial";
}

// ---------------------------------------------------------------------------------------------------------
// Artifacts

export const ARTIFACT_ROLES = ["mix", "track-stem", "bus-stem", "source-media", "reference", "candidate-render", "fixture"] as const;
export type ArtifactRole = (typeof ARTIFACT_ROLES)[number];

export const SAMPLE_FORMATS = ["pcm16", "pcm24", "float32"] as const;
export type SampleFormat = (typeof SAMPLE_FORMATS)[number];

export interface AudioFormat {
  sampleRate: number;
  channels: number;
  sampleFormat: SampleFormat;
  /** Frames (samples per channel), the lead-in and tail included. */
  frames: number;
}

/**
 * Where an artifact's audio sits in the song. Frame 0 is `leadInFrames` before the passage starts (the
 * warm-up compressors and reverbs need), the passage runs to `frames - tailFrames`, and what follows is the
 * ring-out. Seconds are on the song's own clock, before any tempo-clip warp.
 */
export interface PassageTime {
  /** The passage asked for, in song ticks (`PPQ` 96 to a quarter note). */
  startTick: number;
  endTick: number;
  /** Where the passage starts, in seconds from the song's start. */
  startSeconds: number;
  leadInFrames: number;
  tailFrames: number;
}

/** What was done to the audio since it was rendered: any of these means it isn't the full-resolution original. */
export type ArtifactTransform =
  | { kind: "resample"; fromRate: number; toRate: number }
  | { kind: "downmix"; toChannels: number }
  | { kind: "gain"; db: number }
  | { kind: "trim"; fromFrame: number; toFrame: number }
  | { kind: "encode"; codec: string };

/**
 * How a render was made, where it matters to what the audio can be trusted for (`docs/audio-intelligence/engine-render-limits.md`).
 * Null on audio that isn't a render of a song.
 */
export interface RenderFacts {
  /**
   * `cold`: effect and plugin history was reset when the render started (today, always): the lead-in is a way to warm
   * them up, not proof they converged. `warm`: carried on from earlier audio.
   */
  start: "cold" | "warm";
  /** The block size it ran at, or null when not known. */
  blockSize: number | null;
  /** The delay the engine said its plugins add, in seconds, already trimmed off; null when not known. */
  latencySeconds: number | null;
  /** How the end was treated (`none`, `ringOut`...) and the longest ring-out allowed, or null when not known. */
  tail: { mode: string; maxSeconds: number | null } | null;
  /** Each plugin's state in the engine when it rendered: a plugin that hadn't loaded is silent or bypassed. */
  plugins: { ownerId: string; load: "loaded" | "loading" | "failed" | "unknown" }[];
  /** Plugins the song uses that aren't installed here. */
  missingPlugins: string[];
}

/** What an artifact may be used for, each on its own: hosted analysis is an upload, and training is never implied. */
export interface UsePermissions {
  localAnalysis: boolean;
  hostedAnalysis: boolean;
  retrievalDisplay: boolean;
  training: boolean;
}

/** Every permission off but local analysis: the user's own audio stays on this computer until they say otherwise. */
export const PRIVATE_USE: UsePermissions = { localAnalysis: true, hostedAnalysis: false, retrievalDisplay: false, training: false };

/**
 * Audio, by the hash of its bytes, and where it came from. Immutable. `snapshotId` is null only for audio that
 * isn't a render of a song (a fixture, a reference): `origin` then says what it is.
 */
export interface AudioArtifact {
  schema: typeof AUDIO_INTELLIGENCE_SCHEMA;
  /** `art_` + the first 20 hex digits of a hash of its content, snapshot, role, tap, passage and transforms. */
  id: string;
  contentSha256: Hash;
  bytes: number;
  role: ArtifactRole;
  format: AudioFormat;
  snapshotId: string | null;
  /** The mixer track or channel tapped (a stem), or null for the master / a source file. */
  tap: { kind: "master" | "track" | "channel" | "media"; id: string | null };
  /** Null for a whole file. */
  passage: PassageTime | null;
  /** How it was rendered; null for what wasn't (a fixture, a reference, a source file). */
  render: RenderFacts | null;
  /** The artifact this one was made from, by id, and what was done to it. Empty `transforms` = full resolution. */
  derivedFrom: string | null;
  transforms: ArtifactTransform[];
  /** Job that made it, when a job did. */
  jobId: string | null;
  /** Where its recording comes from (fixtures and datasets): ties derived audio to the same family for splits. */
  recordingFamilyId: string | null;
  permissions: UsePermissions;
  /** Epoch milliseconds. */
  createdAt: number;
}

// ---------------------------------------------------------------------------------------------------------
// Evidence

/** A span of an artifact, in seconds of the artifact's own audio (frame 0 is 0). */
export interface ArtifactSpan {
  artifactId: string;
  startSeconds: number;
  endSeconds: number;
}

/** How strongly the evidence supports a claim: qualitative, never a made-up probability. */
export const EVIDENCE_STRENGTHS = ["weak", "moderate", "strong"] as const;
export type EvidenceStrength = (typeof EVIDENCE_STRENGTHS)[number];

/** A number computed from the audio by a named method. `value` null: it couldn't be measured (`note` says why). */
export interface Measurement {
  id: string;
  /** What it is: `peakDbfs`, `truePeakDbtp`, `rmsDbfs`, `lufsIntegrated`, `crestDb`, `stereoCorrelation`... */
  name: string;
  value: number | null;
  unit: string;
  span: ArtifactSpan;
  /** Which channel or derived signal: `left`, `right`, `mid`, `side`, or `all`. */
  channel: string;
  /** The method and its version: a measurement without them can't be compared with another. */
  method: { name: string; version: string };
  note?: string;
}

/** Where an observation came from. Never a measurement: a model's or a person's opinion about what's audible. */
export interface ObservationSource {
  kind: "hosted-perception" | "listener" | "model";
  provider?: string;
  model?: string;
  version?: string;
}

export interface Observation {
  id: string;
  source: ObservationSource;
  /** What was heard, in the source's words, about the spans. */
  claim: string;
  spans: ArtifactSpan[];
  strength: EvidenceStrength;
  /** The question it answers, when it was asked one. */
  question?: string;
}

/** What the assistant thinks follows, and which measurements and observations it rests on. */
export interface Hypothesis {
  id: string;
  text: string;
  supportedBy: string[];
  strength: EvidenceStrength;
}

export interface Limitation {
  /** A short machine code (`downmixed`, `provider-unavailable`, `short-passage`...). */
  code: string;
  text: string;
  /** Ids of the measurements or observations it affects; empty: the whole report. */
  affects: string[];
}

/** An artifact a report is about, by id and content hash, so a changed file can't be mistaken for it. */
export interface ArtifactRef {
  id: string;
  contentSha256: Hash;
}

/**
 * What a report looked at. A report that found nothing wrong says only that nothing was found *here*: `inspected`
 * lists the spans heard and measured, and `unavailable` the capabilities that weren't (hosted hearing off, say).
 */
export interface EvidenceCoverage {
  inspected: ArtifactSpan[];
  unavailable: string[];
}

/** What the assistant is given about audio: measured, heard and guessed, in separate lists. Immutable. */
export interface EvidenceReport {
  schema: typeof AUDIO_INTELLIGENCE_SCHEMA;
  /** `ev_` + the first 20 hex digits of a hash of everything but `createdAt`. */
  id: string;
  snapshotId: string | null;
  /** What it was asked: `levels`, `tone`, `compare`... */
  task: string;
  artifactRefs: ArtifactRef[];
  measurements: Measurement[];
  observations: Observation[];
  hypotheses: Hypothesis[];
  limitations: Limitation[];
  coverage: EvidenceCoverage;
  /** Epoch milliseconds. */
  createdAt: number;
}

// ---------------------------------------------------------------------------------------------------------
// Jobs

export const JOB_KINDS = ["capture", "render", "analyse", "compare", "import"] as const;
export type JobKind = (typeof JOB_KINDS)[number];

/**
 * `interrupted`: it was running when the server went away. A restart finds those and moves them there (it can't
 * know what finished), and they may be retried or given up on.
 */
export const JOB_STATUSES = ["queued", "running", "succeeded", "failed", "cancelled", "interrupted"] as const;
export type JobStatus = (typeof JOB_STATUSES)[number];

export interface JobStage {
  name: string;
  status: "pending" | "running" | "done";
  /** 0..1 within the stage. */
  progress: number;
}

export interface JobError {
  message: string;
  /** A retry could help (the engine was busy, a provider timed out), as against a request that can't succeed. */
  retryable: boolean;
}

export interface JobEvent {
  /** Epoch milliseconds. */
  at: number;
  type: string;
  stage?: string;
  message?: string;
}

/** Ids of what a finished job made. */
export interface JobResult {
  artifactIds: string[];
  evidenceIds: string[];
  snapshotIds: string[];
}

export interface AudioJob {
  schema: typeof AUDIO_INTELLIGENCE_SCHEMA;
  /** `job_` + 12 hex digits (`createId`): jobs aren't content-addressed, a retry is the same job. */
  id: string;
  kind: JobKind;
  /** The project it acts in: a job never reaches another's. */
  projectId: string;
  /** Hash of what it was asked, so asking for the same thing twice finds the first (`idempotencyKey`). */
  idempotencyKey: Hash;
  /** The chat's run that asked, if one did. */
  runId: string | null;
  /** The ids it reads, as the caller gave them. */
  inputs: string[];
  status: JobStatus;
  stages: JobStage[];
  /** Runs started so far. */
  attempts: number;
  maxAttempts: number;
  /** Cancel was asked while it ran: it ends `cancelled` once it has let go of what it holds (the engine). */
  cancelRequested: boolean;
  result: JobResult | null;
  error: JobError | null;
  events: JobEvent[];
  createdAt: number;
  updatedAt: number;
}

// ---------------------------------------------------------------------------------------------------------
// Mix runs

/**
 * The steps of a mixing task. `compare` may go back to `propose` (a revision) while the budget allows it; every
 * phase may end in `abandoned`.
 */
export const RUN_PHASES = [
  "capture",
  "inspect",
  "hypothesise",
  "propose",
  "render",
  "compare",
  "present",
  "accepted",
  "discarded",
  "abandoned",
] as const;
export type RunPhase = (typeof RUN_PHASES)[number];

/** How a run ended, the honest ones included: a tie and "leave it as it is" are results. */
export const RUN_OUTCOMES = ["improved", "tie", "no-change", "regression", "stale", "budget", "failed"] as const;
export type RunOutcome = (typeof RUN_OUTCOMES)[number];

/** The caps the service enforces, whatever the agent asks. */
export interface RunBudgets {
  maxCandidates: number;
  maxRevisionRounds: number;
  /** Seconds of audio in one rendered passage. */
  maxPassageSeconds: number;
  /** Seconds of audio rendered over the whole run. */
  maxRenderSeconds: number;
  maxHostedCalls: number;
  /** Wall-clock seconds from the run's start. */
  maxRunSeconds: number;
}

export type BudgetKind = keyof RunBudgets;

/** What's been spent: `candidates`, `revisionRounds`, `renderSeconds`, `hostedCalls`. (Passage length and run time are checked, not summed.) */
export interface RunUsage {
  candidates: number;
  revisionRounds: number;
  renderSeconds: number;
  hostedCalls: number;
}

export interface RunPassage {
  startTick: number;
  endTick: number;
  /** Why it was picked: a peak, a quiet line, a consonant, a representative section. */
  why: string;
}

export interface MixRun {
  schema: typeof AUDIO_INTELLIGENCE_SCHEMA;
  /** `run_` + 12 hex digits. */
  id: string;
  projectId: string;
  goal: string;
  constraints: string[];
  /** The snapshot the run started from; accepting checks the song still matches its parts. */
  snapshotId: string;
  passages: RunPassage[];
  workflow: { id: string; version: number } | null;
  evidenceIds: string[];
  exampleIds: string[];
  candidateIds: string[];
  budgets: RunBudgets;
  usage: RunUsage;
  phase: RunPhase;
  outcome: RunOutcome | null;
  /** Epoch milliseconds. */
  startedAt: number;
  updatedAt: number;
}

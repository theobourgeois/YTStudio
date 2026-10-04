/**
 * Capturing a song's snapshot (`shared/music/audio-intelligence/snapshot.ts`): reading the files the pure builder
 * can't. The song is whatever the caller gives (the tab's live one, or the saved file); this adds the hashes of its
 * media and of each plugin's saved state, which live beside the project (`plugins/<id>.bin`).
 */
import path from "node:path";
import { buildSnapshot, mediaUses, pluginOwners, type FileFacts, type SnapshotBundle } from "../../../shared/music/audio-intelligence/snapshot.ts";
import type { CaptureProvenance, RenderSettings } from "../../../shared/music/audio-intelligence/types.ts";
import type { MusicProject } from "../../../shared/music/types.ts";
import { FileHasher } from "./files.ts";

export interface CaptureOptions {
  projectId: string;
  /** A normalised song (`normalizeMusicProject`). */
  document: MusicProject;
  /** The project's folder (`ProjectStore.dir`): its plugins' state is in `plugins/`. */
  projectDir: string;
  /** Where a media id's file is (`MediaLibrary`): null when there isn't one. Never build a path from an id yourself. */
  samplePath: (mediaId: string) => string | null;
  render: RenderSettings;
  capture: CaptureProvenance;
  pluginVersions?: Readonly<Record<string, string>>;
  hasher?: FileHasher;
  now?: number;
}

/** What names a plugin's state file: the id of its owner, as the engine writes it. Anything that could leave the folder isn't an id. */
const SAFE_OWNER = /^[A-Za-z0-9_-]{1,64}$/;

/** Reads the song's files and builds its snapshot. Never throws for a file it can't read: that's coverage. */
export async function captureSnapshot(options: CaptureOptions): Promise<SnapshotBundle> {
  const hasher = options.hasher ?? new FileHasher();
  const states = path.join(options.projectDir, "plugins");

  const media: Record<string, FileFacts> = {};
  for (const { id } of mediaUses(options.document)) media[id] = await hasher.facts(options.samplePath(id));

  const pluginStates: Record<string, FileFacts> = {};
  for (const { owner, builtIn } of pluginOwners(options.document)) {
    if (builtIn) continue;
    pluginStates[owner.id] = SAFE_OWNER.test(owner.id) ? await hasher.facts(path.join(states, `${owner.id}.bin`)) : { status: "unreadable", sha256: null, bytes: null };
  }

  return buildSnapshot({
    projectId: options.projectId,
    document: options.document,
    media,
    pluginStates,
    pluginVersions: options.pluginVersions,
    render: options.render,
    capture: options.capture,
    now: options.now ?? Date.now(),
  });
}

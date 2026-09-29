/**
 * The video a tool call acts on. A chat belongs to one video and keeps
 * working on it after the user switches to another, so a call's video is
 * either the one open in the editor (edits go through the editor store:
 * live, one undo step each) or one loaded here on its own, in the
 * background (edits are saved through the same autosave queue, which is
 * flushed before any video is opened, so opening it shows them).
 */
import { normalizeProject } from "@shared/normalize";
import { DEFAULT_PROJECT_NAME, removeAssetClips } from "@shared/timeline";
import type { MediaAsset, Project } from "@shared/types";
import { api } from "@/lib/api";
import { editorProjectId, flushAutosave, queueSave, useEditor } from "@/stores/editor";
import { usePlayback } from "@/stores/playback";
import { ToolError } from "./input";

export interface ToolDoc {
  readonly projectId: string;
  /** It's the video open in the editor: its playhead, selection, undo and Program monitor are the user's. */
  readonly isOpen: boolean;
  readonly project: Project;
  readonly assets: readonly MediaAsset[];
  asset(assetId: string): MediaAsset | undefined;
  /** Replace the video with an edited one (one undo step when it's open). */
  commit(next: Project): void;
  rename(name: string): void;
  /** Media added to it some other way (imported, copied from the Library). */
  addAssets(assets: MediaAsset[]): void;
  /** Media deleted on the server: it's gone from the list, and so are its clips. */
  assetDeleted(assetId: string): void;
  readonly playhead: number;
  readonly selectedClipIds: readonly string[];
}

const SWITCHED = "The user just switched videos while this ran, so it didn't happen. Call it again.";

/** The video open in the editor. */
class EditorDoc implements ToolDoc {
  readonly isOpen = true;
  constructor(readonly projectId: string) {}

  private get editor() {
    const editor = useEditor.getState();
    if (editor.projectId !== this.projectId || editorProjectId() !== this.projectId) throw new ToolError(SWITCHED);
    return editor;
  }
  get project() {
    return this.editor.project;
  }
  get assets() {
    return this.editor.assets;
  }
  asset(assetId: string) {
    return this.editor.getAsset(assetId);
  }
  commit(next: Project) {
    const editor = this.editor;
    if (next !== editor.project) editor.commit(() => next);
  }
  rename(name: string) {
    this.editor.renameProject(name);
  }
  addAssets(assets: MediaAsset[]) {
    this.editor.addImportedAssets(assets);
  }
  assetDeleted(assetId: string) {
    // `deleteAsset` does both (and strips the history); only reached if it was deleted another way.
    const editor = this.editor;
    if (editor.getAsset(assetId)) useEditor.setState({ assets: editor.assets.filter((a) => a.id !== assetId) });
    this.commit(removeAssetClips(editor.project, assetId));
  }
  get playhead() {
    return usePlayback.getState().time;
  }
  get selectedClipIds() {
    return this.editor.selectedClipIds;
  }
}

/** A video that isn't open here: its own copy, saved as it's edited. */
class BackgroundDoc implements ToolDoc {
  readonly isOpen = false;
  readonly playhead = 0;
  readonly selectedClipIds: readonly string[] = [];
  lastUsed = Date.now();

  constructor(
    readonly projectId: string,
    public project: Project,
    public assets: MediaAsset[],
  ) {}

  /** The editor opened it meanwhile: its copy is the one to edit now (this call is refused rather than lost). */
  private check() {
    if (editorProjectId() === this.projectId) throw new ToolError(SWITCHED);
    this.lastUsed = Date.now();
  }
  asset(assetId: string) {
    return this.assets.find((a) => a.id === assetId);
  }
  commit(next: Project) {
    this.check();
    if (next === this.project) return;
    this.project = next;
    queueSave(this.projectId, next);
  }
  rename(name: string) {
    const trimmed = name.trim();
    if (trimmed && trimmed !== this.project.name) this.commit({ ...this.project, name: trimmed });
  }
  addAssets(assets: MediaAsset[]) {
    this.check();
    const mine = assets.filter((a) => a.projectId === this.projectId);
    if (mine.length === 0) return;
    const ids = new Set(mine.map((a) => a.id));
    this.assets = [...mine, ...this.assets.filter((a) => !ids.has(a.id))];
    // Like the editor: a video's first media names it.
    if (this.project.name === DEFAULT_PROJECT_NAME) this.rename(mine[0].name.replace(/\.[^.]+$/, ""));
  }
  assetDeleted(assetId: string) {
    this.check();
    this.assets = this.assets.filter((a) => a.id !== assetId);
    this.commit(removeAssetClips(this.project, assetId));
  }
}

/** Background copies are dropped after this long without a call (they're loaded again when needed). */
const IDLE_MS = 2 * 60_000;
const background = new Map<string, Promise<BackgroundDoc>>();
let sweeper: ReturnType<typeof setInterval> | undefined;

function sweep() {
  for (const [id, doc] of background) {
    void doc.then((d) => {
      if (Date.now() - d.lastUsed > IDLE_MS && background.get(id) === doc) background.delete(id);
    });
  }
  if (background.size === 0) {
    clearInterval(sweeper);
    sweeper = undefined;
  }
}

async function loadBackground(projectId: string): Promise<BackgroundDoc> {
  // What the editor last had of it (if it was open until just now) is saved first.
  await flushAutosave();
  const [project, assets] = await Promise.all([api.getProject(projectId), api.listMedia(projectId)]);
  const byId = Object.fromEntries(assets.map((a) => [a.id, a]));
  return new BackgroundDoc(projectId, normalizeProject(project, byId), assets);
}

/** The video `projectId` for a tool call: the editor's, or a background copy of it. */
export async function docFor(projectId: string): Promise<ToolDoc> {
  // Being opened: wait for it, then it's the editor's.
  while (useEditor.getState().loading && editorProjectId() === projectId) {
    await new Promise<void>((resolve) => {
      const off = useEditor.subscribe((s) => {
        if (s.loading) return;
        off();
        resolve();
      });
    });
  }
  if (editorProjectId() === projectId && useEditor.getState().projectId === projectId) {
    background.delete(projectId);
    return new EditorDoc(projectId);
  }
  let doc = background.get(projectId);
  if (!doc) {
    doc = loadBackground(projectId);
    background.set(projectId, doc);
    doc.catch(() => background.delete(projectId));
    sweeper ??= setInterval(sweep, 30_000);
  }
  const loaded = await doc;
  loaded.lastUsed = Date.now();
  return loaded;
}

// Opening a video makes the editor's copy the one to use.
useEditor.subscribe((s, prev) => {
  if (s.projectId !== prev.projectId && s.projectId) background.delete(s.projectId);
});

/**
 * The assistant's checkpoints (see `lib/checkpoints.ts`) for every project, kept for this session: the bridge
 * records each tool call's change, the chat restores a message's checkpoint, and the review bar keeps or undoes
 * everything the assistant changed since the last Keep. Documents are put back through the project's suite
 * (`ClientSuite.documents`), each as one undo step.
 */
import { create } from "zustand";
import {
  type Checkpoints,
  type MessageRef,
  NO_CHECKPOINTS,
  adopt,
  keepAll,
  recordChange,
  redoRestore,
  restoreTo,
  restoredUndone,
  undoAll,
} from "@/lib/checkpoints";
import { projectSuite } from "@/stores/projects";
import { clientSuite } from "@/suites";

interface CheckpointStore extends Checkpoints {
  /** The answer `turn` changed `projectId` from `before` to `after`. */
  record: (turn: string, projectId: string, before: unknown, after: unknown) => void;
  /** Put the open project back as it was when the user sent `messageId`. */
  restore: (projectId: string, messageId: string, messages: readonly MessageRef[]) => void;
  /** Undo the last restore. */
  redo: (projectId: string) => void;
  /** A restore undone with ⌘Z: forget it, and its review is back. */
  restoreUndone: (projectId: string) => void;
  /** Put the project back as the user last kept it. */
  undoAll: (projectId: string) => void;
  /** What the assistant changed is the user's now. */
  keepAll: (projectId: string) => void;
  /** The open project was loaded again: documents kept that it's the same as become it. */
  adopt: (projectId: string, current: unknown) => void;
}

function documentsOf(projectId: string) {
  const suite = projectSuite(projectId);
  return suite ? clientSuite(suite).documents : null;
}

/** The open project's document now, as its suite says. */
function currentOf(projectId: string): unknown {
  const docs = documentsOf(projectId);
  return docs ? docs.current(projectId) : null;
}

const json = new WeakMap<object, string>();
/** Two documents with the same content (each one's JSON worked out once). */
function same(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== "object" || typeof b !== "object" || !a || !b) return false;
  const text = (o: object) => {
    let t = json.get(o);
    if (t === undefined) json.set(o, (t = JSON.stringify(o)));
    return t;
  };
  return text(a) === text(b);
}

export const useCheckpoints = create<CheckpointStore>((set, get) => {
  /** Put `doc` back in the project, and the state that says so. */
  const put = (projectId: string, change: { state: Checkpoints; doc: unknown } | null) => {
    const docs = documentsOf(projectId);
    if (!change || !docs) return;
    docs.restore(projectId, change.doc);
    // The suite may have put back a copy (keeping a name changed since): that's the one restored.
    const restore = change.state.restores[projectId];
    const now = docs.current(projectId);
    if (restore && now !== null && now !== restore.doc) set({ ...change.state, restores: { ...change.state.restores, [projectId]: { ...restore, doc: now } } });
    else set(change.state);
  };
  const state = (): Checkpoints => {
    const { turns, reviews, restores } = get();
    return { turns, reviews, restores };
  };
  return {
    ...NO_CHECKPOINTS,
    record(turn, projectId, before, after) {
      const next = recordChange(state(), turn, projectId, before, after);
      if (next !== state()) set(next);
    },
    restore(projectId, messageId, messages) {
      put(projectId, restoreTo(state(), messages, messageId, projectId, currentOf(projectId)));
    },
    redo(projectId) {
      put(projectId, redoRestore(state(), projectId));
    },
    restoreUndone(projectId) {
      set(restoredUndone(state(), projectId));
    },
    undoAll(projectId) {
      put(projectId, undoAll(state(), projectId));
    },
    keepAll(projectId) {
      set(keepAll(state(), projectId));
    },
    adopt(projectId, current) {
      const next = adopt(state(), projectId, current, same);
      if (next !== state()) set(next);
    },
  };
});

/** Whether two snapshots of a project differ (`exact` ones by identity, others by content). */
export const changed = (before: { doc: unknown; exact: boolean }, after: { doc: unknown; exact: boolean }) =>
  before.exact && after.exact ? before.doc !== after.doc : !same(before.doc, after.doc);

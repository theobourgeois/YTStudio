/**
 * The assistant's checkpoints, Cursor's way, for every suite. Each answer that changes its project keeps the
 * project as it was before its first change and after its last, so:
 * - any message of the user's can be gone back to ("Restore checkpoint": the project as it was when it was sent),
 *   and that restore redone until the project changes again;
 * - what the assistant changed since the user last said Keep waits for review: Undo all, or Keep all.
 * Documents are any suite's, compared by identity (edits never change one in place, and the same state is the
 * same object). Pure: `stores/checkpoints.ts` holds this and puts documents back through the suites.
 */

/** One answer's changes. */
export interface Checkpoint {
  projectId: string;
  /** The project before the answer's first change. */
  before: unknown;
  /** And after its latest. */
  after: unknown;
}

/** The assistant's changes to a project since the user last kept them. */
export interface Review {
  /** The project as it was then: Undo all goes back to it. */
  base: unknown;
  /** The answers that changed it since, oldest first. */
  turns: string[];
}

/** A checkpoint gone back to, while it can be redone. */
export interface Restore {
  /** The user's message it went back to before. */
  messageId: string;
  /** The project it put back. */
  doc: unknown;
  /** The project it replaced (Redo). */
  redo: unknown;
  /** The review before it (Redo brings it back). */
  review: Review | null;
}

export interface Checkpoints {
  /** By assistant message id. */
  turns: Record<string, Checkpoint>;
  /** By project id. */
  reviews: Record<string, Review>;
  /** By project id. */
  restores: Record<string, Restore>;
}

export const NO_CHECKPOINTS: Checkpoints = { turns: {}, reviews: {}, restores: {} };

/** Answers kept, all projects together (the oldest are forgotten first). */
export const MAX_CHECKPOINTS = 200;

function without<T>(record: Record<string, T>, key: string): Record<string, T> {
  if (!(key in record)) return record;
  const { [key]: _, ...rest } = record;
  return rest;
}

/** The answer `turn` changed its project from `before` to `after` (one tool call's change). */
export function recordChange(state: Checkpoints, turn: string, projectId: string, before: unknown, after: unknown): Checkpoints {
  if (before === after) return state;
  const known = state.turns[turn];
  let turns: Record<string, Checkpoint> = { ...without(state.turns, turn), [turn]: { projectId, before: known?.before ?? before, after } };
  const ids = Object.keys(turns);
  if (ids.length > MAX_CHECKPOINTS) turns = Object.fromEntries(ids.slice(-MAX_CHECKPOINTS).map((id) => [id, turns[id]]));
  const review = state.reviews[projectId];
  const reviewed: Review = review ? (review.turns.includes(turn) ? review : { ...review, turns: [...review.turns, turn] }) : { base: before, turns: [turn] };
  // The project changed: a restore can't be redone any more.
  return { turns, reviews: { ...state.reviews, [projectId]: reviewed }, restores: without(state.restores, projectId) };
}

/** A chat's messages, as far as checkpoints care. */
export type MessageRef = { id: string; role: "user" | "assistant" };

/**
 * The checkpoint at the user's message `messageId`: the project as the first answer after it to change it found
 * it, and the answers since that changed it. Null when nothing has changed it since.
 */
export function checkpointAt(state: Pick<Checkpoints, "turns">, messages: readonly MessageRef[], messageId: string, projectId: string): { doc: unknown; turns: string[] } | null {
  const at = messages.findIndex((m) => m.id === messageId);
  if (at === -1) return null;
  const turns = messages.slice(at + 1).flatMap((m) => (m.role === "assistant" && state.turns[m.id]?.projectId === projectId ? [m.id] : []));
  return turns.length ? { doc: state.turns[turns[0]].before, turns } : null;
}

/** Go back to the checkpoint at `messageId` (see `checkpointAt`) from `current`. The document to put back, or null. */
export function restoreTo(
  state: Checkpoints,
  messages: readonly MessageRef[],
  messageId: string,
  projectId: string,
  current: unknown,
): { state: Checkpoints; doc: unknown } | null {
  const point = checkpointAt(state, messages, messageId, projectId);
  if (!point || point.doc === current) return null;
  const review = state.reviews[projectId] ?? null;
  let reviews = state.reviews;
  if (review) {
    // The answers gone back over aren't waiting for review any more.
    const kept = review.turns.filter((t) => !point.turns.includes(t));
    reviews = kept.length && review.base !== point.doc ? { ...reviews, [projectId]: { ...review, turns: kept } } : without(reviews, projectId);
  }
  return {
    state: { ...state, reviews, restores: { ...state.restores, [projectId]: { messageId, doc: point.doc, redo: current, review } } },
    doc: point.doc,
  };
}

/** Undo a restore: the project it replaced, and its review back. Null when there's nothing to redo. */
export function redoRestore(state: Checkpoints, projectId: string): { state: Checkpoints; doc: unknown } | null {
  const restore = state.restores[projectId];
  if (!restore) return null;
  return { state: restoredUndone(state, projectId), doc: restore.redo };
}

/** The restore was undone some other way (⌘Z): its review comes back. */
export function restoredUndone(state: Checkpoints, projectId: string): Checkpoints {
  const restore = state.restores[projectId];
  if (!restore) return state;
  const reviews = restore.review ? { ...state.reviews, [projectId]: restore.review } : without(state.reviews, projectId);
  return { ...state, reviews, restores: without(state.restores, projectId) };
}

/** Undo all: the project as the user last kept it (null when nothing waits for review). */
export function undoAll(state: Checkpoints, projectId: string): { state: Checkpoints; doc: unknown } | null {
  const review = state.reviews[projectId];
  if (!review) return null;
  return { state: { ...state, reviews: without(state.reviews, projectId), restores: without(state.restores, projectId) }, doc: review.base };
}

/** Keep all: the assistant's changes so far are the user's. */
export function keepAll(state: Checkpoints, projectId: string): Checkpoints {
  return state.reviews[projectId] ? { ...state, reviews: without(state.reviews, projectId) } : state;
}

/** What waits for review in `current`: null when nothing (none, or the project is back as it was kept). */
export function pendingReview(state: Checkpoints, projectId: string, current: unknown): Review | null {
  const review = state.reviews[projectId];
  return review && current !== null && review.base !== current ? review : null;
}

/** The user has changed the project since the assistant last did (so going back loses their edits too). */
export function editedSince(state: Pick<Checkpoints, "turns">, projectId: string, current: unknown): boolean {
  const last = Object.values(state.turns).findLast((t) => t.projectId === projectId);
  return !!last && current !== null && last.after !== current;
}

/**
 * A project loaded again (reopened, or edited in the background and then opened) is a new object: the
 * documents kept that are the same as it (`same`, by content) become it, so identity works again.
 */
export function adopt(state: Checkpoints, projectId: string, current: unknown, same: (a: unknown, b: unknown) => boolean): Checkpoints {
  let changed = false;
  const swap = (doc: unknown) => {
    if (doc === current || !same(doc, current)) return doc;
    changed = true;
    return current;
  };
  const turns = Object.fromEntries(
    Object.entries(state.turns).map(([id, t]) => [id, t.projectId === projectId ? { ...t, before: swap(t.before), after: swap(t.after) } : t]),
  );
  const review = state.reviews[projectId];
  const reviews = review ? { ...state.reviews, [projectId]: { ...review, base: swap(review.base) } } : state.reviews;
  const restore = state.restores[projectId];
  const restores = restore ? { ...state.restores, [projectId]: { ...restore, doc: swap(restore.doc), redo: swap(restore.redo) } } : state.restores;
  return changed ? { turns, reviews, restores } : state;
}

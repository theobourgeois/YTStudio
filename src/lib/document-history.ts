/**
 * Undo for any suite's document: the state (`DocumentHistory`) and its steps, all pure, so a suite's
 * store only has to keep one and call these. The rules are the video editor's (`stores/editor.ts`,
 * which predates this and still has its own copy):
 *
 * - an edit is a pure `(doc) => doc` that returns the same instance when nothing changed, which is
 *   how no-ops stay out of the undo stack;
 * - a continuous edit (a drag, typing) is a gesture: `beginGesture`, `preview` any number of times,
 *   then `endGesture` (one undo step) or `cancelGesture`.
 */

export interface DocumentHistory<D> {
  doc: D;
  past: D[];
  future: D[];
  /** The document as the gesture in progress found it, or null. */
  gestureBase: D | null;
  /** Counts gestures, so one that's been overtaken can't end another. */
  gestureId: number;
}

export const HISTORY_LIMIT = 200;

export const historyOf = <D>(doc: D): DocumentHistory<D> => ({ doc, past: [], future: [], gestureBase: null, gestureId: 0 });

export const canUndo = <D>(h: DocumentHistory<D>) => h.past.length > 0 && !h.gestureBase;
export const canRedo = <D>(h: DocumentHistory<D>) => h.future.length > 0 && !h.gestureBase;

/** Typed arrays (a photo's selection mask: megabytes) are never edited in place, so they're compared by identity. */
const arrayIds = new WeakMap<object, number>();
let nextArrayId = 0;
const byIdentity = (_key: string, value: unknown) => {
  if (!ArrayBuffer.isView(value)) return value;
  let id = arrayIds.get(value);
  if (id === undefined) arrayIds.set(value, (id = ++nextArrayId));
  return `#array${id}`;
};
const sameContent = (a: unknown, b: unknown) => a === b || JSON.stringify(a, byIdentity) === JSON.stringify(b, byIdentity);

/** Finish the gesture as one undo step (or as nothing, if it changed nothing). With an id, only if it's still that gesture. */
export function endGesture<D>(h: DocumentHistory<D>, id?: number): DocumentHistory<D> {
  if (!h.gestureBase || (id !== undefined && id !== h.gestureId)) return h;
  if (sameContent(h.gestureBase, h.doc)) return { ...h, doc: h.gestureBase, gestureBase: null };
  return { ...h, gestureBase: null, past: [...h.past, h.gestureBase].slice(-HISTORY_LIMIT), future: [] };
}

/** Apply an edit as one undoable step. One arriving mid-gesture ends the gesture first. */
export function commit<D>(history: DocumentHistory<D>, update: (doc: D) => D): DocumentHistory<D> {
  const h = endGesture(history);
  const next = update(h.doc);
  if (next === h.doc) return h;
  return { ...h, doc: next, past: [...h.past, h.doc].slice(-HISTORY_LIMIT), future: [] };
}

export function beginGesture<D>(history: DocumentHistory<D>): DocumentHistory<D> {
  const h = endGesture(history);
  return { ...h, gestureBase: h.doc, gestureId: h.gestureId + 1 };
}

/** A live update during a gesture, not recorded on its own. Nothing happens without a gesture. */
export function preview<D>(h: DocumentHistory<D>, update: (doc: D) => D): DocumentHistory<D> {
  if (!h.gestureBase) return h;
  const next = update(h.doc);
  return next === h.doc ? h : { ...h, doc: next };
}

/** Drop the gesture: the document is as it found it. */
export function cancelGesture<D>(h: DocumentHistory<D>, id?: number): DocumentHistory<D> {
  if (!h.gestureBase || (id !== undefined && id !== h.gestureId)) return h;
  return { ...h, doc: h.gestureBase, gestureBase: null };
}

export function undo<D>(h: DocumentHistory<D>): DocumentHistory<D> {
  if (!canUndo(h)) return h;
  return { ...h, doc: h.past[h.past.length - 1], past: h.past.slice(0, -1), future: [h.doc, ...h.future] };
}

export function redo<D>(h: DocumentHistory<D>): DocumentHistory<D> {
  if (!canRedo(h)) return h;
  return { ...h, doc: h.future[0], future: h.future.slice(1), past: [...h.past, h.doc] };
}

/**
 * A change that isn't an undoable edit (a rename, media that's gone): made to the document and to
 * every state undo could bring back, so none of them resurrects what it changed.
 */
export function rewrite<D>(h: DocumentHistory<D>, update: (doc: D) => D): DocumentHistory<D> {
  return { ...h, doc: update(h.doc), past: h.past.map(update), future: h.future.map(update), gestureBase: h.gestureBase && update(h.gestureBase) };
}

/** Where a gesture finds the history it edits (a suite's store). */
export interface HistoryHost<D> {
  get(): DocumentHistory<D> | null;
  set(history: DocumentHistory<D>): void;
}

/**
 * A continuous edit recorded as one undo step: `begin`, `apply` any number of times, then `end` or
 * `cancel`. Outside a gesture (or once another edit has ended it), `apply` commits on its own, so
 * keyboard changes work with the same code.
 */
export class DocumentGesture<D> {
  private id: number | null = null;

  constructor(private readonly host: HistoryHost<D>) {}

  /** This gesture is still the document's active one. */
  get active(): boolean {
    const h = this.host.get();
    return this.id !== null && !!h && h.gestureId === this.id && h.gestureBase !== null;
  }

  begin() {
    const h = this.host.get();
    if (!h) return;
    const next = beginGesture(h);
    this.id = next.gestureId;
    this.host.set(next);
  }

  apply(update: (doc: D) => D) {
    const h = this.host.get();
    if (!h) return;
    const next = this.active ? preview(h, update) : commit(h, update);
    if (next !== h) this.host.set(next);
  }

  end() {
    this.finish(endGesture);
  }

  cancel() {
    this.finish(cancelGesture);
  }

  private finish(how: (h: DocumentHistory<D>, id: number) => DocumentHistory<D>) {
    const h = this.host.get();
    if (this.id !== null && h) {
      const next = how(h, this.id);
      if (next !== h) this.host.set(next);
    }
    this.id = null;
  }
}

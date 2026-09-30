import { describe, expect, it } from "vitest";
import {
  DocumentGesture,
  type DocumentHistory,
  HISTORY_LIMIT,
  beginGesture,
  canRedo,
  canUndo,
  cancelGesture,
  commit,
  endGesture,
  historyOf,
  preview,
  redo,
  rewrite,
  undo,
} from "./document-history";

interface Doc {
  name: string;
  n: number;
}
const doc: Doc = { name: "a", n: 0 };
const add = (by: number) => (d: Doc) => (by === 0 ? d : { ...d, n: d.n + by });

describe("document history", () => {
  it("commits edits as undo steps, and no-ops as nothing", () => {
    const start = historyOf(doc);
    const one = commit(start, add(1));
    expect(one.doc.n).toBe(1);
    expect(commit(one, add(0))).toBe(one);
    const back = undo(one);
    expect(back.doc).toBe(doc);
    expect(canUndo(back)).toBe(false);
    expect(redo(back).doc.n).toBe(1);
    // A new edit forgets what could be redone.
    expect(canRedo(commit(back, add(5)))).toBe(false);
    expect(undo(start)).toBe(start);
    expect(redo(one)).toBe(one);
  });

  it("keeps a limited number of steps", () => {
    let h = historyOf(doc);
    for (let i = 0; i < HISTORY_LIMIT + 10; i++) h = commit(h, add(1));
    expect(h.past).toHaveLength(HISTORY_LIMIT);
  });

  it("records a gesture as one step, however many previews", () => {
    let h = beginGesture(commit(historyOf(doc), add(1)));
    h = preview(h, add(1));
    h = preview(h, add(1));
    expect(h.doc.n).toBe(3);
    expect(canUndo(h)).toBe(false);
    h = endGesture(h);
    expect(h.past).toHaveLength(2);
    expect(undo(h).doc.n).toBe(1);
  });

  it("forgets a gesture that's cancelled or changed nothing", () => {
    const base = commit(historyOf(doc), add(1));
    const cancelled = cancelGesture(preview(beginGesture(base), add(4)));
    expect(cancelled.doc).toBe(base.doc);
    expect(cancelled.past).toHaveLength(1);
    // There and back again: equal, so not a step.
    const round = endGesture(preview(preview(beginGesture(base), add(2)), add(-2)));
    expect(round.doc).toBe(base.doc);
    expect(round.past).toHaveLength(1);
    expect(preview(base, add(1))).toBe(base);
  });

  it("ends a gesture when another edit arrives, and ignores a gesture that's been overtaken", () => {
    const first = preview(beginGesture(historyOf(doc)), add(1));
    const committed = commit(first, add(10));
    expect(committed.doc.n).toBe(11);
    expect(committed.past.map((d) => d.n)).toEqual([0, 1]);
    const second = beginGesture(first);
    expect(endGesture(second, first.gestureId)).toBe(second);
    expect(cancelGesture(second, first.gestureId)).toBe(second);
  });

  it("rewrites every state for a change undo mustn't bring back", () => {
    const h = rewrite(commit(commit(historyOf(doc), add(1)), add(1)), (d) => ({ ...d, name: "b" }));
    expect(undo(undo(h)).doc).toEqual({ name: "b", n: 0 });
  });

  it("drives a store through a gesture", () => {
    let state: DocumentHistory<Doc> | null = historyOf(doc);
    const gesture = new DocumentGesture<Doc>({ get: () => state, set: (h) => (state = h) });
    // Outside a gesture, apply commits.
    gesture.apply(add(1));
    expect(state.past).toHaveLength(1);
    gesture.begin();
    expect(gesture.active).toBe(true);
    gesture.apply(add(1));
    gesture.apply(add(1));
    gesture.end();
    expect(gesture.active).toBe(false);
    expect(state.doc.n).toBe(3);
    expect(state.past).toHaveLength(2);
    gesture.begin();
    gesture.apply(add(100));
    gesture.cancel();
    expect(state.doc.n).toBe(3);
  });
});

import { describe, expect, it } from "vitest";
import {
  MAX_CHECKPOINTS,
  NO_CHECKPOINTS,
  adopt,
  checkpointAt,
  editedSince,
  keepAll,
  pendingReview,
  recordChange,
  redoRestore,
  restoreTo,
  restoredUndone,
  undoAll,
} from "./checkpoints";

const doc = (n: number) => ({ n });
const A = doc(0);
const B = doc(1);
const C = doc(2);
const D = doc(3);

// u1 → a1 (A → B), u2 → a2 (nothing), u3 → a3 (B → C → D).
const messages = [
  { id: "u1", role: "user" as const },
  { id: "a1", role: "assistant" as const },
  { id: "u2", role: "user" as const },
  { id: "a2", role: "assistant" as const },
  { id: "u3", role: "user" as const },
  { id: "a3", role: "assistant" as const },
];
const recorded = [
  ["a1", A, B],
  ["a3", B, C],
  ["a3", C, D],
] as const;
const state = recorded.reduce((s, [turn, before, after]) => recordChange(s, turn, "p", before, after), NO_CHECKPOINTS);

describe("checkpoints", () => {
  it("keep each answer's project before its first change and after its last", () => {
    expect(state.turns.a1).toEqual({ projectId: "p", before: A, after: B });
    expect(state.turns.a3.before).toBe(B);
    expect(state.turns.a3.after).toBe(D);
    expect(state.turns.a2).toBeUndefined();
    expect(recordChange(state, "a4", "p", D, D)).toBe(state);
  });

  it("put every message back as the project was when it was sent", () => {
    expect(checkpointAt(state, messages, "u1", "p")).toEqual({ doc: A, turns: ["a1", "a3"] });
    // Nothing changed it between u2 and a3's first change.
    expect(checkpointAt(state, messages, "u2", "p")).toEqual({ doc: B, turns: ["a3"] });
    expect(checkpointAt(state, messages, "u3", "p")?.doc).toBe(B);
    expect(checkpointAt(state, messages, "a3", "p")).toBeNull();
    expect(checkpointAt(state, messages, "u1", "other")).toBeNull();
  });

  it("wait for review since the last Keep: Undo all goes back there", () => {
    expect(pendingReview(state, "p", D)).toEqual({ base: A, turns: ["a1", "a3"] });
    // Undone by hand back to where it was kept: nothing to review.
    expect(pendingReview(state, "p", A)).toBeNull();
    const undone = undoAll(state, "p")!;
    expect(undone.doc).toBe(A);
    expect(pendingReview(undone.state, "p", A)).toBeNull();
    const kept = keepAll(state, "p");
    expect(pendingReview(kept, "p", D)).toBeNull();
    // The next answer starts a new review from where it was kept.
    expect(recordChange(kept, "a5", "p", D, A).reviews.p).toEqual({ base: D, turns: ["a5"] });
  });

  it("restore a checkpoint, and redo it until the project changes", () => {
    const back = restoreTo(state, messages, "u3", "p", D)!;
    expect(back.doc).toBe(B);
    // a1's change still waits; a3's was gone back over.
    expect(pendingReview(back.state, "p", B)).toEqual({ base: A, turns: ["a1"] });
    const redone = redoRestore(back.state, "p")!;
    expect(redone.doc).toBe(D);
    expect(redone.state.reviews.p).toEqual(state.reviews.p);
    expect(redone.state.restores.p).toBeUndefined();
    // ⌘Z does the same.
    expect(restoredUndone(back.state, "p")).toEqual(redone.state);
    // Another change: there's no redo any more.
    expect(recordChange(back.state, "a6", "p", B, C).restores.p).toBeUndefined();
  });

  it("restoring to where it was kept ends the review", () => {
    const back = restoreTo(state, messages, "u1", "p", D)!;
    expect(back.doc).toBe(A);
    expect(back.state.reviews.p).toBeUndefined();
    expect(redoRestore(back.state, "p")!.state.reviews.p).toEqual(state.reviews.p);
    // Already there: nothing to do.
    expect(restoreTo(back.state, messages, "u1", "p", A)).toBeNull();
  });

  it("know when the user edited after the assistant", () => {
    expect(editedSince(state, "p", D)).toBe(false);
    expect(editedSince(state, "p", doc(9))).toBe(true);
    expect(editedSince(state, "q", doc(9))).toBe(false);
  });

  it("take a reloaded project for the one it equals", () => {
    const reloaded = { n: 3 };
    const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
    const next = adopt(state, "p", reloaded, same);
    expect(next.turns.a3.after).toBe(reloaded);
    expect(pendingReview(next, "p", reloaded)).not.toBeNull();
    expect(editedSince(next, "p", reloaded)).toBe(false);
    expect(adopt(next, "p", reloaded, same)).toBe(next);
  });

  it("forget the oldest answers past the limit", () => {
    let s = NO_CHECKPOINTS;
    for (let i = 0; i <= MAX_CHECKPOINTS; i++) s = recordChange(s, `a${i}`, "p", doc(i), doc(i + 1));
    expect(Object.keys(s.turns)).toHaveLength(MAX_CHECKPOINTS);
    expect(s.turns.a0).toBeUndefined();
  });
});

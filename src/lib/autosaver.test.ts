import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createAutosaver } from "./autosaver";

describe("autosaver", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("saves the latest document once the edits pause", async () => {
    const save = vi.fn(async (id: string, doc: number) => `${id}:${doc}`);
    const onSaved = vi.fn();
    const autosaver = createAutosaver({ save, onSaved, debounceMs: 400 });
    autosaver.queue("a", 1);
    await vi.advanceTimersByTimeAsync(300);
    autosaver.queue("a", 2);
    await vi.advanceTimersByTimeAsync(300);
    expect(save).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(100);
    expect(save.mock.calls).toEqual([["a", 2, false]]);
    expect(onSaved).toHaveBeenCalledWith("a:2");
  });

  it("sends one request at a time, then what changed meanwhile", async () => {
    let finish!: () => void;
    const save = vi.fn((_id: string, _doc: number) => new Promise<void>((resolve) => (finish = resolve)));
    const autosaver = createAutosaver({ save, debounceMs: 10 });
    autosaver.queue("a", 1);
    await vi.advanceTimersByTimeAsync(10);
    autosaver.queue("a", 2);
    autosaver.queue("b", 1);
    await vi.advanceTimersByTimeAsync(1000);
    expect(save).toHaveBeenCalledTimes(1);
    finish();
    await vi.advanceTimersByTimeAsync(0);
    expect(save.mock.calls.map(([id, doc]) => [id, doc])).toEqual([
      ["a", 1],
      ["a", 2],
    ]);
  });

  it("retries a failed save, but not one for a project that's gone", async () => {
    const save = vi
      .fn<(id: string, doc: number) => Promise<void>>()
      .mockRejectedValueOnce(new Error("offline"))
      .mockRejectedValueOnce(new Error("gone"))
      .mockResolvedValue();
    vi.spyOn(console, "error").mockImplementation(() => {});
    const autosaver = createAutosaver({ save, isGone: (err) => (err as Error).message === "gone", debounceMs: 10 });
    autosaver.queue("a", 1);
    autosaver.queue("b", 1);
    await vi.advanceTimersByTimeAsync(10);
    expect(save).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(2000);
    expect(save.mock.calls.map(([id]) => id)).toEqual(["a", "b", "a"]);
  });

  it("flushes on demand, forgets a deleted project, and sends everything when the page goes", async () => {
    const save = vi.fn(async () => {});
    const autosaver = createAutosaver({ save, debounceMs: 400 });
    autosaver.queue("a", 1);
    autosaver.queue("b", 2);
    autosaver.discard("a");
    await autosaver.flush();
    expect(save.mock.calls).toEqual([["b", 2, false]]);
    autosaver.queue("c", 3);
    autosaver.saveOnUnload();
    expect(save).toHaveBeenLastCalledWith("c", 3, true);
  });
});

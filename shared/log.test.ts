import { describe, expect, it } from "vitest";
import { PAGE_LOG_LIMITS, logs, pageLogEntries } from "./log.ts";

describe("pageLogEntries", () => {
  it("takes the tab's lines, cutting long text short", () => {
    const entries = pageLogEntries({ entries: [{ level: "warn", scope: "photo render", message: "m".repeat(5000), time: 1, stack: "s".repeat(9000), repeats: 4, extra: true }] });
    expect(entries).toEqual([{ level: "warn", scope: "photo_render", message: "m".repeat(PAGE_LOG_LIMITS.message), time: 1, stack: "s".repeat(PAGE_LOG_LIMITS.stack), repeats: 4 }]);
  });

  it("refuses anything else", () => {
    expect(pageLogEntries(null)).toBeNull();
    expect(pageLogEntries({ entries: "no" })).toBeNull();
    expect(pageLogEntries({ entries: [{ level: "loud", scope: "a", message: "b", time: 1 }] })).toBeNull();
    expect(pageLogEntries({ entries: [{ level: "info", scope: "a", message: "b" }] })).toBeNull();
    expect(pageLogEntries({ entries: [{ level: "info", scope: "a", message: "b", time: 1e20 }] })).toBeNull();
    expect(pageLogEntries({ entries: Array.from({ length: PAGE_LOG_LIMITS.entries + 1 }, () => ({ level: "info", scope: "a", message: "b", time: 1 })) })).toBeNull();
  });

  it("orders the levels", () => {
    expect(logs("error", "info")).toBe(true);
    expect(logs("debug", "info")).toBe(false);
  });
});

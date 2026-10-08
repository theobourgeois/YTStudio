import { mkdtempSync, readFileSync, existsSync, statSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { lineLogger, log, logFile, settleLog, startLogging, writePageLog } from "./log.ts";

const start = (level: "debug" | "info" | "warn" = "info") => {
  const dir = mkdtempSync(path.join(os.tmpdir(), "log-test-"));
  startLogging({ dir, level, console: false });
  return dir;
};
const lines = async () => {
  await settleLog();
  return readFileSync(logFile()!, "utf8").trim().split("\n").map((l) => JSON.parse(l) as Record<string, unknown>);
};

afterEach(() => vi.useRealTimers());

describe("the log", () => {
  it("writes a line of JSON each, from its level up, saying who started it first", async () => {
    start("info");
    log("one").debug("not kept");
    log("one").info("kept", { frames: 3 });
    log("one").error("failed", Object.assign(new Error("disk full"), { code: "ENOSPC" }));
    const [started, info, error] = await lines();
    expect(started).toMatchObject({ level: "info", scope: "app", message: "started", fields: { pid: process.pid } });
    expect(info).toMatchObject({ level: "info", scope: "one", message: "kept", fields: { frames: 3 } });
    expect(error).toMatchObject({ level: "error", message: "failed", error: "disk full", code: "ENOSPC" });
    expect(error.stack).toContain("disk full");
    expect(Date.parse(info.time as string)).not.toBeNaN();
  });

  it("prints only what isn't quiet", async () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), "log-test-"));
    const print = vi.spyOn(console, "log").mockImplementation(() => {});
    startLogging({ dir, level: "info", console: true });
    print.mockClear();
    log("two").info("loud");
    log("two", { quiet: true }).info("in the file only");
    expect(print.mock.calls).toEqual([["[two] loud"]]);
    expect((await lines()).map((l) => l.message)).toContain("in the file only");
    print.mockRestore();
  });

  it("holds a flooding scope to a burst, then says how many it left out", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    start();
    for (let i = 0; i < 150; i++) log("flood").warn(`line ${i}`);
    expect((await lines()).filter((l) => l.scope === "flood")).toHaveLength(100);
    vi.setSystemTime(Date.now() + 11_000);
    log("flood").warn("after");
    expect((await lines()).filter((l) => l.scope === "flood").slice(-2).map((l) => l.message)).toEqual(["50 more lines left out (over 100 in 10 s)", "after"]);
  });

  it("keeps the tab's lines, marked as the tab's", async () => {
    start();
    writePageLog([{ level: "error", scope: "autosave", message: "failed", time: 0, error: "offline", repeats: 3 }]);
    expect((await lines()).at(-1)).toEqual({ time: "1970-01-01T00:00:00.000Z", level: "error", scope: "autosave", from: "tab", message: "failed", error: "offline", repeats: 3 });
  });

  it("splits a program's output into lines, however it arrives", async () => {
    start();
    const take = lineLogger(log("program", { quiet: true }));
    take("first li");
    take(Buffer.from("ne\r\nsecond\n\nthi"));
    take("rd\n");
    expect((await lines()).filter((l) => l.scope === "program").map((l) => l.message)).toEqual(["first line", "second", "third"]);
  });

  it("moves a full file aside and starts another", async () => {
    const dir = start();
    const big = "x".repeat(60_000);
    // In rounds the queue takes (it holds 1 MB), each written before the next.
    const round = async (scope: string) => {
      const before = statSync(logFile()!, { throwIfNoEntry: false })?.size ?? 0;
      for (let i = 0; i < 15; i++) log(scope).info(big);
      await vi.waitFor(() => expect(statSync(logFile()!).size).not.toBe(before), { timeout: 2000 });
    };
    for (let n = 0; n < 6; n++) await round(`big-${n}`);
    expect(existsSync(path.join(dir, "vaudio.1.log"))).toBe(true);
    expect(statSync(path.join(dir, "vaudio.1.log")).size).toBeGreaterThan(4_000_000);
    expect(statSync(logFile()!).size).toBeLessThan(2_000_000);
    expect((await lines()).some((l) => String(l.message).includes("keeping up"))).toBe(false);
  });
});

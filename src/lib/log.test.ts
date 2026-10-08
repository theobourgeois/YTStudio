// @vitest-environment happy-dom
// @vitest-environment-options {"url": "http://localhost:5310/"}
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const fetchMock = vi.fn((_url: string, _init: RequestInit) => Promise.resolve(new Response(null, { status: 204 })));
const sent = () => fetchMock.mock.calls.flatMap(([, init]) => (JSON.parse(init.body as string) as { entries: unknown[] }).entries);

beforeEach(() => {
  vi.resetModules();
  vi.useFakeTimers();
  fetchMock.mockClear();
  vi.stubGlobal("fetch", fetchMock);
  for (const level of ["debug", "info", "warn", "error"] as const) vi.spyOn(console, level).mockImplementation(() => {});
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("the tab's log", () => {
  it("prints every line and sends those from info up together, a repeat counted", async () => {
    const { log } = await import("./log");
    log("autosave").debug("quiet");
    log("autosave").error("failed", new Error("offline"));
    log("autosave").error("failed", new Error("offline"));
    log("preview").warn("slow");
    expect(console.debug).toHaveBeenCalledWith("[autosave] quiet");
    expect(fetchMock).not.toHaveBeenCalled();
    vi.advanceTimersByTime(2000);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(sent()).toEqual([
      expect.objectContaining({ level: "error", scope: "autosave", message: "failed", error: "offline", repeats: 2, stack: expect.stringContaining("offline") }),
      expect.objectContaining({ level: "warn", scope: "preview", message: "slow" }),
    ]);
  });

  it("sends at most a burst a minute, then says how many it left out", async () => {
    const { log } = await import("./log");
    for (let i = 0; i < 130; i++) log("flood").warn(`line ${i}`);
    vi.advanceTimersByTime(2000);
    expect(sent()).toHaveLength(100);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    fetchMock.mockClear();
    vi.advanceTimersByTime(60_000);
    log("flood").warn("after");
    vi.advanceTimersByTime(2000);
    expect(sent().map((e) => (e as { message: string }).message)).toEqual(["30 more lines left out (over 100 a minute)", "after"]);
  });

  it("sends the page's uncaught errors, and what's waiting by beacon as it goes", async () => {
    const beacon = vi.fn(() => true);
    vi.stubGlobal("navigator", { ...navigator, sendBeacon: beacon });
    const { watchPageErrors } = await import("./log");
    watchPageErrors();
    window.dispatchEvent(new ErrorEvent("error", { message: "Uncaught TypeError: x is undefined", error: new TypeError("x is undefined") }));
    window.dispatchEvent(new ErrorEvent("error", { message: "ResizeObserver loop completed with undelivered notifications" }));
    window.dispatchEvent(new Event("pagehide"));
    expect(fetchMock).not.toHaveBeenCalled();
    expect(beacon).toHaveBeenCalledTimes(1);
    const body = JSON.parse(await (beacon.mock.calls[0] as unknown as [string, Blob])[1].text()) as { entries: { scope: string; message: string }[] };
    expect(body.entries).toEqual([expect.objectContaining({ scope: "page", message: "Uncaught TypeError: x is undefined", error: "x is undefined" })]);
  });
});

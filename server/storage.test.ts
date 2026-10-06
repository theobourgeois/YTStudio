import { describe, expect, it } from "vitest";
import { renameRetrying } from "./storage.ts";

const busy = (code: string) => Object.assign(new Error(code), { code });

describe("renameRetrying", () => {
  it.runIf(process.platform === "win32")("tries again while Windows says the file is in use", async () => {
    let calls = 0;
    await renameRetrying("a", "b", async () => {
      if (++calls < 3) throw busy("EPERM");
    });
    expect(calls).toBe(3);
  });

  it("gives up on other errors at once", async () => {
    let calls = 0;
    await expect(
      renameRetrying("a", "b", async () => {
        calls++;
        throw busy("ENOENT");
      }),
    ).rejects.toThrow("ENOENT");
    expect(calls).toBe(1);
  });

  it.runIf(process.platform === "win32")("gives up after about a second", async () => {
    let calls = 0;
    await expect(
      renameRetrying("a", "b", async () => {
        calls++;
        throw busy("EBUSY");
      }),
    ).rejects.toThrow("EBUSY");
    expect(calls).toBe(11);
  });
});

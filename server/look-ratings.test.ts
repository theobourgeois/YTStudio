import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { LookRatings } from "./look-ratings.ts";

let dir: string;
beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), "look-ratings-"));
});
afterEach(async () => {
  await fs.rm(dir, { recursive: true, force: true });
});

describe("LookRatings", () => {
  it("keeps every rating, in order, across a restart", async () => {
    const file = path.join(dir, "look-ratings.json");
    const store = new LookRatings(file);
    expect(await store.list()).toEqual([]);
    const love = await store.add({ look: "nebula", verdict: "love", seconds: 6, mood: { character: "chill", intensity: 0.3, slow: 0 } });
    expect(love).toMatchObject({ look: "nebula", verdict: "love", mood: { character: "chill" } });
    expect(love.at).toBeGreaterThan(0);
    await Promise.all([store.add({ look: "halo", verdict: "bin", seconds: 2 }), store.add({ look: "halo", verdict: "skip", seconds: 3 })]);
    const again = await new LookRatings(file).list();
    expect(again.map((r) => `${r.look} ${r.verdict}`)).toEqual(["nebula love", "halo bin", "halo skip"]);
  });

  it("refuses what isn't a rating, and keeps what is of a file that's partly wrong", async () => {
    const file = path.join(dir, "look-ratings.json");
    await fs.writeFile(file, JSON.stringify({ version: 1, ratings: [{ look: "halo", verdict: "bin", at: 1, seconds: 0 }, { look: "x", verdict: "nope", at: 2 }, 7] }));
    const store = new LookRatings(file);
    await expect(store.add({ look: "halo", verdict: "meh" })).rejects.toMatchObject({ status: 400 });
    expect((await store.list()).map((r) => r.verdict)).toEqual(["bin"]);
  });
});

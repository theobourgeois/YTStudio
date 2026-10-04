/**
 * What identifies a record is a contract: ids are written into manifests and quoted by the assistant, so a change
 * to what's hashed, or how, would orphan every stored record. These are fixed values. If one of them has to change,
 * it's a schema change (`AUDIO_INTELLIGENCE_SCHEMA`) and the stored records need migrating.
 */
import { describe, expect, it } from "vitest";
import { hashJson, sha256 } from "../hash.ts";
import { createArtifact } from "./artifact.ts";
import { idempotencyKey } from "./job.ts";
import { AUDIO_INTELLIGENCE_SCHEMA, PRIVATE_USE } from "./types.ts";

describe("identity is stable", () => {
  it("the schema is 1", () => {
    expect(AUDIO_INTELLIGENCE_SCHEMA).toBe(1);
  });

  it("canonical JSON hashes to a fixed value, whatever the key order", () => {
    expect(hashJson({ b: [1, 2.5, "x"], a: { z: null, y: true } })).toBe("e36f9aaa907c2cb2dbd1d400d8513ff9727255ca0e049dc6224919173315ee62");
    expect(hashJson({ a: { y: true, z: null }, b: [1, 2.5, "x"] })).toBe("e36f9aaa907c2cb2dbd1d400d8513ff9727255ca0e049dc6224919173315ee62");
  });

  it("an artifact's id is a fixed value", () => {
    const artifact = createArtifact({
      contentSha256: sha256("audio"),
      bytes: 100,
      role: "mix",
      format: { sampleRate: 48000, channels: 2, sampleFormat: "float32", frames: 48000 },
      snapshotId: "snap_aaaaaaaaaaaaaaaaaaaa",
      tap: { kind: "master", id: null },
      passage: null,
      render: null,
      derivedFrom: null,
      transforms: [],
      jobId: null,
      recordingFamilyId: null,
      permissions: PRIVATE_USE,
      createdAt: 1,
    });
    expect(artifact.id).toBe("art_2b8755adc8278b14014c");
  });

  it("a job's idempotency key is a fixed value", () => {
    expect(idempotencyKey("render", "proj_1", ["snap_1"], { stems: true })).toBe("e0a774d7b46df2eaeff188422444f10fc90eb6035eea6eea6fb438a2ffc17e5b");
  });
});

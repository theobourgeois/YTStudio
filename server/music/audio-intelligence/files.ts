/**
 * Hashing the files a song stands on, for its snapshot: media and plugins' state. What couldn't be read is said
 * to be missing or unreadable, never skipped, so a snapshot can't look complete when a file wasn't seen.
 */
import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import fs from "node:fs/promises";
import type { FileFacts } from "../../../shared/music/audio-intelligence/snapshot.ts";

const MISSING: FileFacts = { status: "missing", sha256: null, bytes: null };
const UNREADABLE: FileFacts = { status: "unreadable", sha256: null, bytes: null };

/** SHA-256 of a file, streamed (a song's media can be hundreds of megabytes). */
export function hashStream(file: string): Promise<{ sha256: string; bytes: number }> {
  return new Promise((resolve, reject) => {
    const hash = createHash("sha256");
    let bytes = 0;
    const stream = createReadStream(file);
    stream.on("data", (chunk) => {
      hash.update(chunk);
      bytes += chunk.length;
    });
    stream.on("error", reject);
    stream.on("end", () => resolve({ sha256: hash.digest("hex"), bytes }));
  });
}

/**
 * Hashes files, remembering the answer for a file by its path, size and modification time, so capturing a song again
 * reads only what changed. (A file rewritten in place to the same size within the same millisecond would be missed;
 * a snapshot is a record of what was seen, and a render checks the hash again before it uses the file.)
 */
export class FileHasher {
  private readonly known = new Map<string, FileFacts>();
  /** Files actually read, for tests. */
  reads = 0;

  async facts(file: string | null): Promise<FileFacts> {
    if (file === null) return MISSING;
    try {
      const stat = await fs.stat(file);
      if (!stat.isFile()) return UNREADABLE;
      const key = `${file}\u0000${stat.size}\u0000${stat.mtimeMs}`;
      const cached = this.known.get(key);
      if (cached) return cached;
      this.reads++;
      const { sha256, bytes } = await hashStream(file);
      const facts: FileFacts = { status: "hashed", sha256, bytes };
      // A file that changed while it was being read has a hash that belongs to neither version.
      const after = await fs.stat(file);
      if (after.size !== stat.size || after.mtimeMs !== stat.mtimeMs || bytes !== stat.size) return UNREADABLE;
      this.known.set(key, facts);
      return facts;
    } catch (error) {
      return (error as NodeJS.ErrnoException).code === "ENOENT" ? MISSING : UNREADABLE;
    }
  }
}

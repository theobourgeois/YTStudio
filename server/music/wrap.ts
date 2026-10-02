/**
 * Wrap remainder (FL's export option, `docs/fl-studio/export.md`): what rings past a loop's end is folded
 * back onto its start, so the file loops seamlessly. Done in place on the engine's 32-bit float WAVs: the
 * tail (at most the export's longest, 30 s) is read, added into the start (round again if it's longer
 * than the song), and the file cut at the song's end.
 */
import fs from "node:fs/promises";

/** Where a WAV's sound is: its channels, bytes per sample, and its data chunk's offset and length. */
async function layout(handle: fs.FileHandle): Promise<{ channels: number; width: number; float: boolean; data: number; size: number; sizeAt: number }> {
  const head = Buffer.alloc(4096);
  const { bytesRead } = await handle.read(head, 0, head.length, 0);
  let format: { channels: number; width: number; float: boolean } | null = null;
  for (let at = 12; at + 8 <= bytesRead; ) {
    const id = head.toString("ascii", at, at + 4);
    const size = head.readUInt32LE(at + 4);
    const body = at + 8;
    if (id === "fmt ") {
      const tag = head.readUInt16LE(body);
      const float = tag === 3 || (tag === 0xfffe && size >= 26 && head.readUInt16LE(body + 24) === 3);
      format = { channels: head.readUInt16LE(body + 2), width: head.readUInt16LE(body + 14) / 8, float };
    }
    if (id === "data" && format) return { ...format, data: body, size, sizeAt: at + 4 };
    at = body + size + (size % 2);
  }
  throw new Error("Not a WAV file the export wrote.");
}

/** Fold everything past `frames` (the song's length, in samples) back onto the start of `file`, and cut it there. */
export async function wrapTail(file: string, frames: number): Promise<void> {
  const handle = await fs.open(file, "r+");
  try {
    const { channels, width, float, data, size, sizeAt } = await layout(handle);
    if (!float || width !== 4) throw new Error("Wrap remainder needs the engine's 32-bit float WAV.");
    const frameBytes = channels * width;
    const total = Math.floor(size / frameBytes);
    if (total <= frames || frames <= 0) return;
    const tail = Buffer.alloc((total - frames) * frameBytes);
    await handle.read(tail, 0, tail.length, data + frames * frameBytes);
    // Into the start, as many times round as the tail is longer than the song.
    const reach = Math.min(frames, total - frames) * frameBytes;
    const head = Buffer.alloc(reach);
    await handle.read(head, 0, reach, data);
    for (let at = 0; at < tail.length; at += 4) {
      const into = at % (frames * frameBytes);
      if (into < reach) head.writeFloatLE(head.readFloatLE(into) + tail.readFloatLE(at), into);
    }
    await handle.write(head, 0, reach, data);
    const kept = frames * frameBytes;
    await handle.truncate(data + kept);
    const sizes = Buffer.alloc(4);
    sizes.writeUInt32LE(kept, 0);
    await handle.write(sizes, 0, 4, sizeAt);
    sizes.writeUInt32LE(data + kept - 8, 0);
    await handle.write(sizes, 0, 4, 4);
  } finally {
    await handle.close();
  }
}

/**
 * A take whose recording the engine didn't finish (it died: a plugin crashed it): its WAV's header still
 * says what it said when the file was opened (no sound, or a size it never reached). What was written is
 * on the disk, so the header is made to say so: its data chunk as long as the file, whole frames.
 */
import fs from "node:fs/promises";

/** Fix a WAV's sizes from its length; answers with its frames, channels and rate (null: not a WAV it can mend). */
export async function repairWav(file: string): Promise<{ frames: number; channels: number; sampleRate: number } | null> {
  const handle = await fs.open(file, "r+");
  try {
    const { size: length } = await handle.stat();
    const head = Buffer.alloc(Math.min(length, 8192));
    await handle.read(head, 0, head.length, 0);
    if (head.length < 12 || head.toString("ascii", 0, 4) !== "RIFF" || head.toString("ascii", 8, 12) !== "WAVE") return null;
    let format: { channels: number; sampleRate: number; bytes: number } | null = null;
    for (let at = 12; at + 8 <= head.length; ) {
      const id = head.toString("ascii", at, at + 4);
      const size = head.readUInt32LE(at + 4);
      const body = at + 8;
      if (id === "fmt ") format = { channels: head.readUInt16LE(body + 2), sampleRate: head.readUInt32LE(body + 4), bytes: head.readUInt16LE(body + 12) };
      if (id === "data" && format && format.bytes > 0) {
        const frames = Math.floor((length - body) / format.bytes);
        const data = frames * format.bytes;
        const sizes = Buffer.alloc(4);
        sizes.writeUInt32LE(data, 0);
        await handle.write(sizes, 0, 4, at + 4);
        sizes.writeUInt32LE(body + data - 8, 0);
        await handle.write(sizes, 0, 4, 4);
        if (body + data < length) await handle.truncate(body + data);
        return { frames, channels: format.channels, sampleRate: format.sampleRate };
      }
      // A data chunk's size can't be trusted here (it's what's being mended), but any other's can.
      at = body + size + (size % 2);
    }
    return null;
  } finally {
    await handle.close();
  }
}

/**
 * The photo helper: the only code that parses image files (docs/photo/architecture.md, "Where the work
 * happens"). It runs as a process of its own so a malformed file can crash it, not the app (in the desktop app
 * the server runs in Electron's main process). Plain JavaScript, so Node (or Electron in Node mode) runs it as it
 * is; the desktop build bundles it with sharp beside it (scripts/desktop.ts).
 *
 * Protocol: one JSON request per line on stdin, `{ id, cmd, ...args }`; one JSON reply per line on stdout,
 * `{ id, ok: true, result }` or `{ id, ok: false, error }`. Pixels never cross the pipe: they're files.
 * It quits when stdin closes, once the requests it has are answered.
 *
 * sharp's defaults are wrong for us (measured, docs/photo/foundations-prototype.md): it converts embedded
 * profiles to sRGB and clips, its 16-bit path drops the profile, and raw 16-bit output needs `rgb16`. So
 * decoding reads the file's stored samples (`ignoreIcc`) and hands the profile back separately; the GPU
 * converts colour.
 */
import fs from "node:fs/promises";
import { createInterface } from "node:readline";
import sharp from "sharp";

sharp.cache(false);

const DECODER = `sharp ${sharp.versions.sharp} / libvips ${sharp.versions.vips}`;
const MAX_PIXELS = 400_000_000;

const send = (message) => process.stdout.write(`${JSON.stringify(message)}\n`);

function open(file, options = {}) {
  return sharp(file, { limitInputPixels: MAX_PIXELS, failOn: "error", ...options });
}

/** What a file is: its upright size, depth, alpha and profile. */
async function probe({ file }) {
  const meta = await open(file).metadata();
  const bits = sampleBits(meta.depth);
  if (meta.space === "cmyk") throw new Error("CMYK images aren't supported yet.");
  return {
    width: meta.autoOrient?.width ?? meta.width,
    height: meta.autoOrient?.height ?? meta.height,
    bits,
    hasAlpha: Boolean(meta.hasAlpha),
    format: meta.format,
    orientation: meta.orientation ?? 1,
    icc: meta.icc ? Buffer.from(meta.icc).toString("base64") : null,
  };
}

function sampleBits(depth) {
  if (depth === "uchar" || depth === "char") return 8;
  if (depth === "ushort" || depth === "short") return 16;
  throw new Error(`Images with ${depth} samples aren't supported yet.`);
}

/** The upright stored samples as RGBA at the file's depth (greyscale becomes RGB; no colour conversion). */
async function storedPixels(file, bits) {
  let image = open(file, { ignoreIcc: true }).autoOrient();
  image = bits === 16 ? image.toColourspace("rgb16") : image.toColourspace("srgb");
  return image.ensureAlpha().raw({ depth: bits === 16 ? "ushort" : "uchar" }).toBuffer({ resolveWithObject: true });
}

async function writeAtomically(file, write) {
  const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
  try {
    await write(tmp);
    await fs.rename(tmp, file);
  } catch (error) {
    await fs.rm(tmp, { force: true });
    throw error;
  }
}

/**
 * Decode `file` into `out`: tile-major RGBA (see `SourceLayout` in shared/photo/lab.ts), edge tiles padded
 * with zeros; `preview` gets a small RGBA8 sRGB picture. Returns the layout's fields.
 */
async function decode({ file, out, preview, tile, previewSize = 1024 }) {
  const started = performance.now();
  const info = await probe({ file });
  const { data, info: raw } = await storedPixels(file, info.bits);
  if (raw.channels !== 4) throw new Error(`Expected RGBA, got ${raw.channels} channels`);
  const { width, height } = raw;
  const bytesPerSample = info.bits / 8;
  const pixelBytes = 4 * bytesPerSample;
  const tilesX = Math.ceil(width / tile);
  const tilesY = Math.ceil(height / tile);
  const tileBytes = tile * tile * pixelBytes;
  const rowBytes = width * pixelBytes;
  await writeAtomically(out, async (tmp) => {
    const handle = await fs.open(tmp, "w");
    try {
      // One band of tile rows at a time: every tile in the band, row by row.
      const band = Buffer.alloc(tilesX * tileBytes);
      for (let ty = 0; ty < tilesY; ty++) {
        band.fill(0);
        const rows = Math.min(tile, height - ty * tile);
        for (let tx = 0; tx < tilesX; tx++) {
          const cols = Math.min(tile, width - tx * tile);
          for (let r = 0; r < rows; r++) {
            const from = (ty * tile + r) * rowBytes + tx * tile * pixelBytes;
            data.copy(band, tx * tileBytes + r * tile * pixelBytes, from, from + cols * pixelBytes);
          }
        }
        await handle.write(band, 0, band.length);
      }
      await handle.sync();
    } finally {
      await handle.close();
    }
  });
  const small = await open(file)
    .autoOrient()
    .resize({ width: previewSize, height: previewSize, fit: "inside", withoutEnlargement: true })
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  await writeAtomically(preview, (tmp) => fs.writeFile(tmp, small.data));
  return {
    decoder: DECODER,
    width,
    height,
    bits: info.bits,
    hasAlpha: info.hasAlpha,
    icc: info.icc,
    tile,
    tilesX,
    tilesY,
    tileBytes,
    preview: { width: small.info.width, height: small.info.height },
    decodeMs: Math.round(performance.now() - started),
  };
}

/** Encode raw RGBA (or RGB) sRGB-encoded samples from `raw` into `out`, at 8 or 16 bits. */
async function encode({ raw, out, width, height, channels, bits, format, quality = 92 }) {
  const started = performance.now();
  const bytes = await fs.readFile(raw);
  const expected = width * height * channels * (bits / 8);
  if (bytes.length !== expected) throw new Error(`Expected ${expected} bytes of samples, got ${bytes.length}`);
  // sharp takes 16-bit input's depth from a Uint16Array (a Buffer is read as 8-bit, whatever `raw.depth` says).
  let data = bytes;
  if (bits === 16) {
    data = new Uint16Array(bytes.length / 2);
    new Uint8Array(data.buffer).set(bytes);
  }
  let image = sharp(data, { raw: { width, height, channels }, limitInputPixels: MAX_PIXELS });
  // Tagging 8-bit samples sRGB leaves them exact (measured). Tagging 16-bit ones changes them (by up to 25 000 of
  // 65 535, measured on 0.35.5), so 16-bit output stays untagged, which readers take as sRGB.
  image = bits === 16 ? image.toColourspace("rgb16") : image.withIccProfile("srgb");
  if (format === "jpeg") {
    if (bits !== 8) throw new Error("JPEG is 8-bit.");
    image = image.removeAlpha().jpeg({ quality, chromaSubsampling: "4:4:4" });
  } else if (format === "png") {
    image = image.png({ compressionLevel: 6 });
  } else {
    throw new Error(`Unknown format ${format}: use png or jpeg.`);
  }
  await writeAtomically(out, (tmp) => image.toFile(tmp));
  const { size } = await fs.stat(out);
  return { bytes: size, encodeMs: Math.round(performance.now() - started) };
}

/**
 * Both files' stored samples, decoded the same way, compared sample by sample. Pixels transparent in both are
 * counted apart: premultiplied light has no colour where there's no alpha, so theirs isn't kept.
 */
async function compare({ a, b }) {
  const [first, second] = await Promise.all([a, b].map(async (file) => storedPixels(file, (await probe({ file })).bits)));
  if (first.info.width !== second.info.width || first.info.height !== second.info.height) {
    throw new Error(`Sizes differ: ${first.info.width}×${first.info.height} vs ${second.info.width}×${second.info.height}`);
  }
  if (first.info.depth !== second.info.depth) throw new Error("The two files have different bit depths.");
  const samples = ({ data, info }) => (info.depth === "ushort" ? new Uint16Array(data.buffer, data.byteOffset, data.length / 2) : data);
  const x = samples(first);
  const y = samples(second);
  let differing = 0;
  let maxDifference = 0;
  let underTransparent = 0;
  for (let i = 0; i < x.length; i++) {
    const d = Math.abs(x[i] - y[i]);
    if (!d) continue;
    const pixel = i - (i % 4);
    if (x[pixel + 3] === 0 && y[pixel + 3] === 0) {
      underTransparent++;
      continue;
    }
    differing++;
    if (d > maxDifference) maxDifference = d;
  }
  return { width: first.info.width, height: first.info.height, differing, maxDifference, underTransparent };
}

/** What the editor places as it is: anything else (SVG, GIF, AVIF, TIFF…) is made a PNG first. */
const PLACEABLE = new Set(["png", "jpeg", "webp"]);
const MAX_RENDERED_SIDE = 4096;

/**
 * A picture downloaded from the internet, made one the editor places (the Online panel): a PNG, JPEG or WebP of
 * one frame stays as it is (`kept`); otherwise its first frame is written to `out` as a PNG. An SVG is drawn with
 * its longer side `size` pixels (else at least 1024), sharp, not scaled up from its own few.
 */
async function prepare({ file, out, size }) {
  const meta = await open(file).metadata();
  if (meta.space === "cmyk" && meta.format === "jpeg") throw new Error("CMYK images aren't supported yet.");
  if (PLACEABLE.has(meta.format) && !(meta.pages > 1)) return { format: meta.format, kept: true };
  let density;
  if (meta.format === "svg") {
    const side = Math.max(meta.width ?? 0, meta.height ?? 0) || 1;
    const target = Math.min(MAX_RENDERED_SIDE, size ?? Math.max(1024, side));
    density = Math.max(1, Math.min(100_000, (72 * target) / side));
  }
  const image = open(file, density ? { density } : { pages: 1 }).autoOrient().toColourspace("srgb").png({ compressionLevel: 6 });
  await writeAtomically(out, (tmp) => image.toFile(tmp));
  const written = await sharp(out).metadata();
  return { format: "png", kept: false, width: written.width, height: written.height };
}

const COMMANDS = {
  version: async () => ({ decoder: DECODER }),
  probe,
  decode,
  encode,
  compare,
  prepare,
  // For the supervisor's tests: die mid-request, as a crash would.
  crash: async () => process.exit(70),
};

let inFlight = 0;
let closing = false;
const lines = createInterface({ input: process.stdin });
lines.on("line", async (line) => {
  inFlight++;
  let id = null;
  try {
    const request = JSON.parse(line);
    id = request.id;
    const command = COMMANDS[request.cmd];
    if (!command) throw new Error(`Unknown command ${request.cmd}`);
    send({ id, ok: true, result: await command(request) });
  } catch (error) {
    send({ id, ok: false, error: error instanceof Error ? error.message : String(error) });
  } finally {
    inFlight--;
    if (closing && inFlight === 0) process.exit(0);
  }
});
lines.on("close", () => {
  closing = true;
  if (inFlight === 0) process.exit(0);
});

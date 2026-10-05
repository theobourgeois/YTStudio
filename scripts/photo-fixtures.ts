/**
 * Writes the photo suite's test and benchmark images (docs/photo/) and a `manifest.json` saying what each one is
 * and what it must decode to. Every picture is computed (noise from a seeded PRNG, never Math.random), so the
 * pixels are the same on every run, and with this sharp the bytes are too.
 *
 * A file already there whose manifest entry matches it (same recipe, same SHA-256) is kept, so the big ones
 * aren't remade; --force makes them again.
 *
 *   pnpm tsx scripts/photo-fixtures.ts [--out data/photo-fixtures] [--only name,name] [--skip-large] [--force]
 *
 * Two things sharp 0.35 does that the code below works around:
 * - 16-bit raw input takes its depth from the typed array: a Buffer is read as 8-bit whatever `raw.depth` says,
 *   so 16-bit pixels go in as a Uint16Array (and come back with `.toColourspace("rgb16").raw({ depth: "ushort" })`).
 * - `withIccProfile` converts the pixels, so a profile is attached to unconverted values by writing the PNG's
 *   `iCCP` chunk ourselves. EXIF orientation only sticks through `withMetadata({ orientation })` (`withExif`'s
 *   Orientation is written as 1), and that also tags the file sRGB.
 */
import { createHash } from "node:crypto";
import { createReadStream, existsSync } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import { crc32, deflateSync } from "node:zlib";
import sharp from "sharp";

const ROOT = path.resolve(import.meta.dirname, "..");
const args = process.argv.slice(2);
const option = (name: string): string | undefined => {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : undefined;
};
const OUT_DIR = path.resolve(ROOT, option("--out") ?? "data/photo-fixtures");
const ONLY = option("--only")?.split(",").map((name) => name.trim()).filter(Boolean);
const SKIP_LARGE = args.includes("--skip-large");
const FORCE = args.includes("--force");

type Profile = "none" | "srgb" | "display-p3";

/** What a fixture's maker reports; the file's size and hash are added by the runner. */
interface Described {
  width: number;
  height: number;
  uprightWidth: number;
  uprightHeight: number;
  bitDepth: 8 | 16;
  channels: 3 | 4;
  hasAlpha: boolean;
  profile: Profile;
  orientation: number;
  expected?: unknown;
}

interface Entry extends Described {
  name: string;
  file: string;
  /** Bumped when a fixture's recipe changes, so an old file isn't kept. */
  recipe: number;
  description: string;
  bytes: number;
  sha256: string;
}

interface Fixture {
  name: string;
  recipe: number;
  large?: boolean;
  description: string;
  make: (file: string) => Promise<Described>;
}

// ---------------------------------------------------------------------------------------------------------------
// Helpers

/** mulberry32: a small seeded PRNG giving 32-bit integers. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return (t ^ (t >>> 14)) >>> 0;
  };
}

const clampByte = (value: number): number => (value < 0 ? 0 : value > 255 ? 255 : Math.round(value));

/** HSV (h in turns, s and v 0..1) to 8-bit RGB. */
function hsv(h: number, s: number, v: number): [number, number, number] {
  const k = (n: number) => (n + h * 6) % 6;
  const f = (n: number) => v - v * s * Math.max(0, Math.min(k(n), 4 - k(n), 1));
  return [clampByte(f(5) * 255), clampByte(f(3) * 255), clampByte(f(1) * 255)];
}

async function sha256File(file: string): Promise<string> {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(file)) hash.update(chunk as Buffer);
  return hash.digest("hex");
}

function check(condition: boolean, message: string): void {
  if (!condition) throw new Error(`verification failed: ${message}`);
}

/** Writes through a temporary name, so an interrupted run never leaves a half file under the real one. */
async function writeAtomically(file: string, data: Buffer): Promise<void> {
  const temp = `${file}.partial`;
  await fs.writeFile(temp, data);
  await fs.rename(temp, file);
}

let p3Profile: Buffer | undefined;
/** sharp's built-in Display P3 profile, as the bytes it embeds. */
async function displayP3(): Promise<Buffer> {
  if (!p3Profile) {
    const tagged = await sharp({ create: { width: 1, height: 1, channels: 3, background: "#000" } })
      .withIccProfile("p3")
      .png()
      .toBuffer();
    const icc = (await sharp(tagged).metadata()).icc;
    if (!icc) throw new Error("sharp gave no Display P3 profile");
    p3Profile = icc;
  }
  return p3Profile;
}

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

function pngChunk(type: string, data: Buffer): Buffer {
  const head = Buffer.alloc(8);
  head.writeUInt32BE(data.length, 0);
  head.write(type, 4, "latin1");
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([head.subarray(4), data])) >>> 0, 0);
  return Buffer.concat([head, data, crc]);
}

/**
 * Tags a PNG with an ICC profile without touching its pixels: an `iCCP` chunk right after IHDR (any colour chunk
 * already there is dropped, since iCCP and sRGB/gAMA/cHRM mustn't disagree).
 */
function withIccChunk(png: Buffer, profileName: string, icc: Buffer): Buffer {
  check(png.subarray(0, 8).equals(PNG_SIGNATURE), "not a PNG");
  const chunks: Buffer[] = [PNG_SIGNATURE];
  let offset = 8;
  while (offset < png.length) {
    const length = png.readUInt32BE(offset);
    const type = png.toString("latin1", offset + 4, offset + 8);
    const whole = png.subarray(offset, offset + 12 + length);
    offset += 12 + length;
    if (["iCCP", "sRGB", "gAMA", "cHRM"].includes(type)) continue;
    chunks.push(whole);
    if (type === "IHDR") {
      const data = Buffer.concat([Buffer.from(profileName, "latin1"), Buffer.from([0, 0]), deflateSync(icc)]);
      chunks.push(pngChunk("iCCP", data));
    }
  }
  return Buffer.concat(chunks);
}

/** The stored 8-bit RGB(A) samples of a file, its profile ignored. */
async function storedPixels(file: string): Promise<{ data: Buffer; width: number; channels: number }> {
  const { data, info } = await sharp(file, { ignoreIcc: true }).raw().toBuffer({ resolveWithObject: true });
  return { data, width: info.width, channels: info.channels };
}

// ---------------------------------------------------------------------------------------------------------------
// Fixtures

const NOISE_SIGMA = 25;
const BAND_ROWS = 256;

/**
 * A smooth gradient with seeded Gaussian noise (sigma 25 levels, each channel its own), so JPEG has real detail to
 * code and decoding costs what a camera's photo does. The pixels are made a band of rows at a time into the one
 * buffer sharp encodes from (sharp would gather a stream into a buffer anyway).
 */
function noiseFixture(name: string, width: number, height: number, seed: number, large: boolean): Fixture {
  return {
    name,
    recipe: 1,
    large,
    description: `${width}×${height} gradient + seeded Gaussian noise (σ ${NOISE_SIGMA}), JPEG q92, untagged`,
    async make(file) {
      const rng = mulberry32(seed);
      // Gaussian noise from a table of 65 536 Box–Muller draws, indexed by the PRNG: fast and repeatable.
      const table = new Int16Array(65536);
      for (let i = 0; i < table.length; i += 2) {
        const u = (rng() + 1) / 4294967297;
        const v = rng() / 4294967296;
        const r = Math.sqrt(-2 * Math.log(u)) * NOISE_SIGMA;
        table[i] = Math.round(r * Math.cos(2 * Math.PI * v));
        table[i + 1] = Math.round(r * Math.sin(2 * Math.PI * v));
      }
      const red = new Float64Array(width);
      for (let x = 0; x < width; x++) red[x] = 30 + (200 * x) / (width - 1);
      const pixels = Buffer.allocUnsafe(width * height * 3);
      for (let top = 0; top < height; top += BAND_ROWS) {
        const bottom = Math.min(height, top + BAND_ROWS);
        for (let y = top; y < bottom; y++) {
          const green = 40 + (180 * y) / (height - 1);
          let o = y * width * 3;
          for (let x = 0; x < width; x++) {
            const blue = 128 + 90 * Math.sin((x / width + y / height) * Math.PI * 2);
            const bits = rng();
            const extra = rng();
            pixels[o++] = clampByte(red[x] + table[bits & 0xffff]);
            pixels[o++] = clampByte(green + table[bits >>> 16]);
            pixels[o++] = clampByte(blue + table[extra & 0xffff]);
          }
        }
      }
      const temp = `${file}.partial.jpg`;
      await sharp(pixels, { raw: { width, height, channels: 3 }, limitInputPixels: false })
        .jpeg({ quality: 92 })
        .toFile(temp);
      await fs.rename(temp, file);
      const meta = await sharp(file, { limitInputPixels: false }).metadata();
      check(meta.width === width && meta.height === height, `${name} is ${meta.width}×${meta.height}`);
      check(!meta.icc, `${name} has an ICC profile`);
      return {
        width, height, uprightWidth: width, uprightHeight: height,
        bitDepth: 8, channels: 3, hasAlpha: false, profile: "none", orientation: 1,
      };
    },
  };
}

/** Stored-value patches (each 64×64, left to right) tagged Display P3 without converting them. */
function p3Fixture(name: string, patches: [number, number, number][], recipe: number): Fixture {
  const size = 64;
  const width = size * patches.length;
  return {
    name,
    recipe,
    description: `${width}×${size} stored ${patches.map((p) => `(${p.join(",")})`).join(" ")}, tagged Display P3, not converted`,
    async make(file) {
      const pixels = Buffer.alloc(width * size * 3);
      for (let y = 0; y < size; y++) {
        for (let x = 0; x < width; x++) pixels.set(patches[Math.floor(x / size)], (y * width + x) * 3);
      }
      const plain = await sharp(pixels, { raw: { width, height: size, channels: 3 } }).png().toBuffer();
      const icc = await displayP3();
      await writeAtomically(file, withIccChunk(plain, "Display P3", icc));
      const meta = await sharp(file).metadata();
      check(!!meta.icc && meta.icc.equals(icc), `${name}'s profile isn't sharp's Display P3`);
      const stored = await storedPixels(file);
      patches.forEach((patch, i) => {
        const o = (32 * width + i * size + 32) * stored.channels;
        const got = [...stored.data.subarray(o, o + 3)];
        check(got.join() === patch.join(), `${name} patch ${i} reads ${got} not ${patch}`);
      });
      return {
        width, height: size, uprightWidth: width, uprightHeight: size,
        bitDepth: 8, channels: 3, hasAlpha: false, profile: "display-p3", orientation: 1,
        expected: {
          stored: patches.map((rgb, i) => ({ x: i * size, y: 0, width: size, height: size, rgb })),
          profileBytes: icc.length,
          profileSha256: createHash("sha256").update(icc).digest("hex"),
        },
      };
    },
  };
}

const RAMP_WIDTH = 4096;
const RAMP_HEIGHT = 64;

const ramp16: Fixture = {
  name: "ramp-16bit.png",
  recipe: 1,
  description: "4096×64 grey ramp, 16 bits: column x is round(x·65535/4095)",
  async make(file) {
    const level = (x: number) => Math.round((x * 65535) / (RAMP_WIDTH - 1));
    const samples = new Uint16Array(RAMP_WIDTH * RAMP_HEIGHT * 3);
    for (let y = 0; y < RAMP_HEIGHT; y++) {
      for (let x = 0; x < RAMP_WIDTH; x++) samples.fill(level(x), (y * RAMP_WIDTH + x) * 3, (y * RAMP_WIDTH + x) * 3 + 3);
    }
    // The Uint16Array itself, not its bytes: sharp takes the depth from the array's type.
    const png = await sharp(samples, { raw: { width: RAMP_WIDTH, height: RAMP_HEIGHT, channels: 3 } })
      .toColourspace("rgb16")
      .png()
      .toBuffer();
    await writeAtomically(file, png);
    check((await sharp(file).metadata()).depth === "ushort", "ramp-16bit.png isn't 16-bit");
    const { data } = await sharp(file).toColourspace("rgb16").raw({ depth: "ushort" }).toBuffer({ resolveWithObject: true });
    const back = new Uint16Array(data.buffer, data.byteOffset, data.length / 2);
    for (let i = 0; i < back.length; i++) {
      const x = Math.floor(i / 3) % RAMP_WIDTH;
      check(back[i] === level(x), `ramp-16bit.png sample ${i} reads ${back[i]} not ${level(x)}`);
    }
    return {
      width: RAMP_WIDTH, height: RAMP_HEIGHT, uprightWidth: RAMP_WIDTH, uprightHeight: RAMP_HEIGHT,
      bitDepth: 16, channels: 3, hasAlpha: false, profile: "none", orientation: 1,
      expected: { column: "round(x * 65535 / 4095)", channelsEqual: true },
    };
  },
};

const ramp8: Fixture = {
  name: "ramp-8bit.png",
  recipe: 1,
  description: "4096×64 grey ramp, 8 bits: column x is round(x·255/4095)",
  async make(file) {
    const level = (x: number) => Math.round((x * 255) / (RAMP_WIDTH - 1));
    const pixels = Buffer.alloc(RAMP_WIDTH * RAMP_HEIGHT * 3);
    for (let y = 0; y < RAMP_HEIGHT; y++) {
      for (let x = 0; x < RAMP_WIDTH; x++) pixels.fill(level(x), (y * RAMP_WIDTH + x) * 3, (y * RAMP_WIDTH + x) * 3 + 3);
    }
    await writeAtomically(file, await sharp(pixels, { raw: { width: RAMP_WIDTH, height: RAMP_HEIGHT, channels: 3 } }).png().toBuffer());
    const stored = await storedPixels(file);
    check(stored.data.equals(pixels), "ramp-8bit.png doesn't read back as written");
    return {
      width: RAMP_WIDTH, height: RAMP_HEIGHT, uprightWidth: RAMP_WIDTH, uprightHeight: RAMP_HEIGHT,
      bitDepth: 8, channels: 3, hasAlpha: false, profile: "none", orientation: 1,
      expected: { column: "round(x * 255 / 4095)", channelsEqual: true },
    };
  },
};

const alphaGradient: Fixture = {
  name: "alpha-gradient.png",
  recipe: 1,
  description: "512×512 RGBA: hue sweep across, alpha 0..255 down (row 0 fully transparent)",
  async make(file) {
    const size = 512;
    const pixels = Buffer.alloc(size * size * 4);
    for (let y = 0; y < size; y++) {
      const alpha = Math.round((y * 255) / (size - 1));
      for (let x = 0; x < size; x++) {
        const o = (y * size + x) * 4;
        pixels.set(hsv(x / size, 1, 1), o);
        pixels[o + 3] = alpha;
      }
    }
    await writeAtomically(file, await sharp(pixels, { raw: { width: size, height: size, channels: 4 } }).png().toBuffer());
    const stored = await storedPixels(file);
    check(stored.channels === 4 && stored.data.equals(pixels), "alpha-gradient.png doesn't read back as written (premultiplied?)");
    return {
      width: size, height: size, uprightWidth: size, uprightHeight: size,
      bitDepth: 8, channels: 4, hasAlpha: true, profile: "none", orientation: 1,
      expected: {
        alpha: "round(y * 255 / 511): row 0 is 0, row 511 is 255",
        colour: "HSV hue x/512, saturation 1, value 1, unpremultiplied (kept under alpha 0 too)",
      },
    };
  },
};

interface Rect { x: number; y: number; width: number; height: number }

/** Where a stored rectangle shows once EXIF orientation 6 is applied (turned 90° clockwise). */
function rotate6(rect: Rect, storedHeight: number): Rect {
  return { x: storedHeight - rect.y - rect.height, y: rect.x, width: rect.height, height: rect.width };
}

const orientation6: Fixture = {
  name: "orientation-6.jpg",
  recipe: 1,
  description: "300×200 stored (red block top-left, blue bar along the bottom, green dot right), EXIF orientation 6",
  async make(file) {
    const width = 300;
    const height = 200;
    const red: Rect = { x: 0, y: 0, width: 80, height: 60 };
    const blue: Rect = { x: 0, y: 170, width: 300, height: 30 };
    const green = { x: 260, y: 100, radius: 15 };
    const inside = (r: Rect, x: number, y: number) => x >= r.x && x < r.x + r.width && y >= r.y && y < r.y + r.height;
    const pixels = Buffer.alloc(width * height * 3);
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const rgb: [number, number, number] = inside(red, x, y) ? [230, 20, 20]
          : inside(blue, x, y) ? [20, 40, 230]
          : Math.hypot(x + 0.5 - green.x, y + 0.5 - green.y) <= green.radius ? [20, 200, 40]
          : [235, 235, 235];
        pixels.set(rgb, (y * width + x) * 3);
      }
    }
    const temp = `${file}.partial.jpg`;
    await sharp(pixels, { raw: { width, height, channels: 3 } })
      .withMetadata({ orientation: 6 })
      .jpeg({ quality: 92 })
      .toFile(temp);
    await fs.rename(temp, file);
    const meta = await sharp(file).metadata();
    check(meta.orientation === 6, `orientation-6.jpg has orientation ${meta.orientation}`);
    check(meta.autoOrient.width === height && meta.autoOrient.height === width, "orientation-6.jpg isn't 200×300 upright");

    const upright = {
      red: rotate6(red, height),
      blue: rotate6(blue, height),
      green: { x: height - green.y, y: green.x, radius: green.radius },
    };
    // Decode it upright and look at the middle of each mark.
    const { data, info } = await sharp(file).rotate().raw().toBuffer({ resolveWithObject: true });
    const at = (x: number, y: number) => [...data.subarray((y * info.width + x) * 3, (y * info.width + x) * 3 + 3)];
    const centre = (r: Rect) => at(Math.floor(r.x + r.width / 2), Math.floor(r.y + r.height / 2));
    const near = (got: number[], want: number[]) => got.every((v, i) => Math.abs(v - want[i]) < 40);
    check(info.width === height && info.height === width, "orientation-6.jpg decodes upright at the wrong size");
    check(near(centre(upright.red), [230, 20, 20]), `upright red block reads ${centre(upright.red)}`);
    check(near(centre(upright.blue), [20, 40, 230]), `upright blue bar reads ${centre(upright.blue)}`);
    check(near(at(upright.green.x, upright.green.y), [20, 200, 40]), "upright green dot isn't where expected");
    return {
      width, height, uprightWidth: height, uprightHeight: width,
      bitDepth: 8, channels: 3, hasAlpha: false, profile: "srgb", orientation: 6,
      expected: {
        display: "rotate 90° clockwise",
        stored: { red, blue, green },
        upright: { ...upright, summary: "red block top-right, blue bar down the left edge, green dot bottom middle" },
        colours: { red: [230, 20, 20], blue: [20, 40, 230], green: [20, 200, 40], background: [235, 235, 235] },
      },
    };
  },
};

const blurDetail: Fixture = {
  name: "blur-detail.png",
  recipe: 1,
  description: "700×500 RGBA: 7-px checkerboard, thin white lines, a transparent hole, a half-transparent band",
  async make(file) {
    const width = 700;
    const height = 500;
    const cell = 7;
    const colours: [number, number, number][] = [[230, 30, 140], [20, 200, 220]];
    const hole: Rect = { x: 80, y: 300, width: 120, height: 80 };
    const band = { y: 420, height: 40, alpha: 128 };
    const lines = { rows: [150], columns: [500], diagonal: "x == y for y < 300 (1 px)" };
    const pixels = Buffer.alloc(width * height * 4);
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const o = (y * width + x) * 4;
        const white = lines.rows.includes(y) || lines.columns.includes(x) || (x === y && y < 300);
        pixels.set(white ? [255, 255, 255] : colours[(Math.floor(x / cell) + Math.floor(y / cell)) % 2], o);
        const inHole = x >= hole.x && x < hole.x + hole.width && y >= hole.y && y < hole.y + hole.height;
        pixels[o + 3] = inHole ? 0 : y >= band.y && y < band.y + band.height ? band.alpha : 255;
      }
    }
    await writeAtomically(file, await sharp(pixels, { raw: { width, height, channels: 4 } }).png().toBuffer());
    const stored = await storedPixels(file);
    check(stored.channels === 4 && stored.data.equals(pixels), "blur-detail.png doesn't read back as written");
    return {
      width, height, uprightWidth: width, uprightHeight: height,
      bitDepth: 8, channels: 4, hasAlpha: true, profile: "none", orientation: 1,
      expected: {
        checkerboard: { cell, colours, firstCell: colours[0] },
        lines: { ...lines, rgb: [255, 255, 255] },
        hole: { ...hole, alpha: 0, note: "the checkerboard's colours stay under the hole (unpremultiplied)" },
        band: { x: 0, y: band.y, width, height: band.height, alpha: band.alpha },
      },
    };
  },
};

const photoLikeP3: Fixture = {
  name: "photo-like-p3.jpg",
  recipe: 1,
  description: "3000×2000 gradients + a saturated colour wheel, made in sRGB, converted to Display P3, JPEG q90",
  async make(file) {
    const width = 3000;
    const height = 2000;
    const wheel = { x: 1500, y: 1000, radius: 700 };
    const pixels = Buffer.alloc(width * height * 3);
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const u = x / (width - 1);
        const v = y / (height - 1);
        // A sky-to-ground backdrop: blue at the top, warm at the bottom, lighter to the right.
        let r = 40 + 150 * v + 40 * u;
        let g = 90 + 60 * u - 20 * v;
        let b = 210 - 150 * v;
        const dx = x + 0.5 - wheel.x;
        const dy = y + 0.5 - wheel.y;
        const distance = Math.hypot(dx, dy);
        const cover = Math.min(1, Math.max(0, wheel.radius - distance + 0.5));
        if (cover > 0) {
          const [wr, wg, wb] = hsv((Math.atan2(dy, dx) / (2 * Math.PI) + 1) % 1, Math.min(1, distance / wheel.radius), 1);
          r = r * (1 - cover) + wr * cover;
          g = g * (1 - cover) + wg * cover;
          b = b * (1 - cover) + wb * cover;
        }
        const o = (y * width + x) * 3;
        pixels[o] = clampByte(r);
        pixels[o + 1] = clampByte(g);
        pixels[o + 2] = clampByte(b);
      }
    }
    const temp = `${file}.partial.jpg`;
    await sharp(pixels, { raw: { width, height, channels: 3 } })
      .withIccProfile("p3")
      .jpeg({ quality: 90 })
      .toFile(temp);
    await fs.rename(temp, file);
    const meta = await sharp(file).metadata();
    check(!!meta.icc && meta.icc.equals(await displayP3()), "photo-like-p3.jpg isn't tagged with sharp's Display P3");
    check(meta.width === width && meta.height === height, "photo-like-p3.jpg is the wrong size");
    return {
      width, height, uprightWidth: width, uprightHeight: height,
      bitDepth: 8, channels: 3, hasAlpha: false, profile: "display-p3", orientation: 1,
      expected: {
        wheel: { ...wheel, colours: "hue by angle, saturation by radius, value 1 (in sRGB before conversion)" },
        gamut: "every colour inside sRGB: converted to sRGB it should match the sRGB original within JPEG error",
      },
    };
  },
};

const FIXTURES: Fixture[] = [
  noiseFixture("noise-48mp.jpg", 8000, 6000, 48, false),
  noiseFixture("noise-100mp.jpg", 12000, 8400, 100, true),
  p3Fixture("p3-green.png", [[0, 255, 0]], 1),
  p3Fixture("p3-patches.png", [[0, 255, 0], [255, 0, 0], [0, 0, 255], [128, 128, 128]], 1),
  ramp16,
  ramp8,
  alphaGradient,
  orientation6,
  blurDetail,
  photoLikeP3,
];

// ---------------------------------------------------------------------------------------------------------------
// Run

const unknown = ONLY?.filter((name) => !FIXTURES.some((f) => f.name === name || f.name.replace(/\.\w+$/, "") === name));
if (unknown?.length) {
  console.error(`Unknown fixture(s): ${unknown.join(", ")}. Known: ${FIXTURES.map((f) => f.name).join(", ")}`);
  process.exit(1);
}

await fs.mkdir(OUT_DIR, { recursive: true });
const manifestFile = path.join(OUT_DIR, "manifest.json");
const previous = new Map<string, Entry>();
if (existsSync(manifestFile)) {
  try {
    const old = JSON.parse(await fs.readFile(manifestFile, "utf8")) as { fixtures?: Entry[] };
    for (const entry of old.fixtures ?? []) previous.set(entry.name, entry);
  } catch {
    // An unreadable manifest just means nothing is kept.
  }
}

const rows: { name: string; status: string; seconds: number; bytes: number }[] = [];
const entries = new Map<string, Entry>();
let failed = false;

for (const fixture of FIXTURES) {
  const file = path.join(OUT_DIR, fixture.name);
  const old = previous.get(fixture.name);
  const wanted = !ONLY || ONLY.some((name) => fixture.name === name || fixture.name.replace(/\.\w+$/, "") === name);
  const skipped = !wanted || (fixture.large && SKIP_LARGE);
  if (skipped) {
    // Keep what's known of a fixture not made this time, as long as its file is still the one described.
    if (old && existsSync(file) && (await fs.stat(file)).size === old.bytes) entries.set(fixture.name, old);
    if (wanted) rows.push({ name: fixture.name, status: "skipped (large)", seconds: 0, bytes: 0 });
    continue;
  }
  const started = performance.now();
  if (!FORCE && old && old.recipe === fixture.recipe && existsSync(file) && (await sha256File(file)) === old.sha256) {
    entries.set(fixture.name, old);
    rows.push({ name: fixture.name, status: "kept", seconds: (performance.now() - started) / 1000, bytes: old.bytes });
    continue;
  }
  try {
    const described = await fixture.make(file);
    const bytes = (await fs.stat(file)).size;
    entries.set(fixture.name, {
      name: fixture.name,
      file: fixture.name,
      recipe: fixture.recipe,
      description: fixture.description,
      ...described,
      bytes,
      sha256: await sha256File(file),
    });
    rows.push({ name: fixture.name, status: "made", seconds: (performance.now() - started) / 1000, bytes });
  } catch (error) {
    failed = true;
    rows.push({ name: fixture.name, status: "FAILED", seconds: (performance.now() - started) / 1000, bytes: 0 });
    console.error(`${fixture.name}: ${error instanceof Error ? error.message : String(error)}`);
  }
}

const fixtures = FIXTURES.flatMap((f) => entries.get(f.name) ?? []);
await fs.writeFile(manifestFile, `${JSON.stringify({ version: 1, fixtures }, null, 2)}\n`);

const size = (bytes: number) => (bytes >= 1e6 ? `${(bytes / 1e6).toFixed(1)} MB` : `${(bytes / 1e3).toFixed(1)} kB`);
const width = Math.max(...rows.map((row) => row.name.length));
for (const row of rows) {
  const entry = entries.get(row.name);
  const dims = entry ? `${entry.width}×${entry.height}` : "";
  console.log(
    `${row.name.padEnd(width)}  ${row.status.padEnd(15)} ${row.seconds.toFixed(2).padStart(7)} s  ` +
      `${(row.bytes ? size(row.bytes) : "").padStart(9)}  ${dims}`,
  );
}
console.log(`\n${fixtures.length} fixtures in ${OUT_DIR}`);
if (failed) process.exit(1);

# Engine options and the decision

Researched 2026-10-03; decided and measured 2026-10-05. The first version of this document recommended a separate
C++20 engine with Dawn (native WebGPU). This version replaces that with WebGPU in the page. What changed was
measuring it on our own stack, Electron 44.5 and the Chromium the export already uses, on Théo's M5 Pro, instead of
reasoning about it.

## The decision

**Render and paint in the page with WebGPU (WGSL kernels).** Decode and encode files in a helper process with sharp
(libvips). Keep the document, history and render plan in TypeScript. No native photo engine.

### Why not a native engine

The music suite has a native engine because it must: plugins are native code, and the audio device needs a real-time
thread. Photo has no such need. A native photo engine would have cost:

- **Getting pixels into the page.** This was the plan's riskiest gate. Electron's `sharedTexture` import is
  experimental, with lifetime and synchronisation rules to prove. The fallback, reading the view back, moves about
  500 MB/s at 1080p60 before copies.
- **Two renderers.** If presentation failed, the plan's fallback was a renderer in the page, with parity between the
  two renderers to maintain forever.
- **A protocol.** Handshakes, engine epochs, binary framing, schemas generated for two languages, and native
  transactions mirrored in TypeScript.
- **A second native build.** CMake, Dawn's size and build time, and a binary to ship and sign.

None of that buys a capability photo needs, now that the page has the same API natively.

### Why WebGPU in the page works

Measured on 2026-10-05 (details in the [evidence log](../foundations-prototype.md#evidence-log)):

- **The features are there.** Electron 44.5 (Chrome 152) has a Metal adapter that isn't a fallback, with `shader-f16`,
  `float32-filterable`, `float32-blendable`, `texture-formats-tier1/2` (read-write `rgba16float` and `rgba32float`
  storage), 16 384-pixel textures and 4 GB buffers, once the device asks for them.
- **It's fast enough for 48 MP.** Uploading 48 MP of `rgba16f` takes 151 ms, and allocating 48 MP of `rgba32f` causes
  no out-of-memory error. A 128 MiB readback takes 25–45 ms (3–5 GB/s); a stroke's 20 tiles take 2 ms.
- **The export has it too.** Headless Chromium 153, launched with the flags `server/gl-browser.ts` already uses, and
  Electron's hidden windows have the same adapter, so exports run the same kernels.
- **Wide-gamut and HDR display are ready.** The canvas accepts `rgba16float` + `display-p3` + `extended` tone mapping,
  so they need no new architecture.
- **WGSL is Dawn's language.** If a native engine is ever needed (the ladder's last rung), the kernels move as they
  are.

### What it costs, and how it's handled

| Cost | Handling |
| --- | --- |
| WebGPU required | Every target machine has it (Metal; D3D12 on Windows x64 since Chrome 113). Without it the photo workspace explains why; other suites are unaffected |
| Memory in a browser process | Our own tile budget and LRU cache; tiles are authoritative on disk, not in the page; tested under a 1 GB budget |
| GPU process crashes | `device.lost` → a new adapter and device, rebuilt from the server. Chrome blocks adapters after repeated crashes; the desktop app turns that off |
| Main-thread contention with React | Measured in F0; the renderer's interface allows moving it into a Worker with `OffscreenCanvas` |
| Browser updates changing results | Our kernels are WGSL we own, and decoding is ours (the helper), so a Chromium update doesn't change a document's pixels beyond float rounding |

## The ladder, if F0 fails

The document, resource formats and kernels' maths survive every step:

1. **WebGL2**, if a WebGPU feature or driver problem is the blocker. The video compositor proves WebGL2 with float
   targets (`EXT_color_buffer_float`) in this app. The cost is no compute shaders: brush, levels and reductions
   become fragment passes.
2. **A native Dawn engine running the same WGSL**, if the page can't meet memory or throughput. That's the original
   plan, with its presentation problem.

Rejected outright:
- **Skia/SkSL**: its runtime effects live inside Skia's own pipeline, and the tiles, graph and history would still be
  ours. Maybe later for vector and text.
- **GEGL**: an architecture reference only.
- **Native Metal only**: not portable.

## Decoding and encoding

| Candidate | What we measured or read | Role |
| --- | --- | --- |
| **sharp 0.35.5** (libvips 8.18.7, lcms 2.19.1) | 48 MP JPEG → raw in 0.23 s; true 16-bit in and out (with `toColourspace("rgb16")`); ICC bytes and orientation in `metadata()`; 17 MB of native libraries; Node-API (no Electron rebuild); Apache-2.0, libvips LGPL-3.0-or-later dynamically linked. Its conversion clips wide gamut and its 16-bit path drops profiles, so we take stored values and convert on the GPU | **The decoder and encoder**, in the helper process |
| macOS `sips` (ImageIO) | Decodes HEIC (sharp's prebuilt can't: HEVC isn't built in), keeping depth (10 → 16-bit) and profile | HEIC on macOS, in the helper, after the foundations |
| The page (`<img>` + `copyExternalImageToTexture`) | Higher than 8 bits but not true 16-bit (f16 of encoded values); unclipped into float textures; `colorSpaceConversion: "none"` gives stored values; `createImageBitmap(blob)` and `ImageDecoder` are 8-bit; no ICC bytes exposed; results follow Chromium's decoders | **Fallback** if packaging sharp fails: covers JPEG, PNG, WebP and AVIF at the foundations' precision, with our own container parsing for ICC |
| ffmpeg (already a dependency) | The local 8.1 build has no lcms; image support aimed at video | Not used for photo |
| LibRaw | RAW extraction; its own conversion is basic by its own description | The RAW milestone, researched then |

Why the helper decodes, rather than the page:
- the exact stored samples at their true depth;
- the profile's bytes;
- a decoder version we pin and record in the cache key, so a browser update can't shift a document's pixels;
- formats the browser lacks (TIFF, and HEIC through `sips`);
- encoders the browser lacks (16-bit PNG and TIFF).

Running it as a separate process means a malformed file crashes the helper, not the desktop app's main process.

## Dependency discipline

- Pin sharp's exact version; the helper's protocol reports it, and it's part of the source cache key.
- The packaged app ships sharp, its `@img` packages and libvips' notices in `extraResources`, unpacked.
- Record binary size, startup time and licences when it's added.
- Changing backend never changes the file format.

# Sources and what's still unverified

First researched 2026-10-03; WebGPU, sharp and the repository were checked and measured 2026-10-05. Links may
redirect as vendors reorganise. Versions must be pinned when used.

## Photoshop

| Source | Supports | Used in |
| --- | --- | --- |
| [Nondestructive editing](https://helpx.adobe.com/photoshop/using/nondestructive-editing.html) | Adjustments, preserved transforms and filters, masks, retouch sampling | Product; Photoshop research |
| [Embedded Smart Objects](https://helpx.adobe.com/photoshop/desktop/create-manage-layers/smart-objects/create-embedded-smart-objects.html) | Embedded content | Photoshop research |
| [Layer opacity and blending](https://helpx.adobe.com/photoshop/using/layer-opacity-blending.html) | Opacity vs fill, Pass Through vs isolated groups | Photoshop research |
| [Layer masks](https://helpx.adobe.com/photoshop/desktop/create-masks/layer-masks/add-layer-masks.html) | Making and editing masks | Photoshop research |
| [Selection refinement](https://helpx.adobe.com/photoshop/desktop/make-selections/refine-modify-selections/refine-your-selection-and-mask.html) | Select and Mask | Photoshop research |
| [Painting tools](https://helpx.adobe.com/photoshop/using/painting-tools.html), [brush presets](https://helpx.adobe.com/photoshop/desktop/apply-painting-techniques/brushes-presets/get-started-with-brush-presets.html), [stroke smoothing](https://helpx.adobe.com/photoshop/desktop/repair-retouch/clean-restore-images/create-smoother-more-polished-brush-strokes-with-stroke-smoothing.html) | Opacity vs flow, preset scopes, smoothing | Photoshop research |
| [Fred Miranda forum: Exposure's controls](https://www.fredmiranda.com/forum/topic/1178708/), [how-to](https://bwillcreative.com/how-to-change-exposure-in-photoshop/) (secondary) | Exposure, Offset and Gamma in linear light; ranges | Adjustments research |
| [Adobe forum: Curves' 16 points](https://community.adobe.com/questions-712/scripting-help-how-to-modify-an-auto-generated-curves-layer-to-have-16-points-1182076), [O'Reilly: working with Curves](https://oreilly.com/library/view/photoshop-cc-the/9781491905593/ch09s05.html) | Curves' points, channels, gestures | Adjustments research |
| [Change profiles](https://helpx.adobe.com/ie/photoshop/desktop/adjust-color/color-profiles/change-color-profile-for-documents.html), [colour settings](https://helpx.adobe.com/uk/photoshop/using/color-settings.html), [bit depth](https://helpx.adobe.com/photoshop/using/bit-depth.html) | Assign vs convert, working spaces, precision | Rendering; Photoshop research |

## WebGPU, Chromium and Electron

| Source | Supports |
| --- | --- |
| [WebGPU spec](https://gpuweb.github.io/gpuweb/) (editor's draft, 2026-09-23): [formats tiers](https://gpuweb.github.io/gpuweb/#texture-formats-tier1), [limits](https://gpuweb.github.io/gpuweb/#limits), [canvas configuration](https://gpuweb.github.io/gpuweb/#canvas-configuration), [writeTexture](https://gpuweb.github.io/gpuweb/#dom-gpuqueue-writetexture), [copyExternalImageToTexture](https://gpuweb.github.io/gpuweb/#dom-gpuqueue-copyexternalimagetotexture), [buffer mapping](https://gpuweb.github.io/gpuweb/#buffer-mapping) | Format capabilities, limits, canvas colour spaces and tone mapping, uploads and readback |
| Chrome's "New in WebGPU" [119](https://developer.chrome.com/blog/new-in-webgpu-119), [120](https://developer.chrome.com/blog/new-in-webgpu-120), [129](https://developer.chrome.com/blog/new-in-webgpu-129), [132](https://developer.chrome.com/blog/new-in-webgpu-132), [142](https://developer.chrome.com/blog/new-in-webgpu-142) | When `float32-filterable`, `shader-f16`, HDR canvas, `float32-blendable` and the format tiers shipped |
| [Implementation status](https://github.com/gpuweb/gpuweb/wiki/Implementation-Status) | Platforms where WebGPU is on by default (Windows x64 since 113) |
| [MDN: GPUDevice.lost](https://developer.mozilla.org/en-US/docs/Web/API/GPUDevice/lost), [toji.dev: device loss](https://toji.dev/webgpu-best-practices/device-loss) (a Chrome WebGPU engineer's notes, secondary) | Recovery; Chrome's crash limits and the switches that lift them |
| [Electron 44.5.0 release](https://releases.electronjs.org/release/v44.5.0), [Electron 44 blog](https://www.electronjs.org/blog/electron-44-0), [BrowserWindow](https://www.electronjs.org/docs/latest/api/browser-window) | Chromium 152, Node 24; hidden windows' visibility and throttling |
| [Electron sharedTexture](https://www.electronjs.org/docs/latest/api/shared-texture) | Why the native route's presentation was risky (experimental) |
| [W3C Compositing and Blending](https://www.w3.org/TR/compositing-1/) | Compositing algebra |

## Images and colour

| Source | Supports |
| --- | --- |
| sharp: [output](https://sharp.pixelplumbing.com/api-output/), [colour](https://sharp.pixelplumbing.com/api-colour/), [input](https://sharp.pixelplumbing.com/api-input/), [install](https://sharp.pixelplumbing.com/install/), [sharp-libvips](https://github.com/lovell/sharp-libvips) | Raw depths, profiles, orientation, formats, Electron packaging, licences |
| [libvips](https://www.libvips.org/), [how it works](https://www.libvips.org/API/current/how-it-works.html) | Region evaluation, formats |
| [ICC.1:2022](https://archive.color.org/specification/ICC.1-2022-05.pdf) (8.4.3, 9.2.15, 9.2.36, 10.6, 10.18, F.3) | Matrix/TRC profiles, `curv`/`para`, `chad`, the conversion |
| [Apple: AVCapturePhotoOutput](https://developer.apple.com/documentation/avfoundation/avcapturephotooutput), [P3_D65](https://developer.apple.com/documentation/avfoundation/avcapturecolorspace/p3_d65) | iPhone wide-colour capture |
| [Little CMS](https://www.littlecms.com/color-engine/), [LibRaw](https://www.libraw.org/about) | LUT profiles; RAW scope |
| [Video Copilot: building a flare](https://video-copilot.gitbook.io/opticalflaresnuke/using-optical-flares-for-nuke/creating-a-lens-flare-from-scratch) | Element-based flares (reference only) |

## Measured here (2026-10-05)

On Apple M5 Pro, 64 GB, macOS 26.5.1:
- WebGPU probes in Electron 44.5.0, Playwright's Chromium 153 (headless shell and new headless) and Chrome 154.
- sharp 0.35.5 decoding, 16-bit, profile and timing tests.
- `sips` on HEIC.
- `createImageBitmap`, `<img>` and `ImageDecoder` precision.
- The macOS ColorSync profiles' tags.

Results are in the [evidence log](../foundations-prototype.md#evidence-log) and [engine options](engine-options.md).
A useful cross-check: the browser's own conversion of Display P3 green into an sRGB float texture gives
(−0.511, 1.018, −0.311). That is the sRGB encoding of our expected linear (−0.2249, 1.0421, −0.0786), sign mirrored.

## Repository evidence (read 2026-10-05)

- Suite contracts: `shared/suites.ts`, `shared/suite-tools.ts`, `server/suites/suite.ts`, `src/suites/types.ts`, their
  registries, and music's implementations.
- Packages: `server/projects.ts` and `server/packages.ts`.
  - `copy` copies a suite's folders whole, without clones.
  - `reId` and `remapMedia` rewrite only the document.
  - `readDocAt` replaces a corrupt document with an empty one.
- `server/storage.ts` `writeJson`: temp and rename, no flush.
- `src/lib/document-history.ts`: 200 entries, a JSON comparison at a gesture's end. `src/lib/autosaver.ts`: debounced,
  serial, retried.
- Media (`server/media.ts`, `server/probe.ts`):
  - ffprobe-based;
  - PNG, JPEG, WebP, GIF and BMP only;
  - no bit depth or profile;
  - video zone.
- `server/architecture.test.ts`: `SUITE_FOLDERS` is hand-written, and unknown folders count as video.
- Electron (`electron/main.ts`, `gl-window.ts`; `scripts/desktop.ts`):
  - pages from `http://127.0.0.1`;
  - sandboxed, `backgroundThrottling: false`;
  - no GPU switches;
  - no `node_modules` shipped;
  - the music engine shipped in `extraResources`.
- `server/process.ts`: runs `.mjs` helpers through Electron in Node mode.
- `shared/effect-library/light.ts` and `shared/effect-gl.ts`: the video's light effects, 8-bit intermediates, clamped
  output.

## Still unverified

- Windows: WebGPU on D3D12, sharp's Windows build, packaging. Nothing was run there.
- Real iPhone HEICs, with gain maps, depth maps and several images.
- Behaviour on a smaller machine than the M5 Pro (stood in for by a lower budget).
- Whether React work on the main thread delays frames (F0).
- Photoshop's exact interactions and shortcuts in a named version: no hands-on comparison yet.
- Whether HDR output actually looks right on screen (accepted by the API; not checked by eye).

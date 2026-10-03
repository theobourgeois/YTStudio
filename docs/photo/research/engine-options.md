# Engine options and recommendation

Researched 2026-10-03. This is an evidence-based design assessment, not benchmark results. No dependency
was installed or native photo backend built during this documentation task.

## Recommendation

Use a separate C++20 engine with owned tile/resource, transaction and scheduling modules. Evaluate
**Dawn/WebGPU + WGSL** first for GPU processing, with small CPU reference kernels. Keep React/TypeScript
for interaction and document semantics. Evaluate libvips for decoding/encoding and Little CMS for ICC
conversion, each behind an adapter. Defer RAW development while preserving a place for its source type.

The decisive test is a real viewport in our packaged Electron app, not a fast standalone shader demo.
Build cost, presentation, color correctness, image-region dependencies and device recovery all count.

## GPU/evaluation candidates

| Candidate | Relevant strengths | Costs/uncertainties | Proposed role |
| --- | --- | --- | --- |
| Dawn native WebGPU | Compute/render API; WGSL; native backend translation | Build/package size; texture interop and precision must be measured | First GPU prototype candidate |
| Skia + SkSL | 2D drawing, paths/text, color-managed shader composition | Runtime effects belong to Skia's pipeline; image-editor graph/tiles still ours | Alternate renderer; later vector/text candidate |
| Existing WebGL2 compositor | Already integrated with our canvas/effect UI | Video assumptions, clamped shader paths, native tile transfer and export parity | Reuse ideas/assets selectively; comparison baseline |
| Native Metal only | Direct macOS GPU/presentation control | Separate Windows backend and platform-specific implementation | Specialized adapter only if portable path fails |
| GEGL/babl | Established graph/region/tile/color concepts | Integration/dependency fit and GPU route need evaluation | Architecture reference; optional later spike |

Dawn translates WebGPU to native graphics APIs, including Metal, D3D12 and Vulkan. This makes it a
credible portability candidate; it does not prove our app builds or behaves identically on all platforms.
[Dawn architecture](https://github.com/google/dawn/blob/main/docs/dawn/overview.md).

Skia runtime effects can define shaders, color filters and blenders inside Skia's drawing pipeline.
They are not arbitrary standalone GLSL stages; its pipeline also handles geometry, clipping and color.
Skia documents premultiplied shader output and conversion to linear extended sRGB for light math.
[SkSL/runtime effects](https://docs.skia.org/docs/user/sksl/),
[Skia color management](https://docs.skia.org/docs/user/color/).

GEGL exposes tiled buffers, region processing and cached graph evaluation. We can learn from those
boundaries without adopting its entire framework or coupling the document format to it.
[GEGL features](https://www.gegl.org/features.html).

## CPU/image-library candidates

| Library | What the primary source establishes | Boundary we should own |
| --- | --- | --- |
| libvips | Demand-driven image processing, threaded evaluation, C/C++ APIs, many formats | Interactive paint transactions, history, GPU residency, chosen codec build |
| Little CMS | Portable ICC profile transforms with a C API | Document working-space/output policy; profile ownership and transform caching |
| LibRaw | Camera RAW extraction, processing metadata and embedded previews | Quality development pipeline, demosaic/color/noise/lens policies |

libvips computes requested image regions through a pipeline and can stream encoded output. Decoder
access patterns vary: random tile access can require intermediate caching for sequential formats.
Evaluate import of real JPEG/PNG/TIFF inputs rather than assuming every decoder supports cheap random
reads. Its full advertised format set depends on available optional libraries.
[libvips evaluation](https://www.libvips.org/API/current/how-it-works.html),
[libvips project](https://www.libvips.org/).

Little CMS handles ICC transforms; it is not a complete display pipeline or artistic tone mapper.
Prototype needs unassociated color conversion, float-range checks, alpha preservation and known-profile
fixtures. [Little CMS color engine](https://www.littlecms.com/color-engine/).

LibRaw explicitly focuses on RAW extraction and camera support; it describes its included conversion
as basic rather than production-quality rendering. RAW import is therefore its own product/quality
milestone, not a checkbox solved by linking one library. [LibRaw scope](https://www.libraw.org/about).

## Native pixels into Electron

Electron now documents importing external shared textures and delivering them to a renderer as
VideoFrames. Those APIs are experimental, with lifetime rules: the source texture stays valid until
all imported references are released. Test receiver registration, frame release, synchronization,
color tags and our sandbox/preload arrangement using the installed Electron version.
[Electron sharedTexture](https://www.electronjs.org/docs/latest/api/shared-texture),
[Electron shared-texture design](https://github.com/electron/electron/blob/main/shell/common/api/shared_texture/README.md).

Offscreen BrowserWindow rendering produces Chromium content as a texture/bitmap. That does not by
itself establish import of a C++ engine texture into our canvas.
[Electron offscreen rendering](https://www.electronjs.org/docs/latest/tutorial/offscreen-rendering).

First establish bounded viewport readback as a portable baseline. Then evaluate shared textures.
Keeping processing native and presenting one flattened viewport avoids sending every source tile
through JavaScript. If native presentation is unacceptable, a browser-GPU evaluator could receive
resource tiles, but then browser/native graph parity and transferred bytes become major obligations.
Do not casually introduce that second renderer while claiming one shared evaluator.

## Dependency/build discipline

Pin exact revisions after the prototype selection. Build a small photo target independent of JUCE;
CI should build and run its headless fixtures without audio-device access. Keep codec features explicit
and record binary size, startup, build time, deployment target and compiler requirements.

Record licenses/notices and optional dependency licenses for the exact selected builds. Primary pages
currently state LGPL-2.1-or-later for libvips, MIT for Little CMS and a LGPL/CDDL choice for LibRaw.
These are dependency-selection facts, not a completed distribution assessment. Verify pinned source
licenses/linkage before packaging; this does not require a separate user approval flow.
[libvips](https://www.libvips.org/), [Little CMS](https://www.littlecms.com/color-engine/),
[LibRaw](https://www.libraw.org/about).

## Backend selection gate

Build one candidate fully before opening several parallel implementations. Compare an alternate only
if an unresolved failure justifies it. Record:

1. Headless and packaged builds; native GPU initialization/capability reporting.
2. Linear float texture, masked compositing, exposure and halo-correct blur.
3. Browser/Electron viewport transfer latency and copies, including color tagging.
4. Device loss, resource lifetime and engine-restart behavior.
5. CPU/GPU numerical tolerances and full-resolution streamed export.

Accept Dawn if it passes. If build/presentation is the blocker, test Skia/native presentation or a
browser-GPU arrangement against the same fixtures and document the tradeoff. No backend can enter the
canonical file format; replacement must preserve documents and effect semantics.

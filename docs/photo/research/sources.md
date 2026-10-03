# Research sources and verification limits

Research date: 2026-10-03. Primary documentation was searched and read for product behavior and
engineering capabilities. Links may redirect as vendors reorganize documentation. Versions/builds
must be pinned and exercised during implementation. No native photo prototype or direct Photoshop
interaction study was performed for this task.

## Photoshop desktop behavior

| Source | Supports | Used in |
| --- | --- | --- |
| [Nondestructive editing](https://helpx.adobe.com/photoshop/using/nondestructive-editing.html) | Adjustments, preserved transforms/filters, masks, retouch sampling | Product; Photoshop research |
| [Embedded Smart Objects](https://helpx.adobe.com/photoshop/desktop/create-manage-layers/smart-objects/create-embedded-smart-objects.html) | Embedded content creation/placement | Photoshop research |
| [Layer opacity and blending](https://helpx.adobe.com/photoshop/using/layer-opacity-blending.html) | Opacity/fill distinction and group Pass Through/isolation | Photoshop research |
| [Layer masks](https://helpx.adobe.com/photoshop/desktop/create-masks/layer-masks/add-layer-masks.html) | Mask creation/editing and selection-based procedures | Photoshop research |
| [Selection refinement](https://helpx.adobe.com/photoshop/desktop/make-selections/refine-modify-selections/refine-your-selection-and-mask.html) | Dedicated refinement workflow | Photoshop research |
| [Painting tools](https://helpx.adobe.com/photoshop/using/painting-tools.html) | Painting options and brush/tool presets | Photoshop research |
| [Brush presets](https://helpx.adobe.com/photoshop/desktop/apply-painting-techniques/brushes-presets/get-started-with-brush-presets.html) | Preset scopes | Photoshop research |
| [Stroke smoothing](https://helpx.adobe.com/photoshop/desktop/repair-retouch/clean-restore-images/create-smoother-more-polished-brush-strokes-with-stroke-smoothing.html) | Smoothing as a separate brush feature | Photoshop research |
| [Change profiles](https://helpx.adobe.com/ie/photoshop/desktop/adjust-color/color-profiles/change-color-profile-for-documents.html) | Assign versus convert | Rendering; Photoshop research |
| [Color settings](https://helpx.adobe.com/uk/photoshop/using/color-settings.html) | Working spaces and profile policy | Photoshop research |
| [Bit depth](https://helpx.adobe.com/photoshop/using/bit-depth.html) | Precision modes and their capability differences | Photoshop research |

## Engine, color and presentation

| Source | Supports | Limits on the inference |
| --- | --- | --- |
| [Dawn overview](https://github.com/google/dawn/blob/main/docs/dawn/overview.md) | Native WebGPU/backend architecture | Does not validate our build or texture import |
| [SkSL runtime effects](https://docs.skia.org/docs/user/sksl/) | Shader/color-filter/blender pipeline and alpha/color conventions | Does not supply editor history/tiles |
| [Skia color management](https://docs.skia.org/docs/user/color/) | Color-space handling within Skia | Does not define our output policy |
| [libvips evaluation](https://www.libvips.org/API/current/how-it-works.html) | Region evaluation and pipeline/cache behavior | Interactive painting and GPU residency remain ours |
| [libvips project](https://www.libvips.org/) | Formats/APIs, threaded processing, stated license | Optional codec support depends on build |
| [GEGL features](https://www.gegl.org/features.html) | Tiled buffers, region/graph processing and caches | Architecture reference, not selected dependency |
| [Little CMS](https://www.littlecms.com/color-engine/) | ICC transforms, portability, stated license | Not a full image/render/display engine |
| [LibRaw scope](https://www.libraw.org/about) | RAW extraction, metadata, limited conversion scope, licenses | Does not promise production RAW development |
| [W3C compositing](https://www.w3.org/TR/compositing-1/) | Compositing/blending algebra and isolation concepts | Not proof of Photoshop pixel parity or all HDR rules |
| [Electron sharedTexture](https://www.electronjs.org/docs/latest/api/shared-texture) | Native shared-texture import/delivery, experimental status/lifetime | Installed build, formats and sandbox access need experiments |
| [Electron texture design](https://github.com/electron/electron/blob/main/shell/common/api/shared_texture/README.md) | Resource ownership and transfer design | Synchronization still needs app-level validation |
| [Electron offscreen rendering](https://www.electronjs.org/docs/latest/tutorial/offscreen-rendering) | BrowserWindow bitmap/texture output | Opposite direction from importing native engine output |
| [Optical Flares creation](https://video-copilot.gitbook.io/opticalflaresnuke/using-optical-flares-for-nuke/creating-a-lens-flare-from-scratch) | Element-based creative flare workflow | Reference only; no copied assets or physical simulation claim |

The full WebGPU specification could not be retrieved by the research tool because of its size.
Do not infer exact GPU format/storage limits from this research. Query adapter capabilities and consult
the pinned backend/API documentation during F0.

## Repository evidence inspected

Paths below describe current code; proposed photo paths elsewhere in these docs do not exist yet.

- [`shared/suites.ts`](../../../shared/suites.ts): suite IDs, documents, labels and registration contracts.
- [`shared/suite-tools.ts`](../../../shared/suite-tools.ts): suite-owned assistant tool dispatch.
- [`server/suites/suite.ts`](../../../server/suites/suite.ts): backend normalization/stats/remap contracts.
- [`src/suites/index.ts`](../../../src/suites/index.ts) and
  [`src/suites/types.ts`](../../../src/suites/types.ts): workspace/tool/lifecycle integration.
- [`src/lib/document-history.ts`](../../../src/lib/document-history.ts): metadata snapshots and gestures;
  entry limit, no pixel-resource accounting.
- [`src/lib/autosaver.ts`](../../../src/lib/autosaver.ts): existing autosave coordination.
- [`server/projects.ts`](../../../server/projects.ts) and
  [`server/storage.ts`](../../../server/storage.ts): package ownership, duplication and JSON publication.
- [`server/music/engine.ts`](../../../server/music/engine.ts): native process supervision/control pattern.
- [`engine/CMakeLists.txt`](../../../engine/CMakeLists.txt): C++20/JUCE audio build; photo should be independent.
- [`shared/compositor.ts`](../../../shared/compositor.ts): existing WebGL2 GPU renderer and float targets.
- [`shared/effect-gl.ts`](../../../shared/effect-gl.ts): shader pass interface and clamped video output.
- [`shared/effect-library/light.ts`](../../../shared/effect-library/light.ts): existing lighting algorithms.
- [`electron/main.ts`](../../../electron/main.ts): sandbox/context-isolated desktop window setup.
- [`docs/fl-studio/README.md`](../../fl-studio/README.md): existing research-before-feature approach.

## Outstanding verification

Native GPU/presentation performance; float/alpha/color correctness; dependency build/packaging;
tile/cache limits; document resource crash recovery; actual owner hardware; Photoshop version-specific
interactions and shortcuts. All must be resolved with implementation evidence, not stronger wording.

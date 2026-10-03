# Editable creative effects

Status: proposed effect architecture and first implementations, 2026-10-03.
See [rendering](../rendering.md) for domains, bounds and tile evaluation.

## Product direction

Effects are a major reason to build this editor. Prioritize good-looking, adjustable systems rather
than a long list of opaque filters. Start with glow and a small flare element editor; expand to
halation, light rays, depth-driven bokeh, lens distortion, film treatments and procedural textures.
Some later effects need depth maps or analysis passes: those are explicit input resources, not magic
parameters assumed to exist.

The Optical Flares reference supports constructing flares from core objects and photographic sprites.
That validates researching an element-based editor. Our element types, defaults and assets are our
own design. [Video Copilot: create a flare](https://video-copilot.gitbook.io/opticalflaresnuke/using-optical-flares-for-nuke/creating-a-lens-flare-from-scratch).

## Definition and instance contract

Each definition declares stable ID/version, parameters with units/defaults/ranges, input types,
color/alpha domain, output bounds, dependency region mapping, quality policy and backend capability.
Each instance stores parameters, enabled/mix state, mask and preset provenance where useful.
Parameters are validated centrally; UI and assistant use the same definitions. Cache invalidation
includes algorithm version, not just parameter values.

Processing supports a small set of nodes: pointwise color, resample, local kernel, multi-pass pyramid,
reduction and procedural generator. Add a new node kind only for a concrete effect. A backend compiles
the definition into passes; the UI should not contain effect-specific render code.

Generator layers produce content (flare, texture); layer effects process their input (glow, distortion);
adjustment layers process scoped backdrop. Keep these semantics distinct even if they share kernels.
Applying one must not silently flatten the layer or alter its original source.

## Glow: first filter

Input: premultiplied linear RGB/alpha. Extract highlight contribution with an explicit threshold and
soft knee in working luminance, blur at several aligned scales, tint/mix, then combine in linear light.
Define whether alpha expands and how an isolated glowing object exports over transparency. A glow
must not inject invisible color with zero alpha or depend on the checkerboard beneath the image.

Controls: radius in document pixels, intensity/exposure, threshold, softness, tint amount and output
mix. Initially add light with a documented coverage policy; screen and other artistic blends follow
extended-range tests. Do not bake the SDR highlight mapping into the glow itself.

Large radii require pyramid passes and cross-tile support. A one-tile padded blur is insufficient when
the requested halo exceeds its memory budget. The global pyramid origin and sampling phase must be
the same in viewport and export. Test tiny emitters, broad highlights, colored sources and transparency.

## Flare: first generator

Represent a flare as source position, optical center, global intensity/color and ordered element
descriptors. Each element has a stable ID, type, size, axis distance/offset, tint, intensity and shape
parameters. Initial elements: source glow, halo/ring, ghost disc and anamorphic streak. Starbursts,
sprites, dirt and richer chromatic separation follow once those render well.

Place the source with a canvas handle. Elements lie on/around the source-to-optical-center axis, using
document-space coordinates and consistent aspect handling. Presets store editable descriptors and
saved random seeds. A static image does not need timeline time to make its noise deterministic.

The generator produces linear premultiplied content with a defined alpha/coverage policy. Its layer
mask can hide it behind objects. Automatic source occlusion based on a depth/matte resource is later
work; a manual mask is not a physically simulated lens. Do not claim ray-traced optics for procedural
approximations.

## Reuse from the video editor

`shared/effect-library/light.ts` already implements glow, flare, chromatic aberration and bokeh;
`shared/effect-gl.ts` defines shader inputs/passes. Use those as algorithm/control references and
possible ports. The current video shader prelude clamps output, and light helpers include display
mapping/dither. The photo path must separate linear light processing from final output mapping.

Do not make photo effects depend on clip time, keyframes, media-frame coordinates or video history.
Port pure kernels where suitable, add photo-specific units and bounds, and verify against fixtures.
Do not change video rendering merely to make the photo prototype work.

## Presets and extensibility

Presets are versioned data referencing effect definitions and owned assets. Copy a preset into an
instance on apply; a future preset update cannot rewrite existing projects. Preview uses transient
instances; apply commits one history step. Asset-bearing presets are portable when copied/shared.

First extensibility means adding built-in definitions cleanly. Arbitrary user shaders, third-party
binary plugins and executable preset code are deferred. Do not design a large plugin ABI before the
definition/instance model has been exercised by several effect families.

## Acceptance fixtures

- Same source/seed, settled viewport and tiled export agree within a defined precision tolerance.
- Glow/flare crossing tile boundaries produces no seams or cropped halos.
- Highlights retain color/structure until the common output transform; intermediate energy is testable.
- Alpha edges composite correctly over black, white and saturated backdrops.
- Source handle at several zoom levels moves the same document-space light position.
- Reordering, bypassing, masking, undoing and save/reopen preserve the full editable configuration.
- Missing optional assets/effect versions produce a clear capability report without deleting settings.

# Scene maps: depth and subject as filter inputs

Status: built 2026-10-07. What Théo asked for: effects that know what's in the photo (where the subject is, how far
away things are), "a depth map or something would be fucking dope", fog and atmosphere, tilt-shift.

A filter can read two maps of the picture it's on, besides its pixels:

- **Depth**: how near each point is, 0 the farthest in the picture, 1 the nearest. From Depth Anything V2 Small (Yang
  et al., 2024; Apache-2.0 weights), fp16 ONNX, 50 MB, a monocular model: relative depth, not metres.
- **Subject**: how much each point is the picture's main subject, 0..1. From Select Subject's model (IS-Net, 88 MB).

They're the effects system's "explicit input resources" ([system.md](system.md)): never assumed to exist, made from
the picture, keyed by what they were made of.

## What a map is

`SceneMaps` (`shared/photo/scene.ts`): a grid of cells over the canvas, in power-of-two document pixels so its long
side is at most 1024 cells (`sceneGrid`), each cell a depth and a subject. A point reads them bilinearly between cell
centres, held at the grid's edge: `env.scene(x, y)` in a CPU reference, `scene_at(p)` in WGSL (the kernel prelude), the
same arithmetic on the same floats. Being a grid of the document, not of a view, every tile, reduced view and export
reads the same values.

The maps are a storage buffer, not the content texture, so reading them costs a filter no reach: an aura can blur the
subject map 200 pixels wide while reading the picture only at the point.

## Where they come from

Like Camera Raw's analysis ([camera-raw.md](../camera-raw.md), CR2), and with the same input: a filter's picture is its
layer's content with the filters before it (`analysisInput`). The renderer's `SceneMapStore`
(`src/suites/photo/render/scene-maps.ts`) renders it coarsely on the grid, reads it back, and runs the models in the
tab (`src/suites/photo/scene-models.ts`, ONNX Runtime Web on WebGPU, as Select Subject does):

- **Depth**: the picture at its shape, short side 518, sides multiples of 14 (`depthInputSize`), normalised as
  ImageNet; the answer (inverse depth) read at the grid's cells, its 2nd to 98th percentile of what the picture
  covers made 0..1 (a cut-out's empty surroundings aren't scenery), then a guided filter on the picture's luminance
  gives it the picture's edges, so a blur or fog by depth stops at the subject's outline (`depthMap`).
- **Subject**: IS-Net's 1024 × 1024 answer, read at the grid's cells.

Maps are kept by picture (its input key and canvas), up to 16, each map added when a filter first asks for it.

The plan (`compileRender`'s `scene` resolver) hands a filter its maps in `SCENE_PARAM` and keys its node by their id;
**until they're made the filter is left out** (its keys say nothing of it, so nothing drawn without it is reused).
The screen builds what's missing in the background and draws again; exports, pictures and refinements wait
(`settledPlan`).

## The models

Downloaded only when the user says yes, once per computer, into `MODELS_DIR` (`server/photo/models.ts`'s
`ModelFile`, checked by size and SHA-256; `/api/photo/models/{subject,depth}`, `/setup`, `/file`). A filter that needs a
model that isn't here is left out; the renderer says which (`onMissing`, once until `retry`) and the workspace asks
(`scene-model-dialog.tsx`); Properties and the Filter Gallery's settings say so beside the filter, with a Download
button. e2e sets `EDITOR_SUBJECT_MODEL=stand-in` and `EDITOR_DEPTH_MODEL=stand-in`: the stand-ins answer at once
(`standInProbabilities`, `standInDepth`: nearer lower down and on the stand-in's subject). `photo-sheet.ts` uses them
too unless `--models` says to use the real ones (thumbnails do).

## Apply To

Every kernel filter has **Apply To**: Everything, Subject or Background (`APPLY_TO` in `effects/kernel.ts`). The pass
weighs Mix by the subject map there (`apply_weight`, `applyWeight`), so any look (Wind, Glitch, a Gradient Map) can
change the background alone and leave the person as they were. Choosing Subject or Background is what makes a filter
read the subject map.

## The filters

Two gallery categories, Depth and Subject.

### Depth
- **Depth Grade**: a gradient along the depth between Far and Near, replacing the picture, giving it its colour at the
  picture's brightness, or soft-lighting it. Depth Map (the map itself), Thermal, Warm Near Cool Far, Night Fall,
  Pink Dusk.
- **Lens Blur**: depth of field, focused on the subject (by default: the 75th percentile of depth weighted by the
  subject map squared, worked out once per map), a point or a distance, the blur growing with the distance in depth
  beyond half the Focus Range, in a circle, hexagon or anamorphic aperture, with Cat's Eye and bokeh highlights. One
  gather shared with Tilt-Shift (`gatherFocus`, WGSL's `gather`): a golden-angle spiral over the point's own blur and
  a ring out to any nearer blur found by 24 depth probes, each tap counting where its own circle of confusion reaches
  the point, so a sharp subject keeps no halo and a blurred foreground melts over what's behind; premultiplied linear
  light, so lights bloom into discs. At most 192 content reads. Lens Blur, Portrait, Shallow, Bokeh Night, Macro,
  Anamorphic.
- **Tilt-Shift**: a band kept sharp, a plane at an angle (Photoshop's Tilt-Shift) or a range of depths around a focus,
  the blur rising smoothly away from it, and the miniature's saturation and contrast. Miniature, Depth Miniature,
  Vertical, Diagonal, Subtle.
- **Fog**: `1 − e^−τ` of a fog colour in linear light, τ growing with distance past Start, thicker low in the frame
  (Ground Fog), broken into banks by seeded fBm (Wisps), brighter toward a light (Glow), what it covers softened (a few
  reads). Mist, Dense Fog, Ground Fog, Smoke, Golden Haze, Night Fog.
- **Depth Particles**: snow, dust, embers, rain or bokeh in up to six layers of depth, each a seeded grid of cells with
  at most a particle each (a pixel draws its 3 × 3), hidden where the picture is nearer than the particle, nearer ones
  bigger and softer away from Focus; snow covers, the rest add light. Snowfall, Embers, Dust in the Light, Rain,
  Fireflies, Bokeh.
- **Relight**: the depth map's slopes (Relief, Smoothness) lit by a coloured point light above the picture, with an
  ambient kept and a rim from behind, multiplying the picture's light. No shadows. Key Light, Neon Night, Golden Hour
  Side Light, Moody, Under-lit.

### Subject
Each reads only the subject map (no content reach): blurs and dilations are taps on the map.
- **Aura**: the subject map blurred wide (a 64-tap spiral, turned per pixel by a 4 × 4 Bayer pattern so thin shapes
  don't leave copies), its glow coloured from the edge outwards behind the subject, or a shadow; Rays are god rays
  from the subject's centre of mass (a 40-tap march toward it), cut into seeded streaks. Halo, Neon Aura, Holy Light,
  Dark Aura, Double Glow, Sun Burst.
- **Rim Light**: a band inside the subject's edge facing the light's angle (lanes of taps fanned toward it), and a glow
  just outside, a second rim opposite in another colour. Rim, Neon Rim, Backlight, Golden Edge, Ice Edge.
- **Sticker**: one or two outlines (the map dilated), a drop shadow, and the background kept, a colour or transparent.
  Sticker, Die-Cut, Double Outline, Pop, Neon Cut.
- **Spotlight**: the world dimmed, drained and tinted outside a pool of light around the subject, the subject lifted.
  Spotlight, Noir Pop, Stage, Blue Hour, Red Room.

## Where we differ from Photoshop

- Its Lens Blur reads a depth map from a channel or the Neural Filters; ours makes one from the picture.
- Its filters can't be limited to the subject without a mask; ours have Apply To.

## Limits

- The maps are at most 1024 cells long: fine detail (hair, fronds) is softer in them than in the picture. Rim Light on
  a subject thinner than its band lights it whole.
- Lens Blur's taps thin out past a radius of about 6 px: tiny lights in a 100 px blur on a large photo look speckled at
  100%; a scatter pass would fix it, which one kernel pass can't be.
- The models are monocular and relative: the subject model picks what looks like a subject (on the gallery's dusk
  scene, the palm and the sun, not the small figure).

## Later

A depth map shown and painted over as a channel (fixing the model's mistakes by hand); maps for a whole composite
(the layers below, for an adjustment layer); God Rays behind the subject (the read-anywhere pass); a metric depth
model for scenes where the relative one's range misleads.

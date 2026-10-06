# 3D scenes, second take

The first 3D scenes (V8) were vaudio's three.js worlds, ported. Théo found them not good enough (2026-10-07) and asked
for five new ones, planned properly: one a flight over mountains, one a fall into an infinite fractal that swoops
around rather than going straight down, the rest free (nature, anything), all of them compelling.

## How they're drawn: raymarched GLSL, not three.js

The best looking real-time worlds (Shadertoy's terrains, seas, clouds, fractal flights) aren't meshes: they're
fragment shaders that march a ray per pixel through a distance field or a heightfield and light what it hits. That
suits this app better than three.js on every count:

- **One renderer.** A scene is a video effect like any other: the compositor runs its GLSL at the layer's size, in the
  tab and in the export's page alike, pixel for pixel. No second WebGL context, no bundle for the export page, no
  runtime loaded on first use.
- **Exact by construction.** What moves (the camera's flight, its swoops, events set off by hits) is stepped in
  TypeScript from the clip's first frame (`shared/scenes/`, `steppedState`, as in V8) and handed to the shader as
  uniforms. The shader is a pure function of those and the time, so a seek costs a few microseconds a frame of state
  and nothing on the GPU.
- **Better pictures.** Soft shadows, aerial perspective, glow, reflections, infinite detail: what raymarching is for.

So three.js, `src/scenes/`, the scene runtime bundle and the compositor's scene renderer go. `EffectShader.scene`
stays and means: this effect's state is stepped in TypeScript (`shared/scenes/<scene>.ts`) and becomes uniforms its
GLSL declares. A scene may also hear the sound directly (`EffectShader.audio`: the spectrum texture), as visualizers do.

## The five

Each is a solid's look (Blend Mode Replace by default, like a generator), in the 3D Scenes category. All share:
Listens To, Hits, Reactivity, Speed, Quality (march steps), Opacity and Blend Mode; each adds its own few looks.
Portrait first: a lens is set for the frame's shorter side, so 9:16 sees as much across as a square does.

### 1. Ridgeline: a flight through mountains

Low and fast down a winding valley at dusk, ridges rising either side, peaks catching the last sun, haze filling the
distance; it banks into the bends.

- **World**: a heightfield of eroded fractal noise (octaves damped by the slope so far, Inigo Quilez's trick: sharp
  ridges, smooth valleys), with a valley carved along the flight path, which winds as a sum of slow sines. Snow where
  it's high and flat enough, rock on slopes, dark grass and forest below. A sky of Rayleigh-ish gradient, sun disc and
  glow, a cloud layer above (2D noise at an altitude, its parallax sells the speed), aerial perspective (fog coloured
  by how close the ray runs to the sun).
- **Camera** (stepped): distance along the path integrated from a speed that rides the bass; altitude above the valley
  floor eases between low and high passes (choruses climb: the level); it looks a little ahead down the path and banks
  into the bend (roll from the path's curvature); a kick dips it and kicks the speed.
- **Sound**: speed and the sun's glow ride the level; kicks dip and flash the sky. **Neon** style: the same flight as
  synthwave, the terrain dark with glowing contour lines and a grid, a striped sun, the lines' brightness the spectrum.
- **Looks**: Style (Dusk, Neon, Night), Sun Height, Haze, Snow.

### 2. Infinite Dive: falling into a fractal, forever

Falling towards the heart of a fractal cathedral that never ends: filigree arches and spires rushing past, opening
into new chambers of the same structure at smaller and smaller scales, the camera swooping around the fall rather than
dropping straight.

- **World**: exactly self-similar about the origin (the world at a scale `s` smaller, turned by `R`, is the same world),
  so the fall can go on for ever without precision running out: the shader draws the camera's depth modulo one level.
  The structure is a kaleidoscopic IFS (folds, then a scaled copy) laid in shells, each shell a level; orbit traps
  colour it (an iridescent palette), and the light comes from the heart (a glow at the origin seen through the
  structure) and from the edges of what's near.
- **Camera** (stepped): depth in levels, integrated from a fall speed on the bass; its direction around the heart
  swoops (angular velocity eased towards targets that change on hits, a seeded random walk); it looks towards the heart
  but swings off it and rolls with the swoop. Geometry closer than a bubble around the lens is carved away, glowing at
  the cut, so passing through is clean.
- **Sound**: hits swoop and flash the edges; the spectrum colours the traps; the level brightens the heart.
- **Looks**: Palette (Iridescent, Gold, Ice, Ember), Glow, Twist (how much each level turns).

### 3. Aurora: a night on the ice

A frozen lake under a sky full of aurora, the curtains folding and rippling with the music, mirrored in the ice;
mountains in silhouette, stars, the Milky Way.

- **World**: the aurora is raymarched through slabs of 2D noise above (the curtain technique: a ribbon's brightness
  sampled through layers, folded by a slow warp), coloured green at the hem to magenta at the top. The lake is a
  reflecting plane with gentle roughness and cracks; silhouettes are a 1D noise horizon; stars hashed on the sky.
- **Camera** (stepped): a slow drift and pan across the lake, its heading turning with the level.
- **Sound**: the spectrum across the sky: each part of the curtains is as bright as its band; hits send a bright
  ripple along them; the bass lifts their hem.
- **Looks**: Colors (Classic, Violet, Fire), Curtain Height, Stars.

### 4. Storm Sea: lightning over the ocean

Skimming a heaving night sea in a storm: swells rolling under, spray, a low ceiling of cloud, lightning on the hits
lighting the clouds from inside and the sea below.

- **World**: the sea is a heightfield of choppy octave waves (the Seascape technique: refined by bisection, lit with
  Fresnel reflection of the sky, subsurface green in the crests, foam where it peaks). Clouds a volume slab above
  (a few marched samples of 3D noise), lit by the flashes.
- **Camera** (stepped): a forward skim at a speed that rides the bass, height following the swell under it (heaving),
  rolling with the wave slope.
- **Sound**: wave height and chop ride the bass and the level; each hit is a flash (a seeded place in the clouds, a
  fast flicker and decay, stepped), several can overlap; the highs are the rain.
- **Looks**: Weather (Storm, Moonlit, Sunset), Wave Height, Lightning.

### 5. Ferrofluid: liquid metal that grows spikes

A blob of black liquid metal in a studio, mirror-smooth, rippling; on each kick its spikes stand up as a magnet would
pull them, then sink back; it turns slowly, the camera circling.

- **World**: a sphere displaced by noise (the ripples) and by spikes on a spherical Fibonacci lattice (each spike a
  sharp cone whose height is a band of the spectrum: low bands at one pole, high at the other), a smooth union, so it
  reads as one fluid. Lit by a procedural studio: soft boxes reflected in it, a rim light, a floor reflection.
- **Camera** (stepped): an orbit whose speed and height ease with the level.
- **Sound**: spike heights are the bands; kicks pull all of them up at once (a stepped envelope); the level ripples it.
- **Looks**: Finish (Chrome, Black Oil, Gold), Spikes, Ripple.

## Making them good

Each scene is iterated against renders, not written once: `scripts/scene-sheet.ts` renders a scene at a few moments
(9:16 and 16:9) through the export's own compositor, and they're looked at and tuned until they're right. The effect
sheet checks they compile and draw; `server/simulation.test.ts` keeps one scene exact reached any way.

Costs: the export draws at full size, so a scene must hold up at 1080x1920 (march budgets, distance-field LOD); Quality
lowers the step count for a fast preview.

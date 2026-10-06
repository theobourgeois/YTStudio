# 3D scenes, second take

**Built** (2026-10-07). As built, each scene differs from its plan below only in detail: Infinite Dive's levels are
three Forms (Portals: a cage of rings; Lattice: shells cut by Menger crosses; Spires: a crystal geode), Ridgeline flies
between its valley's floor and walls (higher in loud passages) and is lit side-on so its slopes model, Aurora's folds
glow where a curtain turns edge-on. Each file in `shared/scenes/` is the whole scene: its parameters, its GLSL and its
stepped state.

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

## Five more

Théo loved the five above and asked for five more (2026-10-06): the most beautiful worlds that could be made this way,
inspired by them and by what's out there, each syncing with the music. What was looked at: Shadertoy's classics (Inigo
Quilez's landscapes, nimitz's *Protean Clouds* for volumes, TDM's *Seascape*, the Schwarzschild black holes that
integrate bent rays), the films they echo (*Interstellar*'s Gargantua, *Blade Runner 2049*'s city, Hubble's *Pillars
of Creation*, the deep-sea footage of *Blue Planet II*), and the visualizers people buy (infinite cities whose windows
pulse, underwater beats, Cinema 4D's fields of pillars). The five each take a place the first five don't: space, a
city, a gas, under the sea, and something abstract that is plainly an equaliser. Same rules as above: raymarched GLSL,
state stepped in TypeScript, portrait first, a full 1080x1920 frame in about the first five's time.

**Built** (2026-10-06), each iterated against renders and revised until it held up; every one draws a 1080x1920 frame
in 270–410 ms. Where they differ from their plans: Event Horizon's lens zooms for portrait and its camera swings
between edge-on and overhead every ~22 s, its knots glowing in 3D along the bent ray; Neon City walks its lots one by
one, its equaliser on the faces turned to the camera (LED-meter caps), with billboards, flying traffic, searchlights
and supertalls added; Nebula's light comes from young clusters in great cavities ahead, so near clouds stand in
silhouette; Abyss's jellies keep places in a group they're pulled back to (in three layers of depth, two of them sea
nettles) rather than wrapping in a box; Monoliths is a canyon: the bands mirrored about a corridor the camera flies
down (heard later the further out), its rings washes of light up the pillars, its camera in the canyon, over the
tops, and now and then risen over the field. Neon City, Nebula and Monoliths repeat their worlds over a long period
and wrap the camera in TypeScript, so a long song never runs out of float precision.

### 6. Event Horizon: a black hole

Gargantua: a black disc ringed by a thin photon ring, its accretion disk lensed up over the top and under the bottom,
one side brighter as it rushes at us, against a bent starfield.

- **World**: rays bent towards the hole as light is (the Schwarzschild orbit equation, `r'' = -1.5 h² r / |r|⁵`, stepped
  per pixel, finer near the hole); a ray that falls in is black. Each crossing of the disk's plane (interpolated) adds
  the disk's light there: hot at its inner edge (three times the horizon), cooling outwards (a blackbody colour from a
  temperature profile), streaked by turbulence that swirls at Kepler's speed (the inner rings faster), brighter where
  it comes at us (Doppler beaming) and redder deep in the well. A ray that escapes reads a starfield and a faint galaxy
  in its final direction, so the sky is lensed for free (Einstein rings round the shadow).
- **Camera** (stepped): a slow orbit; its inclination eases between nearly edge-on (the iconic view, the disk bent over
  the shadow) and from above; it comes closer in loud passages and drifts back in quiet ones.
- **Sound**: the disk's rings are the spectrum (the bass at the inner edge, the highs outwards); each hit drops a bright
  clump in that spirals inwards at its orbit's speed and flares as it goes (stepped: a few at once); the level heats
  the disk; the punch pulses the photon ring.
- **Looks**: Disk (Gargantua, Blue Giant, Ember), Inclination, Turbulence.

### 7. Neon City: night flight through a rain-soaked megacity

Down an endless avenue between towers at night, in the rain: neon signs, a thousand lit windows, a wet street that
mirrors them, haze glowing with their colours.

- **World**: city blocks repeated along the flight (heights, setbacks and signs from a hash per block), windows a grid
  on each facade, neon strips and signs that glow into the haze (light gathered along the march from how near it ran
  to each sign), a wet street that reflects the city (a second, cheaper march), rain as streaks, the sky the city's
  orange-violet glow on low cloud. The world repeats over a long period, and the camera's place wraps in it, so the
  flight never runs out of precision.
- **Camera** (stepped): down the avenue at a speed on the bass, weaving between lanes and changing height (now just over
  the street, now among the tops), banking into the weaves; hits pick the next weave.
- **Sound**: the windows are an equaliser: each tower's columns lit up to the height of their band, so the whole street
  is a spectrum analyser in perspective; kicks flash the neon and the haze; the highs are the rain.
- **Looks**: Palette (Cyberpunk, Blade Runner, Tokyo, Matrix), Rain, Height.

### 8. Nebula: drifting through a stellar nursery

Gliding through glowing clouds of gas and dark dust, pillars and cavities lit from inside by newborn stars.

- **World**: a volume of domain-warped noise marched front to back: emission coloured by how near the ionising stars
  are (blue-white near, teal oxygen, deep red hydrogen far: the Hubble palette's logic), dark dust that absorbs, a few
  bright stars inside it with their glow and diffraction spikes, a starfield behind. A tunnel is carved along the
  flight path, as Ridgeline's valley is, so the camera's never inside a wall of gas.
- **Camera** (stepped): forward along a slowly curving path, rolling a little; faster on the bass.
- **Sound**: each hit ignites a star ahead (seeded, stepped: it flares and lights the gas round it, then settles, a few
  at once); the level is the emission's brightness; the bass warms the hydrogen, the highs the oxygen.
- **Looks**: Palette (Hubble, Natural, Cosmic), Density, Stars.

### 9. Abyss: jellyfish in the deep

The deep sea's twilight: shafts of light from far above, marine snow drifting through them, and glowing jellyfish
pulsing as they swim, their bells contracting on the kicks.

- **World**: water that absorbs (blue-green falling to black with depth), god rays from a rippling surface far above
  (light gathered along the ray through caustic noise), marine snow (hashed motes in cells round the camera, drifting).
  The jellyfish are translucent bells (a squashed shell with a frilled rim) trailing tentacles that sway behind them,
  shaded by Fresnel and an inner glow, with bioluminescent spots along the rim.
- **Camera** (stepped): drifting slowly among them, turning to follow the group, bobbing.
- **Sound**: kicks contract the bells, and each contraction pushes its jelly up (stepped per jelly: a pulse and a
  glide); each jelly's glow is a part of the spectrum; the level brightens the shafts; the highs make the plankton
  sparkle.
- **Looks**: Glow (Cyan, Magenta, Gold, Rainbow), Depth (from sunlit blue to the abyss), Jellies.

### 10. Monoliths: an equaliser the size of a landscape

An endless field of polished black pillars under a vast dusk sky, rising and falling with the music: a living
equaliser the camera glides over, waves rippling through it on every kick.

- **World**: a grid of rounded pillars, traversed cell by cell (exact and cheap, a DDA, not a guessed march); each
  pillar's height is its band of the spectrum (the frequency across, mirrored about the path, so every row reads as the
  spectrum) plus the kicks' ripples. Glossy dark faces that reflect the sky, tops lit by an edge of light whose
  brightness is their height, soft shadows, occlusion between them, haze.
- **Camera** (stepped): gliding low over the field, turning slowly, rising now and then to show the patterns,
  banking.
- **Sound**: heights are the spectrum; each kick sends a ring outwards from the camera's place (stepped, several at
  once) that lifts the pillars it passes; the level lights the horizon.
- **Looks**: Style (Obsidian, Marble, Synth), Height, Spacing.

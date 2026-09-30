/**
 * Transition presets: an adjustment layer across a cut, animated the way After
 * Effects edits do it (Transform-style moves with motion blur and mirrored
 * edges, and effects that spike at the cut). The layer's middle is the cut.
 */
import type { PresetDefinition } from "../presets.ts";
import { MOVING, across, key, spike, throughCut } from "./common.ts";

const transition = (def: Omit<PresetDefinition, "kind">): PresetDefinition => ({ ...def, kind: "transition" });

export const TRANSITION_PRESETS: PresetDefinition[] = [
  transition({
    type: "zoom-through",
    label: "Zoom Through",
    tags: ["zoom"],
    duration: 0.6,
    // Forwards all the way: the outgoing shot rushes at the camera, the incoming one arrives from further away.
    effects: [{ type: "motion", params: MOVING, keys: { scale: throughCut(1, 2.2, 0.45, 1) } }],
  }),
  transition({
    type: "zoom-out-through",
    label: "Zoom Out",
    tags: ["zoom"],
    duration: 0.6,
    effects: [{ type: "motion", params: MOVING, keys: { scale: throughCut(1, 0.45, 2.2, 1) } }],
  }),
  transition({
    type: "zoom-blur-punch",
    label: "Zoom Blur Punch",
    tags: ["zoom", "blur"],
    duration: 0.5,
    effects: [
      { type: "motion", params: MOVING, keys: { scale: throughCut(1, 1.6, 0.8, 1, 0.9) } },
      { type: "zoom-blur", keys: { amount: spike(0.6) } },
    ],
  }),
  transition({
    type: "spin",
    label: "Spin",
    tags: ["spin"],
    duration: 0.7,
    // One continuous turn: upside down at the cut, upright again when it settles.
    effects: [{ type: "motion", params: MOVING, keys: { rotation: across(0, 360), scale: spike(1.35, 1) } }],
  }),
  transition({
    type: "spin-zoom",
    label: "Spin Zoom",
    tags: ["spin", "zoom"],
    duration: 0.7,
    effects: [
      { type: "motion", params: MOVING, keys: { rotation: across(0, 360), scale: throughCut(1, 2.4, 0.5, 1) } },
    ],
  }),
  transition({
    type: "roll",
    label: "Roll",
    tags: ["spin"],
    duration: 0.5,
    // A quarter turn each side of the cut.
    effects: [{ type: "motion", params: MOVING, keys: { rotation: throughCut(0, 90, -90, 0), scale: spike(1.25, 1) } }],
  }),
  ...(["left", "right", "up", "down"] as const).map((dir) => {
    // A whole canvas away, over a tiled picture: the incoming shot lines up exactly where the outgoing one started.
    const to: [number, number] = dir === "left" ? [-0.5, 0.5] : dir === "right" ? [1.5, 0.5] : dir === "up" ? [0.5, -0.5] : [0.5, 1.5];
    return transition({
      type: `whip-${dir}`,
      label: `Whip ${dir[0].toUpperCase()}${dir.slice(1)}`,
      tags: ["slide"],
      duration: 0.45,
      effects: [{ type: "motion", params: { ...MOVING, edges: "tile" }, keys: { position: across([0.5, 0.5], to, 0.9) } }],
    });
  }),
  transition({
    type: "glitch-cut",
    label: "Glitch Cut",
    tags: ["glitch"],
    duration: 0.4,
    effects: [
      { type: "glitch", params: { frequency: 1 }, keys: { intensity: spike(2) } },
      { type: "rgb-split", keys: { amount: spike(0.06) } },
    ],
  }),
  transition({
    type: "twirl-cut",
    label: "Twirl",
    tags: ["distort"],
    duration: 0.8,
    effects: [
      { type: "twirl", params: { reach: 0.9 }, keys: { angle: throughCut(0, 540, -540, 0, 0.75) } },
      { type: "motion", params: MOVING, keys: { scale: spike(1.2, 1) } },
    ],
  }),
  transition({
    type: "blur-cut",
    label: "Blur Dissolve",
    tags: ["blur"],
    duration: 0.6,
    effects: [{ type: "gaussian-blur", keys: { blurriness: spike(0.12) } }],
  }),
  transition({
    type: "shake-cut",
    label: "Impact Shake",
    tags: ["shake"],
    duration: 0.5,
    effects: [
      // A rumble building to the hit at the cut, then dying away.
      {
        type: "camera-shake",
        params: { speed: 2.5 },
        keys: { strength: [key(0, 0, "ease-out"), key(0.45, 0.2, "ease-in"), key(0.5, 1), key(1, 0, "ease-in", 0.5)] },
      },
      { type: "motion", params: MOVING, keys: { scale: [key(0, 1, "ease-out", 0.8), key(0.5, 1.15, "ease-in"), key(1, 1, "ease-in", 0.7)] } },
    ],
  }),
  // After Effects' CC Lens zoom: the picture bulges into a glass ball as it rushes through the cut.
  transition({
    type: "lens-zoom",
    label: "Lens Zoom",
    tags: ["zoom", "distort"],
    duration: 0.6,
    effects: [
      { type: "motion", params: MOVING, keys: { scale: throughCut(1, 1.45, 0.75, 1) } },
      { type: "lens", params: { size: 0.9 }, keys: { convergence: spike(0.85, 0, 0.6) } },
      { type: "zoom-blur", keys: { amount: spike(0.2) } },
    ],
  }),
  transition({
    type: "lens-pinch",
    label: "Lens Pinch",
    tags: ["zoom", "distort"],
    duration: 0.6,
    effects: [
      { type: "motion", params: MOVING, keys: { scale: throughCut(1, 0.6, 1.8, 1) } },
      { type: "lens", params: { size: 0.8 }, keys: { convergence: spike(-1, 0, 0.7) } },
    ],
  }),
  transition({
    type: "fisheye-punch",
    label: "Fisheye Punch",
    tags: ["zoom", "distort"],
    duration: 0.5,
    effects: [
      { type: "optics-compensation", keys: { fov: spike(160, 0, 0.8) } },
      { type: "motion", params: MOVING, keys: { scale: spike(1.3, 1) } },
    ],
  }),
  transition({
    type: "melt",
    label: "Melt",
    tags: ["distort"],
    duration: 0.9,
    effects: [
      { type: "turbulent-displace", params: { size: 0.4, complexity: 3 }, keys: { amount: spike(0.22, 0, 0.5), evolution: across(0, 360, 0.3) } },
      { type: "gaussian-blur", keys: { blurriness: spike(0.02) } },
    ],
  }),
  transition({
    type: "ripple-cut",
    label: "Shockwave",
    tags: ["distort"],
    duration: 0.8,
    effects: [
      { type: "ripple", params: { radius: 1.5, waveWidth: 0.12, speed: 3 }, keys: { waveHeight: spike(0.06, 0, 0.5) } },
      { type: "motion", params: MOVING, keys: { scale: spike(1.1, 1) } },
    ],
  }),
  transition({
    type: "polar-warp",
    label: "Polar Warp",
    tags: ["distort", "spin"],
    duration: 0.8,
    effects: [
      { type: "polar-coordinates", keys: { interpolation: spike(1, 0, 0.7) } },
      { type: "motion", params: MOVING, keys: { rotation: across(0, 360) } },
    ],
  }),
  transition({
    type: "spherize-pop",
    label: "Sphere Pop",
    tags: ["zoom", "distort"],
    duration: 0.5,
    effects: [
      { type: "spherize", params: { radius: 0.9 }, keys: { amount: spike(1, 0, 0.7) } },
      { type: "motion", params: MOVING, keys: { scale: throughCut(1, 1.5, 0.7, 1) } },
    ],
  }),
  transition({
    type: "datamosh-cut",
    label: "Datamosh",
    tags: ["glitch"],
    duration: 0.5,
    effects: [
      { type: "block-glitch", params: { speed: 18, blockSize: 0.08 }, keys: { amount: spike(1, 0, 0.4), rgbOffset: spike(0.04, 0, 0.4) } },
      { type: "displacement-glitch", params: { slices: 24, speed: 20 }, keys: { amount: spike(0.3, 0, 0.5) } },
    ],
  }),
  transition({
    type: "signal-loss",
    label: "Signal Loss",
    tags: ["glitch"],
    duration: 0.6,
    effects: [
      { type: "scan-tear", params: { speed: 4 }, keys: { amount: spike(1, 0, 0.5) } },
      { type: "digital-noise", params: { colorNoise: true }, keys: { amount: spike(0.8, 0, 0.6) } },
      { type: "wave-rgb", params: { frequency: 8, speed: 6 }, keys: { amount: spike(0.05, 0, 0.5) } },
    ],
  }),
  transition({
    type: "rgb-shake-cut",
    label: "RGB Shake",
    tags: ["glitch", "shake"],
    duration: 0.45,
    effects: [
      { type: "wave-rgb", params: { frequency: 12, speed: 8 }, keys: { amount: spike(0.06, 0, 0.5) } },
      { type: "camera-shake", params: { speed: 3 }, keys: { strength: spike(0.8, 0, 0.5) } },
      { type: "motion", params: MOVING, keys: { scale: spike(1.12, 1) } },
    ],
  }),
  transition({
    type: "flash-cut",
    label: "Flash",
    tags: ["light"],
    duration: 0.4,
    // White for a moment either side of the cut, the rest a quick bloom in and out.
    effects: [{ type: "flash", params: { bloom: 1 }, keys: { amount: spike(1, 0, 0.9), exposure: spike(3, 0, 0.8) } }],
  }),
  transition({
    type: "glow-flash",
    label: "Glow Flash",
    tags: ["light"],
    duration: 0.6,
    effects: [
      { type: "deep-glow", params: { threshold: 0.55, reach: 0.4 }, keys: { exposure: spike(3, 0, 0.7) } },
      { type: "flash", params: { bloom: 0.8 }, keys: { amount: spike(0.5, 0, 0.9), exposure: spike(1.5, 0, 0.8) } },
    ],
  }),
  transition({
    type: "light-leak-cut",
    label: "Light Leak Burn",
    tags: ["light"],
    duration: 0.9,
    effects: [
      { type: "light-leak", params: { speed: 2, leakScale: 1.4 }, keys: { amount: spike(2, 0, 0.4) } },
      { type: "flash", keys: { amount: spike(0.35, 0, 0.4), exposure: spike(1, 0, 0.4) } },
    ],
  }),
  transition({
    type: "light-sweep-cut",
    label: "Light Sweep",
    tags: ["light", "slide"],
    duration: 0.6,
    effects: [
      {
        type: "light-sweep",
        params: { width: 0.35, direction: -20 },
        keys: { centre: across([-0.4, 0.5], [1.4, 0.5], 0.6), intensity: spike(2.5, 0, 0.4), edgeIntensity: spike(1.5, 0, 0.4) },
      },
    ],
  }),
  transition({
    type: "spin-blur",
    label: "Spin Blur",
    tags: ["spin", "blur"],
    duration: 0.5,
    effects: [
      { type: "motion", params: MOVING, keys: { rotation: throughCut(0, 90, -90, 0, 0.9), scale: spike(1.3, 1) } },
      { type: "radial-blur", params: { blurType: "spin" }, keys: { angle: spike(40, 0, 0.5) } },
    ],
  }),
  transition({
    type: "radial-zoom",
    label: "Radial Zoom",
    tags: ["zoom", "blur"],
    duration: 0.5,
    effects: [
      { type: "motion", params: MOVING, keys: { scale: throughCut(1, 1.8, 0.6, 1, 0.9) } },
      { type: "radial-blur", params: { blurType: "zoom" }, keys: { zoom: spike(1.2, 0, 0.5) } },
      { type: "chromatic-aberration", keys: { amount: spike(0.05, 0, 0.5) } },
    ],
  }),
  transition({
    type: "lens-blur-cut",
    label: "Rack Focus",
    tags: ["blur"],
    duration: 0.8,
    effects: [{ type: "lens-blur", keys: { blurRadius: spike(0.08, 0, 0.5) } }],
  }),
  // 3D: the picture below as a card in space, seen through the default camera.
  transition({
    type: "flip-3d",
    label: "3D Flip",
    tags: ["spin"],
    duration: 0.6,
    // Edge on at the cut: the outgoing shot turns away, the incoming one turns in from the other side.
    effects: [{ type: "motion", params: { threeD: true, motionBlur: true }, keys: { rotationY: throughCut(0, 90, -90, 0, 0.8), scale: spike(0.85, 1) } }],
  }),
  transition({
    type: "tumble-3d",
    label: "3D Tumble",
    tags: ["spin"],
    duration: 0.7,
    effects: [
      {
        type: "motion",
        params: { threeD: true, motionBlur: true },
        keys: { rotationX: throughCut(0, 90, -90, 0, 0.8), positionZ: spike(900, 0, 0.6) },
      },
    ],
  }),
  transition({
    type: "swing-3d",
    label: "3D Swing",
    tags: ["spin", "slide"],
    duration: 0.7,
    effects: [
      {
        type: "motion",
        params: { threeD: true, motionBlur: true, anchor: [0, 0.5], position: [0, 0.5] },
        keys: { rotationY: throughCut(0, -100, 100, 0, 0.8) },
      },
    ],
  }),
  transition({
    type: "dolly-3d",
    label: "3D Push Through",
    tags: ["zoom"],
    duration: 0.6,
    // Rushes at the camera until it's behind it, and the next shot arrives from far away.
    effects: [{ type: "motion", params: { threeD: true, ...MOVING }, keys: { positionZ: throughCut(0, -1400, 4000, 0, 0.85) } }],
  }),
  // Sapphire S_Shake-style: a hit at the cut, blurred along its own path, colour split.
  transition({
    type: "shake-hit",
    label: "Shake Hit",
    tags: ["shake"],
    duration: 0.6,
    effects: [
      {
        type: "shake",
        params: { frequency: 12, amplitudeX: 0.06, amplitudeY: 0.06, rotation: 6, zoom: 0.08, tiltX: 8, tiltY: 8, jaggedness: 0.5, motionBlur: 1.5, chromaSplit: 0.5 },
        keys: { amount: spike(2, 0, 0.7) },
      },
    ],
  }),
  // Time effects: these show while playing and in the export (they need the frames before).
  transition({
    type: "ghost-zoom",
    label: "Ghost Zoom",
    tags: ["zoom", "blur"],
    duration: 0.6,
    effects: [
      { type: "motion", params: MOVING, keys: { scale: throughCut(1, 1.8, 0.6, 1) } },
      { type: "echo", params: { echoTime: -0.033, echoes: 5, startingIntensity: 1, decay: 0.65, operator: "maximum" } },
    ],
  }),
  transition({
    type: "datamosh-bloom",
    label: "Datamosh Bloom",
    tags: ["glitch"],
    duration: 1,
    // The incoming shot's motion drags the outgoing one's pixels until it breaks through.
    effects: [
      {
        type: "datamosh",
        params: { blockSize: 0.025, refresh: 0.03 },
        keys: { amount: [key(0, 0, "hold"), key(0.5, 1, "hold"), key(0.8, 1, "ease-out"), key(1, 0)] },
      },
    ],
  }),
];

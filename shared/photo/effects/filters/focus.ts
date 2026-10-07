/**
 * Lens Blur and Tilt-Shift: the picture's focus by its depth (Depth), read from its scene maps (`../../scene.ts`). Both
 * are one gather of circles of confusion (a real lens's: each point spread over a disc as large as it's out of focus,
 * nearer blurred points spreading over sharper ones behind them). Their references are
 * `../../reference/filters/focus.ts`, their WGSL `src/suites/photo/render/filters/focus.ts`.
 */
import type { EffectDefinition } from "../index.ts";
import { choice, degrees, diag, kernelFilter, look, n, percent, pixels, point } from "../kernel.ts";

/** The largest circle of confusion (its radius, document pixels): every read is within it. */
export const MAX_FOCUS_BLUR = 200;

const blurSize = (fraction: number) => (c: { width: number; height: number }) => diag(fraction, c, 0, MAX_FOCUS_BLUR);

const LENS_BLUR = kernelFilter({
  type: "lens-blur",
  label: "Lens Blur",
  description:
    "Depth of field from the picture's depth map, as Photoshop's Lens Blur and Neural Depth Blur: what's at the focus depth stays sharp and everything else blurs as a real lens would, more the farther it is from the focus, into discs (bokeh) in the aperture's shape. Focus On picks the depth kept sharp: Subject (the main subject's depth, found by Select Subject's model), Point (the depth at Focus Point; none is the canvas's centre) or Distance (Focus Distance, 0% the farthest in the picture, 100% the nearest). Focus Range is the band of depth around it kept sharp. Blur is the largest circle of confusion's radius in document pixels (reached at the depth farthest from the focus). Blurs: Background blurs only what's behind the focus (a portrait's look), Front & Back blurs what's in front too, spreading over the sharp picture behind it. Aperture is the bokeh's shape: Circle, Hexagon (six blades) or Anamorphic (tall ovals). Cat's Eye squeezes the bokeh towards the frame's edges, as a fast vintage lens does (a swirl). Highlights brightens out-of-focus light brighter than Threshold (encoded brightness), so small lights become bright discs. Needs the depth model.",
  category: "Depth",
  params: [
    choice("focusOn", "Focus On", [["subject", "Subject"], ["point", "Point"], ["distance", "Distance"]], "subject", "The depth kept sharp: the main subject's (Select Subject's model), the depth at Focus Point, or Focus Distance."),
    point("focus", "Focus Point", "With Focus On Point: where the picture is in focus (its depth is kept sharp). None is the canvas's centre."),
    percent("distance", "Focus Distance", 50, "With Focus On Distance: the depth kept sharp, 0% the farthest in the picture, 100% the nearest."),
    percent("range", "Focus Range", 10, "How much depth around the focus stays sharp: 0% a razor-thin plane, larger keeps more in focus."),
    pixels("blur", "Blur", 0, MAX_FOCUS_BLUR, 20, "The largest blur's radius in document pixels: how far the depth farthest from the focus spreads."),
    choice("side", "Blurs", [["background", "Background"], ["both", "Front & Back"]], "both", "Background: only what's behind the focus blurs. Front & Back: what's in front blurs too, over the sharp picture behind it."),
    choice("aperture", "Aperture", [["circle", "Circle"], ["hexagon", "Hexagon"], ["anamorphic", "Anamorphic"]], "circle", "The bokeh's shape: round, a six-bladed iris, or an anamorphic lens's tall ovals."),
    percent("catsEye", "Cat's Eye", 0, "Squeezes the bokeh into cat's-eye shapes towards the frame's edges, as a fast lens wide open: a swirl around the centre."),
    percent("highlights", "Highlights", 30, "Brightens out-of-focus light brighter than Threshold, so small lights bloom into bright bokeh discs. 0% leaves the light as it is."),
    percent("threshold", "Threshold", 90, "How bright (encoded) light must be for Highlights to brighten it."),
  ],
  reach: (p) => n(p, "blur"),
  scene: (p) => ({ depth: true, subject: p.focusOn === "subject" }),
  isIdentity: (p) => n(p, "blur") === 0,
  summary: (p) =>
    `${p.focusOn === "point" ? "focus on a point" : p.focusOn === "distance" ? `focus at ${n(p, "distance")}%` : "focus on the subject"}, ${n(p, "blur")} px${p.side === "background" ? ", background" : ""}${p.aperture !== "circle" ? `, ${p.aperture}` : ""}`,
  presets: [
    look("lens-blur", "Lens Blur", "The subject sharp, everything in front and behind it softly out of focus.", { focusOn: "subject", range: 10, side: "both", aperture: "circle", catsEye: 0, highlights: 30, threshold: 90 }, (c) => ({ blur: blurSize(0.015)(c) })),
    look("portrait", "Portrait", "A fast portrait lens: the subject crisp, the background melting into creamy blur.", { focusOn: "subject", range: 6, side: "background", aperture: "circle", catsEye: 0, highlights: 40, threshold: 88 }, (c) => ({ blur: blurSize(0.03)(c) })),
    look("shallow", "Shallow", "A thin plane of focus through the centre, front and back both falling away.", { focusOn: "point", range: 3, side: "both", aperture: "circle", catsEye: 0, highlights: 30, threshold: 90 }, (c) => ({ blur: blurSize(0.022)(c) })),
    look("bokeh-night", "Bokeh Night", "City lights behind the subject bloom into big bright discs.", { focusOn: "subject", range: 6, side: "background", aperture: "circle", catsEye: 20, highlights: 80, threshold: 80 }, (c) => ({ blur: blurSize(0.04)(c) })),
    look("macro", "Macro", "A macro lens: a sliver in focus at the centre, the rest dissolving into six-bladed bokeh.", { focusOn: "point", range: 1, side: "both", aperture: "hexagon", catsEye: 0, highlights: 50, threshold: 85 }, (c) => ({ blur: blurSize(0.05)(c) })),
    look("anamorphic", "Anamorphic", "A cinema lens: tall oval bokeh, squeezed towards the frame's edges.", { focusOn: "subject", range: 6, side: "both", aperture: "anamorphic", catsEye: 40, highlights: 60, threshold: 85 }, (c) => ({ blur: blurSize(0.035)(c) })),
  ],
});

const TILT_SHIFT = kernelFilter({
  type: "tilt-shift",
  label: "Tilt-Shift",
  description:
    "The miniature look of a tilt-shift lens: a band of the picture sharp, everything else blurring more and more away from it, so a real scene looks like a model. Mode Plane is Photoshop's Tilt-Shift blur: a straight band through Focus (none is the canvas's centre) at Angle (0° horizontal), Band its width in document pixels, the blur growing smoothly over Transition pixels beyond it. Mode Depth keeps a range of depths sharp instead, the depth at Focus: Depth Range wide, the blur growing over Depth Transition (both shares of the picture's depth), so the band follows the scene. Blur is the largest blur's radius in document pixels, Highlights brightens out-of-focus lights into bokeh, and Saturation and Contrast give the toy-like finish (0 leaves the colour as it is). Depth mode needs the depth model.",
  category: "Depth",
  params: [
    choice("mode", "Mode", [["plane", "Plane"], ["depth", "Depth"]], "plane", "Plane: a straight sharp band across the picture. Depth: the sharp band is a range of depths around Focus's, following the scene."),
    point("focus", "Focus", "Plane: a point the sharp band goes through. Depth: the point whose depth stays sharp. None is the canvas's centre."),
    degrees("angle", "Angle", 0, "Plane: the band's direction, 0° horizontal, 90° vertical."),
    pixels("band", "Band", 0, 4000, 120, "Plane: the sharp band's width in document pixels."),
    pixels("transition", "Transition", 0, 4000, 200, "Plane: how far beyond the band the blur takes to reach its full size, in document pixels."),
    percent("range", "Depth Range", 10, "Depth: how much depth around Focus's stays sharp."),
    percent("falloff", "Depth Transition", 30, "Depth: how much more depth the blur takes to reach its full size."),
    pixels("blur", "Blur", 0, MAX_FOCUS_BLUR, 12, "The largest blur's radius in document pixels."),
    percent("highlights", "Highlights", 30, "Brightens out-of-focus lights into bright bokeh discs. 0% leaves the light as it is."),
    percent("saturation", "Saturation", 30, "The miniature's colour: more saturated toy colours (negative washes them out).", -100, 100),
    percent("contrast", "Contrast", 20, "The miniature's punch: more contrast (negative flattens it).", -100, 100),
  ],
  reach: (p) => n(p, "blur"),
  scene: (p) => (p.mode === "depth" ? { depth: true, subject: false } : null),
  isIdentity: (p) => n(p, "blur") === 0 && n(p, "saturation") === 0 && n(p, "contrast") === 0,
  summary: (p) => `${p.mode === "depth" ? "depth band" : `${n(p, "angle")}° band`}, ${n(p, "blur")} px`,
  presets: [
    look("miniature", "Miniature", "The classic: a horizontal band in focus, blur above and below, toy-bright colour.", { mode: "plane", angle: 0, highlights: 30, saturation: 35, contrast: 20 }, (c) => ({ band: diag(0.08, c, 0, 4000), transition: diag(0.16, c, 0, 4000), blur: blurSize(0.018)(c) })),
    look("depth-miniature", "Depth Miniature", "A model village: the band of focus follows the scene's depth around the centre.", { mode: "depth", range: 12, falloff: 25, highlights: 40, saturation: 40, contrast: 25 }, (c) => ({ blur: blurSize(0.02)(c) })),
    look("vertical", "Vertical", "A vertical band of focus, the sides blurring away.", { mode: "plane", angle: 90, highlights: 30, saturation: 30, contrast: 15 }, (c) => ({ band: diag(0.06, c, 0, 4000), transition: diag(0.14, c, 0, 4000), blur: blurSize(0.016)(c) })),
    look("diagonal", "Diagonal", "A band of focus across the picture at an angle, a street seen from above.", { mode: "plane", angle: -25, highlights: 40, saturation: 40, contrast: 25 }, (c) => ({ band: diag(0.05, c, 0, 4000), transition: diag(0.12, c, 0, 4000), blur: blurSize(0.022)(c) })),
    look("subtle", "Subtle", "A gentle fall-off of focus top and bottom, the colour left nearly as it is.", { mode: "plane", angle: 0, highlights: 10, saturation: 10, contrast: 5 }, (c) => ({ band: diag(0.16, c, 0, 4000), transition: diag(0.25, c, 0, 4000), blur: blurSize(0.008)(c) })),
  ],
});

export const FOCUS_FILTERS: EffectDefinition[] = [LENS_BLUR, TILT_SHIFT];

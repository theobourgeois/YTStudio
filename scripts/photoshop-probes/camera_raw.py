"""
Camera Raw Filter's responses (docs/photo/camera-raw.md, CR0): runs the filter by script on test images we make,
with settings as Camera Raw's own keys (four-letter ids, from its scripting dictionary) or as XMP (`crs:` names, for
what the dictionary lacks: Glow, the point curves, Color Grading's wheels), and saves the results as PNGs in
data/photoshop-probes/camera-raw/. No clicks, no dialog: each run opens its own document and closes it unsaved.

    python3 scripts/photoshop-probes/camera_raw.py [group ...]      # groups: see jobs(); none = all
    python3 scripts/photoshop-probes/camera_raw.py --fixtures       # then: shared/photo/reference/camera-raw-fixtures.json
    python3 scripts/photoshop-probes/camera_raw.py --tables         # and: shared/photo/effects/camera-raw/measured.ts
"""
import os, sys, json
import numpy as np
from PIL import Image
from ps import OUT, ROOT, save_image, run_jsx, js

DIR = os.path.join(OUT, "camera-raw")
os.makedirs(DIR, exist_ok=True)

# The scripting dictionary's keys we use (Camera Raw.rsrc's AETE): name -> (char id, type).
KEYS = {
    "Temperature": ("Temp", "long"), "Tint": ("Tint", "long"), "Exposure2012": ("Ex12", "doub"),
    "Contrast2012": ("Cr12", "long"), "Highlights2012": ("Hi12", "long"), "Shadows2012": ("Sh12", "long"),
    "Whites2012": ("Wh12", "long"), "Blacks2012": ("Bk12", "long"), "Texture": ("CrTx", "long"),
    "Clarity2012": ("Cl12", "long"), "Dehaze": ("Dhze", "long"), "Vibrance": ("Vibr", "long"), "Saturation": ("Strt", "long"),
    "ParametricShadows": ("PC_S", "long"), "ParametricDarks": ("PC_D", "long"), "ParametricLights": ("PC_L", "long"),
    "ParametricHighlights": ("PC_H", "long"), "ParametricShadowSplit": ("PC_1", "long"),
    "ParametricMidtoneSplit": ("PC_2", "long"), "ParametricHighlightSplit": ("PC_3", "long"),
    "SharpenAmount": ("Shrp", "long"), "SharpenRadius": ("ShpR", "doub"), "SharpenDetail": ("ShpD", "long"),
    "SharpenMasking": ("ShpM", "long"), "LuminanceNoiseReduction": ("LNR ", "long"), "ColorNoiseReduction": ("CNR ", "long"),
    "SplitToningShadowHue": ("STSH", "long"), "SplitToningShadowSaturation": ("STSS", "long"),
    "SplitToningHighlightHue": ("STHH", "long"), "SplitToningHighlightSaturation": ("STHS", "long"),
    "SplitToningBalance": ("STB ", "long"), "ColorGradeMidtoneHue": ("CgMH", "long"), "ColorGradeMidtoneSat": ("CgMS", "long"),
    "ColorGradeShadowLum": ("CgSL", "long"), "ColorGradeMidtoneLum": ("CgML", "long"), "ColorGradeHighlightLum": ("CgHL", "long"),
    "ColorGradeBlending": ("CgBl", "long"), "ColorGradeGlobalHue": ("CgGH", "long"), "ColorGradeGlobalSat": ("CgGS", "long"),
    "ColorGradeGlobalLum": ("CgGL", "long"), "GrainAmount": ("GRNA", "long"), "GrainSize": ("GRNS", "long"),
    "GrainFrequency": ("GRNF", "long"), "PostCropVignetteAmount": ("PCVA", "long"), "PostCropVignetteMidpoint": ("PCVM", "long"),
    "PostCropVignetteRoundness": ("PCVR", "long"), "PostCropVignetteFeather": ("PCVF", "long"),
    "PostCropVignetteStyle": ("PCVS", "long"), "PostCropVignetteHighlightContrast": ("PCVH", "long"),
    "ConvertToGrayscale": ("CtoG", "bool"),
}
COLOURS = ["Red", "Orange", "Yellow", "Green", "Aqua", "Blue", "Purple", "Magenta"]
for i, c in enumerate(COLOURS):
    KEYS["HueAdjustment" + c] = ("HA_" + c[0], "long")
    KEYS["SaturationAdjustment" + c] = ("SA_" + c[0], "long")
    KEYS["LuminanceAdjustment" + c] = ("LA_" + c[0], "long")
    KEYS["GrayMixer" + c] = ("GM_" + c[0], "long")


# ---- test images ----------------------------------------------------------------------------------------------

def hsv_to_rgb(h, s, v):
    i = int(h * 6) % 6; f = h * 6 - int(h * 6)
    p, q, t = v * (1 - s), v * (1 - f * s), v * (1 - (1 - f) * s)
    return [(v, t, p), (q, v, p), (p, v, t), (p, q, v), (t, p, v), (v, p, q)][i]

PATCH = 16
HUES = 24
CHART_SV = [(s, v) for s in (0.25, 0.5, 0.75, 1.0) for v in (0.25, 0.5, 0.75, 1.0)]

def chart():
    """A grey ramp (256 steps, 2 px each, 32 rows) over 16 rows of 24 hues × (saturation, value) patches of 16 px,
    on a mid grey: what pointwise sliders do to every tone and colour."""
    w, h = 512, 32 + 8 + len(CHART_SV) * PATCH + 8
    img = np.full((h, w, 3), 118, np.uint8)
    img[:32] = np.repeat(np.arange(256), 2)[None, :, None]
    for r, (s, v) in enumerate(CHART_SV):
        for i in range(HUES):
            rgb = np.round(np.array(hsv_to_rgb(i / HUES, s, v)) * 255)
            y, x = 40 + r * PATCH, 8 + i * 20
            img[y:y + PATCH, x:x + PATCH] = rgb
    return img

def chart_cells():
    """[(label, y, x)]: where to read the chart (each patch's centre 8 × 8; the ramp's columns)."""
    cells = []
    for r, (s, v) in enumerate(CHART_SV):
        for i in range(HUES):
            cells.append(((i / HUES, s, v), 40 + r * PATCH + 4, 8 + i * 20 + 4))
    return cells

def locality():
    """The same ramp alone on mid grey, between two large black blocks and between two large white blocks: a local
    operator treats the same ramp differently."""
    out = {}
    for name, fill in (("plain", 118), ("dark", 0), ("bright", 255)):
        img = np.full((384, 640, 3), 118, np.uint8)
        if name != "plain":
            img[:160] = fill; img[224:] = fill
        img[176:208, 64:576] = np.repeat(np.arange(256), 2)[None, :, None]
        out[name] = img
    return out

def portrait():
    """A soft, backlit scene for the local sliders: a sky gradient, a dark figure, a bright window and a hard edge."""
    h, w = 512, 768
    y, x = np.mgrid[0:h, 0:w] / np.array([h, w])[:, None, None]
    sky = np.stack([0.55 + 0.4 * (1 - y), 0.65 + 0.3 * (1 - y), 0.85 + 0.1 * (1 - y)], -1)
    img = sky * 0.9
    d = ((x - 0.4) / 0.18) ** 2 + ((y - 0.55) / 0.35) ** 2
    img[d < 1] = np.array([0.18, 0.12, 0.1]) + 0.05 * np.sin(40 * x[d < 1])[:, None]
    img[(x > 0.7) & (y < 0.4)] = 1.0
    img[(y > 0.85)] = np.array([0.25, 0.3, 0.2]) + 0.15 * ((np.floor(x[y > 0.85] * 64) % 2))[:, None]
    noise = np.random.default_rng(3).normal(0, 0.012, img.shape)
    return np.clip((img + noise) * 255, 0, 255).astype(np.uint8)

def mixed():
    """Two identical ramps, one in a black half and one in a white half of the same image: a slider that adapts to
    the whole image treats them alike, a local one doesn't."""
    img = np.zeros((512, 1024, 3), np.uint8); img[:, 512:] = 255
    for x0 in (128, 640):
        img[240:272, x0:x0 + 256] = np.arange(256)[None, :, None]
    return img

BACKGROUNDS = (20, 50, 90, 118, 160, 200, 235)
FLATS = (8, 16, 24, 32, 48, 64, 80, 96, 112, 128, 144, 160, 176, 192, 208, 224, 240, 250)

def backgrounds():
    """CR2: a ramp on plain greys from dark to light, and on a picture half dark, half light: what Contrast and
    Whites adapt to (the same ramp moves with what the rest of the picture is)."""
    out = {}
    for g in BACKGROUNDS:
        img = np.full((512, 768, 3), g, np.uint8)
        img[240:272, 128:640] = np.repeat(np.arange(256), 2)[None, :, None]
        out["bg-%d" % g] = img
    img = np.full((512, 768, 3), 30, np.uint8); img[:, 384:] = 220
    img[240:272, 128:640] = np.repeat(np.arange(256), 2)[None, :, None]
    out["bg-split"] = img
    return out

def edge(width):
    """CR2: a vertical step from code 50 to 190 in the middle: how far a local slider reaches across an edge and the
    halo it leaves (at two sizes: its reach is a fraction of the picture's)."""
    img = np.full((width // 2, width, 3), 50, np.uint8); img[:, width // 2:] = 190
    return img

GRATING_PERIODS = (2, 4, 8, 16, 32, 64)

def grating(width=768):
    """CR2: horizontal bands of a vertical sine grating (±20 levels about 128) of periods 2 to 64 px: which detail
    sizes Texture and Clarity act on."""
    band = width // len(GRATING_PERIODS)
    img = np.full((width, width, 3), 128.0)
    x = np.arange(width)
    for i, period in enumerate(GRATING_PERIODS):
        img[i * band:(i + 1) * band] = (128 + 20 * np.sin(2 * np.pi * x / period))[None, :, None]
    return np.clip(np.round(img), 0, 255).astype(np.uint8)

def glow_targets():
    """CR3: a white disc on black (how far the glow spreads, its profile, its colour) and a ramp on black (which
    tones it takes: Range)."""
    h, w = 512, 768
    y, x = np.mgrid[0:h, 0:w]
    disc = np.zeros((h, w, 3), np.uint8)
    disc[(x - w // 2) ** 2 + (y - h // 2) ** 2 < 40 ** 2] = 255
    ramp = np.zeros((h, w, 3), np.uint8)
    ramp[200:312, 128:640] = np.repeat(np.arange(256), 2)[None, :, None]
    return {"glow-disc": disc, "glow-ramp": ramp}

def images():
    paths = {}
    def put(name, arr):
        p = os.path.join(DIR, "in-" + name + ".png")
        save_image(arr, p); paths[name] = p
    put("chart", chart())
    for k, v in locality().items():
        put("loc-" + k, v)
    put("loc-mixed", mixed())
    put("scene", portrait())
    small = np.asarray(Image.fromarray(portrait()).resize((384, 256), Image.LANCZOS))
    put("scene-small", small)
    for k, v in backgrounds().items():
        put(k, v)
    for g in FLATS:
        put("flat-%d" % g, np.full((96, 128, 3), g, np.uint8))
    put("edge", edge(1024))
    put("edge-big", edge(2048))
    put("grating", grating(768))
    for k, v in glow_targets().items():
        put(k, v)
    put("grating-big", np.asarray(Image.fromarray(grating(768)).resize((1536, 1536), Image.NEAREST)))
    return paths


# ---- running the filter --------------------------------------------------------------------------------------

def xmp(attrs, elements=""):
    a = " ".join('crs:%s="%s"' % (k, v) for k, v in attrs.items())
    return ('<x:xmpmeta xmlns:x="adobe:ns:meta/"><rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">'
            '<rdf:Description rdf:about="" xmlns:crs="http://ns.adobe.com/camera-raw-settings/1.0/" %s>%s'
            '</rdf:Description></rdf:RDF></x:xmpmeta>') % (a, elements)

def curve_element(name, points):
    lis = "".join("<rdf:li>%d, %d</rdf:li>" % (x, y) for x, y in points)
    return "<crs:%s><rdf:Seq>%s</rdf:Seq></crs:%s>" % (name, lis, name)

def job_js(src, out, settings, xmp_attrs=None, xmp_elements=""):
    lines = ["var d = new ActionDescriptor();"]
    for k, v in settings.items():
        cid, t = KEYS[k]
        if t == "doub": lines.append("d.putDouble(cTID(%s), %r);" % (js(cid), float(v)))
        elif t == "bool": lines.append("d.putBoolean(cTID(%s), %s);" % (js(cid), "true" if v else "false"))
        else: lines.append("d.putInteger(cTID(%s), %d);" % (js(cid), int(v)))
    if xmp_attrs or xmp_elements:
        lines.append("d.putString(cTID('XMPp'), %s);" % js(xmp(xmp_attrs or {}, xmp_elements)))
    return ("(function(){ var doc = openDoc(%s); %s executeAction(sTID('Adobe Camera Raw Filter'), d, DialogModes.NO);"
            " savePng(doc, %s); closeDoc(doc); })();") % (js(src), " ".join(lines), js(out))

def run(jobs, batch=12):
    """jobs: [(name, image, settings, xmp attrs, xmp elements)]. Skips results already on disk."""
    todo = [j for j in jobs if not os.path.exists(os.path.join(DIR, j[0] + ".png"))]
    for i in range(0, len(todo), batch):
        part = todo[i:i + batch]
        code = "\n".join(job_js(IMAGES[j[1]], os.path.join(DIR, j[0] + ".png"), j[2], j[3], j[4]) for j in part)
        run_jsx(code + "\nreturn 'ok';", timeout=900)
        print("ran", ", ".join(j[0] for j in part), flush=True)


# ---- what to run ---------------------------------------------------------------------------------------------

STEPS = (-100, -50, 50, 100)

def jobs():
    j = {}
    def add(group, name, image, settings=None, attrs=None, elements=""):
        j.setdefault(group, []).append((name, image, settings or {}, attrs, elements))
    for img in ("chart", "loc-plain", "loc-dark", "loc-bright", "loc-mixed", "scene", "scene-small"):
        add("identity", "identity-" + img, img)
    for ev in (-2, -1, -0.5, 0.5, 1, 2):
        add("light", "exposure%+g" % ev, "chart", {"Exposure2012": ev})
    for k, short in (("Contrast2012", "contrast"), ("Highlights2012", "highlights"), ("Shadows2012", "shadows"),
                     ("Whites2012", "whites"), ("Blacks2012", "blacks")):
        for v in STEPS:
            add("light", "%s%+d" % (short, v), "chart", {k: v})
    for k, short in (("Temperature", "temperature"), ("Tint", "tint"), ("Vibrance", "vibrance"), ("Saturation", "saturation")):
        for v in STEPS:
            add("color", "%s%+d" % (short, v), "chart", {k: v})
    add("color", "bw", "chart", {"ConvertToGrayscale": True})
    for k, short in (("ParametricShadows", "pshadows"), ("ParametricDarks", "pdarks"), ("ParametricLights", "plights"),
                     ("ParametricHighlights", "phighlights")):
        for v in STEPS:
            add("curve", "%s%+d" % (short, v), "chart", {k: v})
    for splits in ((10, 50, 75), (25, 30, 75), (25, 50, 90)):
        add("curve", "psplits-%d-%d-%d" % splits, "chart",
            {"ParametricDarks": 100, "ParametricLights": 100, "ParametricShadowSplit": splits[0],
             "ParametricMidtoneSplit": splits[1], "ParametricHighlightSplit": splits[2]})
    for name, pts in (("scurve", [(0, 0), (64, 40), (192, 215), (255, 255)]), ("lift", [(0, 40), (255, 255)]),
                      ("bump", [(0, 0), (128, 180), (255, 255)])):
        add("curve", "point-" + name, "chart", None, {}, curve_element("ToneCurvePV2012", pts))
    # Unverified: the channel curves (ToneCurvePV2012Red...) given this way change nothing; how to pass them is open.
    for c in COLOURS:
        for kind in ("Hue", "Saturation", "Luminance"):
            for v in (-100, 100):
                add("mixer", "%s-%s%+d" % (kind.lower(), c.lower(), v), "chart", {kind + "Adjustment" + c: v})
    for wheel, hk, sk, lk in (("shadows", "SplitToningShadowHue", "SplitToningShadowSaturation", "ColorGradeShadowLum"),
                              ("midtones", "ColorGradeMidtoneHue", "ColorGradeMidtoneSat", "ColorGradeMidtoneLum"),
                              ("highlights", "SplitToningHighlightHue", "SplitToningHighlightSaturation", "ColorGradeHighlightLum"),
                              ("global", "ColorGradeGlobalHue", "ColorGradeGlobalSat", "ColorGradeGlobalLum")):
        for hue in (0, 120, 240):
            for sat in (50, 100):
                add("grading", "grade-%s-h%d-s%d" % (wheel, hue, sat), "chart", {hk: hue, sk: sat})
        for lum in (-100, 100):
            add("grading", "grade-%s-l%+d" % (wheel, lum), "chart", {lk: lum})
    for blend in (0, 100):
        add("grading", "grade-blend%d" % blend, "chart",
            {"SplitToningShadowHue": 220, "SplitToningShadowSaturation": 100, "SplitToningHighlightHue": 40,
             "SplitToningHighlightSaturation": 100, "ColorGradeBlending": blend})
    for bal in (-100, 100):
        add("grading", "grade-balance%+d" % bal, "chart",
            {"SplitToningShadowHue": 220, "SplitToningShadowSaturation": 100, "SplitToningHighlightHue": 40,
             "SplitToningHighlightSaturation": 100, "SplitToningBalance": bal})
    add("grading", "grade-split-default", "chart",
        {"SplitToningShadowHue": 220, "SplitToningShadowSaturation": 100, "SplitToningHighlightHue": 40,
         "SplitToningHighlightSaturation": 100})
    # Local sliders: on the locality images (does it depend on neighbours?) and the scene (and its half size).
    for k, short in (("Highlights2012", "highlights"), ("Shadows2012", "shadows"), ("Whites2012", "whites"),
                     ("Blacks2012", "blacks"), ("Contrast2012", "contrast"), ("Texture", "texture"),
                     ("Clarity2012", "clarity"), ("Dehaze", "dehaze"), ("Exposure2012", "exposure")):
        v = 1 if k == "Exposure2012" else 100
        for img in ("loc-plain", "loc-dark", "loc-bright"):
            add("locality", "%s-%s" % (short, img), img, {k: v})
        for vv in ((-100, 100) if k not in ("Exposure2012", "Texture", "Blacks2012") else ()):
            add("locality", "%s%+d-loc-mixed" % (short, vv), "loc-mixed", {k: vv})
        for vv in ((-100, 100) if k != "Exposure2012" else ()):
            add("scene", "%s%+d-scene" % (short, vv), "scene", {k: vv})
            add("scene", "%s%+d-scene-small" % (short, vv), "scene-small", {k: vv})
    for amount in (-100, -50, 50, 100):
        add("effects", "vignette%+d" % amount, "chart", {"PostCropVignetteAmount": amount})
        add("effects", "vignette%+d-scene" % amount, "scene", {"PostCropVignetteAmount": amount})
    for k, v in (("PostCropVignetteMidpoint", 0), ("PostCropVignetteMidpoint", 100), ("PostCropVignetteRoundness", -100),
                 ("PostCropVignetteRoundness", 100), ("PostCropVignetteFeather", 0), ("PostCropVignetteFeather", 100),
                 ("PostCropVignetteHighlightContrast", 100)):
        add("effects", "vignette-50-%s%d" % (k.replace("PostCropVignette", "").lower(), v), "scene",
            {"PostCropVignetteAmount": -50, k: v})
    for style in (1, 2, 3):
        add("effects", "vignette-50-style%d" % style, "scene", {"PostCropVignetteAmount": -50, "PostCropVignetteStyle": style})
    for g in (50, 100):
        add("effects", "grain%d-scene" % g, "scene", {"GrainAmount": g})
    # GlowStyle is a number: 0 Diffusion (the default), 1 Bloom, 2 Halation (names are ignored).
    for style, n in (("diffusion", 0), ("bloom", 1), ("halation", 2)):
        for amount in (50, 100):
            add("effects", "glow-%s%d-scene" % (style, amount), "scene", None, {"Glow": amount, "GlowStyle": n})
    for k, v in (("GlowRange", 0), ("GlowRange", 100), ("GlowSpread", 0), ("GlowSpread", 100), ("GlowWarmth", -100), ("GlowWarmth", 100)):
        add("effects", "glow-bloom50-%s%d-scene" % (k[4:].lower(), v), "scene", None, {"Glow": 50, "GlowStyle": 1, k: v})
    for k, v in (("SharpenAmount", 150), ("LuminanceNoiseReduction", 100), ("ColorNoiseReduction", 100)):
        add("detail", "%s%d-scene" % (k.lower(), v), "scene", {k: v})
    # CR3: Glow on a disc and a ramp, by style, amount, range, spread and warmth (GlowStyle: 0 Diffusion, 1 Bloom, 2 Halation).
    for img in ("glow-disc", "glow-ramp"):
        add("glow", "identity-" + img, img)
        for style, n in (("diffusion", 0), ("bloom", 1), ("halation", 2)):
            for amount in (50, 100):
                add("glow", "glow-%s%d-%s" % (style, amount, img), img, None, {"Glow": amount, "GlowStyle": n})
            for k, v in (("GlowRange", 0), ("GlowRange", 100), ("GlowSpread", 0), ("GlowSpread", 100), ("GlowWarmth", -100), ("GlowWarmth", 100)):
                add("glow", "glow-%s100-%s%d-%s" % (style, k[4:].lower(), v, img), img, None, {"Glow": 100, "GlowStyle": n, k: v})
    # Order: pairs that don't commute.
    add("order", "exposure+1-contrast+50", "chart", {"Exposure2012": 1, "Contrast2012": 50})
    add("order", "saturation+50-shadowsgrade", "chart", {"Saturation": 50, "SplitToningShadowHue": 220, "SplitToningShadowSaturation": 100})
    add("order", "hue-red+100-curve-bump", "chart", {"HueAdjustmentRed": 100}, {}, curve_element("ToneCurvePV2012", [(0, 0), (128, 180), (255, 255)]))
    add("order", "temperature+50-saturation-100", "chart", {"Temperature": 50, "Saturation": -100})
    add("order", "exposure+1-pdarks+100", "chart", {"Exposure2012": 1, "ParametricDarks": 100})
    # CR2: what the adaptive and local sliders depend on.
    for img in ["bg-%d" % g for g in BACKGROUNDS] + ["bg-split"]:
        for k, short in (("Contrast2012", "contrast"), ("Whites2012", "whites"), ("Highlights2012", "highlights"), ("Shadows2012", "shadows")):
            for v in (-100, 100):
                add("adaptive", "%s%+d-%s" % (short, v, img), img, {k: v})
    # Highlights, Shadows and Dehaze on a flat picture: what they do to a tone with nothing around it.
    for g in FLATS:
        for k, short in (("Highlights2012", "highlights"), ("Shadows2012", "shadows"), ("Dehaze", "dehaze")):
            for v in (-100, -50, 50, 100):
                add("flats", "%s%+d-flat-%d" % (short, v, g), "flat-%d" % g, {k: v})
    for img in ("edge", "edge-big"):
        add("edges", "identity-" + img, img)
        for k, short in (("Highlights2012", "highlights"), ("Shadows2012", "shadows"), ("Clarity2012", "clarity"), ("Texture", "texture"),
                         ("Dehaze", "dehaze"), ("Contrast2012", "contrast"), ("Whites2012", "whites")):
            for v in (-100, 100):
                add("edges", "%s%+d-%s" % (short, v, img), img, {k: v})
    for img in ("grating", "grating-big"):
        add("gratings", "identity-" + img, img)
        for k, short in (("Texture", "texture"), ("Clarity2012", "clarity")):
            for v in (-100, -50, 50, 100):
                add("gratings", "%s%+d-%s" % (short, v, img), img, {k: v})
    return j


# ---- Auto (CR3) ----

AUTO_KEYS = {"Ex12": "Exposure2012", "Cr12": "Contrast2012", "Hi12": "Highlights2012", "Sh12": "Shadows2012", "Wh12": "Whites2012",
             "Bk12": "Blacks2012", "Vibr": "Vibrance", "Strt": "Saturation", "CrTx": "Texture", "Cl12": "Clarity2012", "Dhze": "Dehaze"}

def auto_settings(image_path):
    """Camera Raw's Auto on a picture: the settings it chooses (read back from what the filter returns)."""
    code = """(function(){ var doc = openDoc(%s); var d = new ActionDescriptor(); d.putBoolean(cTID('AuTn'), true);
var r = executeAction(sTID('Adobe Camera Raw Filter'), d, DialogModes.NO); var out = [];
for (var i = 0; i < r.count; i++) { var k = r.getKey(i); var id = app.typeIDToCharID(k); var t = r.getType(k);
  if (t == DescValueType.INTEGERTYPE) out.push(id + '=' + r.getInteger(k)); else if (t == DescValueType.DOUBLETYPE) out.push(id + '=' + r.getDouble(k)); }
closeDoc(doc); __result = out.join(','); })();""" % js(image_path)
    out = run_jsx("var __result = '';\n" + code + "\nreturn __result;")
    got = dict(kv.split("=") for kv in out.split(",") if kv)
    return {AUTO_KEYS[k]: float(v) for k, v in got.items() if k in AUTO_KEYS}


# ---- fixtures -------------------------------------------------------------------------------------------------

RAMP_LEVELS = list(range(0, 256, 4)) + [255]
FIXTURE_SV = [(0.5, 0.5), (0.5, 1.0), (1.0, 0.5), (1.0, 1.0)]

def fixtures():
    """The chart's results as shared/photo/reference/camera-raw-fixtures.json, which the tests read: for every
    run on the chart, the grey ramp at RAMP_LEVELS and 96 patches (24 hues at FIXTURE_SV), in 8-bit codes; for
    the mixed image, each local slider's ramp in its dark and its bright half."""
    from ps import load
    cells = [(i, c) for i, c in enumerate(chart_cells()) if (c[0][1], c[0][2]) in FIXTURE_SV]
    def read(name):
        a = load(os.path.join(DIR, name + ".png"))[..., :3]
        ramp = a[4:28].mean(axis=0).reshape(256, 2, 3).mean(axis=1)
        return ([[int(round(v)) for v in ramp[l]] for l in RAMP_LEVELS],
                [[int(round(v)) for v in a[y:y + 8, x:x + 8].mean(axis=(0, 1))] for _, (_, y, x) in cells])
    inputs = read("identity-chart")
    runs, settings = {}, {}
    for group, js_ in jobs().items():
        for name, image, keys, attrs, elements in js_:
            if image != "chart": continue
            ramp, patches = read(name)
            runs[name] = {"ramp": ramp, "patches": patches}
            settings[name] = {**(keys or {}), **{k: (float(v) if str(v).lstrip("+-").replace(".", "").isdigit() else v)
                                                 for k, v in (attrs or {}).items()}}
            if elements:
                import re
                curve = re.match(r"<crs:(\w+)>", elements).group(1)
                settings[name][curve] = [[int(a), int(b)] for a, b in re.findall(r"<rdf:li>(\d+), (\d+)</rdf:li>", elements)]
    local = {}
    for group, js_ in jobs().items():
        for name, image, keys, *_ in js_:
            if image != "loc-mixed": continue
            a = load(os.path.join(DIR, name + ".png"))[248:264, :, :3].mean(axis=(0, 2))
            local[name] = {"settings": keys, "dark": [int(round(a[128 + l])) for l in RAMP_LEVELS],
                           "bright": [int(round(a[640 + l])) for l in RAMP_LEVELS]}
    out = {"source": "Photoshop 27.11, Camera Raw 18.7 (process version 6), 8-bit sRGB (scripts/photoshop-probes/camera_raw.py)",
           "rampLevels": RAMP_LEVELS, "patchInputs": inputs[1], "identityRamp": inputs[0], "settings": settings}
    path = os.path.join(ROOT, "shared", "photo", "reference", "camera-raw-fixtures.json")
    with open(path, "w") as f:
        f.write("{\n" + ",\n".join(" %s: %s" % (json.dumps(k), json.dumps(v, separators=(",", ":"))) for k, v in out.items()))
        f.write(',\n "runs": {\n' + ",\n".join("  %s: %s" % (json.dumps(k), json.dumps(v, separators=(",", ":"))) for k, v in runs.items()))
        f.write('\n },\n "local": {\n' + ",\n".join("  %s: %s" % (json.dumps(k), json.dumps(v, separators=(",", ":"))) for k, v in local.items()))
        f.write("\n }\n}\n")
    print(path, os.path.getsize(path))


# ---- CR3's fits: the Color Mixer and Color Grading, from the fixtures' chart runs ----

def _fx():
    return json.load(open(os.path.join(ROOT, "shared", "photo", "reference", "camera-raw-fixtures.json")))

_M_S = np.array([[0.4360747, 0.3850649, 0.1430804], [0.2225045, 0.7168786, 0.0606169], [0.0139322, 0.0971045, 0.7141733]])
_M_P = np.array([[0.7976749, 0.1351917, 0.0313534], [0.2880402, 0.7118741, 0.0000857], [0, 0, 0.8252100]])
_S2P = np.linalg.inv(_M_P) @ _M_S
_P2S = np.linalg.inv(_S2P)

def _lin(v):
    v = np.asarray(v, float) / 255
    return np.where(v <= 0.04045, v / 12.92, ((v + 0.055) / 1.055) ** 2.4)

def _enc(l):
    l = np.clip(l, 0, None)
    return 255 * np.where(l <= 0.0031308, 12.92 * l, 1.055 * np.minimum(l, 1e9) ** (1 / 2.4) - 0.055)

MIXER_CENTRES = (0, 30, 60, 120, 180, 240, 270, 300)

def mixer_fits():
    """Each band's strength at ±100: hue (degrees), saturation (scale), luminance (HSL lightness), least squares."""
    import colorsys
    from scipy.optimize import least_squares
    fx = _fx()
    P0 = np.array(fx["patchInputs"], float)
    E = np.clip(_enc(_lin(P0) @ _S2P.T) / 255, 0, 1)
    hsv = np.array([colorsys.rgb_to_hsv(*e) for e in E]); hls = np.array([colorsys.rgb_to_hls(*e) for e in E])
    h0 = hsv[:, 0] * 360
    W = np.zeros((len(h0), 8))
    for j, hv in enumerate(h0):
        for i in range(8):
            a = MIXER_CENTRES[i]; b = MIXER_CENTRES[(i + 1) % 8] + (360 if i == 7 else 0); x = hv if hv >= a else hv + 360
            if a <= x < b:
                t = (x - a) / (b - a); W[j, i] += 1 - t; W[j, (i + 1) % 8] += t
    back = lambda rgb: np.clip(_enc(_lin(np.clip(rgb, 0, 1) * 255) @ _P2S.T), 0, 255)
    def apply(kind, band, amt, k):
        w = W[:, band]
        if kind == "luminance":
            L = np.clip(hls[:, 1] + w * amt * k * hls[:, 2] * 0.5, 0, 1)
            return back(np.array([colorsys.hls_to_rgb(a, b, c) for a, b, c in zip(hls[:, 0], L, hls[:, 2])]))
        h, sat = h0.copy(), hsv[:, 1].copy()
        if kind == "hue": h = (h + w * amt * k) % 360
        else: sat = np.clip(sat * (1 + w * amt * k), 0, 1)
        return back(np.array([colorsys.hsv_to_rgb(a / 360, b, c) for a, b, c in zip(h, sat, hsv[:, 2])]))
    out = {}
    for kind in ("hue", "saturation", "luminance"):
        out[kind] = {}
        for b, c in enumerate(COLOURS):
            ks = []
            for sgn in (-1, 1):
                M = np.array(fx["runs"]["%s-%s%+d" % (kind, c.lower(), sgn * 100)]["patches"], float)
                start = 30 if kind == "hue" else 0.5
                r = least_squares(lambda k: (apply(kind, b, sgn, k[0]) - M).ravel(), [start])
                ks.append(float(r.x[0]))
            # A side that doesn't fit (no move found) takes the other's.
            if kind == "hue" and min(ks) < 2: ks = [max(ks), max(ks)]
            out[kind][c] = ks
    return out

_M1 = np.array([[0.4122214708, 0.5363325363, 0.0514459929], [0.2119034982, 0.6806995451, 0.1073969566], [0.0883024619, 0.2817188376, 0.6299787005]])
_M2 = np.array([[0.2104542553, 0.7936177850, -0.0040720468], [1.9779984951, -2.4285922050, 0.4505937099], [0.0259040371, 0.7827717662, -0.8086757660]])

def _oklab(P):
    return np.cbrt(_lin(P) @ _M1.T) @ _M2.T

def grading_masks():
    """Each wheel's tint (OKLab a/b distance at full saturation, along hue 0's direction) and Luminance (OKLab L at ±100), by tone."""
    import colorsys
    fx = _fx()
    L = np.array(fx["rampLevels"], float); G = np.repeat(L[:, None], 3, 1)
    lab0 = _oklab(G)
    red = _oklab((np.array(colorsys.hsv_to_rgb(0, 1, 1)) * 255)[None])[0][1:]
    d = red / np.hypot(*red)
    out = {"levels": list(lab0[:, 0])}
    for wheel in ("shadows", "midtones", "highlights", "global"):
        R = np.array(fx["runs"]["grade-%s-h0-s100" % wheel]["ramp"], float)
        out[wheel] = {"tint": list((_oklab(R) - lab0)[:, 1:] @ d)}
        for l in (-100, 100):
            R = np.array(fx["runs"]["grade-%s-l%+d" % (wheel, l)]["ramp"], float)
            out[wheel]["lum%+d" % l] = list((_oklab(R) - lab0)[:, 0])
    return out


# ---- the measured tables the definition ships ------------------------------------------------------------------

def tables():
    """shared/photo/effects/camera-raw/measured.ts: what CR1's pointwise sections are built from (docs/photo/
    camera-raw.md, "What CR0 measured"), from the full-resolution grey ramps of the chart runs:
    - Exposure's tone coordinates V(code) in stops (0 at code 118), one fitted to the brightening runs and one to the
      darkening ones (V⁻¹(V(x) + ev) reproduces them);
    - Blacks', Contrast's, Whites' and the parametric curve's responses at −100, −50, 50 and 100 (code → code);
    - Temperature's and Tint's shifts of each ProPhoto channel in V at −100, −50, 50 and 100."""
    from ps import load
    def ramp(name):
        a = load(os.path.join(DIR, name + ".png"))[4:28, :, :3].mean(axis=0)
        return a.reshape(256, 2, 3).mean(axis=1)
    x = np.arange(256.0)
    def fit_v(evs, lam=0.05):
        rows, rhs = [], []
        for ev in evs:
            r = ramp("exposure%+g" % ev)[:, 0]
            for i in range(1, 256):
                y = r[i]
                if y < 0.6 or y > 254.4: continue
                row = np.zeros(256); j = int(np.floor(y)); f = y - j; row[j] += 1 - f
                if j < 255: row[j + 1] += f
                row[i] -= 1; rows.append(row); rhs.append(ev)
        S = np.zeros((254, 256))
        for i in range(254): S[i, i], S[i, i + 1], S[i, i + 2] = 1, -2, 1
        G = np.zeros((1, 256)); G[0, 118] = 1
        V, *_ = np.linalg.lstsq(np.vstack([np.array(rows), lam * S, 10 * G]), np.concatenate([rhs, np.zeros(254), [0]]), rcond=None)
        V = np.maximum.accumulate(V)
        for i in range(1, 256): V[i] = max(V[i], V[i - 1] + 1e-3)   # strictly increasing: invertible
        return V
    vp, vn = fit_v([0.5, 1, 2]), fit_v([-0.5, -1, -2])
    curves = {}
    for k in ("blacks", "contrast", "whites", "pshadows", "pdarks", "plights", "phighlights"):
        curves[k] = {s: ramp("%s%+d" % (k, s)).mean(axis=1) for s in (-100, -50, 50, 100)}
    # sRGB -> linear ProPhoto (D50, Bradford), as shared/photo/effects/camera-raw/colour.ts.
    m_s = np.array([[0.4360747, 0.3850649, 0.1430804], [0.2225045, 0.7168786, 0.0606169], [0.0139322, 0.0971045, 0.7141733]])
    m_p = np.array([[0.7976749, 0.1351917, 0.0313534], [0.2880402, 0.7118741, 0.0000857], [0, 0, 0.8252100]])
    s2p = np.linalg.inv(m_p) @ m_s
    lin = lambda v: np.where(v / 255 <= 0.04045, v / 255 / 12.92, ((v / 255 + 0.055) / 1.055) ** 2.4)
    enc = lambda l: 255 * np.where(l <= 0.0031308, 12.92 * l, 1.055 * np.clip(l, 0, None) ** (1 / 2.4) - 0.055)
    wb = {}
    for k in ("temperature", "tint"):
        wb[k] = {}
        for s in (50, -50, 100, -100):
            r = ramp("%s%+d" % (k, s)); out = enc(lin(r) @ s2p.T)
            d = np.stack([np.interp(out[:, c], x, vp) - np.interp(x, x, vp) for c in range(3)], 1)
            clean = (x >= 8) & (x <= 200) & (r.min(axis=1) > 2) & (r.max(axis=1) < 253)
            if clean.sum() >= 5:
                wb[k][s] = [float(np.median(d[clean, c])) for c in range(3)]
                continue
            # At ±100 Camera Raw's own result clips a channel at every level (temperature −100's red is 0): each
            # ProPhoto channel is read where its own sRGB channel isn't clipped, and one that never is from the ±50
            # run's proportions to the others.
            half = wb[k][s // 2]
            shifts = []
            for c in range(3):
                own = (x >= 8) & (x <= 200) & (r[:, c] > 2) & (r[:, c] < 253)
                shifts.append(float(np.median(d[own, c])) if own.sum() >= 5 else None)
            known = [c for c in range(3) if shifts[c] is not None]
            for c in range(3):
                if shifts[c] is None:
                    ratio = np.mean([shifts[o] / half[o] for o in known if abs(half[o]) > 1e-3])
                    shifts[c] = float(half[c] * ratio)
            wb[k][s] = shifts
        wb[k] = {s: wb[k][s] for s in (-100, -50, 50, 100)}
    def arr(a, d=3): return "[" + ",".join(("%." + str(d) + "f") % v for v in a) + "]"
    lines = ["/**",
             " * Camera Raw's measured responses (generated by `python3 scripts/photoshop-probes/camera_raw.py --tables` from",
             " * the CR0 runs in Photoshop 27.11, Camera Raw 18.7: docs/photo/camera-raw.md). Don't edit by hand.",
             " */",
             "",
             "/** Exposure's tone coordinate (stops, 0 at code 118) at each 8-bit code, fitted to the brightening runs. */",
             "export const V_BRIGHTEN = " + arr(vp, 4) + ";",
             "/** The same, fitted to the darkening runs (their white comes down: −2 stops takes 255 to 197). */",
             "export const V_DARKEN = " + arr(vn, 4) + ";",
             "",
             "/** Each tone slider's response (8-bit code → code, 256 entries) at −100, −50, 50 and 100, measured on the chart. */",
             "export const TONE_RESPONSES: Record<string, Record<number, number[]>> = {"]
    for k, by in curves.items():
        lines.append("  %s: {" % k)
        for s, v in by.items(): lines.append("    \"%d\": %s," % (s, arr(v, 2)))
        lines.append("  },")
    lines.append("};")
    lines.append("")
    lines.append("/** Temperature's and Tint's shift of each linear ProPhoto channel in the tone coordinate (stops), at −100, −50, 50, 100. */")
    lines.append("export const WHITE_BALANCE_SHIFTS: Record<string, Record<number, [number, number, number]>> = {")
    for k, by in wb.items():
        lines.append("  %s: { %s }," % (k, ", ".join("\"%d\": %s" % (s, arr(v, 4)) for s, v in by.items())))
    lines.append("};")
    mixer, grading = mixer_fits(), grading_masks()
    lines.append("")
    lines.append("/**")
    lines.append(" * The Color Mixer's strength per band (Red … Magenta), at −100 and +100 (CR3, fitted to CR0's runs): hue degrees turned")
    lines.append(" * on HSV of encoded ProPhoto, saturation's scale, HSL lightness's shift, each weighted by the band's share of the hue.")
    lines.append(" */")
    lines.append("export const MIXER_STRENGTH: Record<\"hue\" | \"saturation\" | \"luminance\", [number, number][]> = {")
    for kind in ("hue", "saturation", "luminance"):
        lines.append("  %s: [%s]," % (kind, ", ".join("[%.3f, %.3f]" % tuple(mixer[kind][c]) for c in COLOURS)))
    lines.append("};")
    lines.append("")
    lines.append("/**")
    lines.append(" * Color Grading (CR3, from CR0's runs, at Camera Raw's legacy Blending 100): for each wheel, at OKLab lightness `GRADING_LEVELS`,")
    lines.append(" * how far a full-saturation tint moves the colour (OKLab a/b distance), and the lightness its Luminance at −100 and +100 adds.")
    lines.append(" */")
    lines.append("export const GRADING_LEVELS = " + arr(grading["levels"], 4) + ";")
    lines.append("export const GRADING_MASKS: Record<\"shadows\" | \"midtones\" | \"highlights\" | \"global\", { tint: number[]; darker: number[]; lighter: number[] }> = {")
    for wheel in ("shadows", "midtones", "highlights", "global"):
        g = grading[wheel]
        lines.append("  %s: { tint: %s, darker: %s, lighter: %s }," % (wheel, arr(g["tint"], 4), arr(g["lum-100"], 4), arr(g["lum+100"], 4)))
    lines.append("};")
    path = os.path.join(ROOT, "shared", "photo", "effects", "camera-raw", "measured.ts")
    os.makedirs(os.path.dirname(path), exist_ok=True)
    open(path, "w").write("\n".join(lines) + "\n")
    print(path, os.path.getsize(path))


if __name__ == "__main__" and sys.argv[1:] == ["--tables"]:
    IMAGES = {}
    tables()
elif __name__ == "__main__" and sys.argv[1:] == ["--fixtures"]:
    IMAGES = {}
    fixtures()
elif __name__ == "__main__":
    IMAGES = images()
    J = jobs()
    groups = sys.argv[1:] or list(J)
    for g in groups:
        run(J[g])
else:
    IMAGES = {k: os.path.join(DIR, "in-" + k + ".png") for k in
              ("chart", "loc-plain", "loc-dark", "loc-bright", "loc-mixed", "scene", "scene-small", "edge", "edge-big", "grating", "grating-big",
               "bg-split", *["bg-%d" % g for g in BACKGROUNDS], *["flat-%d" % g for g in FLATS], "glow-disc", "glow-ramp")}

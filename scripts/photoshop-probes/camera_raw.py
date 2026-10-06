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
    # Order: pairs that don't commute.
    add("order", "exposure+1-contrast+50", "chart", {"Exposure2012": 1, "Contrast2012": 50})
    add("order", "saturation+50-shadowsgrade", "chart", {"Saturation": 50, "SplitToningShadowHue": 220, "SplitToningShadowSaturation": 100})
    add("order", "hue-red+100-curve-bump", "chart", {"HueAdjustmentRed": 100}, {}, curve_element("ToneCurvePV2012", [(0, 0), (128, 180), (255, 255)]))
    add("order", "temperature+50-saturation-100", "chart", {"Temperature": 50, "Saturation": -100})
    add("order", "exposure+1-pdarks+100", "chart", {"Exposure2012": 1, "ParametricDarks": 100})
    return j


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
              ("chart", "loc-plain", "loc-dark", "loc-bright", "loc-mixed", "scene", "scene-small")}

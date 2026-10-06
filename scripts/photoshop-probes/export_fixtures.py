"""
Samples of Photoshop's blending (from blend_modes.py and fill_probe.py's renders) as a small fixture the unit tests
read: shared/photo/reference/blend-fixtures.json. Rows are [backdrop r,g,b, layer r,g,b, out r,g,b] in 8-bit codes.
"""
import os, json
import numpy as np
from ps import OUT, load, ROOT
from blend_modes import MODES

d = os.path.join(OUT, "blend")
B = load(os.path.join(d, "backdrop.png"))[..., :3].astype(int)
S = load(os.path.join(d, "layer-a255.png"))[..., :3].astype(int)
ID = {"COLORBLEND": "color"}
def mode_id(m):
    return ID.get(m, {"COLORBURN": "color-burn", "LINEARBURN": "linear-burn", "DARKERCOLOR": "darker-color", "COLORDODGE": "color-dodge",
                      "LINEARDODGE": "linear-dodge", "LIGHTERCOLOR": "lighter-color", "SOFTLIGHT": "soft-light", "HARDLIGHT": "hard-light",
                      "VIVIDLIGHT": "vivid-light", "LINEARLIGHT": "linear-light", "PINLIGHT": "pin-light", "HARDMIX": "hard-mix"}.get(m, m.lower()))
def blend_fixtures():
    rng = np.random.default_rng(11)
    def rows(name, n):
        out = load(os.path.join(d, name + ".png"))[..., :3].astype(int)
        pts = [(int(y), int(x)) for y, x in zip(rng.integers(0, 256, n), rng.integers(0, 256, n))]          # grey grid
        pts += [(int(y), int(x)) for y, x in zip(rng.integers(0, 256, n), rng.integers(256, 512, n))]       # colour pairs
        # The grid's edges and Hard Mix's diagonal, where modes divide or tie.
        pts += [(0, 0), (255, 255), (0, 255), (255, 0), (128, 127), (127, 128), (200, 55), (55, 200)]
        return [[*B[y, x].tolist(), *S[y, x].tolist(), *out[y, x].tolist()] for y, x in pts]
    fx = {"source": "Photoshop 27.11, 8-bit sRGB (scripts/photoshop-probes)", "cases": []}
    for m in MODES:
        fx["cases"].append({"mode": mode_id(m), "opacity": 1, "fill": 1, "alpha": 1, "rows": rows(m.lower(), 16)})
        fx["cases"].append({"mode": mode_id(m), "opacity": 0.5, "fill": 1, "alpha": 1, "rows": rows("op50-" + m.lower(), 4)})
        fx["cases"].append({"mode": mode_id(m), "opacity": 1, "fill": 0.5, "alpha": 1, "rows": rows("fill50-" + m.lower(), 4)})
        fx["cases"].append({"mode": mode_id(m), "opacity": 1, "fill": 0.75, "alpha": 1, "rows": rows("fill75-" + m.lower(), 4)})
        fx["cases"].append({"mode": mode_id(m), "opacity": 1, "fill": 1, "alpha": 128 / 255, "rows": rows("alpha128-" + m.lower(), 4)})
    path = os.path.join(ROOT, "shared", "photo", "reference", "blend-fixtures.json")
    with open(path, "w") as f:
        f.write('{"source": ' + json.dumps(fx["source"]) + ',\n "cases": [\n' + ",\n".join("  " + json.dumps(c, separators=(",", ":")) for c in fx["cases"]) + "\n ]}\n")
    print(path, os.path.getsize(path))


if __name__ == "__main__" and not os.environ.get("STYLE") and not os.environ.get("BEVEL"):
    blend_fixtures()


def style_fixtures():
    """Profiles of Photoshop's effects (glow_profile.py, contour_probe.py, fx_batch.py) for reference/style.test.ts."""
    import numpy as np
    out = {"source": "Photoshop 27.11, 8-bit sRGB (scripts/photoshop-probes)"}
    g = json.load(open(os.path.join(OUT, "glow", "profiles.json")))
    # Outer Glow, white, Normal, 100%, over black, from a vertical edge: the first value is the first pixel outside.
    out["glow"] = {k: [int(v) for v in g[k][20:20 + int(k.split("-s")[1].split("-")[0]) + 4]] for k in
                   ["softMatte-s3", "softMatte-s20", "softMatte-s100", "preciseMatte-s5", "preciseMatte-s20", "preciseMatte-s100", "softMatte-s20-sp50", "preciseMatte-s20-sp25"]}
    c = json.load(open(os.path.join(OUT, "glow", "contours.json")))
    # Precise, Size 250, Range 50: one row is the contour; the first value is the first pixel outside.
    out["contours"] = {k: [int(v) for v in c[k]["profile"][20:270]] for k in ["linear", "cone-smooth", "cone-corner", "steps-corner", "five-smooth"]}
    load_ = lambda n: load(os.path.join(OUT, "fx2", n + ".png"))
    # Strokes on a disc of radius 70 centred at (160, 160), red over a white layer on black: row 160, R − G.
    out["stroke"] = {pos: (load_(f"stroke-{pos}-disc")[160, :, 0] - load_(f"stroke-{pos}-disc")[160, :, 1]).astype(int).tolist() for pos in ["outside", "inside", "center"]}
    # Inner Glow (red, Normal, 100%, Size 20) in a square 100..220 of a white layer: row 160, x 100.., R − G.
    out["innerGlow"] = {k: (load_(k)[160, 100:160, 0] - load_(k)[160, 100:160, 1]).astype(int).tolist() for k in ["innerglow-edge", "innerglow-center", "innerglow-edge-precise", "innerglow-edge-choke50"]}
    m = load_("shadow-multiply-35")[..., 0]
    out["multiplyShadow"] = int(np.median(m[(m > 50) & (m < 120)]))
    path = os.path.join(ROOT, "shared", "photo", "reference", "style-fixtures.json")
    with open(path, "w") as f:
        f.write("{\n" + ",\n".join(f" {json.dumps(k)}: {json.dumps(v, separators=(',', ':'))}" for k, v in out.items()) + "\n}\n")
    print(path, os.path.getsize(path))


if __name__ == "__main__" and os.environ.get("STYLE"):
    style_fixtures()


def bevel_fixtures():
    """Bevel & Emboss and Satin rows (fx_bevel.py's renders) for reference/style.test.ts: bevel-fixtures.json."""
    d = os.path.join(OUT, "fx3")
    out = {"source": "Photoshop 27.11, 8-bit sRGB (scripts/photoshop-probes/fx_bevel.py)",
           "setup": "A grey 128 layer on black, 320 x 320: a square 90..230 or a disc of radius 80 at (160, 160); highlight white Normal 100%, shadow black Normal 100%, Size 20, Depth 100, 120 deg / 30 deg; satin red Normal 100%, 19 deg, distance 11, size 14",
           "rows": {}}
    for name in sorted(os.listdir(d)):
        if not name.endswith(".png") or not (name.startswith("bevel-") or name.startswith("satin-")):
            continue
        im = load(os.path.join(d, name))
        key = name[:-4]
        # Row 160 and column 160 across the shape and 30 px past it, red (and green for satin).
        r = {"row": im[160, 50:271, 0].astype(int).tolist(), "column": im[50:271, 160, 0].astype(int).tolist()}
        if key.startswith("satin"):
            r["rowGreen"] = im[160, 50:271, 1].astype(int).tolist()
            r["columnGreen"] = im[50:271, 160, 1].astype(int).tolist()
        out["rows"][key] = r
    path = os.path.join(ROOT, "shared", "photo", "reference", "bevel-fixtures.json")
    with open(path, "w") as f:
        f.write('{\n "source": ' + json.dumps(out["source"]) + ',\n "setup": ' + json.dumps(out["setup"]) + ',\n "rows": {\n' + ",\n".join(f"  {json.dumps(k)}: {json.dumps(v, separators=(',', ':'))}" for k, v in out["rows"].items()) + "\n }\n}\n")
    print(path, os.path.getsize(path))


if __name__ == "__main__" and os.environ.get("BEVEL"):
    bevel_fixtures()

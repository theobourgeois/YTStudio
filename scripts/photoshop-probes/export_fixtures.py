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

"""Outer Glow's falloff from a straight edge: white, Normal, 100%, over black, so a pixel's value is the glow's coverage."""
import os, json
import numpy as np
from fx import probe_doc, OUT
from ps import save_image, load

d = os.path.join(OUT, "glow"); os.makedirs(d, exist_ok=True)
W, H, EDGE = 900, 600, 300
shape = os.path.join(d, "halfplane.png")
a = np.zeros((H, W, 4)); a[..., :3] = 255; a[:, :EDGE, 3] = 255
save_image(a, shape)

def glow(size, technique="softMatte", spread=0, contour=None, rng=100, extra=None):
    g = {"_class": "outerGlow", "enabled": True, "mode": {"enumType": "blendMode", "value": "normal"},
         "color": {"_class": "RGBColor", "red": 255, "grain": 255, "blue": 255}, "opacity": {"unit": "percentUnit", "value": 100},
         "glowTechnique": {"enumType": "matteTechnique", "value": technique}, "chokeMatte": {"unit": "pixelsUnit", "value": spread},
         "blur": {"unit": "pixelsUnit", "value": size}, "noise": {"unit": "percentUnit", "value": 0},
         "shadingNoise": {"unit": "percentUnit", "value": 0}, "antiAlias": False,
         "transferSpec": contour or {"_class": "shapeCurveType", "name": "Linear"}, "inputRange": {"unit": "percentUnit", "value": rng}}
    if extra: g.update(extra)
    return {"scale": {"unit": "percentUnit", "value": 100}, "outerGlow": g}

def run(name, fx):
    out = os.path.join(d, name + ".png")
    back = probe_doc(shape, fx, out)
    prof = load(out)[H // 2, EDGE - 20:, 0]
    return back, prof

if __name__ == "__main__":
    res = {}
    for tech in ("softMatte", "preciseMatte"):
        for size in (1, 2, 3, 5, 10, 20, 50, 100, 250):
            back, prof = run(f"{tech}-s{size}", glow(size, tech))
            res[f"{tech}-s{size}"] = prof.tolist()
        for spread in (25, 50, 100):
            back, prof = run(f"{tech}-s20-sp{spread}", glow(20, tech, spread))
            res[f"{tech}-s20-sp{spread}"] = prof.tolist()
            if spread == 50: print("spread read-back:", back["outerGlow"]["chokeMatte"])
    json.dump(res, open(os.path.join(d, "profiles.json"), "w"))
    for k, p in res.items():
        p = np.array(p); print(f"{k:24s}", " ".join(f"{int(v):3d}" for v in p[16:16 + 30]), "| zero at", int(np.argmax(p[20:] == 0)))

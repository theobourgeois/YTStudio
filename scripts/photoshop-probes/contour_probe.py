"""Contours read off a glow: Precise, Size 250, Range 50, so one row of pixels is the curve itself."""
import os, json
import numpy as np
from glow_profile import run, glow

def curve(points, name="probe"):
    return {"_class": "shapeCurveType", "name": name,
            "curve": [{"_class": "curvePoint", "horizontal": x, "vertical": y, **({"continuity": not corner})} for x, y, corner in points]}

CASES = {
    "linear": [(0, 0, False), (255, 255, False)],
    "cone-smooth": [(0, 0, False), (128, 255, False), (255, 0, False)],
    "cone-corner": [(0, 0, False), (128, 255, True), (255, 0, False)],
    "steps-smooth": [(0, 0, False), (64, 0, False), (68, 128, False), (192, 128, False), (196, 255, False), (255, 255, False)],
    "steps-corner": [(0, 0, False), (64, 0, True), (68, 128, True), (192, 128, True), (196, 255, True), (255, 255, False)],
    "five-smooth": [(0, 0, False), (64, 200, False), (128, 40, False), (192, 220, False), (255, 255, False)],
}
if __name__ == "__main__":
    res = {}
    for name, pts in CASES.items():
        back, prof = run(f"contour-{name}", glow(250, "preciseMatte", contour=curve(pts), rng=50))
        res[name] = {"profile": prof.tolist(), "back": back["outerGlow"]["transferSpec"]}
    json.dump(res, open(os.path.join(os.path.dirname(os.path.abspath(__file__)), "../../data/photoshop-probes/glow/contours.json"), "w"))
    print(json.dumps(res["cone-corner"]["back"])[:400])
    for name, r in res.items():
        p = np.array(r["profile"])[20:]
        print(f"{name:13s}", " ".join(f"{int(v):3d}" for v in p[:250:10]))

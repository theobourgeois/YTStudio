import json, os
import numpy as np
from scipy.interpolate import CubicSpline
from ps import OUT
R = json.load(open(os.path.join(OUT, "glow", "contours.json")))
lin = np.array(R["linear"]["profile"], float)[20:270]
u = lin / 255 * 255   # contour input (0..255) at each pixel, read off the linear contour
def check(name, pts, kinds):
    got = np.array(R[name]["profile"], float)[20:270]
    xs, ys = zip(*pts)
    for kind in kinds:
        if kind == "natural": f = CubicSpline(xs, ys, bc_type="natural")
        elif kind == "not-a-knot": f = CubicSpline(xs, ys) if len(xs) > 3 else CubicSpline(xs, ys, bc_type="natural")
        elif kind == "clamped0": f = CubicSpline(xs, ys, bc_type="clamped")
        want = np.clip(np.round(f(u)), 0, 255)
        sel = (u > 3) & (u < 252)
        print(f"{name:13s} {kind:11s} maxerr {np.abs(want - got)[sel].max():5.1f} mean {np.abs(want - got)[sel].mean():.2f}")
check("cone-smooth", [(0, 0), (128, 255), (255, 0)], ["natural", "clamped0"])
check("five-smooth", [(0, 0), (64, 200), (128, 40), (192, 220), (255, 255)], ["natural", "not-a-knot", "clamped0"])
check("steps-smooth", [(0, 0), (64, 0), (68, 128), (192, 128), (196, 255), (255, 255)], ["natural", "not-a-knot"])

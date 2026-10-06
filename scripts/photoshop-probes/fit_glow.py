import json, os
import numpy as np
from scipy.optimize import minimize_scalar
from ps import OUT
P = json.load(open(os.path.join(OUT, "glow", "profiles.json")))
EDGE_I = 20  # index of the first pixel outside (x = EDGE)

def step(n=4000, edge=2000):
    a = np.zeros(n); a[:edge] = 1; return a

def box(a, w):
    """Box of fractional width w (centred), by integrating a piecewise-constant signal."""
    c = np.concatenate([[0], np.cumsum(a)]); n = len(a); x = np.arange(n) + 0.5
    def F(t):
        t = np.clip(t, 0, n); i = np.floor(t).astype(int); i = np.minimum(i, n - 1); return c[i] + (t - i) * a[i]
    return (F(x + w / 2) - F(x - w / 2)) / w

def model(kind, p, length=60):
    a = step()
    if kind.startswith("box"):
        k = int(kind[3:]); 
        for _ in range(k): a = box(a, p)
    elif kind == "gauss":
        from scipy.ndimage import gaussian_filter1d; a = gaussian_filter1d(a, p, mode="nearest")
    return a[2000:2000 + length]

for size in (3, 5, 10, 20, 50, 100, 250):
    prof = np.array(P[f"softMatte-s{size}"], float)[EDGE_I:EDGE_I + min(size + 10, 260)] / 255
    out = []
    for kind in ("box1", "box2", "box3", "gauss"):
        L = len(prof)
        f = lambda p: np.abs(np.round(model(kind, p, L) * 255) - prof * 255).max()
        r = minimize_scalar(lambda p: np.mean((model(kind, p, L) - prof) ** 2), bounds=(0.3, 3 * size + 5), method="bounded")
        out.append(f"{kind} p={r.x:7.3f} (p/size {r.x/size:5.3f}) maxerr {f(r.x):3.0f}")
    print(f"soft size {size:3d}: " + " | ".join(out))
for size in (5, 10, 20, 50, 100, 250):
    prof = np.array(P[f"preciseMatte-s{size}"], float)[EDGE_I:EDGE_I + size + 3]
    d = np.arange(len(prof)) + 0.5
    for name, want in {"0.5*(1-d/S)": 127.5 * (1 - d / size), "0.5*(1-(d-.5)/S)*..": 127.5 * (1 - (d + 0) / (size + 0.5)),
                       "(S-d)/(2S+1)?": 255 * np.clip((size - d + 0.5) / (2 * size + 1), 0, 1)}.items():
        print(f"precise {size:3d} {name:22s} maxerr {np.abs(np.round(np.clip(want,0,255)) - prof).max():.0f}")

print("== softer with spread: dilate by round(S*sp), then box2 of width S - that")
for sp in (25, 50):
    S = 20
    prof = np.array(P[f"softMatte-s20-sp{sp}"], float)[EDGE_I:EDGE_I + 30]
    for rnd in (round, np.floor, np.ceil, lambda x: x):
        g = rnd(S * sp / 100)
        a = step(); a[:2000 + int(np.floor(g))] = 1
        if g != int(g): a[2000 + int(np.floor(g))] = g - np.floor(g)
        w = S - g
        a = box(box(a, w), w)
        m = np.round(a[2000:2030] * 255)
        print(f"  sp{sp} g={g:5.2f} maxerr {np.abs(m - prof).max():.0f}")
print("== precise with spread: (S-k)/((2-sp)S+2)")
for sp in (0, 25, 50, 100):
    S = 20; prof = np.array(P[f"preciseMatte-s20-sp{sp}"] if sp else P["preciseMatte-s20"], float)[EDGE_I:EDGE_I + 30]
    k = np.arange(30); want = np.round(np.clip((S - k) / ((2 - sp / 100) * S + 2), 0, 1) * 255)
    print(f"  sp{sp} maxerr {np.abs(want - prof).max():.0f}", (want - prof)[:24].astype(int).tolist() if np.abs(want - prof).max() > 1 else "")

import os
import numpy as np
from ps import OUT, load
d = os.path.join(OUT, "blend")
B8 = load(os.path.join(d, "backdrop.png"))[:, 256:, :3].reshape(-1, 3); S8 = load(os.path.join(d, "layer-a255.png"))[:, 256:, :3].reshape(-1, 3)
best = []
for mode, sign in (("darkercolor", 1), ("lightercolor", -1)):
    out = load(os.path.join(d, mode + ".png"))[:, 256:, :3].reshape(-1, 3)
    cs = np.all(out == S8, -1) & ~np.all(out == B8, -1)
    cb = np.all(out == B8, -1) & ~np.all(out == S8, -1)
    diff = (S8 - B8)  # lum(s) - lum(b) = diff·w
    # darker: chose s => diff·w <= 0 ; chose b => diff·w >= 0
    best.append((sign, diff, cs, cb))
res = []
for wr in np.arange(0.20, 0.36, 0.0025):
    for wg in np.arange(0.50, 0.75, 0.0025):
        wb = 1 - wr - wg
        if wb < 0: continue
        w = np.array([wr, wg, wb]); n = 0
        for sign, diff, cs, cb in best:
            v = sign * (diff @ w)
            n += int((cs & (v > 0)).sum() + (cb & (v < 0)).sum())
        res.append((n, round(wr, 4), round(wg, 4), round(wb, 4)))
res.sort()
print(res[:12])

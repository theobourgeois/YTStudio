import os
import numpy as np
from ps import OUT, load
d = os.path.join(OUT, "fx2")
g = lambda n: load(os.path.join(d, n + ".png"))
yy, xx = np.mgrid[0:320, 0:320] + 0.5
r = np.hypot(xx - 160, yy - 160)
for pos, (lo, hi) in {"outside": (70, 80), "inside": (60, 70), "center": (65, 75)}.items():
    im = g(f"stroke-{pos}-disc")
    red = im[..., 0] - im[..., 1]          # stroke is red: red minus green (white layer has both)
    cov = np.clip(hi - r + 0.5, 0, 1) * np.clip(r - lo + 0.5, 0, 1)
    print(f"disc {pos:8s} vs euclid band [{lo},{hi}] ± AA: maxerr {np.abs(np.round(cov*255) - red).max():.0f}, mean {np.abs(np.round(cov*255) - red).mean():.3f}")
    row = red[160, 160 + lo - 3:160 + hi + 3]; print("   row:", row.astype(int).tolist())
im = g("stroke-outside-square")
print("square outside corner diag (from 220,220 outward):", [int(im[220 + k, 220 + k, 0]) for k in range(0, 12)], " -> round corner if ~10/sqrt2=7 px")
print("square outside edge row:", im[160, 215:235, 0].astype(int).tolist())
print("square inside row:", (g('stroke-inside-square')[160, 205:225, 0] - g('stroke-inside-square')[160, 205:225, 1]).astype(int).tolist())
for a in (0, 90, 120):
    im = g(f"shadow-a{a}")[..., 0]
    m = (im > 128) & ~((xx > 100) & (xx < 220) & (yy > 100) & (yy < 220))
    ys, xs = np.nonzero(m)
    print(f"shadow angle {a}: shadow pixels' extent x {xs.min()}..{xs.max()}  y {ys.min()}..{ys.max()}")
v = g("shadow-multiply-35")[60, 60 + 60]   # a pixel under the shadow only? find one
im = g("shadow-multiply-35")[..., 0]
print("multiply 35% black over 128: values seen:", sorted(set(im[::7, ::7].astype(int).ravel().tolist()))[:8], "(encoded 83, linear 104)")
a, b = g("noise-a"), g("noise-b")
print("noise repeatable between two renders:", np.abs(a - b).max(), " noise present:", np.abs(np.diff(a[160, 225:250, 0])).max())
for n in ("innerglow-edge", "innerglow-center", "innerglow-edge-precise", "innerglow-edge-choke50"):
    im = g(n); red = im[160, 100:160, 0] - im[160, 100:160, 1]
    print(f"{n:24s}", red[:30].astype(int).tolist())

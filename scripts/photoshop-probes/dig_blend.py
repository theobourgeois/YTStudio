import os, itertools
import numpy as np
from ps import OUT, load
import formulas as F
d = os.path.join(OUT, "blend")
B8 = load(os.path.join(d, "backdrop.png"))[..., :3]; S8 = load(os.path.join(d, "layer-a255.png"))[..., :3]
B = B8 / 255; S = S8 / 255
g = lambda n: load(os.path.join(d, n + ".png"))[..., :3]

# Hard Mix: where does b+s==1 (in codes, sum 255) go?
hm = g("hardmix")[:, :256, 0]
x = np.arange(256)[None, :]; y = np.arange(256)[:, None]
tie = (x + y == 255)
print("hardmix on tie: white where b>127?", np.all((hm[tie] == 255) == (np.broadcast_to(x, hm.shape)[tie] > 127)),
      " values on tie (b,s,out) sample:", [(int(a), 255 - int(a), int(hm[255 - a, a])) for a in (0, 100, 127, 128, 200, 255)])
off = (x + y != 255) & (hm != np.where(x + y > 255, 255, 0))
print("hardmix mismatches off the tie (grey):", off.sum())
hmc = g("hardmix")[:, 256:]
for rule in ["sum>=255", "sum>255", "tiebreak b>127"]:
    s = B8[:, 256:] + S8[:, 256:]
    if rule == "sum>=255": w = s >= 255
    elif rule == "sum>255": w = s > 255
    else: w = (s > 255) | ((s == 255) & (B8[:, 256:] > 127))
    print(f"hardmix colour {rule:15s} mismatches", int((hmc != np.where(w, 255, 0)).sum()))

# Darker / Lighter colour: which weights?
cands = {"0.3/0.59/0.11": (0.3, 0.59, 0.11), "601": (0.299, 0.587, 0.114), "709": (0.2126, 0.7152, 0.0722), "sum": (1, 1, 1),
         "blendif gray .299/.590/.111": (0.299, 0.59, 0.111)}
for name, w in cands.items():
    for mode, cmp in (("darkercolor", np.less), ("lightercolor", np.greater)):
        got = g(mode)[:, 256:]
        ls, lb = F.lum(S8[:, 256:], w), F.lum(B8[:, 256:], w)
        want = np.where(cmp(ls, lb)[..., None], S8[:, 256:], B8[:, 256:])
        want2 = np.where((cmp(ls, lb) | (ls == lb))[..., None], S8[:, 256:], B8[:, 256:])
        print(f"{mode:13s} {name:28s} mismatched px {int(np.any(got != want, -1).sum()):6d}  (ties to layer: {int(np.any(got != want2, -1).sum())})")

# Component modes: weights and rounding
for w in [(0.3, 0.59, 0.11), (0.299, 0.587, 0.114), (0.2126, 0.7152, 0.0722)]:
    W = w
    fs = {"hue": lambda b, s: F.set_lum(F.set_sat(s, F.sat(b)), F.lum(b, W), W),
          "saturation": lambda b, s: F.set_lum(F.set_sat(b, F.sat(s)), F.lum(b, W), W),
          "colorblend": lambda b, s: F.set_lum(s, F.lum(b, W), W),
          "luminosity": lambda b, s: F.set_lum(b, F.lum(s, W), W)}
    print(w, {m: (float(np.abs(g(m)[:, 256:] - np.round(f(B[:, 256:], S[:, 256:]) * 255)).max()),
                  round(float(np.abs(g(m)[:, 256:] - np.round(f(B[:, 256:], S[:, 256:]) * 255)).mean()), 3)) for m, f in fs.items()})

import os, sys
import numpy as np
from ps import OUT, load
from formulas import SEPARABLE, NONSEP, soft_light_ps, vivid

d = os.path.join(OUT, "blend")
B = load(os.path.join(d, "backdrop.png"))[..., :3] / 255
S = load(os.path.join(d, "layer-a255.png"))[..., :3] / 255

def report(name, f, sep=True, region=slice(None)):
    got = load(os.path.join(d, name + ".png"))[..., :3]
    want = np.round(f(B, S) * 255) if True else None
    e = np.abs(got - want)[:, region]
    return e.max(), e.mean(), np.argwhere(e == e.max())[0][:2]

for m, f in {**SEPARABLE, **NONSEP}.items():
    mx, mean, at = report(m, f)
    print(f"{m:13s} max {mx:5.0f}  mean {mean:6.3f}  worst at y,x={tuple(at)}")
print("softlight-ps", report("softlight", soft_light_ps)[:2])
print("vivid-w3c", report("vividlight", vivid)[:2])

import os
import numpy as np
from ps import OUT, load
import formulas as F
d = os.path.join(OUT, "blend")
B = load(os.path.join(d, "backdrop.png"))[..., :3] / 255
S = load(os.path.join(d, "layer-a255.png"))[..., :3] / 255
g = lambda n: load(os.path.join(d, n + ".png"))[..., :3]
ALL = {**F.SEPARABLE, **F.NONSEP}
def err(got, want):
    e = np.abs(got - np.round(np.clip(want, 0, 1) * 255)); return float(e.max()), round(float(e.mean()), 3)

print("Normal 50% opacity, white over black, grey grid row 255 col 0:", g("op50-normal")[255, 0], "(128 = encoded mix, 188 = linear)")
print("== opacity 50: lerp(b, B, .5) encoded")
for m, f in ALL.items():
    print(f"  {m:13s}", err(g("op50-" + m), B + (f(B, S) - B) * 0.5))
special = {
    "colorburn": lambda b, s, f: F.color_burn(b, 1 - f * (1 - s)),
    "linearburn": lambda b, s, f: b - f * (1 - s),
    "colordodge": lambda b, s, f: F.color_dodge(b, f * s),
    "lineardodge": lambda b, s, f: b + f * s,
    "difference": lambda b, s, f: np.abs(b - f * s),
    "linearlight": lambda b, s, f: b + f * (2 * s - 1),
    "vividlight": lambda b, s, f: F.vivid_ps(b, 0.5 + f * (s - 0.5)) if f < 1 else F.vivid_ps(b, s),
    "hardmix": lambda b, s, f: np.clip((b - f * (1 - s)) / max(1 - f, 1e-9), 0, 1),
}
print("== fill f: ordinary modes as opacity f; special eight with the source pull")
for m, f in ALL.items():
    row = []
    for fill in (25, 50, 75):
        ff = fill / 100
        want = special[m](B, S, ff) if m in special else B + (f(B, S) - B) * ff
        row.append(err(g(f"fill{fill}-{m}"), want))
    print(f"  {m:13s}", row)
print("fill 0 = backdrop everywhere?", {m: float(np.abs(g('fill0-' + m) - B * 255).max()) for m in ALL})
print("== layer alpha 128 at 100/100: as opacity 128/255?")
a = 128 / 255
for m, f in ALL.items():
    want_op = B + (f(B, S) - B) * a
    want_fill = special[m](B, S, a) if m in special else want_op
    print(f"  {m:13s} as-opacity {err(g('alpha128-' + m), want_op)}  as-fill {err(g('alpha128-' + m), want_fill)}")

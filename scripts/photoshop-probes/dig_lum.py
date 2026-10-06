import os
import numpy as np
from ps import OUT, load
import formulas as F
d = os.path.join(OUT, "blend")
B8 = load(os.path.join(d, "backdrop.png"))[:, 256:, :3]; S8 = load(os.path.join(d, "layer-a255.png"))[:, 256:, :3]
g = lambda n: load(os.path.join(d, n + ".png"))[:, 256:, :3]
dc, lc = g("darkercolor"), g("lightercolor")
chose_s_dark = np.all(dc == S8, -1) & ~np.all(dc == B8, -1)
chose_b_dark = np.all(dc == B8, -1) & ~np.all(dc == S8, -1)
def test(name, L):
    ls, lb = L(S8), L(B8)
    bad = (chose_s_dark & ~(ls <= lb)) | (chose_b_dark & ~(lb <= ls))
    # strict variants
    bad_strict = (chose_s_dark & ~(ls < lb)) | (chose_b_dark & ~(lb <= ls))
    print(f"{name:32s} contradictions {int(bad.sum()):4d}  strict-less {int(bad_strict.sum()):4d}")
r, gg, b = (S8[..., i] for i in range(3))
test("30/59/11 exact", lambda c: c[..., 0] * 30 + c[..., 1] * 59 + c[..., 2] * 11)
test("77/151/28 >>8", lambda c: (c[..., 0] * 77 + c[..., 1] * 151 + c[..., 2] * 28))
test("76/150/30", lambda c: (c[..., 0] * 76 + c[..., 1] * 150 + c[..., 2] * 30))
test("lab L* via linear 709 Y", lambda c: F.lum(((c / 255 + 0.055) / 1.055) ** 2.4, (0.2126, 0.7152, 0.0722)))
test("linear Y 601 weights", lambda c: F.lum(((c / 255 + 0.055) / 1.055) ** 2.4, (0.299, 0.587, 0.114)))
test("linear Y 0.3/.59/.11", lambda c: F.lum(((c / 255 + 0.055) / 1.055) ** 2.4, (0.3, 0.59, 0.11)))
# sRGB->XYZ Y (D65) on linear values, 709 primaries = same as 709 weights; try Photoshop's working space D50 Y
test("linear Y D50 (0.2225,0.7169,0.0606)", lambda c: F.lum(((c / 255 + 0.055) / 1.055) ** 2.4, (0.2225, 0.7169, 0.0606)))
# show some contradictions under 30/59/11
L = lambda c: c[..., 0] * 30 + c[..., 1] * 59 + c[..., 2] * 11
ls, lb = L(S8), L(B8)
bad = np.argwhere((chose_s_dark & ~(ls <= lb)) | (chose_b_dark & ~(lb <= ls)))[:8]
for y, x in bad: print("s", S8[y, x], int(ls[y, x]), " b", B8[y, x], int(lb[y, x]), " out", dc[y, x])

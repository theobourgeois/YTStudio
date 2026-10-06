"""Bevel & Emboss fixtures (every style × technique), Satin, gradient methods: data/photoshop-probes/fx3/."""
import os, json
import numpy as np
from fx import probe_doc, shape_png, OUT
from ps import save_image
from fx_batch import P, PC, RGB, MODE, LIN, FX

d = os.path.join(OUT, "fx3"); os.makedirs(d, exist_ok=True)
def grey_shape(path, kind, box, size=320, v=128):
    shape_png(path, kind, size, box)
    from PIL import Image
    im = np.asarray(Image.open(path)).astype(float); im[..., :3] = v; save_image(im, path)
disc = os.path.join(d, "disc.png"); grey_shape(disc, "disc", (160.0, 160.0, 80.0))
square = os.path.join(d, "square.png"); grey_shape(square, "square", (90, 90, 230, 230))

def bevel(style, tech, size=20, depth=100, direction="in", soften=0, angle=120, altitude=30, gloss=LIN):
    return FX(bevelEmboss={"_class": "bevelEmboss", "enabled": True,
        "highlightMode": MODE("normal"), "highlightColor": RGB(255, 255, 255), "highlightOpacity": PC(100),
        "shadowMode": MODE("normal"), "shadowColor": RGB(0, 0, 0), "shadowOpacity": PC(100),
        "bevelTechnique": {"enumType": "bevelTechnique", "value": tech}, "bevelStyle": {"enumType": "bevelEmbossStyle", "value": style},
        "useGlobalAngle": False, "localLightingAngle": P(angle, "angleUnit"), "localLightingAltitude": P(altitude, "angleUnit"),
        "strengthRatio": PC(depth), "blur": P(size), "bevelDirection": {"enumType": "bevelEmbossStampStyle", "value": direction},
        "transferSpec": gloss, "antialiasGloss": False, "softness": P(soften), "useShape": False, "useTexture": False})
CASES = {}
for style in ("outerBevel", "innerBevel", "emboss", "pillowEmboss"):
    for tech in ("softMatte", "preciseMatte", "slopeLimitMatte"):
        for shape_name, shape in (("disc", disc), ("square", square)):
            CASES[f"bevel-{style}-{tech}-{shape_name}"] = (shape, bevel(style, tech))
for depth in (50, 200, 500):
    CASES[f"bevel-innerBevel-softMatte-disc-depth{depth}"] = (disc, bevel("innerBevel", "softMatte", depth=depth))
CASES["bevel-innerBevel-softMatte-disc-soften5"] = (disc, bevel("innerBevel", "softMatte", soften=5))
CASES["bevel-innerBevel-preciseMatte-disc-size40"] = (disc, bevel("innerBevel", "preciseMatte", size=40))
CASES["bevel-innerBevel-slopeLimitMatte-disc-size40"] = (disc, bevel("innerBevel", "slopeLimitMatte", size=40))
CASES["satin-square"] = (square, FX(chromeFX={"_class": "chromeFX", "enabled": True, "mode": MODE("normal"), "color": RGB(255, 0, 0),
    "antiAlias": False, "invert": False, "opacity": PC(100), "localLightingAngle": P(19, "angleUnit"), "distance": P(11),
    "blur": P(14), "mappingShape": LIN}))
CASES["satin-disc-invert"] = (disc, FX(chromeFX={"_class": "chromeFX", "enabled": True, "mode": MODE("normal"), "color": RGB(255, 0, 0),
    "antiAlias": False, "invert": True, "opacity": PC(100), "localLightingAngle": P(19, "angleUnit"), "distance": P(11),
    "blur": P(14), "mappingShape": LIN}))

def grad(method, kind="linear", c0=(255, 0, 0), c1=(0, 0, 255), angle=0):
    return FX(gradientFill={"_class": "gradientFill", "enabled": True, "mode": MODE("normal"), "opacity": PC(100),
        "gradient": {"_class": "gradientClassEvent", "name": "probe", "gradientForm": {"enumType": "gradientForm", "value": "customStops"},
                     "interfaceIconFrameDimmed": 4096.0,
                     "colors": [{"_class": "colorStop", "color": RGB(*c0), "type": {"enumType": "colorStopType", "value": "userStop"}, "location": 0, "midpoint": 50},
                                {"_class": "colorStop", "color": RGB(*c1), "type": {"enumType": "colorStopType", "value": "userStop"}, "location": 4096, "midpoint": 50}],
                     "transparency": [{"_class": "transferSpec", "opacity": PC(100), "location": 0, "midpoint": 50},
                                      {"_class": "transferSpec", "opacity": PC(100), "location": 4096, "midpoint": 50}]},
        "angle": P(angle, "angleUnit"), "type": {"enumType": "gradientType", "value": kind}, "reverse": False, "dither": False,
        "gs99": {"enumType": "gradientInterpolationMethodType", "value": method}, "align": True, "scale": PC(100),
        "offset": {"_class": "paint", "horizontal": PC(0), "vertical": PC(0)}})
for method in ("classic", "perceptual", "linear", "smooth", "stripes"):
    CASES[f"gradient-{method}"] = (square, grad(method))
CASES["gradient-classic-bw"] = (square, grad("classic", c0=(0, 0, 0), c1=(255, 255, 255)))
for kind in ("radial", "angle", "reflected", "diamond"):
    CASES[f"gradient-{kind}"] = (square, grad("classic", kind, (0, 0, 0), (255, 255, 255)))
if __name__ == "__main__":
    back = {}
    for name, (shape, fx) in CASES.items():
        try:
            back[name] = probe_doc(shape, fx, os.path.join(d, name + ".png"))
        except Exception as e:
            back[name] = f"ERR {e}"; print(name, str(e)[:200])
    json.dump(back, open(os.path.join(d, "readback.json"), "w"), indent=1)
    for k in ("bevel-innerBevel-slopeLimitMatte-disc", "gradient-stripes", "gradient-radial"):
        v = back[k]; print(k, json.dumps({kk: vv for kk, vv in v.items() if 'Multi' not in kk})[:500] if isinstance(v, dict) else v)

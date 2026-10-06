"""Strokes, shadows, inner effects, noise: fixtures in data/photoshop-probes/fx2/."""
import os, json
import numpy as np
from fx import probe_doc, shape_png, OUT
from ps import load

d = os.path.join(OUT, "fx2"); os.makedirs(d, exist_ok=True)
disc = os.path.join(d, "disc.png"); shape_png(disc, "disc", 320, (160.0, 160.0, 70.0))
square = os.path.join(d, "square.png"); shape_png(square, "square", 320, (100, 100, 220, 220))
P = lambda v, u="pixelsUnit": {"unit": u, "value": v}
PC = lambda v: P(v, "percentUnit")
RGB = lambda r, g, b: {"_class": "RGBColor", "red": r, "grain": g, "blue": b}
MODE = lambda m: {"enumType": "blendMode", "value": m}
LIN = {"_class": "shapeCurveType", "name": "Linear"}
def FX(**k): return {"scale": PC(100), **k}

def stroke(style, size=10, colour=(255, 0, 0)):
    return FX(frameFX={"_class": "frameFX", "enabled": True, "style": {"enumType": "frameStyle", "value": style},
                       "paintType": {"enumType": "frameFill", "value": "solidColor"}, "mode": MODE("normal"),
                       "opacity": PC(100), "size": P(size), "color": RGB(*colour), "overprint": False})
def shadow(angle, dist=20, size=0, kind="dropShadow", spread=0, noise=0, opacity=100, mode="normal", colour=(255, 255, 255)):
    e = {"_class": kind, "enabled": True, "mode": MODE(mode), "color": RGB(*colour), "opacity": PC(opacity),
         "useGlobalAngle": False, "localLightingAngle": P(angle, "angleUnit"), "distance": P(dist), "chokeMatte": P(spread),
         "blur": P(size), "noise": PC(noise), "antiAlias": False, "transferSpec": LIN}
    if kind == "dropShadow": e["layerConceals"] = True
    return FX(**{kind: e})
def inner_glow(source="edgeGlow", size=20, choke=0, tech="softMatte"):
    return FX(innerGlow={"_class": "innerGlow", "enabled": True, "mode": MODE("normal"), "color": RGB(255, 0, 0), "opacity": PC(100),
                         "glowTechnique": {"enumType": "matteTechnique", "value": tech}, "chokeMatte": P(choke), "blur": P(size),
                         "noise": PC(0), "shadingNoise": PC(0), "antiAlias": False, "transferSpec": LIN, "inputRange": PC(100),
                         "innerGlowSource": {"enumType": "innerGlowSourceType", "value": source}})

CASES = {
    "stroke-outside-disc": (disc, stroke("outsetFrame")), "stroke-inside-disc": (disc, stroke("insetFrame")),
    "stroke-center-disc": (disc, stroke("centeredFrame")), "stroke-outside-square": (square, stroke("outsetFrame")),
    "stroke-inside-square": (square, stroke("insetFrame")), "stroke-center-square": (square, stroke("centeredFrame")),
    "stroke-outside-square-3": (square, stroke("outsetFrame", 3)),
    "shadow-a0": (square, shadow(0)), "shadow-a90": (square, shadow(90)), "shadow-a120": (square, shadow(120)),
    "shadow-a120-s20": (square, shadow(120, 20, 20)),
    "shadow-multiply-35": (square, shadow(120, 30, 0, opacity=35, mode="multiply", colour=(0, 0, 0))),
    "innershadow-a120": (square, shadow(120, 10, 10, "innerShadow", colour=(255, 0, 0))),
    "innerglow-edge": (square, inner_glow("edgeGlow")), "innerglow-center": (square, inner_glow("centerGlow")),
    "innerglow-edge-precise": (square, inner_glow("edgeGlow", tech="preciseMatte")),
    "innerglow-edge-choke50": (square, inner_glow("edgeGlow", choke=50)),
    "noise-a": (square, shadow(120, 0, 30, noise=50)), "noise-b": (square, shadow(120, 0, 30, noise=50)),
}
if __name__ == "__main__":
    back = {}
    for name, (shape, fx) in CASES.items():
        bg = (128, 128, 128) if name == "shadow-multiply-35" else (0, 0, 0)
        back[name] = probe_doc(shape, fx, os.path.join(d, name + ".png"), background=bg)
    json.dump(back, open(os.path.join(d, "readback.json"), "w"), indent=1)
    print("done", len(back))

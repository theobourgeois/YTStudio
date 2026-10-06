"""Every blend mode over a grey grid (backdrop x, layer y) and random colour pairs, 8-bit sRGB, at 100%."""
import sys
import numpy as np
from ps import OUT, save_image, run_jsx, js, load
import os

MODES = ["NORMAL", "DISSOLVE", "DARKEN", "MULTIPLY", "COLORBURN", "LINEARBURN", "DARKERCOLOR", "LIGHTEN", "SCREEN",
         "COLORDODGE", "LINEARDODGE", "LIGHTERCOLOR", "OVERLAY", "SOFTLIGHT", "HARDLIGHT", "VIVIDLIGHT", "LINEARLIGHT",
         "PINLIGHT", "HARDMIX", "DIFFERENCE", "EXCLUSION", "SUBTRACT", "DIVIDE", "HUE", "SATURATION", "COLORBLEND",
         "LUMINOSITY"]

def inputs(alpha=255):
    d = os.path.join(OUT, "blend")
    os.makedirs(d, exist_ok=True)
    g = np.arange(256)
    b = np.zeros((256, 512, 3)); s = np.zeros((256, 512, 4))
    b[:, :256, :] = g[None, :, None]           # backdrop: x
    s[:, :256, :3] = g[:, None, None]          # layer: y
    rng = np.random.default_rng(7)
    b[:, 256:, :] = rng.integers(0, 256, (256, 256, 3))
    s[:, 256:, :3] = rng.integers(0, 256, (256, 256, 3))
    s[..., 3] = alpha
    save_image(b, os.path.join(d, "backdrop.png"))
    save_image(s, os.path.join(d, f"layer-a{alpha}.png"))
    return d

def render(d, runs):
    """runs: list of (name, mode, opacity, fill, layerfile)."""
    code = []
    for name, mode, opacity, fill, layer in runs:
        code.append(f"""
          var doc = openDoc({js(os.path.join(d, 'backdrop.png'))});
          var l = addLayerFrom(doc, {js(os.path.join(d, layer))});
          l.blendMode = BlendMode.{mode}; l.opacity = {opacity}; l.fillOpacity = {fill};
          savePng(doc, {js(os.path.join(d, name + '.png'))});
          closeDoc(doc);""")
    return run_jsx("\n".join(code) + "\nreturn 'ok';")

if __name__ == "__main__":
    d = inputs(255)
    runs = [(f"{m.lower()}", m, 100, 100, "layer-a255.png") for m in MODES]
    print(render(d, runs))

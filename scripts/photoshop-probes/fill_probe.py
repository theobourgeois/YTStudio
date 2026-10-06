"""Fill vs Opacity vs the layer's own alpha, every mode; Normal's mixing space."""
import os
from blend_modes import MODES, inputs, render
if __name__ == "__main__":
    d = inputs(255); inputs(128)
    runs = []
    for m in MODES:
        for f in (0, 25, 50, 75):
            runs.append((f"fill{f}-{m.lower()}", m, 100, f, "layer-a255.png"))
        runs.append((f"op50-{m.lower()}", m, 50, 100, "layer-a255.png"))
        runs.append((f"alpha128-{m.lower()}", m, 100, 100, "layer-a128.png"))
    print(render(d, runs))

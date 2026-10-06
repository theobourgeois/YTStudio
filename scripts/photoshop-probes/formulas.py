"""Candidate blend formulas on [0, 1] values (W3C Compositing Level 1 and Photoshop's documented extras)."""
import numpy as np

def lum(c, w=(0.3, 0.59, 0.11)):
    return c[..., 0] * w[0] + c[..., 1] * w[1] + c[..., 2] * w[2]

def clip_color(c, w):
    l = lum(c, w)[..., None]
    n = c.min(-1, keepdims=True); x = c.max(-1, keepdims=True)
    c = np.where(n < 0, l + (c - l) * l / np.maximum(l - n, 1e-12), c)
    c = np.where(x > 1, l + (c - l) * (1 - l) / np.maximum(x - l, 1e-12), c)
    return c

def set_lum(c, l, w):
    d = l - lum(c, w)
    return clip_color(c + d[..., None], w)

def sat(c):
    return c.max(-1) - c.min(-1)

def set_sat(c, s):
    out = np.zeros_like(c)
    mx = c.max(-1, keepdims=True); mn = c.min(-1, keepdims=True)
    rng = mx - mn
    mid = np.where(rng > 0, (c - mn) * s[..., None] / np.where(rng > 0, rng, 1), 0)
    out = np.where(c == mx, s[..., None], mid)
    out = np.where(c == mn, 0, out)
    # when max == min every channel is 0
    out = np.where(rng > 0, out, 0)
    return out

def soft_light_w3c(b, s):
    d = np.where(b <= 0.25, ((16 * b - 12) * b + 4) * b, np.sqrt(b))
    return np.where(s <= 0.5, b - (1 - 2 * s) * b * (1 - b), b + (2 * s - 1) * (d - b))

def soft_light_ps(b, s):
    return np.where(s <= 0.5, 2 * b * s + b * b * (1 - 2 * s), np.sqrt(b) * (2 * s - 1) + 2 * b * (1 - s))

def color_burn(b, s):
    return np.where(b >= 1, 1, np.where(s <= 0, 0, 1 - np.minimum(1, (1 - b) / np.maximum(s, 1e-12))))

def color_dodge(b, s):
    return np.where(b <= 0, 0, np.where(s >= 1, 1, np.minimum(1, b / np.maximum(1 - s, 1e-12))))

def hard_light(b, s):
    return np.where(s <= 0.5, b * 2 * s, 1 - (1 - b) * (1 - (2 * s - 1)))

def vivid(b, s):
    return np.where(s <= 0.5, color_burn(b, 2 * s), color_dodge(b, 2 * s - 1))

def vivid_ps(b, s):
    # The layer's 0 and 1 win (blend-modes.md)
    r = vivid(b, s)
    r = np.where(s <= 0, 0, r)
    r = np.where(s >= 1, 1, r)
    return r

SEPARABLE = {
    "normal": lambda b, s: s,
    "darken": np.minimum,
    "multiply": lambda b, s: b * s,
    "colorburn": color_burn,
    "linearburn": lambda b, s: np.clip(b + s - 1, 0, 1),
    "lighten": np.maximum,
    "screen": lambda b, s: b + s - b * s,
    "colordodge": color_dodge,
    "lineardodge": lambda b, s: np.clip(b + s, 0, 1),
    "overlay": lambda b, s: hard_light(s, b),
    "softlight": soft_light_w3c,
    "hardlight": hard_light,
    "vividlight": vivid_ps,
    "linearlight": lambda b, s: np.clip(b + 2 * s - 1, 0, 1),
    "pinlight": lambda b, s: np.where(s <= 0.5, np.minimum(b, 2 * s), np.maximum(b, 2 * s - 1)),
    "hardmix": lambda b, s: np.where(b + s >= 1, 1.0, 0.0),
    "difference": lambda b, s: np.abs(b - s),
    "exclusion": lambda b, s: b + s - 2 * b * s,
    "subtract": lambda b, s: np.clip(b - s, 0, 1),
    "divide": lambda b, s: np.where(s <= 0, np.where(b <= 0, 0, 1), np.minimum(1, b / np.maximum(s, 1e-12))),
}

W = (0.3, 0.59, 0.11)
NONSEP = {
    "hue": lambda b, s: set_lum(set_sat(s, sat(b)), lum(b, W), W),
    "saturation": lambda b, s: set_lum(set_sat(b, sat(s)), lum(b, W), W),
    "colorblend": lambda b, s: set_lum(s, lum(b, W), W),
    "luminosity": lambda b, s: set_lum(b, lum(s, W), W),
    "darkercolor": lambda b, s: np.where((lum(s, W) < lum(b, W))[..., None], s, b),
    "lightercolor": lambda b, s: np.where((lum(s, W) > lum(b, W))[..., None], s, b),
}

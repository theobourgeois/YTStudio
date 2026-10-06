"""Pattern Overlay and Bevel's Texture: a coded pattern (each texel's colour says where it is), applied with different
origins, scales, phases and angles; and a bevel textured by a step. Renders into data/photoshop-probes/fx4/."""
import os, json, sys
import numpy as np
from fx import jsx, shape_png, OUT
from ps import save_image, js
from fx_batch import P, PC, RGB, MODE, LIN, FX

d = os.path.join(OUT, "fx4"); os.makedirs(d, exist_ok=True)
PW, PH = 16, 10

def coded_pattern(path):
    a = np.zeros((PH, PW, 4)); a[..., 3] = 255
    for y in range(PH):
        for x in range(PW):
            a[y, x, :3] = (x * 16 + 8, y * 25 + 12, 128)
    save_image(a, path)

def define(path, name):
    """Opens `path`, selects all and defines a pattern named `name`; returns its id."""
    return jsx(f"""
      var doc = openDoc({js(path)});
      doc.selection.selectAll();
      var dd = new ActionDescriptor(); var r = new ActionReference(); r.putClass(cTID('Ptrn'));
      dd.putReference(cTID('null'), r);
      var r2 = new ActionReference(); r2.putProperty(cTID('Prpr'), sTID('selection')); r2.putEnumerated(cTID('Dcmn'), cTID('Ordn'), cTID('Trgt'));
      dd.putReference(cTID('Usng'), r2);
      dd.putString(cTID('Nm  '), {js(name)});
      var res = executeAction(cTID('Mk  '), dd, DialogModes.NO);
      closeDoc(doc);
      return toJSON(dumpDesc(res));""")

def layer_doc(layer_png, fx, out_path, extra=""):
    bgp = out_path + ".bg.png"
    from PIL import Image
    w, h = Image.open(layer_png).size
    save_image(np.zeros((h, w, 3)), bgp)
    code = f"""
      var doc = openDoc({js(bgp)});
      var l = addLayerFrom(doc, {js(layer_png)});
      doc.activeLayer = l;
      {extra}
      setEffects({json.dumps(fx)});
      var back = getEffects();
      savePng(doc, {js(out_path)});
      closeDoc(doc);
      return toJSON(back);"""
    out = jsx(code)
    os.unlink(bgp)
    return json.loads(out)

if __name__ == "__main__":
    pat = os.path.join(d, "coded.png"); coded_pattern(pat)
    print(define(pat, "vaudio-coded")[:400])

def overlay(scale=100, align=True, phase=(0, 0), angle=0, name="vaudio-coded", pid=None):
    pattern = {"_class": "pattern", "name": name}
    if pid: pattern["ID"] = pid
    return FX(patternFill={"_class": "patternFill", "enabled": True, "mode": MODE("normal"), "opacity": PC(100),
        "pattern": pattern, "scale": PC(scale), "align": align, "angle": P(angle, "angleUnit"),
        "phase": {"_class": "paint", "horizontal": phase[0], "vertical": phase[1]}})

def texture_patterns():
    step = np.zeros((16, 16, 4)); step[..., 3] = 255; step[:, 8:, :3] = 255
    p1 = os.path.join(d, "step.png"); save_image(step, p1); define(p1, "vaudio-step")
    sine = np.zeros((32, 32, 4)); sine[..., 3] = 255
    v = np.round((0.5 + 0.5 * np.sin(2 * np.pi * (np.arange(32) + 0.5) / 32)) * 255)
    sine[..., :3] = v[None, :, None]
    p2 = os.path.join(d, "sine.png"); save_image(sine, p2); define(p2, "vaudio-sine")

def bevel_texture(name, tdepth=100, tscale=100, invert=False, depth=100, size=20, style="innerBevel", tech="softMatte", angle=120, altitude=30):
    return FX(bevelEmboss={"_class": "bevelEmboss", "enabled": True,
        "highlightMode": MODE("normal"), "highlightColor": RGB(255, 255, 255), "highlightOpacity": PC(100),
        "shadowMode": MODE("normal"), "shadowColor": RGB(0, 0, 0), "shadowOpacity": PC(100),
        "bevelTechnique": {"enumType": "bevelTechnique", "value": tech}, "bevelStyle": {"enumType": "bevelEmbossStyle", "value": style},
        "useGlobalAngle": False, "localLightingAngle": P(angle, "angleUnit"), "localLightingAltitude": P(altitude, "angleUnit"),
        "strengthRatio": PC(depth), "blur": P(size), "bevelDirection": {"enumType": "bevelEmbossStampStyle", "value": "in"},
        "transferSpec": LIN, "antialiasGloss": False, "softness": P(0), "useShape": False,
        "useTexture": True, "pattern": {"_class": "pattern", "name": name}, "scale": PC(tscale), "textureDepth": PC(tdepth),
        "invertTexture": invert, "align": True, "phase": {"_class": "paint", "horizontal": 0, "vertical": 0}})

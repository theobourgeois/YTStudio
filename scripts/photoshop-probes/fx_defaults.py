"""What Photoshop fills in for each effect given only {enab: true}: its stored defaults, keys and units."""
import os, json
from fx import shape_png, probe_doc, OUT
d = os.path.join(OUT, "fx"); os.makedirs(d, exist_ok=True)
shape = os.path.join(d, "square.png"); shape_png(shape)
KEYS = ["dropShadow", "innerShadow", "outerGlow", "innerGlow", "bevelEmboss", "chromeFX", "solidFill", "gradientFill", "patternFill", "frameFX"]
res = {}
for k in KEYS:
    try:
        back = probe_doc(shape, {"scale": {"unit": "percentUnit", "value": 100}, k: {"_class": k, "enabled": True}}, os.path.join(d, f"default-{k}.png"))
        res[k] = back
    except Exception as e:
        res[k] = f"ERR {e}"
json.dump(res, open(os.path.join(d, "defaults.json"), "w"), indent=1)
for k, v in res.items():
    print(k, json.dumps(v)[:600])

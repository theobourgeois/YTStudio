"""Layer effects through ActionDescriptors: apply, read back as JSON."""
import os, json
import numpy as np
from ps import OUT, save_image, run_jsx, js

FX_JS = r"""
function idName(id) { var s = app.typeIDToStringID(id); if (s) return s; return app.typeIDToCharID(id); }
function dumpDesc(d) {
  var o = {};
  for (var i = 0; i < d.count; i++) { var k = d.getKey(i); o[idName(k)] = dumpVal(d, k, d.getType(k)); }
  return o;
}
function dumpList(l) { var a = []; for (var i = 0; i < l.count; i++) a.push(dumpVal(l, i, l.getType(i))); return a; }
function dumpVal(d, k, t) {
  switch (t) {
    case DescValueType.OBJECTTYPE: var o = dumpDesc(d.getObjectValue(k)); o._class = idName(d.getObjectType(k)); return o;
    case DescValueType.LISTTYPE: return dumpList(d.getList(k));
    case DescValueType.UNITDOUBLE: return { unit: idName(d.getUnitDoubleType(k)), value: d.getUnitDoubleValue(k) };
    case DescValueType.DOUBLETYPE: return d.getDouble(k);
    case DescValueType.INTEGERTYPE: return d.getInteger(k);
    case DescValueType.BOOLEANTYPE: return d.getBoolean(k);
    case DescValueType.STRINGTYPE: return d.getString(k);
    case DescValueType.ENUMERATEDTYPE: return { enumType: idName(d.getEnumerationType(k)), value: idName(d.getEnumerationValue(k)) };
    case DescValueType.CLASSTYPE: return { "class": idName(d.getClass(k)) };
    case DescValueType.REFERENCETYPE: return "<ref>";
    case DescValueType.RAWTYPE: return "<raw>";
    case DescValueType.ALIASTYPE: return "<alias>";
    default: return "<" + t + ">";
  }
}
function toJSON(v) {
  if (v === null) return "null";
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  if (typeof v === "string") return '"' + v.replace(/\\/g, "\\\\").replace(/"/g, '\\"') + '"';
  if (v instanceof Array) { var a = []; for (var i = 0; i < v.length; i++) a.push(toJSON(v[i])); return "[" + a.join(",") + "]"; }
  var p = []; for (var k in v) p.push(toJSON(k) + ":" + toJSON(v[k])); return "{" + p.join(",") + "}";
}
/** JSON -> ActionDescriptor: numbers as {unit, value} or plain doubles; {enumType, value}; nested objects with _class. */
function toDesc(o) {
  var d = new ActionDescriptor();
  for (var k in o) { if (k === "_class") continue; putVal(d, k, o[k]); }
  return d;
}
/** String ids throughout (what the read-back gives); a key written "#Xxxx" is a char id. */
function key(k) { return k.charAt(0) === "#" && k.length === 5 ? cTID(k.substring(1)) : sTID(k); }
function putVal(d, k, v) {
  var id = key(k);
  if (typeof v === "boolean") d.putBoolean(id, v);
  else if (typeof v === "number") { if (Math.round(v) === v && k !== "Opct") d.putInteger(id, v); else d.putDouble(id, v); }
  else if (typeof v === "string") d.putString(id, v);
  else if (v instanceof Array) { var l = new ActionList(); for (var i = 0; i < v.length; i++) putListVal(l, v[i]); d.putList(id, l); }
  else if (v.unit !== undefined) d.putUnitDouble(id, key(v.unit), v.value);
  else if (v.enumType !== undefined) d.putEnumerated(id, key(v.enumType), key(v.value));
  else d.putObject(id, key(v._class), toDesc(v));
}
function putListVal(l, v) {
  if (typeof v === "number") l.putDouble(v);
  else if (v.unit !== undefined) l.putUnitDouble(key(v.unit), v.value);
  else l.putObject(key(v._class), toDesc(v));
}
function setEffects(fx) {
  var d = new ActionDescriptor(); var r = new ActionReference();
  r.putProperty(cTID('Prpr'), cTID('Lefx')); r.putEnumerated(cTID('Lyr '), cTID('Ordn'), cTID('Trgt'));
  d.putReference(cTID('null'), r);
  d.putObject(cTID('T   '), cTID('Lefx'), toDesc(fx));
  executeAction(cTID('setd'), d, DialogModes.NO);
}
function getEffects() {
  var r = new ActionReference(); r.putEnumerated(cTID('Lyr '), cTID('Ordn'), cTID('Trgt'));
  var d = executeActionGet(r);
  if (!d.hasKey(sTID('layerEffects'))) return null;
  return dumpDesc(d.getObjectValue(sTID('layerEffects')));
}
function getLayer() { var r = new ActionReference(); r.putEnumerated(cTID('Lyr '), cTID('Ordn'), cTID('Trgt')); return dumpDesc(executeActionGet(r)); }
"""

def jsx(code):
    return run_jsx(FX_JS + code)

def shape_png(path, kind="square", size=256, box=(64, 64, 192, 192), soft=False):
    a = np.zeros((size, size, 4)); a[..., :3] = 255
    yy, xx = np.mgrid[0:size, 0:size] + 0.5
    if kind == "square":
        x0, y0, x1, y1 = box
        cov = np.clip(np.minimum(xx - x0 + 0.5, x1 - xx + 0.5), 0, 1) * np.clip(np.minimum(yy - y0 + 0.5, y1 - yy + 0.5), 0, 1)
    elif kind == "disc":
        cx, cy, r = box
        cov = np.clip(r - np.hypot(xx - cx, yy - cy) + 0.5, 0, 1)
    a[..., 3] = np.round(cov * 255)
    save_image(a, path)

def probe_doc(shape_path, fx, out_path, background=(0, 0, 0), extra=""):
    """A document with an opaque background and the shape layer above, with effects `fx`; saves and returns the read-back."""
    bgp = out_path + ".bg.png"
    h = 256
    from PIL import Image
    w, h = Image.open(shape_path).size
    save_image(np.broadcast_to(np.array(background, float), (h, w, 3)).copy(), bgp)
    code = f"""
      var doc = openDoc({js(bgp)});
      var l = addLayerFrom(doc, {js(shape_path)});
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

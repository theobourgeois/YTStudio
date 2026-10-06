"""
Drives a real Photoshop through AppleScript's `do javascript` (ExtendScript), for the layer-style research
(docs/photo/layer-style/). Probes open images we make, set modes and effects, and save flattened PNGs that we
measure. They never touch the user's documents: every probe works in its own document and closes it unsaved.
"""
import os, subprocess, tempfile, json
import numpy as np
from PIL import Image, ImageCms

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
OUT = os.path.join(ROOT, "data", "photoshop-probes")
os.makedirs(OUT, exist_ok=True)

PRELUDE = r"""
var cTID = function (s) { return app.charIDToTypeID(s); };
var sTID = function (s) { return app.stringIDToTypeID(s); };
app.displayDialogs = DialogModes.NO;
app.preferences.rulerUnits = Units.PIXELS;
var __opened = [];
function openDoc(path) { var d = app.open(new File(path)); __opened.push(d); return d; }
function savePng(doc, path) {
  var o = new PNGSaveOptions(); o.compression = 1; o.interlaced = false;
  doc.saveAs(new File(path), o, true, Extension.LOWERCASE);
}
function closeDoc(doc) { doc.close(SaveOptions.DONOTSAVECHANGES); }
/** Puts the image at `path` as a new top layer of `doc`, at the same place. */
function addLayerFrom(doc, path) {
  var src = app.open(new File(path));
  var l = src.activeLayer.duplicate(doc, ElementPlacement.PLACEATBEGINNING);
  closeDoc(src);
  app.activeDocument = doc;
  return doc.layers[0];
}
"""

SRGB = ImageCms.ImageCmsProfile(ImageCms.createProfile("sRGB")).tobytes()

def save_image(arr, path):
    """uint8 HxWx3 or HxWx4, tagged sRGB."""
    mode = "RGBA" if arr.shape[2] == 4 else "RGB"
    Image.fromarray(arr.astype(np.uint8), mode).save(path, icc_profile=SRGB)

def load(path):
    return np.asarray(Image.open(path).convert("RGBA")).astype(np.float64)

def run_jsx(code, timeout=600):
    script = (PRELUDE + "\n(function(){ try {\n" + code + "\n} catch (e) {\n"
              "  for (var i = 0; i < __opened.length; i++) { try { __opened[i].close(SaveOptions.DONOTSAVECHANGES); } catch (x) {} }\n"
              "  return 'ERR: ' + e + ' line ' + e.line; } })();")
    r = subprocess.run(["osascript", "-e", "on run argv", "-e", 'tell application id "com.adobe.Photoshop" to do javascript (item 1 of argv)',
                        "-e", "end run", script], capture_output=True, text=True, timeout=timeout)
    out = (r.stdout + r.stderr).strip()
    if r.returncode != 0 or out.startswith("ERR"):
        raise RuntimeError(out)
    return out

def js(s):
    return json.dumps(s)

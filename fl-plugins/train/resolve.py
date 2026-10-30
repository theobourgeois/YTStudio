"""How many of each candidate's vocal files exist on this computer (Mac projects point at /Users/...; FL looks for a
missing file by name in the project's folder and its browser folders, so a name found there counts). Adds vocalFiles
and vocalFound to candidates.json."""
import json
import os
import re

import flp

HOME = os.path.expanduser("~")
UD = os.path.join(HOME, "Documents", "Image-Line", "FL Studio")
ROOTS = [os.path.join(UD, "Audio"), os.path.join(HOME, "Music"),
         os.path.join(HOME, "iCloudDrive", "Documents", "Image-Line", "FL Studio", "Audio"),
         os.path.join(HOME, "OneDrive", "Documents", "Image-Line", "FL Studio", "Audio")]


def main():
    names = set()
    for root in ROOTS:
        for dp, _, fn in os.walk(root):
            if "Tracks" in dp:
                continue
            names.update(f.lower() for f in fn)
    cands = json.load(open("candidates.json"))
    for s in cands:
        info = flp.read(s["flp"])
        found = []
        for c in info["channels"]:
            smp = c["sample"].replace("\\", "/")
            base = smp.rsplit("/", 1)[-1]
            if not smp or not (flp.VOCAL.search(c["name"]) or flp.VOCAL.search(base)
                               or re.search(r"/(recorded|vocals?|vox)/", smp, re.I)):
                continue
            p = smp.replace("%FLStudioUserData%", UD.replace("\\", "/"))
            found.append(os.path.exists(p) or base.lower() in names
                         or os.path.exists(os.path.join(os.path.dirname(s["flp"]), base)))
        s["vocalFiles"], s["vocalFound"] = len(found), sum(found)
    json.dump(cands, open("candidates.json", "w"), indent=1)
    for s in cands:
        print("%3d/%3d %s" % (s["vocalFound"], s["vocalFiles"], os.path.basename(s["flp"])))
    good = [s for s in cands if s["vocalFiles"] >= 4 and s["vocalFound"] >= 0.8 * s["vocalFiles"]]
    print(len(good), "renderable")


if __name__ == "__main__":
    main()

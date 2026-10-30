"""Analyses a stems folder against FL's live mixer and applies the plan, as the window does (for testing)."""
import json, sys, time
sys.path.insert(0, r"C:\Users\goali\flrender\automix")
import analysis, link
l = link.connect()
state = l.call("state")
a = analysis.Analysis(sys.argv[1], state, project=link.project_name(l.title)).analyse()
p = a.plan()
r = l.call("apply", faders=p["faders"], undoName="Auto mix", timeout=30)
json.dump({"plan": p["faders"], "result": r}, open(sys.argv[2], "w"), indent=1, default=float)
time.sleep(0.4)
now = {t["index"]: t["db"] for t in l.call("state")["tracks"]}
for f in p["faders"]:
    print(f["index"], "wanted %.3f got %.3f" % (f["db"], now[f["index"]]))
l.close()

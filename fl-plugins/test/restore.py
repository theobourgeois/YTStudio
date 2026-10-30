"""Puts FL's leaf faders back to a saved state's levels (testing)."""
import json, sys, time
sys.path.insert(0, r"C:\Users\goali\flrender\automix")
import analysis, link
st = json.load(open(sys.argv[1]))
l = link.connect()
faders = [{"index": t["index"], "value": t.get("value", analysis.db_to_value(t["db"]))} for t in st["tracks"]]
l.call("apply", faders=faders, undoName="Auto mix test restore")
time.sleep(0.5)
now = {t["index"]: t["db"] for t in l.call("state")["tracks"]}
bad = [(t["index"], t["db"], now[t["index"]]) for t in st["tracks"] if abs(now[t["index"]] - t["db"]) > 0.01]
print("restored" if not bad else bad)
l.close()

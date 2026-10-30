"""Reads the blind test's results against each contender's measurements: averages per contender, and within each trial
how each measurement ranks against the ratings (Spearman), averaged over the round's songs."""
import json
import sys
import numpy as np
from scipy.stats import spearmanr

res = json.load(open(sys.argv[1]))
meas = json.load(open("C:/Users/goali/flrender/contest/out/measurements.json"))

FEATURES = {
    "sub": lambda m: m["bands"]["sub"], "low": lambda m: m["bands"]["low"], "lowMid": lambda m: m["bands"]["lowMid"],
    "presence": lambda m: m["bands"]["presence"], "air": lambda m: m["bands"]["air"],
    "sideToMid": lambda m: m["sideToMid"], "correlation": lambda m: m["correlation"],
    "spread": lambda m: m["shortTermSpread"], "crest": lambda m: m["crest"],
}
for rnd in ("mix", "master"):
    ts = [t for t in res["trials"] if t["round"] == rnd]
    names = list(ts[0]["ratings"])
    print(f"\n{rnd}: mean rating")
    for n in sorted(names, key=lambda n: -np.mean([t["ratings"][n] for t in ts])):
        print(f"  {n:20} {np.mean([t['ratings'][n] for t in ts]):5.1f}   " + " ".join(f"{t['song']} {t['ratings'][n]:3}" for t in ts))
    print(f"{rnd}: rank correlation of rating with each measurement of the excerpt (per song, then mean)")
    for f, get in FEATURES.items():
        rs = []
        for t in ts:
            x = [get(meas[f"{t['song']}/{rnd}/{n}"]["excerpt"]) for n in names]
            y = [t["ratings"][n] for n in names]
            rs.append(spearmanr(x, y).statistic)
        print(f"  {f:12} {np.nanmean(rs):+.2f}   " + " ".join(f"{t['song']} {r:+.2f}" for t, r in zip(ts, rs)))

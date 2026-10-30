"""Prints the measurements of every contender built so far, one line each."""
import json

m = json.load(open("C:/Users/goali/flrender/contest/out/measurements.json"))
for k, v in m.items():
    f = v["full"]
    b = f["bands"]
    print(f"{k:32} tp {f['truePeak']:5.1f} plr {f['plr']:5.1f} spread {f['shortTermSpread']:5.1f} "
          f"sub {b['sub']:.2f} low {b['low']:.2f} lmid {b['lowMid']:.3f} pres {b['presence']:.3f} air {b['air']:.4f} "
          f"s/m {f['sideToMid']:6.1f} corr {f['correlation']:.2f}")

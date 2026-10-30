"""Checks the worker's Learn from this mix offline: test/stems0f with test/state0.json, a stand-in for FL's link with
one fader moved, the training folder in a temp dir.

    python test/learn_mix_test.py
"""
import copy
import json
import os
import sys
import tempfile

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.dirname(HERE))
sys.path.insert(0, os.path.join(os.path.dirname(HERE), "train"))

import analysis  # noqa: E402

tmp = tempfile.mkdtemp()
analysis.TRAINING = tmp
analysis.MODEL = os.path.join(tmp, "model.json")
import learn  # noqa: E402
learn.MIXES = os.path.join(tmp, "mixes.jsonl")
learn.SONGS = os.path.join(tmp, "songs")
learn.REPORT = os.path.join(tmp, "learn_report.txt")
learn.EXCLUDED = os.path.join(tmp, "excluded.json")
import worker  # noqa: E402
import worker_base  # noqa: E402

if not os.path.exists(os.path.join(HERE, "state0.json")):
    sys.exit("skipped: needs a project's stems in test/stems0f and its mixer in test/state0.json (kept out of the repo)")
state = json.load(open(os.path.join(HERE, "state0.json")))
events = []
worker_base.sink = lambda ev, f: events.append((ev, f))


class FakeLink:
    title = "test-song.flp - FL Studio"
    pid = 0
    hello = {"version": 5}

    def __init__(self, st):
        self.st = st

    def call(self, cmd, **kw):
        assert cmd == "state"
        return self.st

    def close(self):
        pass


w = worker.Worker(0)
a = analysis.Analysis(os.path.join(HERE, "stems0f"), state, project="test-song").analyse()
w.analysis = a
w.plan = a.plan(*w.options())
before, _ = a.measure_groups()
lead = {t.index for t in a.movable() if a.group_of(t) == "vocal_lead"}  # the whole group up 3 dB
moved_state = copy.deepcopy(state)
for t in moved_state["tracks"]:
    if t["index"] in lead:
        t["db"] += 3.0
w.link = FakeLink(moved_state)
w.project = lambda: "test-song"
w.learn_mix()
rec = json.loads(open(learn.MIXES).read().splitlines()[-1])
d = rec["groups"]["vocal_lead"]["lufs"] - before["vocal_lead"]["lufs"]
others = [rec["groups"][g]["lufs"] - before[g]["lufs"] for g in before if g != "vocal_lead" and g in rec["groups"]]
print("lead moved %.2f dB (want 3), others %s" % (d, ["%.2f" % x for x in others]))
print("moved", rec["moved"])
print([f["text"] for ev, f in events if ev == "log"][-2:])
assert abs(d - 3.0) < 0.05 and all(abs(x) < 0.05 for x in others)
w.handle({"cmd": "learn"})  # again, through the command: replaces it in learn's eyes
assert len(learn.load_mixes(0)) == 1
print("ok")

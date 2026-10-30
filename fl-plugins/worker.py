"""YT-Mix's hidden half: Auto Mix without a window. The plugin (plugin/, a VST3 inside FL Studio) starts it and shows
what it says; this does what app.py's window does (render, listen, plan, move faders, undo). worker_base.py is the
lines of JSON, the connection to FL and the rest of what YT-Fill's worker does too.

    pythonw worker.py <FL's pid>
"""
import json
import os
import sys
import time

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)

import analysis  # noqa: E402
import render  # noqa: E402
from worker_base import BaseWorker, log, main, send  # noqa: E402

UNDO_NAME = "Auto mix"


class Worker(BaseWorker):
    NAME = "YT-Mix"
    SAVED = {"lead": analysis.DEFAULTS["lead_boost"], "kick": False, "learned": True, "roles": {}, "leads": {}}
    ERRORS = (render.RenderError, ValueError, RuntimeError)

    def __init__(self, pid):
        super().__init__(pid)
        self.analysis = None
        self.plan = None
        self.applied = None
        self.undo = None
        self.set_to = {}

    # What the plugin shows

    def view(self):
        p = self.plan
        rows, summary = [], ""
        if p:
            for r in p["rows"]:
                role = analysis.ROLE_NAMES.get(r["role"], r["role"])
                if r["role"] != r["autoRole"]:
                    role += " (yours)"
                elif r["roleFrom"] == "sound":
                    role += " (by ear)"
                off = r["group"] is None
                rows.append({
                    "index": r["index"], "name": r["name"], "role": role, "roleId": r["role"],
                    "vocal": r["role"] == "vocal", "lead": r["role"] == "vocal" and bool(r["lead"]),
                    "level": analysis.fmt(r["lufs"]) + (" LUFS" if not off else ""),
                    "now": analysis.fmt(r["db"]) + " dB",
                    "change": ("— " + r.get("why", "")) if off else analysis.fmt(r["change"], True),
                    "new": analysis.fmt(r["new"]) + " dB",
                    "style": "off" if off else "lead" if r["group"] == p["lead"] else "",
                })
            groups = "   ".join("%s %s" % (g["name"], analysis.fmt(g["change"], True)) for g in p["groups"])
            lead_name = analysis.GROUP_NAMES[p["lead"]].lower()
            summary = ("%sGroups: %s\nThe %s sits %s LU against the whole mix. The song stays at %s LUFS before your "
                       "master." % ("Using what it learned from your mixes.\n" if p.get("learned") else "", groups,
                                    lead_name, analysis.fmt(p["leadToMix"], True), analysis.fmt(p["mixAfter"])))
            moves = [abs(r["change"]) for r in p["rows"] if r["group"]]
            if moves and max(moves) < 0.5:
                summary = "Already balanced: no fader needs to move more than half a dB.\n" + summary
        ready = bool(self.link) and not self.busy
        send("view", connected=bool(self.link), status=self.status, busy=self.busy,
             lead=self.saved["lead"], kick=self.saved["kick"], rows=rows, summary=summary,
             learned=bool(self.saved["learned"]), hasModel=analysis.load_model() is not None,
             canLearn=ready and self.analysis is not None,
             canAuto=ready, canApply=ready and bool(p and p["faders"]) and p is not self.applied,
             canUndo=ready and bool(self.undo), canEdit=not self.busy and self.analysis is not None,
             roles=[[r, analysis.ROLE_NAMES[r]] for r in analysis.ROLES])

    def started(self):
        if self.analysis and not self.busy:
            self.overrides()
            self.plan = self.analysis.plan(*self.options())
        self.view()

    # Commands

    def command(self, cmd, req):
        if cmd == "auto":
            self.run("Auto Mix: FL is opening its export", self.auto_mix)
        elif cmd == "folder":
            folder = os.path.normpath(req["folder"])
            self.run("Analysing %s" % folder, lambda: self.analyse_folder(folder))
        elif cmd == "options":
            self.saved["lead"] = max(0.0, min(6.0, float(req.get("lead", self.saved["lead"]))))
            self.saved["kick"] = bool(req.get("kick", self.saved["kick"]))
            self.saved["learned"] = bool(req.get("learned", self.saved["learned"]))
            self.save()
            self.replan()
        elif cmd == "role":
            self.set_role(int(req["index"]), req["role"])
        elif cmd == "lead":
            self.toggle_lead(int(req["index"]))
        elif cmd == "resetRoles":
            self.reset_roles()
        elif cmd == "apply":
            self.run("Checking FL's mixer", lambda: self.apply(bool(req.get("force"))))
        elif cmd == "undo":
            self.run("Putting the faders back", self.undo_apply)
        elif cmd == "learn":
            self.run("Learning from this mix", self.learn_mix)
        else:
            return False
        return True

    def scale(self, lo, hi):
        return lambda f: send("progress", value=lo + (hi - lo) * f)

    def auto_mix(self):
        self.need_link()
        self.retitle()
        song = self.link.hello.get("version", 0) >= 5
        was = self.link.call("song", on=True)["wasSong"] if song else True
        try:
            folder, prefix = render.render_stems(self.link.pid, progress=self.scale(0, 0.55), log=log)
        finally:
            if not was:
                self.link.call("song", on=False)
        log("Listening to the stems…")
        self.analyse(folder, prefix, self.scale(0.55, 0.97))
        p = self.plan
        if p["faders"]:
            self.applied = p
            self.applied_moves(self.move(p["faders"], UNDO_NAME))
        else:
            self.applied = p
            log("Already balanced: no fader needed to move.")

    def analyse_folder(self, folder):
        self.need_link()
        self.retitle()
        self.analyse(folder, self.project(), self.scale(0, 0.97))
        p = self.plan
        if p["faders"]:
            log("%d fader%s to move: Apply changes moves them. Double-click a role that's wrong to change it, or "
                "click the Lead column to pick the lead vocals." % (len(p["faders"]), "" if len(p["faders"]) == 1
                                                                    else "s"))

    def analyse(self, folder, project, progress):
        state = self.link.call("state", timeout=15)
        a = analysis.Analysis(folder, state, project=project, progress=progress, log=log).analyse()
        self.analysis = a
        self.set_to = {}
        self.overrides()
        self.plan = a.plan(*self.options())
        for w in self.plan["warnings"]:
            log(w, True)

    def options(self):
        model = analysis.load_model() if self.saved["learned"] else None
        return float(self.saved["lead"]), 2.0 if self.saved["kick"] else 0.0, model

    def learn_mix(self):
        """Keeps the balance in FL now, as you've set it by ear, as a mix to learn from (training/mixes.jsonl, where
        the trainer's go): measured from the stems Auto Mix last listened to, each turned by its fader's move since
        (and its buses'). Then learns again; the next Auto Mix uses it if it beats the rules. Pressing it again in
        the same project replaces that project's mix (learn.py keeps a project's last)."""
        a = self.analysis
        if a is None:
            raise ValueError("Press Auto Mix first: it has to listen to the song before it can learn from it.")
        self.need_link()
        state = self.link.call("state", timeout=15)
        now = {t["index"]: t for t in state["tracks"]}
        tracks = a.movable()
        if any(t.index in now and now[t.index]["name"] != t.name for t in tracks):
            raise ValueError("The mixer in FL isn't the one Auto Mix listened to (inserts have other names now). Press "
                             "Auto Mix again, set the faders, then Learn from this mix.")
        delta = {i: now[i]["db"] - t.db for i, t in a.tracks.items()
                 if i and i in now and t.db is not None and now[i]["db"] is not None}
        moved = {t.index: delta.get(t.index, 0.0) + sum(delta.get(b, 0.0) for b in a.chain(t.index)) for t in tracks}
        groups, _ = a.measure_groups(moved, progress=self.scale(0, 0.9))
        project = self.project() or "untitled"
        rec = {"kind": "mix", "source": "plugin", "song": "fl:" + project, "repeat": False,
               "groups": {g: {"lufs": m["lufs"], "features": m["features"]} for g, m in groups.items()
                          if m["lufs"] is not None and m["lufs"] > -70},
               "moved": {str(k): round(v, 2) for k, v in moved.items() if abs(v) > 0.05},
               "time": time.strftime("%Y-%m-%d %H:%M:%S")}
        os.makedirs(analysis.TRAINING, exist_ok=True)
        with open(os.path.join(analysis.TRAINING, "mixes.jsonl"), "a", encoding="utf8") as f:
            f.write(json.dumps(rec) + "\n")
        log("Kept your mix of %s (%d groups, %d faders moved since Auto Mix listened) to learn from." % (
            project, len(rec["groups"]), len(rec["moved"])))
        if os.path.join(HERE, "train") not in sys.path:
            sys.path.insert(0, os.path.join(HERE, "train"))
        import learn
        try:
            out, _ = learn.learn(log=lambda text: None)
        except ValueError as e:  # too few songs yet
            log(str(e))
            return
        cv = out["cv"]
        if out["better"]:
            log("Learned from %d mixes: it now gets within %.1f dB of your balance, against %.1f dB for the rules, on "
                "songs it never saw. The next Auto Mix uses it." % (out["mixes"], cv["chosen"], cv["rules"]))
        else:
            log("Learned from %d mixes, but it doesn't predict your balance better than the rules yet, so Auto Mix "
                "keeps the rules." % out["mixes"])

    def overrides(self):
        """The roles and leads corrected in this project before (kept in the plugin), on the inserts still there
        under the same name."""
        a = self.analysis
        for key, o in self.saved["roles"].items():
            t = a.tracks.get(int(key))
            if t and t.leaf and t.name == o.get("name") and o.get("role") in analysis.ROLES:
                t.role = o["role"]
        a._leads()  # who leads depends on which inserts are vocals
        for key, o in self.saved["leads"].items():
            t = a.tracks.get(int(key))
            if t and t.leaf and t.role == "vocal" and t.name == o.get("name"):
                t.lead = bool(o.get("lead"))

    def replan(self):
        if not self.analysis or self.busy:
            self.view()
            return
        # plan() reads the stems again (a few seconds): busy meanwhile, with its own progress, then the bar cleared
        self.busy = True
        self.view()
        self.analysis.progress = self.scale(0, 1)
        try:
            self.plan = self.analysis.plan(*self.options())
        finally:
            self.busy = False
            send("progress", value=0)
        p = self.plan
        if p is not self.applied and p["faders"]:
            log("%d fader%s to move: Apply changes moves them." % (len(p["faders"]), "" if len(p["faders"]) == 1
                                                                   else "s"))
        self.view()

    def set_role(self, index, role):
        a = self.analysis
        t = a and a.tracks.get(index)
        if not t or role not in analysis.ROLES or self.busy:
            return
        if role == t.auto_role:
            self.saved["roles"].pop(str(index), None)
        else:
            self.saved["roles"][str(index)] = {"name": t.name, "role": role}
        self.save()
        self.overrides()
        self.replan()

    def toggle_lead(self, index):
        a = self.analysis
        t = a and a.tracks.get(index)
        if not t or t.role != "vocal" or self.busy:
            return
        self.saved["leads"][str(index)] = {"name": t.name, "lead": not t.lead}
        self.save()
        self.overrides()
        self.replan()

    def reset_roles(self):
        self.saved["roles"], self.saved["leads"] = {}, {}
        self.save()
        if not self.analysis or self.busy:
            self.view()
            return
        for t in self.analysis.leaves():
            t.role = t.auto_role
        self.analysis._leads()
        self.replan()

    def apply(self, force):
        p = self.plan
        self.need_link()
        if not p:
            return
        planned = {r["index"]: r for r in p["rows"]}
        state = self.link.call("state", timeout=15)
        now = {t["index"]: t for t in state["tracks"]}
        if any(i in now and now[i]["name"] != planned[i]["name"] for i in planned):
            raise ValueError("The mixer in FL isn't the one that was analysed (inserts have other names now). Press "
                             "Auto Mix again.")
        moved = [i for i in planned if i in now and abs(now[i]["db"] - self.set_to.get(i, planned[i]["db"])) > 0.05]
        if moved and not force:
            send("ask", text="%d fader%s moved since the analysis. Apply the plan anyway (the planned levels replace "
                             "yours)?" % (len(moved), "" if len(moved) == 1 else "s"),
                 yes={"cmd": "apply", "force": True})
            return
        log("Moving %d faders in FL…" % len(p["faders"]))
        self.applied = p
        self.applied_moves(self.move(p["faders"], UNDO_NAME))

    def move(self, faders, undo_name):
        """Sets the faders, then reads the mixer back a moment later (FL shows some inserts' new level only after a
        while) to see where they landed."""
        result = self.link.call("apply", faders=faders, undoName=undo_name, timeout=30)
        time.sleep(0.4)
        now = {t["index"]: t["db"] for t in self.link.call("state", timeout=15)["tracks"]}
        off = [(f["index"], f["db"], now.get(f["index"])) for f in faders
               if "db" in f and now.get(f["index"]) is not None and abs(now[f["index"]] - f["db"]) > 0.05]
        return result, off

    def applied_moves(self, r):
        result, off = r
        done = result["faders"]
        undo = {f["index"]: f for f in self.undo or []}  # a second Apply keeps the levels from before the first
        for f in done:
            undo.setdefault(f["index"], {"index": f["index"], "value": f["beforeValue"], "db": f["before"]})
        self.undo = list(undo.values())
        self.set_to.update({f["index"]: f["db"] for f in self.applied["faders"]})
        log("Done: %d faders moved in FL. Undo puts them back. Double-click a role that's wrong to change it, then "
            "Apply changes." % len(done))
        for i, want, got in off:
            log("Insert %d is at %s dB, not %s: is its fader automated?" % (i, analysis.fmt(got), analysis.fmt(want)),
                True)

    def undo_apply(self):
        if not self.undo:
            return
        self.need_link()
        faders = self.undo
        _, off = self.move(faders, UNDO_NAME + " undo")
        self.undo = self.applied = None
        self.set_to.update({f["index"]: f["db"] for f in faders})
        log("Faders back where they were." if not off else "Faders back, but %d didn't land where they were." % len(off),
            bool(off))
        a = self.analysis
        if a and any(abs(a.tracks[f["index"]].db - f["db"]) > 0.05 for f in faders if f["index"] in a.tracks):
            # measured with the faders where Auto Mix had put them (a second press): its plan isn't this mix's now
            self.analysis = self.plan = None
            self.set_to = {}
            log("The table was measured with the faders moved: press Auto Mix to listen again.")

    def close(self):
        super().close()
        render.clear()


if __name__ == "__main__":
    main(Worker)

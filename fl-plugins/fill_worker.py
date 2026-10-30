"""YT-Fill's hidden half: Fill inserts on the project open in FL. The plugin (plugin/, a VST3 inside FL Studio) starts it
and shows what it says. It reads FL's channels and inserts and the saved project, works out which group each sound
belongs to (fillinserts.py), and changes FL only when Fill is pressed. worker_base.py is the lines of JSON, the
connection to FL and the rest of what YT-Mix's worker does too.

    pythonw fill_worker.py <FL's pid>
"""
import os
import sys
import time

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)

import fillinserts  # noqa: E402
import flpread  # noqa: E402
from worker_base import BaseWorker, log, main, send  # noqa: E402


def said_of_sounds(saved):
    """What a saved project says that the list uses."""
    return [(c["name"], c.get("preset"), c.get("sample")) for c in saved]


class FillWorker(BaseWorker):
    NAME = "YT-Fill"
    SAVED = {"fillRoles": {}}

    def __init__(self, pid):
        super().__init__(pid)
        self.fill = None  # the last scan
        self.fill_before = None  # what its Undo puts back

    # What the plugin shows

    def view(self):
        send("view", connected=bool(self.link), status=self.status, busy=self.busy, **self.fill_view())

    def fill_view(self):
        f = self.fill
        if not f:
            return {"rows": [], "summary": "", "changes": 0, "canUndo": False, "fillText": "Fill"}
        plan = self.fill_plan()
        tracks = {t["index"]: t for t in f["state"]["tracks"]}
        rows = []
        for s in sorted(plan["sounds"], key=lambda x: x["channel"]):
            now = "Master" if s["target"] == 0 else "%d  %s" % (s["target"], (tracks.get(s["target"]) or {}).get("name") or "")
            to = "" if s["to"] is None else "stays" if s["to"] == s["target"] else str(s["to"])
            need = not s["role"] and not s["skipped"]
            rows.append({"channel": s["channel"], "name": s["name"], "role": s["role"] or "",
                         "group": fillinserts.ROLE_NAMES.get(s["role"], "Skip" if s["skipped"] else "Needs a group"),
                         "why": "" if need else s["why"], "now": now, "to": to, "note": s["note"], "need": need})
        need = sum(1 for r in rows if r["need"])
        placed = sum(1 for s in plan["sounds"] if s["to"] is not None)
        takes = sum(1 for c in f["state"]["channels"] if c["type"] == fillinserts.AUDIO_CLIP)
        lines = []
        if f["path"]:
            lines.append("Serum presets from %s, saved %s. Save first if you've changed sounds since." % (
                os.path.basename(f["path"]), time.strftime("%H:%M", time.localtime(os.path.getmtime(f["path"])))))
        else:
            lines.append("No saved project matches this one, so Serum channels have no preset names: save it and the list will follow.")
        notes = []
        if need:
            notes.append("%d need%s a group and stay%s where they are until you pick one" % (
                need, "" if need > 1 else "s", "" if need > 1 else "s"))
        if takes:
            notes.append("%d recorded take%s left alone" % (takes, "" if takes == 1 else "s"))
        if plan["newBuses"]:
            notes.append("new buses: " + ", ".join("Mix Bus" if b == "mix" else fillinserts.ROLE_NAMES[b]
                                                   for b in plan["newBuses"]))
        if notes:
            line = "; ".join(notes)
            lines.append(line[0].upper() + line[1:] + ".")
        return {"rows": rows, "summary": "\n".join(lines), "changes": plan["changes"], "canUndo": bool(self.fill_before),
                "fillText": "Fill %d insert%s" % (placed, "" if placed == 1 else "s") if plan["changes"]
                            else "Nothing to change"}

    def started(self):
        self.first_scan()

    def connected(self):
        self.first_scan()

    def idle(self):
        """A save tells the list what it couldn't know (a Serum's preset), so the list follows it. Only when the file says
        something new: every save doesn't need Jev asked again."""
        f = self.fill
        if not f:
            return
        self.retitle()
        project = self.project()
        if project != f["project"]:
            self.run("Reading the project", self.fill_scan)
            return
        written = flpread.newest(project) if project else 0
        if written == f["written"]:
            return
        f["written"] = written
        path, saved = flpread.find(project, f["soundNames"])
        if said_of_sounds(saved) != f["said"]:
            self.run("Saved: reading the project", self.fill_scan)
        else:
            f["path"] = path
            self.view()

    def first_scan(self):
        """The list is what this plugin's window is, so it's there as soon as FL answers."""
        if self.link and not self.fill:
            self.run("Reading the project", self.fill_scan)
        else:
            self.view()

    # Commands

    def command(self, cmd, req):
        if cmd == "fillScan":
            self.run("Reading the project", self.fill_scan)
        elif cmd == "fillRole":
            self.fill_set_role(req.get("channels") or [], req.get("role"))
        elif cmd == "fillApply":
            self.run("Filling inserts", self.fill_apply)
        elif cmd == "fillUndo":
            self.run("Putting the mixer back", self.fill_undo)
        else:
            return False
        return True

    def fill_scan(self):
        """Reads FL and the saved project, works out each sound's group and shows the list. Nothing changes in FL until
        Fill."""
        self.need_link()
        self.retitle()
        if self.link.hello.get("version", 0) < 6:
            raise ValueError("FL is running an older script. Press Set up FL Studio… to update it, then reload it in FL "
                             "(View › Script output › Reload script).")
        state = self.link.call("fillState", timeout=30)
        names = [c["name"] for c in state["channels"]]
        project = self.project()
        written = flpread.newest(project) if project else 0  # before reading: a save in between is noticed
        sound_names = [c["name"] for c in state["channels"] if c["type"] in fillinserts.SOUND_TYPES]
        path, saved = flpread.find(project, sound_names)
        sounds = fillinserts.make_sounds(state["channels"], state["tracks"], flpread.match(names, saved))
        key = fillinserts.jev_key()
        categories = fillinserts.SerumCategories()
        try:
            sounds, problem = fillinserts.classify(sounds, categories,
                                                   (lambda e: fillinserts.ask_jev(e, key)) if key else None)
        finally:
            categories.close()
        if problem:
            log(problem + ": the sounds it would have named are yours to pick.", True)
        for s in sounds:
            s["detected"], s["detectedWhy"] = s["role"], s["why"]
        self.fill = {"sounds": sounds, "state": state, "path": path, "names": names, "project": project,
                     "soundNames": sound_names, "written": written, "said": said_of_sounds(saved)}
        log("Fill inserts: %d sounds%s." % (len(sounds), ", presets from %s" % os.path.basename(path) if path else ""))

    def fill_plan(self):
        """The plan for the state last read, with the user's picks over what was detected."""
        f = self.fill
        yours = self.saved.get("fillRoles") or {}
        for s in f["sounds"]:
            pick = yours.get(s["channelName"])
            s["skipped"] = pick == fillinserts.SKIP
            if s["skipped"]:
                s["role"], s["why"] = None, "Yours"
            elif pick:
                s["role"], s["why"] = pick, "Yours"
            else:
                s["role"], s["why"] = s["detected"], s["detectedWhy"]
        return fillinserts.build_plan(f["state"]["tracks"], f["state"]["channels"], f["sounds"])

    def fill_set_role(self, channels, role):
        """The user's pick for these sounds, kept in the project by channel name. "auto" goes back to what was detected."""
        if not self.fill or role not in fillinserts.ROLES + (fillinserts.SKIP, "auto"):
            return
        yours = self.saved.setdefault("fillRoles", {})
        wanted = {int(c) for c in channels}
        for s in self.fill["sounds"]:
            if s["channel"] in wanted:
                if role == "auto":
                    yours.pop(s["channelName"], None)
                else:
                    yours[s["channelName"]] = role
        self.save()
        self.view()

    def fill_read(self):
        """The mixer as it is now, into the last scan. Refuses if these aren't the channels in the list."""
        f = self.fill
        state = self.link.call("fillState", timeout=30)
        self.retitle()
        if self.project() != f["project"] or [c["name"] for c in state["channels"]] != f["names"]:
            self.fill_scan()
            raise ValueError("The project in FL has changed since the list was made, so nothing was filled. Check the "
                             "new list and press Fill again.")
        f["state"] = state
        targets = {c["index"]: c["target"] for c in state["channels"]}
        for s in f["sounds"]:
            s["target"] = targets[s["channel"]]

    def fill_apply(self):
        if not self.fill:
            raise ValueError("Press Rescan first: there's no list yet.")
        self.need_link()
        self.fill_read()
        plan = self.fill_plan()
        if not plan["changes"]:
            log("Nothing to change: every sound with a group is already in place.")
            return
        was = self.fill["state"]
        before = self.link.call("fill", channels=plan["channels"], inserts=plan["inserts"], undoName="Fill inserts",
                                timeout=30)
        before["project"] = self.fill["project"]
        time.sleep(0.4)
        self.fill_read()
        if self.fill["state"]["channels"] == was["channels"] and self.fill["state"]["tracks"] == was["tracks"]:
            # A box open in FL (Problems loading the project, say) and it ignores scripts, without an error
            raise RuntimeError("FL didn't take any of it, so nothing changed. Is a box open in FL? Close it and press "
                               "Fill again.")
        self.fill_before = before
        wrong = fillinserts.check(plan, self.fill["state"]["tracks"], self.fill["state"]["channels"])
        if wrong:
            for line in wrong:
                log(line, True)
            raise RuntimeError("FL didn't do all of it (the log says what). Undo fill puts back what it did.")
        log("Filled: %d channels moved, %d inserts changed. Undo fill puts them back." % (len(plan["channels"]),
                                                                                          len(plan["inserts"])))

    def fill_undo(self):
        before = self.fill_before
        if not before:
            return
        self.need_link()
        self.retitle()
        if self.project() != before["project"]:
            raise ValueError("That fill was in %s and %s is open now, so there's nothing here to put back." % (
                before["project"], self.project()))
        self.link.call("fill", channels=before["channels"], inserts=before["inserts"], undoName="Undo fill inserts",
                       timeout=30)
        self.fill_before = None
        if self.fill:
            time.sleep(0.4)
            self.fill_read()
        log("The mixer is back as it was before Fill inserts.")


if __name__ == "__main__":
    main(FillWorker)

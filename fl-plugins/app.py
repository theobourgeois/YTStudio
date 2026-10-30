"""YTStudio Auto Mix: the window. One button: it has FL render the project's split mixer stems, listens to them, and
moves FL's faders to the balance (Undo puts them back). The table then shows what it did, and a role changed there
can be applied on top.

    pythonw app.py
"""
import json
import os
import queue
import threading
import time
import tkinter as tk
import traceback
from tkinter import filedialog, messagebox, ttk

import analysis
import flsetup
import link
import render

SETTINGS = os.path.join(link.EXCHANGE, "settings.json")
RENDERED = os.path.join(os.path.expanduser("~"), "Documents", "Image-Line", "FL Studio", "Audio", "Rendered")
UNDO_NAME = "Auto mix"


def load_settings():
    try:
        with open(SETTINGS, encoding="utf8") as f:
            return json.load(f)
    except (OSError, ValueError):
        return {}


def save_settings(s):
    os.makedirs(link.EXCHANGE, exist_ok=True)
    tmp = SETTINGS + ".tmp"
    with open(tmp, "w", encoding="utf8") as f:
        json.dump(s, f, indent=1)
    os.replace(tmp, SETTINGS)


class App:
    def __init__(self, root):
        self.root = root
        self.settings = load_settings()
        self.link = None
        self.analysis = None
        self.plan = None
        self.undo = None  # [{index, value, db}] that puts the faders back as they were before the first Apply
        self.applied = None  # the plan last applied, so Apply waits for a change
        self.set_to = {}  # insert -> the dB Auto Mix last set it to, since the analysis
        self.lead_overrides = {}
        self.busy = False
        self.q = queue.Queue()
        root.title("YTStudio Auto Mix")
        self.scale = root.winfo_fpixels("1i") / 96  # sizes below are at 100%; the screen may be at 150%
        root.geometry("%dx%d" % (self.px(1060), self.px(760)))
        root.minsize(self.px(760), self.px(560))
        root.protocol("WM_DELETE_WINDOW", self.quit)
        root.report_callback_exception = self._callback_error  # pythonw has no console to print them on
        self._build()
        root.after(50, self._pump)
        self.connect(quiet=True)

    def px(self, n):
        return int(round(n * self.scale))

    # Layout

    def _build(self):
        style = ttk.Style()
        style.configure("Status.TLabel", font=("Segoe UI", 10, "bold"))
        style.configure("Big.TButton", font=("Segoe UI", 10, "bold"), padding=(14, 6))
        style.configure("Huge.TButton", font=("Segoe UI", 13, "bold"), padding=(28, 10))
        style.configure("Treeview", rowheight=self.px(22))
        pad = {"padx": 12, "pady": (8, 0)}

        top = ttk.Frame(self.root)
        top.pack(fill="x", **pad)
        self.dot = tk.Canvas(top, width=self.px(12), height=self.px(12), highlightthickness=0)
        self.dot.pack(side="left", padx=(0, 6))
        self.status = ttk.Label(top, text="Not connected", style="Status.TLabel")
        self.status.pack(side="left")
        ttk.Button(top, text="Set up FL Studio…", command=self.setup_dialog).pack(side="right")
        self.connect_btn = ttk.Button(top, text="Connect", command=self.connect)
        self.connect_btn.pack(side="right", padx=6)

        row = ttk.Frame(self.root)
        row.pack(fill="x", padx=12, pady=(14, 0))
        self.auto_btn = ttk.Button(row, text="Auto Mix", style="Huge.TButton", command=self.auto_mix)
        self.auto_btn.pack(side="left")
        self.undo_btn = ttk.Button(row, text="Undo", command=self.undo_apply, state="disabled")
        self.undo_btn.pack(side="left", padx=8, ipady=self.px(4))
        self.progress = ttk.Progressbar(row, mode="determinate", maximum=1.0)
        self.progress.pack(side="left", fill="x", expand=True, padx=(12, 0))
        how = ttk.Label(self.root, wraplength=self.px(1020), justify="left", foreground="#555", text=(
            "Renders the project's stems in FL, balances the mix and moves the faders. Hands off the keyboard for the "
            "few seconds FL's export window is opening. Press it again to check: a balanced mix moves nothing."))
        how.pack(fill="x", **pad)

        opts = ttk.Frame(self.root)
        opts.pack(fill="x", **pad)
        ttk.Label(opts, text="Lead over its group target").pack(side="left")
        self.lead_boost = tk.DoubleVar(value=self.settings.get("lead_boost", analysis.DEFAULTS["lead_boost"]))
        sp = ttk.Spinbox(opts, from_=0, to=6, increment=0.5, width=5, textvariable=self.lead_boost,
                         command=self.replan)
        sp.pack(side="left", padx=4)
        sp.bind("<Return>", lambda e: self.replan())
        sp.bind("<FocusOut>", lambda e: self.replan())
        ttk.Label(opts, text="dB").pack(side="left")
        self.kick_boost = tk.BooleanVar(value=self.settings.get("kick_boost", False))
        ttk.Checkbutton(opts, text="Kick +2 dB", variable=self.kick_boost, command=self.replan).pack(side="left",
                                                                                                   padx=(18, 0))
        ttk.Button(opts, text="Back to the detected roles", command=self.reset_roles).pack(side="right")

        cols = ("insert", "name", "role", "lead", "level", "now", "change", "new")
        frame = ttk.Frame(self.root)
        frame.pack(fill="both", expand=True, **pad)
        self.tree = ttk.Treeview(frame, columns=cols, show="headings", selectmode="browse")
        heads = {"insert": ("Insert", 54, "center"), "name": ("Name", 260, "w"), "role": ("Role", 150, "w"),
                 "lead": ("Lead", 50, "center"), "level": ("In the mix", 90, "e"), "now": ("Fader now", 82, "e"),
                 "change": ("Change", 74, "e"), "new": ("New fader", 82, "e")}
        for c, (text, w, anchor) in heads.items():
            self.tree.heading(c, text=text)
            self.tree.column(c, width=self.px(w), anchor=anchor, stretch=c == "name")
        self.tree.tag_configure("off", foreground="#999")
        self.tree.tag_configure("lead", font=("Segoe UI", 9, "bold"))
        sb = ttk.Scrollbar(frame, orient="vertical", command=self.tree.yview)
        self.tree.configure(yscrollcommand=sb.set)
        self.tree.pack(side="left", fill="both", expand=True)
        sb.pack(side="left", fill="y")
        self.tree.bind("<Double-1>", self.on_double)

        self.summary = ttk.Label(self.root, wraplength=self.px(1020), justify="left", text="")
        self.summary.pack(fill="x", **pad)
        for label in (how, self.summary):  # wrap at the window's width, whatever it is
            label.bind("<Configure>", lambda e: e.widget.configure(wraplength=max(e.width - 4, 100)))

        acts = ttk.Frame(self.root)
        acts.pack(fill="x", **pad)
        self.apply_btn = ttk.Button(acts, text="Apply changes", style="Big.TButton", command=self.apply,
                                    state="disabled")
        self.apply_btn.pack(side="left")
        self.folder_btn = ttk.Button(acts, text="Use stems I exported…", command=self.analyse_folder)
        self.folder_btn.pack(side="right")

        self.log_box = tk.Text(self.root, height=7, wrap="word", font=("Consolas", 9), relief="flat",
                               background="#f4f4f4", state="disabled")
        self.log_box.pack(fill="x", padx=12, pady=8)
        self._set_status(False, "Not connected")

    # Plumbing: work runs on a thread, and everything it says comes back to the window through the queue.

    def _pump(self):
        try:
            while True:
                fn, args = self.q.get_nowait()
                fn(*args)
        except queue.Empty:
            pass
        self.root.after(50, self._pump)

    def later(self, fn, *args):
        self.q.put((fn, args))

    def run(self, what, work, done=None):
        if self.busy:
            return
        self.busy = True
        self._buttons()

        def go():
            try:
                result = work()
                self.later(self._finished, done, result, None)
            except Exception as e:  # shown in the window, not lost on a thread
                self.later(self._finished, done, None, e)
                self.later(self.log, "".join(traceback.format_exception_only(type(e), e)).strip(), True)

        self.log(what + "…")
        threading.Thread(target=go, daemon=True).start()

    def _callback_error(self, kind, error, tb):
        self.log("".join(traceback.format_exception_only(kind, error)).strip(), True)
        messagebox.showerror("Auto Mix", "Something went wrong: %s" % error, parent=self.root)

    def _finished(self, done, result, error):
        self.busy = False
        self.progress["value"] = 0
        if error is not None:
            if isinstance(error, link.NotConnected):
                self._drop_link(str(error))
            else:
                messagebox.showerror("Auto Mix", str(error), parent=self.root)
        elif done:
            done(result)
        self._buttons()

    def _buttons(self):
        idle = "disabled" if self.busy else "normal"
        self.auto_btn["state"] = idle
        self.folder_btn["state"] = idle
        self.connect_btn["state"] = idle
        self.apply_btn["state"] = "normal" if not self.busy and self.plan and self.link and self.plan["faders"] \
            and self.plan is not self.applied else "disabled"
        self.undo_btn["state"] = "normal" if not self.busy and self.undo and self.link else "disabled"

    def log(self, text, error=False):
        self.log_box["state"] = "normal"
        self.log_box.insert("end", time.strftime("%H:%M:%S  ") + text + "\n", ("err",) if error else ())
        self.log_box.tag_configure("err", foreground="#b00020")
        self.log_box.see("end")
        self.log_box["state"] = "disabled"

    def set_progress(self, f):
        self.later(self.progress.configure, {"value": f})

    # FL Studio

    def _set_status(self, ok, text):
        self.dot.delete("all")
        self.dot.create_oval(1, 1, self.px(12) - 1, self.px(12) - 1, fill="#2e9d4f" if ok else "#c0392b", outline="")
        self.status["text"] = text

    def project(self):
        return link.project_name(self.link.title) if self.link else None

    def connect(self, quiet=False):
        def work():
            if self.link:
                self.link.close()
                self.link = None
            return link.connect(timeout=5)

        def done(l):
            self.link = l
            name = self.project()
            self._set_status(True, "Connected to %s%s" % (l.hello.get("fl") or "FL Studio",
                                                         " — " + name if name else ""))
            self.log("Connected to FL Studio (script version %s)." % l.hello.get("version"))
            if l.hello.get("version", 0) < 3 or flsetup.script_state() == "old":
                self.log("FL is running an older Auto Mix script: press Set up FL Studio… to update it.", True)

        if quiet:
            threading.Thread(target=lambda: self._quiet(work, done), daemon=True).start()
        else:
            self.run("Connecting to FL Studio", work, done)

    def _quiet(self, work, done):
        try:
            l = work()
        except Exception as e:
            self.later(self._drop_link, str(e))
            self.later(self._first_run_hint)
            return
        self.later(done, l)
        self.later(self._buttons)

    def _first_run_hint(self):
        if flsetup.script_state() == "missing" or not flsetup.assigned_input():
            self.log("First time? Press Set up FL Studio… to put the Auto Mix script in FL.")

    def _drop_link(self, why):
        if self.link:
            self.link.close()
        self.link = None
        self._set_status(False, "Not connected")
        self.log(why, True)
        self._buttons()

    # Analysing

    def _ready(self):
        if self.link:
            return True
        messagebox.showinfo("Auto Mix", "Auto Mix isn't connected to FL Studio. Open FL (with the Auto Mix script set "
                            "up: Set up FL Studio…), then press Connect.", parent=self.root)
        return False

    def auto_mix(self):
        """Renders the stems in FL, analyses them, and applies the plan, in one go."""
        if not self._ready():
            return
        lead, kick = self._options()

        def scale(lo, hi):
            return lambda f: self.set_progress(lo + (hi - lo) * f)

        def work():
            song = self.link.hello.get("version", 0) >= 5
            was = self.link.call("song", on=True)["wasSong"] if song else True
            try:
                folder, prefix = render.render_stems(self.link.pid, progress=scale(0, 0.55),
                                                     log=lambda s: self.later(self.log, s))
            finally:
                if not was:
                    self.link.call("song", on=False)
            self.later(self.log, "Listening to the stems…")
            a, plan = self._analyse(folder, prefix, lead, kick, scale(0.55, 0.97))
            moved = self._move(plan["faders"], UNDO_NAME) if plan["faders"] else None
            return a, plan, moved

        def done(r):
            a, plan, moved = r
            self.applied = plan  # so the table doesn't offer to apply what's just been applied
            self._analysed(a, plan)
            if moved:
                self._applied(moved)
            else:
                self.log("Already balanced: no fader needed to move.")

        self.run("Auto Mix: FL is opening its export", work, done)

    def analyse_folder(self):
        """Analyses stems exported by hand (a song FL can't render here, say). Apply changes then applies it."""
        if not self._ready():
            return
        start = self.settings.get("folder") or (RENDERED if os.path.isdir(RENDERED) else os.path.expanduser("~"))
        folder = filedialog.askdirectory(parent=self.root, initialdir=start, title="The folder FL exported the split "
                                         "mixer tracks into (32Bit float)")
        if not folder:
            return
        folder = os.path.normpath(folder)
        self.settings["folder"] = folder
        save_settings(self.settings)
        lead, kick = self._options()
        project = self.project()
        self.run("Analysing %s" % folder, lambda: self._analyse(folder, project, lead, kick, self.set_progress),
                 lambda r: self._analysed(*r))

    def _analyse(self, folder, project, lead, kick, progress):
        state = self.link.call("state", timeout=15)
        a = analysis.Analysis(folder, state, project=project, progress=progress,
                              log=lambda s: self.later(self.log, s)).analyse()
        return a, a.plan(lead, kick)

    def _analysed(self, a, plan):
        self.analysis, self.plan = a, plan
        self.lead_overrides = {}
        self.set_to = {}  # the analysis read the faders as they are now (Undo still goes back before Apply)
        self.show()

    def _options(self):
        try:
            lead = max(0.0, min(6.0, float(self.lead_boost.get())))
        except (tk.TclError, ValueError):
            lead = analysis.DEFAULTS["lead_boost"]
        kick = 2.0 if self.kick_boost.get() else 0.0
        if self.settings.get("lead_boost") != lead or self.settings.get("kick_boost") != bool(kick):
            self.settings["lead_boost"], self.settings["kick_boost"] = lead, bool(kick)
            save_settings(self.settings)
        return lead, kick

    def replan(self):
        if not self.analysis or self.busy:
            return
        lead, kick = self._options()
        a = self.analysis

        def work():
            a.progress = self.set_progress
            return a.plan(lead, kick)

        self.run("Working out the faders again", work, self._replanned)

    def _replanned(self, plan):
        self.plan = plan
        self.show()

    def show(self):
        p = self.plan
        self.tree.delete(*self.tree.get_children())
        for r in p["rows"]:
            role = analysis.ROLE_NAMES.get(r["role"], r["role"])
            if r["role"] != r["autoRole"]:
                role += " (yours)"
            elif r["roleFrom"] == "sound":
                role += " (by ear)"
            off = r["group"] is None
            tags = ("off",) if off else ("lead",) if r["group"] == p["lead"] else ()
            self.tree.insert("", "end", iid=str(r["index"]), tags=tags, values=(
                r["index"], r["name"], role, "★" if r["role"] == "vocal" and r["lead"] else "",
                analysis.fmt(r["lufs"]) + (" LUFS" if not off else ""), analysis.fmt(r["db"]) + " dB",
                ("— " + r.get("why", "")) if off else analysis.fmt(r["change"], True),
                analysis.fmt(r["new"]) + " dB"))
        groups = "   ".join("%s %s" % (g["name"], analysis.fmt(g["change"], True)) for g in p["groups"])
        lead_name = analysis.GROUP_NAMES[p["lead"]].lower()
        moves = [abs(r["change"]) for r in p["rows"] if r["group"]]
        text = ("Groups: %s\nThe %s sits %s LU against the whole mix. The song stays at %s LUFS before your master."
                % (groups, lead_name, analysis.fmt(p["leadToMix"], True), analysis.fmt(p["mixAfter"])))
        if moves and max(moves) < 0.5:
            text = "Already balanced: no fader needs to move more than half a dB.\n" + text
        self.summary["text"] = text
        for w in p["warnings"]:
            self.log(w, True)
        if self.plan is not self.applied and p["faders"]:
            self.log("%d fader%s to move: Apply changes moves them. Double-click a role that's wrong to change it, "
                     "or the Lead column to pick the lead vocals." % (len(p["faders"]),
                                                                      "" if len(p["faders"]) == 1 else "s"))
        self._buttons()

    def on_double(self, event):
        if not self.analysis or self.busy:
            return
        iid = self.tree.identify_row(event.y)
        col = self.tree.identify_column(event.x)
        if not iid:
            return
        t = self.analysis.tracks[int(iid)]
        if col == "#4" and t.role == "vocal":
            t.lead = not t.lead
            self.lead_overrides[t.index] = t.lead
            self.replan()
            return
        menu = tk.Menu(self.root, tearoff=False)
        self._role_var = tk.StringVar(value=t.role)
        for role in analysis.ROLES:
            menu.add_radiobutton(label=analysis.ROLE_NAMES[role], value=role, variable=self._role_var,
                                 command=lambda r=role: self.set_role(t, r))
        menu.tk_popup(event.x_root, event.y_root)

    def set_role(self, t, role):
        if t.role == role:
            return
        t.role = role
        self.analysis._leads()  # who leads depends on which inserts are vocals
        for i, lead in self.lead_overrides.items():
            if self.analysis.tracks[i].role == "vocal":
                self.analysis.tracks[i].lead = lead
        self.replan()

    def reset_roles(self):
        if not self.analysis:
            return
        for t in self.analysis.leaves():
            t.role = t.auto_role
        self.analysis._leads()
        self.lead_overrides = {}
        self.replan()

    # Applying

    def apply(self):
        p = self.plan
        if not p or not self.link:
            return
        planned = {r["index"]: r for r in p["rows"]}

        def work():
            state = self.link.call("state", timeout=15)
            now = {t["index"]: t for t in state["tracks"]}
            moved = [i for i in planned if i in now and abs(now[i]["db"] - self.set_to.get(i, planned[i]["db"])) > 0.05]
            names = [now[i]["name"] for i in planned if i in now and now[i]["name"] != planned[i]["name"]]
            return state, moved, names

        def checked(r):
            state, moved, renamed = r
            if renamed:
                messagebox.showerror("Auto Mix", "The mixer in FL isn't the one that was analysed (inserts have "
                                     "other names now). Analyse again.", parent=self.root)
                return
            if moved and not messagebox.askyesno(
                    "Auto Mix", "%d fader%s moved since the analysis. Apply the plan anyway (the planned levels "
                    "replace yours)?" % (len(moved), "" if len(moved) == 1 else "s"), parent=self.root):
                return
            self.root.after(1, lambda: self.run("Moving %d faders in FL" % len(p["faders"]),
                                                lambda: self._move(p["faders"], UNDO_NAME), self._applied))

        if self.link.hello.get("version", 0) < 3:
            messagebox.showinfo("Auto Mix", "FL is running an older Auto Mix script. Press Set up FL Studio… to "
                                "install this one, then restart FL Studio.", parent=self.root)
            return
        self.run("Checking FL's mixer", work, checked)

    def _move(self, faders, undo_name):
        """Sets the faders, then reads the mixer back a moment later (FL shows some inserts' new level only after a
        while) to see where they landed."""
        result = self.link.call("apply", faders=faders, undoName=undo_name, timeout=30)
        time.sleep(0.4)
        now = {t["index"]: t["db"] for t in self.link.call("state", timeout=15)["tracks"]}
        off = [(f["index"], f["db"], now.get(f["index"])) for f in faders
               if "db" in f and now.get(f["index"]) is not None and abs(now[f["index"]] - f["db"]) > 0.05]
        return result, off

    def _applied(self, r):
        result, off = r
        done = result["faders"]
        undo = {f["index"]: f for f in self.undo or []}  # a second Apply keeps the levels from before the first
        for f in done:
            undo.setdefault(f["index"], {"index": f["index"], "value": f["beforeValue"], "db": f["before"]})
        self.undo = list(undo.values())
        self.applied = self.plan
        self.set_to.update({f["index"]: f["db"] for f in self.plan["faders"]})
        self.log("Done: %d faders moved in FL. Undo puts them back. Double-click a role that's wrong to change it, "
                 "then Apply changes." % len(done))
        for i, want, got in off:
            self.log("Insert %d is at %s dB, not %s: is its fader automated?" % (i, analysis.fmt(got),
                                                                                analysis.fmt(want)), True)

    def undo_apply(self):
        if not self.undo or not self.link:
            return
        faders = self.undo

        def done(r):
            self.undo = self.applied = None
            self.set_to.update({f["index"]: f["db"] for f in faders})
            self.log("Faders back where they were." if not r[1] else "Faders back, but %d didn't land where they "
                     "were." % len(r[1]), bool(r[1]))

        self.run("Putting %d faders back" % len(faders), lambda: self._move(faders, UNDO_NAME + " undo"), done)

    # Setup

    def setup_dialog(self):
        SetupDialog(self)

    def quit(self):
        if self.link:
            self.link.close()
        render.clear()  # the last render's stems: a song's worth of 32-bit audio per insert
        self.root.destroy()


class SetupDialog:
    """Installs the script and puts it on a MIDI input (or says how, while FL is open)."""

    def __init__(self, app):
        self.app = app
        w = self.w = tk.Toplevel(app.root)
        w.title("Set up FL Studio")
        w.transient(app.root)
        w.resizable(False, False)
        f = ttk.Frame(w, padding=16)
        f.pack(fill="both", expand=True)
        self.script = ttk.Label(f, wraplength=app.px(520), justify="left")
        self.script.pack(anchor="w")
        ttk.Button(f, text="Install the script", command=self.install).pack(anchor="w", pady=(6, 14))
        ttk.Separator(f).pack(fill="x")
        self.input = ttk.Label(f, wraplength=app.px(520), justify="left")
        self.input.pack(anchor="w", pady=(14, 6))
        row = ttk.Frame(f)
        row.pack(anchor="w", fill="x")
        self.choice = tk.StringVar()
        self.box = ttk.Combobox(row, textvariable=self.choice, state="readonly", width=40)
        self.box.pack(side="left")
        self.assign_btn = ttk.Button(row, text="Use this input", command=self.assign)
        self.assign_btn.pack(side="left", padx=6)
        self.how = ttk.Label(f, wraplength=app.px(520), justify="left", foreground="#555", text=flsetup.INSTRUCTIONS)
        self.how.pack(anchor="w", pady=(10, 0))
        ttk.Button(f, text="Close", command=w.destroy).pack(anchor="e", pady=(14, 0))
        self.refresh()
        w.update_idletasks()  # over the window it came from, not in the screen's corner
        x = app.root.winfo_rootx() + (app.root.winfo_width() - w.winfo_reqwidth()) // 2
        y = app.root.winfo_rooty() + 40
        w.geometry("+%d+%d" % (max(x, 0), max(y, 0)))
        w.grab_set()

    def refresh(self):
        state = flsetup.script_state()
        self.script["text"] = {
            "missing": "1. The script isn't in FL Studio yet.",
            "old": "1. FL Studio has an older Auto Mix script: install this one (then restart FL, or reload the "
                   "script in View › Script output).",
            "current": "1. The script is installed (%s)." % flsetup.installed_path(),
        }[state]
        names, live = flsetup.candidate_inputs()
        current = flsetup.assigned_input()
        self.box["values"] = ["%s%s" % (n, "" if n in live else "  (not plugged in)") for n in names]
        pick = current or (names[0] if names else "")
        if pick:
            self.choice.set(pick + ("" if pick in live else "  (not plugged in)"))
        fl_open = bool(link.fl_processes())
        if current:
            self.input["text"] = ("2. FL runs the script for the MIDI input \"%s\"%s." %
                                  (current, "" if current in live else ", which isn't plugged in now"))
        else:
            self.input["text"] = "2. The script isn't on a MIDI input yet."
        if fl_open and not current:
            self.input["text"] += " FL Studio is open, so set it there (below), or close FL and come back here."
        elif fl_open:
            self.input["text"] += " (FL Studio is open: to move it to another input, do it there, or close FL first.)"
        self.assign_btn["state"] = "disabled" if fl_open else "normal"

    def install(self):
        try:
            p = flsetup.install_script()
            self.app.log("Script installed: %s" % p)
        except Exception as e:
            messagebox.showerror("Auto Mix", str(e), parent=self.w)
        self.refresh()

    def assign(self):
        name = self.choice.get().replace("  (not plugged in)", "")
        if not name:
            return
        if link.fl_processes():
            messagebox.showinfo("Auto Mix", "Close FL Studio first: it writes its MIDI settings back when it "
                                "quits.", parent=self.w)
            self.refresh()
            return
        old = flsetup.fl_inputs().get(name, {}).get("ScriptFolder")
        if old and old != flsetup.FOLDER and not messagebox.askyesno(
                "Auto Mix", "\"%s\" runs the \"%s\" script now. Use it for Auto Mix instead?" % (name, old),
                parent=self.w):
            return
        if flsetup.script_state() != "current":
            flsetup.install_script()
        port = flsetup.assign(name)
        self.app.log("FL will run Auto Mix for \"%s\" (port %d)%s. Start FL Studio, then Connect." %
                     (name, port, "; it ran \"%s\" before" % old if old and old != flsetup.FOLDER else ""))
        self.refresh()


def main():
    try:
        import ctypes
        ctypes.windll.shcore.SetProcessDpiAwareness(1)
    except Exception:
        pass
    root = tk.Tk()
    App(root)
    root.mainloop()


if __name__ == "__main__":
    main()

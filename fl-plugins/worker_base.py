"""What the two plugins' hidden halves share: lines of JSON with the plugin, the connection to FL's script, running a
job, setting FL up. worker.py is YT-Mix's, fill_worker.py YT-Fill's.

Lines of JSON both ways. In, from the plugin: {"cmd": ...} (see `BaseWorker.handle`). Out:
    {"ev": "view", ...}       everything the plugin shows, sent after every change
    {"ev": "log", "text", "error"}
    {"ev": "progress", "value"}
    {"ev": "ask", "text", "yes": {cmd}}   a question; the plugin sends `yes` back if the answer is yes
    {"ev": "alert", "text"}   something the user has to act on
    {"ev": "save", "state"}   what the plugin keeps in the project
    {"ev": "setup", "text", "canInstall"}

    pythonw <worker> <FL's pid>
"""
import copy
import json
import queue
import sys
import threading
import traceback

import flsetup
import link

RETRY_S = 3.0  # how often to look for the FL script while it isn't connected

_out = sys.stdout
_lock = threading.Lock()


def _write(ev, fields):
    with _lock:
        _out.write(json.dumps({"ev": ev, **fields}) + "\n")
        _out.flush()


sink = _write  # where everything said goes: a test puts its own here


def send(ev, **fields):
    sink(ev, fields)


def log(text, error=False):
    send("log", text=text, error=error)


class BaseWorker:
    NAME = ""  # the plugin's, for what it says about itself
    SAVED = {}  # what the plugin keeps in the project, with its defaults
    ERRORS = (ValueError, RuntimeError)  # a job's failures whose message says it all

    def __init__(self, pid):
        self.pid = pid
        self.link = None
        self.status = "Looking for FL Studio's script…"
        self.busy = False
        self.saved = copy.deepcopy(self.SAVED)
        self.hinted = False
        self.failed = 0  # tries that found no script, for not saying so at the first

    def view(self):
        raise NotImplementedError

    def command(self, cmd, req):
        """A command of this plugin's own. False if it isn't one."""
        return False

    def started(self):
        """After the plugin's `init`, connected or not."""
        self.view()

    def idle(self):
        """Every few seconds while nothing else is going on."""

    def connected(self):
        """After the connection came, some while after `init`."""
        self.view()

    def save(self):
        send("save", state=self.saved)

    # FL Studio

    def connect(self, quiet=False):
        if self.link:
            self.link.close()
            self.link = None
        try:
            title = link._window_titles().get(self.pid)
            if title:
                self.link = link.Link(self.pid, title).open(timeout=4)
            else:  # the plugin isn't in FL's own process (bridged): the first FL that answers
                self.link = link.connect(timeout=4)
        except Exception as e:
            self.link = None
            self.status = "Not connected to FL Studio's script"
            if not quiet:
                log(str(e), True)
            if not self.hinted:
                if flsetup.script_state() == "missing" or not flsetup.assigned_input():
                    self.hinted = True
                    log("First time? Press Set up FL Studio… to put the script in FL.")
                else:  # FL doesn't answer while it loads a project, which is no one's problem yet
                    self.failed += 1
                    if self.failed >= 3:
                        self.hinted = True
                        log(str(e), True)
            return False
        self.retitle()
        log("Connected to FL Studio (script version %s)." % self.link.hello.get("version"))
        if self.link.hello.get("version", 0) < 7 or flsetup.script_state() == "old":
            log("FL is running an older script: press Set up FL Studio… to update it.", True)
        return True

    def retitle(self):
        """The project's name from FL's title, which changes on Save As."""
        if not self.link:
            return
        self.link.title = link._window_titles().get(self.link.pid, self.link.title)
        name = link.project_name(self.link.title)
        self.status = "Connected to %s%s" % (self.link.hello.get("fl") or "FL Studio", " — " + name if name else "")

    def project(self):
        return link.project_name(self.link.title) if self.link else None

    def need_link(self):
        if not self.link and not self.connect():
            raise link.NotConnected("%s isn't connected to FL Studio. Press Set up FL Studio… for how." % self.NAME)

    # Commands

    def handle(self, req):
        cmd = req.get("cmd")
        if cmd == "init":
            saved = req.get("saved") or {}
            if isinstance(saved, dict):
                self.saved.update({k: saved[k] for k in self.SAVED if k in saved})
            if not self.link:
                self.connect(quiet=True)
            self.started()
        elif cmd == "connect":
            self.run("Connecting to FL Studio", lambda: self.connect())
        elif cmd == "setup":
            self.setup_info()
        elif cmd == "install":
            try:
                log("Script installed: %s" % flsetup.install_script())
                log("Reload it in FL (View › Script output › Reload script), or restart FL.")
            except Exception as e:
                send("alert", text=str(e))
            self.setup_info()
        elif cmd == "tick":
            if not self.link and not self.busy:
                if self.connect(quiet=True):
                    self.connected()
            elif self.link and not self.busy:
                self.idle()
        elif not self.command(cmd, req):
            log("Unknown command %r" % cmd, True)

    def run(self, what, work):
        if self.busy:
            return
        self.busy = True
        log(what + "…")
        self.view()
        try:
            work()
        except link.NotConnected as e:
            if self.link:
                self.link.close()
            self.link = None
            self.status = "Not connected to FL Studio's script"
            log(str(e), True)
        except self.ERRORS as e:
            log(str(e), True)
            send("alert", text=str(e))
        except Exception as e:
            log("".join(traceback.format_exception_only(type(e), e)).strip(), True)
            send("alert", text="Something went wrong: %s" % e)
        finally:
            self.busy = False
            send("progress", value=0)
            self.view()

    def setup_info(self):
        state = flsetup.script_state()
        script = {
            "missing": "1. The script isn't in FL Studio yet: press Install the script.",
            "old": "1. FL Studio has an older script: press Install the script, then reload it in FL "
                   "(View › Script output › Reload script).",
            "current": "1. The script is installed.",
        }[state]
        current = flsetup.assigned_input()
        names, live = flsetup.candidate_inputs()
        if current:
            inp = "2. FL runs it for the MIDI input \"%s\"%s." % (current, "" if current in live
                                                                    else ", which isn't plugged in now")
        else:
            inp = "2. It isn't on a MIDI input yet. FL only runs a script for a MIDI input:"
        connected = "Connected: it's all set up." if self.link else ""
        send("setup", text="\n\n".join(s for s in (connected, script, inp, flsetup.INSTRUCTIONS) if s),
             canInstall=state != "current")

    def close(self):
        if self.link:
            self.link.close()


def main(worker_class):
    sys.stdin.reconfigure(encoding="utf-8")
    pid = int(sys.argv[1]) if len(sys.argv) > 1 else 0
    w = worker_class(pid)
    lines = queue.Queue()

    def read():
        for line in sys.stdin:
            lines.put(line)
        lines.put(None)  # the plugin has gone

    threading.Thread(target=read, daemon=True).start()
    try:
        while True:
            try:
                line = lines.get(timeout=RETRY_S)
            except queue.Empty:
                w.handle({"cmd": "tick"})
                continue
            if line is None:
                break
            line = line.strip()
            if not line:
                continue
            try:
                w.handle(json.loads(line))
            except Exception as e:
                log("".join(traceback.format_exception_only(type(e), e)).strip(), True)
                w.view()
    finally:
        w.close()

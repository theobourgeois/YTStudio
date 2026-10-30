"""Renders every song in songs.json into the trainer's library, by driving the FL Studio that's running: open the
project, read its mixer through the Auto Mix script, export its split stems (render.py), and hand them to prep.py
in the background while FL goes on to the next one. Resumable: a song with a song.json is done.

FL comes to the front for each export, so leave the computer alone while it runs. Your projects aren't saved: FL is
told No when it asks.

    python batch_render.py [--only id,id] [--limit n] [--redo]
Writes Documents/YTStudio Auto Mix/training/songs/<id>/ and batch.log there.
"""
import json
import os
import subprocess
import sys
import time
import traceback

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.dirname(HERE))

import analysis  # noqa: E402
import flctl as fl  # noqa: E402
import link  # noqa: E402
import render  # noqa: E402

SONGS = os.path.join(analysis.TRAINING, "songs")
LOG = os.path.join(analysis.TRAINING, "batch.log")
PREPS = 2  # songs being encoded at once while FL renders the next


def log(text):
    line = "%s %s" % (time.strftime("%H:%M:%S"), text)
    print(line, flush=True)
    with open(LOG, "a", encoding="utf8") as f:
        f.write(line + "\n")


def connect(pid):
    """The script takes a new link only once the last one is gone (the plugin's worker quits with its project)."""
    for _ in range(20):
        try:
            return link.Link(pid, fl.main_title(pid) or "").open(timeout=4)
        except link.NotConnected:
            time.sleep(1)
    raise link.NotConnected("FL's Auto Mix script didn't answer")


def main():
    args = sys.argv[1:]
    only = set(args[args.index("--only") + 1].split(",")) if "--only" in args else None
    limit = int(args[args.index("--limit") + 1]) if "--limit" in args else None
    redo = "--redo" in args
    os.makedirs(SONGS, exist_ok=True)
    with open(os.path.join(HERE, "songs.json")) as f:
        songs = json.load(f)
    todo = [s for s in songs if (only is None or s["id"] in only) and
            (redo or not os.path.exists(os.path.join(SONGS, s["id"], "song.json")))]
    failed_file = os.path.join(SONGS, "failed.json")
    failed = json.load(open(failed_file)) if os.path.exists(failed_file) else {}
    if not redo and only is None:
        todo = [s for s in todo if s["id"] not in failed]
    todo = todo[:limit] if limit else todo
    procs = link.fl_processes()
    if not procs:
        sys.exit("FL Studio isn't running")
    pid = procs[0][0]
    log("Rendering %d songs in FL (pid %d)" % (len(todo), pid))
    lk = None
    running = []  # (song id, Popen, started)

    def reap(block_until=PREPS):
        while len(running) >= block_until:
            for item in list(running):
                sid, p, started = item
                if p.poll() is not None:
                    running.remove(item)
                    if p.returncode:
                        log("%s: prep failed (see %s)" % (sid, os.path.join(SONGS, sid, "prep.log")))
                        failed[sid] = "prep failed"
                        json.dump(failed, open(failed_file, "w"), indent=1)
                    else:
                        log("%s: ready (%.0f s to encode)" % (sid, time.monotonic() - started))
            if len(running) >= block_until:
                time.sleep(1)

    for n, s in enumerate(todo, 1):
        folder = os.path.join(SONGS, s["id"])
        os.makedirs(folder, exist_ok=True)
        t0 = time.monotonic()
        log("[%d/%d] %s  (%s)" % (n, len(todo), s["id"], s["flp"]))
        try:
            for d in fl.open_project(pid, os.path.normpath(s["flp"]), log=log):
                pass
            if lk is None:
                lk = connect(pid)
            try:
                state = lk.call("state", timeout=20)
            except link.NotConnected:
                lk.close()
                lk = connect(pid)
                state = lk.call("state", timeout=20)
            lk.call("song", on=True)
            with open(os.path.join(folder, "state.json"), "w") as f:
                json.dump(state, f)
            with open(os.path.join(folder, "source.json"), "w") as f:
                json.dump(s, f, indent=1)
            last = [0]

            def progress(v):
                if v - last[0] >= 0.25:
                    last[0] = v
                    log("  rendering %d%%" % (v * 100))

            for attempt in (1, 2):
                try:
                    render.render_stems(pid, os.path.join(folder, "wav"), progress=progress)
                    break
                except render.RenderError as e:  # FL wasn't ready for Ctrl+R yet (a report just closed, a plugin loading)
                    if attempt == 2:
                        raise
                    log("  %s: trying again" % e)
                    for h, cls, t, texts in fl.dialogs(pid):
                        if cls in fl.BOXES:
                            fl.answer(h, cls, t)
                    time.sleep(3)
            log("  rendered in %.0f s" % (time.monotonic() - t0))
            failed.pop(s["id"], None)
            reap()
            plog = open(os.path.join(folder, "prep.log"), "w")
            p = subprocess.Popen([sys.executable, os.path.join(HERE, "prep.py"), folder], stdout=plog,
                                 stderr=subprocess.STDOUT, creationflags=subprocess.CREATE_NO_WINDOW |
                                 subprocess.BELOW_NORMAL_PRIORITY_CLASS)
            running.append((s["id"], p, time.monotonic()))
        except Exception as e:
            log("  FAILED: %s" % ("".join(traceback.format_exception_only(type(e), e)).strip()))
            failed[s["id"]] = str(e)
            json.dump(failed, open(failed_file, "w"), indent=1)
            for h, cls, t, texts in fl.dialogs(pid):  # whatever is left open would stop the next one
                fl.click(h, "Cancel", "Close", "OK", "No") or fl._u.PostMessageW(h, fl.WM_CLOSE, 0, 0)
            if not fl.main_title(pid):
                break
    reap(1)
    if lk:
        lk.close()
    done = sum(os.path.exists(os.path.join(SONGS, s["id"], "song.json")) for s in songs)
    log("Finished: %d of %d songs ready, %d failed" % (done, len(songs), len(failed)))


if __name__ == "__main__":
    main()

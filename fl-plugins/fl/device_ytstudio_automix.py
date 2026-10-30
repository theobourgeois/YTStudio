# name=YTStudio Auto Mix
# url=https://github.com/theobourgeois
#
# YT-Mix's and YT-Fill's hands inside FL Studio. Those plugins do the listening and the deciding; this script tells them
# what the mixer looks like and changes what it's asked to. (It keeps its first name, so FL's MIDI settings still find it.)
#
# FL runs scripts in a sandbox: no files, sockets or registry. So the window makes a pipe, puts one end of it into
# FL's process itself (DuplicateHandle), and names that handle in a file in Documents/YTStudio Auto Mix
# ("<FL's pid>-<handle>-<nonce>.link": handles are reused, so the nonce tells a new link from one
# already tried). The script only lists that folder, and reads and writes a handle it was given.
# Messages are lines of JSON: {"id", "cmd", ...} in, {"id", "ok", "result" | "error"} out.
#
# It handles no MIDI, so whatever controller its input belongs to keeps working as a generic one.

import json
import os
import time

import _winapi

import channels
import general
import mixer
import plugins
import transport
import ui

VERSION = 7
EXCHANGE = os.path.join(os.path.expanduser("~"), "Documents", "YTStudio Auto Mix")
MAX_DB = 5.6  # an FL fader all the way up
SCAN_S = 0.5  # how often to look for a new window

_clients = []  # every plugin connected now, each {"pipe", "buf"}: YT-Mix and YT-Fill can both be open
_tried = set()
_next_scan = 0.0


def OnInit():
    print("YTStudio Auto Mix %d ready: open YT-Mix or YT-Fill to connect." % VERSION)


def OnDeInit():
    for c in list(_clients):
        _drop(c)


def OnIdle():
    global _next_scan
    now = time.monotonic()
    if now >= _next_scan:
        _next_scan = now + SCAN_S
        _scan()
    for c in list(_clients):
        _poll(c)


def _scan():
    """Picks up the handles windows left for this process."""
    try:
        names = os.listdir(EXCHANGE)
    except Exception:
        return
    me = os.getpid()
    for name in names:
        if not name.endswith(".link") or name in _tried:
            continue
        _tried.add(name)
        try:
            pid, handle = (int(p) for p in name[:-5].split("-")[:2])
        except ValueError:
            continue
        if pid != me:
            continue
        try:
            _winapi.PeekNamedPipe(handle, 0)
        except Exception:
            continue  # a window that has gone: its handle is dead
        _clients.append({"pipe": handle, "buf": b""})
        print("YTStudio Auto Mix: connected (%d)" % len(_clients))


def _drop(c):
    if c in _clients:
        _clients.remove(c)
    try:
        _winapi.CloseHandle(c["pipe"])
    except Exception:
        pass


def _poll(c):
    try:
        n = _winapi.PeekNamedPipe(c["pipe"], 0)[0]
        if not n:
            return
        data, _ = _winapi.ReadFile(c["pipe"], n)
    except Exception:
        print("YTStudio Auto Mix: window closed")
        _drop(c)
        return
    c["buf"] += data
    while b"\n" in c["buf"]:
        line, c["buf"] = c["buf"].split(b"\n", 1)
        if line.strip():
            _answer(c, line)


def _answer(c, line):
    req = {}
    try:
        req = json.loads(line.decode("utf-8"))
        reply = {"id": req.get("id"), "ok": True, "result": _handle(req)}
    except Exception as e:
        reply = {"id": req.get("id"), "ok": False, "error": "%s: %s" % (type(e).__name__, e)}
    try:
        _winapi.WriteFile(c["pipe"], (json.dumps(reply) + "\n").encode("utf-8"))
    except Exception:
        _drop(c)


def _handle(req):
    cmd = req.get("cmd")
    if cmd == "ping":
        return {"version": VERSION, "pid": os.getpid(), "fl": _fl_version()}
    if cmd == "state":
        return _state()
    if cmd == "apply":
        return _apply(req.get("faders") or [], req.get("undoName") or "Auto mix")
    if cmd == "song":
        return _song(bool(req.get("on", True)))
    if cmd == "fillState":
        return _fill_state()
    if cmd == "fill":
        return _fill(req.get("channels") or [], req.get("inserts") or [], req.get("undoName") or "Fill inserts")
    raise ValueError("unknown command %r" % cmd)


def _fl_version():
    try:
        return ui.getVersion()
    except Exception:
        return None


def _db(i):
    return mixer.getTrackVolume(i, 1)


def _routes(i, count):
    out = []
    for j in range(count):
        if j != i and mixer.getRouteSendActive(i, j):
            level = None
            try:
                level = mixer.getRouteToLevel(i, j)
            except Exception:
                pass
            out.append({"to": j, "level": level})
    return out


def _state():
    """Every insert: its name, fader, mute and routing, and the names of the channels that play into it. (Audio clips
    and playlist tracks can feed an insert too, so which ones carry sound is for the window to tell from the stems.)"""
    count = mixer.trackCount() - 1  # the last one is the "current" track, not a real insert
    on_insert = {}
    for c in range(channels.channelCount(1)):  # every channel, not just the Channel rack's current group
        t = channels.getTargetFxTrack(c, True)
        on_insert.setdefault(t, []).append(channels.getChannelName(c, True))
    tracks = []
    for i in range(1, count):
        tracks.append({
            "index": i,
            "name": mixer.getTrackName(i),
            "db": _db(i),
            "value": mixer.getTrackVolume(i),
            "muted": bool(mixer.isTrackMuted(i)),
            "channels": on_insert.get(i, []),
            "routes": _routes(i, count),
        })
    master = {"index": 0, "name": mixer.getTrackName(0), "db": _db(0), "channels": on_insert.get(0, [])}
    return {"tracks": tracks, "master": master, "maxDb": MAX_DB, "fl": _fl_version()}


def _song(on):
    """Stops playback and puts FL in song mode (on) or pattern mode, so its export renders the whole song. Returns
    whether it was in song mode, for putting it back."""
    was = transport.getLoopMode() == 1
    if transport.isPlaying():
        transport.stop()
    if was != on:
        transport.setLoopMode()  # toggles
    return {"wasSong": was}


def _apply(faders, undo_name):
    """Sets each fader to the 0–1 value the window worked out from FL's fader curve. (Finding it here by setting and
    reading back doesn't work: on some inserts FL reports the old level until later.)"""
    try:
        general.saveUndo(undo_name, 0)
    except Exception:
        pass
    done = []
    for f in faders:
        i = int(f["index"])
        before = {"index": i, "before": _db(i), "beforeValue": mixer.getTrackVolume(i)}
        mixer.setTrackVolume(i, min(max(float(f["value"]), 0.0), 1.0))
        done.append(before)
    return {"faders": done}


def _plugin_name(c):
    try:
        return plugins.getPluginName(c, -1, 0, True) if plugins.isValid(c, -1, True) else None
    except Exception:
        return None


def _effects(i):
    n = 0
    for slot in range(10):
        try:
            if plugins.isValid(i, slot):
                n += 1
        except Exception:
            break
    return n


def _fill_state():
    """For Fill inserts: every channel (what it is and where it plays) and every insert (what's on it and where it goes).
    Which preset a Serum has loaded isn't something FL tells a script: the window reads that from the saved project."""
    count = mixer.trackCount() - 1
    chans = []
    for c in range(channels.channelCount(1)):
        chans.append({
            "index": c,
            "name": channels.getChannelName(c, True),
            "type": channels.getChannelType(c, True),
            "target": channels.getTargetFxTrack(c, True),
            "plugin": _plugin_name(c),
        })
    tracks = []
    for i in range(0, count):
        tracks.append({
            "index": i,
            "name": mixer.getTrackName(i),
            "color": mixer.getTrackColor(i),
            "fx": _effects(i),
            "value": mixer.getTrackVolume(i),
            "routes": _routes(i, count),
        })
    try:
        changed = general.getChangedFlag()
    except Exception:
        changed = None
    return {"channels": chans, "tracks": tracks, "changed": changed}


def _fill(chans, inserts, undo_name):
    """Moves channels and changes inserts (name, colour, routes on and off), and returns what it found, in the shape this
    takes, so sending that back puts everything as it was."""
    try:
        general.saveUndo(undo_name, 0)
    except Exception:
        pass
    before = {"channels": [], "inserts": []}
    for c in chans:
        i = int(c["index"])
        before["channels"].append({"index": i, "target": channels.getTargetFxTrack(i, True)})
    count = mixer.trackCount() - 1
    for s in inserts:
        i = int(s["index"])
        on, off = [int(t) for t in s.get("on") or []], [int(t) for t in s.get("off") or []]
        was = {"index": i, "name": mixer.getTrackName(i), "color": mixer.getTrackColor(i), "on": [], "off": [], "levels": []}
        for t in on:
            if not mixer.getRouteSendActive(i, t):
                was["off"].append(t)
        for t in off:
            if mixer.getRouteSendActive(i, t):
                was["on"].append(t)
                try:
                    was["levels"].append({"to": t, "level": mixer.getRouteToLevel(i, t)})
                except Exception:
                    pass
        before["inserts"].append(was)
    for c in chans:
        channels.setTargetFxTrack(int(c["index"]), int(c["target"]), True)
    for s in inserts:
        i = int(s["index"])
        if "name" in s:
            mixer.setTrackName(i, s["name"])
        if "color" in s:
            mixer.setTrackColor(i, int(s["color"]))
        for t in s.get("on") or []:
            mixer.setRouteTo(i, int(t), True)
        for t in s.get("off") or []:
            mixer.setRouteTo(i, int(t), False)
        for l in s.get("levels") or []:
            try:
                mixer.setRouteToLevel(i, int(l["to"]), float(l["level"]))
            except Exception:
                pass
    mixer.afterRoutingChanged()
    return before

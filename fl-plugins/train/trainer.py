"""The trainer: a page that plays one of your songs as its groups (lead vocal, backing vocals, 808, kick…), each on a
fader, for you to balance by ear, then keeps what you did for learn.py. It starts some mixes from Auto Mix's, some
from a scrambled one and some from your FLP's, without saying which until you save (so you judge the sound, not the
starting point), and now and then gives you a song you've already mixed again, to see how consistent your own ear is
(that's the floor no model can beat).

    python trainer.py [--port 5390]      then open http://127.0.0.1:5390

Songs come from batch_render.py (training/songs/<id>/). What it writes, in training/:
    mixes.jsonl     one line per saved mix (or skip)
    roles.json      the roles you corrected, per song
    excluded.json   songs you said were broken
"""
import hashlib
import json
import os
import random
import sys
import threading
import time
import traceback
import uuid
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlparse, unquote

import numpy as np
import soundfile as sf

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.dirname(HERE))

import analysis  # noqa: E402
from analysis import GROUP_NAMES, TARGETS, Blocks, GroupFeatures, Meter  # noqa: E402
import learn  # noqa: E402
from prep import clean, QUALITY  # noqa: E402

T = analysis.TRAINING
SONGS = os.path.join(T, "songs")
MIXES = os.path.join(T, "mixes.jsonl")
ROLES = os.path.join(T, "roles.json")
EXCLUDED = os.path.join(T, "excluded.json")
WEB = os.path.join(HERE, "web")
CHUNK_S = 10.0
REPEAT_P = 0.15  # chance a session is a hidden repeat, once 5 songs are mixed
STARTS = [("scrambled", 0.45), ("auto", 0.35), ("original", 0.20)]
SCRAMBLE_DB = 6.0
ORDER = list(TARGETS)

_lock = threading.Lock()
_song_locks = {}


def jload(path, default):
    try:
        with open(path, encoding="utf8") as f:
            return json.load(f)
    except (OSError, ValueError):
        return default


def jsave(path, v):
    tmp = path + ".tmp"
    with open(tmp, "w", encoding="utf8") as f:
        json.dump(clean(v), f, indent=1)
    os.replace(tmp, path)


def song_lock(sid):
    with _lock:
        return _song_locks.setdefault(sid, threading.Lock())


_usable = {}  # song id -> (song.json's mtime, usable)


def usable(sid):
    """A song worth mixing: a lead vocal and at least two other groups that sound. Not a project with only the vocals
    in it (the beat elsewhere), nor one whose vocal files were missing when FL opened it (silent stems)."""
    p = os.path.join(SONGS, sid, "song.json")
    try:
        mt = os.path.getmtime(p)
    except OSError:
        return False
    if _usable.get(sid, (None,))[0] != mt:
        s = jload(p, None)
        gs = [g["group"] for g in (s or {}).get("rules", {}).get("groups", []) if g.get("lufs") is not None]
        _usable[sid] = (mt, "vocal_lead" in gs and len(gs) >= 3)
    return _usable[sid][1]


def ready_songs():
    if not os.path.isdir(SONGS):
        return []
    excluded = set(jload(EXCLUDED, []))
    return sorted(s for s in os.listdir(SONGS) if s not in excluded and usable(s))


def load_song(sid):
    return jload(os.path.join(SONGS, sid, "song.json"), None)


def mixes():
    out = []
    if os.path.exists(MIXES):
        with open(MIXES, encoding="utf8") as f:
            out = [json.loads(line) for line in f if line.strip()]
    return out


# Groups -----------------------------------------------------------------------------------------------------------

def grouping(song, corr):
    """Each leaf's role and lead with your corrections, and the groups they make: {group: {"leaves", "returns"}}.
    A send return goes with the group that sends it the most."""
    leaves = []
    for lf in song["leaves"]:
        k = str(lf["index"])
        role = corr.get("roles", {}).get(k, lf["role"])
        lead = corr.get("leads", {}).get(k, lf["lead"] if lf["role"] == "vocal" else False)
        leaves.append(dict(lf, role=role, lead=bool(lead) and role == "vocal"))
    vox = [lf for lf in leaves if lf["role"] == "vocal"]
    if vox and not any(lf["lead"] for lf in vox):
        max(vox, key=lambda lf: lf["lufs"] if lf["lufs"] is not None else -999)["lead"] = True
    gof = {}
    for lf in leaves:
        gof[lf["index"]] = ("vocal_lead" if lf["lead"] else "vocal_bg") if lf["role"] == "vocal" else lf["role"]
    groups = {}
    for lf in leaves:
        groups.setdefault(gof[lf["index"]], {"leaves": [], "returns": []})["leaves"].append(lf)
    for r in song["returns"]:
        power = {}
        for k, d in r["feeds"].items():
            g = gof.get(int(k))
            if g and d is not None:
                power[g] = power.get(g, 0.0) + 10 ** (d / 10)
        if power:
            groups[max(power, key=power.get)]["returns"].append(r)
    return leaves, groups


def _sig(members):
    return hashlib.sha1(json.dumps(sorted(m["file"] for m in members)).encode()).hexdigest()[:12]


def _read(files, frames, fs):
    """The files summed, a chunk at a time, padded to the song's length."""
    handles = [sf.SoundFile(f) for f in files]
    n = int(CHUNK_S * fs)
    try:
        done = 0
        while done < frames:
            m = min(n, frames - done)
            total = np.zeros((m, 2), np.float32)
            for h in handles:
                x = h.read(m, dtype="float32", always_2d=True)
                if x.shape[1] == 1:
                    x = np.repeat(x, 2, axis=1)
                total[:len(x)] += x[:, :2]
            done += m
            yield total
    finally:
        for h in handles:
            h.close()


def build_group(sid, song, g, members):
    """Mixes one group's stem (its leaves, then its returns on top) into groups/<g>_<sig>.ogg, and measures it:
    the leaves' loudness at the master (what plan() and learn.py call the group's level), its features and its
    K-weighted loudness every 400 ms with the returns (for level matching in the page). Cached by members."""
    folder = os.path.join(SONGS, sid)
    stems = os.path.join(folder, "stems")
    sig = _sig(members["leaves"] + members["returns"])
    out = os.path.join(folder, "groups")
    os.makedirs(out, exist_ok=True)
    ogg, meta_path = os.path.join(out, "%s_%s.ogg" % (g, sig)), os.path.join(out, "%s_%s.json" % (g, sig))
    meta = jload(meta_path, None)
    if meta and os.path.exists(ogg):
        return dict(meta, sig=sig, file=os.path.basename(ogg))
    fs, frames = song["fs"], song["frames"]
    dry_m, feats = Meter(fs), GroupFeatures(fs, len(members["leaves"]))
    k_env = Meter(fs)
    leaf_files = [os.path.join(stems, m["file"]) for m in members["leaves"]]
    ret_files = [os.path.join(stems, r["file"]) for r in members["returns"]]
    tmp = ogg + ".part"
    with sf.SoundFile(tmp, "w", fs, 2, format="OGG", subtype="VORBIS", compression_level=QUALITY) as w:
        rets = _read(ret_files, frames, fs) if ret_files else None
        for dry in _read(leaf_files, frames, fs):
            dry_m.feed(dry)
            feats.feed(dry)
            full = dry + next(rets) if rets else dry
            k_env.feed(full)
            w.write(full)
    os.replace(tmp, ogg)
    blocks = k_env.blocks.values()  # 100 ms of K-weighted power, both channels
    n4 = len(blocks) // 4
    env = 10 * np.log10(np.maximum(blocks[:n4 * 4].reshape(n4, 4).mean(axis=1), 1e-20))
    meta = {"group": g, "lufs": dry_m.lufs(), "features": feats.values(None),
            "active": "".join("1" if a else "0" for a in feats.active()),
            "env": [round(float(v), 2) for v in env]}
    jsave(meta_path, meta)
    return dict(clean(meta), sig=sig, file=os.path.basename(ogg))


def view(sid):
    """What the page needs for a song: its groups (built if they aren't), its leaves with their roles, and Auto Mix's
    gains for it (dB from the FLP's balance)."""
    song = load_song(sid)
    if not song:
        raise KeyError(sid)
    corr = jload(ROLES, {}).get(sid, {})
    with song_lock(sid):
        leaves, groups = grouping(song, corr)
        built = {g: build_group(sid, song, g, m) for g, m in groups.items()}
    lead_act = None
    if "vocal_lead" in built:
        lead_act = np.array([c == "1" for c in built["vocal_lead"]["active"]])
    out_groups = []
    for g in sorted(built, key=ORDER.index):
        b = built[g]
        act = np.array([c == "1" for c in b["active"]])
        feats = dict(b["features"])
        if lead_act is not None and len(act):
            n = min(len(act), len(lead_act))
            feats["overlap"] = float((act[:n] & lead_act[:n]).sum() / max(act[:n].sum(), 1))
        out_groups.append({"id": g, "name": GROUP_NAMES[g], "lufs": b["lufs"], "features": feats,
                           "url": "/audio/%s/%s" % (sid, b["file"]), "sig": b["sig"], "env": b["env"],
                           "leaves": [lf["index"] for lf in groups[g]["leaves"]],
                           "returns": [r["name"] for r in groups[g]["returns"]]})
    return {"id": sid, "duration": song["duration"], "envelope": song["envelope"], "envelopeS": song["envelopeS"],
            "groups": out_groups, "auto": auto_gains(out_groups),
            "leaves": [{"index": lf["index"], "name": lf["name"], "role": lf["role"], "autoRole": lf["autoRole"],
                        "lead": lf["lead"], "group": ("vocal_lead" if lf["lead"] else "vocal_bg")
                        if lf["role"] == "vocal" else lf["role"]} for lf in leaves],
            "roles": [[r, analysis.ROLE_NAMES[r]] for r in analysis.ROLES],
            "corrected": bool(corr.get("roles") or corr.get("leads"))}


def power_sum(levels):
    v = [10 ** (x / 10) for x in levels if x is not None]
    return 10 * np.log10(sum(v)) if v else None


def auto_gains(groups):
    """Auto Mix's move for each group (with what it has learned, when that beats the rules), the song kept as loud."""
    model = analysis.load_model()
    has_vocal = any(g["id"].startswith("vocal") for g in groups)
    gains = {}
    for g in groups:
        if g["lufs"] is None:
            gains[g["id"]] = 0.0
            continue
        target = analysis.rule_target(g["id"], has_vocal)
        if model:
            target += analysis.learned_shift(model, g["id"], g["features"])
        gains[g["id"]] = target - g["lufs"]
    before = power_sum([g["lufs"] for g in groups])
    after = power_sum([g["lufs"] + gains[g["id"]] for g in groups if g["lufs"] is not None])
    if before is not None and after is not None:
        gains = {k: v - (after - before) for k, v in gains.items()}
    return {k: round(float(v), 2) for k, v in gains.items()}


# Sessions ---------------------------------------------------------------------------------------------------------

class Trainer:
    def __init__(self):
        self.sessions = {}
        self.upcoming = None
        self.learning = False

    def pick(self):
        songs = ready_songs()
        if not songs:
            raise ValueError("No songs ready yet: batch_render.py is still rendering them.")
        done = [m for m in mixes() if m.get("kind") == "mix" and m.get("source") == "trainer"]
        mixed = {m["song"] for m in done}
        repeated = {m["song"] for m in done if m.get("repeat")}
        skipped = {m["song"] for m in mixes() if m.get("kind") == "skip"}
        fresh = [s for s in songs if s not in mixed and s not in skipped]
        again = [s for s in mixed if s not in repeated and s in songs]
        if again and (len(mixed) >= 5 and random.random() < REPEAT_P or not fresh):
            return random.choice(again), True
        if not fresh:
            return random.choice(songs), True
        if self.upcoming in fresh:
            return self.upcoming, False
        return random.choice(fresh), False

    def next(self):
        sid, repeat = self.pick()
        v = view(sid)
        if repeat:
            mode = "scrambled"
        else:
            r, acc = random.random(), 0.0
            mode = STARTS[-1][0]
            for name, p in STARTS:
                acc += p
                if r < acc:
                    mode = name
                    break
        auto = v["auto"]
        if mode == "auto":
            start = dict(auto)
        elif mode == "original":
            start = {g["id"]: 0.0 for g in v["groups"]}
        else:
            start = {k: round(a + random.uniform(-SCRAMBLE_DB, SCRAMBLE_DB), 1) for k, a in auto.items()}
        session = uuid.uuid4().hex[:10]
        self.sessions[session] = {"song": sid, "mode": mode, "repeat": repeat, "start": start,
                                  "created": time.time()}
        # the next fresh song's groups get built while you mix this one
        rest = [s for s in ready_songs() if s != sid and s not in {m["song"] for m in mixes()}]
        self.upcoming = random.choice(rest) if rest else None
        if self.upcoming:
            threading.Thread(target=self._prebuild, args=(self.upcoming,), daemon=True).start()
        return {"session": session, "song": v, "start": start, "stats": self.stats()}

    def _prebuild(self, sid):
        try:
            view(sid)
        except Exception:
            traceback.print_exc()

    def save(self, req):
        s = self.sessions.get(req.get("session"))
        if not s:
            raise ValueError("That session isn't open any more: press Next song.")
        v = view(s["song"])
        gains = {k: float(x) for k, x in (req.get("gains") or {}).items()}
        groups = {g["id"]: {"lufs": g["lufs"] + gains.get(g["id"], 0.0), "gain": gains.get(g["id"], 0.0),
                            "features": g["features"]} for g in v["groups"] if g["lufs"] is not None}
        rec = {"kind": "mix", "source": "trainer", "song": s["song"], "session": req["session"], "start": s["mode"],
               "startGains": s["start"], "repeat": s["repeat"], "seconds": req.get("seconds"),
               "groups": groups, "auto": v["auto"], "roles": jload(ROLES, {}).get(s["song"], {}),
               "time": time.strftime("%Y-%m-%d %H:%M:%S")}
        with _lock, open(MIXES, "a", encoding="utf8") as f:
            f.write(json.dumps(clean(rec)) + "\n")
        self.sessions.pop(req["session"], None)
        # how yours compares with Auto Mix's and your FLP's, levels relative to each other (the master taken out)
        ids = [g for g in groups]
        mine = np.array([gains.get(g, 0.0) for g in ids])
        auto = np.array([v["auto"].get(g, 0.0) for g in ids])
        d_auto = (mine - mine.mean()) - (auto - auto.mean())
        d_orig = mine - mine.mean()
        prev = [m for m in mixes() if m.get("kind") == "mix" and m["song"] == s["song"] and
                m.get("session") != req["session"]]
        same = None
        if s["repeat"] and prev:
            p = prev[-1]["groups"]
            common = [g for g in ids if g in p]
            if len(common) >= 3:
                same = learn.mix_error([groups[g]["lufs"] for g in common], [p[g]["lufs"] for g in common])
        return {"start": s["mode"], "repeat": s["repeat"], "vsRepeat": same,
                "compare": [{"id": g, "name": GROUP_NAMES[g], "vsAuto": round(float(a), 1),
                             "vsOriginal": round(float(o), 1)} for g, a, o in zip(ids, d_auto, d_orig)],
                "rmsAuto": float(np.sqrt(np.mean(d_auto ** 2))), "rmsOriginal": float(np.sqrt(np.mean(d_orig ** 2))),
                "stats": self.stats()}

    def skip(self, req):
        s = self.sessions.pop(req.get("session"), None)
        if not s:
            return {"stats": self.stats()}
        rec = {"kind": "skip", "song": s["song"], "reason": req.get("reason") or "",
               "time": time.strftime("%Y-%m-%d %H:%M:%S")}
        with _lock, open(MIXES, "a", encoding="utf8") as f:
            f.write(json.dumps(rec) + "\n")
        if req.get("exclude"):
            ex = jload(EXCLUDED, [])
            if s["song"] not in ex:
                jsave(EXCLUDED, ex + [s["song"]])
        return {"stats": self.stats()}

    def role(self, req):
        sid = req["song"]
        allr = jload(ROLES, {})
        corr = allr.setdefault(sid, {"roles": {}, "leads": {}})
        song = load_song(sid)
        if req.get("reset"):
            allr[sid] = {"roles": {}, "leads": {}}
            jsave(ROLES, allr)
            return view(sid)
        lf = next((x for x in song["leaves"] if x["index"] == int(req["leaf"])), None)
        if lf is None:
            raise ValueError("Song %s has no insert %s" % (sid, req["leaf"]))
        k = str(lf["index"])
        if "role" in req:
            if req["role"] not in analysis.ROLES:
                raise ValueError("Unknown role %r" % req["role"])
            if req["role"] == lf["role"]:
                corr["roles"].pop(k, None)
            else:
                corr["roles"][k] = req["role"]
        if "lead" in req:
            corr["leads"][k] = bool(req["lead"])
        jsave(ROLES, allr)
        return view(sid)

    def learn(self):
        if self.learning:
            raise ValueError("Already learning.")
        self.learning = True
        try:
            out, report = learn.learn()
            return {"report": report, "better": out["better"], "stats": self.stats()}
        finally:
            self.learning = False

    def stats(self):
        all_songs = jload(os.path.join(HERE, "songs.json"), [])
        ms = mixes()
        yours = [m for m in ms if m.get("kind") == "mix" and m.get("source") == "trainer"]
        model = analysis.load_model()
        return {"ready": len(ready_songs()), "total": len(all_songs), "mixed": len({m["song"] for m in yours}),
                "mixes": len(yours), "skipped": sum(1 for m in ms if m.get("kind") == "skip"),
                "model": {"made": model["made"], "cv": model["cv"]} if model else None,
                "report": open(learn.REPORT, encoding="utf8").read() if os.path.exists(learn.REPORT) else None}


# HTTP -------------------------------------------------------------------------------------------------------------

TYPES = {".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css",
         ".ogg": "audio/ogg", ".json": "application/json", ".svg": "image/svg+xml"}


class Handler(BaseHTTPRequestHandler):
    trainer = None

    def log_message(self, fmt, *args):
        pass

    def _send(self, code, body, ctype="application/json"):
        if isinstance(body, (dict, list)):
            body = json.dumps(clean(body)).encode()
        self.send_response(code)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store" if ctype == "application/json" else "max-age=86400")
        self.end_headers()
        self.wfile.write(body)

    def _file(self, path):
        if not os.path.isfile(path):
            return self._send(404, {"error": "not found"})
        with open(path, "rb") as f:
            self._send(200, f.read(), TYPES.get(os.path.splitext(path)[1], "application/octet-stream"))

    def do_GET(self):
        p = unquote(urlparse(self.path).path)
        try:
            if p in ("/", "/index.html"):
                return self._file(os.path.join(WEB, "index.html"))
            if p.startswith("/web/"):
                name = os.path.basename(p)
                return self._file(os.path.join(WEB, name))
            if p.startswith("/audio/"):
                _, _, sid, name = p.split("/", 3)
                if sid not in ready_songs() or "/" in name or "\\" in name or ".." in name:
                    return self._send(404, {"error": "not found"})
                return self._file(os.path.join(SONGS, sid, "groups", name))
            if p == "/api/stats":
                return self._send(200, self.trainer.stats())
            return self._send(404, {"error": "not found"})
        except Exception as e:
            traceback.print_exc()
            self._send(500, {"error": str(e)})

    def do_POST(self):
        p = urlparse(self.path).path
        if self.headers.get("Origin") not in (None, "http://127.0.0.1:%d" % PORT, "http://localhost:%d" % PORT):
            return self._send(403, {"error": "forbidden"})
        n = int(self.headers.get("Content-Length") or 0)
        try:
            req = json.loads(self.rfile.read(n) or b"{}")
            t = self.trainer
            fn = {"/api/next": lambda: t.next(), "/api/save": lambda: t.save(req), "/api/skip": lambda: t.skip(req),
                  "/api/role": lambda: t.role(req), "/api/learn": lambda: t.learn()}.get(p)
            if not fn:
                return self._send(404, {"error": "not found"})
            self._send(200, fn())
        except (ValueError, KeyError) as e:
            self._send(400, {"error": str(e)})
        except Exception as e:
            traceback.print_exc()
            self._send(500, {"error": "%s: %s" % (type(e).__name__, e)})


PORT = 5390


def main():
    global PORT
    a = sys.argv[1:]
    PORT = int(a[a.index("--port") + 1]) if "--port" in a else PORT
    os.makedirs(T, exist_ok=True)
    Handler.trainer = Trainer()
    srv = ThreadingHTTPServer(("127.0.0.1", PORT), Handler)
    print("Auto Mix trainer: http://127.0.0.1:%d  (%d songs ready)" % (PORT, len(ready_songs())), flush=True)
    if "--open" in a:
        import webbrowser
        webbrowser.open("http://127.0.0.1:%d" % PORT)
    srv.serve_forever()


if __name__ == "__main__":
    main()

"""Turns one rendered song (FL's split stems in <song>/wav and its mixer in <song>/state.json) into what the trainer
plays: each sounding leaf insert as it reaches the master (its route's gain baked in) in stems/leaf_<insert>.ogg,
each send return (a reverb fed by sends) in stems/ret_<insert>.ogg, and song.json saying what they are. Then the
float WAVs (a gigabyte or so) go.

    python prep.py <song folder> [--keep]
"""
import json
import os
import shutil
import sys
import time

import numpy as np
import soundfile as sf

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.dirname(HERE))

import analysis  # noqa: E402
from analysis import undb  # noqa: E402

QUALITY = 0.45  # libsndfile's Vorbis compression level: 0.45 is about q5.5, transparent for judging a balance
ENV_S = 0.5


def clean(v):
    """JSON a browser can read: numpy numbers as plain ones, -inf and nan as null."""
    if isinstance(v, dict):
        return {str(k): clean(x) for k, x in v.items()}
    if isinstance(v, (list, tuple)):
        return [clean(x) for x in v]
    if isinstance(v, (bool, np.bool_)):
        return bool(v)
    if isinstance(v, (int, np.integer)):
        return int(v)
    if isinstance(v, (float, np.floating)):
        return float(v) if np.isfinite(v) else None
    return v


def prep(folder, keep=False, log=print):
    wav = os.path.join(folder, "wav")
    with open(os.path.join(folder, "state.json")) as f:
        state = json.load(f)
    t0 = time.monotonic()
    a = analysis.Analysis(wav, state, project="mix", log=log).analyse()
    leaves = a.movable()
    rets = a.returns()
    fs = a.stems.fs
    out = os.path.join(folder, "stems")
    os.makedirs(out, exist_ok=True)
    gains = {t.index: undb(t.path) for t in leaves}
    gains.update({r["index"]: undb(r["path"]) for r in rets})
    files = {i: ("leaf_%d.ogg" if i in {t.index for t in leaves} else "ret_%d.ogg") % i for i in gains}
    writers = {i: sf.SoundFile(os.path.join(out, files[i]), "w", fs, 2, format="OGG", subtype="VORBIS",
                               compression_level=QUALITY) for i in gains}
    env = analysis.Blocks(int(ENV_S * fs))
    dry = analysis.Meter(fs)
    try:
        for chunk in a.stems.chunks(list(gains)):
            total = None
            for i, x in chunk.items():
                y = (x * gains[i]).astype(np.float32)
                writers[i].write(y)
                if i in files and files[i].startswith("leaf"):
                    total = y if total is None else total + y
            if total is not None:
                dry.feed(total)
                env.feed(np.mean(total.astype(np.float64) ** 2, axis=1))
    finally:
        for w in writers.values():
            w.close()
    plan = a.plan()
    by_group = {g["group"]: g for g in plan["groups"]}
    vocal = by_group.get("vocal_lead")
    song = {
        "id": os.path.basename(os.path.normpath(folder)),
        "fs": fs, "frames": a.stems.frames, "duration": a.stems.frames / fs,
        "mixLufs": dry.lufs(),
        "envelope": [round(float(v), 1) for v in 10 * np.log10(np.maximum(env.values(), 1e-12))],
        "envelopeS": ENV_S,
        "leaves": [{"index": t.index, "name": t.name, "role": t.role, "autoRole": t.auto_role,
                    "roleFrom": t.role_from, "lead": t.lead, "file": files[t.index], "lufs": t.lufs + t.path,
                    "db": t.db, "channels": t.channels, "low": t.low, "sub": t.sub, "crest": t.crest}
                   for t in leaves],
        "returns": [{"index": r["index"], "name": r["name"], "file": files[r["index"]],
                     "feeds": {str(k): v for k, v in r["feeds"].items()}} for r in rets],
        "rules": {"groups": [{"group": g["group"], "lufs": g["lufs"], "change": g["change"], "target": g["target"],
                              "features": g["features"], "members": g["members"]} for g in plan["groups"]],
                  "offset": plan["offset"]},
        "vocalToMix": (vocal["lufs"] - plan["mixBefore"]) if vocal else None,
        "warnings": plan["warnings"],
        "prepared": time.strftime("%Y-%m-%d %H:%M:%S"),
    }
    with open(os.path.join(folder, "song.json"), "w") as f:
        json.dump(clean(song), f, indent=1)
    if not keep:
        shutil.rmtree(wav, ignore_errors=True)
    log("%s: %d leaves, %d returns, %.0f s of song, vocal %s LU vs mix, %.0f s" % (
        song["id"], len(leaves), len(rets), song["duration"], analysis.fmt(song["vocalToMix"], True),
        time.monotonic() - t0))
    return song


if __name__ == "__main__":
    prep(sys.argv[1], keep="--keep" in sys.argv)

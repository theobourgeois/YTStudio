"""Builds the blind test: every contender for every song, one shared excerpt per song, loudness-matched FLACs under
opaque names, the page's trial list (trials.js) and each contender's measurements (for reading the votes against)."""
import base64
import io
import json
import os
import secrets
import sys
import time
import numpy as np
import soundfile as sf
import dsp
import roles
import mix
import master

SONGS = ["song1", "song2", "song3", "song4"]
ROOT = roles.ROOT
PAGE = f"{ROOT}/Blind test"
LOCAL = "C:/Users/goali/flrender/contest/out"
EXCERPT_S, MATCH_LUFS = 30.0, -16.0

ABOUT = {
    "mix": {
        "your-balance": "Your stem levels as they are in the FLP, summed, then the neutral master.",
        "equal-loudness": "Every stem at the same loudness: the baseline that beat the deep-learning auto-mixers in a recent listening test.",
        "rule-balance": "Stems grouped by role (vocal, 808, kick, snare, synths…), each group at a trap target level, members level within it. Levels only.",
        "full-chain": "Rule balance plus per-stem processing: high-passes, measured resonance cuts, compression by role, de-essing, 808 ducked under the kick, synths dipping 1.5–5 kHz while the vocal sings, mono percussion spread, a plate on the lead vocal, bus glue.",
        "your-balance-fixed": "Your levels kept, with the same per-stem processing as full chain (each stem matched back to its own loudness), and bus glue. No reverb.",
    },
    "master": {
        "your-master": "Your own master chain, as the FLP plays.",
        "clip-and-limit": "Your premaster, only soft-clipped and limited to your master's loudness: no EQ, no compression.",
        "rule-chain": "Octave EQ toward a target curve (the mean of the two _M1 masters in Music/Tracks, at most ±3 dB), bass made mono under 120 Hz, gentle glue compression, then clip and limit.",
        "matchering": "Matchering 2 (open source) matching your premaster's spectrum and level to an engineer's master, then the same clip and limit.",
        "loud-and-wide": "Three-band compression with makeup, a little high-band saturation, wider sides from 2–10 kHz, mono bass, +1.5 dB air shelf, then clip and limit.",
    },
}


def pick_excerpt(stems, mixed):
    """The 30 s where the song is loudest, favouring where the lead vocal sings."""
    lv = dsp.short_term_db(mixed, 0.5)
    leads = [s.audio for s in stems if s.role == "vocal" and s.lead]
    if leads:
        act, _ = roles.activity(np.sum(leads, axis=0), 0.5)
        lv = lv + 6 * act[: len(lv)]
    w = int(EXCERPT_S / 0.5)
    score = np.convolve(lv, np.ones(w) / w, mode="valid")
    start = int(np.argmax(score)) * 0.5
    return start


def excerpt(x, start):
    a = int(start * dsp.SR)
    y = x[a: a + int(EXCERPT_S * dsp.SR)].copy()
    f = int(0.03 * dsp.SR)
    ramp = np.linspace(0, 1, f, dtype=np.float32)[:, None]
    y[:f] *= ramp
    y[-f:] *= ramp[::-1]
    return y


def measure(x):
    mono = x.mean(axis=1)
    side = (x[:, 0] - x[:, 1]) / 2
    rms = np.sqrt(np.mean(x**2))
    tp = dsp.true_peak(x)
    lv = dsp.short_term_db(x, 3.0)
    lv = lv[lv > lv.max() - 20]
    return {
        "lufs": round(dsp.lufs(x), 2),
        "truePeak": round(float(dsp.db(tp)), 2),
        "plr": round(float(dsp.db(tp)) - dsp.lufs(x), 2),
        "crest": round(float(dsp.db(np.max(np.abs(x)) / rms)), 2),
        "shortTermSpread": round(float(np.percentile(lv, 95) - np.percentile(lv, 10)), 2),
        "bands": {name: round(dsp.band_share(x, lo, hi), 4) for name, (lo, hi) in
                  {"sub": (20, 60), "low": (60, 250), "lowMid": (250, 2000), "presence": (2000, 6000), "air": (6000, 20000)}.items()},
        "sideToMid": round(float(dsp.db(np.sqrt(np.mean(side**2)) / (np.sqrt(np.mean(mono**2)) + 1e-12))), 2),
        "correlation": round(dsp.correlation(x), 3),
    }


def write_clip(fid, y):
    """A clip as a script (FLAC in base64): a page opened from disk can't fetch audio for Web Audio, but it can load a
    script, and Web Audio is what keeps the five versions sample-locked while switching."""
    buf = io.BytesIO()
    sf.write(buf, y, dsp.SR, format="FLAC", subtype="PCM_16")
    with open(f"{PAGE}/audio/{fid}.js", "w", encoding="ascii") as f:
        f.write(f'window.CLIP("{fid}","{base64.b64encode(buf.getvalue()).decode()}");\n')


def build(songs):
    os.makedirs(f"{PAGE}/audio", exist_ok=True)
    trials, measurements = [], {}
    for song in songs:
        print(song, flush=True)
        stems = roles.load(song)
        mixes = mix.contenders(stems, song)
        pre = dsp.read(f"{ROOT}/{song}/{song} - premaster.wav")
        yours = dsp.read(f"{ROOT}/{song}/{song} - mixdown.wav")
        target, masters = master.contenders(pre, yours)
        start = pick_excerpt(stems, mixes["your-balance"])
        print(f"  excerpt {start:.1f}s, master target {target:.1f} LUFS", flush=True)
        os.makedirs(f"{LOCAL}/{song}", exist_ok=True)
        for rnd, group in (("mix", mixes), ("master", masters)):
            items = []
            for name, x in group.items():
                dsp.write(f"{LOCAL}/{song}/{rnd}-{name}.wav", x)
                ex = excerpt(x, start)
                measurements[f"{song}/{rnd}/{name}"] = {"full": measure(x), "excerpt": measure(ex)}
                y = dsp.gain_to(ex, MATCH_LUFS)
                assert np.max(np.abs(y)) < 1, (song, rnd, name)
                fid = secrets.token_hex(6)
                write_clip(fid, y)
                items.append({"id": fid, "name": name})
                print(f"  {rnd:6} {name:20} {dsp.lufs(x):6.1f} LUFS", flush=True)
            trials.append({"song": song, "round": rnd, "excerptStart": start, "items": items})
    return trials, measurements


if __name__ == "__main__":
    songs = sys.argv[1:] or SONGS
    # iCloud holds files it's syncing for a moment: retry, and leave any that stay locked (their names mean nothing).
    if os.path.isdir(f"{PAGE}/audio"):
        for f in os.listdir(f"{PAGE}/audio"):
            for _ in range(10):
                try:
                    os.remove(f"{PAGE}/audio/{f}")
                    break
                except PermissionError:
                    time.sleep(1)
    trials, measurements = build(songs)
    with open(f"{PAGE}/trials.js", "w", encoding="utf8") as f:
        f.write("window.TRIALS = " + json.dumps({"about": ABOUT, "trials": trials}) + ";\n")
    for path in (f"{LOCAL}/measurements.json", f"{PAGE}/measurements.json"):
        with open(path, "w", encoding="utf8") as f:
            json.dump(measurements, f, indent=1)
    print("done", len(trials), "trials")

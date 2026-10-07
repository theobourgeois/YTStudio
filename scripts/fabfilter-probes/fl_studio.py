"""
FL Studio's own clipper and limiters, measured (docs/fabfilter/pro-l-research.md §2.9): a test file to render through
FL Studio, and the analysis of what comes back. FL's plug-ins only run inside FL, and FL can render a project from the
command line (`OsxFL -R -Ewav project.flp`) but not put a file of ours in a project, so the renders are made by hand:

    /tmp/probe-venv/bin/python -I scripts/fabfilter-probes/fl_studio.py make ~/Downloads/yt-l-probe
        then in FL Studio: File › New from template › Minimal › Basic with limiter (FL 2026's master: the Emphasizer),
        drag yt-l-probe.wav into the Playlist at bar 1 (SONG mode), File › Export › WAV as fl-emphasizer.wav;
        replace the master's effect by Fruity Limiter (defaults) and export fl-limiter.wav; by Fruity Soft Clipper
        (defaults) and export fl-soft-clipper.wav, all into the same folder.
    /tmp/probe-venv/bin/python -I scripts/fabfilter-probes/fl_studio.py analyse ~/Downloads/yt-l-probe

Measured with FL Studio 2026 (26.1.7) at 44.1 kHz, 16-bit exports; the 48 kHz test file is converted to the export's
rate for the comparison. The same venv as pro_l.py (pedalboard isn't needed here).
"""
import json
import os
import sys

import numpy as np
import soundfile as sf
from scipy import signal
from scipy.optimize import least_squares

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import pro_l as P  # noqa: E402 (its signals, loudness and gain measurement)

EXPORTS = ["fl-soft-clipper.wav", "fl-limiter.wav", "fl-emphasizer.wav"]


def make(folder):
    """The test file: a click, a −30 dBFS calibration tone, a 50 Hz ramp from −30 to +18 dBFS (the static curve),
    steady sines 6 and 12 dB over, bursts, and the trap loop at 0, +6 and +12 dB. Float, so it can go over 0 dBFS."""
    sr = P.SR
    parts, marks, t = [], {}, 0.0

    def add(name, x):
        nonlocal t
        x = np.atleast_2d(x)
        x = np.vstack([x, x]) if x.shape[0] == 1 else x
        marks[name] = [t, t + x.shape[1] / sr]
        parts.append(x)
        t += x.shape[1] / sr

    def gap(seconds=0.5):
        add(f"gap{len(parts)}", np.zeros(int(seconds * sr)))

    gap(0.25)
    click = np.zeros(int(0.25 * sr))
    click[0] = 0.25
    add("click", click)
    add("cal", P.fade(P.tone(1000, 1.0, 10 ** (-30 / 20))))
    gap()
    n = 6 * sr
    tt = np.arange(n) / sr
    add("ramp", P.fade(10 ** ((-30 + 48 * tt / 6) / 20) * np.sin(2 * np.pi * 50 * tt)))
    gap()
    for f in (50, 100, 1000):
        for over in (6, 12):
            add(f"steady_{f}_{over}", P.fade(P.tone(f, 1.5, 10 ** (over / 20))))
            gap(0.3)
    for f in (1000, 50):
        for b in (0.02, 0.2):
            add(f"burst_{f}_{int(b * 1000)}", P.burst(f, b, over_db=6.0, pre=0.3, post=1.2)[0])
    loop = P.trap_loop()
    for over in (0, 6, 12):
        add(f"loop_{over}", loop * 10 ** (over / 20))
        gap(0.3)
    gap(0.7)
    os.makedirs(folder, exist_ok=True)
    sf.write(os.path.join(folder, "yt-l-probe.wav"), np.concatenate(parts, axis=1).T.astype(np.float32), sr, subtype="FLOAT")
    json.dump(dict(sr=sr, marks=marks), open(os.path.join(folder, "marks.json"), "w"), indent=1)
    print("wrote", os.path.join(folder, "yt-l-probe.wav"))


def fl_soft_clip(x, T=0.781195, C=1.0):
    """Fruity Soft Clipper at its defaults: linear to T, then an exponential knee into C (C1 at T)."""
    a = np.abs(x)
    return np.sign(x) * np.where(a <= T, a, C - (C - T) * np.exp(-(a - T) / (C - T)))


def analyse(folder):
    marks = json.load(open(os.path.join(folder, "marks.json")))["marks"]
    x48, sr_in = sf.read(os.path.join(folder, "yt-l-probe.wav"), always_2d=True)
    for name in EXPORTS:
        path = os.path.join(folder, name)
        if not os.path.exists(path):
            print(f"== {name}: missing")
            continue
        y, sr = sf.read(path, always_2d=True)
        y = y.T
        g = np.gcd(sr, sr_in)
        X = signal.resample_poly(x48.T, sr // g, sr_in // g, axis=1)
        c = signal.correlate(y[0, : int(2.5 * sr) + 4000], X[0, : int(2.5 * sr)], mode="valid")
        lag = int(np.argmax(np.abs(c)))
        y = y[:, lag: lag + X.shape[1]]
        seg = lambda name, z, pad=0.0: z[:, int((marks[name][0] + pad) * sr): int((marks[name][1] - pad) * sr)]
        cx, cy = seg("cal", X, 0.2)[0], seg("cal", y, 0.2)[0]
        g0 = np.sum(cx * cy) / np.sum(cx ** 2)
        print(f"== {name}: {sr} Hz, lag {lag}, gain below threshold {20 * np.log10(abs(g0)):+.3f} dB, "
              f"peak {20 * np.log10(np.abs(y).max()):.2f} dBFS")
        xi, yo = seg("ramp", X, 0.01)[0], seg("ramp", y, 0.01)[0]
        # memoryless? the spread of the output among samples of (nearly) the same input, in the clipping region
        m = np.abs(xi) > 1.2
        bins = np.round(xi[m], 2)
        order = np.argsort(bins)
        groups = np.split(yo[m][order], np.unique(bins[order], return_index=True)[1][1:])
        spread = np.median([np.ptp(v) for v in groups if len(v) > 3])
        print(f"   memoryless: output spread at equal input {spread:.4f} (0: a waveshaper; large: a limiter)")
        if spread < 0.01:
            a, b = np.abs(xi), np.abs(yo) * np.sign(xi * yo)
            keep = a > 0.05

            def model(p, v):
                T, C = p
                return np.where(v <= T, v, C - (C - T) * np.exp(-(v - T) / (C - T)))

            r = least_squares(lambda p: model(p, a[keep]) - b[keep], [0.78, 1.0])
            err = np.abs(r.fun).max()
            print(f"   exponential knee: T = {r.x[0]:.6f} ({20 * np.log10(r.x[0]):.3f} dBFS), C = {r.x[1]:.6f}, "
                  f"max error {err:.5f}")
            for s, f0 in [("steady_1000_12", 1000), ("steady_100_12", 100)]:
                xs, ys = seg(s, X, 0.3)[0], seg(s, y, 0.3)[0]
                w = signal.windows.blackmanharris(len(ys))
                fr = np.fft.rfftfreq(len(ys), 1 / sr)
                harm = np.zeros_like(fr, bool)
                for k in range(1, 400):
                    harm |= np.abs(fr - k * f0) < 6
                inh = lambda z: 10 * np.log10((lambda Z: Z[~harm & (fr > 20)].sum() / Z.sum())(np.abs(np.fft.rfft(z * w)) ** 2))
                print(f"   {s}: inharmonic (aliasing) {inh(ys):.1f} dB; the curve at 1x {inh(fl_soft_clip(xs)):.1f}, "
                      f"at 8x {inh(signal.resample_poly(fl_soft_clip(signal.resample_poly(xs, 8, 1)), 1, 8)):.1f}")
            continue
        for b in ["burst_1000_20", "burst_1000_200", "burst_50_20", "burst_50_200"]:
            xs, ys = seg(b, X)[0], seg(b, y)[0]
            red = -P.gain_db(ys, xs, np.abs(signal.hilbert(xs)), frac=0.5)
            dur = int(b.split("_")[2])
            end = int((0.3 + dur / 1000) * sr)
            first = np.argmax(red > 0.1)
            print(f"   {b:15} reduction starts {(first / sr - 0.3) * 1000:7.2f} ms; at the end {red[end - 1]:5.2f} dB; "
                  f"back to 1 dB {np.argmax(red[end:] < 1) / sr * 1000:6.1f} ms")
        for s in ["steady_50_6", "steady_50_12", "steady_1000_12"]:
            xs, ys = seg(s, X, 0.2)[0], seg(s, y, 0.2)[0]
            n = int(0.02 * sr)
            pk = np.abs(xs).max()
            slow = []
            for k in range(0, len(xs) - n, n):
                lo = np.abs(xs[k:k + n]) < 0.35 * pk
                slow.append(np.sum(xs[k:k + n][lo] * ys[k:k + n][lo]) / np.sum(xs[k:k + n][lo] ** 2))
            z = seg(s, y, 0.4)[0]
            w = signal.windows.blackmanharris(len(z))
            Z = np.abs(np.fft.rfft(z * w)) ** 2
            fr = np.fft.rfftfreq(len(z), 1 / sr)
            f0 = int(s.split("_")[1])
            fund = Z[np.abs(fr - f0) < 8].sum()
            thdn = 10 * np.log10((Z[(fr > 10) & (fr < 20000)].sum() - fund) / fund)
            print(f"   {s:15} THD+N {thdn:6.1f} dB; peak {20 * np.log10(np.abs(z).max()):6.2f} dBFS; slow gain "
                  f"{20 * np.log10(slow[0]):6.2f} → {20 * np.log10(slow[-1]):6.2f} dB")
        for s in ["loop_0", "loop_6", "loop_12"]:
            z = seg(s, y)
            print(f"   {s:8} {P.loudness(z, sr)['I']:6.2f} LUFS, true peak {20 * np.log10(P.true_peak(z)):+.2f} dBTP")


if __name__ == "__main__":
    {"make": make, "analyse": analyse}[sys.argv[1]](os.path.expanduser(sys.argv[2]))

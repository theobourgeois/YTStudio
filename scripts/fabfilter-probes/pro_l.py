"""
FabFilter Pro-L 2's behaviour, measured (docs/fabfilter/pro-l-research.md, section 2): runs the real plug-in offline
through Spotify's pedalboard (a VST3 host for Python) on signals made here, and prints and saves what it does:
latency, gain curves, distortion, linking, true peaks, filters, dither. Nothing is played. Results (JSON and PNGs) go
to data/fabfilter-probes/pro-l/.

Needs Pro-L 2 (its trial will do) as a VST3 in ~/Library/Audio/Plug-Ins/VST3, and a virtualenv:

    python3 -m venv /tmp/probe-venv && /tmp/probe-venv/bin/pip install pedalboard numpy scipy soundfile matplotlib
    /tmp/probe-venv/bin/python -I scripts/fabfilter-probes/pro_l.py [group ...]     # groups: see GROUPS; none = all

Everything runs at 48 kHz stereo. Pedalboard compensates the plug-in's reported latency, so outputs line up with
inputs sample for sample. Pro-L's gain is measured as out / in wherever the input isn't near a zero crossing
(exact for a time-varying gain, which is what a limiter is when it doesn't oversample).
"""
import json
import os
import sys

import numpy as np
from scipy import signal

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
OUT = os.path.join(ROOT, "data", "fabfilter-probes", "pro-l")
KIT = os.path.join(ROOT, "public", "kit")
PLUGIN = os.path.expanduser("~/Library/Audio/Plug-Ins/VST3/FabFilter Pro-L 2.vst3")
SR = 48000
STYLES = ["Transparent", "Punchy", "Dynamic", "Allround", "Aggressive", "Modern", "Bus", "Safe"]
OVERSAMPLING = ["Off", "2x", "4x", "8x", "16x", "32x"]

# ------------------------------------------------------------------------------------------------------------ the host

_plugin = None


def plugin():
    global _plugin
    if _plugin is None:
        import pedalboard

        _plugin = pedalboard.load_plugin(PLUGIN)
    return _plugin


# Pro-L 2's tapers, read off its parameter texts: Attack = 10 s · raw⁴; Release = 6.859 s · raw³ up to 5 s (raw 0.9),
# then on to 10 s; Lookahead linear 0..5 ms; Gain linear 0..30 dB; Output linear −30..0 dB; links linear 0..100 %.
def attack_raw(seconds):
    return min(1.0, (seconds / 10.0) ** 0.25)


def release_raw(seconds):
    return (seconds / 6.8587) ** (1 / 3) if seconds <= 5.0 else 0.9 + 0.1 * (seconds - 5.0) / 5.0


def configure(style="Modern", gain=0.0, output=0.0, lookahead=0.18e-3, attack=0.275, release=0.4, link_t=75,
              link_r=100, tp=False, os_="Off", dc=False, dither="Off", shaping="Optimized"):
    """Pro-L 2's own defaults, but True Peak Limiting off unless asked (so sample peaks are what's limited)."""
    p = plugin()
    prm = p.parameters
    p.style = style
    prm["gain"].raw_value = gain / 30.0
    prm["output_level"].raw_value = (output + 30.0) / 30.0
    prm["lookahead"].raw_value = lookahead * 1000.0 / 5.0
    prm["attack"].raw_value = attack_raw(attack)
    prm["release"].raw_value = release_raw(release)
    prm["channel_link_transients"].raw_value = link_t / 100.0
    prm["channel_link_release"].raw_value = link_r / 100.0
    p.true_peak_limiting = bool(tp)
    p.oversampling = os_
    p.filter_dc_offset = bool(dc)
    p.dithering = dither
    p.noise_shaping = shaping
    p.unity_gain = False
    p.audition_limiting = False
    return p


def run(x, sr=SR, **cfg):
    """Process a (2, n) or (n,) signal from a fresh state; 0.2 s of silence after it lets the tail out."""
    p = configure(**cfg)
    x = np.asarray(x, dtype=np.float32)
    if x.ndim == 1:
        x = np.stack([x, x])
    y = p.process(np.concatenate([x, np.zeros((2, int(0.2 * sr)), np.float32)], axis=1), sr, reset=True)
    return y[:, : x.shape[1]].astype(np.float64)


def latency(sr=SR, **cfg):
    p = configure(**cfg)
    p.process(np.zeros((2, 4096), np.float32), sr, reset=True)
    return int(p.reported_latency_samples)


# ------------------------------------------------------------------------------------------------------ measurement


def db(x):
    return 20 * np.log10(np.maximum(np.abs(x), 1e-12))


def gain_db(y, x, level=None, frac=0.5):
    """The gain applied, in dB per sample: out / in where |in| ≥ frac of its level, interpolated between."""
    ref = np.abs(x) if level is None else level
    idx = np.nonzero(np.abs(x) >= frac * np.maximum(ref, 1e-9))[0]
    return np.interp(np.arange(len(x)), idx, db(y[idx] / x[idx]))


def true_peak(x, k=32):
    """An ideal reconstruction's peak: k× with a long Kaiser sinc (the reference, not BS.1770's own filter)."""
    return max(np.max(np.abs(signal.resample_poly(ch, k, 1, window=("kaiser", 14.0)))) for ch in np.atleast_2d(x))


# ITU-R BS.1770-5 Annex 2: the true-peak meter's 48-tap, 4-phase interpolator.
BS1770_TP = np.array([
    0.0017089843750, 0.0109863281250, -0.0196533203125, 0.0332031250000, -0.0594482421875, 0.1373291015625,
    0.9721679687500, -0.1022949218750, 0.0476074218750, -0.0266113281250, 0.0148925781250, -0.0083007812500,
    -0.0291748046875, 0.0292968750000, -0.0517578125000, 0.0891113281250, -0.1665039062500, 0.4650878906250,
    0.7797851562500, -0.2003173828125, 0.1015625000000, -0.0582275390625, 0.0330810546875, -0.0189208984375,
    -0.0189208984375, 0.0330810546875, -0.0582275390625, 0.1015625000000, -0.2003173828125, 0.7797851562500,
    0.4650878906250, -0.1665039062500, 0.0891113281250, -0.0517578125000, 0.0292968750000, -0.0291748046875,
    -0.0083007812500, 0.0148925781250, -0.0266113281250, 0.0476074218750, -0.1022949218750, 0.9721679687500,
    0.1373291015625, -0.0594482421875, 0.0332031250000, -0.0196533203125, 0.0109863281250, 0.0017089843750,
]).reshape(4, 12)


def bs1770_true_peak(x):
    return max(np.max(np.abs(signal.lfilter(BS1770_TP[ph], [1], ch))) for ch in np.atleast_2d(x) for ph in range(4))


def k_weighting(sr=SR):
    f0, G, Q = 1681.974450955533, 3.999843853973347, 0.7071752369554196
    K = np.tan(np.pi * f0 / sr)
    Vh = 10 ** (G / 20)
    Vb = Vh ** 0.4996667741545416
    a0 = 1 + K / Q + K * K
    shelf = ([(Vh + Vb * K / Q + K * K) / a0, 2 * (K * K - Vh) / a0, (Vh - Vb * K / Q + K * K) / a0],
             [1, 2 * (K * K - 1) / a0, (1 - K / Q + K * K) / a0])
    f0, Q = 38.13547087602444, 0.5003270373238773
    K = np.tan(np.pi * f0 / sr)
    a0 = 1 + K / Q + K * K
    high_pass = ([1, -2, 1], [1, 2 * (K * K - 1) / a0, (1 - K / Q + K * K) / a0])
    return shelf, high_pass


def loudness(x, sr=SR):
    """BS.1770-5 integrated loudness (gated) and the maximum short-term and momentary, in LUFS."""
    (b1, a1), (b2, a2) = k_weighting(sr)
    z = np.stack([signal.lfilter(b2, a2, signal.lfilter(b1, a1, ch)) for ch in np.atleast_2d(x)])
    sub = int(0.1 * sr)
    n = z.shape[1] // sub
    power = (z[:, : n * sub] ** 2).reshape(z.shape[0], n, sub).mean(axis=2).sum(axis=0)
    lufs = lambda v: -0.691 + 10 * np.log10(np.maximum(v, 1e-20))
    m = np.convolve(power, np.ones(4) / 4, "valid")
    s = np.convolve(power, np.ones(30) / 30, "valid") if n >= 30 else m
    blocks = m[lufs(m) > -70]
    gated = blocks[lufs(blocks) > lufs(blocks.mean()) - 10]
    return dict(I=float(lufs(gated.mean())), Smax=float(lufs(s).max()), Mmax=float(lufs(m).max()))


def thd(y, f, sr=SR):
    """THD+N of a steady sine, in dB re the fundamental (Blackman–Harris, 10 Hz–20 kHz)."""
    Y = np.abs(np.fft.rfft(y * signal.windows.blackmanharris(len(y)))) ** 2
    fr = np.fft.rfftfreq(len(y), 1 / sr)
    bw = 8 * sr / len(y)
    fund = Y[(fr > f - bw) & (fr < f + bw)].sum()
    total = Y[(fr > 10) & (fr < 20000)].sum()
    return float(10 * np.log10(max(total - fund, 1e-30) / fund))


# --------------------------------------------------------------------------------------------------------- material


def tone(f, seconds, amp=1.0):
    return amp * np.sin(2 * np.pi * f * np.arange(int(seconds * SR)) / SR)


def fade(x, ms=5):
    n = int(ms * SR / 1000)
    w = np.ones(len(x))
    w[:n] = np.linspace(0, 1, n)
    w[-n:] = np.linspace(1, 0, n)
    return x * w


def burst(f, seconds, over_db=6.0, pre=0.3, post=1.5):
    """A carrier (f = 0: DC) at −20 dBFS, with `seconds` of it at `over_db` above a 0 dB ceiling."""
    level = np.concatenate([np.full(int(pre * SR), 0.1), np.full(int(seconds * SR), 10 ** (over_db / 20)),
                            np.full(int(post * SR), 0.1)])
    t = np.arange(len(level)) / SR
    return (level if f == 0 else level * np.sin(2 * np.pi * f * t)), level


def kit(name):
    import soundfile as sf

    x, sr = sf.read(os.path.join(KIT, name + ".wav"), always_2d=True)
    x = signal.resample_poly(x.T, SR, sr, axis=1) if sr != SR else x.T
    return np.vstack([x, x]) if x.shape[0] == 1 else x


def eight08(seconds, f0, drive=1.6):
    """A synthesised 808: a sine dropping from 2.2 × f0 in 25 ms, decaying over 550 ms, a little saturated."""
    t = np.arange(int(seconds * SR)) / SR
    f = f0 + (2.2 * f0 - f0) * np.exp(-t / 0.025)
    env = np.exp(-t / 0.55) * np.minimum(1, t / 0.002)
    return np.tanh(drive * np.sin(2 * np.pi * np.cumsum(f) / SR)) / np.tanh(drive) * env


BPM = 140


def trap_loop(bars=4, seed=1):
    """Four bars at 140 BPM: kick, snare + clap, hats with a roll, an 808 line, a pad. Peak −1 dBFS."""
    rng = np.random.default_rng(seed)
    beat = 60 / BPM
    n = int(bars * 4 * beat * SR) + SR
    out = np.zeros((2, n))
    kick, snare, hat, clap = kit("kick"), kit("snare"), kit("hat"), kit("clap")

    def put(x, t, g=1.0, pan=0.0):
        i = int(t * SR)
        x = np.vstack([x, x]) if x.ndim == 1 else x
        m = min(x.shape[1], n - i)
        out[0, i:i + m] += g * (1 - max(0, pan)) * x[0, :m]
        out[1, i:i + m] += g * (1 + min(0, pan)) * x[1, :m]

    for bar in range(bars):
        b0 = bar * 4 * beat
        for k in [0, 1.75, 2.5]:
            put(kick, b0 + k * beat, 0.9)
        for s in [1, 3]:
            put(snare, b0 + s * beat, 0.7)
            put(clap, b0 + s * beat, 0.5)
        steps = np.arange(0, 4, 0.5) if bar % 2 == 0 else np.concatenate([np.arange(0, 3, 0.5), np.arange(3, 4, 1 / 6)])
        for h in steps:
            put(hat, b0 + h * beat, 0.35 * (0.8 + 0.4 * rng.random()), pan=0.3 * (rng.random() - 0.5))
        f = 48.0 * 2 ** ([0, 0, 3, -2][bar % 4] / 12)
        put(eight08(beat * 2.4, f), b0, 0.95)
        put(eight08(beat * 1.4, f * 2 ** (3 / 12)), b0 + 2.5 * beat, 0.9)
    t = np.arange(n) / SR
    pad = np.zeros((2, n))
    for i, semi in enumerate([0, 3, 7, 10]):
        for ch, det in [(0, 0.997), (1, 1.003)]:
            pad[ch] += signal.sawtooth(2 * np.pi * 220 * 2 ** (semi / 12) * det * t + i)
    b, a = signal.butter(2, 1800 / (SR / 2))
    out += signal.lfilter(b, a, pad, axis=1) * 0.04
    return out / np.max(np.abs(out)) * 10 ** (-1 / 20)


def hard(kind, seed=3):
    """Hard material for overshoot: clipped drums, clipped noise, or the loop."""
    rng = np.random.default_rng(seed)
    n = 3 * SR
    if kind == "noise":
        x = np.clip(rng.normal(0, 0.5, (2, n)), -1.5, 1.5)
    elif kind == "drums":
        x = np.zeros((2, n))
        for i in range(12):
            s, m = int(i * SR / 4), int(0.2 * SR)
            tt = np.arange(m) / SR
            x[:, s:s + m] += rng.normal(0, 1, m) * np.exp(-tt / 0.03) + np.sin(
                2 * np.pi * (60 + 200 * np.exp(-tt / 0.02)) * tt) * np.exp(-tt / 0.1)
        x = np.clip(x * 4, -1, 1)
    else:
        x = trap_loop()
    return x / np.max(np.abs(x))


# ----------------------------------------------------------------------------------------------------------- groups


def g_latency():
    """Reported latency for every style × oversampling × true peak, at Lookahead 0 and 5 ms; and at other rates."""
    res = {}
    for st in STYLES:
        for os_ in OVERSAMPLING:
            for tp in (False, True):
                res[f"{st}|{os_}|{int(tp)}"] = [latency(style=st, os_=os_, tp=tp, lookahead=la) for la in (0, 5e-3)]
    for sr in (44100, 96000):
        for st in STYLES:
            res[f"{st}|Off|0|{sr}"] = latency(sr=sr, style=st)
            res[f"{st}|Off|1|{sr}"] = latency(sr=sr, style=st, tp=True)
    for tp in (0, 1):
        print(f"TP {'on' if tp else 'off'}: samples at 48 kHz (Lookahead 0 / 5 ms)")
        for st in STYLES:
            print(f"  {st:12}" + "".join(f"{'/'.join(map(str, res[f'{st}|{o}|{tp}'])):>12}" for o in OVERSAMPLING))
    return res


def g_carriers():
    """Gain curves for +6 dB bursts of DC, 50 Hz, 100 Hz and 1 kHz, 20 and 200 ms long: where reduction starts."""
    import matplotlib.pyplot as plt

    res = {}
    fig, axes = plt.subplots(8, 2, figsize=(16, 28))
    for i, st in enumerate(STYLES):
        for j, seconds in enumerate([0.02, 0.2]):
            for f in [0, 50, 100, 1000]:
                x, level = burst(f, seconds)
                y = run(x, style=st, lookahead=1e-3)
                g = db(y[0]) - db(level) if f == 0 else gain_db(y[0], x, level)
                t = (np.arange(len(g)) / SR - 0.3) * 1000
                red = -g
                first = np.argmax(red[int(0.1 * SR):] > 0.1) + int(0.1 * SR)
                res[f"{st}|{seconds}|{f}"] = dict(start_ms=float(t[first]), max_db=float(red.max()))
                axes[i, j].plot(t, g, label=f"{f} Hz" if f else "DC")
            axes[i, j].set(xlim=(-60, seconds * 1000 + 400), ylim=(-9, 1),
                           title=f"{st}: {seconds * 1000:g} ms at +6 dB, LA 1 ms, A 275 ms, R 400 ms")
            axes[i, j].grid(alpha=0.3)
            axes[i, j].legend(fontsize=8)
            print(f"  {st:12} {seconds * 1000:5g} ms: reduction starts " +
                  ", ".join(f"{'DC' if f == 0 else f'{f} Hz'} {res[f'{st}|{seconds}|{f}']['start_ms']:.2f} ms"
                            for f in [0, 50, 100, 1000]))
    fig.tight_layout()
    fig.savefig(os.path.join(OUT, "carriers.png"), dpi=60)
    return res


def g_release():
    """Recovery to 1 dB and 0.1 dB after a 200 ms +6 dB 1 kHz burst, across Release and Attack."""
    res = {}
    for st in STYLES:
        for rel in [0.0, 0.01, 0.1, 0.4, 1.0, 3.0]:
            for att in [0.0, 0.275, 10.0]:
                x, level = burst(1000, 0.2, post=3.5)
                red = -gain_db(run(x, style=st, release=rel, attack=att, lookahead=1e-3)[0], x, level)[int(0.5 * SR):]
                res[f"{st}|{rel}|{att}"] = [float(np.argmax(red < d) / SR * 1000) for d in (1.0, 0.1)]
                print(f"  {st:12} R {rel * 1000:5.0f} ms  A {att * 1000:6.0f} ms: to 1 dB "
                      f"{res[f'{st}|{rel}|{att}'][0]:7.1f} ms, to 0.1 dB {res[f'{st}|{rel}|{att}'][1]:7.1f} ms")
    return res


def g_thd():
    """THD+N of steady sines, and two-tone IMD (50 Hz overloading + 3 kHz at −20 dB), per style."""
    res = {}
    freqs = [40, 60, 100, 250, 1000, 5000]
    for os_ in ["Off", "4x"]:
        for over in [6, 12]:
            print(f"  +{over} dB, oversampling {os_}: THD+N (dB) at {freqs} Hz, then IMD")
            for st in STYLES:
                row = [thd(run(fade(tone(f, 2.0, 10 ** (over / 20))), style=st, os_=os_)[0, SR // 2:SR // 2 + SR], f)
                       for f in freqs]
                t = np.arange(2 * SR) / SR
                x = fade(10 ** (over / 20) * np.sin(2 * np.pi * 50 * t) + 0.1 * np.sin(2 * np.pi * 3000 * t))
                seg = run(x, style=st, os_=os_)[0, SR // 2:SR // 2 + SR]
                Y = np.abs(np.fft.rfft(seg * signal.windows.blackmanharris(len(seg)))) ** 2
                fr = np.fft.rfftfreq(len(seg), 1 / SR)
                band = lambda fc: Y[(fr > fc - 6) & (fr < fc + 6)].sum()
                imd = 10 * np.log10(sum(band(3000 + 50 * k) + band(3000 - 50 * k) for k in range(1, 9)) / band(3000))
                res[f"{st}|{os_}|{over}"] = dict(thdn=row, imd=float(imd))
                print(f"    {st:12}" + "".join(f"{v:8.1f}" for v in row) + f"   IMD {imd:6.1f}")
    return res


def g_static():
    """Below the ceiling: a null test on the loop, a static curve of a 1 kHz sine, the ceiling held on sustained tones."""
    res = {}
    loop = trap_loop()
    for st in STYLES:
        r = run(loop, style=st) - loop
        res[f"null|{st}"] = float(10 * np.log10(np.mean(r ** 2) / np.mean(loop ** 2) + 1e-30))
        curve = []
        for lv in [-12, -6, -3, -1, -0.5, 0, 0.5, 1, 3, 6, 12]:
            y = run(fade(tone(1000, 1.5, 10 ** (lv / 20))), style=st)
            curve.append(float(db(np.max(np.abs(y[0, SR:int(1.4 * SR)])))))
        res[f"static|{st}"] = curve
        held = []
        for over in [3, 6, 12, 20, 30]:
            x, level = burst(1000, 1.0, over_db=over)
            red = -gain_db(run(x, style=st)[0], x, level)
            held.append(float(red[int(1.29 * SR)] - over))
        res[f"held|{st}"] = held
        print(f"  {st:12} null {res[f'null|{st}']:7.1f} dB; static curve {['%.2f' % v for v in curve]}; "
              f"reduction minus overload after 1 s {['%+.2f' % v for v in held]}")
    return res


def g_loudness():
    """The loop's integrated loudness against Gain, per style (does more gain always mean louder?)."""
    res = {}
    loop = trap_loop()
    gains = [4, 8, 12, 16, 20, 25, 30]
    for st in STYLES:
        res[st] = [loudness(run(loop, style=st, gain=g))["I"] for g in gains]
        print(f"  {st:12}" + "".join(f"{v:7.2f}" for v in res[st]) + f"   (Gain {gains} dB)")
    res["Modern, Attack 10 s, Release 10 ms"] = [
        loudness(run(loop, style="Modern", gain=g, attack=10.0, release=0.01))["I"] for g in gains]
    print("  Modern, A 10 s, R 10 ms" + "".join(f"{v:7.2f}" for v in res["Modern, Attack 10 s, Release 10 ms"]))
    return res


def g_music():
    """The loop pushed to −9 and −7 LUFS through each style and two clippers: gain needed, PLR, punch, residue."""
    loop = trap_loop()
    beat = 60 / BPM
    onsets = [(bar * 4 * beat + k * beat, "kick") for bar in range(4) for k in [0, 1.75, 2.5]]
    onsets += [(bar * 4 * beat + s * beat, "snare") for bar in range(4) for s in [1, 3]]

    def punch(z, which):
        vals = []
        for t, kind in onsets:
            if kind == which:
                i = int(t * SR)
                a = np.max(np.abs(z[:, i:i + int(0.006 * SR)]))
                r = np.sqrt(np.mean(z[:, i + int(0.006 * SR):i + int(0.08 * SR)] ** 2))
                vals.append(20 * np.log10(a / r))
        return float(np.mean(vals))

    def residue(x, y, win=0.02):
        """What's left after the best gain per 20 ms (Hann, half overlap): fast gain motion and clipping, in dB."""
        n = int(win * SR)
        h = np.hanning(n)
        e = np.zeros_like(y)
        for s in range(0, y.shape[1] - n, n // 2):
            g = np.sum(x[:, s:s + n] * y[:, s:s + n]) / max(np.sum(x[:, s:s + n] ** 2), 1e-20)
            e[:, s:s + n] += h * (y[:, s:s + n] - g * x[:, s:s + n])
        b, a = signal.butter(4, 4000 / (SR / 2), "high")
        return (float(10 * np.log10(np.sum(e ** 2) / np.sum(y ** 2))),
                float(10 * np.log10(np.sum(signal.lfilter(b, a, e, axis=1) ** 2) / np.sum(y ** 2))))

    def clipper(kind):
        def f(gain):
            u = signal.resample_poly(loop * 10 ** (gain / 20), 4, 1, axis=1)
            return signal.resample_poly(np.clip(u, -1, 1) if kind == "hard" else np.tanh(u), 1, 4, axis=1)
        return f

    procs = {st: (lambda st: lambda g: run(loop, style=st, gain=g))(st) for st in STYLES}
    procs["hard clip 4x"] = clipper("hard")
    procs["tanh clip 4x"] = clipper("tanh")
    kp, sp = punch(loop, "kick"), punch(loop, "snare")
    res = {}
    for target in [-9, -7]:
        print(f"  to {target} LUFS: gain, true peak, PLR, kick punch Δ, snare punch Δ, residue, residue > 4 kHz")
        for name, proc in procs.items():
            lo, hi = 0.0, 30.0
            for _ in range(14):
                mid = (lo + hi) / 2
                lo, hi = (mid, hi) if loudness(proc(mid))["I"] < target else (lo, mid)
            y = proc(hi)
            tp = float(db(true_peak(y)))
            r, rh = residue(loop, y)
            row = dict(gain=hi, tp=tp, plr=tp - loudness(y)["I"], kick=punch(y, "kick") - kp,
                       snare=punch(y, "snare") - sp, residue=r, residue_hf=rh)
            res[f"{target}|{name}"] = row
            print(f"    {name:13}" + "".join(f"{v:7.2f}" for v in row.values()))
    return res


def g_link():
    """Linking: the reduction in a quiet channel while the other has +6 dB bursts."""
    res = {}
    n = int(1.5 * SR)
    t = np.arange(n) / SR
    quiet = 0.1 * np.sin(2 * np.pi * 1000 * t)
    for st in ["Transparent", "Modern", "Safe"]:
        for lt, lr in [(0, 0), (10, 0), (20, 0), (30, 0), (40, 0), (50, 0), (100, 0), (0, 100), (75, 100)]:
            row = []
            for seconds in (0.02, 0.3):
                loud = 0.1 * np.ones(n)
                loud[int(0.3 * SR):int((0.3 + seconds) * SR)] = 2.0
                y = run(np.stack([loud * np.sin(2 * np.pi * 1000 * t), quiet]), style=st, link_t=lt, link_r=lr)
                row.append(float(-gain_db(y[1], quiet).min()))
            res[f"{st}|{lt}|{lr}"] = row
            print(f"  {st:12} transients {lt:3}% release {lr:3}%: quiet channel reduced {row[0]:.2f} dB (20 ms), "
                  f"{row[1]:.2f} dB (300 ms)")
    return res


def g_overshoot():
    """+12 dB of hard material into a −1 dB ceiling: sample peak, BS.1770 true peak and ideal true peak over it."""
    res = {}
    for kind in ["drums", "noise", "loop"]:
        x = hard(kind)
        for st in ["Transparent", "Aggressive", "Modern"]:
            for os_ in ["Off", "4x", "32x"]:
                for tp in (False, True):
                    y = run(x, style=st, gain=12, output=-1.0, os_=os_, tp=tp, lookahead=0.0)
                    v = [float(db(np.max(np.abs(y))) + 1), float(db(bs1770_true_peak(y)) + 1), float(db(true_peak(y)) + 1)]
                    res[f"{kind}|{st}|{os_}|{int(tp)}"] = v
                    print(f"  {kind:6}{st:12}{os_:>4} TP {'on ' if tp else 'off'}: sample {v[0]:+.3f}, "
                          f"BS.1770 {v[1]:+.3f}, ideal {v[2]:+.3f} dB")
    return res


def g_filters():
    """Oversampling filters (a low-level impulse), the DC filter's response."""
    res = {}
    for os_ in OVERSAMPLING:
        x = np.zeros(SR // 2)
        x[SR // 4] = 0.01
        h = run(x, style="Transparent", os_=os_)[0] / 0.01
        nz = np.nonzero(np.abs(h) > 1e-5)[0] - SR // 4
        H = db(np.fft.rfft(h))
        fr = np.fft.rfftfreq(len(h), 1 / SR)
        edge = lambda d: next((float(f) for f, v in zip(fr, H) if f > 1000 and v < d), None)
        res[f"os|{os_}"] = dict(first=int(nz[0]), last=int(nz[-1]), pre_ring_db=float(
            10 * np.log10(np.sum(h[:SR // 4] ** 2) / np.sum(h ** 2) + 1e-30)), f_01db=edge(-0.1), f_3db=edge(-3))
        print(f"  {os_:>4}: {res[f'os|{os_}']}")
    x = np.zeros(4 * SR)
    x[SR] = 0.01
    H = np.fft.rfft(run(x, style="Transparent", dc=True)[0] / 0.01)
    fr = np.fft.rfftfreq(4 * SR, 1 / SR)
    res["dc"] = {f: float(db(H[np.argmin(abs(fr - f))])) for f in [1, 2, 3, 5, 10, 20]}
    print(f"  DC filter (dB at Hz): {res['dc']}")
    return res


def g_dither():
    """16-bit dither's noise per octave, each noise shaping against flat TPDF (None)."""
    res = {}
    bands = [63, 125, 250, 500, 2000, 4000, 8000, 12000, 16000, 20000]
    x = fade(tone(1000, 4.0, 10 ** (-40 / 20)))
    spectra = {}
    for sh in ["None", "Basic", "Optimized", "Weighted"]:
        e = run(x, style="Transparent", dither="16 Bits", shaping=sh)[0, SR:3 * SR] - x[SR:3 * SR]
        spectra[sh] = signal.welch(e, SR, nperseg=8192)
    f, base = spectra["None"]
    for sh, (_, P) in spectra.items():
        res[sh] = [float(10 * np.log10(np.mean(P[(f > b / 1.41) & (f < b * 1.41)]) /
                                       np.mean(base[(f > b / 1.41) & (f < b * 1.41)]))) for b in bands]
        print(f"  {sh:10}" + "".join(f"{v:7.1f}" for v in res[sh]) + f"   (dB at {bands} Hz)")
    return res


GROUPS = dict(latency=g_latency, carriers=g_carriers, release=g_release, thd=g_thd, static=g_static,
              loudness=g_loudness, music=g_music, link=g_link, overshoot=g_overshoot, filters=g_filters,
              dither=g_dither)

if __name__ == "__main__":
    import matplotlib

    matplotlib.use("Agg")
    os.makedirs(OUT, exist_ok=True)
    for name in sys.argv[1:] or list(GROUPS):
        print(f"== {name}: {GROUPS[name].__doc__.strip()}")
        with open(os.path.join(OUT, name + ".json"), "w") as f:
            json.dump(GROUPS[name](), f, indent=1)

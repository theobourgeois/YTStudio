"""Building blocks for the contenders: audio I/O, loudness, a true-peak lookahead limiter, biquads, compression and envelopes."""
import numpy as np
import soundfile as sf
import pyloudnorm as pyln
from scipy.ndimage import minimum_filter1d, uniform_filter1d
from scipy.signal import resample_poly, sosfilt, lfilter, butter
import pedalboard as pb

SR = 44100
_meter = pyln.Meter(SR)


def read(path):
    x, sr = sf.read(path, dtype="float32", always_2d=True)
    assert sr == SR, (path, sr)
    return x


def write(path, x, subtype="PCM_24"):
    sf.write(path, x, SR, subtype=subtype)


def db(x):
    return 20 * np.log10(np.maximum(x, 1e-12))


def undb(d):
    return 10 ** (d / 20)


def lufs(x):
    """Integrated loudness (BS.1770, gated), -inf for silence."""
    if np.max(np.abs(x)) < 1e-6:
        return -np.inf
    return _meter.integrated_loudness(x)


def true_peak(x):
    up = resample_poly(x, 4, 1, axis=0)
    return float(np.max(np.abs(up)))


def limit(x, ceiling_db=-0.5, lookahead_ms=5.0, release_ms=80.0):
    """Brickwall limiter on 4x-oversampled peaks: the gain dips early enough (centred lookahead) and recovers smoothly."""
    ceil = undb(ceiling_db)
    up = np.max(np.abs(resample_poly(x, 4, 1, axis=0)), axis=1)
    n = len(x)
    peak = np.maximum(up[: n * 4].reshape(n, 4).max(axis=1), 1e-9)
    g = np.minimum(1.0, ceil / peak)
    L = max(1, int(lookahead_ms * SR / 1000))
    h = minimum_filter1d(g, 2 * L + 1)
    B = 32
    pad = (-n) % B
    hb = np.concatenate([h, np.ones(pad)]).reshape(-1, B).min(axis=1)
    a = np.exp(-B / (release_ms * SR / 1000))
    y = np.empty_like(hb)
    cur = 1.0
    for i, v in enumerate(hb):
        cur = v if v < cur else v + (cur - v) * a
        y[i] = cur
    yr = np.interp(np.arange(n + pad) / B - 0.5, np.arange(len(y)), y)[:n]
    gain = uniform_filter1d(np.minimum(h, yr), L + 1, mode="nearest")
    out = x * gain[:, None]
    return np.clip(out, -ceil, ceil).astype(np.float32)


def soft_clip(x, ceiling_db=-0.5):
    c = undb(ceiling_db)
    return (c * np.tanh(x / c)).astype(np.float32)


def push_to(x, target_lufs, chain, iters=10):
    """Finds the input gain at which `chain(x * gain)` lands on target_lufs (the chain ends in a limiter)."""
    g = target_lufs - lufs(x)
    for _ in range(iters):
        out = chain(x * undb(g))
        err = target_lufs - lufs(out)
        if abs(err) < 0.05:
            break
        g += err * 1.3
    return out


def gain_to(x, target_lufs):
    l = lufs(x)
    return x if not np.isfinite(l) else (x * undb(target_lufs - l)).astype(np.float32)


# Biquads (RBJ cookbook), applied with sosfilt along time.
def _sos(b, a):
    b = np.asarray(b) / a[0]
    a = np.asarray(a) / a[0]
    return np.array([[b[0], b[1], b[2], 1.0, a[1], a[2]]])


def peaking(f, gain_db, q):
    A = 10 ** (gain_db / 40)
    w = 2 * np.pi * f / SR
    al = np.sin(w) / (2 * q)
    return _sos([1 + al * A, -2 * np.cos(w), 1 - al * A], [1 + al / A, -2 * np.cos(w), 1 - al / A])


def shelf(f, gain_db, high, s=0.8):
    A = 10 ** (gain_db / 40)
    w = 2 * np.pi * f / SR
    al = np.sin(w) / 2 * np.sqrt((A + 1 / A) * (1 / s - 1) + 2)
    c = np.cos(w)
    sa = 2 * np.sqrt(A) * al
    if high:
        b = [A * ((A + 1) + (A - 1) * c + sa), -2 * A * ((A - 1) + (A + 1) * c), A * ((A + 1) + (A - 1) * c - sa)]
        a = [(A + 1) - (A - 1) * c + sa, 2 * ((A - 1) - (A + 1) * c), (A + 1) - (A - 1) * c - sa]
    else:
        b = [A * ((A + 1) - (A - 1) * c + sa), 2 * A * ((A - 1) - (A + 1) * c), A * ((A + 1) - (A - 1) * c - sa)]
        a = [(A + 1) + (A - 1) * c + sa, -2 * ((A - 1) + (A + 1) * c), (A + 1) + (A - 1) * c - sa]
    return _sos(b, a)


def hpf(f, order=4):
    return butter(order, f, "highpass", fs=SR, output="sos")


def lpf(f, order=4):
    return butter(order, f, "lowpass", fs=SR, output="sos")


def bpf(lo, hi, order=2):
    return butter(order, [lo, hi], "bandpass", fs=SR, output="sos")


def filt(x, sos):
    return sosfilt(sos, x, axis=0).astype(np.float32)


def envelope(x, ms):
    """Smoothed RMS envelope (mono) with a one-pole of time constant ms."""
    m = np.mean(x**2, axis=1) if x.ndim == 2 else x**2
    a = np.exp(-1 / (ms * SR / 1000))
    return np.sqrt(np.maximum(lfilter([1 - a], [1, -a], m), 0)).astype(np.float32)


def short_term_db(x, win_s=0.4):
    """RMS level per window in dBFS, for picking thresholds from a stem's own level distribution."""
    m = np.mean(x**2, axis=1)
    w = int(win_s * SR)
    k = len(m) // w
    r = np.sqrt(m[: k * w].reshape(k, w).mean(axis=1))
    return db(r)


def active_levels(x, win_s=0.4):
    """The short-term levels of the windows where the stem is actually playing (within 30 dB of its loudest)."""
    s = short_term_db(x, win_s)
    return s[s > s.max() - 30]


def compress(x, ratio, gr_db, attack_ms, release_ms, pct=90):
    """Compressor whose threshold sits gr_db under the stem's pct-th percentile short-term level, so the amount of
    compression is set by the material rather than a fixed number."""
    lv = active_levels(x)
    if len(lv) == 0:
        return x
    thr = float(np.percentile(lv, pct)) - gr_db * ratio / (ratio - 1)
    c = pb.Compressor(threshold_db=thr, ratio=ratio, attack_ms=attack_ms, release_ms=release_ms)
    return c(x.T.copy(), SR).T.astype(np.float32)


def duck_band(x, key_env, lo, hi, depth_db, sensitivity_pct=60):
    """Dynamic band cut: x's lo–hi band dips by up to depth_db as the key's envelope rises past its own pct-th level."""
    band = filt(x, bpf(lo, hi))
    ref = np.percentile(key_env[key_env > key_env.max() * 1e-3], sensitivity_pct) if np.any(key_env > 0) else 1
    amt = np.clip(key_env / (ref + 1e-9), 0, 1)
    g = undb(-depth_db * amt)
    return (x + band * (g - 1)[:, None]).astype(np.float32)


def pan(x, p):
    """Constant-power pan of a stereo stem's mono sum, p in [-1, 1]."""
    m = x.mean(axis=1)
    th = (p + 1) * np.pi / 4
    return np.stack([m * np.cos(th), m * np.sin(th)], axis=1).astype(np.float32) * np.sqrt(2)


def correlation(x):
    l, r = x[:, 0], x[:, 1]
    d = np.sqrt(np.sum(l * l) * np.sum(r * r))
    return float(np.sum(l * r) / d) if d > 0 else 1.0


def band_share(x, lo, hi):
    """Fraction of the stem's energy between lo and hi Hz."""
    m = x.mean(axis=1)
    spec = np.abs(np.fft.rfft(m[: min(len(m), SR * 60)])) ** 2
    f = np.fft.rfftfreq(min(len(m), SR * 60), 1 / SR)
    tot = spec.sum() + 1e-20
    return float(spec[(f >= lo) & (f < hi)].sum() / tot)


def ltas(x, bands):
    """Long-term average spectrum in dB at the given band edges (list of (lo, hi)), from the stem's mono sum."""
    m = x.mean(axis=1)
    n = 8192
    k = len(m) // n
    frames = m[: k * n].reshape(k, n) * np.hanning(n)
    p = (np.abs(np.fft.rfft(frames, axis=1)) ** 2).mean(axis=0)
    f = np.fft.rfftfreq(n, 1 / SR)
    return np.array([10 * np.log10(p[(f >= lo) & (f < hi)].mean() + 1e-20) for lo, hi in bands])

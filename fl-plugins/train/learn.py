"""Learns Auto Mix's group targets from your mixes, and says honestly whether it learned anything.

A mix is, per group, how loud it sits at the master (u, LUFS of its leaves summed). Only the differences between
groups matter (Auto Mix keeps the song's loudness), so for each mix s and group g:

    u[s,g] - rule[g] = c[s] + shift[g] + w . features[s,g] + noise

rule[g] is the fixed rules' target, c[s] a free level per mix, shift[g] what you do differently from the rules for
that group (pulled towards 0 when there are few mixes: a ridge penalty of K, like shift * n / (n + K)), and w how the
group's sound (how dense, bright, low, punchy, how much it plays over the vocal) moves it, used only if it predicts
held-out songs better than the shifts alone.

Error is measured the way it's heard: for a held-out song, the RMS over its groups of (predicted - yours), after
taking out the best overall level (that's the master, which Auto Mix doesn't touch). Compared with the rules, and
with how far your own mixes of the same song differ (hidden repeats): no model can beat your own consistency.

Mixes: the trainer's and the plugin's (training/mixes.jsonl), and each song's original balance in its FLP (weight
--originals, 0.5 by default; 0 leaves them out).

    python learn.py [--originals 0.5] [--dry]   (writes training/model.json unless --dry)
"""
import json
import os
import sys
import time

import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.dirname(HERE))

import analysis  # noqa: E402
from analysis import FEATURES, TARGETS  # noqa: E402

GROUPS = list(TARGETS)
MIXES = os.path.join(analysis.TRAINING, "mixes.jsonl")
SONGS = os.path.join(analysis.TRAINING, "songs")
REPORT = os.path.join(analysis.TRAINING, "learn_report.txt")
EXCLUDED = os.path.join(analysis.TRAINING, "excluded.json")  # songs the trainer was told are broken
K = 3.0  # shrinkage: a group needs about this many mixes before its shift counts half
LAMBDAS = [3.0, 10.0, 30.0, 100.0]


def load_mixes(originals=0.5):
    """[{"song", "source", "weight", "repeat", "groups": {g: {"lufs", "features"}}}]"""
    out = []
    if os.path.exists(MIXES):
        with open(MIXES, encoding="utf8") as f:
            for line in f:
                line = line.strip()
                if line:
                    m = json.loads(line)
                    if m.get("kind", "mix") == "mix" and m.get("groups"):
                        m["weight"] = 1.0
                        out.append(m)
    # the plugin's Learn from this mix, pressed again in a project, replaces that project's mix
    last = {m["song"]: n for n, m in enumerate(out) if m.get("source") == "plugin"}
    out = [m for n, m in enumerate(out) if m.get("source") != "plugin" or last[m["song"]] == n]
    if originals > 0 and os.path.isdir(SONGS):
        for sid in sorted(os.listdir(SONGS)):
            p = os.path.join(SONGS, sid, "song.json")
            if not os.path.exists(p):
                continue
            with open(p) as f:
                s = json.load(f)
            groups = {g["group"]: {"lufs": g["lufs"], "features": g["features"]} for g in s["rules"]["groups"]
                      if g["lufs"] is not None}
            if "vocal_lead" not in groups:  # the vocals' files were missing: not the balance you made
                continue
            out.append({"song": sid, "source": "original", "weight": originals, "groups": groups})
    excluded = set(json.load(open(EXCLUDED))) if os.path.exists(EXCLUDED) else set()
    return [m for m in out if m["song"] not in excluded and len(m["groups"]) >= 3]


def rows(mixes):
    """One row per (mix, group): (mix number, group number, residual, features, weight, song)."""
    out = []
    for n, m in enumerate(mixes):
        has_vocal = "vocal_lead" in m["groups"] or "vocal_bg" in m["groups"]
        for g, v in m["groups"].items():
            if g not in GROUPS or v["lufs"] is None:
                continue
            r = v["lufs"] - analysis.rule_target(g, has_vocal)
            out.append((n, GROUPS.index(g), r, [v["features"].get(k, 0.0) for k in FEATURES], m["weight"],
                        m["song"]))
    return out


class Model:
    def __init__(self, k=K, lam=None):
        self.k, self.lam = k, lam  # lam None: shifts only

    def fit(self, data):
        mixes = sorted({d[0] for d in data})
        col = {m: i for i, m in enumerate(mixes)}
        nm, ng = len(mixes), len(GROUPS)
        X = np.array([d[3] for d in data], float)
        self.mean = X.mean(axis=0)
        self.std = X.std(axis=0) + 1e-6
        Z = (X - self.mean) / self.std
        nf = Z.shape[1] if self.lam is not None else 0
        A = np.zeros((len(data), nm + ng + nf))
        y = np.array([d[2] for d in data], float)
        w = np.sqrt(np.array([d[4] for d in data], float))
        for i, d in enumerate(data):
            A[i, col[d[0]]] = 1.0
            A[i, nm + d[1]] = 1.0
            if nf:
                A[i, nm + ng:] = Z[i]
        A *= w[:, None]
        y = y * w
        pen = np.zeros((ng + nf, nm + ng + nf))
        pen[:ng, nm:nm + ng] = np.eye(ng) * np.sqrt(self.k)
        if nf:
            pen[ng:, nm + ng:] = np.eye(nf) * np.sqrt(self.lam)
        sol = np.linalg.lstsq(np.vstack([A, pen]), np.concatenate([y, np.zeros(ng + nf)]), rcond=None)[0]
        self.shift = sol[nm:nm + ng]
        self.w = sol[nm + ng:] if nf else None
        self.counts = np.bincount([d[1] for d in data], minlength=ng)
        return self

    def predict(self, gi, feats):
        p = self.shift[gi]
        if self.w is not None:
            p = p + np.dot(self.w, (np.asarray(feats) - self.mean) / self.std)
        return p

    def to_json(self):
        m = {"offsets": {g: round(float(self.shift[i]), 2) for i, g in enumerate(GROUPS) if self.counts[i]},
             "ridge": None}
        if self.w is not None:
            m["ridge"] = {"features": FEATURES, "mean": self.mean.tolist(), "std": self.std.tolist(),
                          "w": self.w.tolist()}
        return m


def mix_error(rs, ps):
    """RMS of (predicted - yours) over a mix's groups, after the best overall level."""
    e = np.asarray(rs) - np.asarray(ps)
    return float(np.sqrt(np.mean((e - e.mean()) ** 2)))


def by_mix(data):
    out = {}
    for d in data:
        out.setdefault(d[0], []).append(d)
    return out


def loso(data, make, judged):
    """Leave-one-song-out: each song's mixes (those `judged`) predicted by a model fit on every other song.
    Returns the mean error and the rules' on the same mixes."""
    songs = sorted({d[5] for d in data})
    errs, rule = [], []
    for s in songs:
        train = [d for d in data if d[5] != s]
        test = [d for d in data if d[5] == s and judged(d)]
        if not test or len({d[5] for d in train}) < 3:
            continue
        m = make().fit(train)
        for _, ds in by_mix(test).items():
            rs = [d[2] for d in ds]
            errs.append(mix_error(rs, [m.predict(d[1], d[3]) for d in ds]))
            rule.append(mix_error(rs, [0.0] * len(ds)))
    return (float(np.mean(errs)) if errs else None), (float(np.mean(rule)) if rule else None), len(errs)


def consistency(mixes):
    """How far your two mixes of the same song (a hidden repeat and its first) differ, per mix: the floor for any
    model (two noisy mixes differ by sqrt(2) times one's noise)."""
    by_song = {}
    for m in mixes:
        if m.get("source") in ("trainer", "plugin"):
            by_song.setdefault(m["song"], []).append(m)
    diffs = []
    for ms in by_song.values():
        for a, b in zip(ms, ms[1:]):
            gs = [g for g in a["groups"] if g in b["groups"]]
            if len(gs) >= 3:
                diffs.append(mix_error([a["groups"][g]["lufs"] for g in gs], [b["groups"][g]["lufs"] for g in gs])
                             / np.sqrt(2))
    return (float(np.mean(diffs)) if diffs else None), len(diffs)


def fmt(v):
    return "—" if v is None else "%.2f dB" % v


def learn(originals=0.5, write=True, log=print):
    mixes = load_mixes(originals)
    data = rows(mixes)
    songs = {d[5] for d in data}
    yours = [m for m in mixes if m.get("source") != "original"]
    if len(songs) < 4:
        raise ValueError("Only %d songs mixed so far: mix a few more first." % len(songs))
    # judged on your trainer/plugin mixes once there are enough of them, else on the FLPs' own balances
    on_yours = len({m["song"] for m in yours}) >= 5
    judged = (lambda d: mixes[d[0]].get("source") != "original") if on_yours else (lambda d: True)
    lines = ["Auto Mix learning report, %s" % time.strftime("%Y-%m-%d %H:%M"),
             "%d mixes of %d songs (%d yours, %d original FLP balances at weight %.2f)" % (
                 len(mixes), len(songs), len(yours), len(mixes) - len(yours), originals),
             "Judged on: %s, each song predicted by a model that never saw it." % (
                 "your mixes" if on_yours else "the FLPs' own balances (mix more songs in the trainer to judge on "
                                               "those)"), ""]
    shifts_err, rules_err, n = loso(data, lambda: Model(K), judged)
    best, best_err, best_name = None, shifts_err, "group shifts"
    ridge_results = []
    for lam in LAMBDAS:
        e, _, _ = loso(data, lambda lam=lam: Model(K, lam), judged)
        ridge_results.append((lam, e))
        if e is not None and best_err is not None and e < best_err - 0.02:
            best, best_err, best_name = lam, e, "group shifts + sound (ridge, lambda %g)" % lam
    cons, ncons = consistency(mixes)
    lines += ["Held-out error per mix (lower is better):",
              "  fixed rules            %s" % fmt(rules_err),
              "  learned group shifts   %s" % fmt(shifts_err)]
    lines += ["  + sound, lambda %-6g %s" % (lam, fmt(e)) for lam, e in ridge_results]
    lines += ["  your own consistency   %s%s" % (fmt(cons), " (%d repeats)" % ncons if ncons else
                                                 " (no repeats yet: the trainer slips some in)"), ""]
    model = Model(K, best).fit(data)
    lines.append("Using: %s, fit on everything (%d mixes over %d songs)." % (best_name, len(mixes), len(songs)))
    lines.append("What it moves from the rules (dB, at the master):")
    for i, g in enumerate(GROUPS):
        if model.counts[i]:
            lines.append("  %-16s %+5.1f   (%d mixes)" % (analysis.GROUP_NAMES[g], model.shift[i], model.counts[i]))
    if model.w is not None:
        lines.append("And by sound (dB per standard deviation): " + ", ".join(
            "%s %+.1f" % (k, v) for k, v in zip(FEATURES, model.w)))
    better = rules_err is not None and best_err is not None and best_err < rules_err - 0.05
    lines.append("")
    lines.append(("It predicts your balance better than the rules by %.2f dB a mix." % (rules_err - best_err))
                 if better else "It doesn't predict your balance better than the rules yet: Auto Mix keeps "
                                "using the rules until it does.")
    out = dict(model.to_json(), version=1, made=time.strftime("%Y-%m-%d %H:%M:%S"), songs=len(songs),
               mixes=len(mixes), yours=len(yours), originals=originals, better=bool(better),
               cv={"rules": rules_err, "shifts": shifts_err, "chosen": best_err, "consistency": cons,
                   "judgedOn": "yours" if on_yours else "originals", "mixes": n})
    report = "\n".join(lines)
    if write:
        os.makedirs(analysis.TRAINING, exist_ok=True)
        if better:
            with open(analysis.MODEL, "w") as f:
                json.dump(out, f, indent=1)
        elif os.path.exists(analysis.MODEL):
            os.remove(analysis.MODEL)  # a model that doesn't beat the rules shouldn't steer the plugin
        with open(REPORT, "w", encoding="utf8") as f:
            f.write(report + "\n")
    log(report)
    return out, report


if __name__ == "__main__":
    a = sys.argv[1:]
    learn(float(a[a.index("--originals") + 1]) if "--originals" in a else 0.5, write="--dry" not in a)

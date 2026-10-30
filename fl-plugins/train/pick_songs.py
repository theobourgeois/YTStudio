"""Picks the trainer's songs: the tracks ytlink tagged as sung on ("vox"), matched to their FL projects, keeping the
projects with recorded vocals in them. Writes candidates.json."""
import json, re, os, collections
import flp

HOME = os.path.expanduser("~").replace(os.sep, "/") + "/"
T = json.load(open("ytlink_tracks.json"))
state = json.load(open(os.path.join(os.environ["APPDATA"], "ytlink-sync", "state.json")))["files"]
score = {os.path.splitext(k)[0]: v.get("vocalScore") for k, v in state.items()}
vox = [t for t in T if t["vocals"] == "vox"]
fl = [l.strip() for l in open("all_flps.txt", encoding="utf-8", errors="replace")]
fl = [p for p in fl if not re.search(r"\((autosaved|overwritten)|/\.Trash/|/Kits/|/kits/|/samples/|/packages/", p)]
idx = collections.defaultdict(list)
for p in fl:
    idx[os.path.splitext(os.path.basename(p))[0].lower()].append(p)
# Tracks whose names don't lead to their project: {"track": "project"}, lower case. A person's songs, so kept out of
# the repo.
MANUAL = json.load(open("manual_matches.json")) if os.path.exists("manual_matches.json") else {}


def bases(n):
    out, s = [n], n
    for _ in range(4):
        s2 = re.sub(r"(_?(vox|voz)\d*|_?(sped|spea|slowed|slowerd|spedup|nightcore)\d*|_?mix\d*|_?master\d*|_\d+|\d+$|"
                    r"_autotunefix|_wav|_test|_m1|-\d+)$", "", s).strip(" _-")
        if s2 == s:
            break
        s = s2
        out.append(s)
    return list(dict.fromkeys(out))


def pick(paths):
    pref = [p for p in paths if p.startswith("Music/Flps/")]
    return max(pref or paths, key=lambda p: os.path.getmtime(HOME + p))


def evidence(info):
    hits = []
    for c in info["channels"]:
        s = c["sample"].replace("\\", "/")
        if flp.VOCAL.search(c["name"]) or flp.VOCAL.search(s.rsplit("/", 1)[-1]) or \
                re.search(r"/(recorded|vocals?|vox)/", s, re.I):
            hits.append(c["name"])
    return hits


songs = {}
for t in vox:
    n = t["name"].lower().strip()
    key = MANUAL.get(n) or next((b for b in bases(n) if b in idx), None)
    if not key or key not in idx:
        continue
    path = pick(idx[key])
    s = songs.setdefault(path, {"flp": HOME + path, "tracks": [], "score": 0})
    s["tracks"].append(t["name"])
    s["score"] = max(s["score"], score.get(t["name"]) or 0)
out = []
for s in songs.values():
    try:
        info = flp.read(s["flp"])
        ev = evidence(info)
    except Exception as e:
        info, ev = {"channels": []}, None
    s.update(evidence=len(ev) if ev is not None else -1, channels=len(info["channels"]),
             size=os.path.getsize(s["flp"]), mtime=os.path.getmtime(s["flp"]))
    out.append(s)
out.sort(key=lambda s: -s["mtime"])
for s in out:
    print("%3d %3d %.2f %6dk %s  %s" % (s["evidence"], s["channels"], s["score"], s["size"] // 1000,
                                       s["flp"].replace(HOME, ""), s["tracks"][:3]))
json.dump(out, open("candidates.json", "w"), indent=1)
print(len(out), "projects,", sum(1 for s in out if s["evidence"] > 0), "with vocals in them")

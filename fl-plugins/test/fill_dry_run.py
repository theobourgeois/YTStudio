"""Fill inserts on real projects without FL: classifies and plans from each song's saved FLP and the mixer state the
trainer recorded, and says how many sounds found a group. Reads only.

    python test/fill_dry_run.py [song id ...] [--detail]
"""
import collections
import json
import os
import sys

HERE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, HERE)

import fillinserts as fi  # noqa: E402
import flpread  # noqa: E402

SONGS = os.path.join(HERE, "train", "songs.json")
STATES = os.path.expanduser(r"~\Documents\YTStudio Auto Mix\training\songs")


def load(song):
    path = os.path.join(STATES, song["id"], "state.json")
    if not os.path.exists(path) or not os.path.exists(song["flp"]):
        return None
    with open(path, encoding="utf8") as f:
        state = json.load(f)
    saved = flpread.read_file(song["flp"])
    # The trainer's state has names per insert, not targets per channel: put them back together
    where = {}
    for t in [state["master"]] + state["tracks"]:
        for n in t.get("channels") or []:
            where.setdefault(n, []).append(t["index"])
    chans = []
    for i, c in enumerate(saved):
        slots = where.get(c["name"]) or [0]
        chans.append({"index": i, "name": c["name"], "type": c["type"], "target": slots.pop(0),
                      "plugin": "Serum 2" if c["type"] == fi.GENERATOR else None})
    tracks = [{"index": 0, "name": "Master", "routes": [], "fx": 0, "color": 0}]
    for t in state["tracks"]:
        tracks.append({"index": t["index"], "name": t["name"], "routes": t.get("routes") or [], "fx": 0, "color": 0})
    return tracks, chans, saved


def main():
    args = [a for a in sys.argv[1:] if not a.startswith("--")]
    detail = "--detail" in sys.argv
    with open(SONGS, encoding="utf8") as f:
        songs = json.load(f)
    categories = fi.SerumCategories()
    totals = collections.Counter()
    whys = collections.Counter()
    unknown = collections.Counter()
    moved, new_bus = 0, 0
    done = 0
    for song in songs:
        if args and song["id"] not in args:
            continue
        got = load(song)
        if not got:
            continue
        tracks, chans, saved = got
        sounds = fi.make_sounds(chans, tracks, flpread.match([c["name"] for c in chans], saved))
        sounds, _ = fi.classify(sounds, categories)
        plan = fi.build_plan(tracks, chans, sounds)
        done += 1
        totals["sounds"] += len(sounds)
        totals["known"] += sum(1 for s in sounds if s["role"])
        moved += len(plan["channels"])
        new_bus += len(plan["newBuses"])
        for s in sounds:
            whys[s["why"].split(":")[0]] += 1
            if not s["role"]:
                unknown[s["name"]] += 1
        if detail or args:
            print("==", song["id"], "buses:", plan["buses"], "new:", plan["newBuses"])
            for s in sorted(sounds, key=lambda x: x["channel"]):
                print("  %3d  %-38s %-6s %-14s on %-3s -> %-4s %s" % (
                    s["channel"], s["name"][:38], s["role"] or "-", s["why"][:14], s["target"], s["to"], s["note"]))
    categories.close()
    print("songs: %d, sounds: %d, found a group: %d (%.0f%%)" % (
        done, totals["sounds"], totals["known"], 100 * totals["known"] / max(1, totals["sounds"])))
    print("how:", dict(whys))
    print("would move %d channels, make %d buses" % (moved, new_bus))
    print("most common with no group:", unknown.most_common(25))


if __name__ == "__main__":
    main()

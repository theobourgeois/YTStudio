"""What a saved FLP says about its channels, for Fill inserts: FL's scripts can't tell which preset a Serum has loaded or
which file a sampler plays, but the project file knows. Reading only: nothing here writes an FLP.

An FLP is a header and a list of events: a byte says what it is (below 64: one byte of value, below 128: two, below 192:
four, above that: a length, then the bytes). 64 starts a channel, and what follows belongs to it, until the mixer's
events begin. Found by walking real projects (every channel lines up with what FL reports, in the same order)."""
import glob
import os
import re
import struct

NEW_CHANNEL = 64
CHANNEL_TYPE = 21
CHANNEL_NAME = 203
SAMPLE_PATH = 196
PLUGIN_STATE = 213
FIRST_MIXER_EVENT = 236  # the mixer's inserts: plugins after this are effects on them, not a channel's

PRESET_NAME = re.compile(rb'"presetName"\s*:\s*"([^"]*)"')


def events(raw):
    """(event id, value) for each event in an FLP's bytes."""
    if raw[:4] != b"FLhd":
        raise ValueError("not an FL Studio project")
    p = 8 + struct.unpack("<I", raw[4:8])[0]
    if raw[p:p + 4] != b"FLdt":
        raise ValueError("this FL Studio project has no data")
    p += 8
    end = len(raw)
    while p < end:
        e = raw[p]
        p += 1
        if e < 64:
            v = raw[p]
            p += 1
        elif e < 128:
            v = struct.unpack("<H", raw[p:p + 2])[0]
            p += 2
        elif e < 192:
            v = struct.unpack("<I", raw[p:p + 4])[0]
            p += 4
        else:
            n, shift = 0, 0
            while True:
                b = raw[p]
                p += 1
                n |= (b & 127) << shift
                shift += 7
                if b < 128:
                    break
            v = raw[p:p + n]
            p += n
        yield e, v


def _text(v):
    try:
        return v.decode("utf-16-le").rstrip("\0")
    except UnicodeDecodeError:
        return v.decode("latin1").rstrip("\0")


NOT_SOUNDS = (3, 4, 5)  # layers, audio clips, automation clips


def read_channels(raw):
    """Each channel in rack order: {name, type, preset (a Serum's), sample (the file's name, no folders)}."""
    out, cur = [], None
    for e, v in events(raw):
        if e == NEW_CHANNEL:
            cur = {"name": None, "type": None, "preset": None, "sample": None}
            out.append(cur)
        elif e == FIRST_MIXER_EVENT:
            break
        elif cur is None:
            continue
        elif e == CHANNEL_TYPE and cur["type"] is None:
            cur["type"] = v
        elif e == CHANNEL_NAME and cur["name"] is None:
            cur["name"] = _text(v)
        elif e == SAMPLE_PATH and cur["sample"] is None:
            path = _text(v).replace("\\", "/")
            cur["sample"] = path.rsplit("/", 1)[-1] or None
        elif e == PLUGIN_STATE and cur["preset"] is None and b"XferJson" in v:
            m = PRESET_NAME.search(v)
            if m:
                cur["preset"] = m.group(1).decode("utf8", "replace").strip() or None
    return out


def read_file(path):
    with open(path, "rb") as f:
        return read_channels(f.read())


# Which file is the open project: FL's title has only its name

def _registry_recents():
    """FL's File › Recent list, from the registry: the projects opened from inside FL."""
    try:
        import winreg
    except ImportError:
        return []
    out = []
    try:
        with winreg.OpenKey(winreg.HKEY_CURRENT_USER, r"Software\Image-Line") as root:
            names = []
            i = 0
            while True:
                try:
                    names.append(winreg.EnumKey(root, i))
                except OSError:
                    break
                i += 1
    except OSError:
        return []
    for name in sorted((n for n in names if n.startswith("FL Studio")), reverse=True):
        try:
            with winreg.OpenKey(winreg.HKEY_CURRENT_USER, "Software\\Image-Line\\%s\\MRU" % name) as key:
                i = 0
                while True:
                    try:
                        value = winreg.EnumValue(key, i)[1]
                    except OSError:
                        break
                    if isinstance(value, str):
                        out.append(value)
                    i += 1
        except OSError:
            continue
    return out


def _windows_recents(project):
    """Windows' Recent folder, which also has the projects opened from outside FL: a shortcut holds its target's path."""
    link = os.path.join(os.environ.get("APPDATA", ""), "Microsoft", "Windows", "Recent", project + ".flp.lnk")
    try:
        with open(link, "rb") as f:
            raw = f.read()
    except OSError:
        return []
    found = re.findall(rb"[A-Za-z]:\\[^\x00-\x1f]*?\.flp", raw, re.I)
    found += [m.decode("utf-16-le").encode("utf8") for m in
              re.findall(rb"(?:[A-Za-z]\x00:\x00\\\x00)(?:[^\x00]\x00)*?\.\x00[fF]\x00[lL]\x00[pP]\x00", raw)]
    out = []
    for path in found:
        try:
            out.append(path.decode("utf8"))
        except UnicodeDecodeError:
            out.append(path.decode("latin1"))
    return out


def _usual_places(project):
    home = os.path.expanduser("~")
    return [os.path.join(home, "Music", "Flps", project + ".flp"),
            os.path.join(home, "Documents", "Image-Line", "FL Studio", "Projects", project + ".flp"),
            os.path.join(home, "Documents", "Image-Line", "FL Studio", "Projects", project, project + ".flp")]


def candidates(project):
    """Every file this project's name could be, most likely first."""
    want = project.lower() + ".flp"
    named = [p for p in _registry_recents() if os.path.basename(p).lower() == want]
    seen, out = set(), []
    for p in named + _windows_recents(project) + _usual_places(project):
        key = os.path.normcase(os.path.normpath(p))
        if key not in seen and os.path.isfile(p):
            seen.add(key)
            out.append(p)
    return out


def _autosaves(project):
    """FL's autosaves of this project, which can be newer than the last save."""
    folder = os.path.join(os.path.expanduser("~"), "Documents", "Image-Line", "FL Studio", "Projects", "Backup")
    return glob.glob(os.path.join(glob.escape(folder), glob.escape(project) + " (autosaved at *).flp"))


def newest(project):
    """When any file this project could be was last written (0 for none): cheap enough to ask every few seconds."""
    times = []
    for p in candidates(project) + _autosaves(project):
        try:
            times.append(os.path.getmtime(p))
        except OSError:
            continue
    return max(times, default=0)


def overlap(saved, names):
    """How far this file and FL agree on the project's sounds, 0 to 1: the share of `names` it knows and of its sounds FL
    has, whichever is lower. Sounds only: FL names an unnamed take "Audio Clip" and the file gives it no name, and a song
    can have far more takes than sounds."""
    if not names:
        return 0.0
    known = {c["name"] for c in saved}
    here = set(names)
    theirs = [c["name"] for c in saved if c.get("type") not in NOT_SOUNDS and c["name"]]
    if not theirs:
        return 0.0
    return min(sum(1 for n in names if n in known) / len(names), sum(1 for n in theirs if n in here) / len(theirs))


def find(project, names, minimum=0.6):
    """The newest file for this project whose channels are the ones FL has now: (path, channels), else (None, []).
    The names keep a same-named project in another folder from being taken for it."""
    if not project:
        return None, []
    found = []
    for p in candidates(project) + _autosaves(project):
        try:
            saved = read_file(p)
        except (OSError, ValueError, IndexError, struct.error):
            continue
        if overlap(saved, names) >= minimum:
            found.append((os.path.getmtime(p), p, saved))
    if not found:
        return None, []
    found.sort(key=lambda f: f[0], reverse=True)
    return found[0][1], found[0][2]


def match(names, saved):
    """For each channel name FL has now, what the saved file says about it (None when it doesn't know). Two channels
    can share a name, so same names are paired in rack order."""
    pools = {}
    for c in saved:
        pools.setdefault(c["name"], []).append(c)
    out = []
    for n in names:
        pool = pools.get(n)
        out.append(pool.pop(0) if pool else None)
    return out

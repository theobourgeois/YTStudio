"""Putting the Auto Mix script where FL Studio finds it, and on a MIDI input so FL runs it.

FL runs a controller script only for a MIDI input it's assigned to, and calls it regularly (which is how it hears the
window) only when that input has a port number. FL keeps those settings in the registry and writes them back when it
quits, so they can only be set here while FL is closed; with FL open the window says where to click instead."""
import ctypes
import ctypes.wintypes as wt
import os
import shutil
import winreg

HERE = os.path.dirname(os.path.abspath(__file__))
SCRIPT = os.path.join(HERE, "fl", "device_ytstudio_automix.py")
FOLDER = "YTStudio Auto Mix"
HARDWARE = os.path.join(os.path.expanduser("~"), "Documents", "Image-Line", "FL Studio", "Settings", "Hardware")
DEVICES = r"Software\Image-Line\FL Studio 25\Devices\MIDI input"
SCRIPT_TYPE = -3  # "user script" in FL's Controller type list
PORT = 201


def installed_path():
    return os.path.join(HARDWARE, FOLDER, os.path.basename(SCRIPT))


def script_state():
    """'missing', 'old' or 'current'."""
    p = installed_path()
    if not os.path.exists(p):
        return "missing"
    with open(p, "rb") as a, open(SCRIPT, "rb") as b:
        return "current" if a.read() == b.read() else "old"


def install_script():
    """Copies the script into FL's Hardware folder. FL picks up a changed script when it starts (or on Reload script
    in View › Script output)."""
    if not os.path.isdir(os.path.dirname(HARDWARE)):
        raise RuntimeError("FL Studio's settings folder isn't at %s. Has FL Studio been run on this computer?"
                           % os.path.dirname(HARDWARE))
    os.makedirs(os.path.join(HARDWARE, FOLDER), exist_ok=True)
    shutil.copyfile(SCRIPT, installed_path())
    return installed_path()


def connected_inputs():
    """The MIDI inputs plugged in right now, by the names FL lists them under."""
    winmm = ctypes.windll.winmm

    class Caps(ctypes.Structure):
        _fields_ = [("wMid", wt.WORD), ("wPid", wt.WORD), ("vDriverVersion", wt.UINT),
                    ("szPname", wt.WCHAR * 32), ("dwSupport", wt.DWORD)]

    names = []
    for i in range(winmm.midiInGetNumDevs()):
        c = Caps()
        if winmm.midiInGetDevCapsW(i, ctypes.byref(c), ctypes.sizeof(c)) == 0:
            names.append(c.szPname)
    return names


def fl_inputs():
    """FL's remembered MIDI inputs: {name: {ScriptFolder, Type, Port, Enabled}}."""
    out = {}
    try:
        root = winreg.OpenKey(winreg.HKEY_CURRENT_USER, DEVICES)
    except OSError:
        return out
    with root:
        i = 0
        while True:
            try:
                name = winreg.EnumKey(root, i)
            except OSError:
                break
            i += 1
            vals = {}
            with winreg.OpenKey(root, name) as k:
                for v in ("ScriptFolder", "Type", "Port", "Enabled"):
                    try:
                        vals[v] = winreg.QueryValueEx(k, v)[0]
                    except OSError:
                        vals[v] = None
                    if v != "ScriptFolder":
                        vals[v] = _number(vals[v])
            out[name] = vals
    return out


def _number(v):
    """FL keeps its numbers as strings ("201", "-3"); older entries can be DWORDs (-3 as 4294967293)."""
    if isinstance(v, str):
        try:
            return int(v)
        except ValueError:
            return None
    return v - (1 << 32) if isinstance(v, int) and v >= 1 << 31 else v


def assigned_input():
    """The input FL runs the script for (with a port number, so FL calls it), or None."""
    for name, v in fl_inputs().items():
        if v.get("ScriptFolder") == FOLDER and (v.get("Port") if v.get("Port") is not None else -1) >= 0 and v.get("Enabled"):
            return name
    return None


def candidate_inputs():
    """Inputs the script could go on, best first: plugged in, with no script of their own."""
    fl = fl_inputs()
    live = connected_inputs()
    names = [n for n in fl if n != "(unavailable)"]
    for n in live:
        if n not in names:
            names.append(n)

    def rank(n):
        v = fl.get(n, {})
        return (n not in live, v.get("ScriptFolder") not in ("", None, FOLDER), not v.get("Enabled", 1), n)

    return sorted(names, key=rank), live


def assign(name):
    """Puts the script on input `name`, with a port number no other input uses. Only while FL is closed: FL writes
    its own settings back when it quits."""
    fl = fl_inputs()
    used = {v.get("Port") for n, v in fl.items() if n != name}
    port = PORT
    while port in used:
        port += 1
    with winreg.CreateKey(winreg.HKEY_CURRENT_USER, DEVICES + "\\" + name) as k:
        for v, value in (("ScriptFolder", FOLDER), ("Type", SCRIPT_TYPE), ("Port", port), ("Enabled", 1)):
            winreg.SetValueEx(k, v, 0, winreg.REG_SZ, str(value))  # strings, as FL writes them
    return port


INSTRUCTIONS = (
    "In FL Studio: Options › MIDI settings. Under Input, pick a MIDI device that's plugged in (one you don't use "
    "for a controller script of its own), set its Controller type to \"YTStudio Auto Mix (user)\", make sure it's "
    "enabled, and give it a Port number (any free one, like 201). Then press Connect here.\n\n"
    "With no MIDI device at all, install loopMIDI (free) and use its port.")

"""Installs the built plugins into Common Files\\VST3, each with its worker's Python inside it (Contents/Resources/worker)
and python.txt naming the Python to run it with: this one, which has numpy, scipy and soundfile. Removes what YT-Mix was
before it had that name.

    python plugin/install.py [--dest <VST3 folder>]

FL finds them after Options › Manage plugins › Find installed plugins (or on its next start, if it scans then). While
FL has a plugin loaded its DLL can't be replaced: the Python beside it can, and the next window opened uses it."""
import argparse
import os
import shutil
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
AUTOMIX = os.path.dirname(HERE)
OLD_NAME = "YTStudio Auto Mix.vst3"
BOTH = ["worker_base.py", "link.py", "flsetup.py", os.path.join("fl", "device_ytstudio_automix.py")]
PLUGINS = {
    "YT-Mix": ("YTMix", ["worker.py", "analysis.py", "render.py", "fader_curve.json",
                         os.path.join("train", "learn.py")] + BOTH),
    "YT-Fill": ("YTFill", ["fill_worker.py", "fillinserts.py", "flpread.py"] + BOTH),
}


def pythonw():
    """The windowless twin of this Python (a console one would open a console window from inside FL)."""
    exe = sys.executable
    w = os.path.join(os.path.dirname(exe), "pythonw.exe")
    return w if os.path.exists(w) else exe


def install(name, target, files, folder):
    built = os.path.join(HERE, "build", "%s_artefacts" % target, "Release", "VST3", name + ".vst3")
    if not os.path.isdir(built):
        sys.exit("Build the plugin first (plugin/build.ps1): no %s" % built)
    dest = os.path.join(folder, name + ".vst3")
    os.makedirs(dest, exist_ok=True)
    try:
        shutil.copytree(built, dest, dirs_exist_ok=True)
    except shutil.Error as e:
        if not any("x86_64-win" in str(x) for x in e.args[0]):
            raise
        print("%s is loaded in FL, so its DLL stays as it is (close FL and install again to replace it)." % name)
    res = os.path.join(dest, "Contents", "Resources", "worker")
    shutil.rmtree(os.path.join(dest, "Contents", "Resources", "automix"), ignore_errors=True)
    for f in files:
        os.makedirs(os.path.dirname(os.path.join(res, f)), exist_ok=True)
        shutil.copy2(os.path.join(AUTOMIX, f), os.path.join(res, f))
    with open(os.path.join(res, "python.txt"), "w", encoding="utf8") as f:
        f.write(pythonw())
    print("Installed: %s (Python: %s)" % (dest, pythonw()))


def remove_old(folder):
    """The plugin under its old name. Only once its DLL is free: half of it gone would leave a loaded plugin broken."""
    old = os.path.join(folder, OLD_NAME)
    if not os.path.isdir(old):
        return
    try:
        with open(os.path.join(old, "Contents", "x86_64-win", OLD_NAME), "r+b"):
            pass
    except FileNotFoundError:
        pass
    except OSError:
        print("%s is loaded in FL, so it stays for now (close FL and install again to remove it)." % OLD_NAME)
        return
    shutil.rmtree(old)
    print("Removed: %s" % old)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--dest", default=os.path.join(os.environ.get("CommonProgramFiles", r"C:\Program Files\Common Files"),
                                                   "VST3"))
    args = ap.parse_args()
    for m in ("numpy", "scipy", "soundfile"):
        __import__(m)  # YT-Mix's worker needs them: fail here, not in FL
    for name, (target, files) in PLUGINS.items():
        install(name, target, files, args.dest)
    remove_old(args.dest)


if __name__ == "__main__":
    main()

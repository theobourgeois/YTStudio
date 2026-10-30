"""Opens projects in a running FL Studio and deals with what it asks on the way, for the batch renderer.

FL is one instance: FL64.exe "<file.flp>" hands the file to the running FL, which asks to save the open project first
when it has changes ("No": the batch never writes into anyone's project) and may say what it couldn't find (plugins,
samples) once the new one is in. Every dialog is a window of FL's process; its buttons are child windows with text.
"""
import ctypes
import ctypes.wintypes as wt
import os
import subprocess
import time

import render  # noqa: F401  (its user32 prototypes)
from render import _u, _windows, _class

FL_EXE = r"C:\Program Files\Image-Line\FL Studio 2025\FL64.exe"
BM_CLICK = 0x00F5
WM_CLOSE = 0x0010
MAIN = "TFruityLoopsMainForm"
QUIET = {MAIN, "TApplication"}  # FL's own windows that are always there
BOXES = ("TMsgForm", "#32770", "TMissingPluginsForm")  # what FL asks or reports, which holds up the next project


def _text(h):
    n = _u.GetWindowTextLengthW(h)
    buf = ctypes.create_unicode_buffer(n + 1)
    _u.GetWindowTextW(h, buf, n + 1)
    return buf.value


def children(h):
    """[(hwnd, class, text)] of every control in a window."""
    found = []

    @ctypes.WINFUNCTYPE(wt.BOOL, wt.HWND, wt.LPARAM)
    def each(c, _):
        found.append((c, _class(c), _text(c)))
        return True

    _u.EnumChildWindows(h, each, 0)
    return found


def dialogs(pid):
    """FL's windows other than the main one: (hwnd, class, title, [control texts])."""
    return [(h, c, t, [x[2] for x in children(h) if x[2]]) for h, c, t in _windows(pid) if c not in QUIET]


def click(h, *labels):
    """Presses the first button in window h whose text (without &) is one of labels. True if it found one."""
    want = [lab.lower() for lab in labels]
    for c, cls, text in children(h):
        if "button" in cls.lower() and text.replace("&", "").strip().lower() in want:
            _u.SendMessageW(c, BM_CLICK, 0, 0)
            return True
    return False


class RECT(ctypes.Structure):
    _fields_ = [("left", ctypes.c_long), ("top", ctypes.c_long), ("right", ctypes.c_long), ("bottom", ctypes.c_long)]


def buttons(h):
    """An FL message box's buttons (TQuickFocusBtn: drawn by FL, no text), left to right."""
    out = []
    for c, cls, _ in children(h):
        if cls == "TQuickFocusBtn" and _u.IsWindowVisible(c):
            r = RECT()
            _u.GetWindowRect(c, ctypes.byref(r))
            out.append((r.left, c, r.right - r.left, r.bottom - r.top))
    return [(c, w, hh) for _, c, w, hh in sorted(out)]


def press(button):
    """Clicks one of FL's drawn buttons with mouse messages (they don't take BM_CLICK)."""
    c, w, h = button
    at = (h // 2) << 16 | (w // 2)
    _u.PostMessageW(c, 0x0201, 1, at)  # WM_LBUTTONDOWN, MK_LBUTTON
    _u.PostMessageW(c, 0x0202, 0, at)  # WM_LBUTTONUP


def answer(h, cls, title, log=print):
    """Answers an FL message box: its save question (Confirm: Yes, No, Cancel) with No, one with a single button
    with it, anything else with its last (Cancel or Close). A Windows dialog gets OK, Close or Cancel."""
    if cls == "TMissingPluginsForm":  # "Problems loading the project": a report, closing it loses nothing
        _u.PostMessageW(h, WM_CLOSE, 0, 0)
    elif cls == "TMsgForm":
        b = buttons(h)
        if title.strip().lower() == "confirm" and len(b) == 3:
            press(b[1])
        elif b:
            press(b[0] if len(b) == 1 else b[-1])
        else:
            _u.PostMessageW(h, WM_CLOSE, 0, 0)
    elif not click(h, "OK", "Close", "Ignore", "Skip", "Continue", "No", "Cancel"):
        _u.PostMessageW(h, WM_CLOSE, 0, 0)


def main_title(pid):
    w = next((w for w in _windows(pid) if w[1] == MAIN), None)
    return w[2] if w else None


def exe_of(pid):
    out = subprocess.run(["powershell", "-NoProfile", "-Command", "(Get-Process -Id %d).Path" % pid],
                         capture_output=True, text=True, creationflags=subprocess.CREATE_NO_WINDOW).stdout.strip()
    return out or FL_EXE


def open_project(pid, path, log=print, timeout=180):
    """Opens path in FL process pid, saying No to saving the project before it and closing what FL reports after.
    Returns the dialogs it closed (their text, for the log). Raises TimeoutError if FL didn't get there."""
    name = os.path.basename(path)
    exe = exe_of(pid)
    subprocess.Popen([exe, path], creationflags=subprocess.CREATE_NO_WINDOW)
    now = time.monotonic()
    deadline = now + timeout
    seen, loaded_at = [], None
    first = {}  # dialog -> when it appeared: FL's buttons take clicks only once the box is drawn
    answered = {}
    quiet_since, tries = now, 1
    while time.monotonic() < deadline:
        time.sleep(0.3)
        now = time.monotonic()
        title = main_title(pid)
        if title is None:
            raise RuntimeError("FL Studio closed")
        boxes = [d for d in dialogs(pid) if d[1] in BOXES]
        if boxes:
            quiet_since = now
        for h, cls, t, texts in boxes:
            blob = " | ".join([t] + texts)
            if blob not in seen:
                seen.append(blob)
                log("  FL: [%s] %s" % (cls, blob[:300]))
            first.setdefault(h, now)
            if now - first[h] > 0.8 and now - answered.get(h, -9) > 2.5:
                answered[h] = now
                answer(h, cls, t, log)
        if title.split(" - FL Studio")[0].strip().lower() == name.lower():
            loaded_at = loaded_at or time.monotonic()
            # FL puts its "couldn't find" lists up a moment after the title changes: wait for quiet
            if time.monotonic() - loaded_at > 4 and not [d for d in dialogs(pid) if d[1] in BOXES]:
                return seen
        elif now - quiet_since > 45 and tries < 3:
            # FL let the request go (a box answered wrongly, or busy): ask again
            tries += 1
            quiet_since = now
            log("  FL is still on %s: opening %s again" % (title, name))
            subprocess.Popen([exe, path], creationflags=subprocess.CREATE_NO_WINDOW)
    raise TimeoutError("FL didn't open %s in %ds (title: %s)" % (name, timeout, main_title(pid)))


if __name__ == "__main__":
    import sys
    import link
    pid = link.fl_processes()[0][0]
    if len(sys.argv) > 1:
        print(open_project(pid, sys.argv[1]))
    else:
        print(main_title(pid))
        for d in dialogs(pid):
            print(d)

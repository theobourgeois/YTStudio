"""Renders the open FL Studio project's split mixer stems, by driving FL's own export: FL has no way to render from a
script, and its command line renders only the whole mix. So, like a person would: Ctrl+R in FL, the path in the Save
As dialog, Enter in the render window (FL remembers "Split mixer tracks" and the bit depth from the last export), then
wait for the window to go. FL's title says how far it is ("Rendering: 6/89").

The keys need FL in front for a moment: the Save As dialog is filled in with window messages, not keys."""
import ctypes
import ctypes.wintypes as wt
import os
import re
import shutil
import time

import soundfile as sf

STEMS = os.path.join(os.path.expanduser("~"), "Documents", "YTStudio Auto Mix", "Stems")
PREFIX = "mix"  # the file name typed into Save As: FL names the stems "mix_<insert>.wav"

_u = ctypes.windll.user32
_u.SendMessageW.argtypes = [wt.HWND, wt.UINT, wt.WPARAM, wt.LPARAM]
_u.SendMessageW.restype = ctypes.c_ssize_t
_u.FindWindowExW.argtypes = [wt.HWND, wt.HWND, wt.LPCWSTR, wt.LPCWSTR]
_u.FindWindowExW.restype = wt.HWND
_u.GetDlgItem.argtypes = [wt.HWND, ctypes.c_int]
_u.GetDlgItem.restype = wt.HWND
_u.GetParent.argtypes = [wt.HWND]
_u.GetParent.restype = wt.HWND

WM_SETTEXT, WM_COMMAND, BM_CLICK = 0x000C, 0x0111, 0x00F5
VK_CONTROL, VK_MENU, VK_RETURN, VK_R = 0x11, 0x12, 0x0D, 0x52
KEYUP = 0x2
SW_RESTORE = 9


class RenderError(Exception):
    pass


def _windows(pid):
    """FL's visible top-level windows: [(hwnd, class, title)]."""
    found = []

    @ctypes.WINFUNCTYPE(wt.BOOL, wt.HWND, wt.LPARAM)
    def each(h, _):
        p = wt.DWORD()
        _u.GetWindowThreadProcessId(h, ctypes.byref(p))
        if p.value == pid and _u.IsWindowVisible(h):
            c = ctypes.create_unicode_buffer(256)
            _u.GetClassNameW(h, c, 256)
            t = ctypes.create_unicode_buffer(512)
            _u.GetWindowTextW(h, t, 512)
            found.append((h, c.value, t.value))
        return True

    _u.EnumWindows(each, 0)
    return found


def _find(pid, cls):
    return next((w for w in _windows(pid) if w[1] == cls), None)


def _wait_for(pid, cls, timeout):
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        w = _find(pid, cls)
        if w:
            return w
        time.sleep(0.05)
    return None


def _front(hwnd):
    """Puts FL in front. Windows lets a program take the focus only just after a key press, hence the Alt."""
    if _u.IsIconic(hwnd):
        _u.ShowWindow(hwnd, SW_RESTORE)
    if _u.GetForegroundWindow() == hwnd:
        return  # an Alt tap now would open FL's menu (the plugin puts FL in front before the worker starts)
    for _ in range(20):
        _u.keybd_event(VK_MENU, 0, 0, 0)
        _u.keybd_event(VK_MENU, 0, KEYUP, 0)
        _u.SetForegroundWindow(hwnd)
        time.sleep(0.05)
        if _u.GetForegroundWindow() == hwnd:
            return
    raise RenderError("Couldn't bring FL Studio to the front to start the export.")


def _keys(*vks):
    for vk in vks:
        _u.keybd_event(vk, 0, 0, 0)
    for vk in reversed(vks):
        _u.keybd_event(vk, 0, KEYUP, 0)


def _class(h):
    c = ctypes.create_unicode_buffer(256)
    _u.GetClassNameW(h, c, 256)
    return c.value


def _file_name_box(dlg):
    """The Save As dialog's file name box: the Edit in a ComboBox that isn't the address bar's (a ComboBoxEx32)."""
    found = []

    @ctypes.WINFUNCTYPE(wt.BOOL, wt.HWND, wt.LPARAM)
    def each(h, _):
        if _class(h) == "Edit":
            combo = _u.GetParent(h)
            if combo and _class(combo) == "ComboBox" and _class(_u.GetParent(combo)) != "ComboBoxEx32":
                found.append(h)
        return True

    _u.EnumChildWindows(dlg, each, 0)
    return found[0] if found else None


def _fill_save_as(dlg, path):
    """Types the path into the Save As dialog's file name box and presses Save, by window messages."""
    edit = _file_name_box(dlg)
    if not edit:
        return False
    buf = ctypes.create_unicode_buffer(path)
    _u.SendMessageW(edit, WM_SETTEXT, 0, ctypes.addressof(buf))
    save = _u.GetDlgItem(dlg, 1)
    if save:
        _u.SendMessageW(save, BM_CLICK, 0, 0)
    else:
        _u.SendMessageW(dlg, WM_COMMAND, 1, 0)
    return True


def _progress(title):
    m = re.match(r"Rendering:\s*(\d+)\s*/\s*(\d+)", title)
    return (int(m.group(1)), int(m.group(2))) if m else None


def _empty(folder):
    if os.path.isdir(folder):
        shutil.rmtree(folder, ignore_errors=True)
    os.makedirs(folder, exist_ok=True)


def render_stems(pid, folder=STEMS, progress=None, log=None):
    """Exports the project in FL process `pid` as split mixer stems into `folder` (emptied first). Returns the folder
    and the file prefix. Raises RenderError with what to do when it can't."""
    progress = progress or (lambda f: None)
    main = _find(pid, "TFruityLoopsMainForm")
    if not main:
        raise RenderError("Couldn't find FL Studio's window.")
    for cls in ("TWAVRenderForm", "#32770"):
        if _find(pid, cls):
            raise RenderError("FL Studio has a dialog open: close it, then press Auto Mix again.")
    _empty(folder)
    path = os.path.join(folder, PREFIX + ".wav")

    _front(main[0])
    _keys(VK_CONTROL, VK_R)  # File › Export › WAV file
    dlg = _wait_for(pid, "#32770", 8)
    if not dlg:
        raise RenderError("FL Studio didn't open its export (Ctrl+R). Click in FL, then press Auto Mix again.")
    if not _fill_save_as(dlg[0], path):
        raise RenderError("Couldn't fill in FL's Save As dialog: export the stems yourself and use the folder.")
    form = _wait_for(pid, "TWAVRenderForm", 8)
    if not form:
        if _find(pid, "#32770"):
            raise RenderError("FL's Save As dialog is still open (a file already there?): close it and try again.")
        raise RenderError("FL Studio didn't show its render window.")

    _front(form[0])
    _keys(VK_RETURN)  # Start
    if log:
        log("FL is rendering the stems…")
    started = time.monotonic()
    last = None
    while True:
        time.sleep(0.2)
        main_now = next((w for w in _windows(pid) if w[0] == main[0]), None)
        if main_now is None:
            raise RenderError("FL Studio closed while rendering.")
        p = _progress(main_now[2])
        if p:
            last = p
            progress(min(p[0] / max(p[1], 1), 1.0))
        if not _find(pid, "TWAVRenderForm"):
            break
        if last is None and time.monotonic() - started > 15:
            raise RenderError("FL's render window is open but it didn't start: press Start in it, or close it and "
                              "press Auto Mix again.")
    if last and last[0] < last[1] - 1:
        raise RenderError("The render was stopped before the end.")
    return check(folder)


def check(folder):
    """Says what's wrong with a render that isn't usable stems: one file (no split) or fixed-point files (they clip)."""
    files = [f for f in os.listdir(folder) if f.lower().endswith(".wav")]
    if not files:
        raise RenderError("FL didn't write any stems.")
    if len(files) == 1:
        raise RenderError("FL rendered the whole mix, not each insert. In FL's export window (Ctrl+R) tick "
                          "\"Split mixer tracks\", close it, and press Auto Mix again: FL remembers it.")
    subtype = sf.info(os.path.join(folder, files[0])).subtype
    if subtype not in ("FLOAT", "DOUBLE"):
        bits = subtype.replace("PCM_", "") + "-bit"
        raise RenderError("FL rendered %s stems, which clip loud inserts. In FL's export window (Ctrl+R) set WAV bit "
                          "depth to \"32Bit float\", close it, and press Auto Mix again: FL remembers it." % bits)
    return folder, PREFIX


def clear(folder=STEMS):
    shutil.rmtree(folder, ignore_errors=True)


if __name__ == "__main__":
    import sys
    t = time.monotonic()
    print(render_stems(int(sys.argv[1]), progress=lambda f: print("\r%3d%%" % (f * 100), end=""), log=print))
    print("\n%.1f s" % (time.monotonic() - t))

# Lists a process's top-level windows (class, title, size), for finding FL's dialogs.
import ctypes, sys
from ctypes import wintypes as W
u = ctypes.windll.user32
pid = int(sys.argv[1])
out = []
@ctypes.WINFUNCTYPE(W.BOOL, W.HWND, W.LPARAM)
def cb(h, _):
    p = W.DWORD(); u.GetWindowThreadProcessId(h, ctypes.byref(p))
    if p.value == pid and u.IsWindowVisible(h):
        t = ctypes.create_unicode_buffer(256); u.GetWindowTextW(h, t, 256)
        c = ctypes.create_unicode_buffer(256); u.GetClassNameW(h, c, 256)
        r = W.RECT(); u.GetWindowRect(h, ctypes.byref(r))
        out.append((h, c.value, t.value, r.right - r.left, r.bottom - r.top, u.GetWindow(h, 4)))
    return True
u.EnumWindows(cb, 0)
for o in out: print(o)
print("fg", u.GetForegroundWindow())

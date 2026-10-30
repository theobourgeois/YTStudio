# Prints a window's child controls (class, id, text), for finding the Save As dialog's file name box.
import ctypes, sys
from ctypes import wintypes as W
u = ctypes.windll.user32
sys.path.insert(0, ".")
import render
dlg = render._find(int(sys.argv[1]), "#32770")
print(dlg)
@ctypes.WINFUNCTYPE(W.BOOL, W.HWND, W.LPARAM)
def cb(h, _):
    c = ctypes.create_unicode_buffer(256); u.GetClassNameW(h, c, 256)
    t = ctypes.create_unicode_buffer(256); u.GetWindowTextW(h, t, 256)
    par = u.GetParent(h)
    print(h, par, c.value, u.GetDlgCtrlID(h), repr(t.value[:40]))
    return True
u.EnumChildWindows(dlg[0], cb, 0)

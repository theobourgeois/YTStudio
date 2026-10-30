"""Talks to the YT script inside FL Studio (fl/device_ytstudio_automix.py).

FL's scripts can't open files, sockets or pipes, so this side does it for them: it makes a named pipe, opens its
client end, copies that handle into FL's process (DuplicateHandle) and names it in Documents/YTStudio Auto Mix as
"<FL's pid>-<handle>-<nonce>.link". The script, which lists that folder, then reads and writes the handle: lines of JSON."""
import ctypes
import ctypes.wintypes as wt
import itertools
import json
import os
import subprocess
import time
import uuid

import _winapi

EXCHANGE = os.path.join(os.path.expanduser("~"), "Documents", "YTStudio Auto Mix")
PROCESS_DUP_HANDLE = 0x0040
DUPLICATE_CLOSE_SOURCE = 0x1
STALE_S = 60.0  # far longer than any wait for the script to pick a link up

_user32 = ctypes.windll.user32


class NotConnected(Exception):
    pass


def fl_processes():
    """FL Studio's running processes as (pid, main window title), the one with a window first."""
    out = subprocess.run(["tasklist", "/FO", "CSV", "/NH"], capture_output=True, text=True,
                         creationflags=subprocess.CREATE_NO_WINDOW).stdout
    pids = []
    for line in out.splitlines():
        parts = [p.strip('"') for p in line.split('","')]
        if len(parts) > 1 and parts[0].lower() in ("fl64.exe", "fl.exe"):
            pids.append(int(parts[1]))
    titles = _window_titles()
    return sorted(((p, titles.get(p, "")) for p in pids), key=lambda pt: not pt[1])


def _window_titles():
    titles = {}

    @ctypes.WINFUNCTYPE(wt.BOOL, wt.HWND, wt.LPARAM)
    def each(hwnd, _):
        if _user32.IsWindowVisible(hwnd):
            pid = wt.DWORD()
            _user32.GetWindowThreadProcessId(hwnd, ctypes.byref(pid))
            n = _user32.GetWindowTextLengthW(hwnd)
            if n:
                buf = ctypes.create_unicode_buffer(n + 1)
                _user32.GetWindowTextW(hwnd, buf, n + 1)
                if "FL Studio" in buf.value and pid.value not in titles:
                    titles[pid.value] = buf.value
        return True

    _user32.EnumWindows(each, 0)
    return titles


def project_name(title):
    """'song.flp - FL Studio 2025' -> 'song' (None for an unsaved project)."""
    head = title.split(" - FL Studio")[0].strip()
    return head[:-4] if head.lower().endswith(".flp") else None


class Link:
    """One connection to the script in one FL process."""

    def __init__(self, pid, title=""):
        self.pid, self.title = pid, title
        self._ids = itertools.count(1)
        self._buf = b""
        self._server = self._fl = self._theirs = None
        self._link_file = None

    def open(self, timeout=3.0):
        os.makedirs(EXCHANGE, exist_ok=True)
        for f in os.listdir(EXCHANGE):  # links left by a window that crashed, not one another plugin has just left
            if f.endswith(".link"):
                try:
                    path = os.path.join(EXCHANGE, f)
                    if time.time() - os.path.getmtime(path) > STALE_S:
                        os.remove(path)
                except OSError:
                    pass
        name = r"\\.\pipe\ytstudio-automix-" + uuid.uuid4().hex
        self._server = _winapi.CreateNamedPipe(name, _winapi.PIPE_ACCESS_DUPLEX, _winapi.PIPE_WAIT, 1,
                                               1 << 20, 1 << 20, 0, _winapi.NULL)
        client = _winapi.CreateFile(name, _winapi.GENERIC_READ | _winapi.GENERIC_WRITE, 0, _winapi.NULL,
                                    _winapi.OPEN_EXISTING, 0, _winapi.NULL)
        try:
            self._fl = _winapi.OpenProcess(PROCESS_DUP_HANDLE, False, self.pid)
            self._theirs = _winapi.DuplicateHandle(_winapi.GetCurrentProcess(), client, self._fl, 0, False,
                                                   _winapi.DUPLICATE_SAME_ACCESS)
        finally:
            _winapi.CloseHandle(client)
        # FL reuses handle numbers, and the script skips links it has tried: the nonce makes each one new.
        self._link_file = os.path.join(EXCHANGE, "%d-%d-%s.link" % (self.pid, self._theirs, uuid.uuid4().hex[:8]))
        open(self._link_file, "w").close()
        try:
            self.hello = self.call("ping", timeout=timeout)
        except NotConnected:
            self.close()
            raise
        return self

    def close(self):
        if self._link_file:
            try:
                os.remove(self._link_file)
            except OSError:
                pass
            self._link_file = None
        if self._fl is not None:
            # Our end goes first, so a script holding its end sees the pipe break and closes it; a copy the script
            # never picked up we close in FL ourselves.
            try:
                _winapi.CloseHandle(self._server)
            except OSError:
                pass
            if self._theirs is not None and not getattr(self, "hello", None):
                try:
                    _winapi.DuplicateHandle(self._fl, self._theirs, 0, 0, False, DUPLICATE_CLOSE_SOURCE)
                except OSError:
                    pass
            _winapi.CloseHandle(self._fl)
            self._fl = self._theirs = self._server = None

    def call(self, cmd, timeout=10.0, **args):
        if self._server is None:
            raise NotConnected("not connected")
        rid = next(self._ids)
        try:
            _winapi.WriteFile(self._server, (json.dumps({"id": rid, "cmd": cmd, **args}) + "\n").encode())
        except OSError as e:
            raise NotConnected("FL Studio closed the connection (%s)" % e)
        deadline = time.monotonic() + timeout
        while time.monotonic() < deadline:
            while b"\n" in self._buf:
                line, self._buf = self._buf.split(b"\n", 1)
                reply = json.loads(line)
                if reply.get("id") == rid:
                    if not reply.get("ok"):
                        raise RuntimeError(reply.get("error") or "FL said no")
                    return reply["result"]
            try:
                n = _winapi.PeekNamedPipe(self._server, 0)[0]
                if n:
                    self._buf += _winapi.ReadFile(self._server, n)[0]
                    continue
            except OSError as e:
                raise NotConnected("FL Studio closed the connection (%s)" % e)
            time.sleep(0.02)
        raise NotConnected(
            "FL Studio didn't answer. Is the \"YTStudio Auto Mix\" script on a MIDI input with a port number "
            "(Options › MIDI settings)?")


def connect(timeout=3.0):
    """A Link to the first running FL Studio whose script answers."""
    procs = fl_processes()
    if not procs:
        raise NotConnected("FL Studio isn't running.")
    last = None
    for pid, title in procs:
        try:
            return Link(pid, title).open(timeout)
        except (NotConnected, OSError) as e:
            last = e
    raise NotConnected(str(last))


if __name__ == "__main__":
    import sys
    link = connect()
    print("connected to", link.pid, link.title, link.hello)
    print(json.dumps(link.call(sys.argv[1] if len(sys.argv) > 1 else "ping"), indent=1))
    link.close()

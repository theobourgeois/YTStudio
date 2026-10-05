"""Serve a local audition folder with byte ranges for reliable browser seeking."""
import argparse
import re
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path


class AudioHandler(SimpleHTTPRequestHandler):
    def send_head(self):
        self.remaining = None
        file = Path(self.translate_path(self.path))
        if not file.is_file():
            return super().send_head()
        handle = file.open("rb")
        size = file.stat().st_size
        start, end, status = 0, size - 1, 200
        value = self.headers.get("Range")
        if value:
            match = re.fullmatch(r"bytes=(\d*)-(\d*)", value)
            if not match or not any(match.groups()):
                handle.close()
                self.send_error(416, "Unsupported byte range")
                return None
            lo, hi = match.groups()
            if lo:
                start = int(lo)
                end = min(int(hi), end) if hi else end
            else:
                start = max(0, size - int(hi))
            if start > end or start >= size:
                handle.close()
                self.send_response(416)
                self.send_header("Content-Range", f"bytes */{size}")
                self.send_header("Content-Length", "0")
                self.end_headers()
                return None
            status = 206
        self.remaining = end - start + 1
        self.send_response(status)
        self.send_header("Content-Type", self.guess_type(str(file)))
        self.send_header("Accept-Ranges", "bytes")
        self.send_header("Content-Length", str(self.remaining))
        if status == 206:
            self.send_header("Content-Range", f"bytes {start}-{end}/{size}")
        self.end_headers()
        handle.seek(start)
        return handle

    def copyfile(self, source, output):
        if self.remaining is None:
            return super().copyfile(source, output)
        try:
            while self.remaining > 0:
                chunk = source.read(min(self.remaining, 65536))
                if not chunk:
                    break
                output.write(chunk)
                self.remaining -= len(chunk)
        except (BrokenPipeError, ConnectionResetError):
            pass  # Browsers cancel old audio requests when switching treatments.


if __name__ == "__main__":
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("folder", type=Path)
    ap.add_argument("--port", type=int, default=0)
    args = ap.parse_args()
    folder = args.folder.resolve(strict=True)
    server = ThreadingHTTPServer(("127.0.0.1", args.port),
                                 lambda *a, **kw: AudioHandler(*a, directory=str(folder), **kw))
    print(f"http://127.0.0.1:{server.server_port}/listen.html", flush=True)
    server.serve_forever()

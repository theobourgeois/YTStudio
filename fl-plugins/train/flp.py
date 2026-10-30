"""Reads what the trainer needs from an FL Studio project without FL: its channels' names and sample files, and its
mixer inserts' names. The format, as PyFLP reads it: an "FLhd" chunk, then "FLdt" holding a stream of events. An
event's id says its size: < 64 one byte, < 128 two, < 192 four, else a varint length and that many bytes.

    python flp.py <file.flp>   prints what it reads
"""
import re
import sys

CHANNEL = 64       # a new channel (u16)
SAMPLE = 196       # its sample's path
NAME = 203         # a channel's (or, after the mixer starts, an effect's) name
INSERT_NAME = 204  # an insert's name
MIXER = {149, 236}  # the mixer's events begin
TEMPO = 156

VOCAL = re.compile(r"vox|vocal|\bvoc\b|voice|adlib|ad lib|verse|hook|chorus|\bbgv|harmony|\bdbl\b|record|"
                   r"\btake\s*\d|acapella|acapela|\blead\b", re.I)


def _text(b):
    if len(b) >= 2 and b[1:2] == b"\0":
        return b.decode("utf-16-le", "replace").rstrip("\0")
    return b.decode("latin-1", "replace").rstrip("\0")


def events(buf):
    if buf[:4] != b"FLhd":
        raise ValueError("not an FL Studio project")
    at = 8 + int.from_bytes(buf[4:8], "little")
    if buf[at:at + 4] != b"FLdt":
        raise ValueError("no FLdt chunk")
    end = min(len(buf), at + 8 + int.from_bytes(buf[at + 4:at + 8], "little"))
    at += 8
    while at < end:
        eid = buf[at]
        at += 1
        if eid < 64:
            yield eid, buf[at]
            at += 1
        elif eid < 128:
            yield eid, int.from_bytes(buf[at:at + 2], "little")
            at += 2
        elif eid < 192:
            yield eid, int.from_bytes(buf[at:at + 4], "little")
            at += 4
        else:
            n, shift = 0, 0
            while at < end:
                b = buf[at]
                at += 1
                n |= (b & 0x7F) << shift
                shift += 7
                if b < 0x80:
                    break
            yield eid, buf[at:at + n]
            at += n


def read(path):
    with open(path, "rb") as f:
        buf = f.read()
    channels, inserts, tempo = [], [], None
    mixer = False
    for eid, v in events(buf):
        if eid in MIXER:
            mixer = True
        elif eid == CHANNEL and not mixer:
            channels.append({"name": "", "sample": ""})
        elif eid == NAME and channels and not mixer:
            channels[-1]["name"] = _text(v)
        elif eid == SAMPLE and channels:
            channels[-1]["sample"] = _text(v)
        elif eid == INSERT_NAME:
            inserts.append(_text(v))
        elif eid == TEMPO:
            tempo = v / 1000
    return {"channels": channels, "inserts": [i for i in inserts if i], "tempo": tempo}


def vocal_evidence(info):
    """The names and sample files that look like vocals: an export with vocals has recorded audio in it."""
    hits = []
    for c in info["channels"]:
        s = c["sample"].replace("\\", "/")
        base = s.rsplit("/", 1)[-1]
        if VOCAL.search(c["name"]) or VOCAL.search(base) or re.search(r"/(recorded|vocals?|vox)/", s, re.I):
            hits.append(c["name"] or base)
    hits += [i for i in info["inserts"] if VOCAL.search(i)]
    return hits


if __name__ == "__main__":
    info = read(sys.argv[1])
    print("tempo", info["tempo"])
    for c in info["channels"]:
        print("  ch  %-30s %s" % (c["name"], c["sample"]))
    for i in info["inserts"]:
        print("  ins", i)
    print("vocal:", vocal_evidence(info))

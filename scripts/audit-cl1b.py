#!/usr/bin/env python3
"""Static, restricted audit of the CL 1B optical-compressor dataset archive (Zenodo 6497085).

The archive's four members are Python pickles. A pickle is a program, so this tool NEVER
calls pickle.load / numpy.load(allow_pickle=True) / anything that can run archive code.
Instead it reads the opcode stream itself and builds only inert, symbolic stand-ins:

  * Only the opcodes in OPCODES are understood; any other opcode (INST, OBJ, NEWOBJ, EXT*,
    PERSID, BYTEARRAY8, ...) stops the audit with `Refused`.
  * Only the globals in ALLOWED_GLOBALS can be named (numpy's array/dtype/scalar
    reconstruction helpers, builtins list/tuple/dict, ...). Anything else (os.system,
    builtins.eval/exec, subprocess.*, ...) stops the audit with `Refused` the moment it is
    named, before any REDUCE.
  * REDUCE on an allowed global is *interpreted by this file* (an ndarray stub, a dtype
    stub, a decoded float scalar); nothing is ever called.
  * dtypes are limited to plain bool/int/float kinds: object/structured arrays (whose data
    would itself be pickled) are refused.
  * Reads are bounded: each member has a decompressed-byte budget, big array payloads are
    streamed in chunks (hashed, summarised with numpy.frombuffer: no unpickling) and the
    parse stops cleanly when the budget is used up.
  * Members are streamed with zipfile; nothing is extracted to disk or copied.

Usage:
  python3 scripts/audit-cl1b.py /path/to/Dataset.zip [--out PATH] [--budget-mib NAME=MIB ...]

Prints the report as JSON and writes it to --out (default
./data/research-datasets/cl1b/layout-audit.json). numpy is optional: without it the layout
is still audited but array statistics and the input/output alignment analysis are skipped.
This audits layout and labels only. It converts nothing into a corpus.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import math
import os
import re
import struct
import sys
import zipfile
from typing import Any, BinaryIO, Dict, List, Optional, Tuple

try:  # numpy is used only for bounded numeric summaries (frombuffer, fft): never to unpickle.
    import numpy as np
except Exception:  # pragma: no cover
    np = None

EXPECTED_MEMBERS = (
    "data_train.pickle",
    "data_test.pickle",
    "metadatas_train.pickle",
    "metadatas_test.pickle",
)
MIB = 1 << 20
DEFAULT_BUDGET_MIB = {
    "data_test.pickle": 240,  # the whole member is 236.5 MiB
    "data_train.pickle": 160,  # first array whole (118.3 MiB) + the start of the second
    "metadatas_test.pickle": 1,
    "metadatas_train.pickle": 1,
}

# --- the allow-lists ---------------------------------------------------------------------

NUMPY_MODULES = ("numpy.core.multiarray", "numpy._core.multiarray")
ALLOWED_GLOBALS = {
    **{(m, "_reconstruct"): "ndarray_reconstruct" for m in NUMPY_MODULES},
    **{(m, "scalar"): "numpy_scalar" for m in NUMPY_MODULES},
    ("numpy", "ndarray"): "ndarray_class",
    ("numpy", "dtype"): "dtype",
    ("builtins", "list"): "list",
    ("builtins", "tuple"): "tuple",
    ("builtins", "dict"): "dict",
}
# opcode byte -> name. Everything not listed here is refused.
OPCODES = {
    b"\x80": "PROTO", b"\x95": "FRAME", b".": "STOP", b"(": "MARK",
    b"}": "EMPTY_DICT", b"]": "EMPTY_LIST", b")": "EMPTY_TUPLE", b"\x94": "MEMOIZE",
    b"\x8c": "SHORT_BINUNICODE", b"X": "BINUNICODE", b"\x93": "STACK_GLOBAL", b"c": "GLOBAL",
    b"J": "BININT", b"K": "BININT1", b"M": "BININT2", b"\x8a": "LONG1", b"G": "BINFLOAT",
    b"\x88": "NEWTRUE", b"\x89": "NEWFALSE", b"N": "NONE",
    b"t": "TUPLE", b"\x85": "TUPLE1", b"\x86": "TUPLE2", b"\x87": "TUPLE3", b"l": "LIST",
    b"R": "REDUCE", b"b": "BUILD", b"h": "BINGET", b"j": "LONG_BINGET",
    b"q": "BINPUT", b"r": "LONG_BINPUT", b"a": "APPEND", b"e": "APPENDS",
    b"s": "SETITEM", b"u": "SETITEMS", b"C": "SHORT_BINBYTES", b"B": "BINBYTES", b"d": "DICT",
}
DTYPE_SPEC = re.compile(r"^[<>|=]?[biuf][1248]$")
SMALL_BYTES_MAX = 64 * 1024  # bigger byte strings are streamed through a PayloadSink
CHUNK = 4 * MIB
HEAD_BYTES = 4 * MIB  # the first 4 MiB of every payload is hashed on its own for cross-array checks


class Refused(Exception):
    """The pickle uses something outside the allow-list. Nothing was executed."""


class BudgetExhausted(Exception):
    """The member's read budget ran out; the parse stopped cleanly."""


# --- inert stand-ins ---------------------------------------------------------------------

class Mark:
    pass


MARK = Mark()


class GlobalRef:
    def __init__(self, module: str, name: str, kind: str):
        self.module, self.name, self.kind = module, name, kind


class DtypeStub:
    def __init__(self, spec: str):
        self.spec = spec
        self.byteorder: Optional[str] = None

    @property
    def code(self) -> str:
        order = self.byteorder if self.byteorder in ("<", ">") else "<"
        return order + self.spec.lstrip("<>|=")

    @property
    def itemsize(self) -> int:
        return int(self.spec.lstrip("<>|=")[1:])

    @property
    def kind(self) -> str:
        return self.spec.lstrip("<>|=")[0]

    @property
    def name(self) -> str:
        return {"f": "float", "i": "int", "u": "uint", "b": "bool"}[self.kind] + str(8 * self.itemsize)


class ScalarStub:
    def __init__(self, dtype: DtypeStub, value: Any):
        self.dtype, self.value = dtype, value


class PayloadRef:
    """What an array's raw data became: a summary, never executed or kept unless retained."""

    def __init__(self, sink: "PayloadSink"):
        self.sink = sink


class ArrayStub:
    def __init__(self, shape: Tuple[int, ...]):
        self.shape = shape
        self.dtype: Optional[DtypeStub] = None
        self.fortran: Optional[bool] = None
        self.payload: Any = None
        self.locator: Dict[str, Any] = {}
        self.built = False


class PayloadSink:
    """Streams one big byte payload: hash, optional numpy summary, optional retention."""

    def __init__(self, nbytes: int, offset: int, dtype: Optional[DtypeStub], sample_rate: int, retain: bool):
        self.nbytes, self.offset, self.dtype = nbytes, offset, dtype
        self.sample_rate = sample_rate
        self.sha = hashlib.sha256()
        self.head_sha = hashlib.sha256()
        self.read = 0
        self.complete = False
        self.data: Optional[bytearray] = bytearray() if retain else None
        self.numeric = bool(np is not None and dtype is not None and dtype.kind == "f" and dtype.itemsize == 8
                            and dtype.code.startswith("<"))
        self.count = 0
        self.nonfinite = 0
        self.zero = 0
        self.near_silent = 0
        self.integer_valued = 0
        self.vmin = math.inf
        self.vmax = -math.inf
        self.sumsq = 0.0
        self.sec_sumsq: Dict[int, float] = {}
        self.carry = b""

    def update(self, chunk: bytes) -> None:
        self.sha.update(chunk)
        if self.read < HEAD_BYTES:
            self.head_sha.update(chunk[: HEAD_BYTES - self.read])
        self.read += len(chunk)
        if self.data is not None:
            self.data += chunk
        if not self.numeric:
            return
        buf = self.carry + chunk
        usable = len(buf) - (len(buf) % 8)
        self.carry = buf[usable:]
        if not usable:
            return
        x = np.frombuffer(buf[:usable], dtype="<f8")
        finite = np.isfinite(x)
        self.nonfinite += int(x.size - finite.sum())
        xf = x[finite]
        if xf.size:
            self.vmin = min(self.vmin, float(xf.min()))
            self.vmax = max(self.vmax, float(xf.max()))
            ax = np.abs(xf)
            self.zero += int((ax == 0).sum())
            self.near_silent += int((ax < 1e-5).sum())
            self.integer_valued += int((xf == np.rint(xf)).sum())
            self.sumsq += float(np.dot(xf, xf))
        idx = (np.arange(self.count, self.count + x.size) // self.sample_rate)
        sums = np.bincount(idx - idx[0], weights=np.where(finite, x, 0.0) ** 2)
        for k, s in enumerate(sums):
            self.sec_sumsq[int(idx[0]) + k] = self.sec_sumsq.get(int(idx[0]) + k, 0.0) + float(s)
        self.count += x.size

    def summary(self) -> Dict[str, Any]:
        out: Dict[str, Any] = {
            "payload_offset_in_member": self.offset,
            "declared_bytes": self.nbytes,
            "bytes_read": self.read,
            "complete": self.complete,
            "sha256_of_bytes_read": self.sha.hexdigest(),
            "sha256_of_first_4MiB": self.head_sha.hexdigest(),
        }
        if self.numeric and self.count:
            n = self.count
            rms = math.sqrt(self.sumsq / n) if n else 0.0
            out["stats"] = {
                "samples_summarised": n,
                "seconds_summarised": round(n / self.sample_rate, 3),
                "nonfinite": self.nonfinite,
                "min": self.vmin, "max": self.vmax,
                "max_abs": max(abs(self.vmin), abs(self.vmax)),
                "peak_db_re_stored_unit": _db(max(abs(self.vmin), abs(self.vmax))),
                "rms": rms,
                "rms_db_re_stored_unit": _db(rms),
                "exact_zero_fraction": self.zero / n,
                "below_1e-5_fraction": self.near_silent / n,
                "integer_valued_fraction": self.integer_valued / n,
                "rms_db_per_second_re_stored_unit": [
                    _db(math.sqrt(self.sec_sumsq[s] / min(self.sample_rate, n - s * self.sample_rate)))
                    for s in sorted(self.sec_sumsq)
                ],
            }
        return out


def _db(x: float) -> Optional[float]:
    return round(20 * math.log10(x), 2) if x > 0 else None


# --- a bounded reader --------------------------------------------------------------------

class Source:
    def __init__(self, f: BinaryIO, limit: int):
        self.f, self.limit, self.pos = f, limit, 0

    def read(self, n: int) -> bytes:
        if n < 0:
            raise Refused("negative length")
        if self.pos + n > self.limit:
            raise BudgetExhausted()
        out = b""
        while len(out) < n:
            part = self.f.read(n - len(out))
            if not part:
                raise Refused("truncated pickle: %d bytes wanted at offset %d" % (n, self.pos))
            out += part
        self.pos += n
        return out

    def line(self) -> bytes:
        out = b""
        while not out.endswith(b"\n"):
            out += self.read(1)
            if len(out) > 256:
                raise Refused("overlong GLOBAL line")
        return out[:-1]


# --- the restricted parser ---------------------------------------------------------------

class StaticPickle:
    def __init__(self, f: BinaryIO, limit: int, *, sample_rate: int = 48000,
                 small_max: int = SMALL_BYTES_MAX, retain_max: int = 130_000_000,
                 retain_total: int = 260_000_000):
        self.src = Source(f, limit)
        self.sample_rate = sample_rate
        self.small_max = small_max
        self.retain_max, self.retain_total = retain_max, retain_total
        self.retained_bytes = 0
        self.stack: List[Any] = []
        self.metastack: List[List[Any]] = []
        self.memo: Dict[int, Any] = {}
        self.arrays: List[ArrayStub] = []
        self.sinks: List[PayloadSink] = []
        self.opcodes_seen: Dict[str, int] = {}
        self.globals_seen: List[str] = []
        self.root: Any = None
        self.finished = False
        self.truncated = False
        self.protocol: Optional[int] = None

    # stack helpers
    def _pop(self) -> Any:
        if not self.stack:
            raise Refused("stack underflow")
        return self.stack.pop()

    def _pop_mark(self) -> List[Any]:
        if not self.metastack:
            raise Refused("no MARK")
        items, self.stack = self.stack, self.metastack.pop()
        return items

    def run(self) -> None:
        try:
            while not self.finished:
                self._step()
        except BudgetExhausted:
            self.truncated = True

    def _step(self) -> None:
        op = self.src.read(1)
        name = OPCODES.get(op)
        if name is None:
            raise Refused("opcode %r at offset %d is not on the allow-list" % (op, self.src.pos - 1))
        self.opcodes_seen[name] = self.opcodes_seen.get(name, 0) + 1
        st = self.stack
        r = self.src.read
        if name == "PROTO":
            self.protocol = r(1)[0]
            if self.protocol > 5:
                raise Refused("unknown pickle protocol")
        elif name == "FRAME":
            r(8)
        elif name == "STOP":
            self.root = self._pop()
            self.finished = True
        elif name == "MARK":
            self.metastack.append(st)
            self.stack = []
        elif name == "EMPTY_DICT":
            st.append({})
        elif name in ("EMPTY_LIST", "LIST"):
            items = [] if name == "EMPTY_LIST" else self._pop_mark()
            self.stack.append(items)
        elif name == "DICT":
            items = self._pop_mark()
            self.stack.append({items[i]: items[i + 1] for i in range(0, len(items) - 1, 2)})
        elif name == "EMPTY_TUPLE":
            st.append(())
        elif name == "MEMOIZE":
            if not st:
                raise Refused("MEMOIZE on empty stack")
            self.memo[len(self.memo)] = st[-1]
        elif name == "BINPUT":
            self.memo[r(1)[0]] = st[-1]
        elif name == "LONG_BINPUT":
            self.memo[struct.unpack("<I", r(4))[0]] = st[-1]
        elif name == "BINGET":
            st.append(self._get(r(1)[0]))
        elif name == "LONG_BINGET":
            st.append(self._get(struct.unpack("<I", r(4))[0]))
        elif name == "SHORT_BINUNICODE":
            st.append(r(r(1)[0]).decode("utf-8"))
        elif name == "BINUNICODE":
            n = struct.unpack("<I", r(4))[0]
            if n > MIB:
                raise Refused("string over 1 MiB")
            st.append(r(n).decode("utf-8"))
        elif name == "STACK_GLOBAL":
            n, m = self._pop(), self._pop()
            st.append(self._global(m, n))
        elif name == "GLOBAL":
            m = self.src.line().decode("utf-8")
            n = self.src.line().decode("utf-8")
            st.append(self._global(m, n))
        elif name == "BININT":
            st.append(struct.unpack("<i", r(4))[0])
        elif name == "BININT1":
            st.append(r(1)[0])
        elif name == "BININT2":
            st.append(struct.unpack("<H", r(2))[0])
        elif name == "LONG1":
            n = r(1)[0]
            st.append(int.from_bytes(r(n), "little", signed=True))
        elif name == "BINFLOAT":
            st.append(struct.unpack(">d", r(8))[0])
        elif name == "NEWTRUE":
            st.append(True)
        elif name == "NEWFALSE":
            st.append(False)
        elif name == "NONE":
            st.append(None)
        elif name == "TUPLE":
            items = tuple(self._pop_mark())
            self.stack.append(items)
        elif name in ("TUPLE1", "TUPLE2", "TUPLE3"):
            k = int(name[-1])
            if len(st) < k:
                raise Refused("stack underflow")
            items = tuple(st[-k:])
            del st[-k:]
            st.append(items)
        elif name == "SHORT_BINBYTES":
            st.append(self._bytes(r(1)[0]))
        elif name == "BINBYTES":
            st.append(self._bytes(struct.unpack("<I", r(4))[0]))
        elif name == "REDUCE":
            args, fn = self._pop(), self._pop()
            st.append(self._reduce(fn, args))
        elif name == "BUILD":
            state = self._pop()
            self._build(st[-1] if st else None, state)
        elif name == "APPEND":
            v = self._pop()
            self._list_top("APPEND").append(v)
        elif name == "APPENDS":
            items = self._pop_mark()
            self._list_top("APPENDS").extend(items)
        elif name == "SETITEM":
            v, k = self._pop(), self._pop()
            self._dict_top()[k] = v
        elif name == "SETITEMS":
            items = self._pop_mark()
            d = self._dict_top()
            for i in range(0, len(items) - 1, 2):
                d[items[i]] = items[i + 1]

    def _get(self, i: int) -> Any:
        if i not in self.memo:
            raise Refused("memo index %d not set" % i)
        return self.memo[i]

    def _list_top(self, why: str) -> list:
        if not self.stack or not isinstance(self.stack[-1], list):
            raise Refused("%s without a list" % why)
        return self.stack[-1]

    def _dict_top(self) -> dict:
        if not self.stack or not isinstance(self.stack[-1], dict):
            raise Refused("SETITEM(S) without a dict")
        return self.stack[-1]

    def _global(self, module: Any, name: Any) -> GlobalRef:
        if not isinstance(module, str) or not isinstance(name, str):
            raise Refused("GLOBAL names must be strings")
        label = "%s.%s" % (module, name)
        kind = ALLOWED_GLOBALS.get((module, name))
        if kind is None:
            raise Refused("global %s is not on the allow-list (refusing; nothing executed)" % label)
        if label not in self.globals_seen:
            self.globals_seen.append(label)
        return GlobalRef(module, name, kind)

    def _bytes(self, n: int) -> Any:
        if n <= self.small_max:
            return self.src.read(n)
        dtype = next((x for x in reversed(self.stack[-6:]) if isinstance(x, DtypeStub)), None)
        retain = bool(self.retain_max and n <= self.retain_max and self.retained_bytes + n <= self.retain_total)
        sink = PayloadSink(n, self.src.pos, dtype, self.sample_rate, retain)
        self.sinks.append(sink)
        if retain:
            self.retained_bytes += n
        while sink.read < n:
            want = min(CHUNK, n - sink.read, self.src.limit - self.src.pos)
            if want <= 0:
                raise BudgetExhausted()
            chunk = b""
            while len(chunk) < want:
                part = self.src.f.read(want - len(chunk))
                if not part:
                    raise Refused("truncated payload at offset %d" % self.src.pos)
                chunk += part
            self.src.pos += want
            sink.update(chunk)
        sink.complete = True
        return PayloadRef(sink)

    def _reduce(self, fn: Any, args: Any) -> Any:
        if not isinstance(fn, GlobalRef):
            raise Refused("REDUCE of something that is not an allow-listed global")
        if not isinstance(args, tuple):
            raise Refused("REDUCE arguments must be a tuple")
        k = fn.kind
        if k == "ndarray_reconstruct":
            if len(args) != 3 or not isinstance(args[0], GlobalRef) or args[0].kind != "ndarray_class":
                raise Refused("_reconstruct must be called as (ndarray, shape, b'b')")
            shape = args[1]
            if not isinstance(shape, tuple) or not all(isinstance(d, int) and d >= 0 for d in shape):
                raise Refused("bad array shape")
            return ArrayStub(shape)
        if k == "dtype":
            spec = args[0] if args else None
            if not isinstance(spec, str) or not DTYPE_SPEC.match(spec):
                raise Refused("dtype %r is not a plain bool/int/float kind (object/structured refused)" % (spec,))
            return DtypeStub(spec)
        if k == "numpy_scalar":
            if len(args) != 2 or not isinstance(args[0], DtypeStub) or not isinstance(args[1], (bytes, bytearray)):
                raise Refused("numpy scalar must be (dtype, bytes)")
            dt, raw = args
            if len(raw) != dt.itemsize:
                raise Refused("numpy scalar byte count does not match its dtype")
            fmt = {"f": {4: "f", 8: "d"}, "i": {1: "b", 2: "h", 4: "i", 8: "q"},
                   "u": {1: "B", 2: "H", 4: "I", 8: "Q"}, "b": {1: "?"}}[dt.kind].get(dt.itemsize)
            if fmt is None:
                raise Refused("unsupported scalar dtype")
            return ScalarStub(dt, struct.unpack(("<" if dt.byteorder != ">" else ">") + fmt, raw)[0])
        if k in ("list", "tuple"):
            if not args:
                return [] if k == "list" else ()
            if len(args) == 1 and isinstance(args[0], (list, tuple)):
                return list(args[0]) if k == "list" else tuple(args[0])
            raise Refused("unsupported %s() call" % k)
        if k == "dict" and not args:
            return {}
        raise Refused("REDUCE of %s.%s is not supported" % (fn.module, fn.name))

    def _build(self, obj: Any, state: Any) -> None:
        if isinstance(obj, DtypeStub):
            if (not isinstance(state, tuple) or len(state) != 8 or state[0] not in (3, 4)
                    or state[1] not in ("<", ">", "|", "=")
                    or state[2] is not None or state[3] is not None or state[4] is not None):
                raise Refused("dtype state not understood (structured/subarray dtypes are refused)")
            obj.byteorder = state[1]
            return
        if isinstance(obj, ArrayStub):
            if (not isinstance(state, tuple) or len(state) != 5 or state[0] != 1
                    or not isinstance(state[2], DtypeStub) or not isinstance(state[3], bool)):
                raise Refused("ndarray state not understood")
            if (not isinstance(state[1], tuple) or not all(isinstance(d, int) and d >= 0 for d in state[1])):
                raise Refused("bad array shape in state")
            obj.shape = tuple(state[1])  # numpy constructs with shape (0,) and sets the real one here
            obj.dtype, obj.fortran, obj.payload = state[2], state[3], state[4]
            obj.built = True
            expected = math.prod(obj.shape) * obj.dtype.itemsize
            got = state[4].sink.nbytes if isinstance(state[4], PayloadRef) else \
                len(state[4]) if isinstance(state[4], (bytes, bytearray)) else None
            if got != expected:
                raise Refused("array data is %r bytes, its shape and dtype need %d" % (got, expected))
            obj.locator = self._locate()
            self.arrays.append(obj)
            return
        raise Refused("BUILD on an object that is not an array or dtype stub")

    def _locate(self) -> Dict[str, Any]:
        st = self.stack
        if len(st) >= 3 and isinstance(st[-2], list) and isinstance(st[-3], str):
            return {"key": st[-3], "list_len_before": len(st[-2]), "how": "APPEND"}
        if self.metastack and self.metastack[-1] and isinstance(self.metastack[-1][-1], list):
            parent = self.metastack[-1]
            key = parent[-2] if len(parent) >= 2 and isinstance(parent[-2], str) else None
            return {"key": key, "list_len_before": len(parent[-1]), "index_in_batch": len(st) - 1, "how": "APPENDS batch"}
        return {}


# --- describing what was parsed ----------------------------------------------------------

def describe(v: Any, depth: int = 0) -> Any:
    if isinstance(v, ArrayStub):
        d: Dict[str, Any] = {"type": "ndarray", "shape": list(v.shape), "dtype": v.dtype.name if v.dtype else None,
                             "dtype_code": v.dtype.code if v.dtype else None, "fortran_order": v.fortran,
                             "locator": v.locator}
        if isinstance(v.payload, PayloadRef):
            d["payload"] = v.payload.sink.summary()
        return d
    if isinstance(v, ScalarStub):
        return {"type": "numpy_scalar", "dtype": v.dtype.name, "value": v.value}
    if isinstance(v, dict):
        return {"type": "dict", "keys": [str(k) for k in v], "items": {str(k): describe(x, depth + 1) for k, x in v.items()}}
    if isinstance(v, (list, tuple)):
        shown = [describe(x, depth + 1) for x in v[:64]]
        return {"type": "list" if isinstance(v, list) else "tuple", "len": len(v), "items": shown,
                "items_omitted": max(0, len(v) - 64)}
    if isinstance(v, (bytes, bytearray)):
        return {"type": "bytes", "len": len(v)}
    if isinstance(v, (str, int, float, bool)) or v is None:
        return v
    return {"type": type(v).__name__}


def audit_pickle_stream(f: BinaryIO, limit: int, **kw: Any) -> Tuple[StaticPickle, Dict[str, Any]]:
    """Parse one pickle statically. Raises Refused on anything off the allow-list."""
    p = StaticPickle(f, limit, **kw)
    p.run()
    rep: Dict[str, Any] = {
        "protocol": p.protocol,
        "finished_to_STOP": p.finished,
        "stopped_by_read_budget": p.truncated,
        "decompressed_bytes_read": p.src.pos,
        "opcodes_seen": dict(sorted(p.opcodes_seen.items())),
        "globals_named": p.globals_seen,
    }
    if p.finished:
        rep["contents"] = describe(p.root)
    else:
        # The budget ran out mid-parse: say what was seen so far, and what was in flight.
        top_dict = None
        frames = p.metastack + [p.stack]
        for fr in frames:
            for x in fr:
                if isinstance(x, dict):
                    top_dict = x
                    break
            if top_dict is not None:
                break
        rep["partial_view"] = {
            "root_dict_so_far": describe(top_dict) if top_dict is not None else None,
            "in_flight_frames": [[describe(x) for x in fr[-4:]] for fr in frames],
        }
    rep["arrays_built"] = [describe(a) for a in p.arrays]
    rep["payloads_streamed"] = [s.summary() for s in p.sinks if s.numeric or s.nbytes > p.small_max]
    return p, rep


# --- numeric analysis of retained arrays (numpy only; bounded) ---------------------------

def _xcorr_lag(a: Any, b: Any, max_lag: int) -> Tuple[int, float]:
    """Lag k (samples) maximising sum a[t]*b[t+k], and the normalised correlation there."""
    n = 1 << int(math.ceil(math.log2(len(a) + max_lag + 1)))
    A, B = np.fft.rfft(a, n), np.fft.rfft(b, n)
    c = np.fft.irfft(np.conj(A) * B, n)
    cand = np.concatenate([c[: max_lag + 1], c[n - max_lag:]])
    lags = np.concatenate([np.arange(0, max_lag + 1), np.arange(-max_lag, 0)])
    i = int(np.argmax(np.abs(cand)))
    denom = math.sqrt(float(np.dot(a, a)) * float(np.dot(b, b))) or 1.0
    return int(lags[i]), float(cand[i] / denom)


def analyse_pair(inp: Any, out: Any, sr: int) -> Dict[str, Any]:
    """Alignment and level relation of one input array and its output. Windows only; bounded."""
    n = min(len(inp), len(out))
    sec = n // sr
    rms = np.array([float(np.sqrt(np.mean(inp[s * sr:(s + 1) * sr] ** 2))) for s in range(sec)])
    ok = np.where(rms > 10 ** (20 / 20))[0]  # stored units are not 1.0 full scale: skip only near-silent seconds
    pick = [int(ok[min(len(ok) - 1, int(q * len(ok)))]) for q in (0.05, 0.2, 0.35, 0.5, 0.65, 0.8, 0.95)]
    W, maxlag = 1 << 17, 2400
    windows = []
    for s in pick:
        a0 = s * sr
        a, b = inp[a0:a0 + W], out[a0:a0 + W + maxlag]
        if len(a) < W or len(b) < W:
            continue
        lag, corr = _xcorr_lag(a, b[:W], maxlag)
        windows.append({"second": s, "input_rms_db_re_stored_unit": _db(float(np.sqrt(np.mean(a ** 2)))), "lag_samples": lag,
                        "normalised_correlation": round(corr, 4)})
    lags = sorted(w["lag_samples"] for w in windows)
    lag = lags[len(lags) // 2] if lags else 0
    # Level relation per 100 ms block after removing the lag.
    block = sr // 10
    xs = inp[: n - abs(lag)] if lag >= 0 else inp[-lag:n]
    ys = out[lag:n] if lag >= 0 else out[: n + lag]
    nb = min(len(xs), len(ys)) // block
    X = xs[: nb * block].reshape(nb, block)
    Y = ys[: nb * block].reshape(nb, block)
    xd = 20 * np.log10(np.sqrt(np.mean(X ** 2, axis=1)) + 1e-12)
    yd = 20 * np.log10(np.sqrt(np.mean(Y ** 2, axis=1)) + 1e-12)
    table = []
    for lo in range(int(np.floor(xd.min())), int(np.ceil(xd.max())), 3):
        m = (xd >= lo) & (xd < lo + 3)
        if m.sum() >= 5:
            table.append({"input_block_rms_db": [lo, lo + 3], "blocks": int(m.sum()),
                          "median_output_db": round(float(np.median(yd[m])), 2),
                          "median_gain_db": round(float(np.median(yd[m] - xd[m])), 2)})
    slopes = []
    for i in range(len(table)):
        for j in range(i + 1, len(table)):
            if table[j]["input_block_rms_db"][0] - table[i]["input_block_rms_db"][0] >= 12:
                dx = table[j]["input_block_rms_db"][0] - table[i]["input_block_rms_db"][0]
                dy = table[j]["median_output_db"] - table[i]["median_output_db"]
                slopes.append({"from_input_db": table[i]["input_block_rms_db"][0],
                               "to_input_db": table[j]["input_block_rms_db"][0], "slope_db_out_per_db_in": round(dy / dx, 3)})
                break
    return {
        "samples_compared": n, "windows": windows, "lag_samples_median": lag,
        "lag_ms_median": round(1000 * lag / sr, 3),
        "static_level_table_100ms_blocks": table,
        "local_slopes_over_12dB": slopes,
        "note": "Block RMS levels in dB relative to 1.0 in the stored float units (the arrays are NOT scaled to +-1.0); the dBu calibration of the recording chain is unknown. "
                "Slopes are of block-RMS medians (attack/release blur them); evidence only, not a measured ratio.",
    }


# --- labels ------------------------------------------------------------------------------

def _plain(v: Any) -> Any:
    return v.value if isinstance(v, ScalarStub) else v


def label_analysis(train: Optional[dict], test: Optional[dict]) -> Dict[str, Any]:
    out: Dict[str, Any] = {}
    def entries(d: Optional[dict]) -> Dict[str, List[Any]]:
        return {k: [_plain(x) for x in v] if isinstance(v, list) else _plain(v) for k, v in (d or {}).items()}
    tr, te = entries(train), entries(test)
    out["train_fields"], out["test_fields"] = sorted(tr), sorted(te)
    out["train"], out["test"] = tr, te
    for fld in ("ratio", "threshold"):
        a, b = tr.get(fld, []), te.get(fld, [])
        out[fld] = {"train_count": len(a), "test_count": len(b), "train_distinct_sorted": sorted(set(a)),
                    "test_distinct_sorted": sorted(set(b)), "min": min(a + b) if a + b else None,
                    "max": max(a + b) if a + b else None,
                    "train_value_counts": {str(k): a.count(k) for k in sorted(set(a))}}
    pairs_tr = list(zip(tr.get("ratio", []), tr.get("threshold", [])))
    pairs_te = list(zip(te.get("ratio", []), te.get("threshold", [])))
    out["pairs"] = {
        "train_pairs": len(pairs_tr), "train_distinct_pairs": len(set(pairs_tr)),
        "test_pairs": pairs_te, "test_pair_also_in_train": [p in set(pairs_tr) for p in pairs_te],
        "all_distinct_pairs_train_plus_test": len(set(pairs_tr + pairs_te)),
        "full_grid_size_if_every_ratio_met_every_threshold":
            len(set(tr.get("ratio", []) + te.get("ratio", []))) * len(set(tr.get("threshold", []) + te.get("threshold", []))),
    }
    out["sample_rate_train"], out["sample_rate_test"] = tr.get("samplerate"), te.get("samplerate")
    known = {"ratio", "threshold", "samplerate"}
    out["fields_other_than_ratio_threshold_samplerate"] = sorted((set(tr) | set(te)) - known)
    return out


# --- the audit ---------------------------------------------------------------------------

def audit_zip(zip_path: str, budgets_mib: Dict[str, float]) -> Dict[str, Any]:
    z = zipfile.ZipFile(zip_path)
    infos = {i.filename: i for i in z.infolist()}
    report: Dict[str, Any] = {
        "tool": "scripts/audit-cl1b.py", "execution_safety": "static opcode parse; no pickle.load, no numpy.load, "
        "nothing from the archive executed; allow-listed opcodes/globals only",
        "allowed_globals": sorted("%s.%s" % k for k in ALLOWED_GLOBALS),
        "allowed_opcodes": sorted(OPCODES.values()),
        "archive": {"path": os.path.abspath(zip_path), "bytes": os.path.getsize(zip_path)},
        "members": {n: {"uncompressed_bytes": i.file_size, "compressed_bytes": i.compress_size, "crc32": "%08x" % i.CRC,
                        "compress_type": i.compress_type} for n, i in infos.items()},
        "unexpected_members": sorted(set(infos) - set(EXPECTED_MEMBERS)),
        "converted_to_corpus": False,
    }
    results: Dict[str, Dict[str, Any]] = {}
    parsed: Dict[str, StaticPickle] = {}
    meta: Dict[str, Optional[dict]] = {}
    for name in ("metadatas_train.pickle", "metadatas_test.pickle"):
        if name not in infos:
            continue
        with z.open(name) as f:
            p, rep = audit_pickle_stream(f, int(budgets_mib.get(name, 1) * MIB))
        results[name] = rep
        meta[name] = p.root if isinstance(p.root, dict) else None
    labels = label_analysis(meta.get("metadatas_train.pickle"), meta.get("metadatas_test.pickle"))
    sr = int(labels.get("sample_rate_train") or labels.get("sample_rate_test") or 48000)
    report["labels"] = labels
    for name in ("data_test.pickle", "data_train.pickle"):
        if name not in infos:
            continue
        with z.open(name) as f:
            p, rep = audit_pickle_stream(f, int(budgets_mib.get(name, 1) * MIB), sample_rate=sr)
        rep["member_uncompressed_bytes"] = infos[name].file_size
        results[name] = rep
        parsed[name] = p
    report["pickles"] = results
    report["cross_checks"] = cross_checks(parsed, infos, sr)
    report["budget_mib"] = {n: budgets_mib.get(n) for n in EXPECTED_MEMBERS}
    return report


def _array_bytes(a: ArrayStub) -> Optional[Any]:
    s = a.payload.sink if isinstance(a.payload, PayloadRef) else None
    return None if s is None or s.data is None or not s.complete else np.frombuffer(bytes(s.data), dtype="<f8")


def _sink_samples(s: PayloadSink) -> Optional[Any]:
    """Whatever whole float64 samples a retained payload has (possibly a prefix)."""
    if s.data is None or len(s.data) < 8:
        return None
    return np.frombuffer(bytes(s.data[: len(s.data) - len(s.data) % 8]), dtype="<f8")


def compare_signals(a: Any, b: Any, sr: int, max_lag: int = 2400) -> Dict[str, Any]:
    """How alike two input recordings are over their common prefix (bounded FFT windows + whole-array RMS)."""
    n = min(len(a), len(b))
    a, b = a[:n], b[:n]
    d = a - b
    rms = lambda x: float(np.sqrt(np.mean(x * x)))
    W = 1 << 17
    wins = []
    for q in (0.0, 0.15, 0.3, 0.45, 0.6, 0.75, 0.9):
        s0 = min(int(q * n), max(0, n - W - max_lag))
        if n - s0 < W + max_lag:
            continue
        lag, corr = _xcorr_lag(a[s0:s0 + W], b[s0:s0 + W + max_lag][:W], max_lag)
        wins.append({"start_second": round(s0 / sr, 1), "best_lag_samples": lag, "correlation": round(corr, 4)})
    lags = sorted(w["best_lag_samples"] for w in wins)
    lag = lags[len(lags) // 2] if lags else 0
    shifted = (a[: n - lag] - b[lag:n]) if lag >= 0 else (a[-lag:n] - b[: n + lag])
    return {"windows": wins, "median_lag_samples": lag,
            "difference_rms_db_re_signal_rms_after_removing_median_lag": _db(rms(shifted) / rms(a)) if rms(a) else None,
            "lag_is_constant_across_windows": len(set(lags)) <= 1, "samples_compared": n, "seconds_compared": round(n / sr, 2),
            "bit_identical": bool(np.array_equal(a, b)),
            "normalised_correlation_lag0": round(float(np.dot(a, b)) / (math.sqrt(float(np.dot(a, a)) * float(np.dot(b, b))) or 1.0), 6),
            "difference_rms_db_re_signal_rms": _db(rms(d) / rms(a)) if rms(a) else None,
            "lag_samples_convention": "k maximising sum a[t]*b[t+k], a = first argument (the train array), b = the other"}


def cross_checks(parsed: Dict[str, StaticPickle], infos: Dict[str, zipfile.ZipInfo], sr: int) -> Dict[str, Any]:
    out: Dict[str, Any] = {}
    tr, te = parsed.get("data_train.pickle"), parsed.get("data_test.pickle")
    sinks = lambda p: list(p.sinks) if p else []
    tr_s, te_s = sinks(tr), sinks(te)
    if tr_s and te_s and tr_s[0].complete and te_s[0].complete and tr_s[0].nbytes == te_s[0].nbytes:
        out["test_first_array_identical_to_train_first_array"] = tr_s[0].sha.hexdigest() == te_s[0].sha.hexdigest()
    if len(tr_s) >= 2:
        out["train_array2_first_4MiB_identical_to_array1"] = (
            tr_s[1].read >= HEAD_BYTES and tr_s[0].head_sha.hexdigest() == tr_s[1].head_sha.hexdigest())
        out["train_array2_bytes_read"] = tr_s[1].read
        out["train_array2_complete"] = tr_s[1].complete
    if len(te_s) >= 2 and te_s[0].complete and te_s[1].complete:
        out["test_array2_identical_to_array1"] = te_s[0].sha.hexdigest() == te_s[1].sha.hexdigest()
    # Size arithmetic: is the train member consistent with N equal arrays plus small headers?
    if tr_s:
        each = tr_s[0].nbytes
        size = infos["data_train.pickle"].file_size
        n = round(size / each)
        arith: Dict[str, Any] = {"array_payload_bytes": each, "member_bytes": size, "nearest_whole_array_count": n,
                                 "bytes_left_for_non_payload": size - n * each}
        if len(tr_s) >= 2:
            arith["bytes_before_first_payload"] = tr_s[0].offset
            arith["header_bytes_between_arrays_1_and_2"] = tr_s[1].offset - (tr_s[0].offset + tr_s[0].nbytes)
        if te_s and len(te_s) >= 2:
            arith["test_member_non_payload_bytes"] = infos["data_test.pickle"].file_size - 2 * te_s[0].nbytes
        arith["note"] = ("Arithmetic consistency only: the train member was not read to its end, so the number of arrays, "
                         "their lengths and the list they belong to beyond the ones parsed are inferred, not observed.")
        out["train_size_arithmetic"] = arith
    if np is not None and tr_s and te_s:
        a, b = _sink_samples(tr_s[0]), _sink_samples(te_s[0])
        if a is not None and b is not None:
            out["input_similarity_test_inp_vs_train_inp0"] = compare_signals(a, b, sr)
        if len(tr_s) >= 2:
            c = _sink_samples(tr_s[1])
            if a is not None and c is not None:
                out["input_similarity_train_second_array_prefix_vs_train_inp0"] = compare_signals(a, c, sr)
            if b is not None and c is not None:
                out["input_similarity_test_inp_vs_train_second_array_prefix"] = compare_signals(b, c, sr)
    if np is not None and te and len(te.arrays) >= 2:
        a, b = _array_bytes(te.arrays[0]), _array_bytes(te.arrays[1])
        if a is not None and b is not None:
            out["test_pair_alignment"] = analyse_pair(a, b, sr)
            out["test_pair_alignment"]["pair"] = {"input": te.arrays[0].locator, "output": te.arrays[1].locator}
    elif np is None:
        out["numpy"] = "not installed: statistics and alignment analysis skipped"
    return out


def main(argv: Optional[List[str]] = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    ap.add_argument("zip", help="path to Dataset.zip")
    ap.add_argument("--out", default="./data/research-datasets/cl1b/layout-audit.json")
    ap.add_argument("--budget-mib", action="append", default=[], metavar="MEMBER=MIB",
                    help="decompressed bytes each member may be read (defaults: %s)" % DEFAULT_BUDGET_MIB)
    a = ap.parse_args(argv)
    budgets = dict(DEFAULT_BUDGET_MIB)
    for item in a.budget_mib:
        k, _, v = item.partition("=")
        budgets[k] = float(v)
    try:
        report = audit_zip(a.zip, budgets)
    except Refused as e:
        print(json.dumps({"refused": str(e), "executed_anything": False}, indent=2))
        return 2
    text = json.dumps(report, indent=2, default=str)
    os.makedirs(os.path.dirname(os.path.abspath(a.out)), exist_ok=True)
    with open(a.out, "w") as fh:
        fh.write(text + "\n")
    print(text)
    return 0


if __name__ == "__main__":
    sys.exit(main())

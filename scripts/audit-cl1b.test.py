#!/usr/bin/env python3
"""Self-test of scripts/audit-cl1b.py's safety property. Run: python3 scripts/audit-cl1b.test.py

No pytest. Builds tiny pickles in memory: malicious ones (their __reduce__ would run os.system or
builtins.eval if they were ever loaded) and a benign NumPy-layout one. Asserts the auditor refuses
the first kind, reads the second, and that nothing was executed: no marker file is created (the
payloads that would use eval/exec write one), and os.system, os.popen, subprocess.Popen and os.execv
are replaced by tripwires for the whole run. (builtins.eval/exec can't be tripwired: Python's own import
machinery calls exec.)
"""
import builtins
import importlib.util
import io
import json
import os
import pickle
import shutil
import struct
import subprocess
import sys
import tempfile
import zipfile

HERE = os.path.dirname(os.path.abspath(__file__))
spec = importlib.util.spec_from_file_location("audit_cl1b", os.path.join(HERE, "audit-cl1b.py"))
audit = importlib.util.module_from_spec(spec)
sys.modules["audit_cl1b"] = audit
spec.loader.exec_module(audit)

TMP = tempfile.mkdtemp(prefix="audit-cl1b-test-")
MARKER = os.path.join(TMP, "PWNED")
TRIPPED = []


def tripwire(name):
    def trip(*a, **k):
        TRIPPED.append(name)
        raise RuntimeError("tripwire: %s was called" % name)
    return trip


# From here on any attempt to run code from a pickle trips a wire. The malicious pickles are only
# *built* with pickle.dumps (which never calls __reduce__'s callable), never loaded.
_real = {
    "os.system": os.system, "os.popen": os.popen, "subprocess.Popen": subprocess.Popen,
    "os.execv": os.execv,
}
def arm():
    os.system, os.popen, subprocess.Popen = tripwire("os.system"), tripwire("os.popen"), tripwire("subprocess.Popen")
    os.execv = tripwire("os.execv")


def disarm():
    os.system, os.popen, subprocess.Popen = _real["os.system"], _real["os.popen"], _real["subprocess.Popen"]
    os.execv = _real["os.execv"]


arm()


class Evil:
    def __init__(self, fn, *args):
        self.fn, self.args = fn, args

    def __reduce__(self):
        return (self.fn, self.args)


def evil_bytes(fn, *args, protocol=4):
    # Pickling a global by reference needs it to be the importable object, so the real functions are
    # put back for this one pickle.dumps call (which writes the name down and never calls it).
    disarm()
    try:
        return pickle.dumps({"inp": [Evil(fn, *args)]}, protocol=protocol)
    finally:
        arm()


# --- a tiny assembler, so the benign layout needs no numpy to be built ----------------------

def s(text):
    b = text.encode()
    return b"\x8c" + bytes([len(b)]) + b


def glob(mod, name):
    return s(mod) + s(name) + b"\x93"


def f64(values):
    return struct.pack("<%dd" % len(values), *values)


def array_record(values, module="numpy.core.multiarray", claimed=None):
    payload = f64(values)
    # numpy builds the array with shape (0,), then BUILD sets the real shape and the data
    return (glob(module, "_reconstruct") + glob("numpy", "ndarray") + b"K\x00\x85" + b"C\x01b" + b"\x87R"
            + b"(K\x01" + b"K" + bytes([claimed or len(values)]) + b"\x85"
            + glob("numpy", "dtype") + s("f8") + b"\x89\x88\x87R"
            + b"(K\x03" + s("<") + b"NNNJ\xff\xff\xff\xffJ\xff\xff\xff\xffK\x00tb"
            + b"\x89" + b"C" + bytes([len(payload)]) + payload + b"t" + b"b")


def benign(values_in, values_out, module="numpy.core.multiarray", claimed=None):
    return (b"\x80\x04}(" + s("inp") + b"]" + array_record(values_in, module, claimed) + b"a"
            + s("tar") + b"]" + array_record(values_out, module) + b"a"
            + s("samplerate") + b"G" + struct.pack(">d", 48000.0) + b"u.")


failures = []


def check(cond, label):
    print(("ok   " if cond else "FAIL ") + label)
    if not cond:
        failures.append(label)


def refuses(blob, label, **kw):
    try:
        audit.audit_pickle_stream(io.BytesIO(blob), len(blob) + 16, **kw)
    except audit.Refused as e:
        check(True, "%s: refused (%s)" % (label, str(e)[:70]))
        return
    except Exception as e:  # any other error is also not a pass for 'refused cleanly'
        check(False, "%s: raised %r instead of Refused" % (label, e))
        return
    check(False, "%s: was NOT refused" % label)


# 1. Malicious pickles ------------------------------------------------------------------------
for proto in (0, 2, 4):
    refuses(evil_bytes(_real["os.system"], "touch " + MARKER, protocol=proto), "os.system via protocol %d" % proto)
refuses(evil_bytes(eval, "__import__('os').system('touch %s')" % MARKER), "builtins.eval")
refuses(evil_bytes(exec, "open(%r, 'w').write('x')" % MARKER), "builtins.exec")
refuses(evil_bytes(_real["subprocess.Popen"], ["touch", MARKER]), "subprocess.Popen")
refuses(b"\x80\x02cposix\nsystem\nq\x00X\x02\x00\x00\x00lsq\x01\x85q\x02Rq\x03.", "posix.system (GLOBAL opcode)")

# opcodes outside the allow-list: NEWOBJ, OBJ, INST, EXT1, PERSID, BINPERSID, BUILD on a plain object
refuses(b"\x80\x02}(" + s("x") + glob("numpy", "ndarray") + b"\x85\x81" + b"u.", "NEWOBJ")
refuses(b"\x80\x02(cbuiltins\nlist\no.", "OBJ")
refuses(b"(S'x'\nS'y'\ni__main__\nFoo\n.", "INST / protocol 0 string")
refuses(b"\x80\x02\x82\x01.", "EXT1")
refuses(b"\x80\x02Pabc\n.", "PERSID")
refuses(b"\x80\x04" + glob("numpy", "ndarray") + b"\x85\x81.", "NEWOBJ on an allowed global")

# allowed names used the wrong way
refuses(b"\x80\x04" + glob("builtins", "eval") + s("1") + b"\x85R.", "builtins.eval named via STACK_GLOBAL")
refuses(b"\x80\x04" + glob("numpy", "load") + s("x") + b"\x85R.", "numpy.load (not allow-listed)")
refuses(b"\x80\x04" + glob("numpy", "dtype") + s("O") + b"\x89\x88\x87R.", "object dtype")
refuses(b"\x80\x04" + glob("numpy", "dtype") + s("V8") + b"\x89\x88\x87R.", "void/structured dtype")
refuses(b"\x80\x04" + glob("builtins", "list") + b"R.", "REDUCE on too few stack items")
refuses(b"\x80\x04" + glob("builtins", "dict") + b"\x85b.", "BUILD on a non-array")
refuses(benign([1.0, 2.0, 3.0], [1.0, 2.0, 3.0], claimed=4), "array data shorter than its shape needs")

check(not os.path.exists(MARKER), "marker file never created")
check(not TRIPPED, "no tripwire fired during refusals (%s)" % TRIPPED)

# 2. A benign numpy layout is read ---------------------------------------------------------------
ins, outs = [0.5, -0.25, 1.5, 2.0], [0.4, -0.2, 1.2, 1.6]
for module in ("numpy.core.multiarray", "numpy._core.multiarray"):
    blob = benign(ins, outs, module)
    p, rep = audit.audit_pickle_stream(io.BytesIO(blob), len(blob), small_max=8, retain_max=1 << 20)
    arrs = rep["arrays_built"]
    check(rep["finished_to_STOP"] and len(arrs) == 2, "benign (%s): two arrays parsed" % module)
    check([a["locator"]["key"] for a in arrs] == ["inp", "tar"], "benign: keys inp, tar")
    check(arrs[0]["shape"] == [4] and arrs[0]["dtype"] == "float64" and arrs[0]["dtype_code"] == "<f8",
          "benign: shape [4], dtype <f8")
    st = arrs[0]["payload"]["stats"] if "stats" in arrs[0].get("payload", {}) else None
    if audit.np is not None:
        check(st is not None and abs(st["max_abs"] - 2.0) < 1e-12 and st["integer_valued_fraction"] == 0.25,
              "benign: numeric summary read from bytes (max 2.0, a quarter integer-valued)")
    check(rep["contents"]["items"]["samplerate"] == 48000.0, "benign: plain float read")
    check(set(rep["globals_named"]) <= {"%s._reconstruct" % module, "numpy.ndarray", "numpy.dtype"},
          "benign: only allow-listed globals named")
    short = len(blob) // 2
    p2, rep2 = audit.audit_pickle_stream(io.BytesIO(blob), short, small_max=8)
    check(rep2["stopped_by_read_budget"] and not rep2["finished_to_STOP"] and rep2["decompressed_bytes_read"] <= short,
          "budget: a small read budget stops the parse cleanly (%d of %d bytes)" % (rep2["decompressed_bytes_read"], len(blob)))

# A real NumPy pickle (only built, never loaded) when numpy is installed.
if audit.np is not None:
    import numpy as np
    real = pickle.dumps({"inp": [np.arange(1000, dtype="<f8")], "tar": [np.arange(1000, dtype="<f8") * 0.5]}, protocol=4)
    p, rep = audit.audit_pickle_stream(io.BytesIO(real), len(real), small_max=256, retain_max=1 << 20)
    check(rep["finished_to_STOP"] and [a["shape"] for a in rep["arrays_built"]] == [[1000], [1000]],
          "real numpy.dumps(protocol 4) layout read statically")
    st = rep["arrays_built"][1]["payload"]["stats"]
    check(abs(st["max_abs"] - 499.5) < 1e-9, "real layout: values read from the bytes (max 499.5)")
    blob = pickle.dumps({"a": np.zeros(3, dtype=object)}, protocol=4)
    refuses(blob, "real object-dtype array")

# 3. Whole-zip run on in-memory archives, through main() ----------------------------------------
def make_zip(path, members):
    with zipfile.ZipFile(path, "w", zipfile.ZIP_DEFLATED) as z:
        for n, b in members.items():
            z.writestr(n, b)


meta = (b"\x80\x04}(" + s("ratio") + b"]G" + struct.pack(">d", 2.0) + b"a" + s("threshold") + b"]G"
        + struct.pack(">d", 10.0) + b"a" + s("samplerate") + b"G" + struct.pack(">d", 48000.0) + b"u.")
good_zip, bad_zip = os.path.join(TMP, "good.zip"), os.path.join(TMP, "bad.zip")
make_zip(good_zip, {"metadatas_train.pickle": meta, "metadatas_test.pickle": meta,
                    "data_test.pickle": benign(ins, outs), "data_train.pickle": benign(ins, outs)})
make_zip(bad_zip, {"metadatas_train.pickle": meta, "metadatas_test.pickle": meta,
                   "data_test.pickle": evil_bytes(_real["os.system"], "touch " + MARKER), "data_train.pickle": benign(ins, outs)})
out_good, out_bad = os.path.join(TMP, "good.json"), os.path.join(TMP, "sub", "bad.json")
sink = io.StringIO()
real_stdout, sys.stdout = sys.stdout, sink
try:
    rc_good = audit.main([good_zip, "--out", out_good])
    rc_bad = audit.main([bad_zip, "--out", out_bad])
finally:
    sys.stdout = real_stdout
check(rc_good == 0 and os.path.exists(out_good), "main(): benign archive audited, report written")
rep = json.load(open(out_good))
check(rep["converted_to_corpus"] is False and rep["labels"]["ratio"]["train_distinct_sorted"] == [2.0],
      "main(): report says nothing was converted; labels read")
check(rc_bad == 2 and not os.path.exists(out_bad), "main(): malicious member refused (exit 2), no report written")
check(not os.path.exists(MARKER), "marker file still absent after the whole run")
check(not TRIPPED, "no tripwire fired in the whole run (%s)" % TRIPPED)

shutil.rmtree(TMP, ignore_errors=True)
print("\n%s" % ("ALL PASSED" if not failures else "%d FAILED: %s" % (len(failures), failures)))
sys.exit(1 if failures else 0)

# CL 1B archive: layout, labels and alignment audit

Audit date: 2026-10-04. Slice A of [implementation-backlog.md](implementation-backlog.md). Archive: `data/research-datasets/cl1b/Dataset.zip` (Zenodo record 6497085, 6,640,085,182 bytes, MD5 and member CRCs already verified).

**Nothing was converted to a corpus.** No audio was exported, resampled, normalised or written anywhere; nothing here is a training or benchmark input yet. The audit read about 397 MiB of decompressed data (236.5 MiB of `data_test.pickle`, 160 MiB of `data_train.pickle`, about 1 KiB of metadata) and kept only summaries. The full report is `data/research-datasets/cl1b/layout-audit.json` (gitignored, regenerate it with the command below).

## How it was audited without running archive code

The members are Python pickles, and unpickling one can run arbitrary code, so `pickle.load` and `numpy.load(allow_pickle=True)` were never used. [`scripts/audit-cl1b.py`](../../scripts/audit-cl1b.py) reads the opcode stream itself:

- Only a short list of opcodes is understood. Any other (`INST`, `OBJ`, `NEWOBJ`, `EXT*`, `PERSID`, ...) stops the audit with a refusal.
- Only NumPy's array, dtype and scalar helpers (`numpy.core.multiarray._reconstruct` and `.scalar`, `numpy._core...` for NumPy 2, `numpy.ndarray`, `numpy.dtype`) and `builtins.list/tuple/dict` can be named. Anything else (`os.system`, `builtins.eval`, `subprocess.*`) is refused when it is named. Allowed calls are interpreted by the script into inert stubs; nothing is called.
- Object and structured dtypes are refused (their data would itself be pickled).
- Reads are bounded per member (240 MiB for the test data, 160 MiB for the train data, 1 MiB for metadata). Array payloads are streamed in 4 MiB chunks, hashed and summarised with `numpy.frombuffer`.
- Members are streamed with `zipfile`; nothing is extracted or copied.

[`scripts/audit-cl1b.test.py`](../../scripts/audit-cl1b.test.py) checks the safety property: it builds malicious pickles in memory (os.system through protocols 0, 2 and 4, `builtins.eval`, `builtins.exec`, `subprocess.Popen`, `NEWOBJ`, `OBJ`, `INST`, `EXT1`, `PERSID`, object and structured dtypes) and asserts each is refused, that no marker file appears and that tripwires on `os.system`, `subprocess.Popen` and friends never fire. It also reads a hand-assembled and a real NumPy layout.

```
python3 scripts/audit-cl1b.test.py
python3 scripts/audit-cl1b.py <path>/Dataset.zip --out data/research-datasets/cl1b/layout-audit.json
```

## What the archive contains

| Member | Bytes (uncompressed) | Holds |
| --- | ---: | --- |
| `data_train.pickle` | 6,696,002,571 | A dict starting with key `inp` (list of float64 arrays). See the table below for what was read and what is inferred. |
| `data_test.pickle` | 248,000,229 | A dict `{"inp": [array], "tar": [array]}`: one input and one target, read completely. |
| `metadatas_train.pickle` | 907 | Dict `ratio` (27 plain floats), `threshold` (27 NumPy float64 scalars), `samplerate` (float 48000.0). |
| `metadatas_test.pickle` | 177 | The same three keys with one entry each. |

All pickles are protocol 4, deflate-compressed in the zip. Every array read is `float64`, little-endian, one-dimensional, C order, shape `(15,500,000,)` (124,000,000 bytes), which at 48 kHz is 322.917 s. The second dict key in the test file is `tar` (target), not `out`.

Observed (ESTABLISHED) structure of the train member: the dict's first key is `inp`; its list is filled by a single batched append, and the first two arrays' payloads start at byte offsets 160 and 124,000,205 (a 45-byte header between them, so the second array is the next element of the same list). The arrays that follow, and the `tar` list, were not read (budget); see the table.

Size arithmetic (consistency, not observation): 54 arrays of 124,000,000 bytes is 6,696,000,000, leaving 2,571 bytes for headers, and the test member has 229 bytes of non-payload for 2 arrays. Estimating the train overhead from the observed headers (160-byte prefix, 45 bytes between arrays of one list, about 54 bytes at the `inp` to `tar` switch, about 16 bytes of tail) gives about 2,580 bytes, within a few bytes of 2,571. So 27 `inp` plus 27 `tar` arrays of equal length is consistent. Together with the test member that is 56 arrays, 28 recordings of an input and its target.

## Labels

Only `ratio` and `threshold` exist, plus `samplerate`. No attack, release, gain, name, id or source field exists in either metadata file. Neither the label lists nor the arrays carry any identifier: the pairing is purely positional.

| Field | Train (27 entries) | Test (1 entry) |
| --- | --- | --- |
| `ratio` raw | 2.0 (x4), 6.0 (x4), 10.0 (x4), 33.3 (x3), 46.6 (x4), 73.3 (x4), 86.6 (x4) | 33.3 |
| `threshold` raw | 10.0 (x7), 20.0 (x7), 30.0 (x6), 40.0 (x7) | 30.0 |
| `samplerate` | 48000.0 | 48000.0 |

The 27 train `(ratio, threshold)` pairs are all distinct, and the test pair (33.3, 30.0) is the one missing from the 7 x 4 grid, so the 28 recordings cover the full grid exactly once. In train order the labels are `ratio = [73.3, 6, 2, 46.6, 6, 73.3, 33.3, 10, 6, 73.3, 86.6, 46.6, 86.6, 33.3, 10, 10, 2, 86.6, 2, 33.3, 10, 6, 73.3, 46.6, 86.6, 46.6, 2]` and `threshold = [30, 30, 10, 10, 20, 20, 10, 10, 40, 40, 10, 40, 20, 20, 20, 30, 40, 30, 30, 40, 40, 10, 10, 20, 40, 30, 20]`.

## What the original publications say (and do not)

The Zenodo record has no description: no parameter definitions, units, sampling rate, pairing or split information. Documentation comes from the authors' papers, which are not the archive:

- Simionato and Fasciani, "Deep learning conditioned modeling of optical compression", DAFx 2022 (the paper behind this record). The device is the TUBE-TECH CL 1B. The input is one mono signal of 332 s (frequency sweeps 20 Hz to 20 kHz, white noise with linear and logarithmic amplitude ramps, guitar, bass and drums from Fraunhofer IDMT, at varied amplitudes). Capture used a MOTU M4 in loopback: the interface's left input recorded its own left output, and the right input recorded the compressor's output, "compensating for the minor sound coloring and latency of the audio interface". Recorded at 96 kHz and downsampled to 48 kHz. Ratio: 7 equally spaced values from 2:1 to 10:1 (the text names 3.33:1, 4.66:1 and 7.33:1). Threshold: -10 to -40 dBu in 10 dB steps. Attack 0.5 ms, release 50 ms and output gain 0 dBu fixed. "28 permutations of ratio and threshold", 2.58 hours. The 3.33:1 / -30 dBu recordings are held out for testing, with a further 32 s portion of sounds also used only for testing.
- Simionato and Fasciani, DAFx 2023: cites this Zenodo record as the CL 1B dataset but describes an expansion to 625 combinations (ratio, threshold, attack, release, 5 values each, about 36 hours, 210 s each). The expansion is not this archive: 36 hours of float64 at 48 kHz would be hundreds of GB.

## Findings measured from the arrays

| Measurement | Result |
| --- | --- |
| Value scale | Not normalised to +-1. Test input peaks at 16,144 and RMS is 1,664 (64.4 dB re 1.0); test target peaks at 6,835, RMS 470 (53.4 dB). No sample is an integer value (0.0 integer-valued fraction), no NaN/inf. The scale convention (for example 32768-scaled PCM converted to float) is not stated anywhere. |
| Segments inside an array | One continuous 322.9 s recording per array, no markers or boundaries. The per-second RMS envelope shows rising ramps (about 38 to 75 dB over roughly 8 s, repeated) and, later, irregular levels at 45 to 60 dB. That is consistent with the paper's sweeps, noise ramps and instrument material; it was not listened to or segmented. |
| Test input vs train inputs | Not the same file. The test input and the start of the second train input match at lag 0 with correlation 0.9999 or better in every window checked and a -36.5 dB residual (a separate loopback capture of the same program, not bit-identical). The first train input differs from both by a constant 96 samples (2 ms) in 7 of 7 windows, with a -25 dB residual after shifting. |
| Test input/target alignment | Best cross-correlation lag per 2^17-sample window: 0, -22, 0, -2, 0, -5, -2 samples (median -2, about -0.04 ms), correlations 0.90 to 0.98 (below 1 because the target is compressed). So the pair is aligned to within about 0.5 ms (22 samples). No stored offset exists. |
| Level relation, test pair (settings 33.3 and 30) | 100 ms block RMS medians: gain is about +0.8 dB for inputs from 13 to 37 dB re stored unit, falling from about 40 dB, to about -14 dB at 73 to 76 dB. The local slope (dB out per dB in, over 12 dB spans) is about 1.0 for inputs of 13 to about 35 dB and falls to 0.43 to 0.47 at the top (still decreasing), not near 0.03 (33:1) and above 1/3.33 = 0.30. Soft knee and 100 ms block averaging blur this: evidence only, not a measured ratio. |
| Input to output pairing and the split | Within test, `inp[0]` pairs with `tar[0]` by dict key and the measured correlation. For train, only `inp[0]` and a 44 MB prefix of the second array were read: `tar[i]`, the position of `tar` and its pairing with `ratio[i]`/`threshold[i]` are inferred from counts and sizes. |

## ESTABLISHED / UNRESOLVED / CANNOT TELL

| Question | Status | Basis |
| --- | --- | --- |
| Members, sizes, protocol, allow-listed opcode/global set | ESTABLISHED | zip directory, static parse; nothing off the list appeared |
| Array dtype, shape, order | ESTABLISHED for `inp[0]`, the second train array and both test arrays | headers parsed, payload sizes match shape x 8 |
| Test member holds exactly one `inp` and one `tar` array of 15.5 M samples | ESTABLISHED | parsed to STOP |
| Sample rate is 48 kHz; labels are exactly ratio and threshold; no attack/release/gain label fields | ESTABLISHED | metadata parsed |
| 28 recordings: 27 train labels plus 1 test, a full 7 x 4 grid with each pair once | ESTABLISHED (labels) | metadata |
| Test pair (33.3, 30.0) is a held-out setting, not in train | ESTABLISHED (labels) | metadata |
| Test audio is not unseen audio: the same 323 s program is played at every setting | ESTABLISHED | test input matches the second train input at correlation 0.9999 or better |
| Test input and target are time-aligned to within 0.5 ms | ESTABLISHED for the test pair only | cross-correlation, 7 windows |
| Input arrays are separate captures, not one shared file | ESTABLISHED | bit differences, -36.5 dB residual |
| The first train input is offset 96 samples from the others | ESTABLISHED | constant lag in all windows |
| Which of those inputs the target of each pair was aligned to, and whether `tar[0]` of train carries the same 96-sample offset | UNRESOLVED | the train targets were not read |
| Train member holds 27 `inp` and 27 `tar` arrays in that order, all 15.5 M samples | UNRESOLVED | consistent with size arithmetic (about 2,580 estimated vs 2,571 bytes of overhead), not read to the end |
| Position `i` of `ratio`/`threshold` belongs to `inp[i]`/`tar[i]` | UNRESOLVED | no ids anywhere; only a positional convention is plausible, and it can be tested by measuring each train target's compression curve against its label |
| Ratio raw value to physical ratio | UNRESOLVED | see below |
| Threshold raw value is the magnitude of dBu (10 means -10 dBu) | UNRESOLVED (likely) | the 2022 paper's -10 to -40 dBu in 10 dB steps matches {10,20,30,40}; the archive does not say the sign was dropped or that the unit is dBu |
| Attack 0.5 ms, release 50 ms, output gain 0 dBu fixed | CANNOT TELL from the archive | stated only in the 2022 paper; no field, and `tar` was never measured for it |
| Level calibration: what stored value or dBFS equals the paper's dBu thresholds | CANNOT TELL | scale of the floats unstated; the audio-interface calibration is not published |
| Latency: the paper compensated the interface by loopback; no offset or residual latency is recorded in the files | UNRESOLVED | measured about 0 to 22 samples for the test pair only |
| Sample-rate chain (96 kHz to 48 kHz) and bit depth of the source | CANNOT TELL | paper only; floats are non-integer |
| Duration: paper says 332 s, arrays are 322.917 s | UNRESOLVED | 28 x 332 s is the paper's 2.58 h; 28 x 322.9 s is 2.51 h. Typo, trimming or a different file: not known |
| The 32 s extra generalisation test set from the paper | CANNOT TELL (probably absent) | `data_test.pickle` holds one 323 s pair and was read fully; nothing else is in the archive |
| Whether this is the later 625-combination dataset | ESTABLISHED: no | one attack and release only, 28 settings, 6.9 GB uncompressed |
| Licence | Per record: CC BY 4.0 | the Zenodo record's metadata (not audited further) |

### The ratio labels

The seven raw ratio values are 2.0, 6.0, 10.0, 33.3, 46.6, 73.3 and 86.6. The paper's seven equally spaced ratios from 2:1 to 10:1 are 2, 3.33, 4.67, 6, 7.33, 8.67 and 10, with 3.33, 4.66 and 7.33 quoted. The raw values equal that set for the integers and 10 times it for the rest (33.3 for 3.33, 46.6 for 4.66, 73.3 for 7.33, 86.6 for 8.66). The raw values therefore cannot be read as a single scale. They are also not in ratio order: sorted raw (2, 6, 10, 33.3, 46.6, 73.3, 86.6) puts 6:1 and 10:1 below 3.33:1. A model fed raw numbers as a continuous control, or code that sorts or interpolates on them, would be wrong. A lookup would have to be used, and the mapping `{2:2, 6:6, 10:10, 33.3:3.33, 46.6:4.66, 73.3:7.33, 86.6:8.66}` is a hypothesis: it is the only one-to-one fit to the paper's seven values, and the test target's compression is gentle (slope 0.43 to 0.47 at the top, not limiter-like) as 3.33:1 would suggest, but nothing in the archive defines it, and the measured curve cannot tell 3.33:1 from 2:1 or 4.66:1. The ratio stays UNRESOLVED until each train target's curve is measured against its label (needs the whole train member) or the authors confirm.

## Consequences for the next steps

- Do not publish or ingest these labels as physical settings. Keep `ratio_raw` and `threshold_raw` and record the hypotheses beside them as hypotheses.
- Alignment must be measured per pair; it cannot be taken as zero or as a fixed lag. At least one train input (index 0) is offset by 96 samples from its siblings.
- A fair evaluation split is by setting (as the authors did), but it is the same programme material in train and test, so held-out audio generalisation cannot be claimed from it.
- To close the open rows: read the whole train member once (about 6.7 GB decompressed; roughly 20 s of decompression, extrapolated from 1.3 s for the 400 MB read here), for example with `--budget-mib data_train.pickle=6400`, extended to keep each input/target pair's windows. That is a decision for whoever owns the download budget; this audit stopped at the agreed few hundred MB.

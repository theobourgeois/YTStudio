# MixParams reviewed reference subset

Slice A of the [implementation backlog](implementation-backlog.md): choose a small, reviewed part of [MixParams](dataset-research.md) to show as examples, instead of exposing all 2,345 rows as settings the assistant might apply. Code: `shared/music/mix-reference.ts` (pure, tested in `mix-reference.test.ts`); the run: `scripts/select-mixparams.ts`.

```bash
pnpm tsx scripts/select-mixparams.ts [--data <dir>] [--out <dir>] [--seed <text>] [--test-fraction 0.25]
```

It reads `train/dev/test.jsonl` from the dataset folder (default `./data/research-datasets/mixparams`) and writes `reviewed-subset.jsonl` and `reviewed-subset-summary.json` beside them, with the source files' SHA-256s. It refuses any output folder that isn't inside a folder called `data` (and, inside a git checkout, anything but the checkout's own git-ignored `data/`). **MixParams has no explicit licence, so no row, and no record derived from one, goes in the repository**: only code, tests on invented rows, and this document.

## What a record is

One record per *compressor in a track's chain* (a track can have up to three), by the dataset's own words:

- `id`: `mxp_` + a hash of song, mix, track, place in the chain and the entry's content. The same entry gives the same id in any order.
- `recordingFamilyId`: the **song** (`song_old-tree`). Mixes reuse the same source songs, so a mix is not an independent recording.
- `plugin`: the label as given (`Channel Strip`). Not a certified identity.
- `nativeValues`: every entry the annotator wrote except the name, **exactly as written** (`"ratio": "3.0:1"`, `attack: 0.1`), under the key as spelled (`thres`) and the normalised key (`thresh`, `thres`, `threshold` are `threshold`). Nothing is converted; `settings` holds parsed numbers only for the checks and for display, and is not a unit claim. Attack and release are always kept.
- `readability`, per value: `annotated` (a person typed it) or `unavailable` (key present, no value). The dataset doesn't say which individual values were estimated by eye, so `estimated` is never assigned, and `exact` never is: nothing here is a readout.
- `unitStatus: "unverified"`, always. Whether a number is a knob position, dB or ms is unresolved per plugin; do not read attack/release as milliseconds.
- `missing`: which of threshold, ratio, attack, release, gain, knee have no value.
- `eligibility`: `retrievalDisplay: true` for every kept record; **`executableProposal: false` and `training: false` on all of them, in the type itself.** No record can become an instruction in this slice.

## Criteria (data quality only)

Row-level checks run in this order and stop at the first failure; the compressor-level checks are all collected.

1. Song, mix and track names present (`missingIdentity`).
2. Track type is VOCALS (`notVocal`), with subtype LEAD or BACKGROUND (`inconsistentSubtype`: the one VOCALS row labelled ELECTRIC).
3. Role is selected: **lead vocal** only by default; backing vocals are `roleNotSelected` (`roles` option lifts it).
4. `parameters` parses to an object (`invalidParameters`; none in the data) with a non-empty `compression` list (`noCompression`).
5. For each compressor: an object with a name (`invalidEntry`); a recognised compressor label (`unrecognisedPlugin`: Compressor/Limiter, Channel Strip, Compressor, BF-76, UAD 1176SE, BF-3A; Maxim is a limiter); a finite threshold (`missingThreshold`, `nonFiniteValue`) and a ratio written `N:1` or as a number (`missingRatio`, `ratioNotNumeric`: `LMTR` is a limit-mode label, not a ratio); no two keys that normalise to the same field (`conflictingKeys`); not identical to one already kept (`duplicate`).

The criteria say nothing about whether a setting is good or suits a voice.

## Numbers from the real data (revision `df15a107…`)

| Step | Rows | Left |
| --- | --- | --- |
| All rows | 2,345 | |
| Not a vocal track (`notVocal`) | -1,701 | 644 |
| Inconsistent subtype (`inconsistentSubtype`) | -1 | 643 |
| Background vocals (`roleNotSelected`) | -450 | 193 lead |
| No compression entries (`noCompression`) | -53 | 140 lead rows with compression |

Those 140 rows hold 164 compressor entries; 143 became records (from 128 rows). The other 21 entries were left out: 12 `missingThreshold` (all BF-76: it has input/output knobs, no threshold), 7 with neither threshold nor ratio (three plugin names with no settings, four entries with only gain/pan), 1 `ratioNotNumeric` (`LMTR`), 1 `duplicate` (an identical track row that the dataset has in both train and test).

Kept: 143 records, **all lead vocal**, from 72 song/mix pairs and all 13 songs. By plugin: Channel Strip 64, Compressor/Limiter 57, Compressor 22. Chains: 110 single compressors, 25 in two-compressor chains, 8 in three. Values: 919, all `annotated`; the only missing core field is `knee` (3 records, all Compressor). Attack and release are present on all of them.

Per song (records): Under A Covered Sky 21, Red To Blue 21, Not Alone 18, I'd Like To Know 13, You & Me & the Radio 13, Vermont 11, In The Meantime 10, Lolita 10, Lead Me 9, Pouring Room 9, Old Tree 4, Good Time 2, Sea Of Leaves 2. By genre label: pop rock 39, rock 23, pop 21, country 18, soul 18, funk 10, hard rock 10, indie rock 4.

Lead vs background, for reference: of the 395 vocal rows with compression, 140 are lead and 254 background (1 ELECTRIC); backing vocals are left out by default, not because they are bad data.

## Splits

The dataset's own splits are not independent: all 13 songs appear in train, dev and test, and two song/mix/track keys repeat across them. `splitByRecordingFamily(records, { seed, testFraction, devFraction })` assigns **whole songs**: songs are ordered by a hash of the seed and the song, the first go to test, the next to dev, the rest to train (at least one stays in train). It depends on the songs, not on the order of the records. With the script's default (seed `mixparams-reference-v1`, 25%) three songs (Lead Me, You & Me & the Radio, Not Alone; 40 records) are test and ten (103 records) are train. With 13 songs this is a convenience for later experiments, not a statistically meaningful held-out set.

## Discrepancies and limits

- **13 songs and 90 song/mix pairs** are in the files; the paper describes 114 mixes. We cannot certify 114 independent complete mixes: report what is on disk. 72 of the 90 pairs have a kept record.
- Settings are a person's annotation of a plugin's end state: visually estimated where there was no numeric display, some fields missing, no automation (the paper's Appendix H). A threshold of `-30` is not shown to be dB.
- Plugin labels such as Channel Strip are not mapped to a known processor; knob scales differ by plugin.
- Genre coverage: country, pop rock, rock, funk, pop, soul, indie rock, hard rock. **No hip-hop or trap**, so nothing here represents vocals on modern stereo beats.
- 143 records are not 143 independent engineers or voices: mixes reuse songs, and a chain can give several records for one track.
- **Licence unresolved**: no explicit licence on the card. Research use only; not for redistribution or training until that is settled. The source audio has its own terms and isn't included.

## Using it later

A future slice may *show* records, when a task is close (a lead vocal, a similar compressor), as "a human set this on this plugin, in these native values, units unverified", beside the licence and readability notes, to inform a reader or a model. It must not apply them, convert them to our Pro-C's controls, quote their attack and release as milliseconds, or train on them. Making any record executable needs, first: a licence, per-plugin unit verification, and the source and mixed audio joined and checked.

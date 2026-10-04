# Dataset comparison, access, and downloaded audit

Research date: 2026-10-03. Data downloads only; no ingestion, model training, or application implementation.

## Recommendation for this project

**MixParams is the best small starting resource found for readable human mixing/compressor settings.** Combine it with selected Mix Evaluation Dataset audio and evaluations later. It is not a complete training set on its own: source audio is external, coverage is limited, parameter units need validation, and not every annotation is a direct exact numerical readout.

For learning compressor behavior, **CL 1B** is a useful next investigation. The later paper describes an expanded four-control dataset, but inspection of the available 2022 archive finds only ratio and threshold labels. Do not assume this download includes that expansion. Neither controlled compressor resource supplies artistic-preference labels. [CL 1B paper](https://www.dafx.de/paper-archive/2023/DAFx23_paper_10.pdf)

No purchase is necessary to start. No paid dataset was verified in this search to be a better match for the specific requirement of accessible, readable human mix parameters. Provider inference/training compute costs remain separate from dataset prices.

## Price, accessibility, and suitability

Sizes are decimal bytes/MB/GB. Small metadata sizes exclude associated audio. Access was tested anonymously where possible; no account agreements or paid purchases were made.

| Resource | Download price | Size/access checked | Suitability and current action |
| --- | --- | --- | --- |
| [MixParams](https://huggingface.co/datasets/mclemcrew/MixParams) | $0 for public files | 284,870 bytes of Parquet; ungated | Best settings starter. All three splits and card downloaded; full row audit performed. Audio not included. License absent from this repository card. |
| [Mix Evaluation Dataset 2.0](https://huggingface.co/datasets/sparrowreivun/Mix-Evaluation-Dataset-2.0) | $0 for public files | Current inspected non-hidden files total ~26.09 GB; web listing advertises ~191 GB | Best complementary mixing/evaluation source. Availability varies by song. Downloaded only 232 KB of selected schemas, summaries, and feature/rating CSVs; no full audio archive. |
| [CL 1B optical compressor](https://zenodo.org/records/6497085) | $0 | One 6.64 GB ZIP; open; repository metadata declares CC BY 4.0 | Authorised full download complete; published MD5 and all ZIP CRCs verified. Four pickle files, ratio/threshold labels, 48 kHz metadata. No attack/release labels found. Arrays and physical parameter mappings still need investigation. |
| [SignalTrain LA-2A](https://zenodo.org/records/3348083) | $0 | One 21.00 GB archive; open; repository metadata declares CC BY 4.0 | Good LA-2A behavior data, but record varies Peak Reduction while other knobs stay fixed. Does not supply freely varied threshold/ratio/attack/release choices. Not downloaded. |
| [SolidStateBusComp](https://huggingface.co/datasets/amphion/SolidStateBusComp) | No listed purchase price | Manual access gate; contact details/terms required; repository storage API reports ~4.8 TB | Extensive parameter-controlled SSL bus-compressor data. CC BY-NC 4.0 and upstream restrictions; poor first choice for this small, accessible product starter. Not downloaded. |
| [MixAssist](https://huggingface.co/datasets/mclemcrew/MixAssist) | $0 for public files | 192,053 bytes of Parquet; ungated; latest Zenodo audio files total 2.46 GB | Complement for dialogue/explanations, not a complete compressor-settings database. Metadata/text splits downloaded; full audio skipped. HF card lacks license; latest audio archive declares CC BY 4.0. |
| [MixologyDB](https://huggingface.co/datasets/mclemcrew/MixologyDB) | $0 | Public 17,545-byte example JSON plus card; MIT declared | Current downloadable repository contains one example mix with 25 tracks, not the promised full collection. Downloaded as a schema/example reference, not a substantial independent training set. |
| [ToneTwist Audacity compressor](https://zenodo.org/records/20213871) | $0 | 442.29 MB ZIP; open; CC BY 4.0 declared in repository metadata | Before/after guitar/bass material at documented fixed settings. Lower fit than variable-parameter or human-choice datasets; archive skipped. |

Mix Evaluation's advertised storage and current-tree totals differ; do not promise either as a precise download bill. Select files by actual inventory and size. Current repository contains audio, evaluations/features, and limited native-session material rather than a uniformly complete session for every mix. Its release card explicitly notes uneven availability. [Release description](https://huggingface.co/datasets/sparrowreivun/Mix-Evaluation-Dataset-2.0)

SolidStateBusComp's primary project describes 220 parameter combinations. The host gates files and declares noncommercial conditions. No access request was submitted. [Project](https://www.yichenggu.com/SolidStateBusComp/), [access terms](https://huggingface.co/datasets/amphion/SolidStateBusComp)

MixologyDB's own card states no fees and MIT distribution, but inspection of its pinned tree confirms only `track-example.json` is currently available. Do not inherit its license automatically onto MixParams or third-party audio. [MixologyDB card](https://huggingface.co/datasets/mclemcrew/MixologyDB)

## What the MixParams download actually contains

The pinned downloaded revision is `df15a107cf86ed46793df859daf43d5f24b142fd`. Original Parquet files were size-checked and their SHA-256 hashes matched repository LFS content hashes. All 2,345 rows were additionally fetched from the public viewer API without truncated cells and exported as readable JSONL. This is a local data audit, not a model-quality evaluation.

| Audit | Result |
| --- | --- |
| Track-level rows | 2,345 |
| Splits | 1,545 train; 300 dev; 500 test |
| Unique song labels | 13 |
| Unique song/mix-label pairs | 90 |
| Tracks labeled VOCALS | 644 |
| Tracks with compression annotations | 1,221 |
| Vocal tracks with compression annotations | 395 |
| Those vocal records with settings beyond just a plugin name | 391 |
| Vocal records with at least one attack/release/ratio/threshold entry | 376 |
| Compressed vocal subtype labels | 140 lead; 254 background; 1 inconsistent ELECTRIC label |
| Invalid JSON in `parameters` | 0 |

Observed compressor labels include Compressor/Limiter, Channel Strip, Compressor, BF-76, UAD 1176SE, BF-3A, and Maxim. Some labels have only a name, not settings. A “compression present” count therefore must not be presented as the count of complete parameter examples.

Genre labels in the actual files are country, pop rock, rock, funk, pop, soul, indie rock, and hard rock. There is no hip-hop/trap label. This limits how directly examples represent vocals on modern stereo beats.

Important distinction: 395 vocal rows are not 395 independent singers/recordings. Multiple mixes reuse the same source songs. All 13 song names occur across all split pairs; two song/mix/track keys also overlap train/test. Re-split by song/recording family for meaningful generalization evaluation.

## Data quality and rights findings

The paper describes manual settings annotation, visual estimation when numeric displays were unavailable, missing fields, and omission of dynamic automation. Settings can describe a snapshot/end state rather than the complete time-varying chain. Some plugin labels present in the actual download also require closer inspection against the paper's stated native-plugin emphasis. [MixParams methods, Appendix H](https://arxiv.org/html/2507.06329v1)

There is a discrepancy between the paper's 114 mixes and the downloaded data's 90 unique song/mix-label pairs. We cannot certify 114 independent complete mixes from the available rows. Preserve this discrepancy rather than silently inflating counts.

Normalize `thresh`/`thres` names without changing native values; distinguish knob positions from physical units, and validate mappings per plugin. Numeric entry presence alone does not establish exact units or annotation accuracy. Keep missing data and estimator provenance visible.

Free download does not establish unrestricted commercial training rights. MixParams' current card has no explicit license. Its related MIT-labeled example is not a substitute for a MixParams license. The source audio has its own terms. These downloaded copies are research material pending a clear license record for product training.

Mix Evaluation combines recordings from different sources. The original paper identifies Creative Commons material and external libraries, with session/stem availability depending on the recording. Evaluate rights and pairing per song rather than assigning one blanket license to the entire collection. [Original dataset paper](https://www.brechtdeman.com/publications/pdf/DAFx-17.pdf)

## Files downloaded locally

All downloads are under the ignored `data/research-datasets/` directory, keeping datasets out of source control:

- `mixparams/`: all original splits, source card, download manifest/checksums, readable split JSONL, `audit.json`, and `vocal-compression-examples.jsonl`.
- `med2-metadata/`: release card, relationship schema/summary, and 20 small feature/evaluation CSVs; no audio.
- `mixassist/`: original text/metadata splits, source card, and manifest; audio paths remain external.
- `mixologydb/`: original example JSON, source card, and manifest.
- `inventories/`: API snapshots for file sizes, revisions, access/license metadata, and source-release inventories.
- `cl1b/`: separately authorized large archive download, status/log, automatic checksum/ZIP verifier, preliminary archive audit, and static metadata disassemblies. The original small starter ZIP does not include this folder.

The compact starter ZIP includes the four downloaded resource folders and their audit/readme material, excluding large API inventories. No external source code or dataset-provided scripts were executed, no plugin was installed, and no model was trained.

## Practical next steps

1. Use the downloaded settings as a reference/retrieval prototype, retaining units, source mix, and missing-field status.
2. Resolve MixParams' specific license and map a small number of vocal records to actual source recordings and mixes. Confirm the input stage; filenames alone do not prove a raw/processed pair.
3. Join listener-rating metadata by song plus mix identity where verified. A human setting is an observed decision, not automatically a high-quality target.
4. Validate compressor unit mappings and compare annotations with selected native sessions before treating labels as exact.
5. The authorised CL 1B download is complete and checksum/CRC verified. Establish the audio array layout, alignment, and parameter units before selecting a small usable subset. The inspected metadata has 27 train label entries and one test entry; ratio labels include values such as 73.3, so do not treat them as physical ratios without the original encoding definition. No pickle payload has been executed. If variable attack/release coverage is required, locate the later expansion or generate controlled examples using cleared audio and known settings.

These steps require no capture script or extra technical work from the user's engineer friend. That rejected live-capture workflow is not a prerequisite for this dataset route.

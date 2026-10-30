# Classical DSP and knowledge-based (rule-based) automatic mixing and mastering, and the open-source tools that implement them

Current as of 2026-10-29. Dates are given for older papers. Licences come from each repository's GitHub licence field
unless stated otherwise. Some PDFs were read through `pdftotext`, which scrambled the column layout of several tables
(the KEAMS compression and EQ tables, the ISMIR 2014 loudness table). Where an instrument-to-rule mapping could not be
read reliably, the item says so.

## 1. Knowledge-engineered mixing (Queen Mary / C4DM and others): concrete rules for gain, pan, EQ, compression, reverb and subgrouping, and their listening-test results

### Takeaway
There is a consistent, citable rule base from Queen Mary's C4DM (Reiss, De Man, Mansbridge, Maddams, Ma, Perez-Gonzalez, Ronan; 2007 to 2018):
- loudness-based balance with a vocal about 3 LU under the mix;
- a −3 dB sine/cosine pan law, with lows, kick, snare, bass and lead vocal in the centre and higher frequencies panned wider;
- a high-pass filter on everything, ±3 dB EQ moves, and compression set from crest factor and percussivity;
- reverb about 14 LU under the mix, erring on less;
- subgroups by instrument type.

In listening tests, a rule-based system that knows instrument labels was statistically indistinguishable from professional mixes on its test songs. Purely low-level cross-adaptive systems usually come out between amateur and professional.

### Cited Findings

**Architecture and processing order (KEAMS: De Man & Reiss, AES 135, 2013; De Man PhD thesis, QMUL, 2017)**
- The knowledge-engineered automatic mixing system (KEAMS) uses a rule base plus an inference engine. Each rule has:
  - **tags**: the source, the instrument(s) or `generic`, the genre(s) or `all`, and the processor;
  - **rules**: parameter assignments;
  - **comments**.
  Example: `tags: authorX, kick drum, pop, rock, compressor` / `rules: ratio = 4.6; knee = 0; atime = 50; rtime = 1000; threshold = ch{track}.peak - 12.5;` — [De Man thesis](http://www.brechtdeman.com/publications/pdf/PhD-thesis.pdf); [AES e-lib 17011](https://www.aes.org/e-lib/browse.cfm?elib=17011)
- Processor order: high-pass filter (12 dB/oct), then dynamic range compressor, equaliser, fader and pan. The drum bus is treated as one instrument, then everything goes to the mix bus. The high-pass filter sits before the compressor so that low-frequency rumble doesn't drive the compressor. — [De Man thesis](http://www.brechtdeman.com/publications/pdf/PhD-thesis.pdf)
- Per-track measurements fed to the rules: channel count, RMS level, peak level, crest factor, ITU-R BS.1770 loudness, and an activity gate. Insert processors (HPF, compressor, EQ) are applied when a rule is read; level and pan are metadata applied at mixdown, after all rules. — [De Man thesis](http://www.brechtdeman.com/publications/pdf/PhD-thesis.pdf)
- The EQ and HPF are biquads (RBJ Audio-EQ-Cookbook) with peak and shelving modes. — [De Man thesis](http://www.brechtdeman.com/publications/pdf/PhD-thesis.pdf)

**Gain / level rules**
- KEAMS starts every track at equal loudness, then raises sources the literature says to raise (lead vocal) and lowers others (ambience microphones). Changes are absolute ("set level at x dB") or relative ("by x dB"). The literature gives almost no exact level values: a fader position means nothing without knowing the source, and RMS meters overestimate low frequencies. — [De Man thesis](http://www.brechtdeman.com/publications/pdf/PhD-thesis.pdf)
- Analysis of real engineer mixes (De Man et al., ISMIR 2014):
  - the lead vocal sat at −2.7 ± 1.6 LU relative to the mix;
  - the "equal loudness for all sources" assumption used by many automatic faders was contradicted.

  — [De Man ISMIR 2014](https://archives.ismir.net/ismir2014/paper/000293.pdf)
- Revised rules, thesis Table 6.1:
  - "Vocal loudness should be around −3 LU relative to the total mix."
  - "Median total drums loudness is between −6.5 LU and −8.5 LU" (song- or genre-dependent).
  - "Median bass loudness is between −8 LU and −9 LU."

  — [De Man thesis](http://www.brechtdeman.com/publications/pdf/PhD-thesis.pdf)
- ISMIR 2014 table of per-instrument loudness relative to the mix: roughly kick −13.2, snare −16.8, other sources about −12.7, bass about −9.5 LU. The pdftotext column alignment is ambiguous, so treat these as approximate. — [De Man ISMIR 2014](https://archives.ismir.net/ismir2014/paper/000293.pdf)
- Activity gating (Mansbridge et al., AES 133, 2012): loudness and spectral features are computed only while a track is active, using a hysteresis gate that opens at −25 LUFS and closes at −30 LUFS. — [Mansbridge, Finn & Reiss 2012](https://joshreiss.github.io/documents/2012/MansbridgeFinnReiss-AES133-Autonomoussystemformultitrackstereopositioning.pdf)
- Automatic fader by loudness: Mansbridge, Finn & Reiss, "Implementation and evaluation of autonomous multi-track fader control", AES 132, 2012. — [AES e-lib 16226](https://www.aes.org/e-lib/browse.cfm?elib=16226)
- The early cross-adaptive gain approach (Perez-Gonzalez & Reiss, DAFx-07) made every track equally loud via a loudness model, with a feedback loop. — [Perez-Gonzalez & Reiss DAFx-07](https://joshreiss.github.io/documents/2007/PerezReiss-2007-DAFX.pdf)

**Pan rules**
- KEAMS uses the −3 dB equal-power sine/cosine law, with the pan pot P from −1 (left) to +1 (right):
  - gL = cos(π(P+1)/4)
  - gR = sin(π(P+1)/4)
  - so gL² + gR² = 1.

  — [De Man thesis](http://www.brechtdeman.com/publications/pdf/PhD-thesis.pdf)
- KEAMS pan table (Table 2.4):
  - kick: centre;
  - snare: same place as in the overheads, panned in proportion to its correlation with the left and right overheads;
  - toms: 10:00, 13:00 and 14:00;
  - overheads: 70% wide around the centre;
  - cymbals: ride 15:00, crashes 9:00 and 14:00;
  - hi-hat: 14:30 to 15:30;
  - bass: centre;
  - guitars: opposite sides if more than one;
  - keys: spread if stereo and there's no other harmony instrument;
  - lead vocal: very slightly off-centre;
  - backing vocals: spread.

  Clock positions run from 7:00 (full left) to 17:00 (full right), with 12:00 as centre. Another rule: no two instruments at exactly the same position. — [De Man thesis](http://www.brechtdeman.com/publications/pdf/PhD-thesis.pdf)
- Revised pan rules from analysis:
  - lead vocals, snare and low-frequency sources centred;
  - "Higher frequencies are panned increasingly further between 50 Hz and 400 Hz";
  - the centre of the image should be strong enough;
  - a mix should not be overly mono.

  — [De Man thesis](http://www.brechtdeman.com/publications/pdf/PhD-thesis.pdf); [De Man ISMIR 2014](https://archives.ismir.net/ismir2014/paper/000293.pdf)
- Mansbridge autonomous panner (AES 133, 2012):
  - pan width scales with each track's spectral centroid, so tracks below about 200 Hz stay in the centre and the lead stays in the centre;
  - each track is placed on the opposite side from the track with the nearest centroid, to balance the spectrum left and right;
  - FFT of at least 2048 points;
  - a user width parameter from 0 to 10 (default 5);
  - re-placement when the mean position drifts more than 0.2;
  - a 4-band left/right balance with Q 0.5 and a movement amount of 0.3.

  — [Mansbridge, Finn & Reiss 2012](https://joshreiss.github.io/documents/2012/MansbridgeFinnReiss-AES133-Autonomoussystemformultitrackstereopositioning.pdf)
- Perez-Gonzalez & Reiss's autonomous panner (EURASIP JASP, 2010) was rated comparable to a professional engineer's panning. — [Ten Years of Automatic Mixing (WIMP 2017)](https://www.open-access.bcu.ac.uk/4968/1/WIMP2017_DeManEtAl.pdf)

**EQ rules**
- KEAMS EQ:
  - a low cut on all tracks;
  - a default gain of ±3 dB when a source says "cut" or "boost" without a number ("seemed to work well during informal pilot tests");
  - Q chosen so the peak spans the region named (e.g. "1–2 kHz").

  — [De Man thesis](http://www.brechtdeman.com/publications/pdf/PhD-thesis.pdf)
- KEAMS EQ table (Table 2.2). The first rows extracted cleanly:
  - kick: cut below 30 Hz, boost 40–100 Hz;
  - snare: cut 100–400 Hz by 6–12 dB at Q > 4, and/or 300–600 Hz by 2–6 dB at Q > 4;
  - toms: boost 60–100 Hz;
  - overheads: boost 1–4 kHz;
  - cymbals: shelf cut at 10 kHz;
  - bass guitar: boost 120–240 Hz;
  - acoustic guitar: boost 1 kHz;
  - electric guitar: cut 1–2 kHz;
  - keyboard: boost 5 kHz;
  - lead vocal: boost 10 kHz.

  Further rows (low shelf below 60 Hz, 200 Hz boost, 200–400 Hz cut at Q > 4, 6 kHz boost, 1–5 kHz < 3 dB low-Q boost, 8–10 kHz 3–4 dB shelf boost, 12 kHz 3–6 dB boost, cut below 50 Hz or 500 Hz, and so on) belong to vocals, backing vocals and the mix bus, but the column extraction makes their exact assignment unreliable. — [De Man thesis](http://www.brechtdeman.com/publications/pdf/PhD-thesis.pdf)
- The thesis also keeps a glossary that maps descriptors (airy, muddy, thump, edge...) to frequency bands. For example "air" is variously 7–12 kHz, 8–12 kHz or 10–20 kHz depending on the source. — [De Man thesis](http://www.brechtdeman.com/publications/pdf/PhD-thesis.pdf)
- Revised rule: "The total mix tends to a particular target spectrum." Engineers reduced low-frequency energy on all tracks, and the kick spectrum was consistent across mixes. — [De Man thesis](http://www.brechtdeman.com/publications/pdf/PhD-thesis.pdf); [De Man ISMIR 2014](https://archives.ismir.net/ismir2014/paper/000293.pdf)
- Pestana & Reiss (2013/2014) measured the long-term average spectra of commercial music and turned engineers' best practices into rules for intelligent production. — [Pestana spectra, AES 17010](https://aes.org/publications/elibrary-page/?id=17010); [Pestana & Reiss 2014](https://researchgate.net/publication/274511230_Intelligent_audio_production_strategies_informed_by_best_practices); discussion in [Trevor Cox, "All about that bass"](http://trevorcox.me/all-about-what-bass)
- Perez-Gonzalez & Reiss, "Automatic equalization of multichannel audio using cross-adaptive methods", AES 127 (2009): an early cross-adaptive EQ. — [Ten Years of Automatic Mixing](https://www.open-access.bcu.ac.uk/4968/1/WIMP2017_DeManEtAl.pdf)

**Compression rules**
- KEAMS compression table (Table 2.1, literature rules; the instrument column is misaligned in extraction):
  - 5:1–10:1, hard knee, 5–15 dB reduction (listed against kick);
  - 1–5 ms attack, 200 ms release (peak sensing);
  - 6:1, slow to medium attack, release before the next snare hit;
  - 4:1–6:1, 12 dB reduction, 10 ms attack, 20–100 ms release;
  - 5:1 to ∞:1, 3–4 dB reduction, hard knee;
  - 4:1–8:1, hard knee, 5–10 dB reduction, attack 10–40 ms, release 100–500 ms (vocal-type);
  - lead vocal (rock): "uncompressed";
  - mix bus: 2:1–4:1, 3–6 dB reduction, slow attack and release, or 4:1, 4–6 dB reduction, soft knee 4 dB wide, release about 500 ms, RMS sensing;
  - a limiter (∞:1) at 0.3 dB.

  — [De Man thesis](http://www.brechtdeman.com/publications/pdf/PhD-thesis.pdf)
- Maddams, Finn & Reiss, DAFx-12 (2012): an autonomous cross-adaptive compressor that targets loudness range (LRA). It has two modes:
  - threshold mode: ratio ∞, knee = |T|;
  - ratio mode: knee 3 dB, threshold at RMS − 12 dB.

  Make-up gain matches loudness before and after. Each track's target is

  LRA_T(i) = LRA(i) − LRA_red · (LRA(i) − LRA_min)/(LRA_max − LRA_min)

  so the most dynamic tracks are compressed the most. Tested at 3, 6 and 9 LU of reduction; expert engineers averaged about −2.3 LU. "Heavy" compression was rated poor, and light threshold-mode compression tied with the expert. — [Maddams, Finn & Reiss DAFx-12](https://www.dafx.de/paper-archive/2012/papers/dafx12_submission_6.pdf)
- Ma, De Man, Reiss & Pestana, "Intelligent multitrack dynamic range compression", JAES 2015:
  - ratio R = 0.54·w_p + 0.764·w_f + 1, where w_p is percussivity and w_f the low-frequency weighting;
  - threshold T = −11.03 + 0.44·x_RMS − 4.987·w_p (dB);
  - knee W = |T|/2;
  - attack A = 2·A_max/C² and release R = 2·R_max/C², where C is the crest factor, A_max = 80 ms and R_max = 1000 ms;
  - make-up G = L_in − L_out (loudness-preserving).

  — [Ma et al. 2015](https://joshreiss.github.io/documents/2015/Ma%202015%20-%20Intelligent%20Multitrack%20Compression.pdf)
- Ma 2015's system rested on six assumptions drawn from best practice (in effect: compress more for percussive and low-frequency content, set timing from crest factor, preserve loudness). It beat semi-professional mixes on overall preference. An alternative that equalised loudness across tracks was rated worst. — [Ma et al. 2015](https://joshreiss.github.io/documents/2015/Ma%202015%20-%20Intelligent%20Multitrack%20Compression.pdf)
- Revised rule: "A mix should have sufficient dynamic range: it is better to err on the side of applying (too) little compression." Engineers also raised the crest factor of every track (less dense than raw) in the analysed mixes. — [De Man thesis](http://www.brechtdeman.com/publications/pdf/PhD-thesis.pdf); [De Man ISMIR 2014](https://archives.ismir.net/ismir2014/paper/000293.pdf)

**Reverb rules**
- When KEAMS was built, no automatic reverb effect had been developed, and the KEAMS test's listeners criticised a lack of blend from the missing reverb. — [De Man thesis](http://www.brechtdeman.com/publications/pdf/PhD-thesis.pdf)
- Revised rules:
  - "It is better to err on the side of too little reverb, rather than too much";
  - "The total reverb loudness should be about −14 LU" relative to the mix;
  - for more perceived reverberation, raise the reverb loudness and/or the reverb time.

  Mixes with reverb at or above about −9 LU were judged too wet. The JND of direct-to-reverberant ratio is about 5–6 dB. — [De Man thesis](http://www.brechtdeman.com/publications/pdf/PhD-thesis.pdf)
- In peer reviews of mixes, comments split as 35% level/balance, 29% space (58% of those about reverb), 25% spectral and 11% dynamics; 76% of comments were negative. — [De Man thesis](http://www.brechtdeman.com/publications/pdf/PhD-thesis.pdf)

**Subgrouping**
- "The number of subgroups created strongly depends on the number of tracks"; "Tracks are typically grouped per instrument type." — [De Man thesis](http://www.brechtdeman.com/publications/pdf/PhD-thesis.pdf)
- Ronan et al. (2018 arXiv, now withdrawn) found that automatic mixing with subgrouping reduced masking and was preferred to mixing without it. — [arXiv 1803.09960](https://arxiv.org/abs/1803.09960)

**Listening-test outcomes**
- KEAMS (AES 135, 2013; thesis ch. 2) showed "no significant difference in subjective preference from human mixes". It beat an instrument-agnostic automatic system. Weakness: it assumes the raw tracks meet spectral and dynamic norms (e.g. default guitar EQ applied to already bright guitars). — [De Man thesis](http://www.brechtdeman.com/publications/pdf/PhD-thesis.pdf)
- Systems that ignore instrument labels "can be unsatisfactory compared to mixes by human engineers or even an elementary rule-based system". Low-level features are still needed to handle deviant sources. — [De Man thesis](http://www.brechtdeman.com/publications/pdf/PhD-thesis.pdf)
- The Mansbridge panner was rated just below professional mixes. — [Mansbridge, Finn & Reiss 2012](https://joshreiss.github.io/documents/2012/MansbridgeFinnReiss-AES133-Autonomoussystemformultitrackstereopositioning.pdf)
- The 2017 review calls the field "in its infancy", held back by scarce data and evaluation. — [Ten Years of Automatic Mixing](https://www.open-access.bcu.ac.uk/4968/1/WIMP2017_DeManEtAl.pdf)

### Inferences
- The highest-value rules to implement first:
  1. loudness balance by instrument role (vocal −3 LU, drums −6.5 to −8.5 LU, bass −8 to −9 LU relative to the mix), measured with BS.1770 and gated to active regions;
  2. role-based panning (lows and lead centred, wider as frequency rises) with the sine/cosine law;
  3. HPF everything, plus gentle Ma-2015 compression;
  4. reverb send about −14 LU, erring dry.
- A DAW knows each channel's instrument and plugin from its preset or name. That is exactly the "semantic metadata" KEAMS found decisive, so the DAW can tag channels at no cost.
- Treat the literature EQ tables as *candidates* gated by measurement (check the band has an excess before cutting it). KEAMS's main failure was applying them blind.

### Gaps
- The exact per-instrument mapping of the KEAMS compression and lower EQ rows could not be recovered from the PDF text (column scrambling). The AES 135 paper itself (paywalled) would settle it.
- Mansbridge's fader-control listening scores (AES 132) weren't accessible (paywall).
- I found no rule-based automatic reverb with published listening tests (only the −14 LU target and the reverb-amount perception studies).

## 2. Masking: how it is measured and how automatic systems unmask

### Takeaway
Academic unmasking works by computing per-track, per-band masking with a psychoacoustic model, then optimising EQ (and sometimes dynamic EQ or panning) to minimise total masking:
- the models are an MPEG-style spreading model, or Glasberg–Moore excitation patterns and partial loudness on an ERB scale;
- the optimiser is particle swarm or a similar global search.

Such systems are rated near professional and better than amateur, but objective masking measures correlate poorly with what listeners prefer.

### Cited Findings
- Hafezi & Reiss, "Autonomous multitrack equalization based on masking reduction" (JAES 2015): a cross-adaptive EQ that reduces inter-track masking from a masking model. In listening tests it was close to professional mixes and better than amateur ones. The authors note objective masking measures were ill-suited to predicting preference. — [ResearchGate: Hafezi & Reiss 2015](https://www.researchgate.net/publication/277935370_Autonomous_Multitrack_Equalization_Based_on_Masking_Reduction)
- Ronan, Ma, Mac Namee & Reiss (2018) use an MPEG-psychoacoustic-model-inspired multitrack masking metric (masker-to-signal ratio per band across tracks) as the cost, optimised by particle swarm optimisation over EQ, compression and subgroup parameters. The arXiv paper is withdrawn; only partial v1 text is available. — [arXiv 1803.09960](https://arxiv.org/abs/1803.09960)
- A 2026 paper (Shi et al.) reports that a two-stage approach to automatic mixing beats a single-stage one. Only the summary claim was verified. — [arXiv 2609.02835](https://arxiv.org/abs/2609.02835)
- A Belmont MSc thesis implements and evaluates masking-based automatic EQ. — [Belmont repository](https://repository.belmont.edu/cgi/viewcontent.cgi?article=1003&context=msaetheses)
- The panning side of unmasking: Mansbridge places tracks with similar spectral centroids on opposite sides (spatial unmasking). — [Mansbridge, Finn & Reiss 2012](https://joshreiss.github.io/documents/2012/MansbridgeFinnReiss-AES133-Autonomoussystemformultitrackstereopositioning.pdf)

### Inferences
- For a DAW, a practical unmasking pass:
  1. compute each active track's ERB-band (or 1/3-octave) excitation per frame;
  2. for each pair, measure how often the masker band exceeds the target band by more than a threshold (MPEG-style masker-to-signal ratio);
  3. prioritise by role (vocal > lead > bass > pads);
  4. apply small cuts (≤ 3–6 dB) on the lower-priority track, as dynamic EQ keyed to the higher-priority one where possible.

  Keep it gentle: the evidence says unmasking metrics overreach perceptually.
- Commercial "unmask" features (iZotope Neutron's Mix Assistant/Unmask, sonible) follow this idea, but their algorithms are unpublished (see Gaps).

### Gaps
- No primary documentation was found of how iZotope Neutron's Unmask or sonible's smart:EQ cross-channel processing decides cuts.
- Detailed equations of Glasberg–Moore partial-loudness masking as used by Ward/Reiss and Wichern et al. (2015), and their listening results, weren't retrieved (paywalled).
- The detailed results of Shi 2026 weren't extracted.

## 3. Mastering DSP: 2026 loudness standards and streaming targets, multiband compression, limiting, mid/side, tonal targets, Matchering in detail, match EQ

### Takeaway
Measure with BS.1770 / EBU R128:
- integrated LUFS gated at −70 LUFS absolute and −10 LU relative;
- LRA as the 10th to 95th percentile of 3 s short-term loudness above a −20 LU relative gate;
- true peak.

Spotify normalises to −14 LUFS (Loud −11, Quiet −19) and asks for ≤ −1 dBTP, or −2 dBTP for masters louder than −14. YouTube turns down only, to about −14. Apple is about −16 by third-party report.

Matchering is the strongest open reference-based mastering algorithm (GPL-3.0). It matches loudest-section RMS and a smoothed mid/side spectrum to a reference with linear-phase FIRs, then limits with its "Hyrax" limiter. It placed 3rd of 12 in a blind test, behind 2 professional engineers.

### Cited Findings

**Loudness measurement**
- EBU Tech 3342 LRA:
  - sliding 3 s windows with at least 2.9 s overlap (rate ≥ 10 Hz);
  - an absolute gate at −70 LUFS, then a relative gate at −20 LU below the absolute-gated level;
  - LRA = the 95th percentile minus the 10th percentile of the gated distribution (the 10th keeps fade-outs from dominating; the 95th keeps a single loud event from dominating).
  - Revision V2 changed the integrated-loudness relative gate from −8 to −10 LU.

  — [EBU Tech 3342](https://tech.ebu.ch/docs/tech/tech3342.pdf)

**Streaming targets (2026)**
- Spotify:
  - normalises to −14 LUFS integrated by default, −11 LUFS in "Loud" mode, −19 LUFS in "Quiet" mode;
  - in Loud mode a limiter is applied (set to −1 dB sample values, 5 ms attack, 100 ms decay);
  - masters should stay below −1 dBTP, or −2 dBTP if louder than −14 LUFS, to avoid distortion in lossy encoding;
  - album normalisation is used when an album plays;
  - positive gain is limited by headroom (example: a track at −20 LUFS with a −5 dBTP peak is raised only to −16 LUFS, keeping the peak at −1 dBTP).

  — [Spotify for Artists: Loudness normalization](https://support.spotify.com/us/artists/article/loudness-normalization/)
- Apple Music (Sound Check) is about −16 LUFS according to third-party guides. No official Apple page was found. — [RoEx blog](https://www.roexaudio.com/blog/how-to-master-music-for-streaming-spotify-apple-music-deezer-youtube); [SoundBridge 2026 guide](https://www.soundbridge.io/mastering-for-streaming-your-2026-platform-guide); [RecordJet FAQ](https://faq.recordjet.com/en/articles/6959419-how-loud-should-my-master-be-what-are-the-store-requirements)
- YouTube is about −14 LUFS and only turns loud content down; it doesn't raise quiet content. — [Frame.io loudness for YouTube](https://workflow.frame.io/guide/loudness-for-youtube); [Shotcut forum](https://forum.shotcut.org/t/highest-possible-audio-quality-for-youtube/31825/12); contradicted (−13 LUFS) by [Lost Stories Academy](https://loststoriesacademy.com/blogs-and-tutorials/why-mastering-for-streaming-is-different-in-2025)
- Tidal: sources disagree on its target. — [Forasoft 2026 per-platform table](https://www.forasoft.com/learn/audio-for-video/articles-audio/lufs-targets-per-platform-2026) vs [Lost Stories Academy](https://loststoriesacademy.com/blogs-and-tutorials/why-mastering-for-streaming-is-different-in-2025)
- Context: because of normalisation, extra loudness beyond the platform target brings no playback-level gain on streaming. — [gearnews: loudness war](https://www.gearnews.com/loudness-war/)

**Tonal targets**
- iZotope Tonal Balance Control compares a master's spectrum with genre target curves (built from many commercial tracks) shown as ranges per band, and lets users build custom targets from reference tracks. — [iZotope TBC docs: meters and target curves](https://downloads.izotope.com/docs/tonal-balance-control/meters-and-target-curves/index.html); [Why iZotope created TBC](https://www.izotope.com/en/learn/why-izotope-created-the-tonal-balance-control-plug-in.html)
- Commercial mixes tend to a common long-term spectral target (Pestana; De Man). — [Pestana, AES 17010](https://aes.org/publications/elibrary-page/?id=17010); [De Man thesis](http://www.brechtdeman.com/publications/pdf/PhD-thesis.pdf)

**Matchering 2.0 in detail** ([sergree/matchering](https://github.com/sergree/matchering), GPL-3.0, Python ≥ 3.8, last pushed 2026-10-07, about 2.7k stars)
- Defaults:
  - internal sample rate 44100;
  - maximum length 15 min;
  - analysis piece 15 s;
  - clipping threshold (2^15 − 61)/2^15;
  - FFT size 4096;
  - lin-to-log oversampling 4;
  - 4 RMS correction steps;
  - LOWESS frac 0.0375, it 0, delta 0.001;
  - limiter attack 1 ms, hold 1 ms, release 3000 ms, attack filter coefficient −2, hold filter order 1 / coefficient 7, release filter order 1 / coefficient 800.

  — [matchering/defaults.py](https://raw.githubusercontent.com/sergree/matchering/master/matchering/defaults.py)
- Pipeline:
  1. Normalise the reference (keeping its coefficient for the end).
  2. Convert target and reference to mid/side.
  3. Split each into pieces of about 15 s (divisions = int(len/piece) + 1).
  4. Compute each piece's RMS; average = the RMS of the piece RMSes; the "loudest pieces" are those ≥ average; match_rms = the RMS over the loudest pieces.
  5. Level gain = ref_rms / max(eps, target_rms).
  6. Spectral match, separately for mid and side:
     - a non-overlapping boxcar STFT (n_fft 4096) and the average magnitude spectrum (target floored at 1e-6);
     - ratio = ref/target;
     - cubic interpolation onto a log-frequency grid of (fft/2)·4 + 1 points;
     - LOWESS smoothing;
     - interpolate back to linear and set DC to 0;
     - irfft, then ifftshift, then a Hann window, giving a **linear-phase FIR**.
  7. Run 4 RMS correction passes on a clipped copy of the mid (so the limiter's clipping is accounted for).
  8. Apply the Hyrax brickwall limiter, then the final normalisation coefficient.

  — [matchering/stages.py](https://raw.githubusercontent.com/sergree/matchering/master/matchering/stages.py); [stage_helpers/match_levels.py and match_frequencies.py](https://github.com/sergree/matchering)
- In Benn Jordan's blind mastering test, Matchering placed 3rd of 12, behind two professional engineers and ahead of commercial AI services (472 listener entries). The result depends on choosing a good reference. — [sergree/matchering README](https://github.com/sergree/matchering)

**Other open mastering DSP**
- FFmpeg loudnorm:
  - EBU R128 with defaults I = −24 LUFS, LRA = 7 LU, TP = −2 dBTP;
  - dynamic mode works internally at 192 kHz;
  - linear (true two-pass) mode needs the first-pass measured values (measured_I, measured_LRA, measured_TP, measured_thresh) and falls back to dynamic when the target can't be reached linearly.

  dynaudnorm: frame 500 ms, Gaussian window g 31, peak 0.95, maxgain 10. alimiter: attack 5 ms, release 50 ms, optional 2–4x oversampling for true-peak-style limiting. — [FFmpeg filters documentation](https://ffmpeg.org/ffmpeg-filters.html)
- phaselimiter / Bakuage automated mastering ("mastering5"):
  - optimises 72 effect parameters with differential evolution (DE-PRMM) or CMA-ES, starting from neutral settings;
  - scores against a sound-quality model built from a reference analysis dataset (`bakuage_dataset1`);
  - a separate detector picks a "classic" reference category (general, pop, jazz, classical) by LOF distances, explicitly not a genre classifier;
  - no listening tests reported; status inactive.

  — [ai-mastering/phaselimiter](https://github.com/ai-mastering/phaselimiter)

### Inferences
- A DAW master chain grounded in these sources:
  1. measure the integrated loudness (BS.1770, the two gates), LRA and true peak (4x oversampled);
  2. apply a smoothed spectral-ratio linear-phase EQ (Matchering's method) towards a reference track or a genre target curve, preferably separately for mid and side;
  3. apply gentle bus compression (2:1–4:1, 1–3 dB, slow attack, about 500 ms release, per the KEAMS mix-bus rules);
  4. apply a look-ahead true-peak limiter to the platform target (−14 LUFS / −1 dBTP for Spotify and YouTube; −16 for Apple), iterating the gain a few passes as Matchering does.
- Matchering is GPL-3.0. Shipping it or a port inside a closed app would impose GPL terms; reimplementing the published algorithm from the description is the usual way around that (not legal advice).
- Spotify's headroom-limited positive gain means a quiet, high-peak master is not raised fully. So limiting to about −14 LUFS with ≤ −1 dBTP is the safe default, and "Loud" or club targets (−9 to −11) are an option rather than the default.

### Gaps
- No primary sources were found giving concrete open-source multiband mastering compressor settings (crossovers, ratios) with listening validation. Practitioner settings exist but weren't sourced here.
- Official Apple Music and YouTube loudness documentation wasn't found; the values above are third-party.
- How the Hyrax limiter compares with true-peak (oversampled) limiters wasn't documented by the source.
- Neither the phaselimiter limiter's algorithm nor its "phase" aspect is described in its README.

## 4. Genre and target estimation (choosing what to aim for)

### Takeaway
The open rule-based literature mostly sidesteps genre: it uses either a reference track the user picks (Matchering, iZotope custom targets) or fixed best-practice targets. KEAMS tags rules by genre but relies on metadata, not classification. I found no published, validated method for estimating mastering targets from genre.

### Cited Findings
- KEAMS rules carry genre tags (e.g. `pop, rock`), and the inference engine applies only matching rules; the genre comes from metadata. — [De Man thesis](http://www.brechtdeman.com/publications/pdf/PhD-thesis.pdf)
- Drum loudness relative to the mix is "song- or genre-dependent". — [De Man thesis](http://www.brechtdeman.com/publications/pdf/PhD-thesis.pdf)
- iZotope Tonal Balance Control offers genre target curves and custom targets from user references. — [iZotope TBC docs](https://downloads.izotope.com/docs/tonal-balance-control/meters-and-target-curves/index.html)
- phaselimiter's detector picks among general/pop/jazz/classical reference sets by LOF distance and states that it does no genre classification. — [ai-mastering/phaselimiter](https://github.com/ai-mastering/phaselimiter)
- Matchering's quality depends on the reference the user supplies. — [sergree/matchering](https://github.com/sergree/matchering)

### Inferences
- In a DAW, the cheapest robust approach is to let the user drop a reference track (Matchering-style). Without one, fall back to a nearest-neighbour choice among a few built-in target curves, by spectral distance between the mix's long-term spectrum and each curve. That is essentially phaselimiter's LOF trick.
- Audio-tagging models (e.g. Essentia's genre classifiers) could pick targets, but Essentia is AGPL-3.0 (see section 6).

### Gaps
- No peer-reviewed evaluation was found of genre-classifier-driven mastering targets versus reference matching.
- No open dataset of per-genre target curves with known licence was found.

## 5. Mix analysis features used by these systems

### Takeaway
The features that recur:
- BS.1770 loudness (integrated, short-term, momentary), gated by an activity gate;
- RMS, peak and crest factor;
- LRA;
- spectral centroid and band energies (long-term average spectrum, 1/3-octave or ERB);
- percussivity and low-frequency weighting;
- inter-channel correlation (for panning and the stereo image);
- masking per band;
- reverb loudness relative to the mix.

### Cited Findings
- KEAMS measures per track: channels, RMS, peak, crest factor, BS.1770 loudness, and activity. — [De Man thesis](http://www.brechtdeman.com/publications/pdf/PhD-thesis.pdf)
- De Man's mix analysis uses loudness relative to the mix, crest factor, low-frequency energy, stereo panning as a function of frequency, and the spectrum against a target. — [De Man ISMIR 2014](https://archives.ismir.net/ismir2014/paper/000293.pdf)
- Ma 2015 sets compressor parameters from RMS level, crest factor, percussivity and the low-frequency weighting. — [Ma et al. 2015](https://joshreiss.github.io/documents/2015/Ma%202015%20-%20Intelligent%20Multitrack%20Compression.pdf)
- Mansbridge pans from spectral centroid (FFT ≥ 2048), with a −25/−30 LUFS hysteresis activity gate. — [Mansbridge, Finn & Reiss 2012](https://joshreiss.github.io/documents/2012/MansbridgeFinnReiss-AES133-Autonomoussystemformultitrackstereopositioning.pdf)
- Maddams uses per-track LRA. — [Maddams DAFx-12](https://www.dafx.de/paper-archive/2012/papers/dafx12_submission_6.pdf)
- KEAMS pans the snare by its correlation with the left and right overheads. — [De Man thesis](http://www.brechtdeman.com/publications/pdf/PhD-thesis.pdf)
- The amount of reverb is perceived from reverb loudness relative to the mix and from reverb time. — [De Man thesis](http://www.brechtdeman.com/publications/pdf/PhD-thesis.pdf)
- Libraries that compute these features: pyloudnorm (BS.1770, MIT), libebur128 (C, MIT), librosa (spectral features, ISC), Essentia (AGPL-3.0). — [csteinmetz1/pyloudnorm](https://github.com/csteinmetz1/pyloudnorm); [jiixyj/libebur128](https://github.com/jiixyj/libebur128); [librosa/librosa](https://github.com/librosa/librosa); [MTG/essentia](https://github.com/MTG/essentia)

### Inferences
- For a C++ engine, libebur128 (MIT) covers loudness, LRA and true peak. Centroid, band energies, crest and correlation are a few dozen lines on top of an FFT. All are cheap enough to compute on render or analysis passes.

### Gaps
- No standard "percussivity" definition was extracted from Ma 2015 beyond its use as a weight. The paper should be consulted for the exact feature.

## 6. Open-source tools and their licences

### Takeaway
There are permissive building blocks: libebur128 and pyloudnorm (MIT), librosa (ISC), Airwindows (MIT), pymixconsole (MIT), automix-toolkit and dasp-pytorch (Apache-2.0). The best complete reference-mastering tool, Matchering, is GPL-3.0. I found no maintained, high-quality open-source *rule-based* automatic mixer.

### Cited Findings
| Tool | What it is | Licence | Source |
|---|---|---|---|
| Matchering 2.0 | Reference-based mastering (RMS + M/S FIR match + limiter) | GPL-3.0 | [sergree/matchering](https://github.com/sergree/matchering) |
| phaselimiter / mastering5 | Limiter + optimisation-based automated mastering (C++) | README says "MIT"; GitHub's licence detection reported a non-standard/custom licence; bundled parts (libcmaes, NumPy code under BSD) have their own terms | [ai-mastering/phaselimiter](https://github.com/ai-mastering/phaselimiter) |
| pyloudnorm | BS.1770 loudness in Python | MIT | [csteinmetz1/pyloudnorm](https://github.com/csteinmetz1/pyloudnorm) |
| libebur128 | EBU R128 loudness, LRA, true peak (C) | MIT | [jiixyj/libebur128](https://github.com/jiixyj/libebur128) |
| FFmpeg (loudnorm, dynaudnorm, alimiter) | Loudness normalisation, limiting | LGPL-2.1+ (GPL with GPL parts enabled) | [FFmpeg/FFmpeg](https://github.com/FFmpeg/FFmpeg); [filters doc](https://ffmpeg.org/ffmpeg-filters.html) |
| pedalboard (Spotify) | Python audio effects | GPL-3.0 | [spotify/pedalboard](https://github.com/spotify/pedalboard) |
| Essentia | Audio analysis, classifiers | AGPL-3.0 | [MTG/essentia](https://github.com/MTG/essentia) |
| librosa | Audio feature extraction | ISC | [librosa/librosa](https://github.com/librosa/librosa) |
| LSP plugins | Compressors, limiters, EQs, multiband (LV2/VST/CLAP) | LGPL-3.0 | [lsp-plugins/lsp-plugins](https://github.com/lsp-plugins/lsp-plugins) |
| x42 dpl.lv2 | Digital peak (true-peak) limiter | GPL-3.0 | [x42/dpl.lv2](https://github.com/x42/dpl.lv2) |
| x42 meters.lv2 | Loudness and other meters | GPL-2.0 | [x42/meters.lv2](https://github.com/x42/meters.lv2) |
| Airwindows | Large set of mixing/mastering effects | MIT | [airwindows/airwindows](https://github.com/airwindows/airwindows) |
| Calf | Compressors, multiband, EQ | LGPL-2.1 | [calf-studio-gear/calf](https://github.com/calf-studio-gear/calf) |
| Squeezer / K-Meter (mzuther) | Compressor; K-System meter | GPL-3.0 | [mzuther/Squeezer](https://github.com/mzuther/Squeezer); [mzuther/K-Meter](https://github.com/mzuther/K-Meter) |
| pymixconsole | Python mixing console (EQ, comp, reverb, pan), used for automix research | MIT | [csteinmetz1/pymixconsole](https://github.com/csteinmetz1/pymixconsole) |
| automix-toolkit | Deep-learning automatic mixing models and training | Apache-2.0 | [csteinmetz1/automix-toolkit](https://github.com/csteinmetz1/automix-toolkit) |
| FxNorm-automix | Deep-learning automix with effects normalisation | MIT | [sony/FxNorm-automix](https://github.com/sony/FxNorm-automix) |
| dasp-pytorch | Differentiable audio signal processors | Apache-2.0 | [csteinmetz1/dasp-pytorch](https://github.com/csteinmetz1/dasp-pytorch) |

- automix-toolkit is deep learning (not rule-based). — [csteinmetz1/automix-toolkit](https://github.com/csteinmetz1/automix-toolkit)
- The 2017 review's bibliography lists the rule-based and cross-adaptive systems (Perez-Gonzalez, Mansbridge, Maddams, Ma, Hafezi, De Man), mostly published as papers rather than as maintained code. — [Ten Years of Automatic Mixing](https://www.open-access.bcu.ac.uk/4968/1/WIMP2017_DeManEtAl.pdf)

### Inferences
- For a native C++ engine in a possibly closed or commercial product, the safe set to link is:
  - libebur128 (MIT) for measurement;
  - Airwindows (MIT) DSP for effect algorithms;
  - your own implementations of the published formulas (Ma 2015, Mansbridge, the Matchering pipeline).
- LGPL (LSP, Calf, FFmpeg's LGPL build) is usable with dynamic linking. GPL and AGPL code (Matchering, pedalboard, dpl.lv2, Essentia, Squeezer) is for reference or study only unless the product is GPL.
- The papers are the spec. There is no drop-in rule-based automixer to adopt.

### Gaps
- A small automatic-EQ repository by "arnaurf" turned up with no licence file (so all rights reserved by default), but its URL wasn't recorded here, so treat it as unverified.
- phaselimiter's licence is ambiguous (README "MIT" vs a non-standard licence per GitHub's detection). Read its LICENSE file before using it.

## 7. Which approaches hold up against human mixes

### Takeaway
Rule-based systems that use instrument labels (KEAMS) reached parity with professional mixes in a small test. Cross-adaptive single-parameter systems tend to land near-professional (panning, unmasking EQ), better than semi-professional (Ma compression), or tied with experts at light settings (Maddams). Heavy processing and "equal loudness" balancing consistently lose. Reference-matched mastering (Matchering) beat most commercial automatic masterers but not top engineers.

### Cited Findings
- KEAMS: no significant difference from professional mixes in preference; better than an instrument-agnostic automatic mixer. — [De Man thesis](http://www.brechtdeman.com/publications/pdf/PhD-thesis.pdf)
- Ma 2015 compression was preferred over semi-professional mixes; equal-loudness alternative automatic mixes were rated worst. — [Ma et al. 2015](https://joshreiss.github.io/documents/2015/Ma%202015%20-%20Intelligent%20Multitrack%20Compression.pdf)
- Maddams 2012: light threshold-mode LRA compression tied with an expert; heavy compression rated poor. — [Maddams DAFx-12](https://www.dafx.de/paper-archive/2012/papers/dafx12_submission_6.pdf)
- Mansbridge panning was rated just below professional. — [Mansbridge 2012](https://joshreiss.github.io/documents/2012/MansbridgeFinnReiss-AES133-Autonomoussystemformultitrackstereopositioning.pdf)
- Perez-Gonzalez panning was comparable to a professional engineer. — [Ten Years of Automatic Mixing](https://www.open-access.bcu.ac.uk/4968/1/WIMP2017_DeManEtAl.pdf)
- Hafezi masking EQ: near professional, better than amateur. — [Hafezi & Reiss 2015](https://www.researchgate.net/publication/277935370_Autonomous_Multitrack_Equalization_Based_on_Masking_Reduction)
- Matchering placed 3rd of 12 in a blind mastering comparison, behind two professional engineers. — [sergree/matchering](https://github.com/sergree/matchering)
- Equal-loudness balancing is contradicted by real mixes (vocal −2.7 ± 1.6 LU, the rest well under it). — [De Man ISMIR 2014](https://archives.ismir.net/ismir2014/paper/000293.pdf)
- In peer review, balance and space (reverb) draw most criticism (35% and 29%). — [De Man thesis](http://www.brechtdeman.com/publications/pdf/PhD-thesis.pdf)

### Inferences
- What sounds good: role-aware loudness offsets (not equal loudness), conservative compression, a mostly dry mix with a modest shared reverb, role-based panning, and reference-matched mastering to a platform target.
- What fails: blanket literature EQ, heavy compression, equal loudness, and too much reverb.
- The listening tests were small (KEAMS's post-test discussion covered 15 subjects, "10 out of 15 explicitly mentioned the balance or spatial position of vocals", [De Man thesis](http://www.brechtdeman.com/publications/pdf/PhD-thesis.pdf), on a handful of songs), so "parity with pros" is suggestive rather than conclusive.

### Gaps
- Participant counts and statistical details for every study weren't all extracted.
- No large-scale, recent (2024–2026) listening test was found that compares classical rule-based automix with modern deep-learning automix (e.g. automix-toolkit, FxNorm) and human engineers.
- The Mix Evaluation Dataset's details (De Man) weren't retrieved.

# Commercial automatic mixing and mastering tools: what they do and how (as of 2026-10-29)

Scope note: vendors publish very little about their internals. The most detailed public material is (a) iZotope's older
Ozone 8 help page on Master Assistant (circa 2017, still the clearest account of the pipeline's shape), (b) LANDR /
MixGenius patents (2012-2014 filings), (c) Queen Mary University of London (QMUL) academic papers by the people who
founded LANDR and RoEx, (d) the Soundtheory Gullfoss manual, and (e) Sound On Sound reviews. Everything else is marketing
or third-party listicles, several written by competitors (RoEx, Cryo Mix, MixingGPT): treat those with care.

## 1. iZotope Ozone 12 / 11: Master Assistant and the mastering modules

### Takeaway
Master Assistant is an analyse → classify → target → set-parameters pipeline: it listens to a short loud section,
scores the audio against genre target curves (a neural-net classifier gives a weighted blend of genres, documented in
Ozone 8), then fits a fixed-order chain (EQ bells and shelves toward the target curve, dynamics switched on by crest
factor, a maximizer threshold learned to hit a LUFS target, a dynamic EQ on what hits the limiter hardest). Ozone 11/12
add ML stem separation (Stem Focus, Stem EQ), ML transient restoration (Unlimiter) and adaptive "toward pink noise"
spectral shaping (Clarity, Stabilizer), but iZotope does not document their algorithms.

### Cited Findings
**The documented pipeline (Ozone 8 help page, older, circa 2017, but the only detailed public account):**
- Target curves "were born from a mixture of internal discussion and research"; audio was grouped into ten genre
  classes, each analysed for spectral characteristics to make a target curve; "we also trained a neural net classifier to
  map incoming audio to a unique target curve" — [iZotope Ozone 8 docs](https://downloads.izotope.com/docs/ozone8/master-assistant/index.html)
- The target is a weighted blend: the audio is scored for similarity to each genre curve (e.g. 60% Pop, 30% Rock, 10%
  Country gives a target mixed in those proportions); with a Reference loaded, the curve comes from the reference
  instead. The ten genres group into Bass Heavy (EDM, hip-hop), Orchestral and Modern (pop, rock), whose combined curves
  are in Tonal Balance Control — [iZotope Ozone 8 docs](https://downloads.izotope.com/docs/ozone8/master-assistant/index.html)
- A preset is loaded from the top-scoring genre class to set what analysis doesn't learn (Maximizer IRC mode, dynamics
  attack/release) — [iZotope Ozone 8 docs](https://downloads.izotope.com/docs/ozone8/master-assistant/index.html)
- EQ: low shelf always on band 1, high shelf on band 8, up to six peak bells on bands 2-7 placed to move the spectrum
  toward the target curve — [iZotope Ozone 8 docs](https://downloads.izotope.com/docs/ozone8/master-assistant/index.html)
- Dynamics enabled by crest factor (full band for Orchestral, low band otherwise); stated range -1 to 14 with an "ideal"
  3 to 10 (below 3 "too compressed", above 10 "too dynamic"); compressor thresholds from the input's average level; the
  enable cutoff is an unpublished internal value — [iZotope Ozone 8 docs](https://downloads.izotope.com/docs/ozone8/master-assistant/index.html)
- Loudness: Streaming sets the Maximizer threshold to reach -14 LUFS by default (changeable); CD aims for the loudest
  output at an intensity defined by how often the limiter engages while learning (Low 0%, Medium 1%, High 2% of the
  time); Reference takes the reference's LUFS. Ceiling -1 dB for Streaming, -0.3 dB for CD and Reference. It will not turn
  down a track already louder than the target — [iZotope Ozone 8 docs](https://downloads.izotope.com/docs/ozone8/master-assistant/index.html)
- Dynamic EQ: compares Maximizer input and output to find the frequencies hitting the limiter hardest, places nodes
  there, thresholds learned from each band's input — [iZotope Ozone 8 docs](https://downloads.izotope.com/docs/ozone8/master-assistant/index.html)
- Analysis: ~30 s of audio recommended (loop shorter sections), on the loudest part; learning on a quiet section can
  distort louder parts — [iZotope Ozone 8 docs](https://downloads.izotope.com/docs/ozone8/master-assistant/index.html)
- In a 2021 overview, Master Assistant's Modern mode applied subtle broad-shelf EQ, mostly bypassed compression and used
  multiband compression on the lows when needed; Vintage mode used Vintage EQ, vintage multiband compressor and Vintage
  Limiter — [iZotope, Meet the Assistants (May 2021)](https://www.izotope.com/en/learn/meet-the-izotope-assistants.html)

**Current (Ozone 12) behaviour:**
- After analysis, Ozone "will attempt to identify the genre of your song" and match tone, width and dynamics to targets
  "generated from the latest chart-topping hits"; 35 genres listed with All-purpose the default; a reference file can
  replace the target (tonal balance, width, dynamics, loudness); references can come from Audiolens (captures from
  streaming playback) — [iZotope, How to use Master Assistant in Ozone 12](https://www.izotope.com/en/learn/how-to-use-master-assistant-in-ozone.html)
- First run offers Auto-Master or Custom; Custom picks a genre target, a loudness target and which modules to bypass;
  analysis window set in seconds or bars, loudest section (chorus) recommended; Relearn re-runs — [iZotope](https://www.izotope.com/en/learn/how-to-use-master-assistant-in-ozone.html)
- Macro controls after analysis: Tonal Balance (drives "a couple of equalizers and other processors behind the scenes"),
  Loudness (affects more than the limiter), Dynamic Match and Width Match (keep dynamics and width within the target's
  ranges), Clarity Amount, Stabilizer Amount (an "unwanted resonance" control), Vocal Balance (a Master Rebalance
  instance on the lead vocal, switched off when no change is needed). A Target Meter shows the target as a "tunnel" and
  the audio as a line. Gain Match level-matches for fair A/B (turn off before export) — [iZotope](https://www.izotope.com/en/learn/how-to-use-master-assistant-in-ozone.html)
- Ozone 12 (Sept 2025): Stem EQ (Advanced) splits a stereo master into vocals, drums, bass, other with up to eight EQ
  bands per stem; Unlimiter (Advanced) uses ML to restore transients lost to limiting (threshold or Learn); Bass Control
  ("AI-powered" low-end balancing); Stabilizer gets 25 genre targets plus custom targets from a reference; IRC 5 maximizer;
  Stem Focus "now powered by new neural nets" — [iZotope blog](https://www.izotope.com/community/blog/ozone-12);
  [MusicTech review](https://musictech.com/reviews/plug-ins/izotope-ozone-12-review/)
- In the Ozone 12 materials only Unlimiter is explicitly called machine learning; Stem Focus uses neural nets; no LUFS
  defaults or true-peak values are given — [iZotope blog](https://www.izotope.com/community/blog/ozone-12)
- Clarity (Ozone 11) dynamically adjusts tonal properties in real time "with the aim of taming resonances and adapting
  the average response towards that of pink noise", only above 300 Hz by default; SOS compares it to Soothe and Smooth
  Operator — [Sound On Sound Ozone 11 review (Jan 2024)](https://www.soundonsound.com/reviews/izotope-ozone-11-advanced)
- Tonal Balance Control 3 offers 30+ genre targets "built from analyzing hundreds of professional masters" and can
  capture targets from streaming services — [iZotope TBC page via search](https://izotope.com/en/products/tonal-balance-control-2)

**iZotope research publications:**
- Shahan Nercessian (iZotope), "Neural Parametric Equalizer Matching Using Differentiable Biquads", DAFx 2020: a network
  predicts parametric EQ settings, trained with a frequency-domain loss through differentiable biquads; a parameter-only
  loss was found insufficient — [DAFx archive](https://dafx.de/paper-archive/details/lpNI_8szg2jo_eJO1RnKxw);
  [PDF](https://dafx2020.mdw.ac.at/Proceedings/papers/DAFx2020_paper_7.pdf)
- Mockenhaupt, Rieber, Nercessian (Native Instruments, iZotope's parent), "Automatic Equalization for Individual
  Instrument Tracks Using CNNs", DAFx 2024: builds on the differentiable EQ-matching network; fine-tuning on real
  examples cut mean absolute error 24% vs random parameter sampling — [arXiv 2407.16691](https://arxiv.org/abs/2407.16691v1);
  [DAFx24 PDF](https://dafx.de/paper-archive/2024/papers/DAFx24_paper_27.pdf)

**Assessments:**
- MusicTech (Ozone 12, 8/10): Master Assistant results "normally acceptable but rarely perfect", "intended as a guide,
  not a decision maker"; Stem EQ "an absolute game-changer"; Unlimiter less effective on a mix that's "more generally
  over-cooked"; IRC 5 gives high integrated LUFS with transparency — [MusicTech](https://musictech.com/reviews/plug-ins/izotope-ozone-12-review/)
- Stem EQ separation shows artefacts/bleed when soloed but is transparent in context (per reviews summarised in search
  results) — [MusicTech](https://musictech.com/reviews/plug-ins/izotope-ozone-12-review/); [Attack Magazine](https://www.attackmagazine.com/news/izotope-announces-ozone-12-with-new-stem-eq-bass-control-and-unlimiter/)

### Inferences
- The likely shape of the current Master Assistant is the Ozone 8 one scaled up (35 genres instead of 10, more modules,
  stem-aware Vocal Balance), plus learned per-module settings; iZotope has not published a newer method description.
- The DAFx 2020/2024 papers suggest iZotope/NI derive EQ settings with a network trained through a differentiable EQ
  (predict parameters, compare magnitude responses), which is a plausible engine for "move toward the target curve"
  steps, but no product page ties these papers to a specific feature.
- "Target curve" = long-term average spectrum (smoothed, probably in fractional-octave bands) of many commercial masters
  per genre, plus ranges for crest factor and stereo width; the tunnel display implies a mean ± spread per band.

### Gaps
- No iZotope patent on Master Assistant was found in this search (I did not search USPTO directly by assignee).
- No public description of the Ozone 11/12 classifier architecture, training set size, Unlimiter's model, Bass Control's
  algorithm or Stem EQ's separation network.
- No published Ozone 12 default LUFS/true-peak values (only the Ozone 8 -14 LUFS / -1 dB streaming defaults).

## 2. iZotope Neutron 5 Mix Assistant, Nectar Vocal Assistant, inter-plugin communication, unmasking

### Takeaway
Neutron's whole-mix "Balance" is a static level mix: Relay/Neutron/Nectar instances on each track talk to a master
instance (inter-plugin communication, IPC), it listens to the whole song in real time, sorts tracks into five groups
(Focus, Voice, Bass, Percussion, Musical) and writes gain into the plugins, leaving DAW faders at 0 dB. The per-track
assistant builds an EQ/compression/saturation chain from a short analysis. Unmasking is IPC-driven dynamic attenuation
of the masker in the masked track's key frequencies.

### Cited Findings
- Balance: Relay as first insert on each track, Neutron on the bus; "Begin Listening" analyses the mix beginning to end
  in real time; starred Focus tracks are placed further forward; tracks are grouped Focus, Voice, Bass, Percussion,
  Musical, each with a slider relative to the assistant's initial target; DAW faders stay at unity and gain changes go into
  the plugin instances — [Splice / iZotope summaries via search](https://splice.com/blog/how-to-mix-izotope-neutron);
  [iZotope, Meet the Assistants](https://www.izotope.com/en/learn/meet-the-izotope-assistants.html)
- Older Neutron 3 docs: most accurate results from a new, untouched session — [Neutron 3 docs mirror via search](https://inp.mzbusiness.com/assistants-neutron-3-help-documentation.html)
- Track Enhance (2021 description): instrument auto-detected or chosen, plus descriptive adjectives; generates EQ to
  reduce resonances, compression for dynamic inconsistencies, optional Exciter saturation, Sculptor tone shaping, additive
  EQ colour — [iZotope, Meet the Assistants](https://www.izotope.com/en/learn/meet-the-izotope-assistants.html)
- Nectar Vocal Assistant builds a chain of compression, levelling, reverb, modulation, EQ and de-essing; its Unmask talks
  to Relay/Neutron/Nectar on other tracks and attenuates key vocal frequencies there, optionally only while the vocal is
  active (Dynamic); Nectar Pro detects sung, rapped or spoken vocals — [iZotope, Meet the Assistants](https://www.izotope.com/en/learn/meet-the-izotope-assistants.html)
- Neutron 5 (SOS, Feb 2025): Mix Assistant analyses for "a relatively short analysis time", then exposes four "Intent
  Controls" (Tone, Dynamics, Saturation, Width); Detailed View lets you reorder/add/remove modules; Visual Mixer's
  assistant creates an initial static level/pan balance; IPC supports unmasking and Visual Mixer level suggestions;
  Sculptor is a "smart" dynamic EQ toward a tonal balance; Unmask reduces frequency competition between instruments; no
  reverb/delay in the suite — [Sound On Sound Neutron 5 review](https://soundonsound.com/reviews/izotope-neutron-5)
- SOS verdict: happier with track-level suggestions (restrained, avoid "overhyping anything") than bus-level; drum bus
  suggestions sometimes "a little too aggressive", possibly from the short analysis window; overall "genuinely
  impressive" — [Sound On Sound](https://soundonsound.com/reviews/izotope-neutron-5)
- iZotope says it has used AI/ML since Neutron's 2016 release — [iZotope, AI in music production via search](https://www.izotope.com/en/learn/ai-in-music-production.html)

### Inferences
- Balance probably sets each group to a target loudness offset relative to the focus track (the group sliders are "relative
  to the initial target suggestion"); per-track loudness is likely measured with BS.1770-style gating over the full song.
- Neutron's assistant does not do panning, sends, or time-based effects in its whole-mix mode (beyond Visual Mixer pan
  suggestions), so a full auto-mixer must go further.

### Gaps
- The exact Neutron 5 balance targets (dB offsets per group) and the masking meter's formula are not published.
- MusicRadar's "Can AI mix better than a real mix engineer?" Neutron 5 test could not be read (page body truncated) —
  [MusicRadar](https://musicradar.com/music-tech/can-ai-mix-better-than-a-real-mix-engineer-we-put-izotopes-ai-powered-neutron-5-to-the-test-to-find-out)

## 3. LANDR (MixGenius): the engine and its patents

### Takeaway
LANDR descends from QMUL's Centre for Digital Music (Joshua Reiss's group). Its patents describe exactly the classic
architecture: extract features (loudness, spectrum, dynamics, width, MFCCs), classify genre/instrument/style (SVM in the
patent), look up nearest-neighbour records of real commercial productions in a "production database", and derive the
processing chain, parameters and targets (e.g. an RMS target) from them. The current plugin (local, no cloud) builds its
target by comparing your track to a reference library; the user picks only a style (Warm/Balanced/Open) and adjusts
macro controls.

### Cited Findings
- MixGenius described the process as listening, analysing and deciding on "a delicate cocktail of signal processing";
  "not template or preset based"; built by analysing thousands of mastered tracks and studying mastering engineers'
  workflows; broad genre detection automatic (2014) — [MusicRadar (2014)](https://www.musicradar.com/news/tech/mixgenius-discusses-the-landr-automated-online-mastering-service-603304)
- "MixGenius is about ten years of research from Queen Mary University in London using machine learning and big data for
  doing sound engineering tasks" (co-founder Justin Evans) — [Wikipedia, LANDR](https://en.wikipedia.org/wiki/LANDR)
- US9654869B2 "System and method for autonomous multi-track audio processing" (priority 2012, granted 2017; inventors
  Reiss, Mansbridge, Clifford, Ma, Hafezi, Jillings; assignee LANDR Audio with QMUL): per-track side-chain feature
  extraction (loudness, loudness range, spectral centroid/spread, spectral and spatial balance, flux, crest factor),
  smoothed with an exponential moving average; loudness by a modified ITU-R BS.1770 with silence gates; a cross-adaptive
  module sets controls under user constraints; faders drive "all active sources... towards equal perceived loudness";
  panning from spectral centroid (brighter further from centre); EQ so "spectral bandwidth of sources does not overlap";
  compressors so "variation in loudness range of active sources is minimised"; GCC-PHAT delay/polarity alignment;
  subgroups then a mastering stage — [Google Patents US9654869B2](https://patents.google.com/patent/US9654869B2/en)
- US20150066481A1 / granted US9304988B2 "automatic audio production using semantic data" (MixGenius, filed 2014;
  inventors Terrell, Mansbridge, Reiss, De Man): semantic data from UI, audio or a reference track; "chromosomal"
  features (tempo, MFCCs, sub-band flux), classification features (genre, instrumentation, style; an SVM can produce
  them), production features (spectral shape, dynamic range, loudness, stereo width); a production database of real
  commercial tracks pairing features with processing chain and parameters; an inference engine with k-nearest-neighbour
  matching averages matched records to set chain, parameters and targets; static rules (e.g. "if kick drum is present,
  then put equalizer on bass guitar at 100 Hz, gain at −3 dB, Q 2.2") and dynamic rules (a target, e.g. RMS ≈ −6.5 dB
  reached with a limiter); serial chain HPF → compressor → EQ → fader/pan, multiband compressor and limiter for mastering;
  peak ceilings by destination (−1 dB for SoundCloud streaming, −0.3 dB otherwise); a reference-matching example takes an
  RMS target of about −9 dBFS from the reference — [Google Patents US20150066481A1](https://patents.google.com/patent/US20150066481A1/en)
- A related filing WO2015035492A1 "automatic multi-track audio mixing" (MixGenius) — [Google Patents via US9654869B2 citations](https://patents.google.com/patent/US9654869B2/en)
- LANDR Mastering Plugin (SOS, Dec 2023): analysis and referencing local, "no longer requires a connection to the cloud";
  no genre picker: it builds an individual target by comparing the track against a reference library across genres;
  Target styles Warm / Balanced / Open; gain-only low and high shelves and a broad ~400 Hz bell, Presence (2.5-5 kHz),
  de-esser, Focus-Wide stereo slider, one-knob Compression, Character and Saturation, Loudness knob with LUFS and
  true-peak meter; rock/pop results around -8 to -9 LUFS (short-term peaks), one true peak at -0.1 dBFS — [Sound On Sound](https://www.soundonsound.com/reviews/landr-mastering-plugin)
- SOS verdict: "hugely impressed"; results "always sounded slicker and more polished than the original, except where
  that would have been inappropriate"; did little to already-good material — [Sound On Sound](https://www.soundonsound.com/reviews/landr-mastering-plugin)
- LANDR calls its engine "Synapse" (its "most powerful mastering engine yet") and the styles a way "to guide the
  advanced AI" — [LANDR blog](https://blog.landr.com/mixing-mastering-style)

### Inferences
- The patents (2012-2014) predate deep learning's spread; the current engine likely replaces SVM/kNN with learned models
  but the decomposition (features → nearest commercial references → chain + targets) is probably still the frame.
- "Comparing against a reference library across genres" (SOS) is consistent with the patent's kNN-over-production-database
  approach rather than explicit genre classification.

### Gaps
- No public technical description of Synapse; no current loudness defaults published.

## 4. Sonible smart:EQ 4, smart:comp 2, smart:limit, smart:reverb

### Takeaway
Sonible's "smart" plugins share a pattern: a learning phase on the input (user-cappable duration), a target profile
(instrument, genre or a reference track), and a resulting curve/parameter set the user can scale. smart:EQ 4 adds a
cross-instance group (up to 10 tracks) with front/middle/back priorities for spectral unmasking. Sonible describes its
engine only as "AI-based, content-aware", combining signal statistics, psychoacoustics and mixing experience.

### Cited Findings
- smart:EQ 4 smart:filter "automatically balances the signal based on a target Profile": instrument/vocal profiles,
  genre Mix Profiles, custom Reference Profiles (load a track; it emulates its spectral character); maximum learning time
  settable; Adaptive mode for highly dynamic signals; weighting curve can limit the processed range; Track / Group /
  Track-and-Group modes (Group reduces masking against other members without balancing the channel itself); each instance
  placed front, middle or back; up to 10 tracks; instances remote-controllable; dynamic EQ bands; M/S; auto gain — [Sonible smart:EQ 4](https://www.sonible.com/smarteq4/)
- Engine described as an "AI-based, content-aware system [that] incorporates signal statistics, psychoacoustic
  principles and extensive hands-on mixing experience" — [MusicTech smart:EQ 3 review](https://musictech.com/reviews/plug-ins/sonible-smart-eq-3-review/)
- smart:EQ 3 (2021) shared spectral information between up to six instances to calculate masking and adjust each
  smart:filter — [MusicRadar](https://www.musicradar.com/news/sonible-introduces-the-worlds-first-multitrack-eq-plugin-can-smarteq-3-fix-your-mix-with-a-single-click)
- smart:limit: publishing targets per platform define expected loudness and maximum true peak (incl. broadcast);
  genre profiles (24 genres plus speech and Universal per a forum post; 26 plus reference per a 2022 Resolution review);
  genre should be chosen before Learn because it affects gain, saturation and bass control — [Gearspace](https://gearspace.com/threads/sonible-smart-limit.1368042/);
  [Attack Magazine](https://www.attackmagazine.com/technique/tutorials/limiting-for-streaming-with-ai-and-sonible-smartlimit/);
  [Resolution 2022](https://issuu.com/resolutionmag/docs/resolution_v22.2_march-april_2022/27)
- smart:comp 2 is described in retailer copy as spectral compression over ~2000 frequency bands with auto settings —
  [Gear4music (DE)](https://gear4music.de/de/Recording-and-Computer/Sonible-Studio-Paket/4WII)

### Inferences
- "Learning" is most plausibly accumulating a long-term spectrum (and level statistics) of the input, then computing a
  smoothed correction toward the profile curve; Group unmasking likely cuts lower-priority tracks where a higher-priority
  track's spectrum dominates.

### Gaps
- No Sonible white paper or patent on the smart:filter's model, profile derivation or unmasking maths was found;
  smart:reverb was not researched in depth.

## 5. RoEx (Automix, Mix Check Studio) and the QMUL lineage

### Takeaway
RoEx (David Ronan and Joshua Reiss, a QMUL spin-out; Reiss also co-founded LANDR) is the main stems-in automatic
mixer: you label each stem's instrument, it sets level, pan, EQ, compression and reverb per stem, and exports a mix,
a master, or a DAW project (Ableton Live Set, DAWproject). Its academic roots are psychoacoustic masking metrics and
automatic subgrouping.

### Cited Findings
- RoEx founded by Dr David Ronan and Prof Joshua Reiss (co-founder of LANDR), spin-out from QMUL; method "currently in
  the patenting process" — [RoEx about](https://www.roexaudio.com/about-us); [Synchtank](https://www.synchtank.com/synchblog/synchtank-x-roex-elevating-audio-together)
- Automix: user selects each stem's instrument type "so the system understands how each should traditionally sit within
  the mix"; outputs an Ableton Live Set or DAWproject with stems and initial level, pan, compression, EQ, reverb settings
  — [MusicTech](https://musictech.com/news/gear/roex-automix-ai-mixing-instagram-filter/);
  [Headliner](https://www.headlinerhub.com/roex-integrates-with-ableton-live-for-ai-assisted-mixing.html)
- RoEx's own Oct 2026 comparison (vendor, biased): up to 32 stems (Pro), 16 free; mixing up to 8 min, mastering up to
  10 min; per-stem EQ, compression, level, pan, spatial; mastering does tonal balance, imaging, reference matching and
  "loudness targeting for streaming platforms" (no values); beta offline desktop app; says uploads not used for training
  — [RoEx blog](https://www.roexaudio.com/blog/best-ai-mixing-and-mastering-services-compared-(2026))
- Mix Check Studio (free) analyses a finished mix/master for clipping, phase, mono compatibility, stereo field and
  loudness and says how to fix it in the DAW; Mix Enhance processes finished stereo files — [MusicRadar](https://musicradar.com/news/mix-check-studio-free-ai-tool);
  [Record of the Day](https://www.recordoftheday.com/news-and-press/roex-unveils-mix-enhance-in-new-version-of-mix-check-studio-an-innovative-ai-tool-for-professional-quality-audio)
- Innovate UK £50,000 grant extended it to live recordings — [MusicTech / search summary](https://musictech.com/news/gear/roex-automix-ai-mixing-instagram-filter/)
- Academic work: Ronan, Ma, Mc Namara, Gunes, Reiss, "Automatic Minimisation of Masking in Multitrack Audio using
  Subgroups" (arXiv 2018): a multitrack masking metric based on the MPEG psychoacoustic model, processing that alters
  frequency and dynamic characteristics to reduce it, and subgrouping improving perceived quality/clarity; later
  withdrawn because IP ownership "needed resolving" — [arXiv 1803.09960v1](https://arxiv.org/abs/1803.09960v1); [v3 note](https://arxiv.org/abs/1803.09960v3)
- Ronan, Moffat, Gunes, Reiss, "Automatic subgrouping of multitrack audio" (DAFx 2015): feature selection plus
  agglomerative clustering to group tracks — [DAFx archive](https://dafx.de/paper-archive/details/NWUl2PmpDZ4352ZR2kyH-A)

### Inferences
- The IP-driven withdrawal of the masking paper, right before RoEx's founding, suggests that metric (MPEG-model masking
  minimised by EQ/dynamics optimisation, with subgroups) is close to Automix's core.
- Instrument labels as input point to per-instrument priors (target level relative to the mix, typical EQ shapes, pan
  rules) rather than fully learned end-to-end mixing.

### Gaps
- No RoEx patent number or technical paper describing the shipping product was found.

## 6. Other products: Logic Mastering Assistant, Gullfoss, online services, DAW built-ins, Mastering The Mix

### Takeaway
Most other tools are stereo mastering services with the same shape (analysis → genre or reference target → EQ,
compression, width, limiting to a LUFS level) and a few macro controls; documented internals are almost nil. Gullfoss is
the odd one out: not a target-matching tool but a continuously updating perceptual-model EQ (~1000 model updates/s).

### Cited Findings
**Apple Logic Pro Mastering Assistant (Logic 10.8, late 2023):**
- Analyses the whole project or a selection (about a minute), builds an undisclosed chain applying fine EQ and dynamics
  and setting level near -14 LUFS integrated; Auto EQ slider scales the computed EQ 0-200% (author saw it rarely exceed
  ±4 dB); Custom EQ: low shelf 20-200 Hz, mid 200 Hz-8 kHz, high shelf 8-20 kHz, ±6 dB; Excite = fixed upper-mid
  saturation; Width set by analysis; true-peak and momentary/short-term/integrated LUFS meters; Loudness Compensation for
  A/B; Character modes Clean, Valve, Punch, Transparent (Apple silicon only) — [Sound On Sound (Feb 2024)](https://soundonsound.com/techniques/logic-pros-ai-mastering-assistant);
  [Apple support](https://support.apple.com/HT213974)
- Verdict: "actually very effective" for streaming, "no substitute for an experienced mastering engineer" — [Sound On Sound](https://soundonsound.com/techniques/logic-pros-ai-mastering-assistant)

**Soundtheory Gullfoss:**
- "An equalizer that is continuously adjusted to improve the clarity of the signal at every moment", based on "a highly
  advanced model of human auditory perception"; ~1000 perception-model updates and ~300 EQ updates per second; ~20 ms
  latency (2 ms for Gullfoss Live); preserves perceived loudness and dynamics — [Gullfoss manual](https://www.soundtheory.com/static/Gullfoss%20Operation%20Manual.pdf)
- Recover boosts dominated (masked) components, Tame cuts dominant ones; Bias shifts the classification between
  recover and tame regions; Brighten chooses among unmasked solutions by perceived brightness; Boost shifts the perceived
  bass/mid/treble balance as with a volume change, while preserving loudness; range limiters exclude frequency regions
  from the unmasking calculation — [Gullfoss manual](https://www.soundtheory.com/static/Gullfoss%20Operation%20Manual.pdf)
- Attack Magazine reports Soundtheory saying it uses no AI, neural networks, Fletcher-Munson curves or ML; a KVR user's
  sine tests saw narrow-band scoops and boosts and ~1024 samples latency (suggesting FFT analysis) — [Attack Magazine](https://attackmagazine.com/?p=131301);
  [KVR forum](https://www.kvraudio.com/forum/viewtopic.php?p=7343107)

**Online services:**
- eMastered: post-AI sliders for compression, EQ, width, volume and strength; reference matching; Stemify separation —
  [RoEx comparison (vendor-written)](https://www.roexaudio.com/blog/best-ai-mixing-and-mastering-services-compared-(2026))
- Masterchannel (Oslo, founded 2020 by Christian Ringstad Schultz): described by third parties as reinforcement-learning
  based and hands-off (no style, no parameters, no reference in standard workflow); exports reportedly fixed at 44.1 kHz /
  16-bit — [RoEx comparison](https://www.roexaudio.com/blog/best-ai-mixing-and-mastering-services-compared-(2026));
  [theorg](https://theorg.com/org/masterchannel/org-chart/christian-ringstad-schultz); [comparison listicle](https://cryo-mix.com/blog/posts/ai-mixing-and-mastering-in-2026-what-each-platform-actually-does-and-what-it-doesnt)
- BandLab Mastering: free, preset-driven (Universal, Fire, Clarity, Tape); its in-DAW AutoMix only sets volume and pan
  — [RoEx comparison](https://www.roexaudio.com/blog/best-ai-mixing-and-mastering-services-compared-(2026))
- Cryo Mix: V2 relaunched Jan 2026; up to 32 stems, 15-min limit, conversational assistant "Nova", 30+ manual
  parameters, per-stem reports, no DAW project export — [RoEx comparison](https://www.roexaudio.com/blog/best-ai-mixing-and-mastering-services-compared-(2026))
- Mixea (DistroKid, Feb 2023): works on bass, compression, width, EQ, limiting, loudness; previewable EQ/intensity
  options; 24-bit/48 kHz WAV; $99/year — [Hypebot](https://www.hypebot.com/hypebot/2023/02/distrokid-adds-mixea-ai-powered-music-mastering-service.html);
  [MusicTech](https://musictech.com/news/gear/distrokid-new-ai-powered-mastering-tool-mixea/)
- Waves Online Mastering: "neural network" trained on many industry-grade masters; mastering engineer Piper Payne says
  "We have modeled the processes and techniques I use daily"; styles Precise / Organic (less processing) / Elevated (more,
  brighter); Depth and Presence controls; reference upload; asks for mixes peaking -2 to -4 dBFS, RMS around -15 dBFS,
  without bus limiting; updated July 2025 — [MusicTech](https://musictech.com/news/gear/waves-online-mastering/);
  [Waves support](https://www.waves.com/support/waves-online-mastering-getting-started); [Sonicstate (Jul 2025)](https://sonicstate.com/news/2025/07/30/waves-updates-online-mastering/)
- FL Studio: CloudBounce (since 2015) closed 30 June 2025 and its mastering technology lives in FL Studio via FL Cloud;
  automatic genre detection or a chosen genre (14 genre presets on Plus); LUFS target selectable (streaming presets or
  manual); a small analysis file is sent online — [Image-Line CloudBounce](https://www.image-line.com/cloudbounce);
  [DJ Mag](https://www.djmag.com/tech/fl-studio-adds-stem-separation-and-ai-mastering-new-beta)
- Cubase 15 and Ableton Live 12.x add stem separation but no built-in mix/master assistant was found (source is a
  competitor's blog) — [MusicRadar Cubase 15](https://www.musicradar.com/music-tech/steinberg-unveils-cubase-15-a-major-leap-forward-for-its-flagship-daw-with-new-instruments-effects-modulators-and-ai-powered-stem-separation);
  [MixingGPT](https://mixinggpt.com/blog/best-ai-mixing-plugins-fl-studio-studio-one-cubase-reaper-2026)
- Mastering The Mix MIXROOM: target EQ curve from a genre/channel preset or a reference; "Add Smart Bands" loads EQ bands
  matching the target; doesn't handle bass (BASSROOM does) — [MusicRadar review](https://www.musicradar.com/reviews/mastering-the-mix-mixroom);
  [MusicTech](https://musictech.com/news/gear/mastering-the-mix-announce-mixroom/)
- Matchering 2.0 (open source, reference-matching) placed 3rd in Benn Jordan's blind test, above Ozone — [MusicTech](https://musictech.com/news/gear/benn-jordan-ai-mastering-study/)

### Inferences
- Gullfoss's design (masking-driven, loudness-preserving, frame-rate EQ) is the most useful public model for a
  "make it clearer" stage that isn't tied to a genre curve; Clarity/Stabilizer/smart:EQ's adaptive modes look like
  variants of it with a target (pink-ish or genre) added.
- Matchering's strong showing suggests plain reference matching (spectrum + loudness) is competitive with proprietary
  "AI" when a good reference is chosen.

### Gaps
- No technical detail for eMastered, Masterchannel (the RL claim is third-party), BandLab, Cryo Mix, Mixea, Waves'
  model, Audioshake/LALAL stem tools, Antares or "MixGPT"-style tools. Mastering The Mix REFERENCE/LEVELS and smart:reverb
  not researched. Studio One's AI features unconfirmed.

## 7. Common patterns, targets and weaknesses

### Takeaway
Every product follows analyse → pick a target (genre curve from commercial masters, a reference, or a perceptual ideal)
→ set a mostly fixed-order chain (EQ, dynamics, width, saturation, limiter) → expose a handful of macros. Loudness
defaults cluster at -14 LUFS integrated with -1 dBTP for streaming, with "CD/loud" modes far hotter. What's left to the
user: genre/style choice, loudness, intensity, final taste; whole-mix tools set static levels, not automation.

### Cited Findings
- Spotify normalises to -14 LUFS integrated, recommends true peak below -1 dBTP; its limiter engages at -1 dB; Loud mode
  is -11 LUFS — [Spotify support](https://support.spotify.com/au/artists/article/loudness-normalization/)
- Apple Music Sound Check is commonly cited at -16 LUFS and only turns down; YouTube at about -14 LUFS, turning down
  loud tracks only (secondary sources) — [RoEx streaming guide](https://www.roexaudio.com/blog/how-to-master-music-for-streaming-spotify-apple-music-deezer-youtube);
  [Mastering The Mix](https://masteringthemix.com/blogs/learn/76296773-mastering-audio-for-soundcloud-itunes-spotify-and-youtube)
- Ozone 8 defaults: Streaming -14 LUFS, ceiling -1 dB; CD/Reference ceiling -0.3 dB — [iZotope](https://downloads.izotope.com/docs/ozone8/master-assistant/index.html)
- Logic centres its Loudness knob at about -14 LUFS — [Apple](https://support.apple.com/HT213974)
- LANDR plugin rock/pop masters around -8 to -9 LUFS short-term — [Sound On Sound](https://www.soundonsound.com/reviews/landr-mastering-plugin)
- FL Cloud guide example at -9 LUFS ("CD") — [aimusicpreneur](https://www.aimusicpreneur.com/ai-music-news/fl-studio-ai-mastering/)
- Crest-factor bands used to decide on compression (3-10 "ideal") — [iZotope](https://downloads.izotope.com/docs/ozone8/master-assistant/index.html)
- Targets: Ozone's from "the latest chart-topping hits"; Tonal Balance Control's from "hundreds of professional masters";
  Clarity toward pink noise — [iZotope](https://www.izotope.com/en/learn/how-to-use-master-assistant-in-ozone.html);
  [iZotope TBC](https://izotope.com/en/products/tonal-balance-control-2); [SOS](https://www.soundonsound.com/reviews/izotope-ozone-11-advanced)
- Known weaknesses: learning on a quiet section distorts loud parts; already-hot tracks aren't turned down —
  [iZotope](https://downloads.izotope.com/docs/ozone8/master-assistant/index.html); short analysis windows misread
  busses — [SOS](https://soundonsound.com/reviews/izotope-neutron-5); reused LANDR instance kept old input gain, giving a
  louder, more restricted result — [SOS](https://www.soundonsound.com/reviews/landr-mastering-plugin); LANDR flattened
  dynamics and Waves came out brighter in one engineer's comparison — [mixandmastermysong](https://mixandmastermysong.com/ai-mixing-and-mastering-review/)

### Inferences
- Gain-matched A/B (Ozone Gain Match, Logic Loudness Compensation, LANDR Gain Match) is a standard feature because a
  louder master always sounds "better"; any DIY tool needs it.
- The "assistant" model (propose an editable chain in real modules) is winning over black-box services in DAW contexts.

### Gaps
- No vendor publishes spectral-tilt numbers for its genre targets.

## 8. Practitioner and blind-test assessments

### Takeaway
Reviewers call the assistants good starting points ("normally acceptable but rarely perfect"); the largest blind test
(Benn Jordan, Oct 2024, 472 listeners) put two human engineers first, open-source Matchering third, Ozone chains below,
and disqualified LANDR.

### Cited Findings
- Benn Jordan study (MusicTech, 29 Oct 2024): 472 listeners, double-blind, 12 semi-finalists cut to 7 finalists; ranking:
  1 Max Hosinger (human; spelled "Honsinger" elsewhere), 2 Ed the Soundman (human), 3 Matchering 2.0, 4 Ozone + Neutron, 5 Compound Audio, 6 Kits.ai,
  7 Ozone 11; LANDR disqualified for poor masters — [MusicTech](https://musictech.com/news/gear/benn-jordan-ai-mastering-study/);
  [Gearnews](https://www.gearnews.com/ai-mastering-benn-jordan-test-studio/)
- A secondary write-up gives scores ~6.4/10 and ~6.1 for the humans and ~5.8-5.9 for the best AI — [beatstorapon](https://beatstorapon.com/blog/ai-mastering-vs-human-engineers-472%E2%80%91person-blind-test-results/)
  (MusicTech reports no scores; the secondary numbers are unverified)
- SOS on LANDR plugin "hugely impressed"; on Logic "actually very effective" but no substitute for an engineer; on
  Neutron 5 "genuinely impressive" at track level — [SOS LANDR](https://www.soundonsound.com/reviews/landr-mastering-plugin);
  [SOS Logic](https://soundonsound.com/techniques/logic-pros-ai-mastering-assistant); [SOS Neutron 5](https://soundonsound.com/reviews/izotope-neutron-5)

### Inferences
- The gap between human and best automatic masters in listener ratings is small (if the secondary scores hold), and a
  well-chosen reference does much of the work.

### Gaps
- Other 2025-2026 "blind test" pages (artistrack, audobox, 9,900-test claims) are unvetted marketing; not used.

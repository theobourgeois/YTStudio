# Pro-L

FabFilter's **Pro-L 2**, the true peak limiter, planned as a stock effect of ours in the music suite (Built in
→ Pro-L), as Pro-Q is. Nothing here is built yet: this is the plan, written before building, from
FabFilter's own **Pro-L 2 manual** (the PDF, `fabfilter.com/downloads/pdf/help/ffprol2-manual.pdf`, 49 pages,
the same text as the online help at `fabfilter.com/help/pro-l`: "the manual"), its screenshots (below), the
Pro-L 1 manual (whose style descriptions carry starting values the Pro-L 2 manual dropped), FabFilter's
press releases and forum answers from FabFilter staff, reviews (Sound On Sound, Mix, Computer Music /
MusicRadar), engineers' measurements (Jonathan Jetter's tests of its time constants), the standards its
meters follow (ITU-R BS.1770-5, EBU R 128, EBU Tech 3341 and 3342) and the DSP literature on look-ahead
limiting, true peak detection, oversampling and noise shaping. Quotes in "…" are the sources' own words.
[Sources](#sources) at the end, with URLs.

**Is there a newer Pro-L?** No. As of 2 October 2026 the current version is **Pro-L 2 2.26** (16 April 2026,
a bug-fix release for all FabFilter plug-ins). There is no Pro-L 3: a user thread ("Pro-L3 idea") exists on
FabFilter's forum, and in October 2024 a FabFilter staff member answered a request for a lower-latency mode
with "We'll definitely take a look at this when Pro-L is getting an update." Meanwhile FabFilter released
Pro-Q 4 (December 2024) and Pro-C 3. This document is based on Pro-L 2 throughout.

**How sure each statement is**, marked where it matters:

| Tag | Meaning |
| --- | --- |
| **[FF]** | FabFilter says so: the manual, the product page, press releases, FabFilter staff on its forum. |
| **[std]** | A standard says so (ITU-R BS.1770-5, EBU R 128, Tech 3341, Tech 3342). |
| **[observed]** | Read off FabFilter's screenshots. |
| **[user]** | Someone measured or reported it on the real plug-in (reviews, forums, blogs). It can be wrong. |
| **[inferred]** | Worked out here from the above; consistent with everything found, not confirmed. |
| **[checked]** | Checked numerically here (Python / NumPy / SciPy, scripts described in [§5.16](#516-how-the-checked-claims-were-checked)). Proves the maths, not that Pro-L does the same. |
| **[ours]** | A decision for Vaudio's version, not a claim about FabFilter's. |
| **not stated** | No source found says. |

The pictures in `img/pro-l-*` are FabFilter's own screenshots from its online help, © FabFilter, kept here
only as a private reference for building this app. Don't ship them, and don't copy FabFilter's artwork: we
copy how it works and how it's laid out, in our own visual style.

![Pro-L 2, its Advanced panel open](img/pro-l-2.jpg)

## Contents

1. [What it is](#1-what-it-is)
2. [The panel](#2-the-panel)
3. [The sound](#3-the-sound)
4. [The styles](#4-the-styles)
5. [How it works: the DSP](#5-how-it-works-the-dsp)
6. [The factory presets](#6-the-factory-presets)
7. [Proposed for Vaudio](#7-proposed-for-vaudio)
8. [How it'd be built here](#8-how-itd-be-built-here)
9. [Open questions for Théo](#9-open-questions-for-théo)
10. [Sources](#sources)

---

## 1. What it is

- **A brickwall limiter**: it turns a sound up (the **Gain** slider) while never letting it past a ceiling
  (the **Output Level**), so a mix gets louder without clipping. "The Gain slider is the most important
  control: it adds gain to the incoming signal to make it louder, while limiting to the maximum output level
  specified in the bottom bar." **[FF]**
- **A true peak limiter**: with True Peak Limiting on, the ceiling holds for the waveform a D/A converter (or
  an MP3/AAC encoder) rebuilds between the samples, not only for the samples. **[FF]**
- **A loudness meter**: EBU R 128 / ITU-R BS.1770-4 (Momentary, Short Term, Integrated, Loudness Range, true
  peak), with targets for streaming and broadcast, so the same window says how loud the master is and how loud
  it will play. **[FF]**
- **Eight "styles"** (limiting algorithms): "One is not better than the other; they are all great, and they
  all go very loud if you want them to." Some are meant to be invisible, some to add punch, glue or grit. **[FF]**
- Mainly for the **master** (the last plug-in of a master, before dithering), also for **buses and single
  tracks**: Punchy "works miracles on single tracks, like vocals, bass or guitar", Bus is "especially nice
  for (drum) bus processing and individual tracks". **[FF]**

### History and lineage

| When | What |
| --- | --- |
| 21 Oct 2010 | **Pro-L** announced: four styles (Transparent, Punchy, Dynamic, Allround), adjustable look-ahead, attack and release, "separate, freely adjustable channel linking for both the transient and release stages", "up to four times linear-phase oversampling", inter-sample peak metering, K-System scales, dithering with three noise shapings. EUR 169. **[FF]** |
| 5 Dec 2017 | **Pro-L 2**: four new styles (Modern, "the new 'best for all' default", Aggressive, Bus, Safe), true peak limiting, EBU R 128 loudness metering, up to 32x oversampling, surround, DC offset filter, external side chain triggering, Unity Gain, Audition Limiting, the peak labels on the display. EUR 169 / USD 199. **[FF]** |
| Dec 2021 | "All plug-ins updated, Dolby Atmos support for Pro-Q 3 and Pro-L 2" (now up to 9.1.6). **[FF]** |
| Dec 2023 | CLAP format for every FabFilter plug-in. **[FF]** |
| 16 Apr 2026 | 2.26, the current version. **[FF]** |

The limiting algorithms were developed with **Niklas Silén (bManic)**, who "developed the Transparent,
Dynamic and Modern limiting styles and was very influential in the general design of Pro-L version 1 and
2". **[FF]** Pro-L 1 still installs beside Pro-L 2; Pro-L 2 reads its presets but not its automation ("the
feature set of Pro-L 2 has changed fundamentally"). **[FF]**

### Why engineers reach for it

- **It's clean when pushed.** Reviewers call Modern "highly transparent and natural-sounding, even with very
  high loudness" (Mix) and "the new Pro-L go-to for transparency" (Computer Music). **[user]**
- **Choice of character in one plug-in**, from Safe (classical, acoustic) to Aggressive (EDM, metal). **[FF]**
- **The display shows what it does**: a scrolling picture of the sound before and after, the gain reduction
  hanging from the top, and labels on the deepest dips. You see when you've overdone it. **[FF]**
- **Everything for delivery in one place**: true peak ceiling, loudness to a target, oversampling, dither.

### What makes it sound the way it does

Two stages working together **[FF]**: a fast **transient** stage that looks ahead (Lookahead, 0–5 ms) and
catches peaks, and a slower **release** stage that "responds to the average dynamics of the incoming audio"
(Attack, Release, 0–10 s). The style changes "both the lookahead, attack and release characteristics of the
limiting algorithm" (FabFilter staff) **[FF]**, and how much latency it needs. The rest (oversampling, the
true peak stage) is about keeping it clean at the top. How each part works, and how we'd build it, is in
[§5](#5-how-it-works-the-dsp).

---

## 2. The panel

![The parts of the window, labelled by FabFilter](img/pro-l-overview.jpg)

### 2.1 Layout

From the screenshots **[observed]** (Medium size, about 1200 × 750 at 2x):

```
┌────────────────────────────────────────────────────────────────────────────────────────────────────┐
│ fabfilter Pro·L²   ↶ ↷   A/B  Copy    ◀  preset name  ▶    [lock output]   Help   [⛶]              │ top bar
├───┬──────────────────────────────────────────────────────┬────────┬────┬───────────────────────────┤
│ G │ the real-time level display, newest at the right:    │ 0 dB   │ GR │ Max M / S       [scale]   │
│ A │   input (light blue-grey), output (dark blue),       │ −5     │    │   ┃┃┃  loudness meter     │
│ I │   gain reduction (red, hanging from the top),        │ −8     │    │   ┃┃┃  (a big bar and two │
│ N │   the loudness curve (a thin line),                  │ …      │    │   ┃┃┃  thin: S, M, I)     │
│   │   amber peak labels on the deepest dips              │ output │    │ LRA ⊏          [target]   │
│ ▮ │ ┌ « STYLE  LOOKAHEAD  ATTACK  RELEASE  LINKING » ┐   │ meter  │    │   −13.2 LUFS              │
│   │ │ [Modern]   ( )      ( )     ( )    ( )   ( )  │A   │ L  R   │    │ ‖  [Short Term]  ↺        │
│   │ └───────────────────────────────────────────────┘    │        │    │                           │
│   │                  [TP] [display mode] [meter scale]   │        │    │                           │
├───┴──────────────────────────────────────────────────────┴────────┴────┴───────────────────────────┤
│ MIDI Learn ▾ │ True Peak Limiting │ Oversampling: 8x │ Dither: 16 Bits (O) │ ⏻ │ Out: 0.0 dBTP │ ⤡ │ bottom bar
└────────────────────────────────────────────────────────────────────────────────────────────────────┘
```

- The **display** fills the window; the **Gain slider** is a tall strip on its left edge; the **Advanced**
  panel slides out over the bottom of the display from the **ADVANCED** tab ("click the Advanced button right
  under the Gain slider", the vertical tab at its right edge); the **meters** sit at the right; the
  **loudness panel** opens beside them when the meter scale is Loudness. **[FF]** **[observed]**
- The look **[observed]**: a dark blue-grey display, a lighter blue-grey for the input, a darker saturated
  blue for the output, a translucent red for gain reduction, yellow-amber peak labels with dark text, round
  lavender-grey knobs with a white pointer cap and a dark ring of ticks (the house FabFilter knob, as
  Pro-Q's), white labels in capitals, a red "Pro·L²" wordmark.

### 2.2 Top bar

![Undo, Redo, A/B and Copy](img/pro-l-undoredo.jpg)

| Control | What it does |
| --- | --- |
| **Undo / Redo** | "Every change to the plug-in (such as dragging a knob or selecting a new preset) creates a new state in the undo history." Changes from automation or MIDI make none. Disabled when there's nothing to undo or redo. **[FF]** |
| **A/B** | Switches between two states; the active letter is bright. "Before switching, the current state of the plug-in is saved, so if you click this button twice, you are back at the first state." **[FF]** |
| **Copy** | Copies the active state to the other. "After clicking Copy, the button disables itself to show that both states are equal." **[FF]** |
| **◀ preset ▶** | The preset's name (a click: the preset menu); the arrows load the previous / next. The name dims once the preset is changed. Right-click: Save, Save As (and Copy / Paste of the settings, used to move from Pro-L 1). **[FF]** |
| **Lock Output** | The small level-and-padlock icon right of the presets (yellow in every screenshot **[observed]**). "When enabled, the current values of the Gain, Output Level, DC Offset Filtering, Unity Gain, True Peak Limiting, Oversampling, Dithering and Noise Shaping parameters will be preserved while loading presets." **[FF]** |
| **Help** | The help, interactive hints, version, licence. **[FF]** |
| **Full Screen** | Fills the screen; Esc leaves. **[FF]** |

The preset menu's **Options**: Save As Default, Open Other Preset, Restore Factory Presets, Change Preset
Folder, Enable MIDI Program Changes (bank / program numbers shown before each name). Presets are `.ffp`
files in `Documents/FabFilter/Presets/Pro-L 2`, subfolders as categories. **[FF]**

### 2.3 The Gain slider

![The Gain slider](img/pro-l-gainslider.jpg)

| | |
| --- | --- |
| Range | **0 to +30 dB** (the Compact view's Gain knob reads "0 dB … 30 dB") **[observed]** |
| Default | **0 dB** **[inferred]**: the Default Setting is a starting point "to move the Gain slider up" |
| What it does | "Adjusts the threshold of limiting and the increase in output gain at the same time." **[FF]** The sound is turned up by Gain, then limited to the Output Level. |
| Mouse | Click anywhere on it and drag; the wheel; "if you click on the slider background and move the mouse slowly, you make more precise adjustments"; double-click to type. Its value floats in a small box on the strip ("+10.5"). **[FF]** |
| Alt-drag | "The Gain slider is reverse-linked to the Output Level parameter, so holding down the Alt key … while increasing the gain, will decrease the output level with the same amount": hear the limiting without the level change. **[FF]** |
| Look | A narrow strip with a dark red glow that rises with the gain **[observed]** |

### 2.4 The Advanced panel

![The Advanced panel](img/pro-l-advancedpanel.jpg)

| Control | Range | Default | Scale | What it does |
| --- | --- | --- | --- | --- |
| **Style** | Transparent, Punchy, Dynamic, Allround, Aggressive, Modern, Bus, Safe | **Modern** **[FF]** | a button with a menu | The limiting algorithm ([§4](#4-the-styles)). The new four "need more latency than others". **[FF]** |
| **Lookahead** | **0 to 5 ms** **[observed]** | **not stated** (near the bottom of its range in every screenshot **[observed]**) | **not stated**; a short red arc at the very start of its ring **[observed]**, presumably the "less than 0.1 ms" zone that "will approximate 'hard clipping'" **[inferred]** | "The look-ahead time for the initial 'transient' stage": time to see a peak coming. Short: "preserving transients better and increasing the apparent loudness, but at the expense of possible distortion". Long: "safer, but less loud, and transients might appear to get lost in the mix a little more." **[FF]** |
| **Attack** | **0 to 10 s** **[observed]** | **not stated** (about 11 o'clock **[observed]**) | **not stated** | How soon the slower release stage sets in. "Shorter attack times will allow the release stage to set in sooner." **[FF]** |
| **Release** | **0 to 10 s** **[observed]** | **not stated** (about 11 to 12 o'clock **[observed]**) | **not stated** | How much the release stage holds. "Longer release times will cause it to have more effect." **[FF]** |
| **Channel Linking: Transients** | **0 to 100%** | about **75%** **[observed]** | linear | Linking of the transient stage between left and right. "It often works well to choose less than 100% here." **[FF]** |
| **Channel Linking: Release** | **0 to 100%** | **100%** **[observed]** | linear | Linking of the release stage; "it is best to start with 100% which will completely link the channels." **[FF]** |

"In general, short attack times and long release times are safer and cleaner, but they can also cause pumping
and reduce clarity. On the other hand, long attack times and short release times can increase apparent
loudness and presence, but at the expense of possible distortion." **[FF]**

Pro-L 1's manual gave starting points per style, dropped from Pro-L 2's **[FF, Pro-L 1]**:

| Style | Lookahead | Attack | Release |
| --- | --- | --- | --- |
| Transparent | < 0.5 ms | 50–200 ms | 200–1000 ms |
| Punchy | > 1.0 ms | about 250 ms | about 500 ms |
| Dynamic | < 0.5 ms | half way | half way |
| Allround | about 0.5 ms | about 250 ms | about 500 ms |

In the mono version the linking knobs are disabled; on surround tracks they gain a second half of their
range (see [§2.10](#210-surround-midi-learn-side-chain)). **[FF]**

### 2.5 The bottom bar and the output panel

![True Peak Limiting](img/pro-l-truepeaklimiting.jpg)

| Control | Values | What it does |
| --- | --- | --- |
| **MIDI Learn ▾** | | See [§2.10](#210-surround-midi-learn-side-chain). |
| **True Peak Limiting** | on / off (a green line on its top edge when on **[observed]**) | "The true peak output is ensured not to exceed the currently set Output Level in dBTP." The output readout then says "dBTP". Adds "about 5 ms" of latency. **[FF]** |
| **Oversampling** | Off, 2x, 4x, 8x, 16x (CPU-intensive), 32x (Very CPU-intensive) **[observed]** | Runs the limiter at a multiple of the rate to cut aliasing and inter-sample peaks. "We recommend 4x or possibly 8x oversampling for normal use"; 16x and 32x for offline renders. Linear-phase: "a very slight pre-ring". **[FF]** |
| **Dither** | the panel: Dither Off, 24, 22, 20, 18, 16 bits; Noise Shaping Basic, Optimized, Weighted **[FF]** | The button reads e.g. "16 Bits (O)". TPDF dither, "2-bit peak-to-peak". **[FF]** |
| **Global Bypass** ⏻ | | "Guaranteed to correctly compensate the latency of the plug-in and it also applies soft bypassing to avoid clicks." The display dims; a red light on the button. **[FF]** |
| **Out: 0.0 dBTP** | | The output button: a click opens the output panel; dragging it vertically sets the ceiling; double-click types it. **[FF]** |
| **Resize** ⤡ | Compact, Small, Medium (default), Large; Scaling submenu | See [§2.9](#29-sizes-compact-view-full-screen). |

![The oversampling menu](img/pro-l-oversampling.jpg)
![The dither panel](img/pro-l-dithering.jpg)
![The output panel](img/pro-l-output.jpg)

The **output panel** (it pops up above the output button) **[FF]**:

| Control | Range / default | What it does |
| --- | --- | --- |
| **Output Level** (a large knob) | −30 to 0 dB (dBTP with True Peak Limiting) **[observed]**; factory presets "were saved with a default output level of 0.0 dB" **[FF]** | The ceiling: "the desired maximum output level for the limiter". |
| **DC** (Filter DC Offset) | off | "Gentle DC offset filtering, which removes a possible DC bias in the input signal … avoids unnecessary and asymmetrical limiting." Blue when on **[observed]**. Its corner frequency is **not stated**. |
| **Side Chain Triggering** (antenna icon) | off | The external side chain drives the detector instead of the input: for **stem mastering**, a stem limited exactly as the full master was ("use Pro-L 2 on the stem channel, while feeding the original (unmastered, unlimited) master to its side chain input"). |
| **1:1** (Unity Gain) | off | "Automatically sets the Output Level to the inverse of the current Gain, so you can listen to the effect of limiting in relation to the input signal." A yellow light; the output meters turn yellow; "all metering still shows levels as if the normal Output Level is applied." Temporary by design. |
| **Headphones** (Audition Limiting) | off | "Subtracts the processed output from the input audio to audition the 'delta' signal: the actual gain reduction that is being applied." |

**What Output Level to choose** **[FF]**: with True Peak Limiting and True Peak Metering on, "set the Output
Level to the maximum allowed value (e.g. −1.0 dBTP for EBU R128)"; "−1.0 dBTP and −2.0 dBTP" for EBU R 128 and
ATSC A/85; Spotify and YouTube −1.0 dBTP; "when mastering for CD or iTunes, you're safe with −0.1 dBTP"; never
above 0.0 dBTP. "In most cases, choosing 4x oversampling in combination with a minimum lookahead time of 0.1
ms, keeps inter-sample peaks within the range of 0.1 dB."

### 2.6 Metering

![The output and gain reduction meters](img/pro-l-metering.jpg)

Right of the display **[FF]** **[observed]**:

- **The output meter**: one bar per channel. It shows **peak and RMS at once**: the RMS "follows the
  Momentary specification of the EBU R128 standard" (K-weighted, 400 ms), per channel and as one combined
  level (a lighter segment and a marker), the peak as the lit bar, the **maximum peak** as a held line.
- **The gain reduction meter**: red bars hanging from the top, one per channel; its peak held as a line.
- **The readouts above them**: the maximum output peak and the maximum gain reduction ("−1.0", "−8.1"); "click
  on the level text to reset the reading." The peak readout is **green** when it's a true peak reading;
  "it will turn orange when true peak levels exceed the current Output Level and red when exceeding 0 dBTP."

![The TP button (true peak metering), the display mode and the meter scale](img/pro-l-truepeakmetering.jpg)

- **TP** (left of the meter scale button; a green light when on): **True Peak Metering**, the output meter
  reading true peaks per ITU-R BS.1770. "We recommend to always turn on true peak metering." Readings of
  different compliant meters can differ by "0.1 or 0.2 dBTP"; FabFilter's "use high internal oversampling and
  have been verified with all test audio as provided by ITU".

![The meter scale button](img/pro-l-meterscale.jpg)

**Meter Scale** (the button reading "−48 dB" or "Loudness") **[FF]**:

| Scale | What it shows |
| --- | --- |
| **16 dB** | "Showing the top 5 dB of input, output and gain reduction meters in the linear upper part of the metering": the most detail where limiting happens. |
| **32 dB** | "The best of both worlds." |
| **48 dB** | "A general overview of input and output levels." |
| **K-12, K-14, K-20** | Bob Katz's K-System: the 0 mark at −12, −14 or −20 dBFS (= 85 dB SPL when calibrated), peak and RMS, a red "loud" zone at the top. K-12 for broadcast, K-14 "the majority of commercial recordings", K-20 film, classical, dynamic mixes. |
| **Loudness** | Opens the loudness panel ([§2.7](#27-the-loudness-panel)). |

"All three general scales have linear precision in the upper part": the top few dB take more of the
height (the overview's labels: 0, −5, then every 3 dB **[observed]**). The same scale is the display's.
Metering settings are left alone by presets, saved with the session, and "any change you make is automatically
saved as the default setting". **[FF]**

![The display mode menu](img/pro-l-displaymode.jpg)

**The real-time level display** **[FF]**: input (grey / light blue), output (dark blue), gain reduction (red)
and loudness (thin line), scrolling; "gain reduction peaks are highlighted with yellow peak level readings".
**Display Mode** (the waveform-and-arrow icon beside TP):

| Mode | Behaviour |
| --- | --- |
| **Slow Down** | Moves slowly; "once the incoming audio reaches the rightmost display edge, the display quickly scrolls back to make room for new audio." Its icon is yellow when chosen **[observed]**. |
| **Fast** | Pro-L 1's: "moves fairly quickly at a steady pace." |
| **Slow** | The same, slower: more history; good with Short Term loudness. |
| **Infinite** | "Shows all incoming audio since the interface was opened or this mode was selected, increasing the density each time the display fills up"; good with Integrated. |
| **Off** | No display (a red ✕). |

The scroll speeds of Fast and Slow are **not stated**.

### 2.7 The loudness panel

![The loudness panel, labelled by FabFilter](img/pro-l-loudness.jpg)

Opened by Meter Scale → Loudness. It follows ITU-R BS.1770-4 and EBU R 128 ("also supporting ATSC A/85 and
TR-B32"), always gated. **[FF]**

| Part | What it does |
| --- | --- |
| **Loudness Meter Target** (button on the scale, e.g. "−14 (Strm)", "−23 (EBU)") | The target in LUFS: **−9** ("commonly used for audio CDs"), **−14** ("roughly the target level used by streaming services like Spotify, iTunes or YouTube"), **−23** (EBU R 128), **−24** (ATSC A/85, TR-B32), or **Custom**. "Roughly speaking, the loudness target is the desired value for the Integrated loudness measurement." **[FF]** There are no per-platform presets. |
| **Loudness Meter Scale** (top button, "Strm +9", "EBU +9") | +9 or +18 LU above the target (EBU mode's "+9" and "+18" scales when the target is −23); its menu switches absolute (LUFS) or relative (the target reads 0). **[FF]** |
| **Loudness Time Scale** (bottom button) | **Momentary**, **Short Term** or **Integrated**: the one drawn large; the other two are thin bars beside it (labelled S, M, I). **[FF]** |
| **Loudness reading** | The chosen time scale in big digits ("−13.2 LUFS"). **[FF]** |
| **Max M / Max S** | Above the meter: the maximum momentary or short-term loudness; with Integrated chosen, a button picks which. **[FF]** |
| **LRA** | With Integrated chosen, the Loudness Range, drawn as an orange bracket beside the bar with its value ("LRA 0.9"). **[FF]** **[observed]** |
| **Pause ‖ / Reset ↺** | Either side of the time scale button. Reset also resets the peak and gain reduction readings. **Auto-Reset** (in the time scale menu) resets when the host starts playing. **[FF]** |
| **Loudness curve** | The loudness over time in the display, a thin line; because the loudness meter and the display use different scales, "curved lines indicate how the scales are related to each other". **[FF]** |

**Its colours** **[observed]** (nothing in the manual): the bars are pale blue-white well under the target,
turn yellow then orange as they reach it, and red above it; the target's tick is the orange one. The reading
takes the colour of where it is: "−13.7" at a −14 target is orange, "−13.2" and "−12.2" at −14 and "−20.8" at
−23 are red. So orange is within a small band of the target and red is over it; the band's width is **not
stated** (between 0.3 and 0.8 LU from these four screenshots **[inferred]**). The loudness curve is drawn in
the reading's colour (orange or red) **[observed]**.

How FabFilter says to use it **[FF]**: for EBU R 128, the −23 target, Integrated "with a tolerance of +/− 1 LU",
True Peak Limiting and Metering on, Output −1 dBTP; for ATSC A/85, −24 and −2 dBTP; for Spotify, −14 and −1
dBTP. "We recommend to combine integrated loudness metering with the Infinite display mode." LKFS and LUFS
"are essentially the same".

Not in Pro-L 2 **[FF, by absence]**: the **PLR** (peak-to-loudness ratio, the maximum true peak less the
integrated loudness), short-term LRA history, a loudness history export, per-platform target presets.

### 2.8 Knobs, text entry and keys

![A FabFilter knob](img/pro-l-knobs.jpg)

| Gesture | What it does **[FF]** |
| --- | --- |
| Drag the centre up / down | Turns it; slow drags are finer ("the knob reacts to the speed with which you are dragging"). |
| Drag the arrow (pointer) around | Rotate mode; further from the knob is finer. |
| Wheel | Turns it. |
| Double-click | Types a value. "2x" types +6 dB, "50%" the middle of the range, "1k" 1000 (frequencies). |
| Cmd-click (Ctrl on Windows; Alt in Pro Tools) | Resets to the default. |
| Shift + drag or wheel | Fine. |
| Alt + drag | Moves linked knobs together (Gain and Output, the opposite way). |
| Hover | The knob lights up; a value pop-up with its name. |

### 2.9 Sizes, Compact view, full screen

![The resize menu](img/pro-l-resize.jpg)
![The Compact view](img/pro-l-compact.jpg)

- **Sizes**: Compact, Small, Medium (default), Large, each remembered as the default for new instances; a
  **Scaling** submenu; VST3 resizes by its edges; **Full Screen** (Esc leaves). **[FF]**
- **Compact** "doesn't offer the real-time level display, but its level meters have more detail … and it
  offers a large Output knob." **[FF]** The screenshot **[observed]**: a row of knobs (a big **Gain** 0–30 dB
  with its readout, Style button, Lookahead, Attack, Release, the two link knobs, a big **Output** −30–0 dBTP
  with its readout), then horizontal meters (output L/R with the true peak readout, gain reduction under it),
  then the loudness bars horizontally (S large, M and I thin), the big reading on their left, the target and
  scale buttons under them. Gain and Output can also be dragged on their readouts.

### 2.10 Surround, MIDI Learn, side chain

![MIDI Learn](img/pro-l-midilearn.jpg)

- **MIDI Learn**: the window dims, each controllable parameter shows its controller number; touch a control
  (a red square marks it), move a MIDI controller; Close or the button again to leave. Its menu: Enable MIDI,
  Clear (one or all), Revert, Save. **[FF]**
- **Surround** (up to 9.1.6): every channel on the output meter; the link knobs get a second half of their
  range, from "100% Stereo, 0% All" to "100% Stereo, 100% All" (every channel triggered by the loudest); **C**
  links the centre channels to their stereo pairs, **LFE** brings the LFE into the all-channel linking; both
  off by default. **[FF]**

![Surround channel linking](img/pro-l-surroundchannellinking.jpg)
![Surround metering](img/pro-l-surroundmeters.jpg)

- **External side chain**: Side Chain Triggering in the output panel (above). **[FF]**

### 2.11 What can be automated

Every parameter, by the host and by MIDI Learn ("any MIDI controller with any plug-in parameter") **[FF]**;
"Smart Parameter Interpolation" (the product page) **[FF]**. The parameter list itself is **not stated**.

---

## 3. The sound

### 3.1 What a good limiter sounds like

In a producer's words: louder, and otherwise **the same**. Up to about 3 dB of peak reduction on a mixed master,
a good limiter is close to inaudible: the drums keep their snap, the bass its weight, the stereo image doesn't
move, the reverb tails don't swell. Past that, the choice of style is the choice of **how** it gives way:

- the attack of each drum hit softens (Safe, long lookahead), or stays sharp but gains a little grit
  (Aggressive, very short lookahead);
- the space between hits fills up and breathes in time with the beat (Punchy, Bus, long release), or stays
  even (Transparent, Modern).

Reviewers' rule of thumb: "5–6 dB typically starts to sound compressed" (a guide, **[user]**). Typical
master gain reduction for modern pop and EDM is far more; the styles exist so that the price is one you chose.

### 3.2 The styles, by ear

From FabFilter's descriptions **[FF]** and reviews **[user]**:

| Style | Sounds like | For |
| --- | --- | --- |
| **Transparent** | "Stay true to the original sound and feel as much as possible, avoiding pumping effects and coloring." | Most programme, "especially on rock and pop music". The low-latency one. |
| **Punchy** | "The most apparent. When pushed, it becomes quite punchy and will introduce a bit of pumping." Fairly safe on distortion. On rock vocals it "smoothly reined in dynamics … without squashing the life out it" (Mix). | Single tracks: "vocals, bass or guitar", "a nice edge to beat-oriented music". |
| **Dynamic** | "By enhancing transients before actually applying limiting, this algorithm excels in preserving the original punch and clarity." | Rock; "surprisingly well on other types". |
| **Allround** | "A good balance between loudness and transparency" (Pro-L 1: "very 'safe', minimizing distortion while still going as loud as possible"). | Almost anything. |
| **Aggressive** | "An aggressive yet smart, near-clipping style of limiting." Loud, dense, a little grit on the hits. | EDM, trance, "rock, metal or pop". |
| **Modern** | "The new standard for all-purpose, transparent limiting. It can achieve very high loudness and allows for very near-zero lookahead settings, while still sounding extremely clean and natural." | The default; masters of every kind. |
| **Bus** | "Not meant to be transparent, rather the opposite. Think glue, pump or squash!" On drum room mics pushed to "14 to 17 dB of gain reduction on peaks" (Mix). | Drum buses, single tracks. |
| **Safe** | "No distortion ever." Its goal "is not loudness". | "Delicate acoustic and/or classical music, or individual instrument tracks." |

### 3.3 What each setting does to the sound

| Setting | Lower | Higher |
| --- | --- | --- |
| **Gain** | Peaks touched only | Louder and denser; past a few dB the style's character shows |
| **Lookahead** | Sharper transients, louder, risk of distortion; under 0.1 ms it's nearly clipping (harmonics, aliasing, inter-sample peaks) | Cleaner, "safer, but less loud"; transients "lost in the mix a little more" (the gain dips before the hit, so its attack is softened) |
| **Attack** | The release stage holds even short peaks: cleaner, more pumping | Short peaks are only the transient stage's: louder, more present, more risk of distortion |
| **Release** | The release stage lets go quickly: louder, risk of distortion on bass | It holds: smoother, more pumping, less clarity |
| **Link: Transients** | A peak in one channel is cut in that channel only: louder, and "almost inaudible" for short peaks; the image may shift on hits | Both channels cut alike: image steady |
| **Link: Release** | The image can wander as each side recovers on its own | Steady image (start at 100%) |
| **Oversampling** | Off: faster limiting aliases and makes inter-sample peaks | 4x–8x: cleaner tops, higher true peak headroom; slight pre-ring, CPU |

### 3.4 What bad limiters sound like, and why

| Artefact | What you hear | Cause | How to avoid it (Pro-L's way, and ours) |
| --- | --- | --- | --- |
| **Bass distortion** | Fuzz on sustained bass and 808s, a "farty" low end | The gain moves within one cycle of the bass (a 40 Hz cycle is 25 ms): fast release or short attack amplitude-modulates the waveform, adding harmonics and sidebands | Program-dependent release (slower while the overload lasts); attack ramps no shorter than half a bass period when the overload is low-frequency ([§5.5](#55-the-transient-stage)) |
| **Pumping / breathing** | The mix ducks on every kick and swells back; reverb and room "breathe" | The release is slow enough to be heard as a level movement, in time with the loudest element | A short transient release for isolated peaks; a release stage that charges only on sustained overloads (Attack); linked release |
| **Transient dulling** | Drums lose snap, the mix gets "smaller" | Long lookahead: the gain starts falling before the hit, so its first milliseconds are turned down most | Shorter lookahead; Dynamic's transient emphasis; Modern's adaptive ramp (short ramps for short peaks) |
| **Clipping grit, aliasing** | Harsh, papery highs, inharmonic "sizzle" | A near-instant gain change is a waveshaper: it makes harmonics, and those above half the rate fold back as inharmonic tones | Oversampling (2x–32x), so the harmonics fall above the audible band and are filtered out; soft rather than hard clipping where it's wanted |
| **Inter-sample overs** | Crackle on cheap D/A converters, distortion after MP3/AAC encoding | The samples are under the ceiling but the waveform between them is not (up to +3 dB on a quarter-rate tone, more in theory) | True peak limiting ([§5.9](#59-true-peak-limiting)) |
| **Image shift** | Hits pull the stereo image to one side | Unlinked gain reduction on a peak in one channel | Linking (transients a little under 100%, release 100%) |
| **Modulated cymbals** | The kick turns the hats and cymbals down with it | One gain for the whole spectrum: the bass's peaks decide the level of the highs | A matter of degree in a single-band limiter: less gain reduction, or a clipper or multiband stage before it. Pro-L is single-band (nothing in its manual or controls mentions bands **[inferred]**) |
| **Clicks on edits** | A click when a control moves | Gain or ceiling jumping between samples | Every control glides ([§5.13](#513-parameter-changes-sample-rate-denormals-determinism)) |
| **Quantisation distortion** | Grainy fades at 16 bits | Truncating to 16 bits without dither | TPDF dither, optionally noise-shaped ([§5.11](#511-dither-and-noise-shaping)) |

### 3.5 The master and the vocal bus

- **On the master** (its main use): last in the chain, after any EQ and bus compression; Modern (or
  Transparent, Allround), True Peak Limiting on, 4x–8x oversampling, ceiling −1 dBTP for streaming, Gain up
  until the integrated loudness is where you want it or the sound starts to give; dither only if exporting to
  16 bits and only here. FabFilter's own recommended workflow. **[FF]**
- **On a vocal bus**: a peak catcher after the compressor, so consonants and shouted words don't poke out and
  the vocal can sit louder. Punchy is FabFilter's pick for vocals **[FF]**; Safe for a delicate one. A few dB of
  reduction on the loudest syllables, a lookahead of 1–3 ms (a plosive's attack is short), Attack around
  100–250 ms and Release around 100–300 ms so the release stage smooths phrases without pumping the reverb,
  both links at 100% (a vocal is centred; its stereo reverb shouldn't move), no true peak limiting (it's not
  the last stage), oversampling off or 2x. **[ours]** On a track being recorded through its effects, every
  millisecond of the limiter's latency is heard by the singer: pick a low-latency style (Transparent,
  Punchy) and leave True Peak and oversampling off. **[ours]**

---

## 4. The styles

What FabFilter says about the differences: "Choosing a style affects both the lookahead, attack and release
characteristics of the limiting algorithm"; even with Attack at its maximum some styles (Safe) still use an
attack phase; "the Lookahead phase can sound different for different styles" (FabFilter staff, 2018) **[FF]**.
The four new styles "need more latency" ("a different, more advanced design") **[FF]**. Jetter measured that
Safe "uses only the slower release stage, bypassing the transient stage entirely" **[user]**.

Nothing more is published, so each style below is a **reconstruction**: a set of values for one engine
([§5](#5-how-it-works-the-dsp)), chosen so that it does what FabFilter's sentence promises. Every number is
**[ours]**, to be tuned by ear against the real plug-in. A style is data, not code, as EchoBoy's styles are.

The engine's blocks a style sets (explained in §5):

- **Reserve**: extra look-ahead the style keeps beyond the Lookahead knob (its latency).
- **Ramp**: the shape and length of the gain's descent before a peak (the smoothing kernel).
- **Transient release**: how fast the transient stage lets go, from *fast* (an isolated peak) to *slow* (a
  dense, sustained overload), chosen per sample by how busy the last 100 ms were.
- **Release stage**: how strongly the slow stage charges (×), and what drives it (the peak demand, or an RMS
  measure for Bus).
- **Clipper**: a soft clipper before the limiter taking up to so many dB (Aggressive).
- **Emphasis**: transient emphasis before the limiter (Dynamic).

| Style | Reserve | Ramp | Transient release (fast → slow) | Release stage | Extras | Starting values: Lookahead / Attack / Release |
| --- | --- | --- | --- | --- | --- | --- |
| **Transparent** | 0 | Hann over the Lookahead | 10 → 60 ms | ×1 on the peak demand | none | 0.5 ms / 150 ms / 500 ms |
| **Punchy** | 0 | Hann over the Lookahead, at least 1 ms | 40 → 150 ms (the pump) | ×1.3 | none | 1.5 ms / 250 ms / 500 ms |
| **Dynamic** | 2 ms | Hann over the Lookahead | 10 → 60 ms | ×1 | emphasis: onsets up to +3 dB for 5–15 ms, scaled by how hard it's limiting | 0.3 ms / 250 ms / 250 ms |
| **Allround** | 0 | Hann, at least 0.5 ms | 15 → 100 ms | ×1 | a 1 dB soft knee under the ceiling | 0.5 ms / 250 ms / 500 ms |
| **Aggressive** | 3 ms | raised cosine over min(Lookahead, 0.3 ms) | 2 → 20 ms | ×0.5 | soft clipper taking up to 2 dB, oversampled | 0.1 ms / 1 s / 100 ms |
| **Modern** | 10 ms | adaptive: per overload, from the Lookahead (sharp, isolated peaks) up to 10 ms (low-frequency ones): at least half the period of the overload's lowest strong frequency | 5 → 80 ms, two-sided (the recovery is planned within the reserve, so it's as smooth as the descent) | ×1 | none | 0.5 ms / 150 ms / 300 ms |
| **Bus** | 50 ms | Hann, at least 2 ms | 50 → 300 ms | RMS-driven: compresses from 6 dB under the ceiling at 4:1 (a 30 ms look-ahead RMS), then limits | glue and pump by design | 2 ms / 30 ms / 300 ms |
| **Safe** | 20 ms | Hann over max(Lookahead, 20 ms) | none (no transient stage: everything is the release stage's) | ×1, its release never under 80 ms | none | 5 ms / 0 s / 1 s |

The starting values are where the presets of §6 start from, what the style menu's hint suggests and what
the assistant is told to begin with; choosing a style from the menu leaves the knobs where they are, as Lookahead, Attack and Release
are separate parameters in Pro-L too (whether Pro-L moves them with the style is **not stated**) **[ours]**.

Why these choices **[inferred]**:

- **Transparent** has nothing hidden: short smooth ramps and a moderate program-dependent release, the
  classic clean look-ahead limiter; it needs no more latency than the knob (FabFilter: choose it "if you need
  minimum latency").
- **Punchy**'s slower transient release *is* the pump: the gain recovers over tens of milliseconds, audibly,
  in time with the beat; its minimum 1 ms ramp is why it stays clean on single tracks.
- **Dynamic** "enhances transients before actually applying limiting": an onset detector adds a short boost
  to each attack (as a transient designer would), so after limiting the hit still stands out from what
  follows. The 2 ms reserve lets the boost start on the onset rather than after it.
- **Allround**'s small knee begins reducing just under the ceiling, so it reaches full reduction gently: a
  compromise between loudness and transparency.
- **Aggressive** "near-clipping": very short ramps (the gain changes within a fraction of a millisecond,
  close to waveshaping) plus a soft clipper that rounds the very tops; oversampled, so the clipping's
  harmonics don't alias. Its weak release stage keeps it loud.
- **Modern** reconciles "very near-zero lookahead" with "extremely clean": the knob's short ramp is used only
  where it is clean (short, high-frequency peaks); a bass overload gets a ramp long enough not to distort it,
  from the reserve. The reserve also lets the recovery be shaped ahead of time. Its 10 ms reserve is why it's
  among the styles that "need more latency".
- **Bus** is a compressor in front of a limiter: glue (several dB of RMS-driven gain reduction under the
  ceiling) and pump (slow release). A long look-ahead (50 ms) for its RMS detector fits a user's report of
  "massive latency (>65 ms) on the 'Bus' algorithm" **[user]**.
- **Safe**: one slow stage, long ramps (20 ms), slow release: its gain never moves fast enough to distort, at
  the price of loudness and some pumping.

---

## 5. How it works: the DSP

FabFilter publishes no block diagram (a user asked for one in 2018 **[FF forum]**). What follows is the
design we'd build: the parts FabFilter describes, each done by the best-known method, with the reasoning, and
numbers checked where they could be.

Conventions: `fs` is the host rate, `k` the oversampling factor, `fo = k·fs` the rate the limiter runs at.
Gains are linear unless written in dB; "reduction" is a positive number of dB. `C` is the ceiling (Output
Level) as a linear amplitude.

### 5.0 The conclusions in brief

1. **Two stages, one guarantee.** A fast look-ahead *transient stage* alone guarantees the ceiling; a slow
   *release stage* only ever adds reduction (the final gain is the lower of the two), so it shapes the sound
   without risking the ceiling. Attack decides which overloads the slow stage takes on. This reproduces every
   behaviour FabFilter and Jetter describe **[inferred]**.
2. **Look-ahead without overshoot is a theorem, not a tuning**: take the lowest gain any sample needs over
   the next `L` samples, smooth it with any non-negative kernel no longer than `L + 1` samples, delay the sound
   by `L`: no output sample can exceed the ceiling ([§5.4](#54-look-ahead-without-overshoot)) **[checked]**.
3. **An oversampled limiter must end with a stage at the host rate.** Limiting at `fo` and then decimating
   puts the output over the ceiling, by up to **0.8 dB** (samples) and **1.3 dB** (true peak) on hard material
   **[checked]**. That is Pro-L 1's oversampling overshoot, which Pro-L 2 says it fixed **[FF]**.
4. **True peak limiting is only as good as its detector.** On sound with energy near half the rate (clipped
   drums, noise), good interpolators disagree by up to 0.5 dB about the "true" peak **[checked]**; the
   BS.1770 reference filter over-reads high frequencies by up to 0.2 dB **[checked]**. So the detector takes
   the maximum of the ITU's own four phases and a finer 8x interpolator (128 taps a phase, with a parabola
   through the highest three points), and the stage runs twice (a second pass leaves a fiftieth of what one
   pass leaves: ≤ 0.0012 dB against 0.06 dB). With oversampling on, the output then stays under the ceiling
   by the BS.1770 meter and by an ideal reconstruction alike **[checked]**.
5. **The loudness meter is standard maths**: K-weighting from the analog prototype at any rate (it matches
   the ITU's 48 kHz coefficients to every printed digit **[checked]**), 100 ms sub-blocks, 400 ms and 3 s
   windows, gating; Integrated and LRA from fixed-size histograms so nothing allocates on the audio thread.
6. **Latency is fixed per style, oversampling and true peak**, never by the Lookahead knob, so turning or
   automating it never changes the song's delay compensation **[ours]**; Pro-L's own latency also seems not to
   depend on the knob ("496 samples … in 'transparent/look ahead off' mode") **[user]** **[inferred]**.

### 5.1 The signal flow

```
 in (L, R)
   │
 [DC filter]                          optional, 5 Hz high-pass
   │
 × Gain                               0..+30 dB, glides
   │
 upsample ×k                          linear phase (Off: k = 1)
   │
 [Dynamic: transient emphasis]        in the audio path
 [Aggressive: soft clipper]           in the audio path
   │
   ├───────────► detector: |x| at fo  (the input's true peak when TP is on and k = 1)
   │                  │
   │             gain computer: r = max(0, 20·log10(|x| / C)), per channel
   │                  │
   │        ┌─────────┴──────────┐
   │   link: transients     link: release
   │        │                    │
   │   TRANSIENT STAGE      RELEASE STAGE (at fs)
   │   hold-min, ramp,      attack / release follower
   │   fast release         of the demand (Bus: RMS)
   │        └─────────┬──────────┘
   │             g = min(g_transient, g_release)
   │                  │
 delay D ──────────► × g
                      │
                downsample ×k                 linear phase
                      │
                LAST STAGE at fs              sample-peak catch (k > 1), or the
                      │                       true peak stage, twice (TP on)
                      ├──────────► meters: peak / true peak, GR, RMS, loudness
                      │
                × Unity Gain                  (the meters are fed before it)
                      │
                Audition (delta)              delayed input − output
                      │
                dither                        TPDF, noise shaping
                      │
                     out
```

- Gain is applied before everything, so Gain *is* the threshold: with Gain at +6 dB and the ceiling at
  −1 dB, anything over −7 dBFS at the input is reduced.
- The detector and the audio path are the same signal at `fo`; only the gain curve needs the look-ahead, so
  the audio is delayed by `D` (the stage's whole look-ahead: reserve + 5 ms) while the gain is computed from
  the undelayed signal.
- The release stage runs at `fs` (it's slow; there's no point running it at 32x) and is interpolated
  linearly to `fo` **[ours]**.

### 5.2 Levels, the ceiling, Unity Gain, Audition, the DC filter

- **Ceiling**: `C = 10^(Output/20)`; with True Peak Limiting it's in dBTP (the true peak stage enforces it),
  without it in dBFS (sample peaks). **[FF]**
- **Unity Gain**: the output is multiplied by `10^(−Gain/20)` after the limiter, so the limited sound plays at
  the input's level; the meters keep showing the levels as if Unity Gain were off (they're fed before it).
  **[FF]**
- **Audition Limiting**: out = (the input, delayed by the whole latency, through the same oversampling filters
  and Gain) − (the limited output, before Unity Gain), i.e. exactly what was removed. To make it a clean null
  the dry copy must go through the same up / down filters (otherwise their passband ripple and pre-ring
  appear in the "delta") **[inferred]**. Whether FabFilter's delta is before or after the gain stage is **not
  stated**; ours is at the limited level, so it sounds as loud as what was taken away **[ours]**.
- **DC filter**: "gentle" **[FF]**; ours a first-order high-pass at 5 Hz on the input, `y[n] = x[n] − x[n−1]
  + R·y[n−1]`, `R = exp(−2π·5/fs)` (Smith's DC blocker; his `R = 0.995` at 44.1 kHz is a 35 Hz corner, too high
  for a master) **[ours]**. Its phase shift at 20 Hz is 14°, and none of it is latency.

### 5.3 The gain computer and channel linking

Per channel `c`, at `fo`, the reduction needed for the sample to sit at the ceiling:

```
r_c[n] = max(0, 20·log10(|x_c[n]| / C))           (dB; 0 when under the ceiling)
```

**Channel linking** **[inferred]** (the obvious reading of "the amount of channel linking"): with link `λ`
(0..1) for a stage, each channel's demand moves towards the louder channel's:

```
r_link[n] = max_c r_c[n]
d_c[n]    = r_c[n] + λ·(r_link[n] − r_c[n])         (dB)
```

At 100% both channels get the larger demand (the image can't move); at 0% each its own. Linking can only
*add* reduction, so it never threatens the ceiling. The transient stage uses `λ_transients`, the release
stage `λ_release`. (Linking in dB rather than linear makes 50% the geometric middle, the one that sounds
halfway **[ours]**.) For surround, Pro-L's second half of the range interpolates every channel towards the
maximum of all **[FF]**; we're stereo only.

### 5.4 Look-ahead without overshoot

The requirement on the gain applied to sample `n` is `g[n] ≤ q[n] = min(1, C/|x[n]|)` (from `d_c` in dB).
The design (Signalsmith's, after many before it) **[checked]**:

```
m[n] = min( q[n−L], q[n−L+1], …, q[n] )             hold-min over L+1 samples (computed on the undelayed signal)
s[n] = Σ_{j=0..L} w[j] · m[n−j]                      any kernel w[j] ≥ 0 with Σ w = 1 (the ramp)
y[n] = s[n] · x[n−L]                                  the sound delayed by L
```

**Why it can't overshoot**: each `m[n−j]` for `0 ≤ j ≤ L` is a minimum over `q[n−j−L … n−j]`, a window that
contains `n − L`; so every term is `≤ q[n−L]`, and so is their weighted average: `s[n] ≤ q[n−L]`, i.e.
`|y[n]| ≤ C`. The same holds for averages in dB (geometric means), for windows longer than the kernel (a
*hold*), for a kernel that changes from one sample to the next (the argument is per sample), and after any
release that only ever *lowers* the curve (`g = min(s, released)`). It holds exactly in floating point up to
rounding (the checks read −0.0000 dB over the ceiling **[checked]**).

What the parts do to the sound:

- **The kernel is the attack's shape.** A box (moving average) gives a straight-line descent in time (in
  linear gain); a cascade of two boxes a triangle-kernel S-curve; a **Hann** kernel a raised-cosine descent,
  the smoothest (its spectrum has the lowest sidelobes, so the gain change makes the fewest sidebands). The
  kernel's length is the descent's length: a peak is reached after the full Lookahead, which is why Pro-L calls
  it look-ahead time.
- **Very short ramps approach clipping**: at 1 sample the gain changes instantly; the output is the sound
  multiplied by a step, i.e. waveshaped. "Very short look-ahead times (less than 0.1 ms) will approximate
  'hard clipping', introducing distortion and aliasing" **[FF]**.
- **A hold** (a min-window longer than the kernel) keeps the gain down between close peaks, so it doesn't
  flutter up and down between the hits of a roll (Signalsmith uses 15 ms in its example).
- **A variable kernel** (Modern's adaptive ramp) is a box whose length changes per sample, computed in O(1)
  from a running sum (`(P[n] − P[n−len]) / len`), twice for a triangle; any length up to `L + 1` keeps the
  guarantee.

**The sliding minimum in O(1)**: Lemire's monotonic wedge (a deque of indices whose values increase; push
pops larger values from the back; the front leaves when it's older than the window): at most three
comparisons per sample, worst case. **[Lemire 2006]** The deque's storage is the window's length, allocated
on the message thread. For the reserve's sub-windows (Modern's adaptive ramp reads the minimum over a shorter
recent span) the same wedge answers "minimum over the last `s` samples, for any `s ≤ L`" by a binary search
for the first index inside the span (the wedge is sorted by index) **[inferred]**.

### 5.5 The transient stage

The ceiling's guardian. Per channel, on the linked demand `d_c`:

1. `q = 10^(−d_c/20)`, hold-min over the stage's whole look-ahead `D` (reserve + Lookahead).
2. The **ramp**: the style's kernel, of the Lookahead's length (or, in Modern, adaptive).
3. The **release**: after the kernel, the gain may rise no faster than the release allows:

```
rel[n] = min( s[n],  rel[n−1] + (1 − rel[n−1])·(1 − e^(−1/(τ·fo))) )      (a one-pole rise towards 1, never above s)
```

**Program-dependent release** **[inferred]** (FabFilter: "highly program-dependent limiting algorithms"
**[FF]**): `τ` moves between the style's *fast* and *slow* times with how busy the limiter has been: let
`b ∈ [0, 1]` be the fraction of the last 100 ms during which the reduction was over 0.5 dB (a running count
over a ring of 100 ms; O(1)); `τ = τ_fast·(τ_slow/τ_fast)^b`. An isolated snare recovers in `τ_fast`
(loudness kept); a sustained bass overload holds at `τ_slow`, slow enough not to modulate a 40 Hz cycle (the
dominant distortion of fast limiters). This is the same idea as the "auto-release" of other limiters and
compressors; FabFilter's exact law is **not stated**.

**Modern's adaptive ramp** **[ours]**: for each overload the ramp length is chosen from the overload's lowest
strong frequency: the zero-crossing interval of the demand's source over the reserve (at least half a period,
at most the 10 ms reserve, at least the Lookahead). A 60 Hz 808 gets ≥ 8.3 ms; a snare's crack gets the knob's
0.5 ms. Because the ramp is computed from what's *ahead* in the reserve, there's no guessing. Both are within
the window, so the guarantee holds.

**Safe** has no transient stage **[user]**: its release stage (with a 20 ms Hann ramp in front, so it still
can't overshoot) does everything.

### 5.6 The release stage

FabFilter: "a slower 'release' envelope stage that responds to the average dynamics of the incoming audio. The
Attack and Release knobs control how quickly and heavily the release stage sets in." **[FF]** Jetter
measured (gain reduction curves of short impulses and of an 808) **[user]**:

- with Attack at its maximum, short impulses release "near-instantly regardless of release settings";
- with Attack at 0 ms, "the release stage [acts] even for brief peaks", and their recovery follows Release;
- longer signals (an 808) release gradually, following the sound's decay;
- so "any peak shorter than the attack time receives near-instant release", longer ones are the release
  stage's.

The design that does exactly this **[inferred]**: a slow follower `u` (in dB of reduction, per channel after
release linking) of the demand `d`, charged by Attack, discharged by Release (the "smooth branching" peak
detector of Giannoulis, Massberg and Reiss, in dB):

```
αA = e^(−1/(A·fs)),  αR = e^(−1/(R·fs))            (A, R: the knobs in seconds; 0 s → α = 0, instant)
if d[n] > u[n−1]:  u[n] = αA·u[n−1] + (1 − αA)·d[n]·κ        charge (κ: the style's "×" in §4, ≤ 1.5)
else:              u[n] = αR·u[n−1] + (1 − αR)·d[n]           discharge
g_release[n] = 10^(−u[n]/20)
g = min(g_transient, g_release)
```

- A peak shorter than Attack hardly charges `u`: the transient stage handles it and lets go at its own fast
  pace. A long overload charges `u` up to the demand; when the overload ends, `u` holds the reduction and lets
  go at Release: pumping, if long; smooth level-riding, if moderate.
- Attack 0: `u` follows the demand instantly and every overload releases at Release: the "safer and cleaner,
  but pumping" end. Attack 10 s: `u` barely moves: only the fast stage: "louder … possible distortion".
- `u` is driven by the demand computed at the input but applied to the delayed sound: its curve is delayed by
  `D` too (it's at `fs`, so a ring of `D·fs` values) **[inferred]**. It never needs look-ahead itself because
  it only lowers the gain.
- **Bus**: the follower is driven not only by the demand over the ceiling but by an RMS measure (30 ms,
  looked ahead within the 50 ms reserve) over a threshold 6 dB under the ceiling, at 4:1: a compressor
  feeding the limiter **[ours]**.

### 5.7 Soft clipping, the knee, the emphasis

- **Aggressive's clipper** **[ours]**: before the limiter (at `fo`, so oversampled), on the gained signal, a
  soft clipper whose knee starts 2 dB under the ceiling: with `T = C·10^(−2/20)`, `y = x` while `|x| ≤ T`,
  and `y = sign(x)·(T + (C − T)·tanh((|x| − T)/(C − T)))` above, which approaches `C` and never reaches it.
  It rounds the top of every peak into the ceiling with a smooth curve (no corner, so its harmonics fall off
  fast), and the limiter after it takes whatever is still over. Its share is why Aggressive is
  "near-clipping" yet "smart".
  (Anti-derivative anti-aliasing, Parker et al., would reduce its aliasing further at low `k`; with
  oversampling it isn't needed **[inferred]**.)
- **Allround's knee** **[ours]**: the demand starts 1 dB under the ceiling with a quadratic knee (the
  textbook soft knee of Giannoulis et al.), reaching the full brickwall at the ceiling.
- **Dynamic's emphasis** **[ours]**: an onset detector (a fast peak follower, 1 ms attack / 20 ms release,
  against a slow one, 20 ms / 200 ms, in dB); where the fast exceeds the slow by `e` dB, the audio is boosted
  by `min(3, e/2)` dB, scaled by how much the limiter is reducing, gliding over 1 ms; the 2 ms reserve lets
  the boost begin with the onset. The limiter then has more to take off the hit, but the hit's contrast with
  what follows is kept: "preserving the original punch and clarity".

### 5.8 Oversampling

**Why**: a gain that changes fast is a modulation, and modulation by a fast curve (or clipping) makes
frequencies above half the rate, which fold back as inharmonic tones (aliasing). At `fo = k·fs` they land
above the audible band and the decimation filter removes them. It also makes the detector's samples close to
the true waveform (at 4x the worst under-read of a 0.45 fs tone is 0.55 dB; at 8x 0.14 dB; 16x 0.03 dB:
BS.1770's table, `20·log10(cos(π·f/k))`) **[std]**.

**The filters** **[ours]**: linear-phase, as Pro-L's ("up to 32x linear-phase oversampling") **[FF]**, as a
cascade of 2x half-band FIR stages (half-band filters have every other tap zero: half the work):

| Stage | Taps | Passband / stopband (of its input rate's Nyquist) | Stopband |
| --- | --- | --- | --- |
| 1 (fs ↔ 2fs) | 127 | to 0.45 fs / from 0.55 fs | −120 dB |
| 2 (2fs ↔ 4fs) | 31 | to 0.45 fs / from 1.55 fs | −120 dB |
| 3 and on | 15 | (wide transition: the content is already low) | −110 dB |

Content between 0.45 and 0.5 fs aliases only into 0.5–0.55 fs and back into the transition band, above 20 kHz
at 44.1 kHz. Each stage's delay is `(taps − 1)/2` samples at its rate; up and down together, at the host rate:
stage 1 = 63 samples, stage 2 ≈ 7.5, stage 3 and on ≈ 1.75, 0.9, 0.4: **2x ≈ 63, 4x ≈ 71, 8x ≈ 73, 16x ≈
74, 32x ≈ 74 samples (≈ 1.5 ms at 48 kHz)**. Lengths are chosen so the total is a whole number of samples
(or a short fractional delay makes it one, as JUCE's `useIntegerLatency` does) **[ours]**.

JUCE's `dsp::Oversampling` has the same structure (2x stages up to 16x, `filterHalfBandFIREquiripple` for
linear phase) and could be used for up to 16x; 32x needs a fifth stage of our own. Its "maximum quality"
filters are close to the table above **[inferred]**.

**Pre-ring**: a linear-phase filter rings before a transient as much as after: "a very slight pre-ring … so
small that it's inaudible" **[FF]**. With stage 1's transition at 0.45–0.55 fs the ringing is at ~22 kHz and
under −60 dB after a few samples **[inferred]**.

**Why the last stage at `fs` is needed** **[checked]**: limiting at 4x to sample peaks at `C`, then
decimating, on hard material:

| Material | Lookahead | Output sample peak | Output true peak |
| --- | --- | --- | --- |
| Clipped drums (+12 dB into a clipper) | 0.1 ms | +0.66 dB over | +1.34 dB over |
| Clipped drums | 1 ms | +0.08 dB over | +0.68 dB over |
| Clipped white noise | 1 ms | +0.78 dB over | +0.86 dB over |
| A 0 dBFS sweep | 1 ms | +0.00 dB | +0.13 dB over |

The decimation filter removes the gain curve's sidebands and the waveform changes between the samples it
keeps. So after downsampling, the output goes through a last stage at `fs`: a **sample-peak catch** (the
same look-ahead limiter, 0.5 ms Hann, hold 1 ms, on the output's own sample peaks; exact by §5.4) when True
Peak Limiting is off, the **true peak stage** when it's on. Pro-L 2: "the actual output level now always
respects the ceiling that was set, either measured in sample levels or true peak levels" **[FF]**.

### 5.9 True peak limiting

**What a true peak is** **[std]**: "the maximum (positive or negative) value of the signal waveform in the
continuous time domain"; BS.1770's Annex 2 measures it by 4x oversampling with an order-48, four-phase FIR
(12 taps a phase; the coefficients are printed in the Recommendation), the absolute value, the maximum.
"Higher sampling rates and over-sampling ratios are preferred"; at 96 kHz 2x is enough. EBU Tech 3341 adds
tolerances (+0.2/−0.4 dB) and nine test signals (fs/4, fs/6, fs/8 tones at chosen phases, a +3 dBTP tone,
a single fs/4 period inside an fs/6 tone at four sub-sample offsets).

![An inter-sample peak](img/pro-l-truepeaks.gif)

**Pro-L's two parts** **[FF]**: "The limiting process will detect true peaks that already exist in the
input signal, and reduce them appropriately. Any true peak overshoot introduced by the ultra-fast limiting
process itself, will be smoothly attenuated afterwards." Extra latency: "about 5 ms".

**Ours** **[ours]**:

1. **In the main stage**: with oversampling the detector's samples at `fo` already track the true peaks;
   without it, the main stage's detector reads the true peak of the input (the detector below) instead of
   `|x|`.
2. **The true peak stage**, at `fs`, after the decimator, twice in a row:
   - **detector**: per sample `n`, the peak of the waveform around `n`: the maximum of `|y[n]|`, the four
     BS.1770 phases between `n−1` and `n+1` (so a BS.1770 meter can never read more than we saw), and an 8x
     Kaiser-windowed-sinc interpolator (128 taps a phase, β = 12) over the same span, each local maximum of
     its eight points refined by the parabola through it and its neighbours; at 88.2/96 kHz 4x, at
     176.4/192 kHz 2x (BS.1770's own allowance);
   - **requirement** `q[n] = min(1, C_int/peak[n])` with `C_int` 0.01 dB under the ceiling (a margin for
     what the detector can still miss, see below), spread to the 8 samples either side (the interpolator's
     main lobe);
   - **look-ahead** 1 ms: hold-min, Hann ramp, a fast release (5 ms), §5.4.
   - The second pass sees only what the first pass's own gain changes left: its gain changes are tiny, so its
     own residual is second-order.

**Checked** (48 kHz, ceiling −1 dBTP, references: the BS.1770 filter, and an independent 32x Kaiser sinc with
256 taps a phase, β = 14) **[checked]**:

| Experiment | Result |
| --- | --- |
| The BS.1770 filter on Tech 3341's tests 15–23 | Within the tolerance: −6.22, −5.98, −6.31, −6.03, +3.03, −0.02, +0.04, −0.12, −0.18 dBTP (expected −6, −6, −6, −6, +3, 0, 0, 0, 0). The 32x reference: −6.02 ×4, +2.99, +0.06 ×4 |
| The BS.1770 filter over-reads | A 0 dBFS sweep: +0.22 dB over the 32x reference; a band-limited square: +0.18 dB. Its passband isn't flat near 20 kHz: a limiter checking only with an ideal interpolator would fail a BS.1770 meter by 0.2 dB. Hence the ITU phases in our detector |
| Interpolators disagree near Nyquist | Clipped drums and clipped noise (energy right up to fs/2): an 8x interpolator with 48 taps a phase reads 0.6 dB under a 16x one with 128. "True peak" there depends on the reconstruction filter: Pro-L's "differences of 0.1 or 0.2 dBTP between different true peak meters are not unusual" **[FF]** |
| One pass, detector equal to the reference, 1 ms ramp | Up to +0.06 dB over (noise, clipped drums: 7 dB of true peak reduction); 2 ms: +0.013 dB |
| Two passes, same | ≤ +0.0012 dB (1 ms), ≤ +0.0001 dB (2 ms) |
| Cheaper detectors, on hard material band-limited to 0.47 fs (as after the decimator), two 1 ms passes, no margin | Overshoot by the 32x reference: 8x/64 taps +0.087 dB; 8x/128 +0.083; 16x/64 +0.027; 4x/96 with the parabola +0.040; **8x/64 with the parabola +0.017; 8x/128 with the parabola +0.004**. The grid's under-read, not the gain's movement, is what's left |
| **Ours** (8x/128 + parabola + ITU phases, two 1 ms passes, 0.01 dB margin), band-limited hard material | BS.1770 meter: **−0.0100 dB** (exactly the margin) on everything; 32x reference: **≤ −0.0057 dB**: under the ceiling by both |
| The same, full band (oversampling off, clipped drums and clipped noise as they are) | BS.1770: −0.0100 dB; 32x reference: **+0.28 / +0.39 dB**: the near-Nyquist disagreement above, not the limiter |
| Sample-peak catch | −0.0000 dB over on everything |

So: **with oversampling on (2x or more), the output's true peak stays under the ceiling by BS.1770's meter
and by an ideal reconstruction**. With oversampling **off**, on input that already has
energy at half the rate (clipped, square, noise), "true" depends on the interpolator: we guarantee it by
BS.1770's filter and our detector, and an ideal reconstruction may read up to ~0.5 dB more. That is why
FabFilter: "we highly recommend to use oversampling in combination with true peak limiting" **[FF]**. The
window says so when TP is on and oversampling off **[ours]**.

**Its latency** **[ours]**: per pass, the 1 ms look-ahead (48 samples at 48 kHz), the detector's half-length
(64 samples at the host rate) and the spread (8): 2 × (48 + 64 + 8) = **240 samples = 5.0 ms at 48 kHz**,
Pro-L's "about 5 ms" **[FF]**.

### 5.10 Latency

What's known of Pro-L 2's **[FF]** **[user]**:

| Setting | Latency | Source |
| --- | --- | --- |
| True Peak Limiting on | "about 5 ms" more | the manual |
| The new four styles | "need more latency than others" | the manual |
| Transparent (2018, Logic, settings not given) | 12 ms (Pro-L 1: 8 ms) | user, FabFilter forum |
| Bus (same) | "> 65 ms" | user, FabFilter forum |
| Transparent, look-ahead off (2024, rate not given) | 496 samples | user, FabFilter forum |
| For the least | "choose the Transparent algorithm and also disable True Peak Limiting" (and oversampling) | FabFilter staff |

Ours, fixed by the style, oversampling and true peak (never by Lookahead, Attack or Release) **[ours]**:

```
latency = round((reserve + 5 ms)·fs)   + oversampling (0 when Off, ≈ 63–74 samples)   + last stage
          main stage                                                                       (0 if k = 1 and TP off;
                                                                                            sample catch 0.5 ms if k > 1;
                                                                                            true peak stage 240 samples at 48 kHz)
```

At 48 kHz (samples / ms):

| Style | Off, TP off | 4x, TP off | 4x, TP on |
| --- | --- | --- | --- |
| Transparent, Punchy, Allround | 240 / 5.0 | 335 / 7.0 | 551 / 11.5 |
| Dynamic | 336 / 7.0 | 431 / 9.0 | 647 / 13.5 |
| Aggressive | 384 / 8.0 | 479 / 10.0 | 695 / 14.5 |
| Modern | 720 / 15.0 | 815 / 17.0 | 1031 / 21.5 |
| Safe | 1200 / 25.0 | 1295 / 27.0 | 1511 / 31.5 |
| Bus | 2640 / 55.0 | 2735 / 57.0 | 2951 / 61.5 |

(The 4x column adds 71 samples of filters and 24 of the sample catch; the TP column replaces the catch by the
240-sample true peak stage. Off with TP on: the main stage plus 240.)

The engine reports it to `Song::compensate`, as Pro-Q and Auto-Tune do; a change of style, oversampling or
true peak remakes the song with the new delay (as a Pro-Q mode change does). A Lookahead change within the
reserved 5 ms moves only where the ramp starts, inside the same delay.

### 5.11 Dither and noise shaping

What Pro-L does **[FF]**: Dither Off / 24 / 22 / 20 / 18 / 16 bits; TPDF noise, "2-bit peak-to-peak" (the sum
of two independent uniform values of ±½ LSB: triangular over ±1 LSB, the standard choice: it makes the
quantisation error's mean and variance independent of the signal); three noise shapings: **Basic** ("lowers
the overall noise floor a few dB, at the cost of increasing noise levels for frequencies above 6 kHz"),
**Optimized** ("an even lower overall noise level, but noise frequencies above 10 kHz are boosted more
extremely"), **Weighted** ("according to the ear's sensitivity … at low listening levels … designed to be used
at 44.1 kHz"). Use it "only … as the final stage", once.

**How** **[ours]**: an error-feedback quantiser, per channel, at the end:

```
v = x[n] − Σ_k h_k·e[n−k]          (the shaped error fed back)
y = Q(v + tpdf)                    (Q: round to the bit depth's step, 2^−(bits−1))
e[n] = y − v                       (the error of the quantiser, dither included)
```

The noise's spectrum is `|1 − H(e^jω)|²` times the white TPDF noise. The filters are published ones (the set
SoX ships, from Lipshitz, Vanderkooy and Wannamaker's papers), picked by matching FabFilter's descriptions
**[inferred]**:

| Shaping | Filter `h` (44.1 kHz) | Why it matches |
| --- | --- | --- |
| **Basic** | Lipshitz's 5-tap "minimally audible" `2.033, −2.165, 1.959, −1.590, 0.6149` | moderate dip in the mid band, rise above ~6–8 kHz |
| **Optimized** | improved E-weighted, 9 taps `2.847, −4.685, 6.214, −7.184, 6.639, −5.032, 3.263, −1.632, 0.4191` | deeper dip, a steep rise above ~10 kHz |
| **Weighted** | F-weighted (Wannamaker), 9 taps `2.412, −3.370, 3.937, −4.174, 3.353, −2.205, 1.281, −0.569, 0.0847` | the ear's threshold curve at low level; made for 44.1 kHz (so is Pro-L's) |

At 48 kHz the 44.1 kHz filters are close (their curves shift up 9%); SoX has 48 kHz sets for some
(Gesemann's `2.2374, −0.7339, …`); above 48 kHz, shaping moves the noise above 24 kHz and is simple to
redesign (or fall back to flat TPDF) **[inferred]**. The error feedback must be clamped (a large `h` gain
with a clipped output can run away): clip `v` to ±1 and reset `e` on overload **[inferred]**.

**Relation to the export**: the export already dithers to 16 bits through ffmpeg (`aresample` with
Shibata noise shaping) when asked. Dithering twice only adds noise **[FF]**: when a master Pro-L dithers, the
export's dither must be off (and the export's gain 1, or the 16-bit grid is lost). See
[§8.8](#88-how-it-relates-to-the-export).

### 5.12 Loudness metering

All from ITU-R BS.1770-5 and EBU Tech 3341 / 3342 **[std]**, on the output (after the limiter, before Unity
Gain and dither) **[inferred]**:

**K-weighting at any rate.** The ITU gives the two biquads only at 48 kHz ("implementations at other sampling
rates will require different coefficient values … the same frequency response"). The standard derivation
(libebur128's) from the analog prototypes, a high shelf and a high pass:

```
shelf:  f0 = 1681.974450955533 Hz, G = 3.999843853973347 dB, Q = 0.7071752369554196
        K = tan(π·f0/fs), Vh = 10^(G/20), Vb = Vh^0.4996667741545416, a0 = 1 + K/Q + K²
        b = [(Vh + Vb·K/Q + K²), 2(K² − Vh), (Vh − Vb·K/Q + K²)] / a0
        a = [1, 2(K² − 1)/a0, (1 − K/Q + K²)/a0]
high pass:  f0 = 38.13547087602444 Hz, Q = 0.5003270373238773, K = tan(π·f0/fs)
        b = [1, −2, 1],  a = [1, 2(K² − 1)/(1 + K/Q + K²), (1 − K/Q + K²)/(1 + K/Q + K²)]
```

At 48 kHz this gives `1.53512485958697, −2.69169618940638, 1.19839281085285 / −1.69065929318241,
0.73248077421585` and `−1.99004745483398, 0.99007225036621`: the ITU's tables to every printed digit; a 0 dBFS
997 Hz sine in one channel reads −3.010 LKFS (the ITU: −3.01) **[checked]**. The K-weighting's gain at 997 Hz is
+0.691 dB at 48 kHz, +0.694 at 44.1 and +0.674 at 96 kHz **[checked]**: rates differ by 0.02 dB, inside every
tolerance.

**The measurements.** Squares of the weighted signal are summed per channel into **100 ms sub-blocks**
(`round(0.1·fs)` samples), weighted by `G_i` (1.0 for L and R; 1.41 for surrounds) **[std]**:

| Measure | How | Updated |
| --- | --- | --- |
| **Momentary** M | the last 4 sub-blocks (400 ms), ungated: `−0.691 + 10·log10(Σ_i G_i·z_i)` | every 100 ms (≥ 10 Hz, Tech 3341) |
| **Short-term** S | the last 30 sub-blocks (3 s), ungated | every 100 ms |
| **Integrated** I | every 400 ms block (75% overlap: one per 100 ms, i.e. each M value) since the reset, gated: absolute −70 LUFS, then relative −10 LU below the absolute-gated mean of power | every 100 ms (≥ 1 Hz) |
| **LRA** | the S values (one per 100 ms, ≥ 10 Hz) since the reset, gated at −70 LUFS and −20 LU, then the 95th percentile minus the 10th (Tech 3342's MATLAB) | every 100 ms; flagged unsettled for the first 60 s (Tech 3341) |
| **Max M / Max S** | the largest M and S since the reset | |
| **Max true peak** | the true peak detector (§5.9) on the output, since the reset | |
| **PLR** ([ours], not in Pro-L) | max true peak − I | |

**No allocation on the audio thread**: Integrated needs every block since the reset and LRA every S value; an
hour is 36 000 of each. Both go into **histograms** of fixed size (libebur128's histogram mode): bins of
0.01 LU from −70 to +10 LUFS (8000 bins), each holding a count and (for I) the sum of the blocks' powers, so
the gated mean is exact except for the blocks in the one bin the relative gate falls in (all counted in or
all out: it only matters if many blocks sit within 0.01 LU of the gate, and even then by hundredths of an LU)
and LRA's percentiles are read to 0.01 LU **[inferred]**. 2 × 8000 × 16 bytes = 256 KB per instance, allocated
with it. The audio thread updates the bins and, every 100 ms, recomputes I and LRA (a scan of 8000 bins: a few
microseconds) and publishes them through atomics **[ours]**.

**Pause and reset**: pause stops adding blocks (I, LRA, the maxima) but the meters keep moving; reset empties
the histograms, the maxima and the peak and gain-reduction readings; auto-reset happens when play starts.
**[FF]**

**The output meter's RMS**: per channel, the Momentary (K-weighted, 400 ms) of that channel alone, and the
combined one **[FF]**; the peaks by the sample or true peak detector depending on TP. **K-System scales**: the
meter's 0 mark moved to −12, −14 or −20 dBFS. Katz's own K-meters use unweighted (flat) RMS, and Pro-L 1's
RMS was a 2000 ms average **[FF, Pro-L 1]**, but Pro-L 2's RMS is the Momentary loudness in every scale
**[FF]**, so ours is too.

**Conformance** (what the tests check, §8.9): Tech 3341's tests 1–6 and 9–23 within ±0.1 LU (true peak
+0.2/−0.4 dB), Tech 3342's 1–4 within ±1 LU. The two "authentic programme" tests of each (7–8, 5–6) need the
EBU's files.

### 5.13 Parameter changes, sample rate, denormals, determinism

- **Gain and Output** glide (a one-pole in dB, 10 ms) **[ours]**; Pro-L has "Smart Parameter Interpolation"
  **[FF]**. The ceiling the gain computer uses travels with the sound: the requirement for a sample is
  computed with the ceiling at the time it enters, and applied when it leaves `D` later; the true peak stage
  reads its ceiling from the same delayed copy, so a falling ceiling never lets a sample through above itself
  **[inferred]**.
- **Lookahead** glides at most 0.05 ms per 10 ms (the ramp lengthens or shortens a sample at a time); the
  hold-min window is the whole reserve, so nothing has to be recomputed **[ours]**.
- **Attack, Release, links** take effect at once (they change rates and weights, not levels).
- **Style, oversampling, true peak** change the latency: a new core (buffers, filters) is built on the message
  thread and handed over by atomic exchange; the old one is faded out over 10 ms and returned to be deleted,
  as Pro-Q's convolvers are; the song is remade with the new delay **[ours]**.
- **Sample-rate independence**: every time is in seconds and turned into samples at the rate it runs at
  (`fo` or `fs`); the K-weighting is derived per rate; the true peak detector's factor is chosen per rate
  (8x / 4x / 2x); the dither filters per rate. A song sounds the same at 44.1 and 96 kHz within the
  filters' small differences.
- **Denormals**: the engine runs under `ScopedNoDenormals` (flush to zero) already; release followers are
  floored (a reduction under 1e-6 dB is 0), so they stop moving in silence.
- **Determinism**: everything is per sample, with state carried between blocks; nothing depends on the block
  size, so live (any buffer), offline and export (2048) render the same samples, and the parallel export is
  identical to one thread (a track's effects touch only its own buffers). Automation lanes are applied at the
  256-sample slices like every other lane.

### 5.14 CPU budget

Per channel per host sample, roughly **[inferred]**:

| Part | Multiply-adds |
| --- | --- |
| Oversampling up + down, 4x (half-band stages, half the taps zero) | ~ 2 × (64 + 2·16) ≈ 200 |
| Limiter at `fo` (detector, linking, wedge, kernel by running sums, release, multiply) | ~ 30 × k (120 at 4x, 960 at 32x) |
| Release stage at `fs` | ~ 15 |
| True peak stage ×2 (8 phases × 128 taps, the parabola, ITU's 48) | ~ 2 × 1080 ≈ 2200 |
| Loudness (two biquads, a square, sums) and meters | ~ 20 |

At 4x with true peak, ~2.5 k operations a sample, 48 kHz stereo: ~250 M/s, a few per cent of one core with
SIMD (the FIRs vectorise well); 32x about half as much again. The true peak detector is the largest part: if
it's ever too heavy, 8x/64 taps with the parabola is within 0.017 dB (§5.9), covered by a 0.02 dB margin.
Fine for one or two on a master; Pro-L's own labels warn about 16x and 32x **[FF]**.

### 5.15 What feeds the display and the meters

Per 10 ms "column" the engine keeps, per instance: the input's peak (after Gain, before limiting), the
output's peak, the largest gain reduction, and M and S at that moment; plus the meter values (output peak or
true peak per channel, momentary RMS per channel and combined, gain reduction per channel, I, LRA, Max M,
Max S, max true peak, max gain reduction). They go to the tab in each transport event (25 a second: two or
three columns each) for the Pro-Ls whose window is open, as Pro-Q's analyzer does (§8.6). The peak labels
are found in the tab from the gain reduction columns (local maxima a few dB deep and far enough apart)
**[ours]**: they're a drawing matter.

### 5.16 How the [checked] claims were checked

Python 3.9, NumPy 2.0, SciPy 1.13, at 48 kHz. Not committed (they're not tests of our code; the tests are in
§8.9):

- **K-weighting**: the formulas above at 48 kHz compared with BS.1770-5's Tables 1 and 2 (identical to 14
  digits); `scipy.signal.freqz` at 997 Hz for 44.1, 48 and 96 kHz; 5 s of a 0 dBFS 997 Hz sine in one
  channel through `lfilter`, the loudness formula (−3.0103 LKFS).
- **BS.1770's interpolator**: the printed 48 coefficients as four 12-tap phases; Tech 3341's signals 15–23
  synthesised as the document says (19's amplitude 1.41; 20–23 made at 4·fs, low-passed with a 511-tap Kaiser
  FIR and decimated at offsets 0–3); the reference a 32x Kaiser-windowed sinc, 256 taps a phase, β = 14,
  through `upfirdn`.
- **Hard material**: drum hits (noise bursts with 30 ms decays and a pitch-swept kick, four a second)
  clipped after +12 dB; white noise at 0.5 RMS clipped at ±1.5; a band-limited 3.1 kHz square (four
  harmonics, peak 1.2); a quarter-rate sine at +3 dBTP; a 20 Hz–20 kHz sweep at 0 dBFS; 3 s each, 5 ms fades
  and silence around them (without them, the reference's own ringing on the cut ends reads as overshoot).
- **The stage**: §5.4's construction with `sliding_window_view` minima, a Hann kernel, spreads of 0–8
  samples, one or two passes; the overshoot read as the reference's maximum over the ceiling. Detectors: 4x,
  8x and 16x Kaiser sincs of 48–128 taps a phase, with or without a three-point parabola at each local
  maximum, always with the four BS.1770 phases and the samples themselves. "Band-limited" material went
  through a 1023-tap Kaiser low-pass flat to 0.45 fs and −114 dB from 0.485 fs, standing in for the
  decimator's output.
- **Oversampled limiting**: `resample_poly` 4x up (Kaiser β = 10), §5.4's stage on sample peaks at 4x
  (lookahead 0.1 and 1 ms), `resample_poly` down; sample and true peaks of the result.

---

## 6. The factory presets

**Pro-L 2's**: the list isn't published. What's known **[FF]**: they're "divided per musical genre and have
descriptive names"; most were made by outside engineers (**bManic** (Niklas Silén), **Stephan Muesch (SM)**,
**Ricardo Sangiao (RS)**); the **Default Setting** loads with every new instance; all were saved with the
output at 0.0 dB; Pro-L 1's presets are under "V1 Preset Folder". Names seen **[observed]**: Default Setting,
Modern. Pro-L 1 had one called "Jazzy, Spacious, Dynamic and Loud" **[user, SOS]**. Presets are "different
permutations of the Advanced Settings" (SOS) **[user]**: style, lookahead, attack, release, links.

**Ours** **[ours]**, by what they're for (with Lock Output on, only the sound changes). Gain is left at 0 dB in
every preset (the user sets how loud); Output, True Peak and oversampling only in the delivery presets:

| Preset | Style | Lookahead | Attack | Release | Links (T / R) | Delivery | For |
| --- | --- | --- | --- | --- | --- | --- | --- |
| **Default Setting** | Modern | 0.5 ms | 150 ms | 300 ms | 75 / 100% | TP, 4x, −1.0 dBTP | anything |
| Master: Clean | Transparent | 0.5 ms | 150 ms | 500 ms | 75 / 100% | | pop, rock, acoustic, a few dB |
| Master: Loud and Clean | Modern | 0.2 ms | 300 ms | 200 ms | 70 / 100% | | modern pop, hip-hop |
| Master: EDM | Aggressive | 0.1 ms | 1 s | 100 ms | 60 / 100% | | EDM, trap, dense and loud |
| Master: Rock Punch | Dynamic | 0.3 ms | 250 ms | 250 ms | 80 / 100% | | rock, live drums |
| Master: Allround | Allround | 0.5 ms | 250 ms | 500 ms | 80 / 100% | | when unsure |
| Master: Classical and Acoustic | Safe | 5 ms | 0 s | 1 s | 100 / 100% | | delicate, dynamic music |
| Master: 808 Control | Modern | 1 ms | 400 ms | 400 ms | 100 / 100% | | sub-heavy beats (bass stays clean) |
| Drum Bus: Glue | Bus | 2 ms | 30 ms | 300 ms | 100 / 100% | | drum bus, a few dB |
| Drum Bus: Squash | Bus | 1 ms | 10 ms | 150 ms | 100 / 100% | | parallel or crushed drums |
| Vocal: Peak Catcher | Punchy | 2 ms | 150 ms | 200 ms | 100 / 100% | | after the vocal compressor |
| Vocal: Smooth | Safe | 5 ms | 0 s | 300 ms | 100 / 100% | | ballads, spoken word |
| Bass and Guitar | Punchy | 1.5 ms | 250 ms | 500 ms | 100 / 100% | | single instruments |
| Streaming (−14 LUFS) | Modern | 0.5 ms | 150 ms | 300 ms | 75 / 100% | TP, 4x, −1.0 dBTP, target −14 | Spotify, YouTube, Tidal |
| Broadcast EBU R 128 | Transparent | 1 ms | 150 ms | 500 ms | 100 / 100% | TP, 4x, −1.0 dBTP, target −23 | TV, radio (Europe) |
| Broadcast ATSC A/85 | Transparent | 1 ms | 150 ms | 500 ms | 100 / 100% | TP, 4x, −2.0 dBTP, target −24 | TV (US) |
| CD Master | Modern | 0.5 ms | 150 ms | 300 ms | 75 / 100% | TP, 8x, −0.1 dBTP, 16 bits (O), target −9 | a 16-bit master |

---

## 7. Proposed for Vaudio

Not yet talked through with Théo (2026-10-02, from his request: "FabFilter Pro-L 2 is pretty fire, we can do
something similar"). What's proposed, to check with him:

### 7.1 Decided, to confirm

- **A stock effect of ours**, chosen from an effect slot's picker (Built in → Pro-L), as Pro-Q is: its
  settings **in the song** (`MixerEffect.proL`: every change undone, read and set by the assistant), the
  engine running it natively. The real Pro-L 2 can still be loaded as a plugin beside it.
- **Its look is FabFilter's, as Pro-Q's is**: the dark display, the blue input and output, the red gain
  reduction, the amber labels, FabFilter's knob, in every theme (a plugin's window keeps its own look). Its
  colours are theme tokens: Pro-Q's surfaces (`--eq-bg-*`, `--eq-bar`, `--eq-knob*`, `--eq-text`) and its own
  `--lim-*` (input, output, reduction, label, loudness low / near / over, target), plain colours so the canvases
  can read them.
- **The engine is one engine with eight styles as tables** ([§4](#4-the-styles)): each tuned to FabFilter's
  description, to be tuned again by ear (and, if Théo has Pro-L 2, by measurement).
- **A new Pro-L** is the Default Setting: Modern, True Peak Limiting on, 4x, ceiling −1.0 dBTP (Pro-L's own
  presets are at 0.0 dB, TP not stated; ours starts where streaming wants it).
- **The ceiling is never exceeded**, by construction ([§5.4](#54-look-ahead-without-overshoot), §5.8–5.9):
  sample peaks always; true peaks by the BS.1770 meter always, and by any good reconstruction whenever
  oversampling is on. Every style, oversampling and lookahead is tested on hard material.
- **Latency is fixed** by the style, oversampling and true peak; the Lookahead knob turns inside it, so it
  automates without moving the song's delay compensation.
- **The meters run whether the window is open or not** (the loudness of a whole song needs it); what the
  display draws is sent only for open windows.
- **The slot's mix knob**: every effect slot has one; below 100% the dry sound is added back (held back by the
  latency, so it doesn't comb) and the ceiling no longer holds. The window says so. Pro-L has no mix **[FF]**.
- **Unity Gain and Audition** are in the song, as Pro-L's parameters are (an undo step each); the window
  shows them lit, as Pro-L does.
- **No external side chain, no MIDI Learn, no surround**: the app has none of those for effects yet. Every
  continuous control is automatable instead.

### 7.2 First, then later

| First | Later |
| --- | --- |
| The eight styles; Gain, Output, Lookahead, Attack, Release, both links | Compact view (a layout of the same window) |
| True Peak Limiting; oversampling Off to 32x | Stems through the master's limiter (§8.8) |
| DC filter, Unity Gain, Audition | An **Analyze** render: the song's I, LRA, max true peak and gain reduction at the current settings, without playing it (Pro Tools' AudioSuite Analyze **[FF]**), and with it **Gain to target** (one click, and the assistant's) |
| Dither (24 … 16 bits) with Basic, Optimized, Weighted | Loudness and true peak of every export, in the export window (the same meter code) |
| The display (Fast, Slow, Slow Down, Infinite, Off), peak labels, the loudness curve | Per-platform targets beyond Pro-L's four (Spotify's Loud / Quiet, Apple Music, YouTube…) |
| The meters: 16 / 32 / 48 dB, K-12 / 14 / 20, Loudness; TP metering; readouts that reset | PLR history, a loudness log to export |
| Loudness: M, S, I, LRA, Max M / S, targets −9 / −14 / −23 / −24 / custom, +9 / +18, absolute / relative, pause, reset, auto-reset | |
| Presets, Lock Output, A/B, Copy, the app's undo | Saving presets of one's own |
| Automation of the seven continuous controls; tools | |

### 7.3 Where Vaudio would differ

| What | Pro-L 2 | Vaudio |
| --- | --- | --- |
| Styles' insides | FabFilter's, unpublished | Ours, reconstructed from the descriptions; to be tuned by ear |
| Latency | Per style, partly unknown (Transparent ~12 ms, Bus > 65 ms, TP +5 ms, reported) | Fixed per style / oversampling / TP, from 5 ms (Transparent, Off) to 61.5 ms (Bus, 4x, TP) at any rate |
| External side chain (stem mastering) | Yes | No sidechain inputs to effects yet; possibly stems through the master's gain curve instead (§8.8) |
| Surround, Dolby Atmos | Up to 9.1.6 | Stereo |
| MIDI Learn, MIDI program changes | Yes | No (no MIDI to effects); automation clips instead |
| Automation | Every parameter | Gain, Output, Lookahead, Attack, Release, both links (the rest change latency or are set once) |
| Mix | None | The slot's mix knob (warned about) |
| Presets | Files, folders, Save As Default | Factory presets (ours), A/B and Copy; Copy / Paste of the whole effect |
| Loudness | Four target presets and custom | The same, plus PLR; per-platform targets later |
| Undo | Its own | The app's |
| Sizes | Compact, Small, Medium, Large, scaling, full screen | The window resizes freely and fills the desktop (double-click its title); Compact later |
| Help | Interactive hints | Tooltips |

---

## 8. How it'd be built here

The same shape as Pro-Q and PanMan: the document and what it means in TypeScript, the sound in C++, the window
in React.

### 8.1 The document

```ts
// shared/music/types.ts
export const PRO_L_STYLES = ["transparent", "punchy", "dynamic", "allround", "aggressive", "modern", "bus", "safe"] as const;
export type ProLStyle = (typeof PRO_L_STYLES)[number];

/** Pro-L's sound: what A/B swaps and presets set. Levels in dB, times in seconds, links 0..1. */
export interface ProLState {
  style: ProLStyle;
  gain: number;            // 0..30
  output: number;          // −30..0 (dBTP with truePeak)
  lookahead: number;       // 0..0.005
  attack: number;          // 0..10
  release: number;         // 0..10
  linkTransients: number;  // 0..1
  linkRelease: number;     // 0..1
  truePeak: boolean;
  oversampling: 1 | 2 | 4 | 8 | 16 | 32;
  dither: 0 | 16 | 18 | 20 | 22 | 24;   // 0: off
  noiseShaping: "basic" | "optimized" | "weighted";
  dcFilter: boolean;
  unityGain: boolean;
  audition: boolean;
}

/** How it meters and shows (left alone by presets and A/B, as Pro-L's metering settings are). */
export interface ProLMeter {
  scale: "16" | "32" | "48" | "k12" | "k14" | "k20" | "loudness";
  truePeakMeter: boolean;
  display: "slowDown" | "fast" | "slow" | "infinite" | "off";
  target: number;                 // LUFS, −9 / −14 / −23 / −24 or custom
  timeScale: "momentary" | "shortTerm" | "integrated";
  loudnessRange: 9 | 18;          // the +9 / +18 scale
  relative: boolean;              // LU around the target, or LUFS
  maxOf: "momentary" | "shortTerm";
  autoReset: boolean;
}

export interface ProL extends ProLState {
  /** The factory preset last loaded (the name shown, what's dimmed once changed). */
  preset: string;
  lockOutput: boolean;
  ab: "a" | "b";
  other: ProLState | null;
  meter: ProLMeter;
}
// MixerEffect.proL?: ProL, on an effect whose plugin is PRO_L_PLUGIN ({ id: "vaudio:pro-l", name: "Pro-L", format: "Vaudio" }).
```

Bypass is the slot's `enabled` (the engine fades it, as Pro-L's "soft bypassing"; its latency stays in the
compensation, as Pro-L's global bypass "is guaranteed to correctly compensate the latency"). Validated by
`normalizeProL` (or it's dropped on load and save).

### 8.2 The files

| File | What |
| --- | --- |
| `shared/music/pro-l-presets.ts` | `PRO_L_PLUGIN`, `isProL`; every control's range, default and taper (`PRO_L_CONTROLS`: Lookahead skewed so 1 ms is the middle; Attack and Release 0–10 s with 250 ms in the middle, JUCE's skew `log 0.5 / log(0.025)`); the **style tables** (§4); the loudness targets and their labels ("−14 (Strm)"); the presets (§6); `DEFAULT_PRO_L`; `normalizeProL`. Tested. |
| `shared/music/pro-l.ts` | `findProL`, `editProL`, `updateProL` (a patch; the same song when nothing changes), `loadProLPreset` (keeps Gain, Output, TP, oversampling, dither, DC, Unity when `lockOutput`), `switchProLAB` / `copyProLAB`, `engineProL` (what the engine plays: the style's table resolved, controls in engine units), `proLLatencySeconds` (for the window's readout; the engine's samples are what counts). Tested. |
| `shared/music/loudness.ts` | A plain TypeScript BS.1770-5 / Tech 3341 / 3342 meter (K-weighting at any rate, M, S, I, LRA, Annex 2 true peak): the **independent reference** the integration tests measure the engine's sound and meters with, and the tab's maths for the meter scales. Tested against Tech 3341 / 3342's signals. |
| `shared/music/compile.ts` | `EngineEffect.proL`; lanes `kind: "limiter"`. |
| `engine/src/ProL.h/.cpp` | `limit::Settings` (parsed on the message thread), `limit::State` (per effect id: the core, the meters), `limit::Registry`. The chain of §5.1. |
| `engine/src/Lookahead.h` | The look-ahead limiter of §5.4: the wedge, the kernels (Hann, box by running sums, adaptive), the hold, the release. Pure DSP, used three times (main stage, sample catch, true peak stage). |
| `engine/src/Oversampler.h/.cpp` | The half-band cascade (2x … 32x, linear phase, integer latency). Reusable: saturation in PanMan's Analog Styles or EchoBoy could use it. |
| `engine/src/TruePeak.h/.cpp` | The detector of §5.9 (ITU phases, 8x/128 + parabola; 4x/2x at higher rates). Reusable by the export to report true peaks. |
| `engine/src/Loudness.h/.cpp` | The meter of §5.12 (K-weighting, sub-blocks, histograms, M / S / I / LRA / maxima). Reusable by the export and a future master meter. |
| `engine/src/Dither.h` | TPDF and the error-feedback quantiser with the shaping tables by rate. |
| `engine/src/Song.cpp`, `Sequencer.cpp`, `Engine.cpp`, `Export.cpp` | Parse `vaudio:pro-l` into a `Track::Effect` (`limSettings`, `lim`); `Song::compensate` adds its latency; `Sequencer::runProL` (with the dry held back for the slot's mix) and its lanes (`setLimiterControl`); the `proL` command (reset, pause, resume a meter); `limiters` in transport events and in `render`'s answer; the export's own registry (as Pro-Q's). |
| `server/music/fake-engine.mjs` | Answers `proL`; sends made-up `limiters` readings, so e2e can see the meters move. |
| `src/suites/music/pro-l/` | `pro-l-window.tsx` (top bar, display, Gain strip, Advanced panel, meters, loudness panel, bottom bar, output panel), `display.tsx` + `draw.ts` (the canvas: the scrolling picture, gain reduction, loudness curve, peak labels; drawn every frame something moves), `meters.ts` (the meters' and loudness bars' drawing and falls), `history.ts` (the columns, outside React, timed for smooth scrolling, as Auto-Tune's `pitch-history.ts`), `labels.ts` (finding the peak labels; tested), `geometry.ts` (meter scales with their linear tops, loudness colours, the connecting curves; tested), `actions.ts`, `store.ts` (open windows, the Advanced panel open, the display's pause), `tool-edits.ts` (tested). |
| `src/suites/music/fabfilter/` | **New, shared with Pro-Q**: the FabFilter knob (moved from `pro-q/knob.tsx`), the top bar (undo, redo, A/B, Copy, presets), the bottom bar's buttons. Pro-L is the second FabFilter clone; this is the moment to share them. |
| `src/themes/studio.css` | `--lim-*` tokens (dark in every theme, like `--eq-*`). |
| Tests | `shared/music/pro-l.test.ts`, `loudness.test.ts`, `server/music/pro-l.integration.test.ts`, `e2e/music.spec.ts`. |

### 8.3 What's decided where

| In TypeScript (tested, the song's) | In the engine (C++, the sound's) |
| --- | --- |
| What each style *is* (its table), presets, defaults, ranges, tapers | Every sample: oversampling, detection, linking, both stages, clipper, emphasis, true peak stage, dither |
| The ceiling, Gain and Unity in dB; times in seconds | Times turned into samples at the rate it runs (`fs`, `fo`); the latency in samples |
| Which noise shaping, which bit depth | The shaping coefficients for the rate |
| The meters' scales, colours, targets, labels (drawing) | The measurements: peaks, true peaks, RMS, M, S, I, LRA, maxima, the columns |
| Automation curves sampled into lanes | Lanes applied per 256-sample slice |

As everywhere in the music suite, nothing musical is decided in C++ that TypeScript could decide; but limiting
is sound, so it's the engine's, and its tests are in the engine's integration tests.

### 8.4 The engine's state and the audio thread

- **By effect id** (`limit::Registry`, like `eq::Registry`): a song edit doesn't empty its delay lines or reset
  its meters; the export makes its own registry (its meters then describe the export).
- **The core** (delay lines, wedges, oversampler, true peak rings: sized by style, oversampling and rate) is
  built on the message thread when those change, handed to the audio thread by atomic exchange, faded in over
  10 ms while the old one fades out, and returned to be deleted (`collect`), as `Convolver::offer` does. The
  **meters** live in the State, outside the core, so a style change doesn't reset the integrated loudness.
- **Nothing on the audio thread allocates, locks or does I/O**: histograms and rings are allocated with the
  State or core; readings go out through atomics (the latest) and a single-producer ring of columns that the
  message thread drains for each transport event; reset and pause are atomics.
- **Sizes**: the largest ring is Bus at 32x: 55 ms × 32 × 48 kHz ≈ 84 000 samples a channel (×2 for the
  wedge's indices): under 2 MB; nothing else comes close.

### 8.5 Latency and compensation

`Song::compensate` adds `effect.limSettings->latency` for an enabled Pro-L, as it does `eqSettings->latency`
and `tune->latency()`. The latency is computed when the song is parsed, at the device's rate (§5.10). A
style / oversampling / true peak change makes the song again with the new delay (`checkLatencies` already does
when a plugin's latency changes). The slot's dry sound is held back by the same amount (`mixDry`, as Pro-Q).
`songLatency` keeps the playhead in time; the export trims it, so an exported master starts on its first
sample.

### 8.6 Automation, events, the window

- **Automation**: `AutomationTarget` `{ kind: "proL"; effect: string; control: ProLControl }`,
  `ProLControl = "gain" | "output" | "lookahead" | "attack" | "release" | "linkTransients" | "linkRelease"`;
  a knob with a `target` gets Create automation clip. Lanes `kind: "limiter"` in the engine's units (dB,
  seconds, 0..1: all within the lanes' ±64, no scaling), set at each slice's start; the engine glides them
  (§5.13).
- **Transport events**: `EngineTransport.limiters?: Record<effectId, EngineLimiterState>`: the meter values
  (§5.15) for every Pro-L, and the columns since the last event for those watched (`limWatch`, the open
  windows, like `eqWatch`).
- **The window** (FabFilter's layout, §2.1): the display canvas with the Gain strip on its left (dragging
  anywhere on it, Alt-drag moving Output the other way: our modifier for linked knobs), the Advanced panel
  sliding out, the meters and the loudness panel at the right, the bottom bar with the output panel popping
  up. FabFilter's knob gestures map onto ours: drag, wheel, double-click to type, Cmd-click to reset, Shift
  for fine. Right-click on a knob is the app's menu (Create automation clip), as everywhere in the suite.
  Keys while it's in front: none needed (Space plays, as everywhere).

### 8.7 The assistant's tools

| Tool | Kind | What |
| --- | --- | --- |
| `get_pro_l` | look | Its settings, its latency, and the readings: I, S, M, LRA, Max M / S, max true peak, max gain reduction, PLR, whether it's measured anything since the reset. What a mastering engineer would read off it. |
| `update_pro_l` | edit | A patch: style, gain, output, lookahead, attack, release, links, true peak, oversampling, dither and shaping, DC, unity, audition, target, scale; or a preset by name (respecting Lock Output). Errors name the allowed values. |
| `reset_pro_l_meter` | action | Reset (or pause, resume) its loudness measurement. |
| `add_mixer_effect` | (exists) | Takes "Pro-L". |
| `add_automation` | (exists) | Takes "limiter gain", "limiter output", "limiter lookahead", "limiter attack", "limiter release", "limiter link transients", "limiter link release". |
| later: `analyze_pro_l` | action | The song rendered offline through it (no file): I, LRA, max true peak, gain reduction over time. With it, the assistant can set Gain to reach a target in two or three tries (the loudness rises monotonically with Gain). |

Edits are pure `(song, input, env) => { song, text }` in `tool-edits.ts` (tested); labels in
`describeToolCall`, icons in `tool-steps.tsx`; `describeMixer` mentions a Pro-L's style, ceiling and latency.

### 8.8 How it relates to the export

- **`preventClipping` / `exportGain`** (`shared/music/export.ts`) turns a whole render down, statically, until
  its loudest *sample* is at `CLIP_CEILING` (−0.3 dBFS): a safety net that costs loudness and knows nothing of
  true peaks. A Pro-L on the master is the musical answer: it limits dynamically, to a *true peak* ceiling. With
  a Pro-L at −1 dBTP last on the master, the render's peak is under `CLIP_CEILING`, so `exportGain` is 1 and
  nothing changes. **But** a Pro-L at 0.0 dB (Pro-L's own presets' ceiling) peaks above −0.3 dBFS and
  `exportGain` would turn the whole song down by up to 0.3 dB, undoing the ceiling the user chose and
  any dither. Proposed: when the master's last enabled effect is a Pro-L, `exportGain` only acts above 0 dBFS
  (which the render can't reach unless something after the Pro-L adds level) **[ours, to confirm]**.
- **Dither**: the export's 16-bit dither (ffmpeg's Shibata shaping) and a Pro-L's dither must not both run.
  When a master Pro-L dithers, the export window says so and leaves its own off; a Pro-L dithering to 16 bits
  makes the 32-bit float render hold 16-bit values exactly, which ffmpeg's `s16` conversion keeps as they are
  (no `volume`, no `aresample` dither). Pro-L's advice applies: dither once, last **[FF]**.
- **Stems**: the export's stems are each track after its fader, before the master's effects; with a limiter
  on the master they no longer add up to the mix. Pro-L's answer is its external side chain (the master
  triggering a stem's limiter) **[FF]**. Ours could be simpler: the export records the master Pro-L's gain
  curve and applies it to every stem (exactly additive while the style's processing is only gain: not with
  Aggressive's clipper or Dynamic's emphasis, and with oversampling the gain is applied at `fo`, so the stems
  would need the same filters) **[ours, later]**.
- **Offline oversampling**: FabFilter suggests 16x / 32x "when doing offline rendering". The export renders
  with the song's setting; an "export at 32x" option is possible but changes latency between live and export,
  which the export trims anyway **[ours, an open question]**.
- **Reporting**: the export's job could show the render's I, LRA and max true peak, computed by the same
  `Loudness` and `TruePeak` code over the mix it writes **[ours, later]**.

### 8.9 Offline tests, with pass criteria

`server/music/pro-l.integration.test.ts`, the real engine offline (as `pro-q.integration.test.ts`), at
48 kHz and, where marked, 44.1 and 96 kHz. The engine's render is read back (24-bit WAV: its quantisation is
under 0.00001 dB at these levels) and measured **in TypeScript with `shared/music/loudness.ts`**, which shares
no code with the engine. Rows 1–6 and 12–23 are hard requirements; the thresholds in rows 7–11 describe our
styles as designed in §4 and move with them if tuning against the real Pro-L changes the styles. "Hard
material" is synthesised in the test: drum hits clipped after +12 dB, clipped
white noise, a band-limited square, a +3 dBTP quarter-rate tone, a 0 dBFS sweep, and a real mix if one is in
the test media, each pushed with Gain +12 dB.

| # | What | Setup | Pass |
| --- | --- | --- | --- |
| 1 | **Sample ceiling** | Hard material × 8 styles × oversampling {Off, 4x, 32x} × lookahead {0, 0.1 ms, 5 ms} × ceiling {0, −0.1, −1 dB}; TP off | Max \|sample\| ≤ ceiling + 0.0001 dB, every case |
| 2 | **True peak ceiling, BS.1770** | The same with TP on | Max true peak by the Annex 2 filter (its printed coefficients, in the test) ≤ ceiling + 0.001 dB, every case |
| 3 | **True peak ceiling, independent** | TP on, oversampling ≥ 2x | Max true peak by a 16x Kaiser-windowed sinc with 256 taps a phase (in the test, not the engine's detector) ≤ ceiling + 0.02 dB |
| 4 | **True peak, oversampling off** | TP on, Off, material band-limited to 0.45 fs | Independent 16x ≤ ceiling + 0.02 dB (and the window's warning is shown when Off, in e2e) |
| 5 | **Latency exact** | An impulse at −20 dBFS (no reduction), every style × {Off, 2x, 4x, 32x} × TP {off, on}, at 44.1 / 48 / 96 kHz | The song reports the latency; the impulse's peak (Off) or its filters' centre of symmetry (oversampled) is at exactly that sample. With the song's compensation, a dry track and the limited track are in time to the sample (as `latency.integration.test.ts` does) |
| 6 | **Untouched below the threshold** | A −20 dBFS sine sweep, Gain 0, ceiling 0 | Off, TP off: output = input delayed, null ≤ −120 dB. Oversampled: within ±0.01 dB to 20 kHz (the filters' passband) |
| 7 | **The release stage, Jetter's tests** | A 1 kHz tone at −12 dBFS with 1 ms clicks 6 dB over the ceiling every 500 ms; Transparent | Attack 10 s: the tone is back within 0.5 dB of its level < 30 ms after a click whatever the Release (0.01 s or 10 s). Attack 0: the recovery time to within 0.5 dB grows with Release (Release 1 s: between 0.5 and 4 s) |
| 8 | **Program-dependent release** | The same click alone, then a sustained 60 Hz overload of the same depth | The recovery after the sustained overload is at least 3× slower than after the click (style's slow vs fast) |
| 9 | **Distortion by style** | A 60 Hz sine pushed 6 dB into the ceiling, lookahead 0.5 ms, 4x | THD+N order: Safe < Modern ≤ Transparent < Aggressive; Safe's THD < −60 dB; Modern's < −45 dB; Aggressive's > Transparent's by ≥ 6 dB |
| 10 | **Loudness gained by style** | A drum loop, Gain +10 dB, ceiling −1 dBTP | Integrated loudness order: Aggressive ≥ Modern ≥ Safe, and Safe at least 0.5 LU under Aggressive |
| 11 | **Bus glues** | A drum loop 3 dB under the ceiling (no overs) | Bus reduces it (gain reduction ≥ 1 dB on the loudest hits); every other style leaves it untouched (≤ 0.01 dB) |
| 12 | **Linking** | A peak in the left channel only, 6 dB over | Links 0 %: the right channel is unchanged (≤ 0.01 dB). 100 %: both channels reduced by the same amount (within 0.01 dB). 50 %: the right reduced by half the left's reduction in dB (± 0.5 dB) |
| 13 | **Unity Gain** | Gain +6 dB; a tone 10 dB under the ceiling (not limited), then a drum loop limited by about 3 dB | The tone comes out at the input's level within 0.01 dB; the loop's integrated loudness within 1 LU of the input's (heavy limiting makes it quieter: Mix noticed); the meters (in `render`'s answer) read the levels as if Unity were off |
| 14 | **Audition** | Hard material | Audition output + normal output (rendered separately) = the delayed input after Gain, within −90 dB (Off) / −60 dB (oversampled) |
| 15 | **DC filter** | A tone with +0.1 DC | Output mean < 0.0005 after 1 s; a 50 Hz tone's level within 0.05 dB |
| 16 | **Dither** | Silence-to-tone fades, 16 bits, each shaping | Every output sample × 32768 is an integer (± 1e-6); flat TPDF's noise is 2 LSB p-p triangular (variance ½ LSB² ± 5 %); Basic, Optimized, Weighted: noise in 1–4 kHz at least 3, 6, 6 dB under flat TPDF, and their spectra rise above 6, 10 and ~12 kHz respectively |
| 17 | **EBU Tech 3341** | Signals 1–6 and 9–14, synthesised in the test (5.0's test 6 is skipped: stereo only), Gain 0, ceiling 0 dB (nothing limited) | M, S, I (and Max M / Max S for 10–14) within ±0.1 LU, read from `render`'s answer at the end of each, at 44.1 and 48 kHz |
| 18 | **True peak meter** | Tech 3341's 15–23, measured on the input meter (some are over the ceiling) | Within +0.2 / −0.4 dB (ours expected within ±0.05) |
| 19 | **EBU Tech 3342** | LRA signals 1–4 | Within ±1 LU (ours expected ±0.1) |
| 20 | **Meter reset, pause, auto-reset** | A tone, reset, another tone; pause in between | I reflects only what was measured while running |
| 21 | **Block size and threads** | Hard material rendered with blocks of 64, 512, and through the export (2048, parallel and single-threaded) | Identical samples |
| 22 | **Edits don't click** | Gain automated 0 → 12 dB over a beat; a song re-sent mid-play with Attack changed | No sample-to-sample step over 0.05 in the output's high-passed difference; the meters' integrated reading survives the edit |
| 23 | **Speed** | 32x, TP, Modern, a minute of stereo | Renders at least 10× real time on the test machine |

Pure tests (vitest): `normalizeProL` (repairs any input, keeps a valid one identical), presets and Lock
Output, A/B, `engineProL` (every style's table resolved; latencies by formula), `loudness.ts` against Tech 3341
/ 3342 (the same signals, as a check of the checker), the meter geometry (scales, linear tops, colours, the
connecting curves), peak labels (local maxima, spacing, depth), the tools' edits. **e2e** (`music.spec.ts`):
add Pro-L from an effect slot's picker, open its window, drag Gain, see the meters move (the fake engine's
readings), switch style and A/B, undo, Create automation clip on Gain, and the TP-without-oversampling note.

### 8.10 What's reused

- **Pro-Q**: the window's structure and look, its knob and top bar (to share in `src/suites/music/fabfilter/`),
  `eq::Registry`'s pattern, `Convolver::offer`'s hand-over (for the core), `mixDry`, the `eqWatch` idea, the
  integration test's harness.
- **Auto-Tune**: `pitch-history.ts`'s way of keeping fast readings outside React for a scrolling canvas;
  reporting latency to `Song::compensate`.
- **The engine**: `ScopedNoDenormals`, the lanes, `Workers` (nothing to do: per-track state is already safe),
  `DelayLine`'s ring for the dry path, `Resampling.h`'s Kaiser maths for the detector's sinc table.
- **New and reusable**: `Oversampler`, `TruePeak`, `Loudness`, `Lookahead`: the export can report loudness and
  true peak with the last two, and future effects with saturation can oversample with the first.

---

## 9. Open questions for Théo

1. **The default**: Pro-L's presets ship at a 0.0 dB ceiling, True Peak Limiting not stated; we'd start at
   **−1.0 dBTP, TP on, 4x** (streaming-safe; 21.5 ms of latency with Modern at 48 kHz, 11.5 ms with
   Transparent). Or match FabFilter (0.0 dB) and let the user choose?
2. **A limiter on new songs' master?** FL Studio's default template has one. Should a new song start with a
   Pro-L on the master (bypassed, or on at Gain 0)?
3. **The export's safety net**: when the master ends with a Pro-L, should `preventClipping` stand down unless
   the render goes over 0 dBFS (so a 0.0 dB ceiling isn't turned down 0.3 dB)? Should it also look at true
   peaks?
4. **Stems through the master's limiter** (each stem multiplied by the master Pro-L's gain curve, so stems add
   up to the limited mix)? Worth it, and on by default when stems are exported with a master Pro-L?
5. **Latency vs Lookahead**: we reserve the whole 5 ms so the knob never moves the song's delay (Pro-L seems to
   do the same). Should there be a **low-latency** choice (the delay follows the knob, for tracking through a
   vocal chain), at the price of the song re-compensating when it's turned?
6. **Tuning the styles**: they're reconstructions. Do you have Pro-L 2 here? With it we'd measure each style
   (step responses, a click, a 60 Hz overload, THD, latency) and tune ours to match, as EchoBoy's doc proposes.
7. **Its look**: FabFilter's dark look in every theme, as Pro-Q (proposed), or the app's surfaces?
8. **Per-platform targets** (Spotify Loud/Normal/Quiet, Apple Music, YouTube, Tidal…) beyond Pro-L's four?
   Their numbers change over time and only Spotify's is published where we could read it.
9. **Unity Gain and Audition**: in the song (Pro-L's way: saved, undone) or the tab's (temporary listening
   aids, like Pro-Q's band solo, never saved)?
10. **"Gain to target"** (an offline analysis and one click to reach −14 LUFS integrated at the ceiling): wanted
    in the first version, for you and the assistant, or later?
11. **Compact view**: needed, or is a freely resizable window enough?

---

## Sources

FabFilter:

- FabFilter Pro-L 2 manual (PDF, 49 pages): <https://www.fabfilter.com/downloads/pdf/help/ffprol2-manual.pdf>
- Online help, the same text with the screenshots: <https://www.fabfilter.com/help/pro-l>; pages used:
  [overview](https://www.fabfilter.com/help/pro-l/using/overview),
  [knobs](https://www.fabfilter.com/help/pro-l/using/knobs),
  [advanced settings](https://www.fabfilter.com/help/pro-l/using/advancedsettings),
  [true peak limiting](https://www.fabfilter.com/help/pro-l/using/truepeaklimiting),
  [metering](https://www.fabfilter.com/help/pro-l/using/metering),
  [loudness metering](https://www.fabfilter.com/help/pro-l/using/loudnessmetering),
  [oversampling](https://www.fabfilter.com/help/pro-l/using/oversampling),
  [dithering](https://www.fabfilter.com/help/pro-l/using/dithering),
  [output options](https://www.fabfilter.com/help/pro-l/using/outputoptions),
  [surround](https://www.fabfilter.com/help/pro-l/using/surround),
  [full screen and resizing](https://www.fabfilter.com/help/pro-l/using/fullscreenandresize),
  [MIDI Learn](https://www.fabfilter.com/help/pro-l/using/midilearn),
  [undo, redo, A/B](https://www.fabfilter.com/help/pro-l/using/undoredo),
  [loading presets](https://www.fabfilter.com/help/pro-l/presets/loadingpresets)
- The screenshots in `img/pro-l-*`: <https://www.fabfilter.com/help_pages/pro-l/images/> (`overview@2x.jpg`,
  `advancedpanel@2x.jpg`, `loudness@2x.jpg`, `metering@2x.jpg`, `compact@2x.jpg`, `fabfilterprol2@2x.jpg`,
  `output@2x.jpg`, `oversampling@2x.jpg`, `dithering@2x.jpg`, `displaymode@2x.jpg`, `meterscale@2x.jpg`,
  `truepeaks@2x.gif`, `truepeaklimiting@2x.jpg`, `truepeakmetering@2x.jpg`, `gainslider@2x.jpg`,
  `knobs@2x.jpg`, `undoredo@2x.jpg`, `resize@2x.jpg`, `midilearn@2x.jpg`, `surroundchannellinking@2x.jpg`,
  `surroundmeters@2x.jpg`)
- FabFilter Pro-L (version 1) manual: <https://www.fabfilter.com/help/ffprol-manual.pdf>
- Product page: <https://www.fabfilter.com/products/pro-l-2-limiter-plug-in>
- Downloads (version 2.26, 16 April 2026): <https://www.fabfilter.com/download>
- Press: "FabFilter announces Pro-L limiter plug-in" (21 Oct 2010):
  <https://www.fabfilter.com/press/1287648000/fabfilter-announces-pro-l-limiter-plug-in>; "FabFilter releases
  FabFilter Pro-L 2 true peak limiter plug-in" (5 Dec 2017):
  <https://www.fabfilter.com/press/1512462600/fabfilter-releases-fabfilter-pro-l-2-true-peak-limiter-plug-in>;
  the press list: <https://www.fabfilter.com/press>
- News: <https://www.fabfilter.com/news>; "All plug-ins updated, Dolby Atmos support for Pro-Q 3 and Pro-L 2":
  <https://www.fabfilter.com/news/1639393200/all-plug-ins-updated-dolby-atmos-support-for-pro-q-3-and-pro-l-2>
- Forum, "Pro-L2 latency" (2018–2024, answers by Floris, Frederik and Ralph of FabFilter):
  <https://www.fabfilter.com/forum/topic/3116/pro-l2-latency>
- Forum, "Pro L2 'Style' question" (2018, answer by Floris of FabFilter):
  <https://www.fabfilter.com/forum/topic/3152/pro-l2-style-question>
- Forum, "Pro-L3 idea" (a user's thread; seen in search results, not read):
  <https://www.fabfilter.com/forum/topic/7925/pro-l3-idea>

Reviews and engineers:

- Eric James, "FabFilter Pro-L 2", Sound On Sound, April 2019: <https://www.soundonsound.com/reviews/fabfilter-pro-l-2>
- Michael Cooper, "Review: FabFilter Pro-L 2", Mix, 7 September 2018: <https://www.mixonline.com/technology/review-fabfilter-pro-l-2>
- Computer Music, "FabFilter Pro-L 2 review", MusicRadar, 13 May 2018: <https://www.musicradar.com/reviews/fabfilter-pro-l-2>
- Luke Goddard, "FabFilter Pro-L 2 for music mastering in 2026: which style and why it matters", Production
  Expert, 2026: <https://www.production-expert.com/production-expert-1/fabfilter-pro-l-2-for-music-mastering-in-2026-which-style-and-why-it-matters>
- Jonathan Jetter, "Understanding Time Constants in FabFilter Pro-L 2": <https://www.jonathanjetter.com/blog/fabfilter-prol2-timeconstants>
- "FabFilter Pro-L 2 Review & Guide", Sound Under Control, 4 June 2025: <https://soundundercontrol.com/2025/06/04/fabfilter-pro-l-2-review/>
- KVR product page: <https://www.kvraudio.com/product/pro-l-2-by-fabfilter>

Standards and delivery:

- ITU-R BS.1770-5 (11/2023), "Algorithms to measure audio programme loudness and true-peak audio level":
  <https://www.itu.int/dms_pubrec/itu-r/rec/bs/R-REC-BS.1770-5-202311-I!!PDF-E.pdf>
- EBU R 128 (2023), "Loudness normalisation and permitted maximum level of audio signals": <https://tech.ebu.ch/docs/r/r128.pdf>
- EBU Tech 3341 (v4, 2023), "Loudness Metering: 'EBU Mode' metering to supplement EBU R 128 loudness
  normalization": <https://tech.ebu.ch/docs/tech/tech3341.pdf>; its test signals: <https://tech.ebu.ch/loudness>
- EBU Tech 3342 (v4, 2023), "Loudness Range: a measure to supplement EBU R 128 loudness normalization":
  <https://tech.ebu.ch/docs/tech/tech3342.pdf>
- Spotify for Artists, "Loudness normalization": <https://support.spotify.com/us/artists/article/loudness-normalization/>
- Apple, "Apple Digital Masters" (the 1 dB headroom advice, `afclip`):
  <https://www.apple.com/apple-music/apple-digital-masters/docs/apple-digital-masters.pdf>

DSP:

- Geraint Luff (Signalsmith Audio), "Designing a straightforward limiter", 2022:
  <https://signalsmith-audio.co.uk/writing/2022/limiter/>
- Daniel Lemire, "Streaming Maximum-Minimum Filter Using No More than Three Comparisons per Element", 2006:
  <https://arxiv.org/abs/cs/0610046>
- Dimitrios Giannoulis, Michael Massberg, Joshua D. Reiss, "Digital Dynamic Range Compressor Design: A Tutorial
  and Analysis", JAES 60(6), 2012 (the smooth branching peak detector, the soft knee; not re-read for this
  document): <https://www.eecs.qmul.ac.uk/~josh/documents/2012/GiannoulisMassbergReiss-dynamicrangecompression-JAES2012.pdf>
- Julian D. Parker, Vadim Zavalishin, Efflam Le Bivic, "Reducing the Aliasing of Nonlinear Waveshaping Using
  Continuous-Time Convolution", DAFx-16: <https://www.dafx.de/paper-archive/2016/dafxpapers/20-DAFx-16_paper_41-PN.pdf>
- Julius O. Smith III, "DC Blocker", Introduction to Digital Filters (CCRMA): <https://ccrma.stanford.edu/~jos/filters/DC_Blocker.html>
- JUCE, `dsp::Oversampling`: <https://docs.juce.com/master/classdsp_1_1Oversampling.html>
- libebur128 (the K-weighting at any rate, the histogram mode): <https://github.com/jiixyj/libebur128> (`ebur128/ebur128.c`)
- SoX, the noise-shaping filters (Lipshitz, F-weighted, improved E-weighted, Gesemann, Shibata):
  <https://github.com/chirlu/sox/blob/master/src/dither.c> (a mirror of SoX's source); after S. P. Lipshitz,
  J. Vanderkooy, R. A. Wannamaker, "Minimally Audible Noise Shaping", JAES 39(11), 1991, and R. A. Wannamaker,
  "Psychoacoustically Optimal Noise Shaping", JAES 40(7/8), 1992 (not read here; cited through SoX)

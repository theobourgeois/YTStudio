# Plugin settings extraction: prefer live capture over binary decoding

Status: planning/research only, 2026-10-03. No extractor implemented.

## Finding

Readable compressor settings are a feasible target for exposed controls. A bespoke decoder for every saved plugin format is not the preferred starting architecture. Capture settings while the original session is open in its compatible DAW/plugin environment, then include a readable manifest in the engineer's contribution package.

Separate three problems: extracting session structure, reading a loaded plugin's exposed controls, and decoding private saved state. A documented route for one does not automatically solve the others.

## Verified access routes

### FL Studio

The Plugins module documents `getParamCount`, `getParamName`, and `getParamValue` for channel-rack and mixer-slot plugins. Values are normalized. It also documents `getParamValueString`, with an explicit limitation that only some plugins support it. This establishes a concrete live parameter capture path, subject to the actual installed versions and plugins. [Image-Line scripting API](https://www.image-line.com/fl-studio-learning-content/fl-studio-online-manual/html/midi_scripting.htm)

Prototype a read-only companion within the supported MIDI-scripting environment; verify invocation and file export rather than assuming arbitrary standalone Python can connect to FL. On a copied/open session, inventory instances and retrieve exposed controls without modifying them. Preserve both normalized values and display strings. A number such as 0.37 cannot be labeled as milliseconds or decibels without a verified mapping.

### VST3 and a compatible host

VST3's controller API exposes parameter enumeration, metadata, normalized values, display-string conversion, and normalized-to-plain conversion. A compatible installed plugin can interpret its own exposed parameter values, avoiding reverse engineering that conversion for every plugin. [Steinberg controller API](https://steinbergmedia.github.io/vst3_doc/vstinterfaces/classSteinberg_1_1Vst_1_1IEditController.html)

This requires a correctly restored instance. An arbitrary chunk inside FLP/PTX is not automatically a directly loadable VST3 state, and AAX/AU/VST state compatibility cannot be assumed. Extract host wrappers only through verified adapters. Source-machine capture avoids needing every commercial plugin installed on the ingestion server.

### REAPER

ReaScript exposes plugin parameter counts, names, values, and formatted-value access. It is another candidate for a generic live capture adapter, not a reason to migrate or recreate the friend's original sessions. [REAPER API](https://www.reaper.fm/sdk/reascript/reascripthelp.html)

### Pro Tools

Avid offers its Scripting SDK, but the public material reviewed here does not establish generic readable access to every insert's parameters. Treat that requirement as unverified until the target SDK/version is inspected and tested. [Avid SDK](https://developer.avid.com/scripting/)

Investigate supported capture/export commands and vendor presets first. For unavailable controls, consider plugin-specific preset decoding or reviewed screenshots/manual values. Screenshot extraction is lower-confidence and cannot cover hidden pages or time-varying settings on its own. Do not claim VST3 controller APIs can directly query an AAX instance in Pro Tools.

## Existing app foundation

`engine/src/Host.cpp` already restores saved instance state and enumerates parameter IDs, names, normalized values, and current display text. Its `PluginHost::parameters` currently filters out non-automatable parameters, so it is not a complete capture implementation. `server/music/engine.ts` exposes that enumeration to the app.

This is useful groundwork for plugins hosted by YTStudio, not evidence that imported FL/Pro Tools session states are already readable. Ingestion needs correct source instance/state restoration or an exported manifest from the original DAW.

## Recommended capture and fallback order

1. **Original-DAW live capture:** export readable values plus instance/slot identity, chain order, routing context, time position, and automation status while the engineer's session is loaded.
2. **Preserve native state and presets:** retain source settings for future decoding/reproduction; readability is tracked independently.
3. **Compatible plugin-assisted reading:** where a verified preset/state can be restored safely into the same plugin/format, ask that instance for exposed values.
4. **Targeted adapters:** map names/units or decode documented/verified preset formats for the friend's actual high-value compressors/EQs. Pin product/version and test against live settings.
5. **Reviewed visual/manual evidence:** supplement remaining gaps, clearly labeling the method and scope.

Some per-plugin mappings will still be useful: identifying equivalent controls, enum meanings, missing display conversions, and behavior differences. These are smaller, more focused tasks than building a universal private-state decoder.

## Compressor pilot

Request the friend's DAW/version and actual compressor product/version/format list. Start with a few real vocal chains. Capture threshold, ratio, attack/release, knee, makeup/output gain, wet/dry, auto modes, style/detector, sidechain filters, bypass, and ordering where exposed. Also capture input/track levels and routing; settings without level/context do not explain compression behavior.

Choose a documented song time, record parameter values and any automation affecting them, and compare every captured control with the source GUI. A static snapshot is not the whole song's automation. Missing controls stay explicit. Use independently validated unit conversions, especially when controls are logarithmic or mode-dependent.

The contribution package becomes: native session/media + stems/mix + readable settings manifest + native state/presets + coverage report. It can be generated on the engineer's machine and ingested without the hosted hearing service possessing the DAW or commercial plugins.

# Windows music suite compatibility

Status: planned; implementation has not started.
Created: 2026-10-04.

Goal: run the music suite as a native Windows desktop app, in development and as a packaged application, with working playback, recording, MIDI, VST3 plugins, project files and exports. Keep macOS support working.

Use [progress.md](progress.md) to track implementation and evidence. Use [local-development.md](local-development.md) for setup. Update both as commands and capabilities become verified.

## 1. Establish the Windows baseline

- Inventory Node, pnpm, FFmpeg/FFprobe, Git, CMake and the C++ compiler; record versions and missing prerequisites.
- Install repository dependencies and run type checking. Separate pre-existing failures from Windows-specific failures.
- Inspect Windows-sensitive process launches, paths, native integrations and tests across the shared desktop/server code used by music.
- Use disposable data and projects for verification; preserve the user's songs and installed plugins.

Exit: reproducible setup instructions and a recorded baseline.

## 2. Make local development work

- Fix development process launches on Windows, including pnpm command shims, Electron's executable and clean shutdown/restart.
- Make engine discovery platform-aware in development and packaged builds.
- Correct shell-specific production startup commands and any startup imports that prevent the music suite from opening.
- Verify browser development and Electron development with hot reload on this Windows machine.

Exit: one documented command starts the desktop development app; stopping it leaves no child processes.

## 3. Build and verify the native audio engine

- Configure and build JUCE and the test VST3 plugins with an available Windows C++ toolchain. Address actual compiler failures.
- Verify JSON protocol communication over stdin/stdout, plugin scanning and graceful engine restart.
- Verify sampler playback, built-in effects, transport, automation and offline rendering with the test plugins.
- Verify Windows audio output/input selection, sample rates, buffers, recording and MIDI devices. Assess low-latency driver support, including whether ASIO needs additional build configuration or SDK setup; do not claim it works before testing.

Exit: live playback and an offline render work; recording and MIDI have evidence or explicitly recorded hardware limitations.

## 4. Complete desktop behavior and file workflows

- Verify plugin editor focus, stacking, minimize/restore, app switching and closing alongside floating music panels.
- Verify Ctrl/Alt shortcuts, menu labels, Windows window controls and multi-monitor display scaling.
- Verify project create/open/save/reopen, sample import/browser folders, drag-and-drop, presets, plugin state, autosave and crash recovery.
- Exercise paths with spaces, Unicode, drive letters and Windows separators.
- Treat `.vaudio` projects as directories on Windows; verify folder dialogs and document opening rather than assuming Finder package behavior transfers.
- Verify FFmpeg exports and stems, and music assistant process launch/tool actions on Windows.
- Add Windows Serum preset database discovery if the existing automatic preset classification needs it.

Exit: core song creation, arrangement, mixing, save/reopen and export workflows pass.

## 5. Package and validate the desktop app

- Bundle the Windows engine executable and required runtime assets; fail clearly if the required engine is missing.
- Build an unpacked Windows app, then an installer. Verify installed paths, app data, launch and uninstall behavior.
- Verify dependency discovery or bundling for FFmpeg/FFprobe; document what the user must install.
- Add Windows-compatible desktop/audio smoke coverage and retain macOS coverage. Keep OS-specific window tests explicitly scoped.
- Run required repository checks: type checking, unit/server tests and the music e2e file for UI changes, plus relevant engine and desktop smoke checks.
- Test with the user's Windows VST3 plugins where available, including editor windows and saved state. Mac Audio Units are unsupported on Windows; cross-platform project/plugin remapping is a separate decision if needed.

Exit: a packaged Windows desktop app completes the core workflow outside the source checkout, with remaining limitations documented.

## Completion rules

Mark a task complete only after its acceptance check passes. Record the command/result or manual steps in the progress log. Hardware-dependent checks remain pending until tested; a successful build alone does not prove full compatibility. Avoid expanding this work into a complete Windows port of unrelated video/photo features.

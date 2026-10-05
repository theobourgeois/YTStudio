# Progress

Overall: implementation in progress on Windows.

| Phase | Status | Acceptance evidence |
| --- | --- | --- |
| 1. Windows baseline | Complete | Dependencies installed; typecheck passes; initial full tests: 2,206 passed, 13 failed, 305 skipped |
| 2. Local development | Complete | `pnpm dev` and `pnpm dev:desktop` start; ordinary `pnpm engine:build` loads MSVC automatically and succeeds; typecheck passes |
| 3. Native engine/audio | In progress | Windows engine/test VST3s compile; 59 initial native tests pass; SSL output and MPKmini2/SSL MIDI open; packaged sampler playback works. ASIO and physical recording still pending |
| 4. Desktop/file workflows | In progress | Packaged create/save/reopen and sample paths pass; Windows folder dialog, assistant discovery and Serum prefs discovery added. Real external plugin focus/state and hardware gestures pending |
| 5. Packaging/validation | In progress | Windows unpacked app and NSIS installer built; packaged music smoke passes; final full music e2e run in progress |

## Confirmed findings — 2026-10-04

- React/Electron frontend and JUCE engine provide a portable foundation.
- VST3 hosting is enabled; Audio Unit hosting is restricted to macOS in CMake.
- The engine protocol already has Windows file-descriptor handling.
- `server/config.ts`, `electron/main.ts` and `scripts/desktop.ts` hardcode Mac engine bundle paths.
- Development launchers spawn `pnpm` directly; desktop development also uses the extensionless Electron shim. Windows launch behavior needs correction/verification.
- Windows installer targets already exist in the desktop build configuration; engine resources remain Mac-specific.
- `.vaudio` projects are directories, with Finder package metadata only on Mac.
- Serum preset database automatic discovery currently only covers macOS.
- In this session, Node is on PATH. pnpm, FFmpeg, CMake and Ninja were not found by `Get-Command`; this does not rule out installations outside PATH. `node_modules` is absent. A C++ toolchain has not been exhaustively searched.

## Implementation log

Append dated entries with changes, checks, failures and next steps. Use Pending / In progress / Blocked / Complete in the table; describe blockers precisely.

### 2026-10-04 — implementation started

- Plan committed and pushed to main as `e97ce6a` after rebasing over remote updates.
- Installed pnpm 10.34.6 and repository dependencies. pnpm 12 was incompatible with the repository's existing build approval settings; switched to 10.
- Installed FFmpeg/FFprobe 9.0.2, portable CMake 4.4.3 and Ninja 1.13.1 under `%LOCALAPPDATA%/Vaudio/tools`; added their executable directories to the user PATH. The initial winget installer processes stalled at elevation and were stopped. Existing Visual Studio 2022 MSVC 19.44 and Windows SDK 10.0.26100.0 are usable through Developer PowerShell.
- Downloaded Electron and Playwright Chromium for desktop/e2e verification.
- Shared engine path resolution now selects Windows `.exe`, macOS bundle and Linux binary paths; desktop packaging uses the corresponding artifact name.
- Development invokes pnpm through Node and Electron through its real executable. Windows shutdown uses taskkill for subprocess trees. Non-Mac desktop apps quit when all windows close.
- Production startup no longer uses Unix environment assignment syntax. E2e setup no longer uses `rm -rf`.
- JavaScript process stand-ins use Node explicitly; corrected Windows test assumptions for paths, Unix mode bits and directory symlinks.
- Initial full tests expose two pre-existing architecture crossings: `server/music/mixer-setup.ts -> server/transcription/settings.ts` and `src/suites/music/mixer/fill-inserts.tsx -> src/components/media/use-grid-selection.tsx`. Keep these distinguishable from new Windows failures.
- Remaining: finish native build, validate engine protocol/audio/plugins, rerun checks with FFmpeg, verify desktop packaging and document tested startup commands.

### 2026-10-04 — working Windows desktop milestone

- Built engine and both test VST3s with MSVC/Ninja. `pnpm engine:build` now configures the Windows compiler environment itself.
- Real device smoke: SSL 2+ Output 1/2 opens at 48 kHz, 256 samples, zero initial dropouts; MPKmini2 and SSL 2+ MIDI ports open. Current default Windows backend is JUCE's WASAPI; ASIO is not enabled in this build.
- Initial native validation: 59 tests passed across engine hosting/state, sequencer, recording logic, MIDI and export. Full suite with native engine present: 2,479 passed, 43 skipped, three failed tests plus video setup/teardown timeouts. The two performance tests pass when rerun without concurrent builds; architecture crossings remain pre-existing. Video integration and web-media checks pass separately (62 tests).
- Packaged desktop smoke passes: FFmpeg discovery, export, project launch/reopen, music channel rack, actual sampler output (nonzero peak), sample paths persisted, app shutdown.
- Native panel windows are intentionally disabled in the existing app (`NATIVE_WINDOWS = false`); current music panels render inside the desktop page. The old macOS native-window probe is not the acceptance test for this mode.
- Windows project picker selects directories explicitly. Assistant discovery supports this machine's npm-installed native Claude and Codex JS entry point; Serum classification reads its Windows preferences, including a custom preset folder.
- Reuse installed Electron during packaging to avoid repeated executable archive renames, which produced intermittent Windows EPERM locks.
- Generated build/binary/data folders are excluded from Vite watching: packaging otherwise caused an EBUSY watcher crash during e2e. Full music e2e is being rerun after this fix.
- Installer artifact: `release/Vaudio Setup 0.1.0.exe`; unpacked app: `release/win-unpacked/Vaudio.exe` (generated, gitignored).

### 2026-10-04 — music e2e green on Windows

- `pnpm typecheck` passes. `pnpm test`: 2525 passed, 1 failed (the two pre-existing architecture crossings listed above).
- `pnpm test:e2e music`: 63 passed (10.7 min). Two Windows bugs found and fixed first: the Browser (and the assistant's `preview_sample`/`list_samples`) assumed `/` in paths, so starred files showed full paths (`nameOf`, `foldersToReveal` in `src/suites/music/browser/tree.ts`, with tests); and the assistant sample e2e built mixed-separator paths and raced the stand-in engine's 2 s preview.
- Seen during the run, retried successfully by autosave: an atomic-write rename of `project.json` failing with a server 500 (Windows file locking). Worth a look at `server/storage.ts` if it appears in real use.
- Still pending: ASIO, physical recording, real external plugin focus/state.

# Serum presets on Windows: dropping files on a plugin's window

The Serum player can't load any preset on Windows. Picking one says "Dropping files on a plugin's window is macOS's
only." This plan makes Windows do what macOS does, the same way and as completely. Both kinds of preset should load:
Serum 2's `.SerumPreset` and Serum 1's `.fxp`, which Serum 2 converts itself.

It's written for a session on the Windows PC. Only that machine can build the engine with MSVC and run the result
against the real Serum 2. Log progress in `progress.md` beside this file, as the rest of the Windows port does.

## What "done" means

- `dropFiles` in `engine/src/MacWindow.cpp` has a Windows version with the same contract as the macOS one. It takes
  the files, a point (x, y) as fractions of the plugin's view, and `perform`. It answers with what the plugin said at
  each stage, or with an error string saying why the files weren't taken. Nothing in the engine or the server says
  "macOS only" any more.
- On Windows, loading a preset from the Serum player works for both `.SerumPreset` and `.fxp`, with the same results
  as on a Mac:
  - the preset's name and macro names come through;
  - it's one undo step;
  - there's no click while a note sounds (the swap's fade);
  - nothing flashes on screen;
  - the focus doesn't move;
  - Serum's own window can be open or closed.
- `serum-player.integration.test.ts` runs on Windows, and passes, when Serum 2's VST3 is installed. A new test there
  loads a real Serum 1 `.fxp`, on both platforms.
- `plugin-swap.integration.test.ts` passes on Windows with the Windows wording.
- The docs describe both platforms (see "Docs" below).
- macOS is unchanged. The Mac session reruns its integration tests after the merge.

Not in scope: loading `.SerumPreset` through the player's state path (`presetAsState`) as a Windows shortcut. We
decided against that quick fix. The drop is Serum's own way to load presets, and it's how both kinds load on macOS.

## How macOS does it (read this code first)

- **The server.** `SerumPlayer.load` (`server/music/serum/player.ts`) sends every preset through
  `engine.dropFiles(channel, [file])` (`server/music/engine.ts`). Then it reads the channel's saved state for the macro
  names and the effect links.
- **The engine's command.** `dropFiles` with a `channel` (`engine/src/Engine.cpp`) runs as a *swap*
  (`PluginHost::swap`): the audio thread fades the channel out and stops processing it, the message thread does the
  drop, and then the channel fades back in. `dropFiles` with a `slot` is the plugin bench's version (`PluginBench::dropFiles`,
  `engine/src/Plugins.cpp`). It takes `x`, `y` and `perform`, which makes it the one to use for experiments.
- **The window.** `PluginHost::dropFiles` (`engine/src/Host.cpp`) uses the plugin's open window if there is one, with
  its alpha set to 0 during the drop. Otherwise it makes a hidden `EditorWindow` (`hidden = true`: alpha 0, no
  clicks, `ignoreMouse`, kept out of the window switchers), keeps it for a few seconds for the next drop, then lets it go.
- **The drop itself.** `dropFiles` in `MacWindow.cpp`, macOS branch:
  1. Find the plugin's own view: the deepest view that isn't JUCE's or AppKit's and takes drops.
  2. Work out the point from (x, y).
  3. **Move the invisible window so that point sits under the real mouse pointer.** Serum decides where a drop lands
     from where the pointer really is, not from the point it's given. With the window anywhere else, nothing takes
     the file.
  4. Fill a pasteboard with the file, as Finder would.
  5. Call `draggingEntered:`, `draggingUpdated:`, then `prepareForDragOperation:`, `performDragOperation:` and
     `concludeDragOperation:` (or `draggingExited:` without `perform`).
  6. Put the window back where it was. Report what each call answered, or an error.
- **Background.** `docs/serum/player.md` §2.3 tells the story: the probes, the pointer finding, and what was checked.

## The Windows design

The same steps, done Windows's way. Treat each part as a hypothesis until step 0 has confirmed it on the real Serum.

### 1. Find the plugin's drop target

OLE drag and drop: a window that takes drops registers an `IDropTarget` with `RegisterDragDrop`. OLE keeps the
in-process pointer as a window property named `"OleDropTargetInterface"`, and Serum runs inside the engine's process.
So:

- Walk the editor window's child windows (`EnumChildWindows` on `nativeWindowOf(window)`), deepest first.
- Take the first one whose `GetPropW(hwnd, L"OleDropTargetInterface")` is set and that **isn't the engine's own**.
  The `EditorWindow`'s own top-level HWND is a JUCE peer of the *engine's*, so it has JUCE's drop target, which
  isn't the plugin's. This is the Windows version of the Mac's "isn't JUCE's or AppKit's". Serum 2 is a JUCE plugin,
  so its own peer will be a child HWND with its own JUCE drop target. Tell the two apart by window, not by class name.
- `AddRef` the target while it's in use.
- If no window has a target, say so the way macOS does: "No window in the plugin's view takes drops (windows: …)",
  listing the window classes seen (`GetClassNameW`).
- If a plugin only uses the old `DragAcceptFiles` (`WS_EX_ACCEPTFILES`, `WM_DROPFILES`), add that as a second route
  only if a real plugin needs it. Serum won't.

### 2. Make Explorer's data object

Give the plugin exactly what Explorer gives it, rather than a hand-built `CF_HDROP`:

1. For each file, `SHParseDisplayName` gives its ID list (PIDL).
2. `SHCreateShellItemArrayFromIDLists` turns them into a shell item array.
3. `IShellItemArray::BindToHandler(nullptr, BHID_DataObject, IID_PPV_ARGS(&data))` gives the data object.

That data object carries `CF_HDROP`, `Shell IDList Array`, `FileNameW` and the rest. Free the PIDLs (`ILFree`) and
release everything. Keep a hand-built `CF_HDROP` (`DROPFILES` in an `HGLOBAL`) as a fallback only if the shell's
object fails.

### 3. Drop

The same sequence a real drag makes:

1. `DragEnter(data, MK_LBUTTON, pt, &effect)`, with `effect = DROPEFFECT_COPY | DROPEFFECT_MOVE | DROPEFFECT_LINK`.
2. `DragOver(MK_LBUTTON, pt, &effect)`.
3. Then `Drop(data, MK_LBUTTON, pt, &effect)` with `perform`, or `DragLeave()` without it.

- `pt` is in screen coordinates: (x, y) in the plugin window's client area, through `ClientToScreen`, in physical
  pixels. Mind the engine's DPI awareness.
- Report it as macOS does:
  - `view`: the window's class;
  - `width` and `height`;
  - `entered` and `updated`: the effects;
  - `performed`: the `Drop` returned `S_OK` with an effect other than `DROPEFFECT_NONE`.
- An `effect` of `DROPEFFECT_NONE` after `DragOver` means the plugin doesn't want the files: `DragLeave`, then
  "The plugin's window didn't take the files." The test synth will answer this way, because its JUCE view takes no
  files.

### 4. The pointer, and keeping it invisible

- **Find out first** (step 0) whether Serum on Windows uses `pt` or the real cursor. JUCE's Windows drop target
  works from `pt`, but on macOS something in Serum used the real pointer anyway.
- If the cursor matters, do what macOS does: move the window so the drop point sits under `GetCursorPos`, then move
  it back. Use `SetWindowPos` with `SWP_NOACTIVATE | SWP_NOZORDER | SWP_NOSIZE` so it never takes the focus or comes
  forward.
- The window must stay invisible and let clicks through the whole time. On Windows, `ignoreMouse` does nothing yet.
  Implement it: `WS_EX_LAYERED | WS_EX_TRANSPARENT`, with alpha 0 (JUCE's `setAlpha` already makes it layered).
- Check how this interacts with `cloakWindow`. `EditorWindow` cloaks every new window until the plugin has drawn,
  then its timer uncloaks it. A hidden drop window must never show, even uncloaked. A plugin may also not build or
  register its view while cloaked or never painted. Whatever step 0 shows, the hidden window can stay cloaked for its
  whole life if Serum still takes drops that way. That's the safest choice.
- An open window, where the user can see Serum: its alpha goes to 0 during the drop (`PluginHost::dropFiles`). Check
  that this doesn't flash on Windows. Cloaking it during the drop is the alternative.

### 5. Wait for the plugin to be ready, and to finish

- **Before the drop.** A hidden window that has just been made may not have Serum's view yet. The host already
  allows for "making Serum's window takes a moment" (`dropWindowKeptMs`). If the target isn't registered yet, pump
  messages and look again, with a timeout of about 2 s, before giving up with the "no window takes drops" error.
- **After the drop.** JUCE plugins may finish a drop asynchronously (`MessageManager::callAsync` from `Drop`). If
  Serum does, the swap's action returns before the preset has loaded. The channel would fade back in on the old
  sound and then jump. Check in step 0: read the plugin's state straight after `Drop` returns. If the load comes later,
  have the action wait for it: pump messages until the plugin's program or state changes, with a timeout, before
  returning. The action can't block the message thread's queue without pumping.

### 6. Foreign code, threads, and cleanup

- A plugin's `IDropTarget` is foreign code, and `catch (...)` doesn't catch access violations under MSVC's default
  `/EHsc`. Put the COM calls in a small function with no C++ objects that have destructors, inside
  `__try` / `__except (EXCEPTION_EXECUTE_HANDLER)`. Report a fault as macOS reports an exception: "The plugin's
  window threw an exception when given the files."
- All of this runs on the message thread, which must be a single-threaded apartment with OLE initialised. JUCE does
  `OleInitialize` for its drag and drop; confirm it, and call `OleInitialize` once if it doesn't.
- Always put things back, whatever happens: the window's position, its extended styles and alpha, and every COM
  reference.

## Steps

0. **Probe on the real Serum, before writing the final code.** Put a temporary Windows branch of `dropFiles` behind
   the bench command (`load` Serum 2 into `slot: "instrument"`, then `dropFiles` with `slot`, `x`, `y` and
   `perform`). Read the result back with `saveState` and `readPluginState` / `readXfer` (`server/music/serum/`): the
   preset name is in the controller's `meta.presetName`. Answer these questions and log the answers in `progress.md`:
   - Which HWNDs exist in Serum's editor, and which has the drop target?
   - Is a hidden, cloaked, never-shown window enough?
   - Does `pt` decide where the drop lands, or the real cursor?
   - Does the load finish inside `Drop`?
   - Do `.SerumPreset` and `.fxp` both load, with the right names?
   - How long does it take? macOS takes 20–200 ms.
1. **Write it properly:** `dropFiles` and `ignoreMouse` for Windows in `MacWindow.cpp`, under `JUCE_WINDOWS` as the
   file's other Windows code is, then the comments in `MacWindow.h`. Change `Host.cpp` / `Plugins.cpp` only if step 0
   showed they need to (waiting for the view, waiting after the drop, cloaking).
2. **Tests:**
   - `plugin-swap.integration.test.ts`: the test synth's error message as Windows words it (drop the `macOS's only`
     alternative from the regex).
   - `serum-player.integration.test.ts`:
     - `available` on Windows too, with Serum 2's VST3 at
       `C:\Program Files\Common Files\VST3\Serum2.vst3`;
     - leave the Audio Unit block macOS-only;
     - add a test that loads a real `.fxp`: the first one found in Serum 1's preset folder (`serumFolderSuggestions` in
       `server/music/serum/library.ts`), skipped if there's none. Check that the preset's name is the file's name and
       that the macros 5–8 left over are 0 (`player.md` §2.3). The stand-in `.fxp` isn't a real preset, so it won't do
       here.
3. **Docs:**
   - `docs/serum/player.md` §2.3: replace "macOS only" with how Windows does it and what step 0 found.
   - `docs/claude/music-engine.md`: the `dropFiles` line.
   - The comments in `server/music/engine.ts` (`dropFiles`) and `engine/src/Host.cpp`.
4. **Check it in the app:** `pnpm build:desktop`, then in the installed app, with a song playing:
   - load several `.SerumPreset` and `.fxp` presets from the player, with Serum's window closed and open;
   - check that nothing flashes, the focus stays where it was, nothing clicks, the names are right, and undo and redo
     work;
   - check that a drop window left over after its few seconds doesn't stay in the taskbar or Alt+Tab.

Verify with `pnpm engine:build`, `pnpm typecheck` and `pnpm test` (the two integration files above must actually run,
not be skipped). Commit each step on its own branch and merge through a PR, as usual.

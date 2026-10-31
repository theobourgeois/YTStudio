# YT-Mix and YT-Fill

Two plugins for FL Studio, each its own entry in FL's plugin list. Their sound passes through untouched. They live
beside YTStudio rather than in it: nothing here is imported by the app, and the app imports nothing from here.

- **YT-Mix** balances the project's mixer by itself. It listens to the split mixer stems, works out what each insert is
  (lead vocal, backing vocals, 808, kick, snare, synths, hats, perc, FX), and moves the faders to the balance that won
  the blind tests. Your FL project is never touched except for those faders, and Undo puts them back.
- **YT-Fill** does YT Studio's Fill inserts: every sound on an insert of its own, named after the sound, in the colour of
  a group, routed to that group's bus.

Each is built the same way:

- **The plugin** (`plugin/`, a VST3) is the window, inside FL. It starts its worker and shows what it says.
- **The worker** (`worker.py` for YT-Mix, `fill_worker.py` for YT-Fill: a hidden Python the plugin starts) does the
  listening and the deciding.
- **The FL script** (`fl/device_ytstudio_automix.py`, one for both) runs inside FL Studio as a controller script. It
  tells a worker what the mixer and channels look like and makes the changes it's asked to.

`app.py` is YT-Mix as a window of its own, outside FL (the desktop shortcut, or `Auto Mix.cmd`).

## Using YT-Mix

Put **YT-Mix** on the **Master** insert (Mixer › Master › an empty slot), open it, and press **Auto Mix**.
That's it: about a minute for a 3-minute song. The roles you correct are saved with the project (in the plugin's
state), and come back for the inserts still there under the same name.

- FL renders the song's split mixer stems by itself (`render.py` drives FL's own export: Ctrl+R, the path in Save As,
  Start). Keep your hands off the keyboard for the 2–3 seconds FL's export windows are opening.
- Auto Mix listens to them and moves the faders. **Undo** puts every fader back.
- Press it again to check: a balanced mix moves nothing ("Already balanced").
- If a role is wrong, double-click it in the table to change it (a vocal's Lead cell says whether it's a lead), then
  **Apply changes**. *Lead over its group target* (3 dB by default) and *Kick +2 dB* change the plan at once.

The first time, FL's export window needs **Split mixer tracks** ticked and **WAV bit depth** at **32Bit float**: FL
remembers both, and Auto Mix says so if they're off. It switches FL to Song mode for the render and back after.

Why 32-bit float: FL's stems are taken after the fader. In a 16- or 24-bit file, an insert that goes over 0 dB gets
clipped, so it reads quieter than it really is.

**Use stems I exported…** analyses a folder you exported yourself instead (then Apply changes).

Why it drives FL's window: FL has no way to render from a script (its Python API has no export), and its command line
(`FL64.exe /R`) renders only the whole mix, never split stems.

## Using YT-Fill

Put **YT-Fill** on any insert's empty slot and open it. The list of sounds appears by itself; **Fill N inserts** does
it, **Undo fill** puts the whole mixer back. You can have it and YT-Mix open at once.

- What a sound is comes from its name, then the Serum preset saved in the project (`flpread.py` reads the FLP, FL's
  script can't see presets), then Jev if the app's key is there or `TYPESAFE_API_KEY` is set (only the sound's id,
  file or preset name and a category are sent). Save first if you've changed presets since: the list says which save
  it read.
- The groups are Instr, Bass and Drums, with a Vocal Bus and a Mix Bus. FX go to Drums. Select rows and press a group (*Selected sounds
  go to*), Skip, or As detected. Your picks are kept with the project, by channel name.
- Press **Rescan** to check: a filled project says "Nothing to change".
- **Use Undo fill, not Ctrl+Z.** FL lists "Fill inserts" in its history, but stepping back through it doesn't bring the
  names and routes back. Undo fill works until the plugin's worker stops or another project opens.
- A project's inserts are a hard limit: FL puts anything past the last one on the last one, so no script can add any.
  With too few, the list says so: add inserts in FL's mixer and Rescan.
- Recorded takes are left alone, and so is an insert named for a recording or vocals (rec, vocal, vox, ad-lib, bgv)
  unless a sound on it has that name. A box open in FL (like "Problems loading the project") blocks every script write,
  without an error: the plugin says so when nothing changed.
- A project is only found among the folders FL knows (its recents, Windows' Recent, `~/Music/Flps`, autosaves): open
  a copy from anywhere else and it says no saved project matches.
- A project that's never been saved is read from FL's `untitled (autosaved at …)` files, only those written since this
  FL started and with nearly the same channels (every unsaved project is "untitled" to FL). Press New in FL and the
  last untitled project's autosave can still answer if its channels are named the same, until FL autosaves the new one.

## Teaching it your taste

The fixed rule is one balance for every song. Auto Mix can learn yours instead, from mixes you balance by ear, and it
says honestly whether that helped: a learned model is used only when it predicts your balance on songs it never saw
better than the rule does.

1. **Render a library** (once, about a minute a song): `python train/batch_render.py` opens each song in
   `train/songs.json` (your songs with vocals, from the YT Link tags) in the FL that's running, reads its mixer, exports
   its split stems and hands them to `train/prep.py`, which keeps each insert as it reaches the master (Ogg, a few MB a
   song) in `Documents/YTStudio Auto Mix/training/songs/<id>/`. FL comes to the front for every export: leave the
   computer alone. It answers **No** when FL asks to save the project it's leaving, so no FLP is ever written. It picks
   up where it stopped (`--only id,id`, `--redo`).
2. **Mix in the trainer**: `python train/trainer.py --open` (http://127.0.0.1:5390). Each song plays as its groups on
   faders with no numbers. Balance it the way you'd release it and **Save this mix** (Enter). Some songs start from Auto
   Mix's balance, some from a scrambled one and some from your FLP's, and you only find out which after you save, so you
   judge the sound and not where it started. *Hold loudness* keeps the mix at one loudness while you move faders (louder
   always sounds better), and **Auto Mix** (B) plays its balance at the same loudness as yours. Drag on the timeline to
   loop a part (L). If a track is in the wrong group, fix its role under *Tracks and roles*. After 5 songs it slips in
   repeats of songs you've mixed, to measure how consistent your own ear is: no model can beat that.
3. **Learn**: the trainer's **Learn** button, or `python train/learn.py`. It fits, per group, how far your balance
   sits from the rule (pulled towards the rule while there are few mixes), and then how the group's sound (how many
   tracks, how dense, bright, low and punchy it is, how much it plays over the vocal) moves that, kept only if it
   predicts held-out songs better. Each song's own FLP balance counts too, at half weight. It writes
   `training/model.json` only when it beats the rule, and `learn_report.txt` either way.

In YT-Mix, **My taste** turns the learned model on (it's on once there is one), and **Learn from this mix** keeps
the balance you've set by ear in FL, after an Auto Mix, as another mix to learn from (pressing it again in the same
project replaces it).

## Building and installing the plugin

    powershell -ExecutionPolicy Bypass -File plugin\build.ps1

It needs Visual Studio's C++ Build Tools, CMake and Ninja, and JUCE (`-DJUCE_DIR=…`; by default the one the YTStudio
editor's engine build downloaded). It builds `plugin/build/` and runs `plugin/install.py`, which copies both plugins to
`Common Files\VST3` (`YT-Mix.vst3`, `YT-Fill.vst3`) with the worker's Python files inside each (`Contents/Resources/worker`)
and `python.txt` naming the Python to run them with (the one that ran install.py: it needs numpy, scipy and soundfile).
It removes an old `YTStudio Auto Mix.vst3` unless FL has it loaded. Then in FL: Options › Manage plugins › **Find installed
plugins**. They show at once under the mixer slot's **More plugins…**; the slot's short menu only lists them after FL
restarts.

YT-Mix keeps the old plugin's id, so FL takes it for the same plugin.

While FL has the plugin loaded its DLL can't be replaced: `install.py` still updates the Python, and the new worker starts
the next time the plugin loads (put it on a slot again, or reopen the project). The worker's errors, and anything it prints that isn't JSON, show
in red in the plugin's log.

## The rule

- Each group gets a set loudness against the others (`TARGETS` in `analysis.py`).
- Inside a group, your own balance stays as it is: the whole group moves by one amount.
- The lead (the main vocal, or the synths in a song with no vocal) sits 3 dB over its group target, about 2.5–3 LU
  under the whole mix.
- The song stays as loud as it was, so your master chain sees the same level as before.
- Only the inserts that sounds play into move. Buses and their effects stay as they are. The stems show how much each
  bus raises or lowers its inputs.

## Setting up FL Studio (once)

Either plugin's (or the window's) **Set up FL Studio…** does this. Both plugins share one script, which keeps the name
**YTStudio Auto Mix** because FL's MIDI settings refer to it by that name. Set up copies it to
`Documents\Image-Line\FL Studio\Settings\Hardware\YTStudio Auto Mix\`. FL Studio only runs a script for a MIDI input,
so the script also needs one, set either way:

- **In FL:** Options › MIDI settings › Input. Pick a plugged-in device you don't use for another script. Set
  *Controller type* to **YTStudio Auto Mix (user)**, enable it, and give it a free port number (e.g. 201).
- **With FL closed:** choose the input in the dialog and press *Use this input*. FL saves its MIDI settings when it
  quits, so this only works while FL is closed.

If you have no MIDI device at all, install loopMIDI (free) and use its port.

After the script changes, restart FL or press **Reload script** in View › Script output.

## How the two talk

FL's scripts run in a sandbox: they can't open files, sockets or pipes, or start programs. The window does that work
instead:

1. It makes a named pipe and copies one end into FL's process (`DuplicateHandle`).
2. It names that handle in `Documents\YTStudio Auto Mix\<FL's pid>-<handle>-<nonce>.link`.
3. The script lists that folder and reads and writes the handle. Messages are lines of JSON.

The script handles no MIDI, so the device it's on keeps working as usual. Since version 7 it serves several connections at
once, so both plugins and `app.py` can be open together. Its commands: `ping`, `state` (the mixer), `apply` (faders, as one
undo step), `song` (Song mode on or off for the render, since version 5), `fillState` (channels and inserts, for YT-Fill), `fill` (its changes).

FL's fader curve (0–1 to dB) is in `fader_curve.json`, measured from FL. The window sets each fader's 0–1 value from
that curve. It can't set a fader and read it back to find the value, because some inserts report their old level for
a while after they move.

## Files

| | |
|---|---|
| `plugin/` | both VST3s (JUCE), from one `CMakeLists.txt`: `Source/Processor` (state, starting the worker), `Source/Window` (what both windows share), `Source/MixWindow` and `Source/FillWindow`, `Source/Worker` (the process and its pipes); `build.ps1`, `install.py` |
| `worker.py` | YT-Mix's worker |
| `fill_worker.py` | YT-Fill's worker |
| `worker_base.py` | what both workers share: JSON lines on stdin (commands) and stdout (`view`, `log`, `progress`, `ask`, `alert`, `save`, `setup`) |
| `fillinserts.py` | Fill inserts' plan, pure: which group each sound belongs to, which insert it goes on, its name, colour and route (`test/fill_inserts_test.py`) |
| `flpread.py` | reads a saved FLP for what FL's script can't see: each channel's Serum preset, and which file is the open project |
| `app.py` | the window on its own (tkinter) |
| `analysis.py` | loudness (BS.1770), roles, bus gains, the plan. `python analysis.py <stems> <state.json>` prints a plan |
| `render.py` | renders the split stems through FL's export window. `python render.py <FL's pid>` |
| `link.py` | the connection to FL. `python link.py state` prints the mixer as JSON |
| `flsetup.py` | installs the script and puts it on a MIDI input |
| `fl/device_ytstudio_automix.py` | the FL script |
| `train/` | teaching it your taste: `batch_render.py` (+ `flctl.py`, FL's dialogs), `prep.py`, `trainer.py` (+ `web/index.html`), `learn.py`; `songs.json` the songs, from `pick_songs.py`/`resolve.py` |
| `test/` | `apply_test.py` (analyse and apply from the command line), `restore.py <state.json>` (put faders back), `wins.py`/`kids.py` (FL's windows and a dialog's controls), `learn_mix_test.py` (YT-Mix's Learn from this mix, offline: needs a project's float stems in `test/stems0f` and its `state0.json`), `fill_inserts_test.py` |

Needs Python 3.10+ with `numpy`, `scipy` and `soundfile` (`requirements.txt`), on Windows.

The songs stay on your computer: `train/songs.json` and the lists it's made from, the test project and its stems are in
`.gitignore`, so `train/` needs `pick_songs.py` run first and `apply_test.py` needs stems of your own. `experiments/` is
what the rule came from: the blind tests' mixing and page scripts, kept for reference, which need those songs too.

# Settings

FL Studio's Settings window, from the manual (`envsettings_audio.htm`, `envsettings_general.htm`). See
[README.md](README.md) for the sources.

## What it is

One window with a tab per subject: **MIDI, Audio, General, File, Themes, Project, Song info, Debug, Account,
About**. **F10** (or the Options menu: Audio settings, General settings...) opens it on a tab. It's the
whole program's (the Project and Song info tabs are the open song's).

### Audio

- **Input / output**: the **device** (ASIO or Direct Sound on Windows, Core Audio on a Mac), its status
  and the output latency it reports, and **Auto close** (let other programs use the device while FL
  isn't in front).
- **Sample rate** (44,100 Hz is the default the manual recommends).
- **Buffer length**: longer buffers ride out CPU spikes but add latency (Apple Silicon: start at 128
  samples). With ASIO, **Show ASIO panel** opens the driver's own settings, where the buffer is set.
- Options for underruns and timing: mix in buffer switch, triple buffer, hard-clip the output at 0 dB,
  the audio thread's priority, safe overloads, an underruns counter, the playback tracking source.
- **CPU**: multithreaded generator and mixer processing, smart disable of idle plugins.
- **Mixer**: the resampling quality, the mixer track the metronome and previews play on, and reset
  plugins on transport.

### General

Display (the interface's scale, animations, transparent windows, "high visibility" for more contrast and
hover outlines), language and note names, the pointing device, the undo history, warnings, file
associations and updates.

### Themes

FL's look is a theme: its colours (hue, saturation, lightness of the whole interface, plus a few
highlight colours) are set here and saved as a theme file.

## Where Vaudio differs

Vaudio has one Settings page for the whole app (⌘, or the gear in each suite's header,
`src/components/settings/`), with a section per suite; the music editor's is FL's Audio tab. ⌘, opens it
on the section of the app you're in.

- **Audio** is what the engine can change: the output device, the buffer length and the sample rate,
  with the latency the device reports. No input device, auto close, ASIO panel or the underrun options
  yet.
- The engine's state, a test tone, the plugin scan and the plugin bench sit below it (FL keeps plugin
  folders and scanning in the Plugin manager, a window of its own; we have no Plugin manager yet).
- Themes and the interface's fonts are the app's (General), not the music editor's: the same themes
  dress both suites. FL's hue/saturation sliders aren't there: a theme is a set of chosen values
  (`src/themes/`), each one light or dark, with System following the computer.
- No F10 yet: ⌘, opens it.

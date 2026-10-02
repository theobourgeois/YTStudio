// MIDI keyboards (`docs/fl-studio/midi.md`): every MIDI input on this computer is listened to unless
// it's been turned off (kept in `midi.json` in the engine's data folder, by name), including those
// plugged in while the engine runs. What they send goes to `onMessage` on MIDI's own threads, as it
// comes: the sequencer queues it for the audio thread.
#pragma once

#include <functional>
#include <memory>
#include <vector>
#include <juce_audio_devices/juce_audio_devices.h>

class MidiInputs final : private juce::MidiInputCallback
{
public:
    /** `settings`: where the inputs turned off are kept. `onMessage` is called on MIDI's threads. */
    MidiInputs (const juce::File& settings, std::function<void (const juce::MidiMessage&)> onMessage);
    ~MidiInputs() override;

    /** Every input there is: `{ id, name, enabled, open }` (`EngineMidiInput`). Message thread. */
    juce::var describe() const;
    /** Listen to an input (by name) or not, from now on and in later runs. Message thread. */
    juce::Result setEnabled (const juce::String& name, bool enabled);

private:
    void handleIncomingMidiMessage (juce::MidiInput*, const juce::MidiMessage&) override;
    /** Open the inputs that should be and aren't, and close the rest (devices came or went, or a choice changed). */
    void refresh();
    void save() const;

    juce::File settingsFile;
    std::function<void (const juce::MidiMessage&)> onMessage;
    /** Inputs turned off, by name (an input's id can change when it's plugged in again). */
    juce::StringArray disabled;
    std::vector<std::unique_ptr<juce::MidiInput>> open;
    juce::MidiDeviceListConnection connection;

    JUCE_DECLARE_NON_COPYABLE (MidiInputs)
};

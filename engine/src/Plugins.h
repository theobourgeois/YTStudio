// Plugin hosting: finding the plugins on this computer (VST3, Audio Units), and the test bench's
// two slots, an instrument playing into an effect, each with a window and a state to save.
//
// Commands run on the message thread. The audio thread only calls `processInstrument` and
// `processEffect`, and only while it holds `lock` (which it tries, never waits for).
#pragma once

#include "EditorWindow.h"

#include <functional>

class PluginBench final : private juce::Timer
{
public:
    struct Slot
    {
        std::unique_ptr<juce::AudioPluginInstance> plugin;
        std::unique_ptr<EditorWindow> window;
        juce::String id;
        juce::var describe() const;
    };

    /**
     * `dataDir` keeps the list of scanned plugins; `pluginPaths` are searched besides the usual folders
     * (or, with `onlyPluginPaths`, instead of them: tests). `changed` is called when something changes
     * on its own: a scan ends, a plugin's window is closed by hand.
     */
    PluginBench (const juce::File& dataDir, const juce::StringArray& pluginPaths, bool onlyPluginPaths, std::function<void()> changed);
    ~PluginBench() override;

    // Message thread ---------------------------------------------------------
    void startScan (bool rescan);
    /** `{ progress, name }` while a scan runs, else void. */
    juce::var scanning() const;
    juce::var plugins() const;
    int pluginCount() const { return known.getNumTypes(); }
    /** The plugin formats and the plugins found, which the song's own plugins are loaded from too. */
    juce::AudioPluginFormatManager& formatManager() { return formats; }
    juce::KnownPluginList& knownPlugins() { return known; }

    /** "instrument" or "effect"; null for anything else. */
    Slot* slot (const juce::String& name);
    void load (Slot&, const juce::String& pluginId, std::function<void (const juce::Result&)> done);
    void unload (Slot&);
    void showEditor (Slot&, bool open);
    juce::Result saveState (Slot&, const juce::File&);
    juce::Result restoreState (Slot&, const juce::File&);
    /** Files dropped on the plugin's window, made hidden if it isn't open (`dropFiles`). */
    juce::var dropFiles (Slot&, const juce::StringArray& files, double x, double y, bool perform);
    /** A note for the instrument, now (or, offline, at the start of the next rendered block). */
    void note (const juce::MidiMessage&, bool offline);

    /** The rate and block size plugins are prepared for. Only while the audio isn't running. */
    void prepare (double sampleRate, int blockSize);

    // Audio thread, holding `lock` -------------------------------------------
    juce::CriticalSection lock;
    /** Enough for every channel the loaded plugins use. */
    juce::AudioBuffer<float>& buffer() { return scratch; }
    /** The instrument's sound into `buffer()` (cleared first). */
    void processInstrument (int numSamples, bool offline);
    /** `buffer()`'s first two channels through the effect. */
    void processEffect (int numSamples);

    Slot instrument, effect;

private:
    void timerCallback() override;
    void configure (juce::AudioPluginInstance&) const;
    void sizeScratch();

    juce::AudioPluginFormatManager formats;
    juce::KnownPluginList known;
    juce::File knownFile, pedalFile;
    juce::StringArray extraPaths;
    const bool onlyExtraPaths;
    std::function<void()> changed;

    // The scan in progress: one scanner per format, stepped a plugin at a time so commands still run.
    juce::OwnedArray<juce::PluginDirectoryScanner> scanners;
    int scannerIndex = 0;
    juce::String scanningName;

    juce::MidiMessageCollector midi;
    /** Offline there's no clock to time notes by: they wait here for the next rendered block. */
    juce::MidiBuffer offlineNotes, blockNotes, noNotes;
    juce::AudioBuffer<float> scratch;
    double sampleRate = 44100.0;
    int blockSize = 512;

    JUCE_DECLARE_NON_COPYABLE_WITH_LEAK_DETECTOR (PluginBench)
};

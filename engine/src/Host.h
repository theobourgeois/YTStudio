// The plugins that are channels of the song: an instrument per plugin channel, kept alive across the
// song's edits, with its window and its state (saved beside the project).
//
// Instances are made and destroyed on the message thread. The audio thread reaches one only through
// the Song that holds it (a `shared_ptr`), and only its `midi`, `buffer` and `pending`, which are the
// audio thread's alone.
#pragma once

#include "EditorWindow.h"

#include <array>
#include <functional>
#include <map>
#include <memory>

struct HostedPlugin
{
    ~HostedPlugin();

    juce::String channelId, pluginId;
    std::unique_ptr<juce::AudioPluginInstance> instance;
    /** After `instance`, so it goes first. */
    std::unique_ptr<EditorWindow> window;
    /** Where its state is kept, and a hash of what was last written there. */
    juce::File stateFile;
    juce::int64 savedHash = 0;

    // The audio thread's ------------------------------------------------------
    juce::MidiBuffer midi;
    juce::AudioBuffer<float> buffer;
    /** Notes sounding, and how many samples until each ends. */
    struct Pending
    {
        int key = 0;
        juce::int64 left = 0;
    };
    std::array<Pending, 128> pending;
    int numPending = 0;
};

class PluginHost
{
public:
    /** `changed` is called when a plugin finishes loading (or fails), or its window is closed by hand. */
    PluginHost (juce::AudioPluginFormatManager& formats, juce::KnownPluginList& known, std::function<void()> changed);
    ~PluginHost();

    /**
     * The channel's plugin, if it's loaded. If it isn't, it starts loading (and `changed` says when it
     * has), its state read from `stateFile` if that exists. Null meanwhile, and if it can't be loaded.
     */
    std::shared_ptr<HostedPlugin> get (const juce::String& channelId, const juce::String& pluginId, const juce::File& stateFile);
    /** Let go of the plugins of channels that aren't in `channelIds` any more, saving their state first. */
    void keepOnly (const juce::StringArray& channelIds);
    /** Write every plugin's state that has changed since it was last written. */
    void saveStates();
    /** False if the channel has no loaded plugin. */
    bool showEditor (const juce::String& channelId, bool open);
    void prepare (double sampleRate, int blockSize);
    /** Try again the plugins that couldn't be loaded (a scan may have found them since). */
    void forgetFailures() { failed.clear(); }

    /** `[{ channel, name, editorOpen }]`, the channels still loading, and `[{ channel, error }]`. */
    juce::var describe() const;

private:
    void save (HostedPlugin&);

    juce::AudioPluginFormatManager& formats;
    juce::KnownPluginList& known;
    std::function<void()> changed;
    std::map<juce::String, std::shared_ptr<HostedPlugin>> loaded;
    /** Channel id -> the plugin id being loaded for it. */
    std::map<juce::String, juce::String> loading;
    std::map<juce::String, juce::String> failed;
    double sampleRate = 48000.0;
    int blockSize = 512;
    /** So a load that finishes after the host has gone does nothing. */
    std::shared_ptr<bool> alive = std::make_shared<bool> (true);

    JUCE_DECLARE_NON_COPYABLE (PluginHost)
};

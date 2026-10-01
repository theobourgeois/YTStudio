// The song's plugins, kept alive across its edits, with their windows and their states (saved beside
// the project). The engine has two: the instruments of plugin channels (by channel id) and the effects
// in mixer tracks' slots (by effect id). Each plugin belongs to its owner: a channel, or an effect slot.
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

    /** The channel's or the effect's id. */
    juce::String ownerId, pluginId;
    /** The channel's or the mixer track's name, for its window's title: "Serum 2 (Chorus)". */
    juce::String ownerName;
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

class PluginHost final : private juce::Timer
{
public:
    /**
     * `changed` is called when a plugin finishes loading (or fails), or its window is closed by hand.
     * `ownerKey` names an owner in `describe` ("channel", "effect").
     */
    PluginHost (juce::AudioPluginFormatManager& formats, juce::KnownPluginList& known, juce::String ownerKey, std::function<void()> changed);
    ~PluginHost() override;

    /**
     * The owner's plugin, if it's loaded. If it isn't, it starts loading (and `changed` says when it
     * has), its state read from `stateFile` if that exists. Null meanwhile, and if it can't be loaded.
     */
    std::shared_ptr<HostedPlugin> get (const juce::String& ownerId, const juce::String& pluginId, const juce::File& stateFile, const juce::String& ownerName);
    /** Let go of the plugins of owners that aren't in `ownerIds` any more, saving their state first. */
    void keepOnly (const juce::StringArray& ownerIds);
    /** Write every plugin's state that has changed since it was last written. */
    void saveStates();
    /** False if the owner has no loaded plugin. */
    bool showEditor (const juce::String& ownerId, bool open);
    void prepare (double sampleRate, int blockSize);
    /**
     * The app's window (`{ active, visible, bounds: { x, y, width, height } }`), which the desktop app
     * says whenever it changes. From then on, plugin windows act as if they were part of it: they float
     * above it while it or they are in use, hide while another app is (or the app's window is
     * minimised or hidden), and move when it moves. Without it (a browser tab) they're ordinary windows.
     */
    void setHost (const juce::var& host);
    /** Try again the plugins that couldn't be loaded (a scan may have found them since). */
    void forgetFailures() { failed.clear(); }

    /** `{ loaded: [{ <owner key>, name, editorOpen, latency }], loading: [ids], failed: [{ <owner key>, error }] }`. */
    juce::var describe() const;

private:
    void save (HostedPlugin&);
    /** Shows, hides and floats the windows as the app's window is (`setHost`). */
    void timerCallback() override;
    void placeWindows();
    static juce::String titleOf (const HostedPlugin&);

    juce::AudioPluginFormatManager& formats;
    juce::KnownPluginList& known;
    juce::String ownerKey;
    std::function<void()> changed;
    std::map<juce::String, std::shared_ptr<HostedPlugin>> loaded;
    /** Owner id -> the plugin id being loaded for it. */
    std::map<juce::String, juce::String> loading;
    std::map<juce::String, juce::String> failed;
    /** The app's window, once the desktop app has said. */
    bool hostKnown = false, hostActive = false, hostVisible = true;
    juce::Rectangle<int> hostBounds;
    /** When the app or the engine was last in front (ms): switching between them, neither is for a moment. */
    juce::uint32 lastInUse = 0;
    bool windowsShown = true;
    double sampleRate = 48000.0;
    int blockSize = 512;
    /** So a load that finishes after the host has gone does nothing. */
    std::shared_ptr<bool> alive = std::make_shared<bool> (true);

    JUCE_DECLARE_NON_COPYABLE (PluginHost)
};

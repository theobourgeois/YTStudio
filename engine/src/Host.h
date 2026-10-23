// The song's plugins, kept alive across its edits, with their windows and their states (saved beside
// the project). The engine has two: the instruments of plugin channels (by channel id) and the effects
// in mixer tracks' slots (by effect id). Each plugin belongs to its owner: a channel, or an effect slot.
//
// Instances are made and destroyed on the message thread. The audio thread reaches one only through
// the Song that holds it (a `shared_ptr`), and only its `midi`, `buffer` and `pending`, which are the
// audio thread's alone.
#pragma once

#include "EditorWindow.h"
#include "Scope.h"

#include <array>
#include <functional>
#include <map>
#include <memory>

/** A parameter's id as the plugin gives it (`AutomationTarget.param`): stable across versions, else its index. */
juce::String parameterId (juce::AudioPluginInstance&, int index);
/** A plugin's parameter by its id (or, for a plugin that names them by index, its index): null if it has none such. `found` gets its index. */
juce::AudioProcessorParameter* findParameter (juce::AudioPluginInstance&, const juce::String& id, int index, int& found);

/**
 * Hears a plugin's parameters being touched in its own window (any thread): which one is held (so its
 * automation lets go of it meanwhile), and which was touched last (`PluginHost::reportTouches`).
 */
struct ParameterWatcher final : juce::AudioProcessorListener
{
    std::atomic<int> held { -1 }, touched { -1 };
    std::atomic<juce::uint32> touches { 0 };

    void audioProcessorParameterChanged (juce::AudioProcessor*, int, float) override {}
    void audioProcessorChanged (juce::AudioProcessor*, const ChangeDetails&) override {}
    void audioProcessorParameterChangeGestureBegin (juce::AudioProcessor*, int index) override
    {
        held = index;
        touched = index;
        ++touches;
    }
    void audioProcessorParameterChangeGestureEnd (juce::AudioProcessor*, int index) override
    {
        auto expected = index;
        held.compare_exchange_strong (expected, -1);
        ++touches;
    }
};

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
    /** Its window made invisible to hand it files (`PluginHost::dropFiles`), while `window` isn't open. */
    std::unique_ptr<EditorWindow> dropWindow;
    juce::uint32 lastDrop = 0;
    /** Where its state is kept, and a hash of what was last written there. */
    juce::File stateFile;
    juce::int64 savedHash = 0;
    /** The user's preset last loaded or saved in it (its name), or empty: what its title bar shows. */
    juce::String preset;

    // The audio thread's ------------------------------------------------------
    juce::MidiBuffer midi;
    juce::AudioBuffer<float> buffer;
    /** Its sidechain input's first channel in `buffer`, and how many (-1, 0: it has none). Set when it's prepared. */
    int keyChannel = -1, keyChannels = 0;
    /** Notes sounding, how many samples until each ends, and how hard each was played (to play it again). */
    struct Pending
    {
        int key = 0;
        juce::int64 left = 0;
        float velocity = 0.78f;
    };
    std::array<Pending, 128> pending;
    int numPending = 0;
    /** What its blocks took lately (high-resolution ticks), so the costliest plugin starts first on the workers. */
    double cost = 0;

    // Any thread's -------------------------------------------------------------
    /** Its parameters being touched in its window: the one held (automation leaves it alone), the last touched. */
    ParameterWatcher watcher;
    /**
     * Automation is moving its parameters (the song plays): its state isn't saved meanwhile, or an
     * automated value would be kept as its own. Set by the audio thread, cleared when it lets go.
     */
    std::atomic<bool> automating { false };
    /** The message thread's: the touches already said. */
    juce::uint32 touchesSaid = 0;

    /**
     * Something done to the plugin that it can't take while it plays: a new state, files dropped on it
     * (`PluginHost::swap`). The audio thread fades it out and then leaves it alone (`parked`); the message thread
     * does it; the audio thread plays its sounding notes again and fades it back in. So it's never loaded and
     * played at once, and nothing clicks. A plugin channel's only.
     */
    enum class Swap { none, fadingOut, parked, resuming };

    /**
     * Its sound for the Serum player's display (`ChannelScope`), while a player shows it (`PluginHost::watchScopes`).
     * Made on the message thread before `watched` is first set, and kept while the plugin is.
     */
    std::unique_ptr<ChannelScope> scope;
    std::atomic<bool> watched { false };
    std::atomic<Swap> swap { Swap::none };
    /** The audio thread's: where its fade is (1: its own level). */
    float swapGain = 1.0f;
    /** The message thread's: what to do once it's parked (given null: it won't be), and since when it's been asked. */
    std::function<void (HostedPlugin*)> swapAction;
    juce::uint32 swapAsked = 0;
};

class PluginHost final
{
public:
    /**
     * `changed` is called when a plugin finishes loading (or fails), or its window is closed by hand.
     * `ownerKey` names an owner in `describe` ("channel", "effect").
     */
    PluginHost (juce::AudioPluginFormatManager& formats, juce::KnownPluginList& known, juce::String ownerKey, std::function<void()> changed);
    ~PluginHost();

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
     * Where the shell's window is (`{ bounds: { x, y, width, height } }`, `ShellWindow::tellHost`) whenever it
     * moves or resizes: plugin windows open over it and, on Windows, move with it (macOS moves child windows
     * itself). Without a shell (a browser tab, the Electron apps) it's never said: they're ordinary windows.
     */
    void setHost (const juce::var& host);
    /** A fingerprint of the loaded plugins' reported delays, to notice one changing (a linear-phase EQ switched on). */
    juce::int64 latencySignature() const;
    /** Try again the plugins that couldn't be loaded (a scan may have found them since). */
    void forgetFailures() { failed.clear(); }
    /** A plugin is still being loaded. */
    bool anyLoading() const { return ! loading.empty(); }
    /** The owner's plugin couldn't be loaded. */
    bool hasFailed (const juce::String& ownerId) const { return failed.count (ownerId) > 0; }
    /**
     * While the song is exported: every plugin told it's rendering offline (so those with a better
     * offline mode use it), and their windows hidden (what's turned in one would change the render).
     * Only while nothing is processing them.
     */
    void setExporting (bool exporting);
    /** Clear what every plugin has ringing (a reverb's tail, notes held). Only while nothing is processing them. */
    void reset();

    /** `{ loaded: [{ <owner key>, name, editorOpen, latency }], loading: [ids], failed: [{ <owner key>, error }] }`. */
    juce::var describe() const;
    /**
     * The owner's plugin's parameters that can be automated: `[{ index, id, name, value, text }]`, or void
     * if it isn't loaded.
     */
    juce::var parameters (const juce::String& ownerId) const;
    /**
     * Set one of the owner's plugin's parameters (by its id, as `parameters` gives it) to `value` (0 to 1), as its
     * own window would. `gesture` "begin" holds it (automation leaves it alone meanwhile), "end" lets go.
     */
    juce::Result setParameter (const juce::String& ownerId, const juce::String& id, float value, const juce::String& gesture);

    // Swaps (`HostedPlugin::Swap`) -------------------------------------------------------------------
    /**
     * Do `action` to the owner's plugin once the audio thread has faded it out and let go of it; the audio thread
     * then plays its notes again and fades it back in. `done` is told when it's been done (with what `action`
     * said), or why it won't be. A second swap asked before the first was done replaces it. A plugin channel's only.
     */
    void swap (const juce::String& ownerId, std::function<juce::var (HostedPlugin&)> action, std::function<void (const juce::Result&, const juce::var&)> done);
    /**
     * Do the swaps whose plugins the audio thread has let go of (`untended`: also those it hasn't after a while,
     * when no device is running them). Call often while `swapping`; offline, between rendered blocks.
     */
    void completeSwaps (bool untended);
    bool swapping() const;

    // Scopes (`ChannelScope`) --------------------------------------------------------------------------
    /** The owners whose sound is to be shown (the Serum players open); the rest aren't measured. */
    void watchScopes (const juce::StringArray& ownerIds);
    /** `{ <owner>: ChannelScope::describe }` for those watched that sounded since the last call (`always`: all watched). */
    juce::var scopes (bool always = false);
    /**
     * Files dropped on the plugin's window as if from Finder (`::dropFiles`): its window if it's open, else one
     * made invisible for it (kept a few seconds for the next). Says what the plugin answered. In a swap's action.
     */
    juce::var dropFiles (HostedPlugin&, const juce::StringArray& files);
    /**
     * Get the plugin's window ready to be given `files` (`dropFiles`), then call `ready` (on the message thread),
     * before the swap that drops them is asked for. Windows: a window just made for it (Serum's) turns files down
     * for a moment, while its view finishes being made, so it's asked (a drag that only passes over) until it
     * would take them, for up to `dropReadyMs`. At once elsewhere, and for a plugin that isn't loaded.
     */
    void whenDropReady (const juce::String& ownerId, const juce::StringArray& files, std::function<void()> ready);
    /**
     * Say which parameter was touched last in each plugin's window, if one was since the last call
     * (`EngineEvent` "touch"), and show it on the window's Automate button. Call regularly.
     */
    void reportTouches();

    // Presets (FL's preset browser, `docs/fl-studio/plugin-window.md`) ------------------------------
    /** Where the user's presets are kept: a folder per plugin (by format and name), the same for every song. */
    void setPresetsFolder (const juce::File& folder) { presetsRoot = folder; }
    /**
     * The owner's plugin's presets: its own programs and the one it's on (`programs`, `program`), and the
     * user's saved for it (`presets`, `preset`: the last loaded or saved, or ""). Void if it isn't loaded.
     */
    juce::var presets (const juce::String& ownerId) const;
    juce::Result setProgram (const juce::String& ownerId, int index);
    /** Save the plugin's settings now as a preset of the user's (replacing one of that name), or load or delete one. */
    juce::Result savePreset (const juce::String& ownerId, const juce::String& name);
    juce::Result loadPreset (const juce::String& ownerId, const juce::String& name);
    juce::Result deletePreset (const juce::String& ownerId, const juce::String& name);
    /** The next (1) or previous (-1) preset, the title bar's arrows: the plugin's programs if it has several, else the user's presets. */
    void stepPreset (const juce::String& ownerId, int direction);

private:
    void save (HostedPlugin&);
    /** Its buses (a mixer effect's sidechain input on) and rate, and where its sidechain input is. */
    void configure (HostedPlugin&) const;
    juce::File presetFolder (const HostedPlugin&) const;
    juce::StringArray presetNames (const HostedPlugin&) const;
    /** Its window shows what it's on now, and the tab is told (`EngineEvent` "preset"). */
    void presetChanged (HostedPlugin&);
    /** What its title bar says of its presets: the user's preset, else its program's name (if it has several). */
    static juce::String presetLabel (const HostedPlugin&);
    /** `{ owner, id, index, param, name, value, text }` for one of the owner's plugin's parameters, or void. */
    juce::var describeParameter (const juce::String& ownerId, int index) const;
    static juce::String titleOf (const HostedPlugin&);

    juce::AudioPluginFormatManager& formats;
    juce::KnownPluginList& known;
    juce::String ownerKey;
    std::function<void()> changed;
    juce::File presetsRoot;
    std::map<juce::String, std::shared_ptr<HostedPlugin>> loaded;
    /** Owners whose plugin is loading: its id and the file its state comes from (`pluginId\nstate path`). */
    std::map<juce::String, juce::String> loading;
    std::map<juce::String, juce::String> failed;
    /** Where the shell's window is (`setHost`); empty without one. */
    juce::Rectangle<int> hostBounds;
    bool exporting = false;
    juce::StringArray watchedScopes;
    double sampleRate = 48000.0;
    int blockSize = 512;
    /** So a load that finishes after the host has gone does nothing. */
    std::shared_ptr<bool> alive = std::make_shared<bool> (true);
    /** The window files are dropped on: its own if it's open, else one made invisible for it. */
    EditorWindow& dropWindowOf (HostedPlugin&);
    /** Note a use of the invisible window, which is let go of `dropWindowKeptMs` after the last. */
    void keepDropWindow (HostedPlugin&);

    JUCE_DECLARE_NON_COPYABLE (PluginHost)
};

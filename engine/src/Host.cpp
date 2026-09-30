#include "Host.h"

#include "Protocol.h"

namespace
{
/** How long neither the app nor the engine may be in front before plugin windows hide (a click from one to the other). */
constexpr juce::uint32 switchGraceMs = 400;
constexpr int hostCheckMs = 100;

/** The most samples a plugin is asked for at once (the engine's blocks are far smaller). */
constexpr int maxBlock = 8192;

/** A fingerprint of a plugin's state (FNV-1a), to tell whether it needs writing again. */
juce::int64 hashOf (const juce::MemoryBlock& state)
{
    juce::uint64 hash = 1469598103934665603ULL;
    const auto* bytes = static_cast<const unsigned char*> (state.getData());
    for (size_t i = 0; i < state.getSize(); ++i)
        hash = (hash ^ bytes[i]) * 1099511628211ULL;
    return (juce::int64) (hash | 1);
}
}

HostedPlugin::~HostedPlugin()
{
    window.reset();
    if (instance != nullptr)
        instance->releaseResources();
}

PluginHost::PluginHost (juce::AudioPluginFormatManager& f, juce::KnownPluginList& k, std::function<void()> onChange)
    : formats (f), known (k), changed (std::move (onChange))
{
}

PluginHost::~PluginHost()
{
    stopTimer();
    *alive = false;
    saveStates();
}

std::shared_ptr<HostedPlugin> PluginHost::get (const juce::String& channelId, const juce::String& pluginId, const juce::File& stateFile, const juce::String& channelName)
{
    if (const auto found = loaded.find (channelId); found != loaded.end())
    {
        if (found->second->pluginId == pluginId)
        {
            // Renamed: its window's title says so.
            if (auto& hosted = *found->second; hosted.channelName != channelName)
            {
                hosted.channelName = channelName;
                if (hosted.window != nullptr)
                    hosted.window->setName (titleOf (hosted));
            }
            return found->second;
        }
        // The channel has another plugin now.
        save (*found->second);
        loaded.erase (found);
    }
    if (const auto busy = loading.find (channelId); busy != loading.end() && busy->second == pluginId)
        return nullptr;
    if (const auto broken = failed.find (channelId); broken != failed.end())
        return nullptr;

    const auto description = known.getTypeForIdentifierString (pluginId);
    if (description == nullptr)
    {
        failed[channelId] = "This plugin isn't installed on this computer (or hasn't been scanned).";
        return nullptr;
    }

    loading[channelId] = pluginId;
    formats.createPluginInstanceAsync (*description, sampleRate, blockSize,
                                       [this, stillAlive = alive, channelId, pluginId, stateFile, channelName] (std::unique_ptr<juce::AudioPluginInstance> created, const juce::String& error) {
                                           if (! *stillAlive)
                                               return;
                                           // Asked for something else (or nothing) since.
                                           if (const auto busy = loading.find (channelId); busy == loading.end() || busy->second != pluginId)
                                               return;
                                           loading.erase (channelId);
                                           if (created == nullptr)
                                           {
                                               failed[channelId] = error.isNotEmpty() ? error : "The plugin couldn't be loaded.";
                                               return changed();
                                           }

                                           auto hosted = std::make_shared<HostedPlugin>();
                                           hosted->channelId = channelId;
                                           hosted->pluginId = pluginId;
                                           hosted->channelName = channelName;
                                           hosted->stateFile = stateFile;
                                           hosted->instance = std::move (created);
                                           configurePlugin (*hosted->instance, sampleRate, blockSize);
                                           juce::MemoryBlock state;
                                           if (stateFile.existsAsFile() && stateFile.loadFileAsData (state) && state.getSize() > 0)
                                           {
                                               hosted->instance->setStateInformation (state.getData(), (int) state.getSize());
                                               // What the plugin gives back may not be byte for byte what it was given: it's written again once, if so.
                                               hosted->savedHash = hashOf (state);
                                           }
                                           const auto channels = juce::jmax (2, hosted->instance->getTotalNumInputChannels(), hosted->instance->getTotalNumOutputChannels());
                                           hosted->buffer.setSize (channels, maxBlock);
                                           hosted->midi.ensureSize (4096);
                                           loaded[channelId] = std::move (hosted);
                                           changed();
                                       });
    return nullptr;
}

void PluginHost::keepOnly (const juce::StringArray& channelIds)
{
    for (auto it = loaded.begin(); it != loaded.end();)
    {
        if (channelIds.contains (it->first))
        {
            ++it;
            continue;
        }
        // Its state is kept: undoing the channel's removal brings the plugin back as it was.
        save (*it->second);
        it->second->window.reset();
        it = loaded.erase (it);
    }
    std::erase_if (loading, [&] (const auto& entry) { return ! channelIds.contains (entry.first); });
    std::erase_if (failed, [&] (const auto& entry) { return ! channelIds.contains (entry.first); });
}

void PluginHost::save (HostedPlugin& hosted)
{
    if (hosted.stateFile == juce::File())
        return;
    juce::MemoryBlock state;
    hosted.instance->getStateInformation (state);
    const auto hash = hashOf (state);
    if (hash == hosted.savedHash)
        return;
    hosted.stateFile.getParentDirectory().createDirectory();
    if (hosted.stateFile.replaceWithData (state.getData(), state.getSize()))
        hosted.savedHash = hash;
}

void PluginHost::saveStates()
{
    for (auto& [id, hosted] : loaded)
        save (*hosted);
}

bool PluginHost::showEditor (const juce::String& channelId, bool open)
{
    const auto found = loaded.find (channelId);
    if (found == loaded.end())
        return false;
    auto& hosted = *found->second;
    if (! open)
    {
        hosted.window.reset();
        return true;
    }
    if (hosted.window == nullptr)
        hosted.window = std::make_unique<EditorWindow> (*hosted.instance, titleOf (hosted), [this, stillAlive = alive, channelId] {
            juce::MessageManager::callAsync ([this, stillAlive, channelId] {
                if (! *stillAlive)
                    return;
                if (const auto it = loaded.find (channelId); it != loaded.end())
                    it->second->window.reset();
                changed();
            });
        });
    hosted.window->show();
    placeWindows();
    return true;
}

juce::String PluginHost::titleOf (const HostedPlugin& hosted)
{
    const auto name = hosted.instance->getName();
    return hosted.channelName.isEmpty() || hosted.channelName == name ? name : name + " (" + hosted.channelName + ")";
}

void PluginHost::setHost (const juce::var& host)
{
    hostActive = (bool) host["active"];
    hostVisible = (bool) host["visible"];
    if (hostActive)
        lastInUse = juce::Time::getMillisecondCounter();

    const auto bounds = host["bounds"];
    const juce::Rectangle<int> now ((int) bounds["x"], (int) bounds["y"], (int) bounds["width"], (int) bounds["height"]);
    // Moved (not resized, maximised or made full screen): its plugin windows go along.
    if (hostKnown && bounds.isObject() && ! hostBounds.isEmpty() && now.getWidth() == hostBounds.getWidth() && now.getHeight() == hostBounds.getHeight())
    {
        const auto delta = now.getPosition() - hostBounds.getPosition();
        if (delta != juce::Point<int>())
            for (auto& [id, hosted] : loaded)
                if (hosted->window != nullptr)
                    hosted->window->setTopLeftPosition (hosted->window->getPosition() + delta);
    }
    if (bounds.isObject())
        hostBounds = now;

    if (! hostKnown)
    {
        hostKnown = true;
        startTimer (hostCheckMs);
    }
    placeWindows();
}

void PluginHost::timerCallback() { placeWindows(); }

void PluginHost::placeWindows()
{
    if (! hostKnown)
        return;
    const auto now = juce::Time::getMillisecondCounter();
    if (hostActive || juce::Process::isForegroundProcess())
        lastInUse = now;
    const auto shown = hostVisible && now - lastInUse < switchGraceMs;
    const auto changedState = shown != windowsShown;
    windowsShown = shown;
    for (auto& [id, hosted] : loaded)
        if (auto* window = hosted->window.get())
        {
            // Above the app's window, but only while it's in use: then they're gone with it.
            if (window->isAlwaysOnTop() != shown)
                window->setAlwaysOnTop (shown);
            if (changedState || window->isVisible() != shown)
                window->setVisible (shown);
        }
}

void PluginHost::prepare (double rate, int block)
{
    sampleRate = rate;
    blockSize = block;
    for (auto& [id, hosted] : loaded)
    {
        hosted->instance->releaseResources();
        configurePlugin (*hosted->instance, rate, block);
    }
}

juce::var PluginHost::describe() const
{
    juce::Array<juce::var> ready, busy, broken;
    for (const auto& [id, hosted] : loaded)
        ready.add (protocol::object ({ { "channel", id }, { "name", hosted->instance->getName() }, { "editorOpen", hosted->window != nullptr } }));
    for (const auto& [id, plugin] : loading)
        busy.add (id);
    for (const auto& [id, error] : failed)
        broken.add (protocol::object ({ { "channel", id }, { "error", error } }));
    return protocol::object ({ { "loaded", ready }, { "loading", busy }, { "failed", broken } });
}

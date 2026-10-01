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
    {
        instance->removeListener (&watcher);
        instance->releaseResources();
    }
}

juce::String parameterId (juce::AudioPluginInstance& instance, int index)
{
    const auto& parameters = instance.getParameters();
    if (index < 0 || index >= parameters.size())
        return {};
    if (auto* hosted = dynamic_cast<juce::HostedAudioProcessorParameter*> (parameters[index]))
        if (const auto id = hosted->getParameterID(); id.isNotEmpty())
            return id;
    return juce::String (index);
}

juce::AudioProcessorParameter* findParameter (juce::AudioPluginInstance& instance, const juce::String& id, int index, int& found)
{
    const auto& parameters = instance.getParameters();
    // Where it was last time first: most plugins keep their parameters in one order.
    if (index >= 0 && index < parameters.size() && parameterId (instance, index) == id)
        return parameters[(found = index)];
    for (int i = 0; i < parameters.size(); ++i)
        if (parameterId (instance, i) == id)
            return parameters[(found = i)];
    return nullptr;
}

PluginHost::PluginHost (juce::AudioPluginFormatManager& f, juce::KnownPluginList& k, juce::String key, std::function<void()> onChange)
    : formats (f), known (k), ownerKey (std::move (key)), changed (std::move (onChange))
{
}

PluginHost::~PluginHost()
{
    stopTimer();
    *alive = false;
    saveStates();
}

std::shared_ptr<HostedPlugin> PluginHost::get (const juce::String& ownerId, const juce::String& pluginId, const juce::File& stateFile, const juce::String& ownerName)
{
    if (const auto found = loaded.find (ownerId); found != loaded.end())
    {
        if (found->second->pluginId == pluginId)
        {
            // Renamed: its window's title says so.
            if (auto& hosted = *found->second; hosted.ownerName != ownerName)
            {
                hosted.ownerName = ownerName;
                if (hosted.window != nullptr)
                    hosted.window->setName (titleOf (hosted));
            }
            return found->second;
        }
        // The owner has another plugin now.
        save (*found->second);
        loaded.erase (found);
    }
    if (const auto busy = loading.find (ownerId); busy != loading.end() && busy->second == pluginId)
        return nullptr;
    if (const auto broken = failed.find (ownerId); broken != failed.end())
        return nullptr;

    const auto description = known.getTypeForIdentifierString (pluginId);
    if (description == nullptr)
    {
        failed[ownerId] = "This plugin isn't installed on this computer (or hasn't been scanned).";
        return nullptr;
    }

    loading[ownerId] = pluginId;
    formats.createPluginInstanceAsync (*description, sampleRate, blockSize,
                                       [this, stillAlive = alive, ownerId, pluginId, stateFile, ownerName] (std::unique_ptr<juce::AudioPluginInstance> created, const juce::String& error) {
                                           if (! *stillAlive)
                                               return;
                                           // Asked for something else (or nothing) since.
                                           if (const auto busy = loading.find (ownerId); busy == loading.end() || busy->second != pluginId)
                                               return;
                                           loading.erase (ownerId);
                                           if (created == nullptr)
                                           {
                                               failed[ownerId] = error.isNotEmpty() ? error : "The plugin couldn't be loaded.";
                                               return changed();
                                           }

                                           auto hosted = std::make_shared<HostedPlugin>();
                                           hosted->ownerId = ownerId;
                                           hosted->pluginId = pluginId;
                                           hosted->ownerName = ownerName;
                                           hosted->stateFile = stateFile;
                                           hosted->instance = std::move (created);
                                           hosted->instance->setNonRealtime (exporting);
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
                                           hosted->instance->addListener (&hosted->watcher);
                                           loaded[ownerId] = std::move (hosted);
                                           changed();
                                       });
    return nullptr;
}

void PluginHost::keepOnly (const juce::StringArray& ownerIds)
{
    for (auto it = loaded.begin(); it != loaded.end();)
    {
        if (ownerIds.contains (it->first))
        {
            ++it;
            continue;
        }
        // Its state is kept: undoing the owner's removal brings the plugin back as it was.
        save (*it->second);
        it->second->window.reset();
        it = loaded.erase (it);
    }
    std::erase_if (loading, [&] (const auto& entry) { return ! ownerIds.contains (entry.first); });
    std::erase_if (failed, [&] (const auto& entry) { return ! ownerIds.contains (entry.first); });
}

void PluginHost::save (HostedPlugin& hosted)
{
    // Its automated values aren't its own: it's saved once automation has given them back.
    if (hosted.stateFile == juce::File() || hosted.automating.load())
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

bool PluginHost::showEditor (const juce::String& ownerId, bool open)
{
    const auto found = loaded.find (ownerId);
    if (found == loaded.end())
        return false;
    auto& hosted = *found->second;
    if (! open)
    {
        hosted.window.reset();
        return true;
    }
    if (hosted.window == nullptr)
    {
        hosted.window = std::make_unique<EditorWindow> (*hosted.instance, titleOf (hosted), [this, stillAlive = alive, ownerId] {
            juce::MessageManager::callAsync ([this, stillAlive, ownerId] {
                if (! *stillAlive)
                    return;
                if (const auto it = loaded.find (ownerId); it != loaded.end())
                    it->second->window.reset();
                changed();
            });
        });
        // Its Automate button: the tab makes an automation clip of the parameter last touched in it.
        hosted.window->onAutomate = [this, ownerId] (int index) {
            if (const auto described = describeParameter (ownerId, index); described.isObject())
            {
                described.getDynamicObject()->setProperty ("event", "automate");
                protocol::send (described);
            }
        };
        if (const auto touched = hosted.watcher.touched.load(); touched >= 0)
            hosted.window->setTouched (touched, hosted.instance->getParameters()[touched]->getName (64));
    }
    hosted.window->show();
    placeWindows();
    return true;
}

juce::String PluginHost::titleOf (const HostedPlugin& hosted)
{
    const auto name = hosted.instance->getName();
    return hosted.ownerName.isEmpty() || hosted.ownerName == name ? name : name + " (" + hosted.ownerName + ")";
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

void PluginHost::setExporting (bool on)
{
    exporting = on;
    for (auto& [id, hosted] : loaded)
    {
        hosted->instance->setNonRealtime (on);
        if (hosted->window != nullptr)
            hosted->window->setVisible (! on);
    }
    placeWindows();
}

void PluginHost::reset()
{
    for (auto& [id, hosted] : loaded)
    {
        hosted->instance->reset();
        hosted->numPending = 0;
        hosted->midi.clear();
    }
}

void PluginHost::placeWindows()
{
    if (exporting)
    {
        for (auto& [id, hosted] : loaded)
            if (hosted->window != nullptr && hosted->window->isVisible())
                hosted->window->setVisible (false);
        return;
    }
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
        ready.add (protocol::object ({ { ownerKey.toRawUTF8(), id }, { "name", hosted->instance->getName() }, { "editorOpen", hosted->window != nullptr }, { "latency", hosted->instance->getLatencySamples() } }));
    for (const auto& [id, plugin] : loading)
        busy.add (id);
    for (const auto& [id, error] : failed)
        broken.add (protocol::object ({ { ownerKey.toRawUTF8(), id }, { "error", error } }));
    return protocol::object ({ { "loaded", ready }, { "loading", busy }, { "failed", broken } });
}

juce::var PluginHost::describeParameter (const juce::String& ownerId, int index) const
{
    const auto found = loaded.find (ownerId);
    if (found == loaded.end())
        return {};
    auto& instance = *found->second->instance;
    const auto& parameters = instance.getParameters();
    if (index < 0 || index >= parameters.size())
        return {};
    auto* parameter = parameters[index];
    return protocol::object ({ { "owner", ownerKey },
                               { "id", ownerId },
                               { "index", index },
                               { "param", parameterId (instance, index) },
                               { "name", parameter->getName (64) },
                               { "value", parameter->getValue() },
                               { "text", parameter->getCurrentValueAsText() } });
}

juce::var PluginHost::parameters (const juce::String& ownerId) const
{
    const auto found = loaded.find (ownerId);
    if (found == loaded.end())
        return {};
    auto& instance = *found->second->instance;
    juce::Array<juce::var> list;
    const auto& parameters = instance.getParameters();
    for (int i = 0; i < parameters.size(); ++i)
    {
        auto* parameter = parameters[i];
        if (! parameter->isAutomatable())
            continue;
        list.add (protocol::object ({ { "index", i },
                                      { "id", parameterId (instance, i) },
                                      { "name", parameter->getName (64) },
                                      { "value", parameter->getValue() },
                                      { "text", parameter->getCurrentValueAsText() } }));
    }
    return list;
}

void PluginHost::reportTouches()
{
    for (auto& [id, hosted] : loaded)
    {
        const auto touches = hosted->watcher.touches.load();
        if (touches == hosted->touchesSaid)
            continue;
        hosted->touchesSaid = touches;
        const auto index = hosted->watcher.touched.load();
        auto described = describeParameter (id, index);
        if (! described.isObject())
            continue;
        if (hosted->window != nullptr)
            hosted->window->setTouched (index, described["name"].toString());
        described.getDynamicObject()->setProperty ("event", "touch");
        protocol::send (described);
    }
}

juce::int64 PluginHost::latencySignature() const
{
    juce::int64 signature = 17;
    for (const auto& [id, hosted] : loaded)
        signature = signature * 31 + id.hashCode64() * 7 + hosted->instance->getLatencySamples();
    return signature;
}

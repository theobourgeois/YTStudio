#include "Host.h"

#include "MacWindow.h"
#include "Protocol.h"

namespace
{
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
                                           configure (*hosted);
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
        // Its preset arrows, and its wrapper button (the channel's settings, in the app).
        hosted.window->onStep = [this, ownerId] (int direction) { stepPreset (ownerId, direction); };
        hosted.window->onSettings = [this, ownerId] { protocol::send (protocol::object ({ { "event", "wrapper" }, { "owner", ownerKey }, { "id", ownerId } })); };
        hosted.window->setPreset (presetLabel (hosted), hosted.instance->getNumPrograms() > 1 || ! presetNames (hosted).isEmpty());
        // The app keeps the order its floating windows (and ours) are in, so it knows which one was used last.
        hosted.window->onActivated = [this, ownerId] { protocol::send (protocol::object ({ { "event", "editorFocus" }, { "owner", ownerKey }, { "id", ownerId } })); };
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
       #if JUCE_WINDOWS
        // Over the app's window, as FL opens its plugins, rather than in the middle of the main screen.
        if (hostKnown && ! hostBounds.isEmpty())
            hosted.window->centreOver (hostBounds);
       #endif
    }
    placeWindows();
    hosted.window->show();
    placeWindows();
    return true;
}

bool PluginHost::raiseEditor (const juce::String& ownerId)
{
    const auto found = loaded.find (ownerId);
    if (found == loaded.end() || found->second->window == nullptr)
        return false;
    // In front of the other windows, without taking the focus: the app puts its windows back in order after another app was in use.
    found->second->window->toFront (false);
    return true;
}

juce::String PluginHost::focusedEditor() const
{
    auto* focused = juce::Component::getCurrentlyFocusedComponent();
    auto* top = focused != nullptr ? focused->getTopLevelComponent() : juce::TopLevelWindow::getActiveTopLevelWindow();
    if (top == nullptr)
        return {};
    for (const auto& [id, hosted] : loaded)
        if (hosted->window.get() == top)
            return id;
    return {};
}

juce::String PluginHost::titleOf (const HostedPlugin& hosted)
{
    const auto name = hosted.instance->getName();
    return hosted.ownerName.isEmpty() || hosted.ownerName == name ? name : name + " (" + hosted.ownerName + ")";
}

void PluginHost::setHost (const juce::var& host)
{
    hostFloating = host.hasProperty ("floating") ? (bool) host["floating"] : true;
    hostVisible = host.hasProperty ("visible") ? (bool) host["visible"] : true;
    // Windows: its main window's handle, which plugin windows then belong to (null: the window is gone, or a browser).
    EditorWindow::setAppWindow (appWindowFromHandle (host["handle"].toString()));

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

    hostKnown = true;
    placeWindows();
}

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
    for (auto& [id, hosted] : loaded)
        if (auto* window = hosted->window.get())
        {
            // Windows: a window of the app's (owned by its main window, or by none once that's gone).
            window->followAppWindow();
            if (EditorWindow::appWindow() != nullptr)
            {
                // That keeps it above the app's window and only that one, so no level is needed (always on top
                // would put it over every other program's windows).
                if (window->isAlwaysOnTop())
                    window->setAlwaysOnTop (false);
            }
            // At the level of the app's own floating windows (so they stack among each other by use, a click
            // raising the one it lands on), or at the ordinary level once the app is no longer the one in use.
            else if (window->isAlwaysOnTop() != hostFloating)
                window->setAlwaysOnTop (hostFloating);
            if (window->isVisible() != hostVisible)
                window->setVisible (hostVisible);
        }
}

void PluginHost::configure (HostedPlugin& hosted) const
{
    // A mixer effect's sidechain input is turned on (an instrument's never is: nothing feeds it).
    configurePlugin (*hosted.instance, sampleRate, blockSize, ownerKey == "effect");
    auto& instance = *hosted.instance;
    hosted.keyChannels = instance.getBusCount (true) > 1 && instance.getBus (true, 1)->isEnabled() ? instance.getBus (true, 1)->getNumberOfChannels() : 0;
    hosted.keyChannel = hosted.keyChannels > 0 ? instance.getChannelIndexInProcessBlockBuffer (true, 1, 0) : -1;
}

void PluginHost::prepare (double rate, int block)
{
    sampleRate = rate;
    blockSize = block;
    for (auto& [id, hosted] : loaded)
    {
        hosted->instance->releaseResources();
        configure (*hosted);
    }
}

juce::var PluginHost::describe() const
{
    juce::Array<juce::var> ready, busy, broken;
    for (const auto& [id, hosted] : loaded)
        ready.add (protocol::object ({ { ownerKey.toRawUTF8(), id },
                                       { "name", hosted->instance->getName() },
                                       { "editorOpen", hosted->window != nullptr },
                                       { "latency", hosted->instance->getLatencySamples() },
                                       { "sidechain", hosted->keyChannels > 0 } }));
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

// Presets ----------------------------------------------------------------------------------------

juce::File PluginHost::presetFolder (const HostedPlugin& hosted) const
{
    const auto description = hosted.instance->getPluginDescription();
    return presetsRoot.getChildFile (juce::File::createLegalFileName (description.pluginFormatName)).getChildFile (juce::File::createLegalFileName (description.name));
}

juce::StringArray PluginHost::presetNames (const HostedPlugin& hosted) const
{
    juce::StringArray names;
    if (presetsRoot == juce::File())
        return names;
    for (const auto& file : presetFolder (hosted).findChildFiles (juce::File::findFiles, false, "*.preset"))
        names.add (file.getFileNameWithoutExtension());
    names.sortNatural();
    return names;
}

juce::String PluginHost::presetLabel (const HostedPlugin& hosted)
{
    if (hosted.preset.isNotEmpty())
        return hosted.preset;
    auto& instance = *hosted.instance;
    return instance.getNumPrograms() > 1 ? instance.getProgramName (instance.getCurrentProgram()) : juce::String();
}

void PluginHost::presetChanged (HostedPlugin& hosted)
{
    if (hosted.window != nullptr)
        hosted.window->setPreset (presetLabel (hosted), hosted.instance->getNumPrograms() > 1 || ! presetNames (hosted).isEmpty());
    protocol::send (protocol::object ({ { "event", "preset" }, { "owner", ownerKey }, { "id", hosted.ownerId } }));
}

juce::var PluginHost::presets (const juce::String& ownerId) const
{
    const auto found = loaded.find (ownerId);
    if (found == loaded.end())
        return {};
    const auto& hosted = *found->second;
    auto& instance = *hosted.instance;
    juce::Array<juce::var> programs, presets;
    // A plugin with one program (most VST3s: their presets are their own business) has none to choose.
    if (instance.getNumPrograms() > 1)
        for (int i = 0; i < instance.getNumPrograms(); ++i)
            programs.add (instance.getProgramName (i));
    for (const auto& name : presetNames (hosted))
        presets.add (name);
    auto currentName = instance.getProgramName (instance.getCurrentProgram());
    juce::String category;
    if (instance.getName().containsIgnoreCase ("Serum"))
    {
        // Serum 2 embeds bounded JSON metadata in XferJson containers in its VST3 state.
        // Read only the headers, never decode or modify the synthesis payload.
        juce::MemoryBlock state;
        instance.getStateInformation (state);
        const auto readMetadata = [&] (const juce::MemoryBlock& block)
        {
            const auto* bytes = static_cast<const unsigned char*> (block.getData());
            const auto size = block.getSize();
            for (size_t at = 0; at + 17 <= size; ++at)
            {
                if (std::memcmp (bytes + at, "XferJson\0", 9) != 0) continue;
                juce::uint64 length = 0;
                for (int n = 0; n < 8; ++n) length |= (juce::uint64) bytes[at + 9 + (size_t) n] << (n * 8);
                if (length == 0 || length > 65536 || length > size - at - 17) continue;
                const auto metadata = juce::JSON::parse (juce::String::fromUTF8 (reinterpret_cast<const char*> (bytes + at + 17), (int) length));
                if (metadata["presetName"].isString() && metadata["presetName"].toString().isNotEmpty()) currentName = metadata["presetName"].toString();
                if (metadata["presetCategory"].isString()) category = metadata["presetCategory"].toString();
                at += 16 + (size_t) length;
            }
        };
        readMetadata (state); // AU's property-list state contains the containers directly.
        if (const auto xml = juce::AudioProcessor::getXmlFromBinary (state.getData(), (int) state.getSize()))
            for (const auto* tag : { "IComponent", "IEditController" })
                if (const auto* child = xml->getChildByName (tag))
                {
                    juce::MemoryBlock decoded;
                    if (decoded.fromBase64Encoding (child->getAllSubText())) readMetadata (decoded);
                }
    }
    if (currentName.isEmpty()) currentName = hosted.preset;
    return protocol::object ({ { "programs", programs }, { "program", programs.isEmpty() ? -1 : instance.getCurrentProgram() }, { "presets", presets }, { "preset", hosted.preset }, { "currentName", currentName }, { "category", category } });
}

juce::Result PluginHost::setProgram (const juce::String& ownerId, int index)
{
    const auto found = loaded.find (ownerId);
    if (found == loaded.end())
        return juce::Result::fail ("That plugin isn't loaded.");
    auto& hosted = *found->second;
    if (index < 0 || index >= hosted.instance->getNumPrograms())
        return juce::Result::fail ("It has no program " + juce::String (index) + ": it has " + juce::String (hosted.instance->getNumPrograms()) + ".");
    hosted.instance->setCurrentProgram (index);
    hosted.preset = {};
    presetChanged (hosted);
    return juce::Result::ok();
}

juce::Result PluginHost::savePreset (const juce::String& ownerId, const juce::String& name)
{
    const auto found = loaded.find (ownerId);
    if (found == loaded.end())
        return juce::Result::fail ("That plugin isn't loaded.");
    auto& hosted = *found->second;
    const auto legal = juce::File::createLegalFileName (name.trim());
    if (legal.isEmpty() || presetsRoot == juce::File())
        return juce::Result::fail ("A preset needs a name.");
    juce::MemoryBlock state;
    hosted.instance->getStateInformation (state);
    const auto folder = presetFolder (hosted);
    folder.createDirectory();
    if (! folder.getChildFile (legal + ".preset").replaceWithData (state.getData(), state.getSize()))
        return juce::Result::fail ("Couldn't write the preset in " + folder.getFullPathName());
    hosted.preset = legal;
    presetChanged (hosted);
    return juce::Result::ok();
}

juce::Result PluginHost::loadPreset (const juce::String& ownerId, const juce::String& name)
{
    const auto found = loaded.find (ownerId);
    if (found == loaded.end())
        return juce::Result::fail ("That plugin isn't loaded.");
    auto& hosted = *found->second;
    juce::MemoryBlock state;
    const auto file = presetFolder (hosted).getChildFile (juce::File::createLegalFileName (name) + ".preset");
    if (! file.existsAsFile() || ! file.loadFileAsData (state) || state.getSize() == 0)
        return juce::Result::fail ("There's no preset \"" + name + "\" for " + hosted.instance->getName() + ".");
    hosted.instance->setStateInformation (state.getData(), (int) state.getSize());
    hosted.preset = file.getFileNameWithoutExtension();
    presetChanged (hosted);
    return juce::Result::ok();
}

juce::Result PluginHost::deletePreset (const juce::String& ownerId, const juce::String& name)
{
    const auto found = loaded.find (ownerId);
    if (found == loaded.end())
        return juce::Result::fail ("That plugin isn't loaded.");
    auto& hosted = *found->second;
    const auto file = presetFolder (hosted).getChildFile (juce::File::createLegalFileName (name) + ".preset");
    if (! file.existsAsFile())
        return juce::Result::fail ("There's no preset \"" + name + "\" for " + hosted.instance->getName() + ".");
    file.deleteFile();
    if (hosted.preset == file.getFileNameWithoutExtension())
        hosted.preset = {};
    presetChanged (hosted);
    return juce::Result::ok();
}

void PluginHost::stepPreset (const juce::String& ownerId, int direction)
{
    const auto found = loaded.find (ownerId);
    if (found == loaded.end())
        return;
    auto& hosted = *found->second;
    auto& instance = *hosted.instance;
    if (instance.getNumPrograms() > 1)
    {
        const auto count = instance.getNumPrograms();
        setProgram (ownerId, ((instance.getCurrentProgram() + direction) % count + count) % count);
        return;
    }
    const auto names = presetNames (hosted);
    if (names.isEmpty())
        return;
    const auto at = names.indexOf (hosted.preset);
    const auto next = at < 0 ? (direction > 0 ? 0 : names.size() - 1) : ((at + direction) % names.size() + names.size()) % names.size();
    loadPreset (ownerId, names[next]);
}

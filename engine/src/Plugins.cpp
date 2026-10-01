#include "Plugins.h"

#include "Protocol.h"

namespace
{
int channelsNeeded (const juce::AudioPluginInstance* plugin)
{
    return plugin == nullptr ? 0 : juce::jmax (plugin->getTotalNumInputChannels(), plugin->getTotalNumOutputChannels());
}

juce::var describePlugin (const juce::PluginDescription& d)
{
    return protocol::object ({ { "id", d.createIdentifierString() },
                               { "name", d.name },
                               { "format", d.pluginFormatName },
                               { "manufacturer", d.manufacturerName },
                               { "category", d.category },
                               { "isInstrument", d.isInstrument } });
}
}

juce::var PluginBench::Slot::describe() const
{
    if (plugin == nullptr)
        return {};
    auto result = describePlugin (plugin->getPluginDescription());
    auto* fields = result.getDynamicObject();
    fields->setProperty ("id", id);
    fields->setProperty ("editorOpen", window != nullptr);
    fields->setProperty ("latencySamples", plugin->getLatencySamples());
    return result;
}

PluginBench::PluginBench (const juce::File& dataDir, const juce::StringArray& pluginPaths, bool onlyPluginPaths, std::function<void()> onChange)
    : knownFile (dataDir.getChildFile ("plugins.xml")),
      pedalFile (dataDir.getChildFile ("scan-crashed.txt")),
      extraPaths (pluginPaths),
      onlyExtraPaths (onlyPluginPaths),
      changed (std::move (onChange))
{
    formats.addDefaultFormats();
    if (auto xml = juce::parseXML (knownFile))
        known.recreateFromXml (*xml);
    sizeScratch();
}

PluginBench::~PluginBench()
{
    stopTimer();
    unload (instrument);
    unload (effect);
}

void PluginBench::startScan (bool rescan)
{
    if (! scanners.isEmpty())
        return;
    if (rescan)
        known.clear();
    for (auto* format : formats.getFormats())
    {
        const auto isVst3 = format->getName() == "VST3";
        if (onlyExtraPaths && ! isVst3)
            continue;
        auto paths = onlyExtraPaths ? juce::FileSearchPath() : format->getDefaultLocationsToSearch();
        if (isVst3)
            for (const auto& extra : extraPaths)
                paths.add (juce::File (extra));
        scanners.add (new juce::PluginDirectoryScanner (known, *format, paths, true, pedalFile));
    }
    scannerIndex = 0;
    scanningName = {};
    startTimer (1);
}

void PluginBench::timerCallback()
{
    if (scannerIndex < scanners.size())
    {
        if (! scanners[scannerIndex]->scanNextFile (true, scanningName))
            ++scannerIndex;
        return;
    }
    stopTimer();
    scanners.clear();
    if (auto xml = known.createXml())
        xml->writeTo (knownFile);
    changed();
}

juce::var PluginBench::scanning() const
{
    if (scanners.isEmpty())
        return {};
    const auto current = scannerIndex < scanners.size() ? scanners[scannerIndex]->getProgress() : 0.0f;
    return protocol::object ({ { "progress", ((float) scannerIndex + current) / (float) scanners.size() }, { "name", scanningName } });
}

juce::var PluginBench::plugins() const
{
    juce::Array<juce::var> list;
    for (const auto& type : known.getTypes())
        list.add (describePlugin (type));
    return list;
}

PluginBench::Slot* PluginBench::slot (const juce::String& name)
{
    return name == "instrument" ? &instrument : name == "effect" ? &effect : nullptr;
}

void PluginBench::configure (juce::AudioPluginInstance& plugin) const { configurePlugin (plugin, sampleRate, blockSize); }

void PluginBench::sizeScratch()
{
    const auto channels = juce::jmax (2, channelsNeeded (instrument.plugin.get()), channelsNeeded (effect.plugin.get()));
    scratch.setSize (channels, juce::jmax (4096, blockSize * 2), false, false, true);
}

void PluginBench::prepare (double rate, int block)
{
    const juce::ScopedLock guard (lock);
    sampleRate = rate;
    blockSize = block;
    midi.reset (sampleRate);
    for (auto* each : { &instrument, &effect })
        if (each->plugin != nullptr)
        {
            each->plugin->releaseResources();
            configure (*each->plugin);
        }
    sizeScratch();
}

void PluginBench::load (Slot& target, const juce::String& pluginId, std::function<void (const juce::Result&)> done)
{
    const auto description = known.getTypeForIdentifierString (pluginId);
    if (description == nullptr)
        return done (juce::Result::fail ("That plugin isn't in the list: scan for plugins first."));

    formats.createPluginInstanceAsync (*description, sampleRate, blockSize,
                                       [this, &target, pluginId, finish = std::move (done)] (std::unique_ptr<juce::AudioPluginInstance> created, const juce::String& error) {
                                           if (created == nullptr)
                                               return finish (juce::Result::fail (error.isNotEmpty() ? error : "The plugin couldn't be loaded."));
                                           configure (*created);
                                           unload (target);
                                           {
                                               const juce::ScopedLock guard (lock);
                                               target.plugin = std::move (created);
                                               target.id = pluginId;
                                               sizeScratch();
                                           }
                                           finish (juce::Result::ok());
                                       });
}

void PluginBench::unload (Slot& target)
{
    target.window.reset();
    std::unique_ptr<juce::AudioPluginInstance> old;
    {
        const juce::ScopedLock guard (lock);
        old = std::move (target.plugin);
        target.id = {};
    }
    if (old != nullptr)
        old->releaseResources();
}

void PluginBench::showEditor (Slot& target, bool open)
{
    if (target.plugin == nullptr)
        return;
    if (! open)
    {
        target.window.reset();
        return;
    }
    if (target.window == nullptr)
        target.window = std::make_unique<EditorWindow> (*target.plugin, target.plugin->getName(), [this, &target] {
            juce::MessageManager::callAsync ([this, &target] {
                target.window.reset();
                changed();
            });
        });
    target.window->show();
}

juce::Result PluginBench::saveState (Slot& target, const juce::File& file)
{
    juce::MemoryBlock state;
    target.plugin->getStateInformation (state);
    return file.replaceWithData (state.getData(), state.getSize()) ? juce::Result::ok() : juce::Result::fail ("Couldn't write the plugin's state.");
}

juce::Result PluginBench::restoreState (Slot& target, const juce::File& file)
{
    juce::MemoryBlock state;
    if (! file.loadFileAsData (state))
        return juce::Result::fail ("There's no saved state to restore.");
    target.plugin->setStateInformation (state.getData(), (int) state.getSize());
    return juce::Result::ok();
}

void PluginBench::note (const juce::MidiMessage& message, bool offline)
{
    if (offline)
        offlineNotes.addEvent (message, 0);
    else
        midi.addMessageToQueue (message);
}

void PluginBench::processInstrument (int numSamples, bool offline)
{
    blockNotes.clear();
    if (offline)
        blockNotes.swapWith (offlineNotes);
    else
        midi.removeNextBlockOfMessages (blockNotes, numSamples);

    for (int ch = 0; ch < scratch.getNumChannels(); ++ch)
        scratch.clear (ch, 0, numSamples);
    if (instrument.plugin == nullptr)
        return;
    juce::AudioBuffer<float> view (scratch.getArrayOfWritePointers(), juce::jmax (2, channelsNeeded (instrument.plugin.get())), numSamples);
    instrument.plugin->processBlock (view, blockNotes);
}

void PluginBench::processEffect (int numSamples)
{
    if (effect.plugin == nullptr)
        return;
    // Only the stereo pair goes on: whatever else the instrument wrote isn't the effect's input.
    for (int ch = 2; ch < scratch.getNumChannels(); ++ch)
        scratch.clear (ch, 0, numSamples);
    noNotes.clear();
    juce::AudioBuffer<float> view (scratch.getArrayOfWritePointers(), juce::jmax (2, channelsNeeded (effect.plugin.get())), numSamples);
    effect.plugin->processBlock (view, noNotes);
}

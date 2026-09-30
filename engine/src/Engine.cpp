#include "Engine.h"

#include "Protocol.h"

namespace
{
constexpr double fallbackSampleRate = 44100.0;
constexpr int fallbackBlockSize = 512;
constexpr double toneHz = 440.0;
constexpr float toneGain = 0.15f;
constexpr double offlineSampleRate = 48000.0;
constexpr int offlineBlockSize = 512;

/** A plugin's own window: its editor, or a row per parameter for plugins without one. */
class EditorWindow final : public juce::DocumentWindow
{
public:
    EditorWindow (juce::AudioPluginInstance& plugin, std::function<void()> onCloseButton)
        : DocumentWindow (plugin.getName(), juce::Colours::black, DocumentWindow::closeButton | DocumentWindow::minimiseButton),
          onClose (std::move (onCloseButton))
    {
        juce::AudioProcessorEditor* editor = plugin.hasEditor() ? plugin.createEditorIfNeeded() : nullptr;
        if (editor == nullptr)
            editor = new juce::GenericAudioProcessorEditor (plugin);
        setUsingNativeTitleBar (true);
        setContentOwned (editor, true);
        setResizable (editor->isResizable(), false);
        centreWithSize (getWidth(), getHeight());
        setVisible (true);
    }

    ~EditorWindow() override { clearContentComponent(); }

    void closeButtonPressed() override { onClose(); }

private:
    std::function<void()> onClose;
};

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

juce::Result fail (const juce::String& message) { return juce::Result::fail (message); }
}

juce::var Engine::Slot::describe() const
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

Engine::Engine (const juce::File& dataDir, const juce::StringArray& pluginPaths, bool isOffline, bool onlyPluginPaths)
    : knownFile (dataDir.getChildFile ("plugins.xml")),
      pedalFile (dataDir.getChildFile ("scan-crashed.txt")),
      extraPaths (pluginPaths),
      offline (isOffline),
      onlyExtraPaths (onlyPluginPaths)
{
    dataDir.createDirectory();
    formats.addDefaultFormats();
    if (auto xml = juce::parseXML (knownFile))
        known.recreateFromXml (*xml);

    if (offline)
    {
        start (offlineSampleRate, offlineBlockSize);
        return;
    }

    // Output only for now: opening inputs asks for the microphone, which recording will need.
    const auto error = devices.initialise (0, 2, nullptr, true);
    if (error.isNotEmpty())
        juce::Logger::writeToLog ("audio device: " + error);
    devices.addAudioCallback (this);
}

Engine::~Engine()
{
    stopTimer();
    if (! offline)
    {
        devices.removeAudioCallback (this);
        devices.closeAudioDevice();
    }
    unload (instrument);
    unload (effect);
}

juce::var Engine::status() const
{
    auto* device = devices.getCurrentAudioDevice();
    const auto rate = device != nullptr ? device->getCurrentSampleRate() : sampleRate;
    juce::var scanning;
    if (! scanners.isEmpty())
    {
        const auto current = scannerIndex < scanners.size() ? scanners[scannerIndex]->getProgress() : 0.0f;
        scanning = protocol::object ({ { "progress", ((float) scannerIndex + current) / (float) scanners.size() }, { "name", scanningName } });
    }
    return protocol::object ({
        { "device", device != nullptr ? juce::var (device->getName()) : juce::var() },
        { "offline", offline },
        { "sampleRate", rate },
        { "bufferSize", device != nullptr ? device->getCurrentBufferSizeSamples() : blockSize },
        { "cpu", devices.getCpuUsage() },
        { "dropouts", juce::jmax (0, devices.getXRunCount()) },
        { "outputLatencyMs", device != nullptr && rate > 0 ? 1000.0 * (device->getOutputLatencyInSamples() + device->getCurrentBufferSizeSamples()) / rate : 0.0 },
        { "tone", tone.load() },
        { "peak", peak.exchange (0.0f) },
        { "scanning", scanning },
        { "pluginCount", known.getNumTypes() },
        { "instrument", instrument.describe() },
        { "effect", effect.describe() },
    });
}

juce::var Engine::plugins() const
{
    juce::Array<juce::var> list;
    for (const auto& type : known.getTypes())
        list.add (describePlugin (type));
    return list;
}

Engine::Slot* Engine::slotNamed (const juce::var& params, Reply& reply)
{
    const auto name = params["slot"].toString();
    if (name == "instrument")
        return &instrument;
    if (name == "effect")
        return &effect;
    reply (fail ("\"slot\" must be \"instrument\" or \"effect\"."), {});
    return nullptr;
}

void Engine::handle (const juce::String& command, const juce::var& params, Reply reply)
{
    const auto ok = [&] { reply (juce::Result::ok(), status()); };

    if (command == "status" || command == "ping")
        return ok();

    if (command == "tone")
    {
        tone = (bool) params["on"];
        return ok();
    }

    if (command == "scan")
    {
        if (scanners.isEmpty())
            startScan ((bool) params["rescan"]);
        return ok();
    }

    if (command == "plugins")
        return reply (juce::Result::ok(), plugins());

    if (command == "note")
    {
        const auto pitch = juce::jlimit (0, 127, (int) params["pitch"]);
        const auto velocity = juce::jlimit (0.0f, 1.0f, (float) (double) params["velocity"]);
        auto message = (bool) params["on"] ? juce::MidiMessage::noteOn (1, pitch, velocity) : juce::MidiMessage::noteOff (1, pitch);
        message.setTimeStamp (juce::Time::getMillisecondCounterHiRes() * 0.001);
        if (offline)
            offlineNotes.addEvent (message, 0);
        else if (sampleRate > 0)
            midi.addMessageToQueue (message);
        return ok();
    }

    if (command == "render")
    {
        if (! offline)
            return reply (fail ("Only an offline engine renders."), {});
        const auto file = params["file"].toString();
        return render ((int) params["frames"], file.isEmpty() ? juce::File() : juce::File (file), std::move (reply));
    }

    auto* slot = slotNamed (params, reply);
    if (slot == nullptr)
        return;

    if (command == "load")
        return load (*slot, params["pluginId"].toString(), std::move (reply));

    if (command == "unload")
    {
        unload (*slot);
        return ok();
    }

    if (slot->plugin == nullptr)
        return reply (fail ("No plugin is loaded there."), {});

    if (command == "editor")
    {
        if (! (bool) params["open"])
            slot->window.reset();
        else if (slot->window == nullptr)
            slot->window = std::make_unique<EditorWindow> (*slot->plugin, [this, slot] {
                juce::MessageManager::callAsync ([this, slot] {
                    slot->window.reset();
                    protocol::send (protocol::object ({ { "event", "status" }, { "status", status() } }));
                });
            });
        if (slot->window != nullptr)
        {
            // The engine has no Dock icon, so nothing else would bring its windows forward.
            juce::Process::makeForegroundProcess();
            slot->window->toFront (true);
        }
        return ok();
    }

    const juce::File file (params["file"].toString());

    if (command == "saveState")
    {
        juce::MemoryBlock state;
        slot->plugin->getStateInformation (state);
        if (! file.replaceWithData (state.getData(), state.getSize()))
            return reply (fail ("Couldn't write the plugin's state."), {});
        return ok();
    }

    if (command == "restoreState")
    {
        juce::MemoryBlock state;
        if (! file.loadFileAsData (state))
            return reply (fail ("There's no saved state to restore."), {});
        slot->plugin->setStateInformation (state.getData(), (int) state.getSize());
        return ok();
    }

    reply (fail ("Unknown command \"" + command + "\"."), {});
}

void Engine::startScan (bool rescan)
{
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

void Engine::timerCallback()
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
    protocol::send (protocol::object ({ { "event", "status" }, { "status", status() } }));
}

void Engine::prepare (juce::AudioPluginInstance& plugin) const
{
    // Stereo in and out on the main buses and nothing else (no sidechains, no extra outputs) for now.
    auto layout = plugin.getBusesLayout();
    for (auto* buses : { &layout.inputBuses, &layout.outputBuses })
        for (int i = 0; i < buses->size(); ++i)
            buses->getReference (i) = i == 0 ? juce::AudioChannelSet::stereo() : juce::AudioChannelSet::disabled();
    plugin.setBusesLayout (layout);

    const auto rate = sampleRate > 0 ? sampleRate : fallbackSampleRate;
    const auto block = blockSize > 0 ? blockSize : fallbackBlockSize;
    plugin.setRateAndBufferSizeDetails (rate, block);
    plugin.prepareToPlay (rate, block);
}

void Engine::sizeScratch()
{
    const auto channels = juce::jmax (2, channelsNeeded (instrument.plugin.get()), channelsNeeded (effect.plugin.get()));
    scratch.setSize (channels, juce::jmax (4096, blockSize * 2), false, false, true);
}

void Engine::load (Slot& slot, const juce::String& pluginId, Reply reply)
{
    const auto description = known.getTypeForIdentifierString (pluginId);
    if (description == nullptr)
        return reply (fail ("That plugin isn't in the list: scan for plugins first."), {});

    formats.createPluginInstanceAsync (*description,
                                       sampleRate > 0 ? sampleRate : fallbackSampleRate,
                                       blockSize > 0 ? blockSize : fallbackBlockSize,
                                       [this, &slot, pluginId, done = std::move (reply)] (std::unique_ptr<juce::AudioPluginInstance> created, const juce::String& error) {
                                           if (created == nullptr)
                                               return done (fail (error.isNotEmpty() ? error : "The plugin couldn't be loaded."), {});
                                           prepare (*created);
                                           unload (slot);
                                           {
                                               const juce::ScopedLock lock (audioLock);
                                               slot.plugin = std::move (created);
                                               slot.id = pluginId;
                                               sizeScratch();
                                           }
                                           done (juce::Result::ok(), status());
                                       });
}

void Engine::unload (Slot& slot)
{
    slot.window.reset();
    std::unique_ptr<juce::AudioPluginInstance> old;
    {
        const juce::ScopedLock lock (audioLock);
        old = std::move (slot.plugin);
        slot.id = {};
    }
    if (old != nullptr)
        old->releaseResources();
}

void Engine::audioDeviceAboutToStart (juce::AudioIODevice* device)
{
    start (device->getCurrentSampleRate(), device->getCurrentBufferSizeSamples());
}

void Engine::start (double rate, int block)
{
    const juce::ScopedLock lock (audioLock);
    sampleRate = rate;
    blockSize = block;
    midi.reset (sampleRate);
    for (auto* slot : { &instrument, &effect })
        if (slot->plugin != nullptr)
        {
            slot->plugin->releaseResources();
            prepare (*slot->plugin);
        }
    sizeScratch();
}

void Engine::render (int frames, const juce::File& file, Reply reply)
{
    frames = juce::jlimit (0, (int) offlineSampleRate * 600, frames);
    juce::AudioBuffer<float> rendered (2, frames);
    for (int done = 0; done < frames; done += blockSize)
    {
        float* channels[] = { rendered.getWritePointer (0, done), rendered.getWritePointer (1, done) };
        process (channels, 2, juce::jmin (blockSize, frames - done));
    }

    if (file != juce::File())
    {
        file.deleteFile();
        std::unique_ptr<juce::OutputStream> stream = std::make_unique<juce::FileOutputStream> (file);
        const auto options = juce::AudioFormatWriterOptions().withSampleRate (sampleRate).withNumChannels (2).withBitsPerSample (24);
        auto writer = juce::WavAudioFormat().createWriterFor (stream, options);
        if (writer == nullptr || ! writer->writeFromAudioSampleBuffer (rendered, 0, frames))
            return reply (fail ("Couldn't write the rendered sound."), {});
    }
    reply (juce::Result::ok(),
           protocol::object ({ { "frames", frames },
                               { "sampleRate", sampleRate },
                               { "peak", frames > 0 ? rendered.getMagnitude (0, frames) : 0.0f },
                               { "rms", frames > 0 ? rendered.getRMSLevel (0, 0, frames) : 0.0f } }));
}

void Engine::audioDeviceStopped() {}

void Engine::audioDeviceIOCallbackWithContext (const float* const*, int, float* const* output, int numOutputs, int numSamples,
                                               const juce::AudioIODeviceCallbackContext&)
{
    process (output, numOutputs, numSamples);
}

void Engine::process (float* const* output, int numOutputs, int numSamples)
{
    juce::ScopedNoDenormals noDenormals;
    for (int ch = 0; ch < numOutputs; ++ch)
        if (output[ch] != nullptr)
            juce::FloatVectorOperations::clear (output[ch], numSamples);

    // Never wait here: a plugin being swapped costs one silent block.
    const juce::ScopedTryLock lock (audioLock);
    if (! lock.isLocked() || numSamples > scratch.getNumSamples())
        return;

    juce::MidiBuffer notes;
    if (offline)
        notes.swapWith (offlineNotes);
    else
        midi.removeNextBlockOfMessages (notes, numSamples);

    const auto view = [&] (const juce::AudioPluginInstance& plugin) {
        return juce::AudioBuffer<float> (scratch.getArrayOfWritePointers(), juce::jmax (2, channelsNeeded (&plugin)), numSamples);
    };
    for (int ch = 0; ch < scratch.getNumChannels(); ++ch)
        scratch.clear (ch, 0, numSamples);

    if (instrument.plugin != nullptr)
    {
        auto buffer = view (*instrument.plugin);
        instrument.plugin->processBlock (buffer, notes);
    }

    if (tone.load())
    {
        const auto step = toneHz / sampleRate;
        for (int i = 0; i < numSamples; ++i)
        {
            const auto sample = toneGain * (float) std::sin (tonePhase * juce::MathConstants<double>::twoPi);
            scratch.addSample (0, i, sample);
            scratch.addSample (1, i, sample);
            tonePhase += step;
            tonePhase -= std::floor (tonePhase);
        }
    }

    if (effect.plugin != nullptr)
    {
        // Only the stereo pair goes on: whatever else the instrument wrote isn't the effect's input.
        for (int ch = 2; ch < scratch.getNumChannels(); ++ch)
            scratch.clear (ch, 0, numSamples);
        juce::MidiBuffer none;
        auto buffer = view (*effect.plugin);
        effect.plugin->processBlock (buffer, none);
    }

    auto loudest = peak.load();
    for (int ch = 0; ch < juce::jmin (2, numOutputs); ++ch)
        if (output[ch] != nullptr)
        {
            juce::FloatVectorOperations::copy (output[ch], scratch.getReadPointer (ch), numSamples);
            loudest = juce::jmax (loudest, scratch.getMagnitude (ch, 0, numSamples));
        }
    peak = loudest;
}

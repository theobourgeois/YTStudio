#include "Engine.h"

#include "Protocol.h"

namespace
{
constexpr double toneHz = 440.0;
constexpr float toneGain = 0.15f;
constexpr double offlineSampleRate = 48000.0;
constexpr int offlineBlockSize = 512;
/** A buffer small enough to play along to, where the device allows it. */
constexpr int preferredBlockSize = 256;
/** How often the server hears where the song is (it fills in between). */
constexpr int transportIntervalMs = 40;
/** How much of its level the meter keeps per block, so a hit is seen even between two readings. */
constexpr float meterFall = 0.85f;
/** Quieter than this is silence, to a meter (-66 dB). */
constexpr float meterFloor = 0.0005f;
/** What the export asks of the plugins at a time: big blocks cost less per sample than a device's. */
constexpr int exportBlockSize = 2048;
/** How long an export waits for the song's plugins to load, in tenths of a second. */
constexpr int exportWaits = 600;

juce::Result fail (const juce::String& message) { return juce::Result::fail (message); }
}

Engine::Engine (const juce::File& dataDir, const juce::StringArray& pluginPaths, bool isOffline, bool onlyPluginPaths)
    : offline (isOffline),
      deviceFile (dataDir.getChildFile ("device.xml")),
      bench (dataDir, pluginPaths, onlyPluginPaths, [this] {
          // A scan has ended (or a bench window closed): a plugin the song was missing may be there now.
          plugins.forgetFailures();
          effects.forgetFailures();
          if (! lastSong.isVoid())
              applySong();
          sendStatus();
      }),
      plugins (bench.formatManager(), bench.knownPlugins(), "channel", [this] { pluginChanged(); }),
      effects (bench.formatManager(), bench.knownPlugins(), "effect", [this] { pluginChanged(); }),
      sequencer (isOffline),
      preview (isOffline)
{
    dataDir.createDirectory();
    // The sinc's table, made now rather than by the audio thread the first time it's needed.
    resampling::Kernel::get();
    if (offline)
    {
        start (offlineSampleRate, offlineBlockSize);
        return;
    }

    // Outputs only, unless an input was chosen (recording): opening one asks for the microphone, so
    // it's only opened once someone has chosen it (`setDevice`), and again at start from what's saved.
    const auto saved = juce::parseXML (deviceFile);
    const auto error = devices.initialise (0, 2, saved.get(), true);
    if (error.isNotEmpty())
        juce::Logger::writeToLog ("audio device: " + error);
    if (saved == nullptr)
    {
        auto setup = devices.getAudioDeviceSetup();
        setup.bufferSize = preferredBlockSize;
        devices.setAudioDeviceSetup (setup, true);
    }
    devices.addAudioCallback (this);
    startTimer (transportIntervalMs);
}

Engine::~Engine()
{
    *alive = false;
    exportTicker.stopTimer();
    exportJob.reset();
    stopTimer();
    // Nothing plays any more, and automation gives the plugins their own values back before they're saved.
    if (! offline)
    {
        devices.removeAudioCallback (this);
        devices.closeAudioDevice();
    }
    sequencer.release();
    plugins.saveStates();
    effects.saveStates();
}

juce::var Engine::transport() const
{
    return protocol::object ({ { "playing", sequencer.isPlaying() },
                               { "tick", sequencer.position() },
                               { "countIn", sequencer.countInSeconds() },
                               { "metronome", sequencer.metronomeOn() },
                               { "preview", preview.describe() },
                               { "grossBeats", grossBeats.describe() },
                               { "autoTunes", autoTunes.describe() },
                               { "echoBoys", echoBoys.describe() },
                               { "panMen", panMen.describe() } });
}

juce::var Engine::status() const
{
    auto* device = devices.getCurrentAudioDevice();
    const auto rate = device != nullptr ? device->getCurrentSampleRate() : sampleRate;
    return protocol::object ({
        { "device", device != nullptr ? juce::var (device->getName()) : juce::var() },
        { "offline", offline },
        { "sampleRate", rate },
        { "bufferSize", device != nullptr ? device->getCurrentBufferSizeSamples() : blockSize },
        { "cpu", devices.getCpuUsage() },
        { "dropouts", juce::jmax (0, devices.getXRunCount()) },
        { "outputLatencyMs", rate > 0 ? 1000.0 * ((device != nullptr ? device->getOutputLatencyInSamples() + device->getCurrentBufferSizeSamples() : 0) + songLatency) / rate : 0.0 },
        { "input", device != nullptr && devices.getAudioDeviceSetup().inputDeviceName.isNotEmpty() ? juce::var (devices.getAudioDeviceSetup().inputDeviceName) : juce::var() },
        { "inputChannels", device != nullptr ? device->getActiveInputChannels().countNumberOfSetBits() : (offline ? testInput.getNumChannels() : 0) },
        { "inputLatencyMs", device != nullptr && rate > 0 ? 1000.0 * device->getInputLatencyInSamples() / rate : 0.0 },
        { "recording", sequencer.recorder().recording().isNotEmpty() ? protocol::object ({ { "id", sequencer.recorder().recording() } }) : juce::var() },
        { "songLatency", songLatency },
        { "tone", tone.load() },
        { "peak", peak.load() },
        { "transport", transport() },
        { "exporting", exportJob != nullptr ? protocol::object ({ { "id", exportId }, { "done", exportJob->written() }, { "frames", exportJob->length() } }) : juce::var() },
        { "channels", plugins.describe() },
        { "effects", effects.describe() },
        { "scanning", bench.scanning() },
        { "pluginCount", bench.pluginCount() },
        { "instrument", bench.instrument.describe() },
        { "effect", bench.effect.describe() },
    });
}

void Engine::sendStatus() const { protocol::send (protocol::object ({ { "event", "status" }, { "status", status() } })); }

juce::var Engine::deviceOptions() const
{
    juce::Array<juce::var> outputs, inputs, inputChannels, bufferSizes, sampleRates;
    if (auto* type = devices.getCurrentDeviceTypeObject())
    {
        for (const auto& name : type->getDeviceNames (false))
            outputs.add (name);
        for (const auto& name : type->getDeviceNames (true))
            inputs.add (name);
    }
    auto* device = devices.getCurrentAudioDevice();
    const auto input = devices.getAudioDeviceSetup().inputDeviceName;
    if (device != nullptr)
    {
        for (const auto size : device->getAvailableBufferSizes())
            bufferSizes.add (size);
        for (const auto rate : device->getAvailableSampleRates())
            sampleRates.add (rate);
        if (input.isNotEmpty())
            for (const auto& name : device->getInputChannelNames())
                inputChannels.add (name);
    }
    return protocol::object ({ { "outputs", outputs },
                               { "output", device != nullptr ? juce::var (devices.getAudioDeviceSetup().outputDeviceName) : juce::var() },
                               { "inputs", inputs },
                               { "input", input.isNotEmpty() ? juce::var (input) : juce::var() },
                               { "inputChannels", inputChannels },
                               { "bufferSizes", bufferSizes },
                               { "sampleRates", sampleRates },
                               { "status", status() } });
}

juce::Result Engine::setDevice (const juce::var& params)
{
    if (offline)
        return fail ("An offline engine has no device.");
    auto setup = devices.getAudioDeviceSetup();
    if (params["output"].isString())
        setup.outputDeviceName = params["output"].toString();
    if (params["input"].isString())
    {
        // All its channels (the device opens those it has): a track picks which it takes.
        setup.inputDeviceName = params["input"].toString();
        setup.useDefaultInputChannels = false;
        setup.inputChannels.clear();
        if (setup.inputDeviceName.isNotEmpty())
            setup.inputChannels.setRange (0, maxInputs, true);
    }
    if (const auto size = (int) params["bufferSize"]; size > 0)
        setup.bufferSize = size;
    if (const auto rate = (double) params["sampleRate"]; rate > 0)
        setup.sampleRate = rate;
    const auto error = devices.setAudioDeviceSetup (setup, true);
    if (error.isNotEmpty())
        return fail (error);
    if (auto xml = devices.createStateXml())
        xml->writeTo (deviceFile);
    return juce::Result::ok();
}

void Engine::handle (const juce::String& command, const juce::var& params, Reply reply)
{
    const auto ok = [&] { reply (juce::Result::ok(), status()); };

    if (command == "status" || command == "ping")
        return ok();

    // While the song is exported, its plugins are the export's: nothing else may play them.
    static const juce::StringArray busy { "play", "record", "preview", "trigger", "previewFile", "render", "setDevice", "tone", "note", "load", "unload", "editor" };
    if (exportJob != nullptr && (busy.contains (command) || ((command == "channelEditor" || command == "effectEditor") && (bool) params["open"])))
        return reply (fail ("The song is being exported: wait for it to finish."), {});
    if (command == "export")
        return startExport (params, std::move (reply), 0);
    if (command == "abortExport")
    {
        if (exportJob != nullptr && params["exportId"].toString() == exportId)
            exportJob->abort();
        return ok();
    }

    // The song ---------------------------------------------------------------
    if (command == "song")
    {
        lastSong = params["song"];
        juce::Array<juce::var> ids;
        for (const auto& id : applySong())
            ids.add (id);
        return reply (juce::Result::ok(), protocol::object ({ { "unreadable", ids }, { "channels", plugins.describe() }, { "effects", effects.describe() } }));
    }
    if (command == "channelEditor")
    {
        if (! plugins.showEditor (params["channel"].toString(), (bool) params["open"]))
            return reply (fail ("That channel's plugin isn't loaded."), {});
        return ok();
    }
    if (command == "effectEditor")
    {
        if (! effects.showEditor (params["effect"].toString(), (bool) params["open"]))
            return reply (fail ("That effect's plugin isn't loaded."), {});
        return ok();
    }
    if (command == "grossBeat")
    {
        // A Gross Beat's live controls: HOLD, and the scratching clock.
        const auto state = grossBeats.find (params["effect"].toString());
        if (state == nullptr)
            return reply (fail ("The song playing has no such Gross Beat."), {});
        if (params.hasProperty ("hold"))
            state->hold = (bool) params["hold"];
        if (params.hasProperty ("scratch"))
            state->scratch = (float) juce::jlimit (-64.0, 0.0, (double) params["scratch"]);
        return ok();
    }
    if (command == "panMan")
    {
        // A PanMan's Manual Trigger.
        const auto state = panMen.find (params["effect"].toString());
        if (state == nullptr)
            return reply (fail ("The song playing has no such PanMan."), {});
        if ((bool) params["trigger"])
            state->manualTrigger = true;
        return ok();
    }
    if (command == "parameters")
    {
        // A plugin channel's (or an effect's) parameters that can be automated.
        const auto owner = params["owner"].toString();
        const auto list = (owner == "effect" ? effects : plugins).parameters (params["ownerId"].toString());
        if (! list.isArray())
            return reply (fail ("That plugin isn't loaded (yet): its parameters can't be listed."), {});
        return reply (juce::Result::ok(), protocol::object ({ { "parameters", list } }));
    }
    if (command == "meterTracks")
    {
        juce::StringArray ids;
        if (const auto* list = params["tracks"].getArray())
            for (const auto& id : *list)
                ids.add (id.toString());
        sequencer.setMeteredTracks (ids);
        return ok();
    }
    if (command == "host")
    {
        plugins.setHost (params);
        effects.setHost (params);
        return ok();
    }
    if (command == "saveStates")
    {
        plugins.saveStates();
        effects.saveStates();
        return ok();
    }
    if (command == "play" || command == "stop")
    {
        if (command == "play")
            sequencer.play ((double) params["from"]);
        else
        {
            // A recording still in its count-in never began.
            sequencer.recorder().cancel();
            sequencer.stop();
        }
        return ok();
    }
    if (command == "record")
    {
        const auto result = record (params);
        return result.wasOk() ? ok() : reply (result, {});
    }
    if (command == "preview")
    {
        if (! sequencer.preview (params["channel"].toString(), juce::jlimit (0, 127, (int) params["key"]), (float) (double) params["velocity"], (bool) params["on"]))
            return reply (fail ("The song playing has no such channel."), {});
        return ok();
    }
    if (command == "previewFile")
    {
        // A channel's own preview carries its gains and speed; the Browser's don't.
        const auto channel = params.hasProperty ("gainLeft");
        const auto result = preview.play (juce::File (params["file"].toString()), (double) params["start"], params["previewId"].toString(),
                                          channel ? (float) (double) params["gainLeft"] : 1.0f, channel ? (float) (double) params["gainRight"] : 1.0f,
                                          params.hasProperty ("speed") ? (double) params["speed"] : 1.0, ! channel);
        return result.wasOk() ? ok() : reply (result, {});
    }
    if (command == "stopPreview")
    {
        preview.stop();
        return ok();
    }
    if (command == "previewVolume")
    {
        preview.setVolume ((float) (double) params["volume"]);
        return ok();
    }
    if (command == "metronome")
    {
        if (params.hasProperty ("sound"))
            sequencer.setMetronomeSound (params["sound"].toString());
        sequencer.setMetronome ((bool) params["on"]);
        if ((bool) params["audition"])
            sequencer.auditionClick();
        return ok();
    }
    if (command == "trigger")
    {
        if (! sequencer.trigger (params["channel"].toString(), (float) (double) params["pitch"], (float) (double) params["gain"]))
            return reply (fail ("The song playing has no such channel."), {});
        return ok();
    }

    // The device -------------------------------------------------------------
    if (command == "devices")
        return reply (juce::Result::ok(), deviceOptions());
    if (command == "setDevice")
    {
        const auto result = setDevice (params);
        return reply (result, result.wasOk() ? deviceOptions() : juce::var());
    }
    if (command == "render")
    {
        if (! offline)
            return reply (fail ("Only an offline engine renders."), {});
        const auto file = params["file"].toString();
        return render ((int) params["frames"], file.isEmpty() ? juce::File() : juce::File (file), params["input"].toString(), std::move (reply));
    }

    // The plugin bench -------------------------------------------------------
    if (command == "tone")
    {
        tone = (bool) params["on"];
        return ok();
    }
    if (command == "scan")
    {
        bench.startScan ((bool) params["rescan"]);
        return ok();
    }
    if (command == "plugins")
        return reply (juce::Result::ok(), bench.plugins());
    if (command == "note")
    {
        const auto pitch = juce::jlimit (0, 127, (int) params["pitch"]);
        const auto velocity = juce::jlimit (0.0f, 1.0f, (float) (double) params["velocity"]);
        auto message = (bool) params["on"] ? juce::MidiMessage::noteOn (1, pitch, velocity) : juce::MidiMessage::noteOff (1, pitch);
        message.setTimeStamp (juce::Time::getMillisecondCounterHiRes() * 0.001);
        bench.note (message, offline);
        return ok();
    }

    auto* slot = bench.slot (params["slot"].toString());
    if (slot == nullptr)
        return reply (fail (command == "load" || command == "unload" || command == "editor" || command == "saveState" || command == "restoreState"
                                ? juce::String ("\"slot\" must be \"instrument\" or \"effect\".")
                                : "Unknown command \"" + command + "\"."),
                      {});

    if (command == "load")
        return bench.load (*slot, params["pluginId"].toString(), [this, answer = std::move (reply)] (const juce::Result& result) {
            answer (result, result.wasOk() ? status() : juce::var());
        });
    if (command == "unload")
    {
        bench.unload (*slot);
        return ok();
    }
    if (slot->plugin == nullptr)
        return reply (fail ("No plugin is loaded there."), {});
    if (command == "editor")
    {
        bench.showEditor (*slot, (bool) params["open"]);
        return ok();
    }
    if (command == "saveState" || command == "restoreState")
    {
        const juce::File file (params["file"].toString());
        const auto result = command == "saveState" ? bench.saveState (*slot, file) : bench.restoreState (*slot, file);
        return reply (result, result.wasOk() ? status() : juce::var());
    }

    reply (fail ("Unknown command \"" + command + "\"."), {});
}

juce::StringArray Engine::applySong()
{
    juce::StringArray unreadable;
    // During an export the song waits: it's made when the export ends (its plugins are busy).
    if (exportJob != nullptr)
        return unreadable;
    auto song = Song::parse (lastSong, samples, plugins, effects, grossBeats, autoTunes, echoBoys, panMen, unreadable, mix.getNumSamples(), sampleRate > 0 ? sampleRate : offlineSampleRate);
    latencies = plugins.latencySignature() * 7 + effects.latencySignature();
    armed.clear();
    for (const auto& track : song->tracks)
        if (track.armed && ! track.input.empty())
            armed.push_back ({ track.id, track.input });
    const auto latency = song->latency;
    sequencer.setSong (std::move (song));
    // The playhead is shown late by the output's latency, which this is part of.
    if (latency != songLatency)
    {
        songLatency = latency;
        sendStatus();
    }
    return unreadable;
}

juce::Result Engine::record (const juce::var& params)
{
    const auto id = params["recordingId"].toString();
    const auto folder = params["folder"].toString();
    if (id.isEmpty() || ! juce::File::isAbsolutePath (folder))
        return fail ("A recording needs a \"recordingId\" and an absolute \"folder\".");
    if (sequencer.recorder().recording().isNotEmpty())
        return fail ("It's recording already: stop it first.");
    if (armed.empty())
        return fail ("No mixer track is armed with an input: choose a track's input in the Mixer, which arms it.");
    // What's heard comes out late by the output's latency and the song's plugin delay, and what's
    // played along to it reaches the engine late by the input's: the recording leaves that out.
    auto* device = devices.getCurrentAudioDevice();
    const auto latency = (juce::int64) songLatency + (device != nullptr ? device->getInputLatencyInSamples() + device->getOutputLatencyInSamples() : 0);
    const auto loop = (bool) params["loop"];
    const auto result = sequencer.recorder().start (id, juce::File (folder), armed, rate(), latency, loop);
    if (result.failed())
        return result;
    sequencer.record ((double) params["from"], juce::jmax (0.0, (double) params["countIn"]), loop);
    return juce::Result::ok();
}

void Engine::reportTakes()
{
    sequencer.recorder().service ([] (const Recorder::Take& take) {
        protocol::send (protocol::object ({ { "event", "take" },
                                            { "recordingId", take.recording },
                                            { "track", take.track },
                                            { "file", take.file.getFullPathName() },
                                            { "startTick", take.startTick },
                                            { "skip", (double) take.skip },
                                            { "frames", (double) take.frames },
                                            { "sampleRate", take.sampleRate },
                                            { "pass", take.pass },
                                            { "final", take.final },
                                            { "dropped", take.dropped } }));
    });
}

void Engine::checkLatencies()
{
    if (exportJob == nullptr && ! lastSong.isVoid() && plugins.latencySignature() * 7 + effects.latencySignature() != latencies)
        applySong();
}

void Engine::pluginChanged()
{
    // A plugin has loaded (or its window was closed): the song gets it, and the server is told.
    if (! lastSong.isVoid())
        applySong();
    sendStatus();
}

void Engine::timerCallback()
{
    sequencer.collectGarbage();
    sequencer.prepareClips();
    preview.collectGarbage();
    reportTakes();
    checkLatencies();
    // A parameter touched in a plugin's window: the tab can offer to automate it.
    plugins.reportTouches();
    effects.reportTouches();
    // Where the song is, while it plays, previews or anything sounds, and once more when that ends.
    const auto playing = sequencer.isPlaying();
    const auto previewing = preview.isPlaying();
    const auto level = peak.load();
    const auto meters = sequencer.takeMeters (meterFloor);
    // A track can sound where the output doesn't (sending to nothing but a muted one): it's not quiet then.
    const auto quiet = level < meterFloor && meters.getDynamicObject()->getProperties().isEmpty();
    if (playing || previewing || ! quiet || playing != saidPlaying || quiet != saidQuiet || previewing != saidPreviewing)
        protocol::send (protocol::object ({ { "event", "transport" },
                                            { "playing", playing },
                                            { "tick", sequencer.position() },
                                            // Held while it counts in: the tab doesn't move the playhead on meanwhile.
                                            { "countIn", sequencer.countInSeconds() },
                                            // Recording: each track's input level since the last event, for the take drawn as it grows.
                                            { "recording", sequencer.recorder().recording().isNotEmpty()
                                                               ? protocol::object ({ { "id", sequencer.recorder().recording() }, { "levels", sequencer.recorder().levels() } })
                                                               : juce::var() },
                                            { "preview", preview.describe() },
                                            { "grossBeats", grossBeats.describe() },
                                            { "autoTunes", autoTunes.describe() },
                                            { "echoBoys", echoBoys.describe() },
                                            { "panMen", panMen.describe() },
                                            { "peak", level },
                                            { "meters", meters },
                                            { "cpu", devices.getCpuUsage() } }));
    saidPlaying = playing;
    saidQuiet = quiet;
    saidPreviewing = previewing;
}

void Engine::audioDeviceAboutToStart (juce::AudioIODevice* device)
{
    // The callback's inputs are the open ones, in order: which of the device's channels each is.
    inputMap.clear();
    const auto open = device->getActiveInputChannels();
    for (int channel = 0; channel <= open.getHighestBit() && channel < maxInputs; ++channel)
        if (open[channel])
            inputMap.push_back (channel);
    start (device->getCurrentSampleRate(), device->getCurrentBufferSizeSamples());
}

void Engine::audioDeviceStopped() {}

void Engine::start (double rate, int block)
{
    sampleRate = rate;
    blockSize = block;
    const auto longer = juce::jmax (4096, block * 2) > mix.getNumSamples();
    mix.setSize (2, juce::jmax (4096, block * 2), false, false, true);
    sequencer.prepare (rate);
    preview.prepare (rate);
    plugins.prepare (rate, block);
    effects.prepare (rate, block);
    bench.prepare (rate, block);
    // The song's mixer buffers are as long as `mix`: longer blocks need a song with longer ones.
    if (longer && ! lastSong.isVoid())
        juce::MessageManager::callAsync ([this] { applySong(); });
}

void Engine::render (int frames, const juce::File& file, const juce::String& input, Reply reply)
{
    frames = juce::jlimit (0, (int) offlineSampleRate * 600, frames);
    if (input == "none")
        testInput.setSize (0, 0);
    else if (input.isNotEmpty())
    {
        juce::AudioFormatManager formats;
        formats.registerBasicFormats();
        std::unique_ptr<juce::AudioFormatReader> reader (formats.createReaderFor (juce::File (input)));
        if (reader == nullptr)
            return reply (fail ("Couldn't read the input " + input), {});
        testInput.setSize ((int) reader->numChannels, (int) reader->lengthInSamples);
        reader->read (&testInput, 0, (int) reader->lengthInSamples, 0, true, true);
        testInputPosition = 0;
    }
    checkLatencies();
    juce::AudioBuffer<float> rendered (2, frames);
    for (int done = 0; done < frames; done += blockSize)
    {
        // What the timer does live: the audio clips about to play are made ready (decoded here, offline),
        // and a recording's next files.
        sequencer.prepareClips();
        sequencer.collectGarbage();
        reportTakes();
        const auto block = juce::jmin (blockSize, frames - done);
        float* channels[] = { rendered.getWritePointer (0, done), rendered.getWritePointer (1, done) };
        // The stand-in input, while it lasts (silence after).
        std::array<const float*, maxInputs> inputs {};
        const auto left = testInput.getNumSamples() - testInputPosition;
        if (testInput.getNumChannels() > 0 && left >= block)
            for (int ch = 0; ch < juce::jmin (maxInputs, testInput.getNumChannels()); ++ch)
                inputs[(size_t) ch] = testInput.getReadPointer (ch, testInputPosition);
        testInputPosition += block;
        process (channels, 2, block, inputs.data(), testInput.getNumChannels() > 0 && left >= block ? testInput.getNumChannels() : 0);
    }
    sequencer.collectGarbage();
    preview.collectGarbage();
    reportTakes();

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
                               { "rms", frames > 0 ? rendered.getRMSLevel (0, 0, frames) : 0.0f },
                               { "meters", sequencer.takeMeters (meterFloor) },
                               // A recording's peaks since the last render (or event), as its transport events carry them live.
                               { "levels", sequencer.recorder().levels() },
                               { "transport", transport() } }));
}

void Engine::audioDeviceIOCallbackWithContext (const float* const* input, int numInputs, float* const* output, int numOutputs, int numSamples,
                                               const juce::AudioIODeviceCallbackContext&)
{
    // The open inputs, by the device's channel numbers.
    std::array<const float*, maxInputs> inputs {};
    auto count = 0;
    for (int i = 0; i < numInputs && i < (int) inputMap.size(); ++i)
    {
        inputs[(size_t) inputMap[(size_t) i]] = input[i];
        count = inputMap[(size_t) i] + 1;
    }
    process (output, numOutputs, numSamples, inputs.data(), count);
}

void Engine::process (float* const* output, int numOutputs, int numSamples, const float* const* inputs, int numInputs)
{
    juce::ScopedNoDenormals noDenormals;
    for (int ch = 0; ch < numOutputs; ++ch)
        if (output[ch] != nullptr)
            juce::FloatVectorOperations::clear (output[ch], numSamples);
    if (numSamples > mix.getNumSamples())
        return;

    // The song and the tone: always, whatever the bench is doing.
    mix.clear (0, numSamples);
    auto* left = mix.getWritePointer (0);
    auto* right = mix.getWritePointer (1);
    sequencer.process (left, right, numSamples, inputs, numInputs);
    preview.process (left, right, numSamples);
    if (tone.load())
    {
        const auto step = toneHz / sampleRate;
        for (int i = 0; i < numSamples; ++i)
        {
            const auto sample = toneGain * (float) std::sin (tonePhase * juce::MathConstants<double>::twoPi);
            left[i] += sample;
            right[i] += sample;
            tonePhase += step;
            tonePhase -= std::floor (tonePhase);
        }
    }

    // The bench's instrument joins them, and its effect takes it all. Never wait for it: while a
    // plugin is being swapped, a block goes out without them.
    const float* result[] = { left, right };
    if (const juce::ScopedTryLock lock (bench.lock); lock.isLocked() && numSamples <= bench.buffer().getNumSamples())
    {
        auto& buffer = bench.buffer();
        bench.processInstrument (numSamples, offline);
        buffer.addFrom (0, 0, left, numSamples);
        buffer.addFrom (1, 0, right, numSamples);
        bench.processEffect (numSamples);
        result[0] = buffer.getReadPointer (0);
        result[1] = buffer.getReadPointer (1);
        auto loudest = peak.load() * meterFall;
        for (int ch = 0; ch < juce::jmin (2, numOutputs); ++ch)
            if (output[ch] != nullptr)
            {
                juce::FloatVectorOperations::copy (output[ch], result[ch], numSamples);
                loudest = juce::jmax (loudest, buffer.getMagnitude (ch, 0, numSamples));
            }
        peak = loudest;
        return;
    }

    auto loudest = peak.load() * meterFall;
    for (int ch = 0; ch < juce::jmin (2, numOutputs); ++ch)
        if (output[ch] != nullptr)
        {
            juce::FloatVectorOperations::copy (output[ch], result[ch], numSamples);
            loudest = juce::jmax (loudest, mix.getMagnitude (ch, 0, numSamples));
        }
    peak = loudest;
}

double Engine::rate() const { return sampleRate > 0 ? sampleRate : offlineSampleRate; }

void Engine::startExport (const juce::var& params, Reply reply, int attempt)
{
    if (exportJob != nullptr)
        return reply (fail ("A song is being exported already."), {});
    // (`id` is the command's own, for its reply.)
    const auto id = params["exportId"].toString();
    const auto path = params["folder"].toString();
    if (id.isEmpty() || ! juce::File::isAbsolutePath (path))
        return reply (fail ("An export needs an \"exportId\" and an absolute \"folder\"."), {});

    // Its plugins are the song's own instances. One still loading is waited for, or it'd be missing.
    juce::StringArray unreadable;
    // Gross Beats and EchoBoys of its own: they start empty, and playback's are left as they are.
    gross::Registry exportGrossBeats;
    tune::Registry exportAutoTunes;
    echo::Registry exportEchoBoys;
    panman::Registry exportPanMen;
    auto song = Song::parse (params["song"], samples, plugins, effects, exportGrossBeats, exportAutoTunes, exportEchoBoys, exportPanMen, unreadable, exportBlockSize, rate(), false);
    if ((plugins.anyLoading() || effects.anyLoading()) && attempt < exportWaits)
    {
        juce::Timer::callAfterDelay (100, [this, stillAlive = alive, params, reply, attempt] {
            if (*stillAlive)
                startExport (params, reply, attempt + 1);
        });
        return;
    }
    // What won't be heard: channels whose plugin or sample couldn't be had, and effects likewise.
    juce::StringArray missing (unreadable);
    for (const auto& channel : song->channels)
        if (channel.isPlugin && channel.plugin == nullptr)
            missing.add (channel.id);
    for (const auto& track : song->tracks)
        for (const auto& effect : track.effects)
            if (effect.plugin == nullptr && effect.gross == nullptr && effect.tune == nullptr && effect.echo == nullptr && effect.pan == nullptr)
                missing.add (effect.id);

    // Playback stops and lets go of the plugins; they're prepared for the export.
    sequencer.stop();
    preview.stop();
    tone = false;
    if (! offline)
        devices.removeAudioCallback (this);
    // Nothing plays the live song now (its stop won't be seen until it does): its automation lets go of
    // the plugins at once, so the export starts from their own values.
    sequencer.release();
    for (auto* host : { &plugins, &effects })
    {
        host->setExporting (true);
        host->prepare (rate(), exportBlockSize);
        host->reset();
    }

    SongExport::Settings settings;
    settings.folder = juce::File (path);
    settings.mix = ! params.hasProperty ("mix") || (bool) params["mix"];
    settings.stems = (bool) params["stems"];
    settings.ringOut = params["tail"].toString() == "ring";
    if (params.hasProperty ("maxTail"))
        settings.maxTailSeconds = juce::jlimit (0.0, 120.0, (double) params["maxTail"]);
    settings.sampleRate = rate();
    settings.blockSize = exportBlockSize;
    // Every core by default; `threads` asks for fewer (the benchmark compares).
    const auto cores = juce::jmax (1, juce::SystemStats::getNumCpus());
    settings.threads = params.hasProperty ("threads") ? juce::jlimit (1, cores, (int) params["threads"]) : cores;
    exportId = id;
    exportJob = std::make_unique<SongExport> (std::move (song), settings, [this, stillAlive = alive, id, missing] (const juce::var& result) {
        if (*stillAlive)
            finishExport (id, result, missing);
    });
    exportTicker.tick = [this] {
        if (exportJob != nullptr)
            protocol::send (protocol::object ({ { "event", "export" }, { "id", exportId }, { "state", "rendering" }, { "done", exportJob->written() }, { "frames", exportJob->length() } }));
    };
    exportTicker.startTimer (100);
    exportJob->start();
    reply (juce::Result::ok(), status());
}

void Engine::finishExport (const juce::String& id, juce::var result, const juce::StringArray& missing)
{
    exportTicker.stopTimer();
    exportJob.reset();
    exportId = {};
    // The plugins are playback's again, as they were, and the song sent meanwhile is played.
    for (auto* host : { &plugins, &effects })
    {
        host->setExporting (false);
        host->prepare (rate(), blockSize);
        host->reset();
    }
    if (! offline)
        devices.addAudioCallback (this);
    if (! lastSong.isVoid())
        applySong();

    if (auto* object = result.getDynamicObject())
    {
        object->setProperty ("event", "export");
        object->setProperty ("id", id);
        juce::Array<juce::var> ids;
        for (const auto& each : missing)
            ids.add (each);
        object->setProperty ("missing", ids);
    }
    protocol::send (result);
    sendStatus();
}

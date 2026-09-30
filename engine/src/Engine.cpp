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

juce::Result fail (const juce::String& message) { return juce::Result::fail (message); }
}

Engine::Engine (const juce::File& dataDir, const juce::StringArray& pluginPaths, bool isOffline, bool onlyPluginPaths)
    : offline (isOffline),
      deviceFile (dataDir.getChildFile ("device.xml")),
      bench (dataDir, pluginPaths, onlyPluginPaths, [this] {
          // A scan has ended (or a bench window closed): a plugin the song was missing may be there now.
          plugins.forgetFailures();
          if (! lastSong.isVoid())
              applySong();
          sendStatus();
      }),
      plugins (bench.formatManager(), bench.knownPlugins(), [this] {
          // A plugin has loaded (or its window was closed): the song gets it, and the server is told.
          if (! lastSong.isVoid())
              applySong();
          sendStatus();
      })
{
    dataDir.createDirectory();
    if (offline)
    {
        start (offlineSampleRate, offlineBlockSize);
        return;
    }

    // Output only for now: opening inputs asks for the microphone, which recording will need.
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
    stopTimer();
    plugins.saveStates();
    if (! offline)
    {
        devices.removeAudioCallback (this);
        devices.closeAudioDevice();
    }
}

juce::var Engine::transport() const
{
    return protocol::object ({ { "playing", sequencer.isPlaying() }, { "tick", sequencer.position() }, { "metronome", sequencer.metronomeOn() } });
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
        { "outputLatencyMs", device != nullptr && rate > 0 ? 1000.0 * (device->getOutputLatencyInSamples() + device->getCurrentBufferSizeSamples()) / rate : 0.0 },
        { "tone", tone.load() },
        { "peak", peak.load() },
        { "transport", transport() },
        { "channels", plugins.describe() },
        { "scanning", bench.scanning() },
        { "pluginCount", bench.pluginCount() },
        { "instrument", bench.instrument.describe() },
        { "effect", bench.effect.describe() },
    });
}

void Engine::sendStatus() const { protocol::send (protocol::object ({ { "event", "status" }, { "status", status() } })); }

juce::var Engine::deviceOptions() const
{
    juce::Array<juce::var> outputs, bufferSizes, sampleRates;
    if (auto* type = devices.getCurrentDeviceTypeObject())
        for (const auto& name : type->getDeviceNames (false))
            outputs.add (name);
    auto* device = devices.getCurrentAudioDevice();
    if (device != nullptr)
    {
        for (const auto size : device->getAvailableBufferSizes())
            bufferSizes.add (size);
        for (const auto rate : device->getAvailableSampleRates())
            sampleRates.add (rate);
    }
    return protocol::object ({ { "outputs", outputs },
                               { "output", device != nullptr ? juce::var (device->getName()) : juce::var() },
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

    // The song ---------------------------------------------------------------
    if (command == "song")
    {
        lastSong = params["song"];
        juce::Array<juce::var> ids;
        for (const auto& id : applySong())
            ids.add (id);
        return reply (juce::Result::ok(), protocol::object ({ { "unreadable", ids }, { "channels", plugins.describe() } }));
    }
    if (command == "channelEditor")
    {
        if (! plugins.showEditor (params["channel"].toString(), (bool) params["open"]))
            return reply (fail ("That channel's plugin isn't loaded."), {});
        return ok();
    }
    if (command == "saveStates")
    {
        plugins.saveStates();
        return ok();
    }
    if (command == "play" || command == "stop")
    {
        if (command == "play")
            sequencer.play();
        else
            sequencer.stop();
        return ok();
    }
    if (command == "metronome")
    {
        sequencer.setMetronome ((bool) params["on"]);
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
        return render ((int) params["frames"], file.isEmpty() ? juce::File() : juce::File (file), std::move (reply));
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
    sequencer.setSong (Song::parse (lastSong, samples, plugins, unreadable));
    return unreadable;
}

void Engine::timerCallback()
{
    sequencer.collectGarbage();
    // Where the song is, while it plays or anything sounds, and once more when that ends.
    const auto playing = sequencer.isPlaying();
    const auto level = peak.load();
    const auto quiet = level < 0.0005f;
    if (playing || ! quiet || playing != saidPlaying || quiet != saidQuiet)
        protocol::send (protocol::object ({ { "event", "transport" },
                                            { "playing", playing },
                                            { "tick", sequencer.position() },
                                            { "peak", level },
                                            { "cpu", devices.getCpuUsage() } }));
    saidPlaying = playing;
    saidQuiet = quiet;
}

void Engine::audioDeviceAboutToStart (juce::AudioIODevice* device)
{
    start (device->getCurrentSampleRate(), device->getCurrentBufferSizeSamples());
}

void Engine::audioDeviceStopped() {}

void Engine::start (double rate, int block)
{
    sampleRate = rate;
    blockSize = block;
    mix.setSize (2, juce::jmax (4096, block * 2), false, false, true);
    sequencer.prepare (rate);
    plugins.prepare (rate, block);
    bench.prepare (rate, block);
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
    sequencer.collectGarbage();

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
                               { "transport", transport() } }));
}

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
    if (numSamples > mix.getNumSamples())
        return;

    // The song and the tone: always, whatever the bench is doing.
    mix.clear (0, numSamples);
    auto* left = mix.getWritePointer (0);
    auto* right = mix.getWritePointer (1);
    sequencer.process (left, right, numSamples);
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

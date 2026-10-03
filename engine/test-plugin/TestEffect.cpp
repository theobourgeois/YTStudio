// The test effect: a gain (Gain, 0..1, a half by default) that can also delay its sound and report that
// delay, as a look-ahead plugin does (Latency, in samples; 0 by default), with the generic editor. Enough
// to check that the engine runs an effect on a mixer track, bypasses it, mixes it, keeps its state and
// compensates for its delay. Its latency starts at VAUDIO_TEST_EFFECT_LATENCY (tests set it for the engine).
// With VAUDIO_TEST_EFFECT_OFFLINE=full, it leaves the sound as it is while the host renders offline (as a
// plugin with a better offline mode sounds different then), so a test can tell it was told. It has a
// sidechain input (off unless the host turns it on); with VAUDIO_TEST_EFFECT_SIDECHAIN=listen, what it puts
// out is what that input hears, summed (silence without one), so a test can hear the key a host gives it.
#include <juce_audio_utils/juce_audio_utils.h>

class TestEffect final : public juce::AudioProcessor
{
public:
    TestEffect()
        : AudioProcessor (BusesProperties()
                              .withInput ("Input", juce::AudioChannelSet::stereo(), true)
                              .withOutput ("Output", juce::AudioChannelSet::stereo(), true)
                              .withInput ("Sidechain", juce::AudioChannelSet::stereo(), false))
    {
        addParameter (gain = new juce::AudioParameterFloat (juce::ParameterID { "gain", 1 }, "Gain", 0.0f, 1.0f, 0.5f));
        // Tests start the engine with a latency for it: a hosted VST3's state is in the host's own format, so it's the simplest way in.
        const auto startLatency = juce::SystemStats::getEnvironmentVariable ("VAUDIO_TEST_EFFECT_LATENCY", "0").getIntValue();
        addParameter (latency = new juce::AudioParameterInt (juce::ParameterID { "latency", 1 }, "Latency", 0, maxLatency, juce::jlimit (0, maxLatency, startLatency)));
        setLatencySamples (latency->get());
        fullOffline = juce::SystemStats::getEnvironmentVariable ("VAUDIO_TEST_EFFECT_OFFLINE", "") == "full";
        listen = juce::SystemStats::getEnvironmentVariable ("VAUDIO_TEST_EFFECT_SIDECHAIN", "") == "listen";
    }

    bool isBusesLayoutSupported (const BusesLayout& layout) const override
    {
        const auto key = layout.inputBuses.size() > 1 ? layout.inputBuses[1] : juce::AudioChannelSet::disabled();
        return layout.getMainInputChannelSet() == juce::AudioChannelSet::stereo() && layout.getMainOutputChannelSet() == juce::AudioChannelSet::stereo()
               && (key.isDisabled() || key == juce::AudioChannelSet::stereo() || key == juce::AudioChannelSet::mono());
    }

    const juce::String getName() const override { return "Vaudio Test Effect"; }
    bool acceptsMidi() const override { return false; }
    bool producesMidi() const override { return false; }
    double getTailLengthSeconds() const override { return 0.0; }
    int getNumPrograms() override { return 1; }
    int getCurrentProgram() override { return 0; }
    void setCurrentProgram (int) override {}
    const juce::String getProgramName (int) override { return {}; }
    void changeProgramName (int, const juce::String&) override {}
    bool hasEditor() const override { return true; }
    juce::AudioProcessorEditor* createEditor() override { return new juce::GenericAudioProcessorEditor (*this); }

    void prepareToPlay (double, int) override
    {
        ring.setSize (2, maxLatency + 1);
        ring.clear();
        write = 0;
        setLatencySamples (latency->get());
    }
    void releaseResources() override {}

    void processBlock (juce::AudioBuffer<float>& buffer, juce::MidiBuffer&) override
    {
        if (listen)
        {
            // What its sidechain input hears, summed, on both sides (silence without one).
            const auto key = getBusCount (true) > 1 ? getBusBuffer (buffer, true, 1) : juce::AudioBuffer<float>();
            for (int i = 0; i < buffer.getNumSamples(); ++i)
            {
                auto sum = 0.0f;
                for (int ch = 0; ch < key.getNumChannels(); ++ch)
                    sum += key.getSample (ch, i);
                buffer.setSample (0, i, sum);
                buffer.setSample (1, i, sum);
            }
        }
        buffer.applyGain (fullOffline && isNonRealtime() ? 1.0f : gain->get());
        const auto delay = latency->get();
        if (delay != getLatencySamples())
            setLatencySamples (delay);
        if (delay == 0 || ring.getNumSamples() == 0)
            return;
        // Each sample goes in, and the one from `delay` samples ago comes out.
        const auto size = ring.getNumSamples();
        for (int i = 0; i < buffer.getNumSamples(); ++i)
        {
            auto read = write - delay;
            if (read < 0)
                read += size;
            for (int ch = 0; ch < juce::jmin (2, buffer.getNumChannels()); ++ch)
            {
                ring.setSample (ch, write, buffer.getSample (ch, i));
                buffer.setSample (ch, i, ring.getSample (ch, read));
            }
            if (++write == size)
                write = 0;
        }
    }

    void getStateInformation (juce::MemoryBlock& data) override
    {
        juce::MemoryOutputStream out (data, false);
        out.writeFloat (gain->get());
        out.writeInt (latency->get());
    }

    void setStateInformation (const void* data, int size) override
    {
        juce::MemoryInputStream in (data, (size_t) size, false);
        if (size >= (int) sizeof (float))
            *gain = in.readFloat();
        if (size >= (int) (sizeof (float) + sizeof (int)))
        {
            *latency = in.readInt();
            setLatencySamples (latency->get());
        }
    }

private:
    static constexpr int maxLatency = 48000;
    juce::AudioParameterFloat* gain = nullptr;
    juce::AudioParameterInt* latency = nullptr;
    bool fullOffline = false, listen = false;
    juce::AudioBuffer<float> ring;
    int write = 0;
};

juce::AudioProcessor* JUCE_CALLTYPE createPluginFilter() { return new TestEffect(); }

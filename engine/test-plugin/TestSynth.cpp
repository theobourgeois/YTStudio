// The test synth: eight sine voices with one parameter (Brightness, which adds harmonics) and the
// generic editor. Enough to check that the engine loads a VST3, plays it, shows it and keeps its state.
#include <juce_audio_utils/juce_audio_utils.h>

namespace
{
struct Sound : juce::SynthesiserSound
{
    bool appliesToNote (int) override { return true; }
    bool appliesToChannel (int) override { return true; }
};

struct Voice : juce::SynthesiserVoice
{
    explicit Voice (std::atomic<float>& b) : brightness (b) {}

    bool canPlaySound (juce::SynthesiserSound* s) override { return dynamic_cast<Sound*> (s) != nullptr; }

    void startNote (int note, float velocity, juce::SynthesiserSound*, int) override
    {
        phase = 0.0;
        step = juce::MidiMessage::getMidiNoteInHertz (note) / getSampleRate();
        level = velocity * 0.25f;
        gain = 1.0f;
        releasing = false;
    }

    void stopNote (float, bool allowTailOff) override
    {
        if (allowTailOff && level > 0.0f)
            releasing = true;
        else
            end();
    }

    void pitchWheelMoved (int) override {}
    void controllerMoved (int, int) override {}

    void renderNextBlock (juce::AudioBuffer<float>& out, int start, int count) override
    {
        if (level <= 0.0f)
            return;
        const auto bright = brightness.load();
        for (int i = start; i < start + count; ++i)
        {
            const auto angle = phase * juce::MathConstants<double>::twoPi;
            const auto sample = (float) (std::sin (angle) + bright * (0.5 * std::sin (2.0 * angle) + 0.33 * std::sin (3.0 * angle)));
            for (int ch = 0; ch < out.getNumChannels(); ++ch)
                out.addSample (ch, i, sample * level * gain);
            phase += step;
            phase -= std::floor (phase);
            if (releasing && (gain *= 0.9995f) < 0.001f)
            {
                end();
                return;
            }
        }
    }

    void end()
    {
        level = 0.0f;
        clearCurrentNote();
    }

    std::atomic<float>& brightness;
    double phase = 0.0, step = 0.0;
    float level = 0.0f, gain = 1.0f;
    bool releasing = false;
};
}

class TestSynth final : public juce::AudioProcessor
{
public:
    TestSynth() : AudioProcessor (BusesProperties().withOutput ("Output", juce::AudioChannelSet::stereo(), true))
    {
        addParameter (brightness = new juce::AudioParameterFloat (juce::ParameterID { "brightness", 1 }, "Brightness", 0.0f, 1.0f, 0.2f));
        for (int i = 0; i < 8; ++i)
            synth.addVoice (new Voice (level));
        synth.addSound (new Sound());
    }

    const juce::String getName() const override { return "Vaudio Test Synth"; }
    bool acceptsMidi() const override { return true; }
    bool producesMidi() const override { return false; }
    double getTailLengthSeconds() const override { return 0.2; }
    int getNumPrograms() override { return 1; }
    int getCurrentProgram() override { return 0; }
    void setCurrentProgram (int) override {}
    const juce::String getProgramName (int) override { return {}; }
    void changeProgramName (int, const juce::String&) override {}
    bool hasEditor() const override { return true; }
    juce::AudioProcessorEditor* createEditor() override { return new juce::GenericAudioProcessorEditor (*this); }

    void prepareToPlay (double sampleRate, int) override { synth.setCurrentPlaybackSampleRate (sampleRate); }
    void releaseResources() override {}

    void processBlock (juce::AudioBuffer<float>& buffer, juce::MidiBuffer& midi) override
    {
        juce::ScopedNoDenormals noDenormals;
        level = brightness->get();
        buffer.clear();
        synth.renderNextBlock (buffer, midi, 0, buffer.getNumSamples());
    }

    void getStateInformation (juce::MemoryBlock& data) override
    {
        juce::MemoryOutputStream (data, false).writeFloat (brightness->get());
    }

    void setStateInformation (const void* data, int size) override
    {
        if (size >= (int) sizeof (float))
            *brightness = juce::MemoryInputStream (data, (size_t) size, false).readFloat();
    }

private:
    juce::AudioParameterFloat* brightness = nullptr;
    std::atomic<float> level { 0.2f };
    juce::Synthesiser synth;
};

juce::AudioProcessor* JUCE_CALLTYPE createPluginFilter() { return new TestSynth(); }

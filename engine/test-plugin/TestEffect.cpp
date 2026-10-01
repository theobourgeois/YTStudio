// The test effect: a gain, one parameter (Gain, 0..1, a half by default) and the generic editor. Enough
// to check that the engine runs an effect on a mixer track, bypasses it, mixes it and keeps its state.
#include <juce_audio_utils/juce_audio_utils.h>

class TestEffect final : public juce::AudioProcessor
{
public:
    TestEffect()
        : AudioProcessor (BusesProperties().withInput ("Input", juce::AudioChannelSet::stereo(), true).withOutput ("Output", juce::AudioChannelSet::stereo(), true))
    {
        addParameter (gain = new juce::AudioParameterFloat (juce::ParameterID { "gain", 1 }, "Gain", 0.0f, 1.0f, 0.5f));
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

    void prepareToPlay (double, int) override {}
    void releaseResources() override {}

    void processBlock (juce::AudioBuffer<float>& buffer, juce::MidiBuffer&) override { buffer.applyGain (gain->get()); }

    void getStateInformation (juce::MemoryBlock& data) override { juce::MemoryOutputStream (data, false).writeFloat (gain->get()); }

    void setStateInformation (const void* data, int size) override
    {
        if (size >= (int) sizeof (float))
            *gain = juce::MemoryInputStream (data, (size_t) size, false).readFloat();
    }

private:
    juce::AudioParameterFloat* gain = nullptr;
};

juce::AudioProcessor* JUCE_CALLTYPE createPluginFilter() { return new TestEffect(); }

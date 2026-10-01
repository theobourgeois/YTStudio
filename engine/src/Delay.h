// A fixed delay for plugin delay compensation: a path's sound is added into its input during a block,
// then comes out `length` samples later, added to where it's going. Made on the message thread (it
// allocates); the audio thread only runs it. A song hands it on to the next song while its length
// doesn't change (`Sequencer::setSong`), so editing the song doesn't empty it (a click).
#pragma once

#include <juce_audio_basics/juce_audio_basics.h>

class DelayLine
{
public:
    /** `length` samples of delay, for blocks of up to `blockSize` samples. */
    DelayLine (int length, int blockSize)
        : delay (juce::jmax (0, length)), input (2, juce::jmax (1, blockSize)), ring (2, juce::jmax (1, length) + juce::jmax (1, blockSize))
    {
        input.clear();
        ring.clear();
    }

    int length() const { return delay; }
    int capacity() const { return input.getNumSamples(); }

    /** Empty the input for a block of `numSamples` (call before adding to it). */
    void clearInput (int numSamples)
    {
        input.clear (0, juce::jmin (numSamples, input.getNumSamples()));
    }

    float* inputLeft() { return input.getWritePointer (0); }
    float* inputRight() { return input.getWritePointer (1); }

    /** Put the block's input in, and add what went in `length` samples ago to `left` and `right`. */
    void flushInto (float* left, float* right, int numSamples)
    {
        const auto size = ring.getNumSamples();
        auto* ringLeft = ring.getWritePointer (0);
        auto* ringRight = ring.getWritePointer (1);
        const auto* inLeft = input.getReadPointer (0);
        const auto* inRight = input.getReadPointer (1);
        for (int i = 0; i < numSamples; ++i)
        {
            ringLeft[write] = inLeft[i];
            ringRight[write] = inRight[i];
            auto read = write - delay;
            if (read < 0)
                read += size;
            left[i] += ringLeft[read];
            right[i] += ringRight[read];
            if (++write == size)
                write = 0;
        }
    }

private:
    const int delay;
    juce::AudioBuffer<float> input, ring;
    int write = 0;

    JUCE_DECLARE_NON_COPYABLE (DelayLine)
};

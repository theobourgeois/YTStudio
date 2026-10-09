// What the Serum player's display shows of a plugin channel (`docs/serum/player.md`, the scope): the plugin's own
// sound, before its mixer track. The audio thread writes it only while the channel is watched (`channelWatch`);
// the message thread says its spectrum, its newest samples and its peaks with each transport event. Approximate
// on purpose: a sample torn between the two threads is a pixel off in a picture, never a sound.
#pragma once

#include "Protocol.h"
#include "Spectrum.h"

#include <array>
#include <atomic>
#include <cmath>

class ChannelScope
{
public:
    /** The newest samples kept: enough for a cycle of the lowest notes, and the stereo picture. */
    static constexpr int ringSize = 4096;
    /** What's said of them: the newest `waveSize` (the waveform), and `stereoSize` pairs from those (the stereo field). */
    static constexpr int waveSize = 1024, stereoSize = 256;
    /** The FFT's length: smooth enough to look at, quick enough to follow a pluck. */
    static constexpr int fftSize = 4096;

    /**
     * Audio thread, while watched: the notes the plugin is about to be given this block, so the player can show where
     * its envelopes and LFOs are (Serum doesn't say): how many keys are down, and how long since the last one went down
     * and since the last let go of them all.
     */
    void notes (const juce::MidiBuffer& midi, int numSamples)
    {
        auto on = sinceOn.load (std::memory_order_relaxed);
        auto off = sinceOff.load (std::memory_order_relaxed);
        auto down = held.load (std::memory_order_relaxed);
        on = on < 0 ? on : on + numSamples;
        off = off < 0 ? off : off + numSamples;
        for (const auto event : midi)
        {
            const auto message = event.getMessage();
            const auto after = (juce::int64) (numSamples - event.samplePosition);
            if (message.isNoteOn())
            {
                ++down;
                on = after;
            }
            else if (message.isNoteOff() || message.isAllNotesOff() || message.isAllSoundOff())
            {
                const auto was = down;
                down = message.isNoteOff() ? std::max (0, down - 1) : 0;
                if (was > 0 && down == 0)
                    off = after;
            }
        }
        sinceOn.store (on, std::memory_order_relaxed);
        sinceOff.store (off, std::memory_order_relaxed);
        held.store (down, std::memory_order_relaxed);
    }

    /** Audio thread, while watched. */
    void write (const float* left, const float* right, int numSamples)
    {
        spectrum.write (left, right, numSamples);
        auto at = position.load (std::memory_order_relaxed);
        float peakLeft = 0, peakRight = 0;
        for (int i = 0; i < numSamples; ++i)
        {
            ringLeft[(size_t) at] = left[i];
            ringRight[(size_t) at] = right[i];
            at = (at + 1) & (ringSize - 1);
            peakLeft = std::max (peakLeft, std::abs (left[i]));
            peakRight = std::max (peakRight, std::abs (right[i]));
        }
        position.store (at, std::memory_order_release);
        raise (peaks[0], peakLeft);
        raise (peaks[1], peakRight);
        ++written;
    }

    /**
     * Message thread: `{ spectrum, wave, left, right, peak, notes }`, or void if nothing's been written since it was last
     * said (`always`: said anyway, an offline render's answer). `spectrum`: dB at `eq::SpectrumGrid`'s points (a full-scale sine reads 0), to a tenth; `wave`: the newest
     * `waveSize` samples, mid; `left`, `right`: `stereoSize` of them, every fourth; `peak`: per side since last said;
     * `notes`: `{ held, sinceOn, sinceOff }`, the keys down and the seconds since the last went down and all were let
     * go (-1: not since it was watched).
     */
    juce::var describe (double sampleRate, bool always = false)
    {
        const auto now = written.load();
        if (now == said && ! always)
            return {};
        said = now;
        spectrum.measure (fftSize, sampleRate, levels);
        juce::Array<juce::var> db, wave, left, right;
        for (const auto level : levels)
            db.add (std::round (std::max (-120.0f, level) * 10.0f) / 10.0);
        const auto end = position.load (std::memory_order_acquire);
        const auto sample = [&] (const std::array<float, ringSize>& ring, int back) { return ring[(size_t) ((end - back + ringSize) & (ringSize - 1))]; };
        const auto rounded = [] (float v) { return std::round (v * 1000.0f) / 1000.0; };
        for (int i = waveSize; i > 0; --i)
            wave.add (rounded (0.5f * (sample (ringLeft, i) + sample (ringRight, i))));
        for (int i = stereoSize; i > 0; --i)
        {
            left.add (rounded (sample (ringLeft, i * 4)));
            right.add (rounded (sample (ringRight, i * 4)));
        }
        return protocol::object ({ { "spectrum", db },
                                   { "wave", wave },
                                   { "left", left },
                                   { "right", right },
                                   { "peak", juce::Array<juce::var> { rounded (peaks[0].exchange (0.0f)), rounded (peaks[1].exchange (0.0f)) } },
                                   { "notes", protocol::object ({ { "held", held.load() }, { "sinceOn", seconds (sinceOn.load(), sampleRate) }, { "sinceOff", seconds (sinceOff.load(), sampleRate) } }) } });
    }

private:
    /** Samples as seconds to a millisecond, -1 kept. */
    static double seconds (juce::int64 samples, double sampleRate) { return samples < 0 ? -1.0 : std::round ((double) samples / sampleRate * 1000.0) / 1000.0; }

    static void raise (std::atomic<float>& peak, float value)
    {
        for (auto was = peak.load (std::memory_order_relaxed); value > was && ! peak.compare_exchange_weak (was, value);)
        {
        }
    }

    eq::Spectrum spectrum;
    std::array<float, ringSize> ringLeft {}, ringRight {};
    std::atomic<int> position { 0 };
    std::array<std::atomic<float>, 2> peaks {};
    std::atomic<juce::uint32> written { 0 };
    std::atomic<juce::int64> sinceOn { -1 }, sinceOff { -1 };
    std::atomic<int> held { 0 };
    juce::uint32 said = 0;
    std::vector<float> levels;
};

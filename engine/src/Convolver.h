// A stereo FIR filter run by FFT: Pro-Q's Linear Phase and Natural Phase modes (ProQ.h). Uniformly
// partitioned overlap-save: the sound is taken in blocks of `block` samples and comes out `block`
// samples late (plus whatever delay the kernels themselves have), whatever size the host's blocks are.
//
// A kernel is a 2x2 matrix of filters (left and right out from left and right in), so bands placed on
// the mid or the side are exact; most are diagonal, and many have both sides the same. A set of kernels
// is a base and any number of deltas, each heard at a gain the caller gives per sample: that's how a
// dynamic band moves in Linear Phase without designing a kernel on the audio thread.
//
// Sets are designed off the audio thread and handed over whole (`offer`); the audio thread takes the
// newest at its next block, crossfades from the last across that block (so a change never clicks), and
// hands the old one back to be deleted (`collect`, off the audio thread). It never allocates or waits.
#pragma once

#include <juce_audio_basics/juce_audio_basics.h>
#include <juce_dsp/juce_dsp.h>

#include <array>
#include <atomic>
#include <complex>
#include <memory>
#include <vector>

namespace eq
{
/** A 2x2 matrix of filters, partitioned for a convolver of one block size. Immutable once made. */
struct Kernel
{
    /** Its paths: left from left, left from right, right from left, right from right. */
    enum Path
    {
        ll,
        lr,
        rl,
        rr
    };

    int block = 0, partitions = 0;
    /** No cross terms (each side filtered alone), and both sides the same filter. */
    bool diagonal = true, same = true;
    /** Per path, per partition, `block + 1` bins. Absent paths are empty. */
    std::array<std::vector<std::complex<float>>, 4> spectra;

    const std::complex<float>* at (int path, int partition) const { return spectra[(size_t) path].data() + (size_t) partition * (size_t) (block + 1); }

    /**
     * A kernel from impulse responses `taps` long (at most the convolver's `maxTaps`): `lr` and `rl`
     * null for none (diagonal), `rr` null for the same as `ll`. Allocates.
     */
    static Kernel make (int block, const float* ll, const float* lr, const float* rl, const float* rr, int taps);
};

/** What a convolver plays: a base, and deltas heard at gains the caller gives. */
struct KernelSet
{
    Kernel base;
    std::vector<Kernel> deltas;
    /** Whose each delta is (a band's number). */
    std::vector<int> bands;
};

/**
 * A stereo filter's response as a 2x2 matrix at one frequency: left and right out from left and right
 * in (`ll`: left from left...).
 */
struct Matrix
{
    std::complex<double> ll { 1 }, lr { 0 }, rl { 0 }, rr { 1 };
};

/**
 * Impulse responses `taps` long from a 2x2 response sampled at the `fftSize / 2 + 1` bins of an FFT
 * (`responses`), each path turned to time by an inverse FFT, its middle `taps` kept (centred on
 * `delay`, which must be under `taps`) and windowed (Blackman). The kernel of them, for `block`.
 */
Kernel kernelFromResponse (const std::vector<Matrix>& responses, int fftSize, int taps, int delay, int block);

class Convolver
{
public:
    /** Most deltas a set may have (a dynamic band's each). */
    static constexpr int maxDeltas = 24;

    /** Blocks of `block` samples (a power of two), kernels of up to `maxTaps`. Allocates. */
    Convolver (int block, int maxTaps);
    ~Convolver();

    int block() const { return blockSize; }
    int maxTaps() const { return maxPartitions * blockSize; }

    /** Hand over the set to play from the next block on (null: the sound passes through, `block` late). Not the audio thread. */
    void offer (std::unique_ptr<KernelSet> set);
    /** Delete the sets the audio thread has finished with. Not the audio thread. */
    void collect();

    /**
     * Filter `numSamples` of `left` and `right` in place (`block` samples late). `gains[d]` is delta d's
     * gain for each sample (as it comes out); null when the set has no deltas. Audio thread.
     */
    void process (float* left, float* right, int numSamples, const float* const* gains);
    /** Forget the sound so far (play starts afresh). Audio thread. */
    void reset();

private:
    void runBlock();
    /** Convolve the history with `kernel` into `out` (two sides of `block` samples). */
    void convolve (const Kernel& kernel, std::array<float*, 2> out);

    const int blockSize, maxPartitions;
    juce::dsp::FFT fft;
    std::atomic<KernelSet*> offered { nullptr };
    KernelSet* playing = nullptr;
    /** The set faded out of over the block being made, then retired. */
    KernelSet* fading = nullptr;
    /** Sets the audio thread is done with, for `collect`. */
    juce::AbstractFifo retiredFifo { 64 };
    std::array<KernelSet*, 64> retired {};

    /** The last two blocks of each side, in time order (the FFT's input). */
    std::array<std::vector<float>, 2> window;
    /** Each side's spectra of the last blocks (a ring of `maxPartitions`; `newest` is the last). */
    std::array<std::vector<std::complex<float>>, 2> history;
    int newest = 0;
    /** The block coming in and the blocks going out (the base, then each delta), and where in them it is. */
    std::array<std::vector<float>, 2> input;
    std::vector<float> output;
    int outputs = 0, fadeOutputs = 0, position = 0;
    /** Scratch: the FFT's buffer, the spectrum summed per side, one block of an old set's output. */
    std::vector<float> scratch;
    std::array<std::vector<std::complex<float>>, 2> sum;
    std::vector<float> faded;
};
} // namespace eq

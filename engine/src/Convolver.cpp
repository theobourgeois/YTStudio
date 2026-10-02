#include "Convolver.h"

namespace eq
{
Kernel Kernel::make (int block, const float* ll, const float* lr, const float* rl, const float* rr, int taps)
{
    Kernel kernel;
    kernel.block = block;
    kernel.partitions = juce::jmax (1, (taps + block - 1) / block);
    kernel.diagonal = lr == nullptr && rl == nullptr;
    kernel.same = rr == nullptr && kernel.diagonal;
    juce::dsp::FFT fft (juce::roundToInt (std::log2 ((double) block)) + 1);
    std::vector<float> scratch ((size_t) block * 4);
    const auto bins = (size_t) block + 1;
    const auto partition = [&] (const float* taps_, int path) {
        if (taps_ == nullptr)
            return;
        auto& spectrum = kernel.spectra[(size_t) path];
        spectrum.assign ((size_t) kernel.partitions * bins, {});
        for (int p = 0; p < kernel.partitions; ++p)
        {
            // Each partition's taps, padded to the FFT's length: overlap-save keeps the last half.
            std::fill (scratch.begin(), scratch.end(), 0.0f);
            const auto from = p * block;
            const auto count = juce::jmin (block, taps - from);
            if (count > 0)
                std::copy (taps_ + from, taps_ + from + count, scratch.begin());
            fft.performRealOnlyForwardTransform (scratch.data(), true);
            const auto* complex = reinterpret_cast<const std::complex<float>*> (scratch.data());
            std::copy (complex, complex + bins, spectrum.begin() + (std::ptrdiff_t) ((size_t) p * bins));
        }
    };
    partition (ll, Kernel::ll);
    partition (lr, Kernel::lr);
    partition (rl, Kernel::rl);
    partition (kernel.same ? nullptr : (rr != nullptr ? rr : ll), Kernel::rr);
    return kernel;
}

Convolver::Convolver (int block, int maxTaps)
    : blockSize (block), maxPartitions (juce::jmax (1, (maxTaps + block - 1) / block)), fft (juce::roundToInt (std::log2 ((double) block)) + 1)
{
    const auto bins = (size_t) blockSize + 1;
    for (int side = 0; side < 2; ++side)
    {
        window[(size_t) side].assign ((size_t) blockSize * 2, 0.0f);
        history[(size_t) side].assign ((size_t) maxPartitions * bins, {});
        input[(size_t) side].assign ((size_t) blockSize, 0.0f);
        sum[(size_t) side].assign (bins, {});
    }
    output.assign ((size_t) (1 + maxDeltas) * 2 * (size_t) blockSize, 0.0f);
    faded.assign ((size_t) (1 + maxDeltas) * 2 * (size_t) blockSize, 0.0f);
    scratch.assign ((size_t) blockSize * 4, 0.0f);
}

Convolver::~Convolver()
{
    collect();
    delete offered.exchange (nullptr);
    delete playing;
    delete fading;
}

void Convolver::offer (std::unique_ptr<KernelSet> set)
{
    collect();
    // One the audio thread never took is simply replaced.
    delete offered.exchange (set.release());
}

void Convolver::collect()
{
    const auto scope = retiredFifo.read (retiredFifo.getNumReady());
    for (int i = 0; i < scope.blockSize1; ++i)
        delete retired[(size_t) (scope.startIndex1 + i)];
    for (int i = 0; i < scope.blockSize2; ++i)
        delete retired[(size_t) (scope.startIndex2 + i)];
}

void Convolver::reset()
{
    for (int side = 0; side < 2; ++side)
    {
        std::fill (window[(size_t) side].begin(), window[(size_t) side].end(), 0.0f);
        std::fill (history[(size_t) side].begin(), history[(size_t) side].end(), std::complex<float> {});
        std::fill (input[(size_t) side].begin(), input[(size_t) side].end(), 0.0f);
    }
    std::fill (output.begin(), output.end(), 0.0f);
    std::fill (faded.begin(), faded.end(), 0.0f);
    position = 0;
}

void Convolver::convolve (const Kernel& kernel, std::array<float*, 2> out)
{
    const auto bins = (size_t) blockSize + 1;
    const auto partitions = juce::jmin (kernel.partitions, maxPartitions);
    // Each side out: the sum over partitions of the history's spectra times the kernel's.
    for (int side = 0; side < 2; ++side)
    {
        auto* acc = sum[(size_t) side].data();
        std::fill (acc, acc + bins, std::complex<float> {});
        const int own = side == 0 ? Kernel::ll : (kernel.same ? Kernel::ll : Kernel::rr);
        const int cross = side == 0 ? Kernel::lr : Kernel::rl;
        for (int p = 0; p < partitions; ++p)
        {
            const auto slot = (size_t) ((newest - p + maxPartitions) % maxPartitions) * bins;
            const auto* x = history[(size_t) side].data() + slot;
            const auto* h = kernel.at (own, p);
            for (size_t k = 0; k < bins; ++k)
                acc[k] += x[k] * h[k];
            if (! kernel.diagonal && ! kernel.spectra[(size_t) cross].empty())
            {
                const auto* other = history[(size_t) (1 - side)].data() + slot;
                const auto* c = kernel.at (cross, p);
                for (size_t k = 0; k < bins; ++k)
                    acc[k] += other[k] * c[k];
            }
        }
        std::fill (scratch.begin(), scratch.end(), 0.0f);
        std::copy (acc, acc + bins, reinterpret_cast<std::complex<float>*> (scratch.data()));
        fft.performRealOnlyInverseTransform (scratch.data());
        // Overlap-save: the second half is this block's sound.
        std::copy (scratch.begin() + blockSize, scratch.begin() + blockSize * 2, out[(size_t) side]);
    }
}

void Convolver::runBlock()
{
    const auto bins = (size_t) blockSize + 1;
    // The block in, after the one before it, into the history.
    newest = (newest + 1) % maxPartitions;
    for (int side = 0; side < 2; ++side)
    {
        auto& w = window[(size_t) side];
        std::copy (w.begin() + blockSize, w.end(), w.begin());
        std::copy (input[(size_t) side].begin(), input[(size_t) side].end(), w.begin() + blockSize);
        std::copy (w.begin(), w.end(), scratch.begin());
        std::fill (scratch.begin() + blockSize * 2, scratch.end(), 0.0f);
        fft.performRealOnlyForwardTransform (scratch.data(), true);
        const auto* complex = reinterpret_cast<const std::complex<float>*> (scratch.data());
        std::copy (complex, complex + bins, history[(size_t) side].begin() + (std::ptrdiff_t) ((size_t) newest * bins));
    }

    // A set handed over plays from this block, the last faded out across it.
    if (fading != nullptr)
    {
        // (The one faded over the last block is done with.)
        const auto scope = retiredFifo.write (1);
        if (scope.blockSize1 > 0)
            retired[(size_t) scope.startIndex1] = fading;
        fading = nullptr;
    }
    bool fade = false;
    if (auto* next = offered.exchange (nullptr))
    {
        fading = playing;
        playing = next;
        fade = true;
    }

    const auto run = [this] (const KernelSet* set, std::vector<float>& into) {
        const auto block = (size_t) blockSize;
        if (set == nullptr)
        {
            // Nothing to play: the sound passes through, a block late.
            std::copy (input[0].begin(), input[0].end(), into.begin());
            std::copy (input[1].begin(), input[1].end(), into.begin() + (std::ptrdiff_t) block);
            return 0;
        }
        convolve (set->base, { into.data(), into.data() + block });
        const auto deltas = juce::jmin ((int) set->deltas.size(), maxDeltas);
        for (int d = 0; d < deltas; ++d)
            convolve (set->deltas[(size_t) d], { into.data() + (size_t) (1 + d) * 2 * block, into.data() + ((size_t) (1 + d) * 2 + 1) * block });
        return deltas;
    };
    outputs = 1 + run (playing, output);
    fadeOutputs = fade ? 1 + run (fading, faded) : 0;
}

void Convolver::process (float* left, float* right, int numSamples, const float* const* gains)
{
    const auto block = (size_t) blockSize;
    const auto mixOf = [&] (const std::vector<float>& from, int count, int i, int side) {
        auto y = from[(size_t) side * block + (size_t) position];
        for (int d = 1; d < count; ++d)
            if (gains != nullptr && gains[d - 1] != nullptr)
                y += gains[d - 1][i] * from[((size_t) d * 2 + (size_t) side) * block + (size_t) position];
        return y;
    };
    for (int i = 0; i < numSamples; ++i)
    {
        input[0][(size_t) position] = left[i];
        input[1][(size_t) position] = right[i];
        auto l = mixOf (output, outputs, i, 0);
        auto r = mixOf (output, outputs, i, 1);
        if (fadeOutputs > 0)
        {
            // Equal gain: both sets are the same sound filtered two ways, so they're in phase.
            const auto t = (float) (position + 1) / (float) blockSize;
            l = l * t + mixOf (faded, fadeOutputs, i, 0) * (1.0f - t);
            r = r * t + mixOf (faded, fadeOutputs, i, 1) * (1.0f - t);
        }
        left[i] = l;
        right[i] = r;
        if (++position == blockSize)
        {
            position = 0;
            runBlock();
        }
    }
}
} // namespace eq

namespace eq
{
Kernel kernelFromResponse (const std::vector<Matrix>& responses, int fftSize, int taps, int delay, int block)
{
    const auto bins = fftSize / 2 + 1;
    bool cross = false, same = true;
    for (const auto& m : responses)
    {
        cross = cross || std::abs (m.lr) > 1e-12 || std::abs (m.rl) > 1e-12;
        same = same && std::abs (m.ll - m.rr) < 1e-12;
    }
    juce::dsp::FFT fft (juce::roundToInt (std::log2 ((double) fftSize)));
    std::vector<float> scratch ((size_t) fftSize * 2);
    std::array<std::vector<float>, 4> paths;
    // Blackman, over the taps kept.
    std::vector<float> window ((size_t) taps);
    for (int n = 0; n < taps; ++n)
    {
        const auto x = juce::MathConstants<double>::twoPi * (n + 0.5) / taps;
        window[(size_t) n] = (float) (0.42 - 0.5 * std::cos (x) + 0.08 * std::cos (2 * x));
    }
    const auto transform = [&] (int path) {
        auto& out = paths[(size_t) path];
        out.assign ((size_t) taps, 0.0f);
        std::fill (scratch.begin(), scratch.end(), 0.0f);
        auto* complex = reinterpret_cast<std::complex<float>*> (scratch.data());
        for (int k = 0; k < bins; ++k)
        {
            const auto& m = responses[(size_t) k];
            auto v = path == Kernel::ll ? m.ll : path == Kernel::lr ? m.lr : path == Kernel::rl ? m.rl : m.rr;
            // A real signal's Nyquist bin is real.
            if (k == bins - 1)
                v = std::complex<double> (v.real(), 0);
            complex[k] = std::complex<float> ((float) v.real(), (float) v.imag());
        }
        fft.performRealOnlyInverseTransform (scratch.data());
        // Tap n is sample (n - delay) of the circular response.
        for (int n = 0; n < taps; ++n)
            out[(size_t) n] = scratch[(size_t) (((n - delay) % fftSize + fftSize) % fftSize)] * window[(size_t) n];
    };
    transform (Kernel::ll);
    if (cross)
    {
        transform (Kernel::lr);
        transform (Kernel::rl);
    }
    if (! same || cross)
        transform (Kernel::rr);
    return Kernel::make (block,
                         paths[Kernel::ll].data(),
                         cross ? paths[Kernel::lr].data() : nullptr,
                         cross ? paths[Kernel::rl].data() : nullptr,
                         same && ! cross ? nullptr : paths[Kernel::rr].data(),
                         taps);
}
} // namespace eq

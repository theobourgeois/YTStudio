// The look-ahead limiter's parts (docs/fabfilter/pro-l.md §5.4–5.5), used by YT-L's stages: a sliding minimum
// that answers for any recent span, a stack of box filters (the ramp), and a stage made of them. Pure DSP: no
// allocation after `prepare`, which the message thread calls.
//
// The guarantee (§5.4): a stage takes the lowest gain any sample needs over a window around the one it's
// working on, only ever lowers that further (the release, a hold, another curve), and averages it with
// non-negative weights over no more samples than it looks ahead. So the gain it gives a sample is never more
// than that sample needs.
#pragma once

#include <algorithm>
#include <array>
#include <cmath>
#include <cstdint>
#include <vector>

namespace limit
{
/**
 * The smallest of the values pushed lately, over the last `length` of them for any `length` up to the
 * capacity: Lemire's wedge (values rising from its front, each the least from its place to the newest),
 * read by a binary search for the first one inside the span.
 */
class MinWindow
{
public:
    void prepare (int capacity)
    {
        cap = std::max (2, capacity + 1);
        index.assign ((size_t) cap, 0);
        value.assign ((size_t) cap, 1.0f);
        clear();
    }
    void clear()
    {
        head = count = 0;
        next = 0;
    }
    void push (float v)
    {
        while (count > 0 && value[(size_t) at (count - 1)] >= v)
            --count;
        const auto slot = (size_t) at (count);
        index[slot] = next++;
        value[slot] = v;
        ++count;
        while (count > 0 && index[(size_t) head] <= next - cap)
        {
            head = (head + 1) % cap;
            --count;
        }
    }
    /** The least of the last `length` values pushed (1 if nothing was). */
    float min (int length) const
    {
        const auto start = next - length;
        int lo = 0, hi = count;
        while (lo < hi)
        {
            const auto mid = (lo + hi) / 2;
            if (index[(size_t) at (mid)] < start)
                lo = mid + 1;
            else
                hi = mid;
        }
        return lo < count ? value[(size_t) at (lo)] : 1.0f;
    }
    int capacity() const { return cap - 1; }

private:
    int at (int k) const { return (head + k) % cap; }
    std::vector<std::int64_t> index;
    std::vector<float> value;
    int cap = 2, head = 0, count = 0;
    std::int64_t next = 0;
};

/**
 * A stack of box filters (moving averages, each a running sum): non-negative weights summing to 1 over exactly
 * `support` samples, at a few adds a sample whatever its length. Four boxes have sidelobes 21 dB lower than a
 * Hann window's (Signalsmith's lengths). Each sum is made again exactly every time its ring goes round, so it
 * never drifts.
 */
class BoxStack
{
public:
    void prepare (int maxSupport)
    {
        for (auto& b : boxes)
            b.ring.assign ((size_t) std::max (1, maxSupport) + 1, 1.0);
    }
    /** `support` taps (a ramp `support − 1` samples long) in up to `layers` boxes, every tap at `fill`. */
    void configure (int support, int layers, double fill)
    {
        static constexpr double ratios[4][4] { { 1, 0, 0, 0 }, { 0.5, 0.5, 0, 0 }, { 0.40408, 0.33485, 0.26107, 0 }, { 0.30794, 0.27370, 0.22913, 0.18922 } };
        const auto most = (int) boxes[0].ring.size() - 1;
        support = std::clamp (support, 1, most);
        count = std::clamp (layers, 1, std::min (4, support));
        // Their lengths add up to `support + count − 1`, so the stack spans `support` samples.
        const auto total = support + count - 1;
        auto sum = 0;
        for (int k = 0; k < count; ++k)
        {
            auto& b = boxes[(size_t) k];
            b.length = std::max (1, (int) std::lround (ratios[count - 1][k] * total));
            sum += b.length;
        }
        boxes[0].length = std::max (1, boxes[0].length + total - sum);
        for (int k = 0; k < count; ++k)
        {
            auto& b = boxes[(size_t) k];
            b.length = std::min (b.length, most);
            std::fill (b.ring.begin(), b.ring.begin() + b.length, fill);
            b.pos = 0;
            b.sum = fill * b.length;
        }
        span = 1;
        for (int k = 0; k < count; ++k)
            span += boxes[(size_t) k].length - 1;
    }
    double process (double v)
    {
        for (int k = 0; k < count; ++k)
        {
            auto& b = boxes[(size_t) k];
            b.sum += v - b.ring[(size_t) b.pos];
            b.ring[(size_t) b.pos] = v;
            if (++b.pos == b.length)
            {
                b.pos = 0;
                b.sum = 0;
                for (int i = 0; i < b.length; ++i)
                    b.sum += b.ring[(size_t) i];
            }
            v = b.sum / b.length;
        }
        return v;
    }
    /** How many samples it spans (its ramp is one less). */
    int support() const { return span; }

private:
    struct Box
    {
        std::vector<double> ring;
        int length = 1, pos = 0;
        double sum = 1;
    };
    std::array<Box, 4> boxes;
    int count = 1, span = 1;
};

/**
 * One look-ahead stage: the requirement pushed as each sample arrives, the gain for the sample `ahead` samples
 * back given out (§5.4). The window reaches `ahead` samples forward and `hold` back (a hold costs no latency);
 * the release lets the gain rise no faster than `rise` (a one-pole's coefficient, 1: at once), and `floor` is
 * another curve that only lowers it (the release stage's gain for that sample). Then the ramp.
 */
class Stage
{
public:
    void prepare (int maxWindow, int maxSupport)
    {
        window.prepare (maxWindow);
        kernel.prepare (maxSupport);
        kernel.configure (1, 1, 1);
    }
    void reset (int support, int layers)
    {
        window.clear();
        kernel.configure (support, layers, 1);
        released = 1;
    }
    double step (double requirement, int ahead, int hold, double floor, double rise)
    {
        window.push ((float) requirement);
        const auto length = std::min (window.capacity(), ahead + 1 + std::max (0, hold));
        const auto least = (double) window.min (length);
        released = std::min (least, released + (1 - released) * rise);
        return kernel.process (std::min (released, floor));
    }
    int support() const { return kernel.support(); }

private:
    MinWindow window;
    BoxStack kernel;
    double released = 1;
};
} // namespace limit

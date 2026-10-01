// Threads to run the song's plugins on at once, for the export: each plugin instance only depends on
// its own input, so a block's instruments, then each stage of the mixer's tracks, are spread across
// the cores (`Sequencer::setWorkers`). The calling thread works too, and `run` returns once every
// item is done. It waits and wakes threads, so it's for offline rendering only, never the audio thread.
#pragma once

#include <juce_audio_basics/juce_audio_basics.h>

#include <atomic>
#include <condition_variable>
#include <functional>
#include <mutex>
#include <thread>
#include <vector>

class Workers
{
public:
    /** `threads` in all, counting the caller (so `threads - 1` of its own). */
    explicit Workers (int threads)
    {
        for (int i = 1; i < threads; ++i)
            pool.emplace_back ([this] { work(); });
    }

    ~Workers()
    {
        {
            const std::lock_guard guard (lock);
            quitting = true;
        }
        wake.notify_all();
        for (auto& thread : pool)
            thread.join();
    }

    int size() const { return (int) pool.size() + 1; }

    /** `job (i)` for every `i` in `[0, count)`, spread over the threads; returns when they've all been done. */
    void run (int count, const std::function<void (int)>& job)
    {
        if (count <= 0)
            return;
        if (count == 1 || pool.empty())
        {
            for (int i = 0; i < count; ++i)
                job (i);
            return;
        }
        {
            const std::lock_guard guard (lock);
            current = &job;
            total = count;
            next = 0;
            left = count;
            ++generation;
        }
        wake.notify_all();
        take (job, count);
        // Every item done, and every thread out of `take`: none can then pick up the next run's items with this one's job.
        std::unique_lock guard (lock);
        finished.wait (guard, [this] { return left == 0 && busy == 0; });
        current = nullptr;
    }

private:
    /** Do items until there are none left to take. */
    void take (const std::function<void (int)>& job, int count)
    {
        for (int i; (i = next.fetch_add (1)) < count;)
        {
            job (i);
            if (left.fetch_sub (1) == 1)
            {
                const std::lock_guard guard (lock);
                finished.notify_all();
            }
        }
    }

    void work()
    {
        // Denormals are slow, and the flag that turns them off is each thread's own.
        juce::ScopedNoDenormals noDenormals;
        juce::uint64 seen = 0;
        for (;;)
        {
            const std::function<void (int)>* job = nullptr;
            int count = 0;
            {
                std::unique_lock guard (lock);
                wake.wait (guard, [&] { return quitting || generation != seen; });
                if (quitting)
                    return;
                seen = generation;
                job = current;
                count = total;
                if (job == nullptr)
                    continue;
                ++busy;
            }
            take (*job, count);
            const std::lock_guard guard (lock);
            if (--busy == 0 && left == 0)
                finished.notify_all();
        }
    }

    std::vector<std::thread> pool;
    std::mutex lock;
    std::condition_variable wake, finished;
    bool quitting = false;
    juce::uint64 generation = 0;
    const std::function<void (int)>* current = nullptr;
    int total = 0;
    /** Threads inside `take` (under `lock`). */
    int busy = 0;
    std::atomic<int> next { 0 }, left { 0 };
};

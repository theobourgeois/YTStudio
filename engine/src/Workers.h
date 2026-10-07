// Threads to run the song's plugins on at once: each plugin instance only depends on its own input, so
// a block's instruments, then each stage of the mixer's tracks, are spread across the cores
// (`Sequencer::setWorkers`), as FL Studio and every DAW do. The calling thread works too, and `run`
// returns once every item is done.
//
// Playback calls `run` from the audio thread, so nothing here waits on a lock or allocates: items are
// claimed from one atomic ticket, the caller spins until the last is done (the workers are real-time
// threads in the device's audio workgroup, so they're running), and idle workers sleep on an atomic
// the caller only notifies when one is asleep. The export uses the same pool with ordinary threads.
#pragma once

#include <juce_audio_basics/juce_audio_basics.h>

#include <atomic>
#include <memory>
#include <vector>

#if defined(__x86_64__) || defined(_M_X64)
 #include <immintrin.h>
#elif defined(_MSC_VER) && defined(_M_ARM64)
 #include <intrin.h>
#endif

class Workers
{
public:
    /**
     * `threads` in all, counting the caller (so `threads - 1` of its own). `realtime`: for the audio
     * thread's work (playback); the export's run at an ordinary priority.
     */
    explicit Workers (int threads, bool realtime = false)
    {
        for (int i = 1; i < threads; ++i)
        {
            pool.push_back (std::make_unique<Worker> (*this));
            if (! realtime || ! pool.back()->startRealtimeThread (juce::Thread::RealtimeOptions {}.withPriority (10)))
                pool.back()->startThread (juce::Thread::Priority::high);
        }
    }

    ~Workers()
    {
        quitting.store (true);
        wakeups.fetch_add (1);
        wakeups.notify_all();
        for (auto& worker : pool)
            worker->stopThread (-1);
    }

    int size() const { return (int) pool.size() + 1; }

    /**
     * The audio device's workgroup (macOS: the threads that must meet its deadline together, kept on
     * the fast cores), which the workers join. Any thread but the audio thread.
     */
    void setWorkgroup (juce::AudioWorkgroup group)
    {
        {
            const juce::SpinLock::ScopedLockType guard (workgroupLock);
            workgroup = std::move (group);
        }
        workgroupSerial.fetch_add (1);
    }

    /** `job (i)` for every `i` in `[0, count)`, spread over the threads; returns when they've all been done. One caller at a time. */
    template <typename Job>
    void run (int count, Job& job)
    {
        if (count <= 0)
            return;
        if (count == 1 || pool.empty() || count > maxItems)
        {
            for (int i = 0; i < count; ++i)
                job (i);
            return;
        }
        // The job and how many are left, then the ticket that hands its items out (which publishes them).
        call.store ([] (void* target, int i) { (*static_cast<Job*> (target)) (i); }, std::memory_order_relaxed);
        context.store (&job, std::memory_order_relaxed);
        left.store (count, std::memory_order_relaxed);
        ticket.store ((juce::uint64) ++generation << 32 | (juce::uint64) count << 16, std::memory_order_seq_cst);
        // Wake sleepers, no more than there are items for the others (one each: a wake-up costs a system call).
        if (const auto asleep = juce::jmin (sleeping.load (std::memory_order_seq_cst), count - 1); asleep > 0)
        {
            wakeups.fetch_add (1, std::memory_order_release);
            for (int i = 0; i < asleep; ++i)
                wakeups.notify_one();
        }
        take();
        while (left.load (std::memory_order_acquire) != 0)
            pause();
    }

private:
    /** More items than the ticket's 16 bits can count run in turn. */
    static constexpr int maxItems = 0xffff;
    /** How long a worker looks for the next run before it sleeps: a block's runs come close together. */
    static constexpr double spinSeconds = 50e-6;

    struct Worker final : juce::Thread
    {
        explicit Worker (Workers& owner) : juce::Thread ("Vaudio worker"), pool (owner) {}
        void run() override { pool.work(); }
        Workers& pool;
    };

    static void pause()
    {
       #if defined(_MSC_VER) && defined(_M_ARM64)
        __yield();
       #elif defined(__aarch64__)
        __asm__ __volatile__ ("yield");
       #elif defined(__x86_64__) || defined(_M_X64)
        _mm_pause();
       #endif
    }

    bool hasWork() const
    {
        const auto t = ticket.load (std::memory_order_seq_cst);
        return (t & 0xffff) < ((t >> 16) & 0xffff);
    }

    /** Do items of the current run until there are none left to claim; whether any were done. */
    bool take()
    {
        auto did = false;
        for (auto t = ticket.load (std::memory_order_acquire);;)
        {
            const auto next = (int) (t & 0xffff);
            if (next >= (int) ((t >> 16) & 0xffff))
                return did;
            if (! ticket.compare_exchange_weak (t, t + 1, std::memory_order_acq_rel, std::memory_order_acquire))
                continue;
            // Claimed, so its run can't end (nor the next one's job be stored) before this item is done.
            call.load (std::memory_order_relaxed) (context.load (std::memory_order_relaxed), next);
            left.fetch_sub (1, std::memory_order_release);
            did = true;
            t = ticket.load (std::memory_order_acquire);
        }
    }

    void work()
    {
        // Denormals are slow, and the flag that turns them off is each thread's own.
        juce::ScopedNoDenormals noDenormals;
        juce::WorkgroupToken token;
        juce::uint64 joined = 0;
        const auto spinTicks = juce::Time::secondsToHighResolutionTicks (spinSeconds);
        auto lastWork = juce::Time::getHighResolutionTicks();
        while (! quitting.load (std::memory_order_relaxed))
        {
            if (const auto serial = workgroupSerial.load (std::memory_order_acquire); serial != joined)
            {
                joined = serial;
                const juce::SpinLock::ScopedLockType guard (workgroupLock);
                workgroup.join (token);
            }
            if (take())
            {
                lastWork = juce::Time::getHighResolutionTicks();
                continue;
            }
            if (juce::Time::getHighResolutionTicks() - lastWork < spinTicks)
            {
                pause();
                continue;
            }
            // Asleep until the next run: counted first, then the ticket looked at again, so a run either is
            // seen here or sees this thread asleep and wakes it.
            const auto seen = wakeups.load (std::memory_order_acquire);
            sleeping.fetch_add (1, std::memory_order_seq_cst);
            if (! hasWork() && ! quitting.load())
                wakeups.wait (seen, std::memory_order_acquire);
            sleeping.fetch_sub (1, std::memory_order_relaxed);
            lastWork = juce::Time::getHighResolutionTicks();
        }
    }

    std::vector<std::unique_ptr<Worker>> pool;
    /** The current run: its generation (32 bits), item count (16) and next item to claim (16). */
    std::atomic<juce::uint64> ticket { 0 };
    std::atomic<void (*) (void*, int)> call { nullptr };
    std::atomic<void*> context { nullptr };
    std::atomic<int> left { 0 };
    /** The caller's own count of runs (one caller at a time). */
    juce::uint32 generation = 0;
    std::atomic<int> sleeping { 0 };
    std::atomic<juce::uint32> wakeups { 0 };
    std::atomic<bool> quitting { false };
    juce::SpinLock workgroupLock;
    juce::AudioWorkgroup workgroup;
    std::atomic<juce::uint64> workgroupSerial { 0 };
};

#pragma once

#include <juce_core/juce_core.h>

#include <atomic>
#include <functional>
#include <thread>

/** The plugin's Python, run hidden: the work (rendering, listening, moving faders, filling inserts) is Python, so the
    plugin starts it and talks to it in lines of JSON over its stdin and stdout. It's in a job object that dies with
    FL, so a crash never leaves it running. */
class Worker
{
public:
    /** Called on the reader thread with each line the worker prints (stderr too: a traceback arrives as lines). */
    using LineHandler = std::function<void (const juce::String&)>;

    ~Worker();

    /** Starts `commandLine` with no window. Returns an error to show, or an empty string. */
    juce::String start (const juce::String& commandLine, LineHandler onLine);
    bool send (const juce::String& line);
    bool isRunning() const;
    void stop();

private:
    void read();

    void* process = nullptr;
    void* job = nullptr;
    void* toChild = nullptr;   // our end of its stdin
    void* fromChild = nullptr; // our end of its stdout and stderr
    std::thread reader;
    LineHandler handler;
    std::atomic<bool> running { false };
};

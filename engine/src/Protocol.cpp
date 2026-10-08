#include "Protocol.h"

#include <condition_variable>
#include <cstdio>
#include <deque>
#include <iostream>
#include <mutex>
#include <string>
#include <thread>

#if JUCE_WINDOWS
 #include <fcntl.h>
 #include <io.h>
 #define ENGINE_DUP _dup
 #define ENGINE_DUP2 _dup2
 #define ENGINE_FDOPEN _fdopen
 #define ENGINE_CLOSE _close
 #define ENGINE_READ _read
#else
 #include <unistd.h>
 #define ENGINE_DUP dup
 #define ENGINE_DUP2 dup2
 #define ENGINE_FDOPEN fdopen
 #define ENGINE_CLOSE close
 #define ENGINE_READ read
#endif

namespace protocol
{
namespace
{
/**
 * Lines on their way to a pipe, written by a thread of their own. Whoever reads the pipe (the server, which
 * in the desktop app runs on the main window's thread) may stop reading for a while, and then the pipe fills
 * and a write waits. The message thread must never wait for the app: on Windows a plugin's window belongs to
 * the app's main window, so the app's thread can be waiting for the message thread at that very moment (to
 * move or raise the window) and the two would wait for each other for ever, the song still playing.
 */
class Outlet
{
public:
    /** `limit`: past this many bytes waiting, new lines are dropped (0: never; messages are never dropped). */
    explicit Outlet (size_t limit) : limit (limit) {}

    void start (FILE* stream)
    {
        out = stream;
        std::thread ([this] { run(); }).detach();
    }

    void push (std::string line)
    {
        {
            const std::lock_guard<std::mutex> guard (lock);
            if (limit != 0 && waiting + line.size() > limit)
                return;
            waiting += line.size();
            lines.push_back (std::move (line));
        }
        ready.notify_one();
    }

    /** Waits (up to `ms`) for what's queued to be written: before the program ends. */
    void drain (int ms)
    {
        std::unique_lock<std::mutex> guard (lock);
        written.wait_for (guard, std::chrono::milliseconds (ms), [this] { return lines.empty() && ! writing; });
    }

private:
    void run()
    {
        std::unique_lock<std::mutex> guard (lock);
        for (;;)
        {
            ready.wait (guard, [this] { return ! lines.empty(); });
            auto batch = std::move (lines);
            lines.clear();
            waiting = 0;
            writing = true;
            guard.unlock();
            for (const auto& line : batch)
                std::fwrite (line.data(), 1, line.size(), out);
            std::fflush (out);
            guard.lock();
            writing = false;
            written.notify_all();
        }
    }

    const size_t limit;
    FILE* out = nullptr;
    std::mutex lock;
    std::condition_variable ready, written;
    std::deque<std::string> lines;
    size_t waiting = 0;
    bool writing = false;
};

Outlet messages { 0 };
// What plugins print: a log, kept in memory up to a point while no one reads it.
Outlet prints { 4 << 20 };
bool started = false;

/**
 * Plugins print to stdout and stderr (fd 1 and 2) from the message thread. Both go into a pipe of the engine's
 * own, read here into `prints`, so a plugin's print never waits for the server either.
 */
void catchPrints (FILE* stderrCopy)
{
    int fds[2];
   #if JUCE_WINDOWS
    if (_pipe (fds, 1 << 16, _O_BINARY) != 0)
   #else
    if (pipe (fds) != 0)
   #endif
    {
        ENGINE_DUP2 (2, 1);
        return;
    }
    prints.start (stderrCopy);
    ENGINE_DUP2 (fds[1], 1);
    ENGINE_DUP2 (fds[1], 2);
    ENGINE_CLOSE (fds[1]);
    std::thread ([fd = fds[0]] {
        char buffer[4096];
        for (;;)
        {
            const auto n = ENGINE_READ (fd, buffer, sizeof (buffer));
            if (n <= 0)
                return;
            prints.push (std::string (buffer, (size_t) n));
        }
    }).detach();
}
} // namespace

void init()
{
    std::fflush (stdout);
    std::fflush (stderr);
    const auto fd = ENGINE_DUP (1);
    const auto errFd = ENGINE_DUP (2);
    auto* stream = fd >= 0 ? ENGINE_FDOPEN (fd, "wb") : nullptr;
    auto* errStream = errFd >= 0 ? ENGINE_FDOPEN (errFd, "wb") : nullptr;
    if (stream == nullptr || errStream == nullptr)
        return;
    messages.start (stream);
    started = true;
    catchPrints (errStream);
}

void send (const juce::var& message)
{
    auto line = juce::JSON::toString (message, true).toStdString();
    line += '\n';
    if (started)
        return messages.push (std::move (line));
    // (Before `init`: written at once.)
    std::fwrite (line.data(), 1, line.size(), stdout);
    std::fflush (stdout);
}

void finish()
{
    if (started)
        messages.drain (500);
}

void startReading (std::function<void (juce::var)> onMessage, std::function<void()> onClose)
{
    std::thread ([onMessage = std::move (onMessage), onClose = std::move (onClose)] {
        std::string line;
        while (std::getline (std::cin, line))
        {
            if (line.empty())
                continue;
            juce::var message;
            if (juce::JSON::parse (juce::String::fromUTF8 (line.data(), (int) line.size()), message).wasOk() && message.isObject())
                onMessage (message);
        }
        onClose();
    }).detach();
}

juce::var object (std::initializer_list<std::pair<const char*, juce::var>> fields)
{
    auto* result = new juce::DynamicObject();
    for (const auto& [key, value] : fields)
        result->setProperty (key, value);
    return juce::var (result);
}
}

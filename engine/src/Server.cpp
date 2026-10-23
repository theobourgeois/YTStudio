#include "Server.h"

#include <atomic>
#include <cstdio>
#include <cstdlib>
#include <thread>

namespace
{
/** A server that stops this soon after starting, this many times in a row, isn't started again. */
constexpr juce::uint32 quickMs = 10000;
constexpr int quickLimit = 3;
}

/** One run of the server: its process, read by a thread of its own that outlives nothing it touches. */
struct ServerProcess::Run
{
    juce::ChildProcess process;
};

ServerProcess::ServerProcess (juce::StringArray commandToRun, std::function<void()> gaveUp)
    : command (std::move (commandToRun)), onGaveUp (std::move (gaveUp))
{
}

ServerProcess::~ServerProcess()
{
    alive.reset();
    if (current != nullptr && current->process.isRunning())
        current->process.kill();
}

bool ServerProcess::start()
{
    auto run = std::make_shared<Run>();
    if (! run->process.start (command, juce::ChildProcess::wantStdOut | juce::ChildProcess::wantStdErr))
    {
        std::fprintf (stderr, "[server] couldn't start %s\n", command.joinIntoString (" ").toRawUTF8());
        return false;
    }
    current = run;
    startedAt = juce::Time::getMillisecondCounter();
    // What it prints goes to the engine's own output (a terminal in development). A byte at a time: JUCE's read
    // waits for as much as it's asked for, and a line must come out when it's printed.
    std::thread ([run, alive = std::weak_ptr<bool> (alive), this] {
        std::string line;
        char c = 0;
        while (run->process.readProcessOutput (&c, 1) == 1)
        {
            line += c;
            if (c != '\n')
                continue;
            std::fwrite (line.data(), 1, line.size(), stderr);
            std::fflush (stderr);
            line.clear();
        }
        while (run->process.isRunning())
            juce::Thread::sleep (50);
        juce::MessageManager::callAsync ([run, alive, this] {
            if (! alive.expired())
                exited (run);
        });
    }).detach();
    return true;
}

void ServerProcess::exited (const std::shared_ptr<Run>& run)
{
    if (run != current)
        return;
    current = nullptr;
    if (stopping)
        return finished();
    std::fprintf (stderr, "[server] stopped by itself (exit code %u)\n", (unsigned) run->process.getExitCode());
    quickExits = juce::Time::getMillisecondCounter() - startedAt < quickMs ? quickExits + 1 : 0;
    if (quickExits >= quickLimit)
        return onGaveUp();
    juce::Timer::callAfterDelay (1000, [this, alive = std::weak_ptr<bool> (alive)] {
        if (! alive.expired() && ! stopping && current == nullptr && ! start())
            onGaveUp();
    });
}

void ServerProcess::stop (int ms, std::function<void()> done)
{
    stopping = true;
    onStopped = std::move (done);
    if (current == nullptr)
        return finished();
    juce::Timer::callAfterDelay (ms, [this, alive = std::weak_ptr<bool> (alive)] {
        if (alive.expired() || current == nullptr)
            return;
        std::fprintf (stderr, "[server] didn't quit: killed\n");
        current->process.kill();
        current = nullptr;
        finished();
    });
}

void ServerProcess::finished()
{
    if (auto done = std::exchange (onStopped, nullptr))
        done();
}

void ServerProcess::setEnvironment (const juce::String& name, const juce::String& value)
{
   #if JUCE_WINDOWS
    _wputenv_s (name.toWideCharPointer(), value.toWideCharPointer());
   #else
    setenv (name.toRawUTF8(), value.toRawUTF8(), 1);
   #endif
}

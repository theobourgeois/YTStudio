// The music app (docs/apps.md): the engine is the app, and the editor's server (Node) is its child. Started with
// what to run, it's kept running: one that stops by itself is started again, as the server used to start the
// engine again, unless it keeps stopping as soon as it starts.
#pragma once

#include <juce_events/juce_events.h>
#include <memory>

class ServerProcess
{
public:
    /** `command`: the program and its arguments. `onGaveUp` (message thread): it kept stopping, so it isn't started again. */
    ServerProcess (juce::StringArray command, std::function<void()> onGaveUp);
    /** Kills it if it's still running. */
    ~ServerProcess();

    bool start();

    /** It's asked to quit by now (`shellClosed`): wait up to `ms` for it to, then kill it. `done` on the message thread. */
    void stop (int ms, std::function<void()> done);

    /** Set an environment variable for the server: the child has the engine's own environment. */
    static void setEnvironment (const juce::String& name, const juce::String& value);

private:
    struct Run;
    void exited (const std::shared_ptr<Run>& run);
    void finished();

    const juce::StringArray command;
    const std::function<void()> onGaveUp;
    std::shared_ptr<Run> current;
    juce::uint32 startedAt = 0;
    int quickExits = 0;
    bool stopping = false;
    std::function<void()> onStopped;
    std::shared_ptr<bool> alive = std::make_shared<bool> (true);
};

// The engine's program: started by the server with
//
//   "YTStudio Engine" --data <dir> [--plugin-path <dir>]... [--offline] [--only-plugin-paths] [--window <url>]
//
// it answers commands until the server closes its stdin (so it never outlives the app). With `--window` it also
// shows the app at that address in a window of its own (the shell: ShellWindow.h), and closing it quits.
#include "Engine.h"
#include "Protocol.h"
#include "ShellWindow.h"

class EngineApplication final : public juce::JUCEApplication
{
public:
    const juce::String getApplicationName() override { return "YTStudio Engine"; }
    const juce::String getApplicationVersion() override { return "0.1.0"; }
    bool moreThanOneInstanceAllowed() override { return true; }

    void initialise (const juce::String&) override
    {
        protocol::init();

        auto dataDir = juce::File::getSpecialLocation (juce::File::tempDirectory).getChildFile ("vaudio-engine");
        juce::StringArray pluginPaths;
        juce::String window;
        const auto args = getCommandLineParameterArray();
        for (int i = 0; i + 1 < args.size(); ++i)
        {
            if (args[i] == "--data")
                dataDir = juce::File::getCurrentWorkingDirectory().getChildFile (args[i + 1]);
            else if (args[i] == "--plugin-path")
                pluginPaths.add (juce::File::getCurrentWorkingDirectory().getChildFile (args[i + 1]).getFullPathName());
            else if (args[i] == "--window")
                window = args[i + 1];
        }

        engine = std::make_unique<Engine> (dataDir, pluginPaths, args.contains ("--offline"), args.contains ("--only-plugin-paths"));
        if (window.isNotEmpty())
            shell = std::make_unique<ShellWindow> (window, *engine, dataDir);
        protocol::send (protocol::object ({ { "event", "ready" }, { "status", engine->status() } }));

        protocol::startReading (
            [this] (juce::var message) { juce::MessageManager::callAsync ([this, message] { run (message); }); },
            [] { juce::MessageManager::callAsync ([] { quit(); }); });
    }

    /** The shell's window closed, or ⌘Q: the server is told, so it quits too rather than start the engine again. */
    void systemRequestedQuit() override
    {
        if (shell != nullptr)
            protocol::send (protocol::object ({ { "event", "shellClosed" } }));
        quit();
    }

    void shutdown() override
    {
        // (Before the engine: plugin windows belong to it.)
        shell.reset();
        engine.reset();
        protocol::finish();
    }

private:
    void run (const juce::var& message)
    {
        if (engine == nullptr)
            return;
        const auto id = message["id"];
        engine->handle (message["cmd"].toString(), message, [id] (const juce::Result& result, const juce::var& value) {
            if (result.wasOk())
                protocol::send (protocol::object ({ { "id", id }, { "ok", true }, { "result", value } }));
            else
                protocol::send (protocol::object ({ { "id", id }, { "ok", false }, { "error", result.getErrorMessage() } }));
        });
    }

    std::unique_ptr<Engine> engine;
    std::unique_ptr<ShellWindow> shell;
};

START_JUCE_APPLICATION (EngineApplication)

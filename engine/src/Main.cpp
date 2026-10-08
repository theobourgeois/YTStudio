// The engine's program: started by the server with
//
//   "YTStudio Engine" --data <dir> [--plugin-path <dir>]... [--offline] [--only-plugin-paths]
//
// it answers commands until the server closes its stdin (so it never outlives the app).
#include "Engine.h"
#include "Protocol.h"

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
        const auto args = getCommandLineParameterArray();
        for (int i = 0; i + 1 < args.size(); ++i)
        {
            if (args[i] == "--data")
                dataDir = juce::File::getCurrentWorkingDirectory().getChildFile (args[i + 1]);
            else if (args[i] == "--plugin-path")
                pluginPaths.add (juce::File::getCurrentWorkingDirectory().getChildFile (args[i + 1]).getFullPathName());
        }

        engine = std::make_unique<Engine> (dataDir, pluginPaths, args.contains ("--offline"), args.contains ("--only-plugin-paths"));
        protocol::send (protocol::object ({ { "event", "ready" }, { "status", engine->status() } }));

        protocol::startReading (
            [this] (juce::var message) { juce::MessageManager::callAsync ([this, message] { run (message); }); },
            [] { juce::MessageManager::callAsync ([] { quit(); }); });
    }

    void shutdown() override { engine.reset(); }

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
};

START_JUCE_APPLICATION (EngineApplication)

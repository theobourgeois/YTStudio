// The engine's program, in one of two ways:
//
// - Started by a server (the Electron apps, the tests) with
//
//     "YTStudio Engine" --data <dir> [--plugin-path <dir>]... [--offline] [--only-plugin-paths]
//
//   it answers commands on its stdin until the server closes it (so it never outlives the app).
//
// - The music app (docs/apps.md): the engine is the app. It starts the editor's server itself (Node, its child) and
//   answers it over a socket on 127.0.0.1, then shows the page the server says in a window of its own
//   (ShellWindow.h), and closing that quits both. Packaged, everything is in the app's resources (`app/`: Node,
//   the server's bundle, the page); in development (`pnpm dev:music`, scripts/shell.ts) it's given:
//
//     "YTStudio Engine" --data <dir> --server <node> [--server-arg <arg>]... [--page <url>] [--carry-from <dir>]
//
//   `--page` shows that address instead of the server's (Vite's, so the page reloads as it's edited).
#include "Engine.h"
#include "HostCommands.h"
#include "Protocol.h"
#include "Server.h"
#include "ShellWindow.h"

namespace
{
/** What the music app ships beside the engine: Node, the server's bundle (`server.mjs`), the page (`dist/`). */
juce::File appResources()
{
   #if JUCE_MAC
    return juce::File::getSpecialLocation (juce::File::currentApplicationFile).getChildFile ("Contents/Resources/app");
   #else
    return juce::File::getSpecialLocation (juce::File::currentExecutableFile).getSiblingFile ("app");
   #endif
}

juce::File bundledServer() { return appResources().getChildFile ("server.mjs"); }

/** The music app, rather than an engine a server started: told what to run, or shipped with it. */
bool isApp (const juce::StringArray& args)
{
    return args.contains ("--server") || (! args.contains ("--data") && bundledServer().existsAsFile());
}

/** Where the system keeps an app's own data (Electron's `appData`). */
juce::File appData()
{
    const auto library = juce::File::getSpecialLocation (juce::File::userApplicationDataDirectory);
   #if JUCE_MAC
    return library.getChildFile ("Application Support");
   #else
    return library;
   #endif
}

juce::String environment (const char* name) { return juce::SystemStats::getEnvironmentVariable (name, {}); }

/** Sets `name` for the server unless it's set already (by whoever started the app, a test). */
void defaultEnvironment (const char* name, const juce::String& value)
{
    if (environment (name).isEmpty())
        ServerProcess::setEnvironment (name, value);
}

/**
 * The engine's settings a new app starts with: what YTStudio's engine knew (its plugins scanned, its audio device,
 * MIDI inputs, the user's presets), each copied once if this app has none of its own.
 */
void carryOver (const juce::File& from, const juce::File& to)
{
    if (! from.isDirectory() || from == to)
        return;
    to.createDirectory();
    for (const auto* name : { "plugins.xml", "device.xml", "midi.json" })
        if (from.getChildFile (name).existsAsFile() && ! to.getChildFile (name).exists())
            from.getChildFile (name).copyFileTo (to.getChildFile (name));
    if (from.getChildFile ("presets").isDirectory() && ! to.getChildFile ("presets").exists())
        from.getChildFile ("presets").copyDirectoryTo (to.getChildFile ("presets"));
}

#if JUCE_MAC
/**
 * An app opened from Finder or the Dock gets launchd's bare PATH, not the one the user's shell sets up, so the
 * server wouldn't find ffmpeg, yt-dlp, claude or codex: the login shell's, then Homebrew's homes, as the Electron
 * apps do (electron/shell-path.ts).
 */
void useLoginShellPath()
{
    const juce::String mark = "__EDITOR_PATH__";
    const auto shell = environment ("SHELL").isNotEmpty() ? environment ("SHELL") : juce::String ("/bin/zsh");
    juce::ChildProcess child;
    juce::String printed;
    if (child.start (juce::StringArray { shell, "-ilc", "printf '%s' \"" + mark + "$PATH" + mark + "\"" }, juce::ChildProcess::wantStdOut))
    {
        // (It prints a line: done before a pipe could fill. A shell that hangs is given up on.)
        if (child.waitForProcessToFinish (5000))
            printed = child.readAllProcessOutput();
        else
            child.kill();
    }
    juce::StringArray dirs;
    const auto from = printed.indexOf (mark);
    const auto to = from < 0 ? -1 : printed.indexOf (from + mark.length(), mark);
    if (to > from)
        dirs.addTokens (printed.substring (from + mark.length(), to), ":", {});
    dirs.addTokens (environment ("PATH"), ":", {});
    dirs.addArray ({ "/opt/homebrew/bin", "/opt/homebrew/sbin", "/usr/local/bin", juce::File::getSpecialLocation (juce::File::userHomeDirectory).getChildFile (".local/bin").getFullPathName() });
    dirs.removeEmptyStrings();
    dirs.removeDuplicates (false);
    ServerProcess::setEnvironment ("PATH", dirs.joinIntoString (":"));
}
#endif

juce::String randomToken()
{
    juce::Random random;
    juce::String token;
    for (int i = 0; i < 4; ++i)
        token << juce::String::toHexString (random.nextInt64());
    return token;
}
} // namespace

class EngineApplication final : public juce::JUCEApplication
{
public:
    const juce::String getApplicationName() override { return isApp (getCommandLineParameterArray()) ? "YTStudio Music" : "YTStudio Engine"; }
    const juce::String getApplicationVersion() override { return "0.1.0"; }
    /** The packaged music app is one: a file opened again goes to the one running (`anotherInstanceStarted`). */
    bool moreThanOneInstanceAllowed() override
    {
        const auto args = getCommandLineParameterArray();
        return ! isApp (args) || args.contains ("--server");
    }

    void initialise (const juce::String& commandLine) override
    {
        auto dataDir = juce::File::getSpecialLocation (juce::File::tempDirectory).getChildFile ("vaudio-engine");
        juce::StringArray pluginPaths, serverArgs;
        juce::String server, page, carryFrom;
        const auto args = getCommandLineParameterArray();
        const auto here = juce::File::getCurrentWorkingDirectory();
        for (int i = 0; i + 1 < args.size(); ++i)
        {
            if (args[i] == "--data")
                dataDir = here.getChildFile (args[i + 1]);
            else if (args[i] == "--plugin-path")
                pluginPaths.add (here.getChildFile (args[i + 1]).getFullPathName());
            else if (args[i] == "--server")
                server = args[i + 1];
            else if (args[i] == "--server-arg")
                serverArgs.add (args[i + 1]);
            else if (args[i] == "--page")
                page = args[i + 1];
            else if (args[i] == "--carry-from")
                carryFrom = here.getChildFile (args[i + 1]).getFullPathName();
        }

        app = isApp (args);
        if (! app)
        {
            protocol::init();
            engine = std::make_unique<Engine> (dataDir, pluginPaths, args.contains ("--offline"), args.contains ("--only-plugin-paths"));
            protocol::send (protocol::object ({ { "event", "ready" }, { "status", engine->status() } }));
            protocol::startReading (
                [this] (juce::var message) { juce::MessageManager::callAsync ([this, message] { run (message); }); },
                [] { juce::MessageManager::callAsync ([] { quit(); }); });
            return;
        }

        pageOverride = page;
        waitingFiles = hostCommands::filesIn (commandLine);
        juce::StringArray command;
        if (server.isEmpty())
        {
            // Packaged: the app's own data, as the Electron apps keep theirs (electron/main.ts).
            const auto resources = appResources();
            const auto userData = appData().getChildFile ("YTStudio Music");
            // A data folder given (tests, throwaway setups) keeps its projects in its own Documents/YTStudio (server/config.ts).
            if (environment ("EDITOR_DATA_DIR").isEmpty())
            {
                defaultEnvironment ("EDITOR_DATA_DIR", userData.getChildFile ("data").getFullPathName());
                defaultEnvironment ("EDITOR_PROJECTS_DIR", juce::File::getSpecialLocation (juce::File::userDocumentsDirectory).getChildFile ("YTStudio").getFullPathName());
            }
            const auto every = appData().getChildFile ("YTStudio").getChildFile ("data");
            if (every.isDirectory())
                defaultEnvironment ("EDITOR_RECENTS_FROM", every.getFullPathName());
            defaultEnvironment ("EDITOR_SERVER_PORT", "5651");
            defaultEnvironment ("EDITOR_CLIENT_DIR", resources.getChildFile ("dist").getFullPathName());
            defaultEnvironment ("EDITOR_MUSIC_WORKER_PATH", resources.getChildFile ("music-worker/ml-worker.mjs").getFullPathName());
            defaultEnvironment ("EDITOR_PHOTO_HELPER_PATH", resources.getChildFile ("photo-helper/helper.mjs").getFullPathName());
            // (Home's previews play songs offline in engines of their own: this program, as a plain engine.)
            defaultEnvironment ("EDITOR_ENGINE_PATH", juce::File::getSpecialLocation (juce::File::currentExecutableFile).getFullPathName());
            ServerProcess::setEnvironment ("NODE_ENV", "production");
           #if JUCE_MAC
            useLoginShellPath();
           #endif
            dataDir = juce::File (environment ("EDITOR_DATA_DIR")).getChildFile ("engine");
            if (carryFrom.isEmpty())
                carryFrom = every.getChildFile ("engine").getFullPathName();
           #if JUCE_WINDOWS
            command.add (resources.getChildFile ("node.exe").getFullPathName());
           #else
            command.add (resources.getChildFile ("node").getFullPathName());
           #endif
            command.add (bundledServer().getFullPathName());
        }
        else
        {
            command.add (server);
            command.addArray (serverArgs);
        }
        if (carryFrom.isNotEmpty())
            carryOver (juce::File (carryFrom), dataDir);

        protocol::init (true);
        engineData = dataDir;
        engine = std::make_unique<Engine> (dataDir, pluginPaths, false, args.contains ("--only-plugin-paths"));

        // The server reaches the engine on a port of its own, proving it's ours with a token only its child knows.
        const auto token = randomToken();
        const auto port = protocol::serve (
            token,
            [this] { juce::MessageManager::callAsync ([this] { if (engine != nullptr) protocol::send (protocol::object ({ { "event", "ready" }, { "status", engine->status() } })); }); },
            [this] (juce::var message) { juce::MessageManager::callAsync ([this, message] { run (message); }); },
            // (The server went away: it's started again, and the next one connects.)
            [] {});
        if (port == 0)
            return fail ("YTStudio Music couldn't listen for its server.");
        ServerProcess::setEnvironment ("EDITOR_ENGINE_CONNECT", juce::String (port) + ":" + token);
        ServerProcess::setEnvironment ("EDITOR_APP", "music");

        serverProcess = std::make_unique<ServerProcess> (command, [this] {
            const auto data = environment ("EDITOR_DATA_DIR");
            fail ("YTStudio Music's server keeps stopping." + (data.isNotEmpty() ? " What it said is in " + juce::File (data).getChildFile ("logs").getFullPathName() + "." : juce::String()));
        });
        if (! serverProcess->start())
            fail ("YTStudio Music couldn't start its server (" + command[0] + ").");
    }

    /** A file opened while the app runs (Finder, Explorer, dropped on its icon): the page opens it. */
    void anotherInstanceStarted (const juce::String& commandLine) override
    {
        const auto files = hostCommands::filesIn (commandLine);
        if (files.isEmpty())
            return;
        if (shell != nullptr)
            shell->openFiles (files);
        else
            waitingFiles.addArray (files);
    }

    /**
     * The window closed, or ⌘Q. Started by a server: it's told, so it quits too rather than start the engine again.
     * The music app: the page saves first, then the server is told and given a moment to finish, then both quit.
     */
    void systemRequestedQuit() override
    {
        if (! app)
            return quit();
        if (quitting)
            return;
        quitting = true;
        auto stopServer = [this] {
            protocol::send (protocol::object ({ { "event", "shellClosed" } }));
            if (serverProcess == nullptr)
                return quit();
            serverProcess->stop (3000, [] { quit(); });
        };
        if (shell != nullptr)
            shell->flush (5000, stopServer);
        else
            stopServer();
    }

    void shutdown() override
    {
        // (Before the engine: plugin windows belong to it.)
        shell.reset();
        if (app)
            protocol::stopServing();
        serverProcess.reset();
        engine.reset();
        protocol::finish();
    }

private:
    void run (const juce::var& message)
    {
        if (engine == nullptr)
            return;
        const auto id = message["id"];
        const auto command = message["cmd"].toString();
        auto complete = [id] (const juce::Result& result, const juce::var& value) {
            if (result.wasOk())
                protocol::send (protocol::object ({ { "id", id }, { "ok", true }, { "result", value } }));
            else
                protocol::send (protocol::object ({ { "id", id }, { "ok", false }, { "error", result.getErrorMessage() } }));
        };
        if (app && command == "page")
            return showPage (message["url"].toString(), complete);
        if (app && hostCommands::runForServer (command, message, complete))
            return;
        engine->handle (command, message, std::move (complete));
    }

    /** The server is listening at `url` (`page`): the window shows it, opened the first time. */
    void showPage (const juce::String& url, const hostCommands::Complete& complete)
    {
        if (url.isEmpty())
            return complete (juce::Result::fail ("\"url\" must be the page's address."), {});
        complete (juce::Result::ok(), {});
        if (quitting)
            return;
        if (shell == nullptr)
        {
            shell = std::make_unique<ShellWindow> (pageOverride.isNotEmpty() ? pageOverride : url, *engine, engineData);
            if (! waitingFiles.isEmpty())
                shell->openFiles (std::exchange (waitingFiles, {}));
        }
        else if (pageOverride.isEmpty())
            shell->show (url);
    }

    /** Something the app can't do without: said, then it quits. */
    void fail (const juce::String& message)
    {
        std::fprintf (stderr, "[app] %s\n", message.toRawUTF8());
        quitting = true;
        juce::AlertWindow::showAsync (juce::MessageBoxOptions()
                                          .withIconType (juce::MessageBoxIconType::WarningIcon)
                                          .withTitle ("YTStudio Music")
                                          .withMessage (message)
                                          .withButton ("Quit"),
                                      [] (int) { quit(); });
    }

    bool app = false;
    bool quitting = false;
    juce::String pageOverride;
    juce::File engineData;
    juce::StringArray waitingFiles;
    std::unique_ptr<Engine> engine;
    std::unique_ptr<ServerProcess> serverProcess;
    std::unique_ptr<ShellWindow> shell;
};

START_JUCE_APPLICATION (EngineApplication)

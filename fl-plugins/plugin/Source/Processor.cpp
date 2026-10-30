#include "Processor.h"

#define WIN32_LEAN_AND_MEAN
#define NOMINMAX
#include <windows.h>

YTProcessor::YTProcessor()
    : AudioProcessor (BusesProperties()
                          .withInput ("Input", juce::AudioChannelSet::stereo(), true)
                          .withOutput ("Output", juce::AudioChannelSet::stereo(), true))
{
}

YTProcessor::~YTProcessor()
{
    worker.stop();
}

bool YTProcessor::isBusesLayoutSupported (const BusesLayout& layouts) const
{
    const auto out = layouts.getMainOutputChannelSet();
    return ! out.isDisabled() && out == layouts.getMainInputChannelSet();
}

juce::AudioProcessorEditor* YTProcessor::createEditor()
{
    return createPluginWindow (*this);
}

// The worker

/** The worker and the rest of its Python are in the plugin's Resources folder, with python.txt naming the Python that
    install.py ran with. */
juce::String YTProcessor::commandLine (juce::String& problem) const
{
    const auto dll = juce::File::getSpecialLocation (juce::File::currentExecutableFile);
    const auto folder = dll.getParentDirectory().getParentDirectory().getChildFile ("Resources").getChildFile ("worker");
    const auto script = folder.getChildFile (workerScript());
    if (! script.existsAsFile())
    {
        problem = juce::String (JucePlugin_Name) + "'s worker isn't in the plugin (" + script.getFullPathName() + "). Install the plugin again.";
        return {};
    }
    auto python = folder.getChildFile ("python.txt").loadFileAsString().trim();
    if (python.isEmpty() || ! juce::File (python).existsAsFile())
    {
        problem = juce::String (JucePlugin_Name) + " can't find its Python (" + python + "). Install the plugin again (plugin/install.py).";
        return {};
    }
    // -E: FL runs Python of its own and may set PYTHONHOME or PYTHONPATH, which this process would inherit
    return python.quoted() + " -E -u " + script.getFullPathName().quoted() + " "
         + juce::String ((int) GetCurrentProcessId());
}

void YTProcessor::startWorker()
{
    if (worker.isRunning())
        return;
    juce::String problem;
    const auto cmd = commandLine (problem);
    if (cmd.isNotEmpty())
    {
        juce::WeakReference<YTProcessor> self (this);
        problem = worker.start (cmd, [self] (const juce::String& line) {
            juce::MessageManager::callAsync ([self, line] {
                if (auto* p = self.get())
                    p->heard (line);
            });
        });
    }
    if (problem.isNotEmpty())
    {
        addLog (problem, true);
        return;
    }
    auto init = std::make_unique<juce::DynamicObject>();
    init->setProperty ("cmd", "init");
    init->setProperty ("saved", saved);
    send (juce::var (init.release()));
}

void YTProcessor::send (const juce::var& command)
{
    if (! worker.isRunning())
    {
        startWorker();
        if (! worker.isRunning())
            return;
        if (command["cmd"].toString() == "init")
            return;
    }
    worker.send (juce::JSON::toString (command, true));
}

void YTProcessor::heard (const juce::String& line)
{
    if (line.isEmpty())
    {
        addLog (juce::String (JucePlugin_Name) + "'s worker stopped. Close and reopen this window to start it again.", true);
        auto off = std::make_unique<juce::DynamicObject>();
        off->setProperty ("ev", "view");
        off->setProperty ("status", juce::String (JucePlugin_Name) + "'s worker stopped");
        view = juce::var (off.release());
        listeners.call ([this] (Listener& l) { l.workerSaid (view); });
        return;
    }
    const auto event = juce::JSON::parse (line);
    const auto ev = event["ev"].toString();
    if (ev.isEmpty())
    {
        addLog (line, true); // Python's own output: a traceback, a warning
        return;
    }
    if (ev == "view")
        view = event;
    else if (ev == "log")
    {
        addLog (event["text"].toString(), (bool) event["error"]);
        return;
    }
    else if (ev == "progress")
        progress = (double) event["value"];
    else if (ev == "save")
        saved = event["state"];
    listeners.call ([&] (Listener& l) { l.workerSaid (event); });
}

void YTProcessor::addLog (const juce::String& text, bool error)
{
    LogLine line { juce::Time::getCurrentTime().formatted ("%H:%M:%S"), text, error };
    logLines.add (line);
    if (logLines.size() > 300)
        logLines.removeRange (0, logLines.size() - 300);
    auto event = std::make_unique<juce::DynamicObject>();
    event->setProperty ("ev", "log");
    event->setProperty ("time", line.time);
    event->setProperty ("text", text);
    event->setProperty ("error", error);
    const juce::var e (event.release());
    listeners.call ([&] (Listener& l) { l.workerSaid (e); });
}

void YTProcessor::focusFL()
{
    struct Find
    {
        DWORD pid;
        HWND found;
    } find { GetCurrentProcessId(), nullptr };
    EnumWindows (
        [] (HWND h, LPARAM param) -> BOOL {
            auto* f = reinterpret_cast<Find*> (param);
            DWORD pid = 0;
            GetWindowThreadProcessId (h, &pid);
            wchar_t cls[64] {};
            GetClassNameW (h, cls, 64);
            if (pid == f->pid && IsWindowVisible (h) && wcscmp (cls, L"TFruityLoopsMainForm") == 0)
            {
                f->found = h;
                return FALSE;
            }
            return TRUE;
        },
        reinterpret_cast<LPARAM> (&find));
    if (find.found != nullptr)
    {
        SetForegroundWindow (find.found); // FL's own thread, and its window was just clicked: Windows allows it
        SetFocus (find.found);
    }
}

// The project keeps what the worker asked to keep

void YTProcessor::getStateInformation (juce::MemoryBlock& destData)
{
    juce::MemoryOutputStream (destData, false).writeString (juce::JSON::toString (saved, true));
}

void YTProcessor::setStateInformation (const void* data, int sizeInBytes)
{
    const auto json = juce::MemoryInputStream (data, (size_t) sizeInBytes, false).readString();
    saved = juce::JSON::parse (json);
    if (worker.isRunning())
    {
        auto init = std::make_unique<juce::DynamicObject>();
        init->setProperty ("cmd", "init");
        init->setProperty ("saved", saved);
        send (juce::var (init.release()));
    }
}

juce::AudioProcessor* JUCE_CALLTYPE createPluginFilter()
{
    return new YTProcessor();
}

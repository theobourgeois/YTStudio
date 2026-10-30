#include "Worker.h"

#define WIN32_LEAN_AND_MEAN
#define NOMINMAX
#include <windows.h>

Worker::~Worker()
{
    stop();
}

juce::String Worker::start (const juce::String& commandLine, LineHandler onLine)
{
    stop();
    handler = std::move (onLine);

    SECURITY_ATTRIBUTES inherit { sizeof (inherit), nullptr, TRUE };
    HANDLE childIn = nullptr, childOut = nullptr, ourIn = nullptr, ourOut = nullptr;
    if (! CreatePipe (&childIn, &ourIn, &inherit, 0) || ! CreatePipe (&ourOut, &childOut, &inherit, 0))
        return "Couldn't make the pipes to the plugin's worker.";
    SetHandleInformation (ourIn, HANDLE_FLAG_INHERIT, 0);
    SetHandleInformation (ourOut, HANDLE_FLAG_INHERIT, 0);

    // Only these two handles go to the worker: FL's process has others it mustn't inherit.
    HANDLE handles[] = { childIn, childOut };
    SIZE_T size = 0;
    InitializeProcThreadAttributeList (nullptr, 1, 0, &size);
    juce::HeapBlock<char> attrMemory (size);
    auto attrs = reinterpret_cast<LPPROC_THREAD_ATTRIBUTE_LIST> (attrMemory.getData());
    InitializeProcThreadAttributeList (attrs, 1, 0, &size);
    UpdateProcThreadAttribute (attrs, 0, PROC_THREAD_ATTRIBUTE_HANDLE_LIST, handles, sizeof (handles), nullptr, nullptr);

    STARTUPINFOEXW si {};
    si.StartupInfo.cb = sizeof (si);
    si.StartupInfo.dwFlags = STARTF_USESTDHANDLES;
    si.StartupInfo.hStdInput = childIn;
    si.StartupInfo.hStdOutput = childOut;
    si.StartupInfo.hStdError = childOut;
    si.lpAttributeList = attrs;

    PROCESS_INFORMATION pi {};
    std::wstring cmd = commandLine.toWideCharPointer(); // CreateProcessW may write to it
    const auto ok = CreateProcessW (nullptr, cmd.data(), nullptr, nullptr, TRUE,
                                    CREATE_NO_WINDOW | CREATE_SUSPENDED | EXTENDED_STARTUPINFO_PRESENT, nullptr,
                                    nullptr, &si.StartupInfo, &pi);
    const auto error = GetLastError();
    DeleteProcThreadAttributeList (attrs);
    CloseHandle (childIn);
    CloseHandle (childOut);
    if (! ok)
    {
        CloseHandle (ourIn);
        CloseHandle (ourOut);
        return "Couldn't start the plugin's worker (error " + juce::String ((int) error) + "): " + commandLine;
    }

    job = CreateJobObjectW (nullptr, nullptr);
    if (job != nullptr)
    {
        JOBOBJECT_EXTENDED_LIMIT_INFORMATION limits {};
        limits.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;
        SetInformationJobObject (job, JobObjectExtendedLimitInformation, &limits, sizeof (limits));
        AssignProcessToJobObject (job, pi.hProcess);
    }
    ResumeThread (pi.hThread);
    CloseHandle (pi.hThread);

    process = pi.hProcess;
    toChild = ourIn;
    fromChild = ourOut;
    running = true;
    reader = std::thread ([this] { read(); });
    return {};
}

void Worker::read()
{
    juce::MemoryBlock pending;
    char buffer[4096];
    for (;;)
    {
        DWORD got = 0;
        if (! ReadFile (fromChild, buffer, sizeof (buffer), &got, nullptr) || got == 0)
            break;
        pending.append (buffer, got);
        for (;;)
        {
            auto* data = static_cast<const char*> (pending.getData());
            const auto size = pending.getSize();
            size_t end = 0;
            while (end < size && data[end] != '\n')
                ++end;
            if (end == size)
                break;
            const auto line = juce::String::fromUTF8 (data, (int) end).trimEnd();
            pending.removeSection (0, end + 1);
            if (line.isNotEmpty() && handler)
                handler (line);
        }
    }
    running = false;
    if (handler)
        handler ({}); // the worker has gone
}

bool Worker::send (const juce::String& line)
{
    if (toChild == nullptr || ! running)
        return false;
    const auto utf8 = (line + "\n").toStdString();
    DWORD wrote = 0;
    return WriteFile (toChild, utf8.data(), (DWORD) utf8.size(), &wrote, nullptr) && wrote == utf8.size();
}

bool Worker::isRunning() const
{
    return running;
}

void Worker::stop()
{
    if (toChild != nullptr)
    {
        CloseHandle (toChild); // the worker reads to the end of its input, then tidies up and quits
        toChild = nullptr;
    }
    if (process != nullptr)
    {
        if (WaitForSingleObject (process, 2000) != WAIT_OBJECT_0)
            TerminateJobObject (job, 1);
        WaitForSingleObject (process, 2000);
    }
    if (reader.joinable())
        reader.join();
    for (auto* h : { process, job, fromChild })
        if (h != nullptr)
            CloseHandle (h);
    process = job = fromChild = nullptr;
    running = false;
}

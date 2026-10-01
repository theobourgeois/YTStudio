#include "Protocol.h"

#include <cstdio>
#include <iostream>
#include <mutex>
#include <string>
#include <thread>

#if JUCE_WINDOWS
 #include <io.h>
 #define ENGINE_DUP _dup
 #define ENGINE_DUP2 _dup2
 #define ENGINE_FDOPEN _fdopen
#else
 #include <unistd.h>
 #define ENGINE_DUP dup
 #define ENGINE_DUP2 dup2
 #define ENGINE_FDOPEN fdopen
#endif

namespace protocol
{
static FILE* out = stdout;
static std::mutex outLock;

void init()
{
    std::fflush (stdout);
    const auto fd = ENGINE_DUP (1);
    if (fd < 0)
        return;
    if (auto* stream = ENGINE_FDOPEN (fd, "w"))
    {
        out = stream;
        ENGINE_DUP2 (2, 1);
    }
}

void send (const juce::var& message)
{
    const auto line = juce::JSON::toString (message, true).toStdString();
    const std::lock_guard<std::mutex> guard (outLock);
    std::fwrite (line.data(), 1, line.size(), out);
    std::fputc ('\n', out);
    std::fflush (out);
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

// (Before JUCE's headers: Windows' sockets bring windows.h, which must leave min and max alone.)
#ifdef _WIN32
 #ifndef NOMINMAX
  #define NOMINMAX
 #endif
 #ifndef WIN32_LEAN_AND_MEAN
  #define WIN32_LEAN_AND_MEAN
 #endif
 #include <winsock2.h>
#endif

#include "Protocol.h"

#include <atomic>
#include <condition_variable>
#include <cstdio>
#include <deque>
#include <iostream>
#include <memory>
#include <mutex>
#include <string>
#include <thread>
#include <utility>

#if JUCE_WINDOWS
 #include <fcntl.h>
 #include <io.h>
 #define ENGINE_DUP _dup
 #define ENGINE_DUP2 _dup2
 #define ENGINE_FDOPEN _fdopen
 #define ENGINE_CLOSE _close
 #define ENGINE_READ _read
#else
 #include <cerrno>
 #include <fcntl.h>
 #include <signal.h>
 #include <sys/socket.h>
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
    explicit Outlet (size_t maxWaiting) : limit (maxWaiting) {}

    /** `write` takes each batch of lines, on the outlet's thread. */
    void start (std::function<void (const std::string&)> writer)
    {
        write = std::move (writer);
        std::thread ([this] { run(); }).detach();
    }

    void start (FILE* stream)
    {
        start ([stream] (const std::string& batch) {
            std::fwrite (batch.data(), 1, batch.size(), stream);
            std::fflush (stream);
        });
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
            std::string joined;
            for (const auto& line : batch)
                joined += line;
            write (joined);
            guard.lock();
            writing = false;
            written.notify_all();
        }
    }

    const size_t limit;
    std::function<void (const std::string&)> write;
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
 * The music app (`serve`): the server is the engine's child and reaches it over a socket on 127.0.0.1, one
 * connection at a time (a server restarted, as `node --watch` does in development, connects again). Nothing is
 * kept for a server that isn't there: the next one is sent `ready`, and gives the song back.
 */
bool overSocket = false;
std::mutex connectionLock;
std::shared_ptr<juce::StreamingSocket> connection;
std::atomic<bool> connected { false };
juce::StreamingSocket listener;

std::shared_ptr<juce::StreamingSocket> current()
{
    const std::lock_guard<std::mutex> guard (connectionLock);
    return connection;
}

/** A socket the server's process (started later) mustn't inherit: it would hold it open after the engine let go. */
void notInherited ([[maybe_unused]] int handle)
{
   #if ! JUCE_WINDOWS
    if (handle >= 0)
        fcntl (handle, F_SETFD, FD_CLOEXEC);
   #endif
}

/*
 * The server's socket is read and written straight through its handle, blocking: JUCE's `read` that returns what has
 * come makes the socket non-blocking (and its `write` sends once), so a big song would go half-written from the
 * writer's thread while the reader's waits.
 */
#if JUCE_WINDOWS
using Handle = SOCKET;
#else
using Handle = int;
#endif

#if JUCE_WINDOWS
using Length = int;
#else
using Length = size_t;
#endif

Handle handleOf (juce::StreamingSocket& socket) { return (Handle) socket.getRawSocketHandle(); }

/** Blocking (an accepted socket takes the listener's mode), and no SIGPIPE when the server has gone. */
void prepare (juce::StreamingSocket& socket)
{
    const auto handle = handleOf (socket);
   #if JUCE_WINDOWS
    u_long blocking = 0;
    ioctlsocket (handle, FIONBIO, &blocking);
   #else
    fcntl (handle, F_SETFL, fcntl (handle, F_GETFL) & ~O_NONBLOCK);
   #if defined (SO_NOSIGPIPE)
    int on = 1;
    setsockopt (handle, SOL_SOCKET, SO_NOSIGPIPE, &on, sizeof (on));
   #endif
   #endif
}

/** What has come, waiting until something does: 0 once the server closed it, below 0 if it failed. */
int receive (juce::StreamingSocket& socket, char* buffer, int size)
{
    for (;;)
    {
        const auto n = ::recv (handleOf (socket), buffer, (Length) size, 0);
       #if ! JUCE_WINDOWS
        if (n < 0 && errno == EINTR)
            continue;
       #endif
        return (int) n;
    }
}

/** All of it, or false if the server has gone. */
bool sendAll (juce::StreamingSocket& socket, const char* data, size_t size)
{
   #if defined (MSG_NOSIGNAL)
    constexpr int flags = MSG_NOSIGNAL;
   #else
    constexpr int flags = 0;
   #endif
    while (size > 0)
    {
        const auto n = ::send (handleOf (socket), data, (Length) juce::jmin (size, (size_t) (1 << 30)), flags);
        if (n <= 0)
        {
           #if ! JUCE_WINDOWS
            if (n < 0 && errno == EINTR)
                continue;
           #endif
            return false;
        }
        data += n;
        size -= (size_t) n;
    }
    return true;
}

void parse (const std::string& line, const std::function<void (juce::var)>& onMessage)
{
    if (line.empty())
        return;
    juce::var message;
    if (juce::JSON::parse (juce::String::fromUTF8 (line.data(), (int) line.size()), message).wasOk() && message.isObject())
        onMessage (message);
}

/** One server's connection: its first line must be the token, then it's the server until it closes or another comes. */
void readFrom (std::shared_ptr<juce::StreamingSocket> socket, juce::String token, std::function<void()> onConnect,
               std::function<void (juce::var)> onMessage, std::function<void()> onClose)
{
    std::string pending;
    bool admitted = false;
    char buffer[1 << 16];
    for (;;)
    {
        const auto n = receive (*socket, buffer, (int) sizeof (buffer));
        if (n <= 0)
            break;
        pending.append (buffer, (size_t) n);
        for (auto end = pending.find ('\n'); end != std::string::npos; end = pending.find ('\n'))
        {
            auto line = pending.substr (0, end);
            pending.erase (0, end + 1);
            if (! line.empty() && line.back() == '\r')
                line.pop_back();
            if (admitted)
            {
                parse (line, onMessage);
                continue;
            }
            if (juce::String::fromUTF8 (line.data(), (int) line.size()) != token)
                return socket->close();
            admitted = true;
            std::shared_ptr<juce::StreamingSocket> last;
            {
                const std::lock_guard<std::mutex> guard (connectionLock);
                last = std::exchange (connection, socket);
                connected = true;
            }
            if (last != nullptr)
                last->close();
            onConnect();
        }
    }
    socket->close();
    if (! admitted)
        return;
    {
        const std::lock_guard<std::mutex> guard (connectionLock);
        if (connection != socket)
            return;
        connection = nullptr;
        connected = false;
    }
    onClose();
}

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

void init (bool socket)
{
    std::fflush (stdout);
    std::fflush (stderr);
    const auto fd = ENGINE_DUP (1);
    const auto errFd = ENGINE_DUP (2);
    auto* stream = fd >= 0 ? ENGINE_FDOPEN (fd, "wb") : nullptr;
    auto* errStream = errFd >= 0 ? ENGINE_FDOPEN (errFd, "wb") : nullptr;
    if (stream == nullptr || errStream == nullptr)
        return;
    overSocket = socket;
    if (socket)
        messages.start ([] (const std::string& batch) {
            if (auto to = current())
                sendAll (*to, batch.data(), batch.size());
        });
    else
        messages.start (stream);
    started = true;
    catchPrints (errStream);
}

int serve (const juce::String& token, std::function<void()> onConnect, std::function<void (juce::var)> onMessage, std::function<void()> onClose)
{
    if (! listener.createListener (0, "127.0.0.1"))
        return 0;
    notInherited (listener.getRawSocketHandle());
    std::thread ([=] {
        while (listener.isConnected())
        {
            std::shared_ptr<juce::StreamingSocket> socket (listener.waitForNextConnection());
            if (socket == nullptr)
                continue;
            notInherited (socket->getRawSocketHandle());
            prepare (*socket);
            std::thread (readFrom, socket, token, onConnect, onMessage, onClose).detach();
        }
    }).detach();
    return listener.getBoundPort();
}

void hangUp()
{
    std::shared_ptr<juce::StreamingSocket> last;
    {
        const std::lock_guard<std::mutex> guard (connectionLock);
        last = std::exchange (connection, nullptr);
        connected = false;
    }
    if (last != nullptr)
        last->close();
}

void stopServing()
{
    hangUp();
    listener.close();
}

void send (const juce::var& message)
{
    // (No server connected: there's no one to tell, and the next one is told what's needed when it comes.)
    if (overSocket && ! connected)
        return;
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
    std::thread ([received = std::move (onMessage), closed = std::move (onClose)] {
        std::string line;
        while (std::getline (std::cin, line))
            parse (line, received);
        closed();
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

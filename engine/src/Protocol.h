// How the engine talks to the server: one JSON object per line (shared/music/engine.ts documents the messages).
// Started by the server (the desktop app, tests), commands come in on stdin and replies and events go out on
// stdout. In the music app the engine starts the server, which connects to it on 127.0.0.1 (`serve`).
#pragma once

#include <functional>
#include <juce_core/juce_core.h>

namespace protocol
{
/**
 * Keep stdout for messages alone: anything a plugin prints goes to stderr instead. Call first. `socket`: messages
 * go to the server connected to `serve` instead (stdout is then a log like stderr).
 */
void init (bool socket = false);

/**
 * The music app: listen on 127.0.0.1 for the server, which says `token` first. Returns the port (0 if it can't).
 * `onConnect` (a server came: tell it `ready`), `onMessage` and `onClose` (it went) are called on the socket's
 * threads. A server that comes while another is connected replaces it.
 */
int serve (const juce::String& token, std::function<void()> onConnect, std::function<void (juce::var)> onMessage, std::function<void()> onClose);

/** Let go of the server's connection (it quits when it closes). */
void hangUp();

/** Let go of the server and stop listening: the engine is quitting. */
void stopServing();

/** Write one message. Safe from any thread (not the audio thread's), and never waits for the reader. */
void send (const juce::var& message);

/** Give what's still queued a moment to go out, as the program ends. */
void finish();

/**
 * Read commands on a thread of their own. `onMessage` and `onClose` (the server went away) are
 * called on that thread.
 */
void startReading (std::function<void (juce::var)> onMessage, std::function<void()> onClose);

/** A JSON object from key/value pairs. */
juce::var object (std::initializer_list<std::pair<const char*, juce::var>> fields);
}

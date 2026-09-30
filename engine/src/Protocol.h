// How the engine talks to the server that runs it: one JSON object per line, commands in on stdin
// and replies and events out on stdout (shared/music/engine.ts documents the messages).
#pragma once

#include <functional>
#include <juce_core/juce_core.h>

namespace protocol
{
/** Keep stdout for messages alone: anything a plugin prints goes to stderr instead. Call first. */
void init();

/** Write one message. Safe from any thread. */
void send (const juce::var& message);

/**
 * Read commands on a thread of their own. `onMessage` and `onClose` (the server went away) are
 * called on that thread.
 */
void startReading (std::function<void (juce::var)> onMessage, std::function<void()> onClose);

/** A JSON object from key/value pairs. */
juce::var object (std::initializer_list<std::pair<const char*, juce::var>> fields);
}

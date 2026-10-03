// What only macOS can say about a window (the one place the engine does anything of the kind).
#pragma once

#include <juce_gui_basics/juce_gui_basics.h>

/**
 * Keep a window out of Mission Control and Cmd-` cycling: a plugin's window is part of the app's workspace
 * (FL Studio's are inside its own), not a window of the computer. The app's own panels are the same
 * (`hiddenInMissionControl` in electron/panels.ts). Does nothing where there is no such thing, and until
 * the window has a peer (call it after it's visible).
 */
void keepOutOfWindowSwitchers (juce::Component& window);

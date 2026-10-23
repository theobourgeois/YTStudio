// The music app's own duties (docs/apps.md), which the desktop app's main process had: the system's dialogs for the
// page (`src/lib/host.ts`), the Trash and Show in Finder or Explorer for the server, the files the app was handed.
#pragma once

#include <juce_gui_basics/juce_gui_basics.h>

namespace hostCommands
{
using Complete = std::function<void (const juce::Result&, const juce::var&)>;

/**
 * What the page may ask (`host.chooseProject`, `host.chooseFolder`, `host.saveFile`): false if `command` isn't
 * one, and `complete` isn't called. One dialog at a time.
 */
bool runForPage (const juce::String& command, const juce::var& params, Complete complete);

/** What the server may ask (`host.trash`, `host.reveal`, each with a `path`): false if `command` isn't one. */
bool runForServer (const juce::String& command, const juce::var& params, Complete complete);

/** The files and packages a command line names (opened with the app, or dropped on its icon): those that exist. */
juce::StringArray filesIn (const juce::String& commandLine);
}

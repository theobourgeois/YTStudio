#include "HostCommands.h"

namespace hostCommands
{
namespace
{
/** The dialog open, kept until it's answered. */
std::unique_ptr<juce::FileChooser> chooser;

/** A path the page gave, or where the dialog starts (the user's Documents) if it gave none. */
juce::File startingAt (const juce::var& path)
{
    const auto text = path.toString();
    return juce::File::isAbsolutePath (text) ? juce::File (text) : juce::File::getSpecialLocation (juce::File::userDocumentsDirectory);
}

/** `[{ name, extensions: ["wav"] }]` as a FileChooser's patterns ("*.wav;*.mp3"). */
juce::String patternsOf (const juce::var& filters)
{
    juce::StringArray patterns;
    if (const auto* list = filters.getArray())
        for (const auto& filter : *list)
            if (const auto* extensions = filter["extensions"].getArray())
                for (const auto& extension : *extensions)
                    patterns.addIfNotAlreadyThere ("*." + extension.toString());
    return patterns.joinIntoString (";");
}

void choose (const juce::String& title, const juce::File& from, const juce::String& patterns, int flags, Complete complete)
{
    if (chooser != nullptr)
        return complete (juce::Result::fail ("A dialog is already open."), {});
    chooser = std::make_unique<juce::FileChooser> (title, from, patterns);
    chooser->launchAsync (flags, [complete] (const juce::FileChooser& answered) {
        const auto file = answered.getResult();
        complete (juce::Result::ok(), file == juce::File() ? juce::var() : juce::var (file.getFullPathName()));
        // (Not inside its own callback.)
        juce::MessageManager::callAsync ([] { chooser.reset(); });
    });
}
} // namespace

bool runForPage (const juce::String& command, const juce::var& params, Complete complete)
{
    using Flags = juce::FileBrowserComponent::FileChooserFlags;
    if (command == "host.chooseProject")
        // A project is a package: a folder Finder shows as a file once the app has declared its type.
        choose ("Open a song", startingAt (params["defaultPath"]), "*.ytsng;*.yt;*.vaudio",
                Flags::openMode | Flags::canSelectFiles | Flags::canSelectDirectories, std::move (complete));
    else if (command == "host.chooseFolder")
        choose ("Choose a folder", startingAt (params["defaultPath"]), {}, Flags::openMode | Flags::canSelectDirectories, std::move (complete));
    else if (command == "host.saveFile")
        choose ("Save", startingAt (params["defaultPath"]), patternsOf (params["filters"]),
                Flags::saveMode | Flags::canSelectFiles | Flags::warnAboutOverwriting, std::move (complete));
    else
        return false;
    return true;
}

bool runForServer (const juce::String& command, const juce::var& params, Complete complete)
{
    if (command != "host.trash" && command != "host.reveal")
        return false;
    const auto path = params["path"].toString();
    if (! juce::File::isAbsolutePath (path) || ! juce::File (path).exists())
        complete (juce::Result::fail ("No such file: " + path), {});
    else if (command == "host.reveal")
    {
        juce::File (path).revealToUser();
        complete (juce::Result::ok(), {});
    }
    else if (juce::File (path).moveToTrash())
        complete (juce::Result::ok(), {});
    else
        complete (juce::Result::fail ("Couldn't move " + path + " to the Trash."), {});
    return true;
}

juce::StringArray filesIn (const juce::String& commandLine)
{
    juce::StringArray tokens, files;
    tokens.addTokens (commandLine, true);
    for (int i = 0; i < tokens.size(); ++i)
    {
        const auto token = tokens[i].unquoted();
        // (An option's value, as `--server <node>`, isn't a file opened.)
        const auto option = token.startsWith ("--") || (i > 0 && tokens[i - 1].startsWith ("--"));
        if (! option && juce::File::isAbsolutePath (token) && juce::File (token).exists())
            files.add (token);
    }
    return files;
}
}

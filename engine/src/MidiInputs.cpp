#include "MidiInputs.h"

#include "Protocol.h"

MidiInputs::MidiInputs (const juce::File& settings, std::function<void (const juce::MidiMessage&)> handler)
    : settingsFile (settings), onMessage (std::move (handler))
{
    if (const auto saved = juce::JSON::parse (settingsFile); const auto* list = saved["disabled"].getArray())
        for (const auto& name : *list)
            disabled.addIfNotAlreadyThere (name.toString());
    refresh();
    // Keyboards plugged in or out while it runs.
    connection = juce::MidiDeviceListConnection::make ([this] { refresh(); });
}

MidiInputs::~MidiInputs()
{
    for (auto& input : open)
        input->stop();
}

void MidiInputs::refresh()
{
    const auto available = juce::MidiInput::getAvailableDevices();
    // Closed: gone, or turned off.
    open.erase (std::remove_if (open.begin(), open.end(),
                                [&] (const std::unique_ptr<juce::MidiInput>& input) {
                                    const auto there = std::any_of (available.begin(), available.end(), [&] (const juce::MidiDeviceInfo& d) { return d.identifier == input->getIdentifier(); });
                                    if (there && ! disabled.contains (input->getName()))
                                        return false;
                                    input->stop();
                                    return true;
                                }),
                open.end());
    for (const auto& device : available)
    {
        if (disabled.contains (device.name))
            continue;
        if (std::any_of (open.begin(), open.end(), [&] (const std::unique_ptr<juce::MidiInput>& input) { return input->getIdentifier() == device.identifier; }))
            continue;
        if (auto input = juce::MidiInput::openDevice (device.identifier, this))
        {
            input->start();
            open.push_back (std::move (input));
        }
    }
}

juce::var MidiInputs::describe() const
{
    juce::Array<juce::var> list;
    for (const auto& device : juce::MidiInput::getAvailableDevices())
    {
        const auto isOpen = std::any_of (open.begin(), open.end(), [&] (const std::unique_ptr<juce::MidiInput>& input) { return input->getIdentifier() == device.identifier; });
        list.add (protocol::object ({ { "id", device.identifier }, { "name", device.name }, { "enabled", ! disabled.contains (device.name) }, { "open", isOpen } }));
    }
    return list;
}

juce::Result MidiInputs::setEnabled (const juce::String& name, bool enabled)
{
    if (name.isEmpty())
        return juce::Result::fail ("Which MIDI input? Give its name.");
    if (enabled)
        disabled.removeString (name);
    else
        disabled.addIfNotAlreadyThere (name);
    save();
    refresh();
    return juce::Result::ok();
}

void MidiInputs::save() const
{
    juce::Array<juce::var> list;
    for (const auto& name : disabled)
        list.add (name);
    settingsFile.replaceWithText (juce::JSON::toString (protocol::object ({ { "disabled", list } })));
}

void MidiInputs::handleIncomingMidiMessage (juce::MidiInput*, const juce::MidiMessage& message)
{
    onMessage (message);
}

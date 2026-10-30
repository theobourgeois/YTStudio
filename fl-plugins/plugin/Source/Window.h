#pragma once

#include "Processor.h"

#include <juce_audio_processors/juce_audio_processors.h>

namespace colour
{
inline const juce::Colour back { 0xff2a2e35 }, panel { 0xff1f2227 }, raised { 0xff3a4049 }, line { 0xff16181c },
    text { 0xffdde2e8 }, dim { 0xff8b939d }, accent { 0xffe9a23b }, good { 0xff3fb26b }, bad { 0xffdf5a4e };
}

inline juce::var object (std::initializer_list<std::pair<const char*, juce::var>> fields)
{
    auto o = std::make_unique<juce::DynamicObject>();
    for (const auto& [k, v] : fields)
        o->setProperty (k, v);
    return juce::var (o.release());
}

inline juce::Font font (float height, bool bold = false)
{
    return juce::Font (juce::FontOptions (height, bold ? juce::Font::bold : juce::Font::plain));
}

/** What both plugins' windows have: the look, FL's connection and Set up FL Studio along the top, the log along the
    bottom. They only show what the worker says and send it what was clicked. */
class PluginWindow : public juce::AudioProcessorEditor,
                     private YTProcessor::Listener
{
public:
    ~PluginWindow() override;

    void paint (juce::Graphics&) override;

protected:
    explicit PluginWindow (YTProcessor&);

    /** Shows what the worker has said so far and starts it. The last thing a window's constructor does before its size. */
    void begin();
    /** Lays out the top row and the log and returns the room between them. */
    juce::Rectangle<int> layOutFrame (int logHeight);
    void command (const juce::String& cmd);

    /** The worker's `view`, or nothing yet (not an object): what the window shows. */
    virtual void showView (const juce::var& view) = 0;
    /** Something the worker said that only this window knows about. */
    virtual void workerEvent (const juce::var&) {}

    YTProcessor& processor;

private:
    struct Look : juce::LookAndFeel_V4
    {
        Look();
        juce::Font getTextButtonFont (juce::TextButton&, int height) override;
    };

    void workerSaid (const juce::var& event) override;
    void viewChanged (const juce::var& view);
    void addLogLine (const juce::String& time, const juce::String& text, bool error);
    void showSetup (const juce::var& event);

    Look look;
    juce::Colour dot;
    juce::Label status;
    juce::TextButton setupButton { "Set up FL Studio..." };
    juce::TooltipWindow tooltips { this, 600 };
    juce::TextEditor logBox;
    std::unique_ptr<juce::AlertWindow> setupWindow;

    JUCE_DECLARE_NON_COPYABLE_WITH_LEAK_DETECTOR (PluginWindow)
};

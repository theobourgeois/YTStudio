#include "Window.h"

PluginWindow::Look::Look()
{
    setColourScheme ({ colour::back, colour::panel, colour::panel, colour::dim, colour::text, colour::raised,
                       colour::text, colour::accent, colour::text });
    setColour (juce::TextButton::buttonColourId, colour::raised);
    setColour (juce::TextButton::textColourOffId, colour::text);
    setColour (juce::ComboBox::outlineColourId, colour::line);
    setColour (juce::TextEditor::backgroundColourId, colour::panel);
    setColour (juce::TextEditor::outlineColourId, colour::line);
    setColour (juce::ListBox::backgroundColourId, colour::panel);
    setColour (juce::ListBox::outlineColourId, colour::line);
    setColour (juce::TableHeaderComponent::backgroundColourId, colour::raised);
    setColour (juce::TableHeaderComponent::textColourId, colour::text);
    setColour (juce::TableHeaderComponent::outlineColourId, colour::line);
    setColour (juce::ProgressBar::backgroundColourId, colour::panel);
    setColour (juce::ProgressBar::foregroundColourId, colour::accent);
    setColour (juce::Slider::textBoxBackgroundColourId, colour::panel);
    setColour (juce::Slider::textBoxOutlineColourId, colour::line);
    setColour (juce::ToggleButton::tickColourId, colour::accent);
    setColour (juce::ToggleButton::tickDisabledColourId, colour::dim);
    setColour (juce::Label::textColourId, colour::text);
    setColour (juce::AlertWindow::backgroundColourId, colour::back);
    setColour (juce::AlertWindow::textColourId, colour::text);
    setColour (juce::PopupMenu::backgroundColourId, colour::panel);
    setColour (juce::PopupMenu::highlightedBackgroundColourId, colour::accent);
    setColour (juce::PopupMenu::highlightedTextColourId, colour::line);
}

juce::Font PluginWindow::Look::getTextButtonFont (juce::TextButton& b, int height)
{
    if (b.getProperties()["huge"])
        return font (21.0f, true);
    return font (juce::jmin (15.0f, (float) height * 0.6f), (bool) b.getProperties()["bold"]);
}

PluginWindow::PluginWindow (YTProcessor& p)
    : AudioProcessorEditor (p), processor (p)
{
    setLookAndFeel (&look);

    status.setFont (font (16.0f, true));
    status.setText ("Starting " + juce::String (JucePlugin_Name) + "...", juce::dontSendNotification);
    addAndMakeVisible (status);
    addAndMakeVisible (setupButton);
    setupButton.onClick = [this] { command ("setup"); };

    logBox.setMultiLine (true);
    logBox.setReadOnly (true);
    logBox.setScrollbarsShown (true);
    logBox.setCaretVisible (false);
    logBox.setFont (juce::Font (juce::FontOptions ("Consolas", 13.0f, juce::Font::plain)));
    addAndMakeVisible (logBox);
}

PluginWindow::~PluginWindow()
{
    processor.removeListener (this);
    setLookAndFeel (nullptr);
}

void PluginWindow::begin()
{
    for (const auto& l : processor.getLog())
        addLogLine (l.time, l.text, l.error);
    viewChanged (processor.getView());

    processor.addListener (this);
    processor.startWorker();
}

void PluginWindow::paint (juce::Graphics& g)
{
    g.fillAll (colour::back);
    const auto d = juce::Rectangle<float> (16.0f, 20.0f, 12.0f, 12.0f);
    g.setColour (dot.isTransparent() ? colour::dim : dot);
    g.fillEllipse (d);
}

juce::Rectangle<int> PluginWindow::layOutFrame (int logHeight)
{
    auto area = getLocalBounds().reduced (12, 10);
    auto top = area.removeFromTop (32);
    setupButton.setBounds (top.removeFromRight (160).reduced (0, 2));
    top.removeFromLeft (24);
    status.setBounds (top);
    area.removeFromTop (10);
    logBox.setBounds (area.removeFromBottom (logHeight));
    area.removeFromBottom (8);
    return area;
}

// What the worker says

void PluginWindow::workerSaid (const juce::var& event)
{
    const auto ev = event["ev"].toString();
    if (ev == "view")
        viewChanged (event);
    else if (ev == "log")
        addLogLine (event["time"].toString(), event["text"].toString(), (bool) event["error"]);
    else if (ev == "alert")
        juce::AlertWindow::showMessageBoxAsync (juce::MessageBoxIconType::WarningIcon, JucePlugin_Name,
                                                event["text"].toString(), {}, this);
    else if (ev == "ask")
    {
        const auto yes = event["yes"];
        juce::AlertWindow::showOkCancelBox (juce::MessageBoxIconType::QuestionIcon, JucePlugin_Name, event["text"].toString(),
                                            "Apply", "Cancel", this,
                                            juce::ModalCallbackFunction::create ([p = &processor, yes] (int r) {
                                                if (r == 1)
                                                    p->send (yes);
                                            }));
    }
    else if (ev == "setup")
        showSetup (event);
    else
        workerEvent (event);
}

void PluginWindow::viewChanged (const juce::var& view)
{
    if (view.isObject())
    {
        dot = (bool) view["connected"] ? colour::good : colour::bad;
        status.setText (view["status"].toString(), juce::dontSendNotification);
        setupButton.setEnabled (! (bool) view["busy"]);
    }
    showView (view);
    repaint();
}

void PluginWindow::addLogLine (const juce::String& time, const juce::String& text, bool error)
{
    logBox.moveCaretToEnd();
    logBox.setColour (juce::TextEditor::textColourId, error ? colour::bad : colour::text);
    logBox.insertTextAtCaret ((logBox.isEmpty() ? "" : "\n") + time + "  " + text);
}

void PluginWindow::command (const juce::String& cmd)
{
    processor.send (object ({ { "cmd", cmd } }));
}

void PluginWindow::showSetup (const juce::var& event)
{
    setupWindow = std::make_unique<juce::AlertWindow> ("Set up FL Studio", event["text"].toString(),
                                                       juce::MessageBoxIconType::NoIcon, this);
    if ((bool) event["canInstall"])
        setupWindow->addButton ("Install the script", 1);
    setupWindow->addButton ("Close", 0, juce::KeyPress (juce::KeyPress::escapeKey));
    setupWindow->enterModalState (true, juce::ModalCallbackFunction::create ([p = &processor] (int r) {
                                      if (r == 1)
                                          p->send (object ({ { "cmd", "install" } }));
                                  }),
                                  false);
}

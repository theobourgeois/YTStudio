#include "EditorWindow.h"

#include "Protocol.h"

namespace
{
constexpr int barHeight = 24;

// The studio theme's dark colours (src/themes/studio.css): a raised bar, darker lines, light text.
namespace colour
{
const juce::Colour barTop { 0xff3a4049 }, barBottom { 0xff2e343c }, barHighlight { 0x17ffffff }, edge { 0xff08090b },
    text { 0xffe2e5e9 }, muted { 0xff9ba4af }, hover { 0xff4a525d };
}

/** FL's × at the title bar's right end, lit when the pointer is over it. */
class CloseButton final : public juce::Button
{
public:
    CloseButton() : Button ("Close") { setTooltip ("Close"); }

    void paintButton (juce::Graphics& g, bool over, bool down) override
    {
        const auto area = getLocalBounds().toFloat().reduced (3.0f);
        if (over || down)
        {
            g.setColour (down ? colour::edge : colour::hover);
            g.fillRoundedRectangle (area, 3.0f);
        }
        const auto cross = area.withSizeKeepingCentre (8.0f, 8.0f);
        g.setColour (over ? colour::text : colour::muted);
        g.drawLine ({ cross.getTopLeft(), cross.getBottomRight() }, 1.5f);
        g.drawLine ({ cross.getBottomLeft(), cross.getTopRight() }, 1.5f);
    }
};

/** Draws the window's title bar in our look rather than the system's. */
class StudioLook final : public juce::LookAndFeel_V4
{
public:
    void drawDocumentWindowTitleBar (juce::DocumentWindow& window, juce::Graphics& g, int w, int h, int titleX, int titleW, const juce::Image*, bool) override
    {
        g.setGradientFill ({ colour::barTop, 0.0f, 0.0f, colour::barBottom, 0.0f, (float) h, false });
        g.fillAll();
        g.setColour (colour::barHighlight);
        g.fillRect (0, 0, w, 1);
        g.setColour (colour::edge);
        g.fillRect (0, h - 1, w, 1);
        g.setColour (window.isActiveWindow() ? colour::text : colour::muted);
        g.setFont (juce::FontOptions (13.0f, juce::Font::bold));
        g.drawText (window.getName(), titleX + 4, 0, titleW - 8, h, juce::Justification::centredLeft, true);
    }

    juce::Button* createDocumentWindowButton (int type) override
    {
        return type == juce::DocumentWindow::closeButton ? new CloseButton() : nullptr;
    }

    void positionDocumentWindowButtons (juce::DocumentWindow&, int x, int y, int w, int h, juce::Button*, juce::Button*, juce::Button* close, bool) override
    {
        if (close != nullptr)
            close->setBounds (x + w - h, y, h, h);
    }
};
}

EditorWindow::EditorWindow (juce::AudioPluginInstance& plugin, const juce::String& title, std::function<void()> onCloseButton)
    : DocumentWindow (title, juce::Colours::black, DocumentWindow::closeButton),
      onClose (std::move (onCloseButton))
{
    look = std::make_unique<StudioLook>();
    setLookAndFeel (look.get());
    setUsingNativeTitleBar (false);
    setTitleBarHeight (barHeight);
    setTitleBarButtonsRequired (DocumentWindow::closeButton, false);

    juce::AudioProcessorEditor* created = plugin.hasEditor() ? plugin.createEditorIfNeeded() : nullptr;
    if (created == nullptr)
        created = new juce::GenericAudioProcessorEditor (plugin);
    editor = created;
    // Before the editor's own keyPressed: a VST3 plugin's window says it used every key that reaches it.
    created->addKeyListener (this);
    addKeyListener (this);
    setContentOwned (created, true);
    setResizable (created->isResizable(), false);
    centreWithSize (getWidth(), getHeight());
    setVisible (true);
}

EditorWindow::~EditorWindow()
{
    if (editor != nullptr)
        editor->removeKeyListener (this);
    removeKeyListener (this);
    clearContentComponent();
    setLookAndFeel (nullptr);
}

void EditorWindow::show()
{
    juce::Process::makeForegroundProcess();
    setVisible (true);
    toFront (true);
}

bool EditorWindow::keyPressed (const juce::KeyPress& key, juce::Component*)
{
    auto described = describeKey (key);
    if (described.isVoid())
        return false;
    described.getDynamicObject()->setProperty ("event", "key");
    protocol::send (described);
    return true;
}

juce::var describeKey (const juce::KeyPress& press)
{
    const auto code = press.getKeyCode();
    const auto mods = press.getModifiers();
    juce::String key, name;
    if (code == juce::KeyPress::spaceKey)
        key = " ", name = "Space";
    else if (code >= juce::KeyPress::F1Key && code <= juce::KeyPress::F12Key)
        key = name = "F" + juce::String (code - juce::KeyPress::F1Key + 1);
    else if (code == juce::KeyPress::upKey)
        key = name = "ArrowUp";
    else if (code == juce::KeyPress::downKey)
        key = name = "ArrowDown";
    else if (code == juce::KeyPress::leftKey)
        key = name = "ArrowLeft";
    else if (code == juce::KeyPress::rightKey)
        key = name = "ArrowRight";
    else if (code == juce::KeyPress::deleteKey)
        key = name = "Delete";
    else if (code == juce::KeyPress::backspaceKey)
        key = name = "Backspace";
    else if (code == juce::KeyPress::returnKey)
        key = name = "Enter";
    else if (code == juce::KeyPress::escapeKey)
        key = name = "Escape";
    else if (juce::CharacterFunctions::isLetter ((juce::juce_wchar) code) && code < 128)
    {
        const auto upper = juce::String::charToString ((juce::juce_wchar) code).toUpperCase();
        name = "Key" + upper;
        key = mods.isShiftDown() ? upper : upper.toLowerCase();
    }
    else if (code >= '0' && code <= '9')
        key = juce::String::charToString ((juce::juce_wchar) code), name = "Digit" + key;
    else
        return {};

    return protocol::object ({ { "key", key },
                               { "code", name },
                               // ⌘ on a Mac, Ctrl elsewhere: the page takes either as "Ctrl".
                               { "metaKey", mods.isCommandDown() },
                               { "ctrlKey", mods.isCtrlDown() },
                               { "shiftKey", mods.isShiftDown() },
                               { "altKey", mods.isAltDown() } });
}

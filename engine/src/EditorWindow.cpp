#include "EditorWindow.h"
#include "MacWindow.h"

#include "Protocol.h"

namespace
{
constexpr int barHeight = 24;
/** How often a new window checks whether it has been drawn yet (`EditorWindow::timerCallback`). */
constexpr int tickMs = 30;

// The studio theme's dark colours (src/themes/studio.css): a raised bar, darker lines, light text.
namespace colour
{
const juce::Colour barTop { 0xff3a4049 }, barBottom { 0xff2e343c }, barHighlight { 0x17ffffff }, edge { 0xff08090b },
    text { 0xffe2e5e9 }, muted { 0xff9ba4af }, hover { 0xff4a525d }, accent { 0xff5b9cf0 };
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

/**
 * The title bar's Automate button: "Automate “Cutoff”", the parameter last touched in the window. A click
 * makes an automation clip of it in the song (FL Studio's Tools → Last tweaked, a click away).
 */
class AutomateButton final : public juce::Button
{
public:
    AutomateButton() : Button ("Automate") { setTooltip ("Make an automation clip of this parameter, over the song or the Playlist's time selection"); }

    void setParameter (const juce::String& name)
    {
        label = juce::String::fromUTF8 ("Automate \u201c") + name + juce::String::fromUTF8 ("\u201d");
        setButtonText (label);
        repaint();
    }

    /** As wide as its words, up to `most`. */
    int idealWidth (int most) const
    {
        juce::GlyphArrangement glyphs;
        glyphs.addLineOfText (juce::FontOptions (12.0f), label, 0, 0);
        return juce::jmin (most, (int) std::ceil (glyphs.getBoundingBox (0, -1, true).getWidth()) + 30);
    }

    void paintButton (juce::Graphics& g, bool over, bool down) override
    {
        const auto area = getLocalBounds().toFloat().reduced (2.0f, 3.0f);
        g.setColour (down ? colour::edge : over ? colour::hover : colour::barBottom.brighter (0.08f));
        g.fillRoundedRectangle (area, 3.0f);
        g.setColour (colour::edge);
        g.drawRoundedRectangle (area, 3.0f, 1.0f);
        // A small automation curve, then the words.
        const auto icon = area.withWidth (area.getHeight()).reduced (4.0f);
        juce::Path curve;
        curve.startNewSubPath (icon.getBottomLeft());
        curve.cubicTo (icon.getCentreX(), icon.getBottom(), icon.getCentreX(), icon.getY(), icon.getRight(), icon.getY());
        g.setColour (colour::accent);
        g.strokePath (curve, juce::PathStrokeType (1.5f));
        g.setColour (over ? colour::text : colour::muted);
        g.setFont (juce::FontOptions (12.0f));
        g.drawText (label, area.withTrimmedLeft (area.getHeight()).withTrimmedRight (4.0f), juce::Justification::centredLeft, true);
    }

private:
    juce::String label;
};

/** A small button in the title bar drawn by a function (an arrow, the wrapper's sliders). */
class GlyphButton final : public juce::Button
{
public:
    GlyphButton (const juce::String& name, std::function<void (juce::Graphics&, juce::Rectangle<float>)> glyph) : Button (name), draw (std::move (glyph)) { setTooltip (name); }

    void paintButton (juce::Graphics& g, bool over, bool down) override
    {
        const auto area = getLocalBounds().toFloat().reduced (2.0f, 3.0f);
        if (over || down)
        {
            g.setColour (down ? colour::edge : colour::hover);
            g.fillRoundedRectangle (area, 3.0f);
        }
        g.setColour (over ? colour::text : colour::muted);
        draw (g, area.withSizeKeepingCentre (8.0f, 8.0f));
    }

private:
    std::function<void (juce::Graphics&, juce::Rectangle<float>)> draw;
};

/** A triangle pointing left (-1) or right (1). */
void arrow (juce::Graphics& g, juce::Rectangle<float> box, int direction)
{
    juce::Path path;
    if (direction < 0)
        path.addTriangle (box.getRight() - 1.0f, box.getY(), box.getRight() - 1.0f, box.getBottom(), box.getX() + 1.0f, box.getCentreY());
    else
        path.addTriangle (box.getX() + 1.0f, box.getY(), box.getX() + 1.0f, box.getBottom(), box.getRight() - 1.0f, box.getCentreY());
    g.fillPath (path);
}

/** FL's preset browser: the previous and next arrows, and what it's on. */
class PresetBar final : public juce::Component
{
public:
    explicit PresetBar (std::function<void (int)> step)
        : previous ("Previous preset", [] (juce::Graphics& g, juce::Rectangle<float> box) { arrow (g, box, -1); }),
          next ("Next preset", [] (juce::Graphics& g, juce::Rectangle<float> box) { arrow (g, box, 1); })
    {
        previous.onClick = [step] { step (-1); };
        next.onClick = [step] { step (1); };
        addAndMakeVisible (previous);
        addAndMakeVisible (next);
    }

    void set (const juce::String& text, bool canStep)
    {
        label = text;
        previous.setVisible (canStep);
        next.setVisible (canStep);
        resized();
        repaint();
    }

    /** As wide as its arrows and words, up to `most`. */
    int idealWidth (int most) const
    {
        juce::GlyphArrangement glyphs;
        glyphs.addLineOfText (juce::FontOptions (12.0f), label, 0, 0);
        const auto words = label.isEmpty() ? 0 : (int) std::ceil (glyphs.getBoundingBox (0, -1, true).getWidth()) + 8;
        return juce::jmin (most, (previous.isVisible() ? 2 * buttonWidth : 0) + words);
    }

    void resized() override
    {
        previous.setBounds (0, 0, buttonWidth, getHeight());
        next.setBounds (buttonWidth, 0, buttonWidth, getHeight());
    }

    void paint (juce::Graphics& g) override
    {
        g.setColour (colour::muted);
        g.setFont (juce::FontOptions (12.0f));
        const auto left = previous.isVisible() ? 2 * buttonWidth + 4 : 0;
        g.drawText (label, getLocalBounds().withTrimmedLeft (left), juce::Justification::centredLeft, true);
    }

private:
    static constexpr int buttonWidth = 18;
    GlyphButton previous, next;
    juce::String label;
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

bool EditorWindow::typingKeyboard = false;
void* EditorWindow::owner = nullptr;
bool EditorWindow::shell = false;
juce::Array<EditorWindow*> EditorWindow::openWindows;

namespace
{
/**
 * On Windows its peer is made once everything is in it (`addToDesktop` at the end of the constructor), so
 * it's made with this class's style (no taskbar button) rather than the base class's and then made again
 * around a plugin's editor already attached to it, which some plugins don't survive.
 */
#if JUCE_WINDOWS
constexpr bool addToDesktopFirst = false;
#else
constexpr bool addToDesktopFirst = true;
#endif
}

EditorWindow::EditorWindow (juce::AudioPluginInstance& plugin, const juce::String& title, std::function<void()> onCloseButton, bool hidden)
    : DocumentWindow (title, juce::Colours::black, DocumentWindow::closeButton, addToDesktopFirst),
      hidden (hidden),
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
    if (hidden)
    {
        setAlpha (0.0f);
        setInterceptsMouseClicks (false, false);
    }
    if (! addToDesktopFirst)
        addToDesktop();
   #if JUCE_WINDOWS
    // Off the screen until it's drawn (white until then); `timerCallback` shows it. A hidden one stays cloaked:
    // the plugin still makes its view and takes drops in it.
    cloakWindow (*this, true);
    cloakedAt = lastTick = juce::Time::getMillisecondCounter();
    if (! hidden)
        startTimer (tickMs);
   #endif
    setVisible (true);
    if (hidden)
    {
        ignoreMouse (*this);
        keepOutOfWindowSwitchers (*this);
    }

    openWindows.add (this);
    // (Windows: the keys pressed in a plugin that holds the focus itself; nothing elsewhere.)
    hookThreadKeys ([] (void* root, const juce::KeyPress& key, bool down, bool repeat) {
        for (auto* window : openWindows)
            if (nativeWindowOf (*window) == root)
                return window->takeFirst (key, down, repeat);
        return false;
    });
}

void EditorWindow::timerCallback()
{
    const auto now = juce::Time::getMillisecondCounter();
    // A tick on time means nothing held the message thread up since the last: the drawing is done.
    calmTicks = now - lastTick <= tickMs + 15 ? calmTicks + 1 : 0;
    lastTick = now;
    if (calmTicks < 3 && now - cloakedAt < 1000)
        return;
    stopTimer();
    cloakWindow (*this, false);
}

EditorWindow::~EditorWindow()
{
    stopTimer();
    openWindows.removeFirstMatchingValue (this);
    releaseKeys();
    automate.reset();
    presetBar.reset();
    settings.reset();
    if (editor != nullptr)
        editor->removeKeyListener (this);
    removeKeyListener (this);
    clearContentComponent();
    setLookAndFeel (nullptr);
}

void EditorWindow::setTouched (int index, const juce::String& name)
{
    if (automate == nullptr)
    {
        auto* button = new AutomateButton();
        automate.reset (button);
        button->onClick = [this] {
            if (onAutomate != nullptr && touched >= 0)
                onAutomate (touched);
        };
        Component::addAndMakeVisible (*button);
    }
    touched = index;
    static_cast<AutomateButton&> (*automate).setParameter (name);
    resized();
}

void EditorWindow::setPreset (const juce::String& label, bool canStep)
{
    if (presetBar == nullptr)
    {
        presetBar = std::make_unique<PresetBar> ([this] (int direction) {
            if (onStep != nullptr)
                onStep (direction);
        });
        Component::addAndMakeVisible (*presetBar);
        settings = std::make_unique<GlyphButton> ("Channel settings (volume, pan, pitch, track, presets)", [] (juce::Graphics& g, juce::Rectangle<float> box) {
            // Three sliders: the wrapper's settings.
            for (int i = 0; i < 3; ++i)
            {
                const auto y = box.getY() + (float) i * box.getHeight() / 2.0f;
                g.fillRect (box.getX(), y - 0.5f, box.getWidth(), 1.0f);
                g.fillEllipse (box.getX() + box.getWidth() * (i == 1 ? 0.65f : 0.25f) - 1.5f, y - 1.5f, 3.0f, 3.0f);
            }
        });
        settings->onClick = [this] {
            if (onSettings != nullptr)
                onSettings();
        };
        Component::addAndMakeVisible (*settings);
    }
    static_cast<PresetBar&> (*presetBar).set (label, canStep);
    resized();
}

void EditorWindow::resized()
{
    DocumentWindow::resized();
    // Right to left from the ×: the wrapper button, Automate, the preset browser (never over the title's start).
    const auto bar = getTitleBarArea();
    auto right = bar.getRight() - bar.getHeight() - 2;
    if (settings != nullptr)
    {
        settings->setBounds (right - bar.getHeight(), bar.getY(), bar.getHeight(), bar.getHeight());
        settings->toFront (false);
        right -= bar.getHeight() + 2;
    }
    const auto most = juce::jmax (0, bar.getWidth() / 2 - bar.getHeight());
    if (automate != nullptr)
    {
        const auto width = static_cast<AutomateButton&> (*automate).idealWidth (most);
        automate->setBounds (right - width, bar.getY(), width, bar.getHeight());
        automate->toFront (false);
        right -= width + 4;
    }
    if (presetBar != nullptr)
    {
        const auto width = static_cast<PresetBar&> (*presetBar).idealWidth (juce::jmax (0, right - bar.getX() - bar.getWidth() / 3));
        presetBar->setBounds (right - width, bar.getY(), width, bar.getHeight());
        presetBar->toFront (false);
    }
}

void EditorWindow::setShellWindow (void* window)
{
    shell = window != nullptr;
    owner = window;
    for (auto* open : openWindows)
        open->followAppWindow();
}

void EditorWindow::followAppWindow()
{
    setWindowOwner (*this, owner);
}

int EditorWindow::getDesktopWindowStyleFlags() const
{
    auto style = DocumentWindow::getDesktopWindowStyleFlags();
    // A window of the app's (Windows): no taskbar button, and not in Alt+Tab (JUCE makes it a tool window). A hidden
    // one never has them, whatever it belongs to.
    if (owner != nullptr || hidden)
        style &= ~juce::ComponentPeer::windowAppearsOnTaskbar;
    return style;
}

void EditorWindow::parentHierarchyChanged()
{
    DocumentWindow::parentHierarchyChanged();
    followAppWindow();
}

void EditorWindow::centreOver (juce::Rectangle<int> area)
{
    auto bounds = getBounds().withCentre (area.getCentre());
    if (const auto* display = juce::Desktop::getInstance().getDisplays().getDisplayForRect (area))
        bounds = bounds.constrainedWithin (display->userArea);
    setBounds (bounds);
}

void EditorWindow::show()
{
    juce::Process::makeForegroundProcess();
    followAppWindow();
    setVisible (true);
    keepOutOfWindowSwitchers (*this);
    toFront (true);
}

bool EditorWindow::keyPressed (const juce::KeyPress& key, juce::Component*)
{
    auto described = describeKey (key);
    if (described.isVoid())
        return false;
    const auto mods = key.getModifiers();
    const auto code = described["code"].toString();
    const auto pianoKey = code.startsWith ("Key") || code.startsWith ("Digit")
        || code == "Comma" || code == "Period" || code == "Semicolon" || code == "Slash"
        || code == "BracketLeft" || code == "BracketRight";
    // Text boxes still own typing; modified keys remain available to shortcuts.
    auto* focused = juce::Component::getCurrentlyFocusedComponent();
    if (typingKeyboard && pianoKey && ! mods.isCommandDown() && ! mods.isCtrlDown() && ! mods.isAltDown())
    {
        if (dynamic_cast<juce::TextEditor*> (focused) != nullptr)
            return false;
        if (heldKeys.count (key.getKeyCode()) != 0)
            return true;
        heldKeys[key.getKeyCode()] = described;
    }
    described.getDynamicObject()->setProperty ("event", "key");
    described.getDynamicObject()->setProperty ("down", true);
    protocol::send (described);
    return true;
}

namespace
{
/** The typing keyboard's note keys, by the page's names for them. */
bool isPianoKey (const juce::String& code)
{
    return code.startsWith ("Key") || code.startsWith ("Digit")
        || code == "Comma" || code == "Period" || code == "Semicolon" || code == "Slash"
        || code == "BracketLeft" || code == "BracketRight";
}

void sendKey (juce::var described, bool down)
{
    described.getDynamicObject()->setProperty ("event", "key");
    described.getDynamicObject()->setProperty ("down", down);
    protocol::send (described);
}
} // namespace

bool EditorWindow::takeFirst (const juce::KeyPress& key, bool down, bool repeat)
{
    const auto code = key.getKeyCode();
    if (! down)
    {
        if (const auto held = heldKeys.find (code); held != heldKeys.end())
        {
            sendKey (held->second, false);
            heldKeys.erase (held);
        }
        return takenDown.erase (code) > 0;
    }
    const auto described = describeKey (key);
    if (described.isVoid())
        return false;
    const auto mods = key.getModifiers();
    const auto ctrl = mods.isCtrlDown(), alt = mods.isAltDown();
    const auto name = described["code"].toString();
    // The typing keyboard plays notes whatever has the focus (FL's "typing keyboard to piano").
    if (typingKeyboard && isPianoKey (name) && ! ctrl && ! alt)
    {
        takenDown.insert (code);
        if (heldKeys.count (code) == 0)
        {
            heldKeys[code] = described;
            sendKey (described, true);
        }
        return true;
    }
    const auto fKey = code >= juce::KeyPress::F1Key && code <= juce::KeyPress::F12Key;
    const auto take = (code == juce::KeyPress::spaceKey && ! ctrl && ! alt)
        // Alt+F4 stays the system's. (Ctrl+Z stays the plugin's own undo, as FL lets it: it reaches the app only if unused.)
        || (fKey && ! (alt && code == juce::KeyPress::F4Key))
        || (alt && ! ctrl && name.startsWith ("Digit"))
        || (ctrl && ! alt && (name == "KeyT" || name == "KeyR"));
    if (! take)
        return false;
    takenDown.insert (code);
    // Held down, it's pressed once: Space toggles play, not on every repeat.
    if (! repeat)
        sendKey (described, true);
    return true;
}

bool EditorWindow::keyStateChanged (bool, juce::Component*)
{
    for (auto it = heldKeys.begin(); it != heldKeys.end();)
    {
        if (juce::KeyPress::isKeyCurrentlyDown (it->first)) { ++it; continue; }
        auto event = it->second;
        event.getDynamicObject()->setProperty ("event", "key");
        event.getDynamicObject()->setProperty ("down", false);
        protocol::send (event);
        it = heldKeys.erase (it);
    }
    return false;
}

void EditorWindow::releaseKeys()
{
    for (auto& [code, event] : heldKeys)
    {
        event.getDynamicObject()->setProperty ("event", "key");
        event.getDynamicObject()->setProperty ("down", false);
        protocol::send (event);
    }
    heldKeys.clear();
}

void EditorWindow::focusOfChildComponentChanged (FocusChangeType)
{
    if (! hasKeyboardFocus (true)) releaseKeys();
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
    else if (code == ',' || code == '.' || code == ';' || code == '/' || code == '[' || code == ']')
    {
        key = juce::String::charToString ((juce::juce_wchar) code);
        name = code == ',' ? "Comma" : code == '.' ? "Period" : code == ';' ? "Semicolon" : code == '/' ? "Slash" : code == '[' ? "BracketLeft" : "BracketRight";
    }
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

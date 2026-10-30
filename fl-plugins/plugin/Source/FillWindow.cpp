#include "Window.h"

namespace
{
enum Column
{
    soundColumn = 1,
    groupColumn,
    whyColumn,
    nowColumn,
    toColumn,
    noteColumn
};

/** The app's colours for the groups (shared/music/mixer-setup.ts). */
juce::Colour groupColour (const juce::String& role)
{
    if (role == "instr") return juce::Colour (0xffc85454);
    if (role == "bass") return juce::Colour (0xff5279cf);
    if (role == "drums") return juce::Colour (0xffc6aa43);
    return colour::dim;
}
} // namespace

/** YT-Fill's window in FL: each sound, its group and where it ends up. Nothing happens in FL until Fill. */
class FillWindow : public PluginWindow,
                   private juce::TableListBoxModel
{
public:
    explicit FillWindow (YTProcessor& p) : PluginWindow (p)
    {
        summary.setFont (font (14.0f));
        summary.setJustificationType (juce::Justification::topLeft);
        summary.setColour (juce::Label::textColourId, colour::dim);
        addAndMakeVisible (summary);

        pickLabel.setFont (font (14.0f));
        addAndMakeVisible (pickLabel);
        const std::pair<juce::TextButton*, const char*> picks[] = { { &instrButton, "instr" }, { &bassButton, "bass" },
                                                                    { &drumsButton, "drums" }, { &skipButton, "skip" },
                                                                    { &autoButton, "auto" } };
        for (const auto& pick : picks)
        {
            pick.first->onClick = [this, role = juce::String (pick.second)] { assign (role); };
            addAndMakeVisible (pick.first);
            if (groupColour (pick.second) != colour::dim)
            {
                pick.first->setColour (juce::TextButton::buttonColourId, groupColour (pick.second));
                pick.first->setColour (juce::TextButton::textColourOffId, colour::line);
            }
        }
        needToggle.onClick = [this] {
            table.deselectAllRows();
            refilter();
        };
        addAndMakeVisible (needToggle);

        auto& header = table.getHeader();
        const auto fixed = juce::TableHeaderComponent::visible | juce::TableHeaderComponent::resizable;
        header.addColumn ("Sound", soundColumn, 270, 120, -1, fixed);
        header.addColumn ("Group", groupColumn, 110, 80, 160, fixed);
        header.addColumn ("How it knows", whyColumn, 110, 70, 180, fixed);
        header.addColumn ("Now on", nowColumn, 170, 80, -1, fixed);
        header.addColumn ("Goes to", toColumn, 64, 50, 90, fixed);
        header.addColumn ("Note", noteColumn, 220, 60, -1, fixed);
        header.setStretchToFitActive (true);
        table.setRowHeight (26);
        table.setHeaderHeight (28);
        table.setOutlineThickness (1);
        table.setMultipleSelectionEnabled (true);
        addAndMakeVisible (table);

        fillButton.getProperties().set ("bold", true);
        fillButton.setColour (juce::TextButton::buttonColourId, colour::accent);
        fillButton.setColour (juce::TextButton::textColourOffId, colour::line);
        fillButton.onClick = [this] { command ("fillApply"); };
        addAndMakeVisible (fillButton);
        undoButton.onClick = [this] { command ("fillUndo"); };
        addAndMakeVisible (undoButton);
        rescanButton.onClick = [this] { command ("fillScan"); };
        addAndMakeVisible (rescanButton);

        begin();

        setResizable (true, true);
        setResizeLimits (760, 480, 2400, 1800);
        setSize (1000, 680);
    }

    void resized() override
    {
        auto area = layOutFrame (120);
        summary.setBounds (area.removeFromTop (42));
        area.removeFromTop (4);

        auto picks = area.removeFromTop (30);
        pickLabel.setBounds (picks.removeFromLeft (150));
        for (auto* b : { &instrButton, &bassButton, &drumsButton, &skipButton })
        {
            b->setBounds (picks.removeFromLeft (72).reduced (0, 2));
            picks.removeFromLeft (6);
        }
        autoButton.setBounds (picks.removeFromLeft (110).reduced (0, 2));
        needToggle.setBounds (picks.removeFromRight (210));

        area.removeFromTop (6);
        auto acts = area.removeFromBottom (38);
        area.removeFromBottom (8);
        table.setBounds (area);
        fillButton.setBounds (acts.removeFromLeft (190));
        acts.removeFromLeft (10);
        undoButton.setBounds (acts.removeFromLeft (110));
        acts.removeFromLeft (10);
        rescanButton.setBounds (acts.removeFromLeft (100));
    }

private:
    void showView (const juce::var& view) override
    {
        const auto connected = (bool) view["connected"];
        const auto busy = (bool) view["busy"];
        summary.setText (view["summary"].toString(), juce::dontSendNotification);
        fillButton.setButtonText (view.hasProperty ("fillText") ? view["fillText"].toString() : "Fill");
        allRows.clear();
        if (auto* a = view["rows"].getArray())
            allRows = *a;
        if (needToggle.getToggleState()) // what was just picked leaves the list, so the row numbers mean others now
            table.deselectAllRows();
        refilter();

        working = busy;
        fillButton.setEnabled (connected && ! busy && (int) view["changes"] > 0);
        undoButton.setEnabled (connected && ! busy && (bool) view["canUndo"]);
        rescanButton.setEnabled (connected && ! busy);
        for (auto* b : { &instrButton, &bassButton, &drumsButton, &skipButton, &autoButton })
            b->setEnabled (! busy && ! allRows.isEmpty());
    }

    void refilter()
    {
        rows.clear();
        for (const auto& r : allRows)
            if (! needToggle.getToggleState() || (bool) r["need"])
                rows.add (r);
        table.updateContent();
        table.repaint();
    }

    void assign (const juce::String& role)
    {
        juce::Array<juce::var> channels;
        const auto picked = table.getSelectedRows();
        for (int i = 0; i < picked.size(); ++i)
            if (juce::isPositiveAndBelow (picked[i], rows.size()))
                channels.add (rows.getReference (picked[i])["channel"]);
        if (channels.isEmpty())
        {
            juce::AlertWindow::showMessageBoxAsync (juce::MessageBoxIconType::InfoIcon, JucePlugin_Name,
                                                    "Select one or more sounds in the list first.", {}, this);
            return;
        }
        processor.send (object ({ { "cmd", "fillRole" }, { "channels", channels }, { "role", role } }));
    }

    void groupMenu (int row)
    {
        if (! table.isRowSelected (row))
            table.selectRow (row);
        juce::PopupMenu menu;
        menu.addItem (1, "Instr");
        menu.addItem (2, "Bass");
        menu.addItem (3, "Drums");
        menu.addSeparator();
        menu.addItem (4, "Skip");
        menu.addItem (5, "As detected");
        menu.showMenuAsync (juce::PopupMenu::Options().withTargetComponent (&table).withMousePosition(),
                            [safe = juce::Component::SafePointer<FillWindow> (this)] (int picked) {
                                const char* picks[] = { "instr", "bass", "drums", "skip", "auto" };
                                if (safe != nullptr && picked > 0 && picked <= 5)
                                    safe->assign (picks[picked - 1]);
                            });
    }

    int getNumRows() override { return rows.size(); }

    void paintRowBackground (juce::Graphics& g, int row, int, int, bool selected) override
    {
        if (selected)
            g.fillAll (colour::raised);
        else if (row % 2)
            g.fillAll (colour::back.withAlpha (0.35f));
    }

    void paintCell (juce::Graphics& g, int row, int column, int width, int height, bool) override
    {
        if (! juce::isPositiveAndBelow (row, rows.size()))
            return;
        const auto& r = rows.getReference (row);
        const auto role = r["role"].toString();
        juce::String text;
        auto just = juce::Justification::centredLeft;
        auto ink = colour::text;
        switch (column)
        {
            case soundColumn: text = r["name"].toString(); break;
            case groupColumn:
                text = r["group"].toString();
                if ((bool) r["need"])
                    ink = colour::accent;
                else if (role.isEmpty())
                    ink = colour::dim;
                else
                {
                    g.setColour (groupColour (role));
                    g.fillRoundedRectangle (6.0f, (float) height * 0.5f - 5.0f, 10.0f, 10.0f, 2.0f);
                }
                break;
            case whyColumn: text = r["why"].toString(); ink = colour::dim; break;
            case nowColumn: text = r["now"].toString(); ink = colour::dim; break;
            case toColumn: text = r["to"].toString(); just = juce::Justification::centred; break;
            case noteColumn: text = r["note"].toString(); ink = colour::accent; break;
            default: break;
        }
        g.setColour (ink);
        g.setFont (font (14.5f));
        const auto left = column == groupColumn && role.isNotEmpty() ? 22 : 6;
        g.drawFittedText (text, left, 0, width - left - 6, height, just, 1, 0.85f);
    }

    void cellClicked (int row, int column, const juce::MouseEvent&) override
    {
        if (column == groupColumn && ! working && juce::isPositiveAndBelow (row, rows.size()))
            groupMenu (row);
    }

    bool working = false;
    juce::Label summary, pickLabel { {}, "Selected sounds go to" };
    juce::TextButton instrButton { "Instr" }, bassButton { "Bass" }, drumsButton { "Drums" }, skipButton { "Skip" },
        autoButton { "As detected" };
    juce::ToggleButton needToggle { "Only what needs a group" };
    juce::TableListBox table { {}, this };
    juce::TextButton fillButton { "Fill" }, undoButton { "Undo fill" }, rescanButton { "Rescan" };
    juce::Array<juce::var> allRows, rows;

    JUCE_DECLARE_NON_COPYABLE_WITH_LEAK_DETECTOR (FillWindow)
};

juce::AudioProcessorEditor* createPluginWindow (YTProcessor& p)
{
    return new FillWindow (p);
}

const char* workerScript()
{
    return "fill_worker.py";
}

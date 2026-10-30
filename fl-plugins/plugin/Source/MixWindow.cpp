#include "Window.h"

namespace
{
enum Column
{
    insertColumn = 1,
    nameColumn,
    roleColumn,
    leadColumn,
    levelColumn,
    nowColumn,
    changeColumn,
    newColumn
};
} // namespace

/** YT-Mix's window in FL: the big button, the table of what it did to each insert (a role or lead that's wrong is
    corrected there), the summary and the log. */
class MixWindow : public PluginWindow,
                  private juce::TableListBoxModel
{
public:
    explicit MixWindow (YTProcessor&);

    void resized() override;

private:
    void showView (const juce::var& view) override;
    void workerEvent (const juce::var& event) override;
    void sendOptions();
    void autoMix();
    void chooseFolder();

    int getNumRows() override;
    void paintRowBackground (juce::Graphics&, int row, int width, int height, bool selected) override;
    void paintCell (juce::Graphics&, int row, int column, int width, int height, bool selected) override;
    void cellClicked (int row, int column, const juce::MouseEvent&) override;
    void cellDoubleClicked (int row, int column, const juce::MouseEvent&) override;

    bool canEdit = false;
    juce::TextButton autoButton { "Auto Mix" }, undoButton { "Undo" };
    double progress = 0.0;
    juce::ProgressBar progressBar { progress };
    juce::Label hint;
    juce::Label leadLabel { {}, "Lead over its group target" }, dbLabel { {}, "dB" };
    juce::Slider leadSlider { juce::Slider::IncDecButtons, juce::Slider::TextBoxLeft };
    juce::ToggleButton kickToggle { "Kick +2 dB" };
    juce::ToggleButton learnedToggle { "My taste" }; // what train/learn.py learned from your mixes, when it beats the rules
    juce::TextButton resetButton { "Back to the detected roles" };
    juce::TableListBox table { {}, this };
    juce::Label summary;
    juce::TextButton applyButton { "Apply changes" }, folderButton { "Use stems I exported..." };
    juce::TextButton learnButton { "Learn from this mix" };

    juce::Array<juce::var> rows;
    juce::var roles;
    std::unique_ptr<juce::FileChooser> chooser;

    JUCE_DECLARE_NON_COPYABLE_WITH_LEAK_DETECTOR (MixWindow)
};

MixWindow::MixWindow (YTProcessor& p) : PluginWindow (p)
{
    autoButton.getProperties().set ("huge", true);
    autoButton.setColour (juce::TextButton::buttonColourId, colour::accent);
    autoButton.setColour (juce::TextButton::textColourOffId, colour::line);
    autoButton.onClick = [this] { autoMix(); };
    addAndMakeVisible (autoButton);
    undoButton.onClick = [this] { command ("undo"); };
    addAndMakeVisible (undoButton);
    progressBar.setPercentageDisplay (false);
    addAndMakeVisible (progressBar);

    hint.setText ("Renders the project's stems in FL, balances the mix and moves the faders. Hands off the keyboard "
                  "for the few seconds FL's export window is opening. Press it again to check: a balanced mix moves "
                  "nothing.",
                  juce::dontSendNotification);
    hint.setColour (juce::Label::textColourId, colour::dim);
    hint.setFont (font (14.0f));
    addAndMakeVisible (hint);

    for (auto* l : { &leadLabel, &dbLabel })
    {
        l->setFont (font (14.0f));
        addAndMakeVisible (l);
    }
    leadSlider.setRange (0.0, 6.0, 0.5);
    leadSlider.setValue (3.0, juce::dontSendNotification);
    leadSlider.setTextBoxStyle (juce::Slider::TextBoxLeft, false, 44, 24);
    leadSlider.onValueChange = [this] { sendOptions(); };
    addAndMakeVisible (leadSlider);
    kickToggle.onClick = [this] { sendOptions(); };
    addAndMakeVisible (kickToggle);
    learnedToggle.setTooltip ("Use what Auto Mix learned from your own mixes (the trainer, and Learn from this mix). "
                              "Only there once it predicts your balance better than the fixed rules.");
    learnedToggle.onClick = [this] { sendOptions(); };
    addAndMakeVisible (learnedToggle);
    resetButton.onClick = [this] { command ("resetRoles"); };
    addAndMakeVisible (resetButton);

    auto& header = table.getHeader();
    const auto fixed = juce::TableHeaderComponent::visible | juce::TableHeaderComponent::resizable;
    header.addColumn ("Insert", insertColumn, 56, 40, 80, fixed);
    header.addColumn ("Name", nameColumn, 250, 120, -1, fixed);
    header.addColumn ("Role", roleColumn, 170, 100, -1, fixed);
    header.addColumn ("Lead", leadColumn, 50, 40, 70, fixed);
    header.addColumn ("In the mix", levelColumn, 96, 70, 140, fixed);
    header.addColumn ("Fader now", nowColumn, 86, 70, 140, fixed);
    header.addColumn ("Change", changeColumn, 90, 60, 260, fixed);
    header.addColumn ("New fader", newColumn, 86, 70, 140, fixed);
    header.setStretchToFitActive (true);
    table.setRowHeight (26);
    table.setHeaderHeight (28);
    table.setOutlineThickness (1);
    addAndMakeVisible (table);

    summary.setFont (font (14.0f));
    summary.setJustificationType (juce::Justification::topLeft);
    addAndMakeVisible (summary);

    applyButton.getProperties().set ("bold", true);
    applyButton.onClick = [this] { command ("apply"); };
    addAndMakeVisible (applyButton);
    learnButton.setTooltip ("Once you've set the faders by ear after an Auto Mix: keep this balance as one of "
                            "yours for Auto Mix to learn from.");
    learnButton.onClick = [this] { command ("learn"); };
    addAndMakeVisible (learnButton);
    folderButton.onClick = [this] { chooseFolder(); };
    addAndMakeVisible (folderButton);

    progress = processor.getProgress();
    begin();

    setResizable (true, true);
    setResizeLimits (760, 560, 2400, 1800);
    setSize (1000, 720);
}

void MixWindow::resized()
{
    auto area = layOutFrame (130);

    auto row = area.removeFromTop (54);
    autoButton.setBounds (row.removeFromLeft (200));
    row.removeFromLeft (10);
    undoButton.setBounds (row.removeFromLeft (90).reduced (0, 9));
    row.removeFromLeft (14);
    progressBar.setBounds (row.reduced (0, 17));

    area.removeFromTop (6);
    hint.setBounds (area.removeFromTop (40));

    auto opts = area.removeFromTop (30);
    leadLabel.setBounds (opts.removeFromLeft (180));
    leadSlider.setBounds (opts.removeFromLeft (110).reduced (0, 2));
    dbLabel.setBounds (opts.removeFromLeft (30));
    opts.removeFromLeft (16);
    kickToggle.setBounds (opts.removeFromLeft (120));
    learnedToggle.setBounds (opts.removeFromLeft (110));
    resetButton.setBounds (opts.removeFromRight (210).reduced (0, 1));

    area.removeFromTop (8);
    auto acts = area.removeFromBottom (36);
    applyButton.setBounds (acts.removeFromLeft (170));
    acts.removeFromLeft (10);
    learnButton.setBounds (acts.removeFromLeft (180));
    folderButton.setBounds (acts.removeFromRight (210));
    area.removeFromBottom (6);
    summary.setBounds (area.removeFromBottom (60));
    area.removeFromBottom (4);
    table.setBounds (area);
}

// What the worker says

void MixWindow::workerEvent (const juce::var& event)
{
    if (event["ev"].toString() == "progress")
        progress = (double) event["value"];
}

void MixWindow::showView (const juce::var& view)
{
    if (! view.isObject())
    {
        for (auto* b : { &autoButton, &undoButton, &applyButton, &folderButton, &resetButton, &learnButton })
            b->setEnabled (false);
        return;
    }
    const auto connected = (bool) view["connected"];
    canEdit = (bool) view["canEdit"];
    const auto busy = (bool) view["busy"];
    autoButton.setEnabled ((bool) view["canAuto"]);
    undoButton.setEnabled ((bool) view["canUndo"]);
    applyButton.setEnabled ((bool) view["canApply"]);
    folderButton.setEnabled (connected && ! busy);
    resetButton.setEnabled (! busy);
    leadSlider.setEnabled (! busy);
    kickToggle.setEnabled (! busy);
    learnButton.setEnabled ((bool) view["canLearn"]);
    learnedToggle.setEnabled (! busy && (bool) view["hasModel"]);
    if (view.hasProperty ("learned"))
        learnedToggle.setToggleState ((bool) view["learned"], juce::dontSendNotification);
    if (view.hasProperty ("lead"))
        leadSlider.setValue ((double) view["lead"], juce::dontSendNotification);
    if (view.hasProperty ("kick"))
        kickToggle.setToggleState ((bool) view["kick"], juce::dontSendNotification);
    summary.setText (view["summary"].toString(), juce::dontSendNotification);
    roles = view["roles"];
    rows.clear();
    if (auto* a = view["rows"].getArray())
        rows = *a;
    table.updateContent();
    table.repaint();
}

void MixWindow::sendOptions()
{
    processor.send (object ({ { "cmd", "options" }, { "lead", leadSlider.getValue() }, { "kick", kickToggle.getToggleState() },
                              { "learned", learnedToggle.getToggleState() } }));
}

void MixWindow::autoMix()
{
    processor.focusFL(); // the worker presses Ctrl+R: it has to land on FL, not on this window
    command ("auto");
}

void MixWindow::chooseFolder()
{
    chooser = std::make_unique<juce::FileChooser> (
        "The folder FL exported the split mixer tracks into (32Bit float)",
        juce::File::getSpecialLocation (juce::File::userDocumentsDirectory).getChildFile ("Image-Line/FL Studio/Audio/Rendered"));
    chooser->launchAsync (juce::FileBrowserComponent::openMode | juce::FileBrowserComponent::canSelectDirectories,
                          [p = &processor] (const juce::FileChooser& fc) {
                              const auto folder = fc.getResult();
                              if (folder.isDirectory())
                                  p->send (object ({ { "cmd", "folder" }, { "folder", folder.getFullPathName() } }));
                          });
}

// The table

int MixWindow::getNumRows()
{
    return rows.size();
}

void MixWindow::paintRowBackground (juce::Graphics& g, int row, int, int, bool selected)
{
    if (selected)
        g.fillAll (colour::raised);
    else if (row % 2)
        g.fillAll (colour::back.withAlpha (0.35f));
}

void MixWindow::paintCell (juce::Graphics& g, int row, int column, int width, int height, bool)
{
    if (! juce::isPositiveAndBelow (row, rows.size()))
        return;
    const auto& r = rows.getReference (row);
    const auto style = r["style"].toString();
    juce::String text;
    auto just = juce::Justification::centredRight;
    switch (column)
    {
        case insertColumn: text = r["index"].toString(); just = juce::Justification::centred; break;
        case nameColumn: text = r["name"].toString(); just = juce::Justification::centredLeft; break;
        case roleColumn: text = r["role"].toString(); just = juce::Justification::centredLeft; break;
        case leadColumn:
            text = (bool) r["lead"] ? juce::String (juce::CharPointer_UTF8 ("\xe2\x98\x85")) : juce::String();
            just = juce::Justification::centred;
            break;
        case levelColumn: text = r["level"].toString(); break;
        case nowColumn: text = r["now"].toString(); break;
        case changeColumn: text = r["change"].toString(); break;
        case newColumn: text = r["new"].toString(); break;
        default: break;
    }
    g.setColour (style == "off" ? colour::dim : column == leadColumn ? colour::accent : colour::text);
    g.setFont (font (14.5f, style == "lead"));
    g.drawFittedText (text, 6, 0, width - 12, height, just, 1, 0.85f);
}

void MixWindow::cellClicked (int row, int column, const juce::MouseEvent&)
{
    if (column != leadColumn || ! canEdit || ! juce::isPositiveAndBelow (row, rows.size()))
        return;
    const auto& r = rows.getReference (row);
    if ((bool) r["vocal"])
        processor.send (object ({ { "cmd", "lead" }, { "index", r["index"] } }));
}

void MixWindow::cellDoubleClicked (int row, int column, const juce::MouseEvent&)
{
    if (column == leadColumn || ! canEdit || ! juce::isPositiveAndBelow (row, rows.size()))
        return;
    const auto r = rows.getReference (row);
    juce::PopupMenu menu;
    if (auto* list = roles.getArray())
        for (int i = 0; i < list->size(); ++i)
        {
            const auto& role = list->getReference (i);
            menu.addItem (i + 1, role[1].toString(), true, role[0].toString() == r["roleId"].toString());
        }
    menu.showMenuAsync (juce::PopupMenu::Options().withTargetComponent (&table).withMousePosition(),
                        [p = &processor, list = roles, r] (int picked) {
                            if (picked > 0 && list.getArray() != nullptr && picked <= list.size())
                                p->send (object ({ { "cmd", "role" },
                                                          { "index", r["index"] },
                                                          { "role", list[picked - 1][0] } }));
                        });
}

juce::AudioProcessorEditor* createPluginWindow (YTProcessor& p)
{
    return new MixWindow (p);
}

const char* workerScript()
{
    return "worker.py";
}

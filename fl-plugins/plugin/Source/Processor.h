#pragma once

#include "Worker.h"

#include <juce_audio_processors/juce_audio_processors.h>

/** YT-Mix and YT-Fill inside FL Studio, built from the same code. The sound passes through untouched (it goes on the
    Master insert, which FL renders too); the window and the worker are what make it one or the other. What the worker
    says is kept here, so the window shows it again when it's reopened, and what it asks to keep is saved in the project. */
class YTProcessor : public juce::AudioProcessor
{
public:
    /** The window, told of everything the worker says (on the message thread). */
    struct Listener
    {
        virtual ~Listener() = default;
        virtual void workerSaid (const juce::var& event) = 0;
    };

    struct LogLine
    {
        juce::String time, text;
        bool error = false;
    };

    YTProcessor();
    ~YTProcessor() override;

    /** Starts the worker if it isn't running (the window does, when it opens). */
    void startWorker();
    void send (const juce::var& command);
    /** Puts FL's main window in front with the keyboard, so the Ctrl+R the worker presses reaches it. */
    void focusFL();

    void addListener (Listener* l) { listeners.add (l); }
    void removeListener (Listener* l) { listeners.remove (l); }

    const juce::var& getView() const { return view; }
    const juce::Array<LogLine>& getLog() const { return logLines; }
    double getProgress() const { return progress; }

    void prepareToPlay (double, int) override {}
    void releaseResources() override {}
    bool isBusesLayoutSupported (const BusesLayout& layouts) const override;
    void processBlock (juce::AudioBuffer<float>&, juce::MidiBuffer&) override {}

    juce::AudioProcessorEditor* createEditor() override;
    bool hasEditor() const override { return true; }

    const juce::String getName() const override { return JucePlugin_Name; }
    bool acceptsMidi() const override { return false; }
    bool producesMidi() const override { return false; }
    double getTailLengthSeconds() const override { return 0.0; }

    int getNumPrograms() override { return 1; }
    int getCurrentProgram() override { return 0; }
    void setCurrentProgram (int) override {}
    const juce::String getProgramName (int) override { return {}; }
    void changeProgramName (int, const juce::String&) override {}

    void getStateInformation (juce::MemoryBlock& destData) override;
    void setStateInformation (const void* data, int sizeInBytes) override;

private:
    void heard (const juce::String& line);
    void addLog (const juce::String& text, bool error);
    juce::String commandLine (juce::String& problem) const;

    Worker worker;
    juce::var view, saved;
    juce::Array<LogLine> logLines;
    double progress = 0.0;
    juce::ListenerList<Listener> listeners;

    JUCE_DECLARE_WEAK_REFERENCEABLE (YTProcessor)
    JUCE_DECLARE_NON_COPYABLE_WITH_LEAK_DETECTOR (YTProcessor)
};

/** What makes a plugin this one or the other: each target builds one window's .cpp, which defines both of these. */
juce::AudioProcessorEditor* createPluginWindow (YTProcessor&);
const char* workerScript();

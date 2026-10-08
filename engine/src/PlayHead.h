// What hosted plugins are told about the song: its tempo and time signature, where it is, whether it plays and
// what it loops. Without it a plugin knows none of this: its synced LFOs and delays run at its own default tempo
// (Serum's 120 BPM), never in time with the song.
//
// A sequencer fills one in on the audio thread at the start of each block (`Sequencer::updatePlayHead`), before
// any plugin runs in that block, and gives it to every plugin it plays; plugins read it while they run.
#pragma once

#include <juce_audio_basics/juce_audio_basics.h>

class EnginePlayHead final : public juce::AudioPlayHead
{
public:
    juce::Optional<PositionInfo> getPosition() const override { return info; }

    PositionInfo info;
};

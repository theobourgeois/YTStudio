// A song as the engine plays it: what `shared/music/compile.ts` made of the document (`EngineSong`),
// with its samples loaded. Built on the message thread, then handed whole to the audio thread
// (`Sequencer::setSong`), which only reads it, but for the mixer's scratch buffers (`audio`) and where
// a fader's move ramps from (`Track::from`), which only the audio thread touches once it's handed over.
#pragma once

#include "Delay.h"
#include "AutoTune.h"
#include "EchoBoy.h"
#include "GrossBeat.h"
#include "PanMan.h"
#include "ProQ.h"
#include "Ott.h"
#include "ProC.h"
#include "Reverb.h"
#include "PitchWheel.h"
#include "Host.h"
#include "Resampling.h"

#include <juce_audio_formats/juce_audio_formats.h>
#include <array>
#include <map>
#include <memory>
#include <vector>

/** An audio file in memory. */
struct Sample
{
    juce::AudioBuffer<float> audio;
    double sampleRate = 44100.0;
};

/** What's done to a sample before it plays (the document's `Precomputed`): trim, reverse, normalise, fade. */
struct Precomputed
{
    bool normalize = false, reverse = false;
    /** Fractions: where the sample starts, how much of the rest is kept, and the fades at each end of that. */
    double start = 0, length = 1, fadeIn = 0, fadeOut = 0;

    bool changesNothing() const { return ! normalize && ! reverse && start <= 0 && length >= 1 && fadeIn <= 0 && fadeOut <= 0; }
    juce::String key() const;
    /** `raw` with all of it applied. */
    std::shared_ptr<const Sample> apply (const Sample& raw) const;
};

/**
 * The samples loaded so far (message thread). A file is read once and kept for as long as the engine
 * runs. A prepared version of one (`Precomputed`) lives only as long as a song uses it: the songs own
 * those, and this only remembers them so that the next song, usually the same but for one edit, gets
 * the same one back rather than another copy.
 */
class SampleCache
{
public:
    SampleCache();
    /** The file's sound, reading it the first time; null when it can't be read. */
    std::shared_ptr<const Sample> get (const juce::String& path);
    /** The file's sound, prepared. */
    std::shared_ptr<const Sample> get (const juce::String& path, const Precomputed&);

private:
    juce::AudioFormatManager formats;
    std::map<juce::String, std::shared_ptr<const Sample>> loaded;
    std::map<juce::String, std::weak_ptr<const Sample>> prepared;
};

struct Song
{
    /**
     * A sampler's envelope (FL's DAHDSR with tensions): its volume's, or another target's, which moves it
     * by `amount`. `level` is `envelopeLevel` in shared/music/sampler.ts: keep the two the same.
     */
    struct Envelope
    {
        float attack = 0, decay = 0, sustain = 1, release = 0;
        float delay = 0, hold = 0, attackTension = 0, decayTension = 0, releaseTension = 0;
        float amount = 1;
        bool enabled = false;
        /** Its level (0..1) `t` seconds into its note, the note let go at `released` seconds (negative: still held). */
        float level (double t, double released) const;
        /** Whether it has gone quiet for good, `t` seconds in (let go at `released`). */
        bool over (double t, double released) const { return released >= 0 && t - released >= release; }
    };

    /** An LFO (FL's): `value` is `lfoValue` in shared/music/sampler.ts, -1..1 before its amount. */
    struct Lfo
    {
        bool enabled = false;
        /** 0 sine, 1 triangle, 2 square, 3 saw. */
        int shape = 0;
        /** Cycles a second; with `sync`, beats a cycle. */
        double speed = 4;
        bool sync = false;
        float amount = 0.5f;
        double delay = 0, attack = 0;
        float value (double t, double tempo) const;
    };

    /** A sampler target's envelope and LFO (pan, cutoff, resonance, pitch). */
    struct Modulation
    {
        Envelope envelope;
        Lfo lfo;
        bool any() const { return envelope.enabled || lfo.enabled; }
        /** How far it moves its target `t` seconds in (-1..1 each, added). */
        float at (double t, double released, double tempo) const
        {
            return (envelope.enabled ? envelope.level (t, released) * envelope.amount : 0.0f) + (lfo.enabled ? lfo.value (t, tempo) * lfo.amount : 0.0f);
        }
    };

    struct Channel
    {
        juce::String id;
        std::shared_ptr<const Sample> sample;
        /** A plugin channel's instrument, once it's loaded (the channel is silent until then). */
        std::shared_ptr<HostedPlugin> plugin;
        bool isPlugin = false;
        /**
         * An audio clip's channel: its file (`path`) is streamed as its clips play (`ClipPlayer`), not read
         * whole, unless it has precomputed effects: then, as a sampler's, it's prepared in memory (`sample`,
         * FL's way) and its clips play that.
         */
        bool stream = false;
        juce::String path;
        /** What its precomputed effects are (`Precomputed::key`), so a clip's stream changes when they do. */
        juce::String prepared;
        float gainLeft = 1, gainRight = 1;
        /** Semitones added to every note. */
        float pitch = 0;
        /** A new note silences the channel's notes still sounding. */
        bool cutSelf = false;
        /** Without one, a note plays its whole sample whatever its length. */
        bool hasEnvelope = false;
        Envelope envelope;
        /** A sampler's volume LFO, its other targets' envelopes and LFOs, its filter and its loop (`shared/music/sampler.ts`). */
        Lfo volumeLfo;
        Modulation pan, cutoff, resonance, pitchMod;
        /** 0 none, 1 low pass, 2 band pass, 3 high pass; its cutoff and resonance 0..1 (`cutoffHz`, `resonanceQ`). */
        int filterType = 0;
        float filterCutoff = 1, filterResonance = 0;
        /** Its loop, in fractions of its prepared sample, going round while a note is held. */
        bool loop = false;
        double loopStart = 0, loopEnd = 1, loopCrossfade = 0;
        /** Any of these is on: its voices go the long way round (`Sequencer::render`). */
        bool shaped = false;
        /** Index into `tracks`: the mixer track it plays into. */
        int track = 0;
        /**
         * Samples its sound waits before its track (delay compensation: its track's other inputs are
         * later), and the delay line that does it (`Sequencer::setSong` gives it one when it's > 0).
         */
        int delay = 0;
        std::shared_ptr<DelayLine> delayLine;
        /**
         * Automated (a `Lane` drives its gains): they glide across the block from these to `gainLeft`
         * and `gainRight`. The audio thread's.
         */
        bool ramp = false;
        float fromLeft = 1, fromRight = 1;
    };

    /**
     * A mixer track. What's added into it goes through `gains` (the fader, pan and mute, as a stereo
     * matrix: [left→left, right→left, left→right, right→right]) and into each send's track.
     */
    struct Track
    {
        struct Send
        {
            /** Always a later track. */
            int track = 0;
            float gain = 1;
            /** The gain the last song had for it, which the first block ramps from. */
            float from = 1;
            /** Index into the previous song's track's sends (-1: a new send, it ramps from silence). */
            int previous = -1;
            /** Samples it waits before its track (delay compensation), and the delay line that does it. */
            int delay = 0;
            std::shared_ptr<DelayLine> delayLine;
            /** Automated: it glides from `from` to `gain` across each block. */
            bool automated = false;
            /** Taken before the track's gains (its fader and pan), from `preBuffer`. */
            bool preFader = false;
        };

        /** An effect in one of its slots. */
        struct Effect
        {
            /** The slot's effect (`MixerEffect.id`). */
            juce::String id;
            /** Once it's loaded (the effect is skipped until then). */
            std::shared_ptr<HostedPlugin> plugin;
            /** Off: bypassed, not run. */
            bool enabled = true;
            /** 0..1 of the effect's sound against the dry sound. */
            float mix = 1;
            /** A Gross Beat (ours, not a plugin: `plugin` is null): its sound, kept across songs, and this song's settings for it. */
            std::shared_ptr<gross::State> gross;
            std::shared_ptr<gross::Settings> grossSettings;
            /** An Auto-Tune (ours, likewise): its sound, kept across songs, and this song's settings for it. */
            std::shared_ptr<tune::State> tune;
            std::shared_ptr<tune::Settings> tuneSettings;
            /** An EchoBoy (ours too): its sound, kept across songs, and this song's settings for it. */
            std::shared_ptr<echo::State> echo;
            std::shared_ptr<echo::Settings> echoSettings;
            /** A Pro-Q (ours too): its sound, kept across songs, and this song's settings for it. */
            std::shared_ptr<eq::State> eq;
            std::shared_ptr<eq::Settings> eqSettings;
            /** An OTT (ours too): its sound, kept across songs, and this song's settings for it. */
            std::shared_ptr<ott::State> ott;
            std::shared_ptr<ott::Settings> ottSettings;
            /** A Pro-C (ours too): its sound, kept across songs, and this song's settings for it (its key's track and delay in them). */
            std::shared_ptr<comp::State> comp;
            std::shared_ptr<comp::Settings> compSettings;
            /** A PanMan (ours too): its sound's state, kept across songs, and this song's settings for it. */
            std::shared_ptr<panman::State> pan;
            std::shared_ptr<panman::Settings> panSettings;
            /** A Pitch Wheel (ours too): its sound, kept across songs, and this song's settings for it. */
            std::shared_ptr<wheel::State> wheel;
            std::shared_ptr<wheel::Settings> wheelSettings;
            /** A Reverb (ours too): its sound, kept across songs, and this song's settings for it (its ducking key's track in them). */
            std::shared_ptr<verb::State> verb;
            std::shared_ptr<verb::Settings> verbSettings;
        };

        juce::String id;
        /** In the order the sound goes through them. */
        std::vector<Effect> effects;
        std::array<float, 4> gains { 1, 0, 0, 1 };
        std::array<float, 4> from { 1, 0, 0, 1 };
        std::vector<Send> sends;
        /** Its channel pair in `audio`, or -1: nothing can reach it, so it's skipped. */
        int buffer = -1;
        /** A pair holding its sound before its gains, for its pre-fader sends (-1: it has none). */
        int preBuffer = -1;
        /** Index into the previous song's tracks (-1: a new track). */
        int previous = -1;
        /** Its manual delay compensation (`MixerTrack.latencyOffset`), in ms. */
        double latencyOffsetMs = 0;
        /** Samples its sound comes out late by, after its effects (`compensate`): a stem is held back by what the master's is later. */
        int latency = 0;
        /** Its input on the device (`EngineInput`): the channels (one is heard on both sides), whether it's heard, and armed. */
        std::vector<int> input;
        bool monitor = false, armed = false;
        /** Automated: its gains glide from `from` to `gains` across each block. */
        bool automated = false;
    };

    /**
     * An automated control (`EngineLane`): straight lines between points in ticks of the loop, each point
     * `size` values: a channel's two gains, a track's four, a send's gain, an effect's mix, or a plugin
     * parameter's value (0..1; below 0 where the plugin keeps its own).
     */
    struct Lane
    {
        enum class Kind { channel, pitch, track, send, mix, gross, tune, echo, eq, ott, comp, panman, wheel, verb, param };
        Kind kind = Kind::channel;
        /** What it drives: the channel, or the track (and its send or effect), by index; a Gross Beat's control (`GrossControl`: its time slot, volume slot, time mix, volume mix, attack, release, tension), an Auto-Tune's (`AutoTuneControl`, by index), an EchoBoy's (`echo::Control`), an OTT's (`ott::Lane`), a Pitch Wheel's (`PitchWheelControl`, by index), or a PanMan's (`PanControl`: offset, width, rate, input, output). */
        int channel = -1, track = -1, index = -1, control = 0;
        /** A Pro-Q's band (its number; 0 its output) and control (frequency, gain, Q, range, output). */
        int band = 0;
        int size = 1;
        std::vector<double> ticks;
        std::vector<float> values;
        /** The most values a point has (a PanMan's pattern; an EchoBoy's taps, four each). */
        static constexpr int maxSize = 128;
        /** What it drives as the song has it, unautomated: put back when the song stops. */
        std::array<float, maxSize> base {};

        /** A plugin parameter's: its plugin, the parameter, and what names it across songs. */
        std::shared_ptr<HostedPlugin> plugin;
        juce::AudioProcessorParameter* parameter = nullptr;
        int parameterIndex = -1;
        juce::String key;
        /** The audio thread's: the plugin's own value (taken when play starts), and the value this lane last gave it (below -1: none yet). */
        float own = 0;
        float lastSet = -2;

        /** Its values at `tick` into `out` (`size` of them): the later of two points on one tick, the ends held. `cursor` speeds the next lookup. */
        void valueAt (double tick, float* out);
        size_t cursor = 0;
    };

    struct Note
    {
        int channel = 0;
        /** Ticks from the loop's start. */
        double tick = 0, length = 0;
        /** Semitones from the sample's own pitch. */
        float pitch = 0;
        float gain = 1;
        /** For a plugin: the MIDI note and its velocity, 0..1. */
        int key = 60;
        float velocity = 0.78f;
        /** -1 (left) .. 1 (right), on top of the channel's. */
        float pan = 0;
    };

    /** An audio clip of the playlist: its channel's file, from `seconds` in, at `tick` of the loop (negative: it began before the loop does). */
    struct AudioClip
    {
        int channel = 0;
        double tick = 0, length = 0, seconds = 0;
        /** How fast it plays its file (its stretch, and its channel's pitch in Resample): seconds of the file per second. */
        double speed = 1;
        /** Stretch mode: `speed` stretches it in time, its pitch kept and shifted by `transpose` semitones. */
        bool keepPitch = false;
        double transpose = 0;
        /** Its own gain, and its fades (ticks from its start and before its end) and how they bend (-1..1). Not in its key: they change as it plays. */
        float gain = 1, fadeInTension = 0, fadeOutTension = 0;
        double fadeIn = 0, fadeOut = 0;
        /** Its channel's file. */
        juce::String path;
        /** Its channel's sound prepared by its precomputed effects, in memory: played instead of the file. */
        std::shared_ptr<const Sample> sample;
        /** The same clip in the next song has the same key, so a stream playing it carries on through an edit. */
        juce::uint64 key = 0;
    };

    double tempo = 120, ppq = 96;
    /** How samplers and audio clips are read when pitched or at another rate (playback's choice, or the export's). */
    Resampling resampling = Resampling::hermite;
    /** The loop's length, and a beat's and a bar's (the metronome), in ticks. */
    double loopTicks = 384, beatTicks = 96, barTicks = 384;
    /** Where the loop starts in the pattern or the song (the engine's ticks count from it): where the bars are. */
    double offsetTicks = 0;
    /** With tempo clips: the metronome's beats from the loop's start (no longer every `beatTicks`), and those starting bars. Empty: every `beatTicks`. */
    std::vector<double> clicks, barClicks;
    /** Round and round (playing); or, exported, it plays once and then nothing more is started. */
    bool loops = true;
    std::vector<Channel> channels;
    /** In order of `tick`. */
    std::vector<Note> notes;
    /** In order of `tick`. */
    std::vector<AudioClip> audioClips;
    /** In the order they're run: each after every track sending to it. The master is the last. */
    std::vector<Track> tracks;
    /** The automated controls (song mode). */
    std::vector<Lane> lanes;
    /** The Pitch Wheels that a channel's notes play (`notesFrom`): the channel's index and the wheel's sound (its effect holds it). */
    struct WheelListener
    {
        int channel = -1;
        wheel::State* state = nullptr;
    };
    std::vector<WheelListener> wheelListeners;
    /**
     * The tracks something reaches, in stages: none in a stage sends to another in it, and each stage's
     * senders are all in earlier ones. So a stage's tracks can be run at once (the export does).
     */
    std::vector<std::vector<int>> stages;
    /** Two channels for each track that can be reached, `capacity` samples long: the mixer's scratch. */
    juce::AudioBuffer<float> audio;
    /** Scratch too: the plugin channels a block plays (room for all of them is made when it's parsed). */
    std::vector<int> playingPlugins;
    /** The channel pair in `audio` where the selected tracks' sound is added up (`Sequencer::setMeteredTracks`). */
    int selectionBuffer = 0;
    /** The longest block the song can play (a longer one plays silence). */
    int capacity = 0;
    /**
     * Samples the song's sound comes out late by (its plugins' delays, compensated): what's played is
     * heard this much after it's scheduled, so the playhead is shown that much later too.
     */
    int latency = 0;
    /** Tells songs apart, so the next one knows whether its `previous` indexes are into this one. */
    juce::uint64 serial = 0, previousSerial = 0;
    /** The channel a MIDI keyboard plays (index into `channels`), or -1: the rack's selected one, set as it's handed over (`Sequencer::setSong`). */
    int midiChannel = -1;

    int channelIndex (const juce::String& id) const;

    /** An envelope or an LFO from an `EngineSong`'s JSON (`shared/music/compile.ts`). */
    static Envelope parseEnvelope (const juce::var& json);
    static Lfo parseLfo (const juce::var& json);

    /**
     * From the JSON of an `EngineSong`. `instruments` hosts the plugin channels' plugins and `effects` the
     * mixer's, `grossBeats`, `echoBoys` and `panMen` keep its Gross Beats', EchoBoys' and PanMen's sounds; `unreadable` gets the ids of channels whose
     * sample couldn't be read. Unless `keepOnly` is false (a copy for the export), the hosts let go of the
     * plugins the song doesn't have.
     */
    static std::unique_ptr<Song> parse (const juce::var& json, SampleCache& samples, PluginHost& instruments, PluginHost& effects, gross::Registry& grossBeats, tune::Registry& autoTunes, echo::Registry& echoBoys, eq::Registry& eqs, ott::Registry& otts, comp::Registry& procs,
                                        panman::Registry& panMen, wheel::Registry& pitchWheels, verb::Registry& reverbs, juce::StringArray& unreadable, int capacity, double sampleRate, bool keepOnly = true);

    /**
     * Plugin delay compensation (FL Studio's automatic PDC): every path into a track waits until the
     * latest of them arrives (`Channel::delay`, `Track::Send::delay`), so everything lines up at the
     * master; `latency` is how late that is. From the plugins' reported delays and the tracks' offsets.
     */
    void compensate (double sampleRate);

    /** The lanes of an `EngineSong` (`lanes`), once its channels and tracks are parsed: those that name nothing it has are left out. */
    static void parseLanes (Song&, const juce::var& json);
};

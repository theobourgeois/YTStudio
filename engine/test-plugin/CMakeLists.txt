# A tiny VST3 synth of our own, so hosting can be checked on a computer with no plugins installed.
# It isn't installed anywhere: the engine is pointed at the build folder (`--plugin-path`).
juce_add_plugin(
  VaudioTestSynth
  PRODUCT_NAME "Vaudio Test Synth"
  COMPANY_NAME "Vaudio"
  BUNDLE_ID gg.jestr.vaudio.testsynth
  PLUGIN_MANUFACTURER_CODE Vaud
  PLUGIN_CODE Vts1
  FORMATS VST3
  IS_SYNTH TRUE
  NEEDS_MIDI_INPUT TRUE
  COPY_PLUGIN_AFTER_BUILD FALSE)

target_sources(VaudioTestSynth PRIVATE TestSynth.cpp)

target_compile_definitions(VaudioTestSynth PUBLIC JUCE_WEB_BROWSER=0 JUCE_USE_CURL=0 JUCE_VST3_CAN_REPLACE_VST2=0
                                                  JUCE_DISPLAY_SPLASH_SCREEN=0)

target_link_libraries(
  VaudioTestSynth
  PRIVATE juce::juce_audio_utils
  PUBLIC juce::juce_recommended_config_flags juce::juce_recommended_warning_flags)

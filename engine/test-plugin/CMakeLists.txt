# Tiny VST3s of our own, so hosting can be checked on a computer with no plugins installed: a synth for
# plugin channels and an effect (a gain) for the mixer. They aren't installed anywhere: the engine is
# pointed at their build folders (`--plugin-path`).
function(vaudio_test_plugin target name code synth source)
  juce_add_plugin(
    ${target}
    PRODUCT_NAME "${name}"
    COMPANY_NAME "Vaudio"
    BUNDLE_ID gg.jestr.vaudio.${code}
    PLUGIN_MANUFACTURER_CODE Vaud
    PLUGIN_CODE ${code}
    FORMATS VST3
    IS_SYNTH ${synth}
    NEEDS_MIDI_INPUT ${synth}
    COPY_PLUGIN_AFTER_BUILD FALSE)

  target_sources(${target} PRIVATE ${source})

  target_compile_definitions(${target} PUBLIC JUCE_WEB_BROWSER=0 JUCE_USE_CURL=0 JUCE_VST3_CAN_REPLACE_VST2=0
                                              JUCE_DISPLAY_SPLASH_SCREEN=0)

  target_link_libraries(
    ${target}
    PRIVATE juce::juce_audio_utils
    PUBLIC juce::juce_recommended_config_flags juce::juce_recommended_warning_flags)
endfunction()

vaudio_test_plugin(VaudioTestSynth "Vaudio Test Synth" Vts1 TRUE TestSynth.cpp)
vaudio_test_plugin(VaudioTestEffect "Vaudio Test Effect" Vte1 FALSE TestEffect.cpp)

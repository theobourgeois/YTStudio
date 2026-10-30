# YT-Mix and YT-Fill as plugins inside FL Studio: VST3 effects that pass their sound through untouched, put on the Master
# insert. Each is a window and a hidden Python worker it starts (see Worker.cpp): worker.py for YT-Mix, fill_worker.py for
# YT-Fill. YT-Mix was YTStudio Auto Mix: its plugin code stays, because FL knows it by that in saved projects.
#
#   powershell -ExecutionPolicy Bypass -File plugin\build.ps1      configure, build, and install into Common Files\VST3
#
# JUCE comes from the editor's engine build (engine/build/_deps/juce-src), or -DJUCE_DIR=<a JUCE checkout>.
cmake_minimum_required(VERSION 3.22)
project(YTStudioPlugins VERSION 1.0.0 LANGUAGES C CXX)

set(CMAKE_CXX_STANDARD 20)
set(JUCE_DIR "$ENV{USERPROFILE}/code/editor/engine/build/_deps/juce-src" CACHE PATH "A JUCE checkout")
add_subdirectory(${JUCE_DIR} juce)

function(yt_plugin target name bundle code window)
  juce_add_plugin(
    ${target}
    PRODUCT_NAME "${name}"
    COMPANY_NAME "YTStudio"
    BUNDLE_ID ${bundle}
    PLUGIN_MANUFACTURER_CODE YtSt
    PLUGIN_CODE ${code}
    FORMATS VST3
    IS_SYNTH FALSE
    NEEDS_MIDI_INPUT FALSE
    NEEDS_MIDI_OUTPUT FALSE
    # FL's keys (Ctrl+R starts its export) must reach FL, not this window
    EDITOR_WANTS_KEYBOARD_FOCUS FALSE
    VST3_CATEGORIES Fx Tools
    COPY_PLUGIN_AFTER_BUILD FALSE)

  target_sources(${target} PRIVATE Source/Processor.cpp Source/Window.cpp Source/${window} Source/Worker.cpp)

  target_compile_definitions(${target} PUBLIC JUCE_WEB_BROWSER=0 JUCE_USE_CURL=0 JUCE_VST3_CAN_REPLACE_VST2=0
                                              JUCE_DISPLAY_SPLASH_SCREEN=0)

  target_link_libraries(
    ${target}
    PRIVATE juce::juce_audio_utils
    PUBLIC juce::juce_recommended_config_flags juce::juce_recommended_lto_flags juce::juce_recommended_warning_flags)
endfunction()

yt_plugin(YTMix "YT-Mix" gg.jestr.yt.automix YtAm MixWindow.cpp)
yt_plugin(YTFill "YT-Fill" gg.jestr.yt.fill YtFi FillWindow.cpp)

# The music suite's audio engine: a native program the server runs (server/music/engine.ts), since
# plugins (VST3, Audio Units) are native code no browser can load. JUCE does the hosting and the
# audio device; nothing here is macOS-only, so Windows and Linux builds are a matter of packaging.
#
#   pnpm engine:build     configure + build into engine/build (JUCE is fetched on the first run)
cmake_minimum_required(VERSION 3.25)
set(CMAKE_OSX_DEPLOYMENT_TARGET "11.0" CACHE STRING "")
project(VaudioEngine VERSION 0.1.0 LANGUAGES C CXX)

set(CMAKE_CXX_STANDARD 20)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
if(NOT CMAKE_BUILD_TYPE)
  set(CMAKE_BUILD_TYPE Release)
endif()

include(FetchContent)
FetchContent_Declare(
  JUCE
  GIT_REPOSITORY https://github.com/juce-framework/JUCE.git
  GIT_TAG 8.0.9
  GIT_SHALLOW ON)
FetchContent_MakeAvailable(JUCE)

# Signalsmith Stretch (MIT): the playlist's audio clips stretched in time with their pitch kept (FL's
# Stretch mode). It brings Signalsmith Linear (its FFTs: Accelerate on Apple, its own elsewhere). SYSTEM:
# its headers' warnings aren't ours.
FetchContent_Declare(
  signalsmith-stretch
  GIT_REPOSITORY https://github.com/Signalsmith-Audio/signalsmith-stretch.git
  GIT_TAG 1.4.0
  GIT_SHALLOW ON
  SYSTEM)
FetchContent_MakeAvailable(signalsmith-stretch)

# An app bundle rather than a bare executable: plugin editors are windows, and macOS only gives
# those to an application. LSUIElement keeps it out of the Dock (it's part of Vaudio, not an app).
# Recording reads the microphone, which macOS only allows an app that says why (Vaudio, which starts
# the engine, says so too: scripts/desktop.ts).
juce_add_gui_app(
  VaudioEngine
  PRODUCT_NAME "Vaudio Engine"
  BUNDLE_ID gg.jestr.vaudio.engine
  COMPANY_NAME "Vaudio"
  MICROPHONE_PERMISSION_ENABLED TRUE
  MICROPHONE_PERMISSION_TEXT "Vaudio records your microphone or audio interface when you arm a mixer track."
  PLIST_TO_MERGE "<plist><dict><key>LSUIElement</key><true/></dict></plist>")

target_sources(VaudioEngine PRIVATE src/Main.cpp src/AudioStream.cpp src/AutoTune.cpp src/ClipPlayer.cpp src/Convolver.cpp src/EchoBoy.cpp src/EditorWindow.cpp src/Engine.cpp src/EqDesign.cpp src/Export.cpp src/FilePreview.cpp src/GrossBeat.cpp src/Host.cpp src/MacWindow.cpp src/MidiInputs.cpp src/Ott.cpp src/PanMan.cpp src/PitchWheel.cpp src/Plugins.cpp src/ProC.cpp src/ProQ.cpp src/Protocol.cpp src/Reverb.cpp src/ReverbNetwork.cpp src/ReverbSettings.cpp src/Recorder.cpp src/Sequencer.cpp src/Song.cpp src/Spectrum.cpp)

target_compile_definitions(
  VaudioEngine
  PRIVATE JUCE_PLUGINHOST_VST3=1
          $<$<PLATFORM_ID:Darwin>:JUCE_PLUGINHOST_AU=1>
          JUCE_WEB_BROWSER=0
          JUCE_USE_CURL=0
          JUCE_DISPLAY_SPLASH_SCREEN=0)

target_link_libraries(
  VaudioEngine
  PRIVATE juce::juce_audio_utils juce::juce_audio_processors juce::juce_audio_devices juce::juce_dsp signalsmith-stretch
  PUBLIC juce::juce_recommended_config_flags juce::juce_recommended_warning_flags)

# ASIO on Windows: what FL Studio and every DAW there play through. Windows' own audio (WASAPI's shared
# mode) mixes every app's sound through its engine, which adds latency nobody reports (takes recorded
# late), resamples, runs the system's "enhancements", and clocks a USB interface's input and output
# apart (crackles while recording). An interface's ASIO driver talks to it directly. Steinberg's SDK
# (GPLv3 or their licence) is fetched, not kept here; JUCE only needs its headers.
if(WIN32)
  FetchContent_Declare(
    asiosdk
    URL https://download.steinberg.net/sdk_downloads/ASIO-SDK_2.3.4_2025-10-15.zip
    URL_HASH SHA256=d5ebf0c20dd2c5f43771fd0c1418f4b361bf52434ee670097cfa6b3a335e2eca
    DOWNLOAD_EXTRACT_TIMESTAMP ON)
  FetchContent_MakeAvailable(asiosdk)
  target_include_directories(VaudioEngine PRIVATE ${asiosdk_SOURCE_DIR}/common)
  target_compile_definitions(VaudioEngine PRIVATE JUCE_ASIO=1)
endif()

add_subdirectory(test-plugin)

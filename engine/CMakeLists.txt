# The music suite's audio engine: a native program the server runs (server/music/engine.ts), since
# plugins (VST3, Audio Units) are native code no browser can load. JUCE does the hosting and the
# audio device; nothing here is macOS-only, so Windows and Linux builds are a matter of packaging.
#
#   pnpm engine:build     configure + build into engine/build (JUCE is fetched on the first run)
cmake_minimum_required(VERSION 3.22)
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

# An app bundle rather than a bare executable: plugin editors are windows, and macOS only gives
# those to an application. LSUIElement keeps it out of the Dock (it's part of Vaudio, not an app).
juce_add_gui_app(
  VaudioEngine
  PRODUCT_NAME "Vaudio Engine"
  BUNDLE_ID gg.jestr.vaudio.engine
  COMPANY_NAME "Vaudio"
  PLIST_TO_MERGE "<plist><dict><key>LSUIElement</key><true/></dict></plist>")

target_sources(VaudioEngine PRIVATE src/Main.cpp src/EditorWindow.cpp src/Engine.cpp src/Host.cpp src/Plugins.cpp src/Protocol.cpp src/Sequencer.cpp src/Song.cpp)

target_compile_definitions(
  VaudioEngine
  PRIVATE JUCE_PLUGINHOST_VST3=1
          $<$<PLATFORM_ID:Darwin>:JUCE_PLUGINHOST_AU=1>
          JUCE_WEB_BROWSER=0
          JUCE_USE_CURL=0
          JUCE_DISPLAY_SPLASH_SCREEN=0)

target_link_libraries(
  VaudioEngine
  PRIVATE juce::juce_audio_utils juce::juce_audio_processors juce::juce_audio_devices
  PUBLIC juce::juce_recommended_config_flags juce::juce_recommended_warning_flags)

add_subdirectory(test-plugin)

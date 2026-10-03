#include "MacWindow.h"

#if JUCE_MAC
#include <objc/message.h>
#include <objc/runtime.h>

void keepOutOfWindowSwitchers (juce::Component& window)
{
    auto* peer = window.getPeer();
    if (peer == nullptr)
        return;
    // The Objective-C runtime from plain C++ (no .mm file): view.window, then window.collectionBehavior |= ...
    auto* view = static_cast<id> (peer->getNativeHandle());
    if (view == nullptr)
        return;
    using Get = id (*) (id, SEL);
    using GetBits = unsigned long (*) (id, SEL);
    using SetBits = void (*) (id, SEL, unsigned long);
    auto* nsWindow = reinterpret_cast<Get> (objc_msgSend) (view, sel_registerName ("window"));
    if (nsWindow == nullptr)
        return;
    constexpr unsigned long transient = 1 << 3;    // NSWindowCollectionBehaviorTransient: not shown by Mission Control
    constexpr unsigned long ignoresCycle = 1 << 6; // NSWindowCollectionBehaviorIgnoresCycle: skipped by Cmd-`
    const auto now = reinterpret_cast<GetBits> (objc_msgSend) (nsWindow, sel_registerName ("collectionBehavior"));
    reinterpret_cast<SetBits> (objc_msgSend) (nsWindow, sel_registerName ("setCollectionBehavior:"), now | transient | ignoresCycle);
}
#else
void keepOutOfWindowSwitchers (juce::Component&) {}
#endif

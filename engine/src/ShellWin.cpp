#if defined(_WIN32)
 #ifndef NOMINMAX
  #define NOMINMAX
 #endif
 #include <windows.h>
 #include <windowsx.h>
 #include <commctrl.h>
 #include <shlobj.h>
 #pragma comment(lib, "comctl32.lib")
 #pragma comment(lib, "shell32.lib")
#endif

#include "ShellWin.h"

#if JUCE_WINDOWS
namespace winShell
{
namespace
{
constexpr UINT_PTR subclassId = 0x59545354; // "YTST"

struct Dressing
{
    std::function<void (unsigned int, juce::Point<int>)> forward;
    /** The pointer is over the maximise button (the page was told it's there). */
    bool overMaximise = false;
};

juce::Point<int> screenPoint (LPARAM lParam)
{
    return { GET_X_LPARAM (lParam), GET_Y_LPARAM (lParam) };
}

LRESULT CALLBACK windowProc (HWND hwnd, UINT message, WPARAM wParam, LPARAM lParam, UINT_PTR, DWORD_PTR data)
{
    auto& dressing = *reinterpret_cast<Dressing*> (data);
    switch (message)
    {
        case WM_NCMOUSEMOVE:
            if (wParam == HTMAXBUTTON)
            {
                if (! dressing.overMaximise)
                {
                    // Told when it leaves (WM_NCMOUSELEAVE), as a window is for its own non-client area.
                    TRACKMOUSEEVENT track { sizeof (track), TME_LEAVE | TME_NONCLIENT, hwnd, 0 };
                    TrackMouseEvent (&track);
                    dressing.overMaximise = true;
                }
                dressing.forward (WM_MOUSEMOVE, screenPoint (lParam));
                return 0;
            }
            if (std::exchange (dressing.overMaximise, false))
                dressing.forward (WM_MOUSELEAVE, {});
            break;

        case WM_NCMOUSELEAVE:
            if (std::exchange (dressing.overMaximise, false))
                dressing.forward (WM_MOUSELEAVE, {});
            break;

        // (JUCE would maximise on its own at the button's release, and DefWindowProc draw the system's button.)
        case WM_NCLBUTTONDOWN:
        case WM_NCLBUTTONDBLCLK:
            if (wParam == HTMAXBUTTON)
            {
                dressing.forward (WM_LBUTTONDOWN, screenPoint (lParam));
                return 0;
            }
            break;

        case WM_NCLBUTTONUP:
            if (wParam == HTMAXBUTTON)
            {
                dressing.forward (WM_LBUTTONUP, screenPoint (lParam));
                return 0;
            }
            break;

        case WM_NCDESTROY:
            RemoveWindowSubclass (hwnd, &windowProc, subclassId);
            delete &dressing;
            break;

        default:
            break;
    }
    return DefSubclassProc (hwnd, message, wParam, lParam);
}
} // namespace

void dress (juce::Component& window, std::function<void (unsigned int, juce::Point<int>)> forward)
{
    auto* peer = window.getPeer();
    auto* hwnd = peer != nullptr ? static_cast<HWND> (peer->getNativeHandle()) : nullptr;
    if (hwnd == nullptr)
        return;
    DWORD_PTR existing = 0;
    if (GetWindowSubclass (hwnd, &windowProc, subclassId, &existing))
    {
        reinterpret_cast<Dressing*> (existing)->forward = std::move (forward);
        return;
    }
    SetWindowSubclass (hwnd, &windowProc, subclassId, reinterpret_cast<DWORD_PTR> (new Dressing { std::move (forward) }));
}

void noteRecent (const juce::String& path)
{
    SHAddToRecentDocs (SHARD_PATHW, path.toWideCharPointer());
}
} // namespace winShell
#endif

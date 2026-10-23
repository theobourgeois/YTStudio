#if defined(_WIN32)
 #ifndef NOMINMAX
  #define NOMINMAX
 #endif
 #include <windows.h>
 #include <windowsx.h>
 #include <dcomp.h>
 #include <wrl.h>
 #include <WebView2.h>
 #include <WebView2EnvironmentOptions.h>
 #pragma comment(lib, "dcomp.lib")
#endif

#include "WebView.h"

#if JUCE_WINDOWS
#include "Protocol.h"

#include <cstdio>
#include <optional>

using Microsoft::WRL::Callback;
using Microsoft::WRL::ComPtr;

namespace
{
const wchar_t* const windowClass = L"YTStudioWebView";

/** A string WebView2 handed over: its memory is ours to free. */
juce::String take (LPWSTR text)
{
    const auto result = text != nullptr ? juce::String (text) : juce::String();
    CoTaskMemFree (text);
    return result;
}

void failed (const char* what, HRESULT result)
{
    std::fprintf (stderr, "[webview] %s failed (0x%08lx)\n", what, (unsigned long) result);
}

bool isMouseMessage (UINT message)
{
    return (message >= WM_MOUSEFIRST && message <= WM_MOUSELAST) || message == WM_MOUSELEAVE;
}
} // namespace

/**
 * The window WebView2 lives in (a child of the shell's, through `HWNDComponent`), and WebView2 itself. Everything
 * here runs on the message thread; WebView2 calls back on it too.
 */
class WebView::Host
{
public:
    Host (const juce::String& urlToShow, const juce::File& userDataFolder, juce::Colour backgroundToUse, CommandHandler handler)
        : url (urlToShow),
          background (backgroundToUse),
          onCommand (std::move (handler)),
          composition (juce::SystemStats::getEnvironmentVariable ("VAUDIO_WEBVIEW_HOSTING", {}) == "composition")
    {
        static const auto registered = [] {
            WNDCLASSEXW type {};
            type.cbSize = sizeof (type);
            type.style = CS_DBLCLKS;
            type.lpfnWndProc = &Host::windowProc;
            type.hInstance = GetModuleHandleW (nullptr);
            type.lpszClassName = windowClass;
            return RegisterClassExW (&type) != 0;
        }();
        juce::ignoreUnused (registered);
        hwnd = CreateWindowExW (0, windowClass, L"", WS_POPUP | WS_CLIPCHILDREN, 0, 0, 0, 0, nullptr, nullptr, GetModuleHandleW (nullptr), nullptr);
        SetWindowLongPtrW (hwnd, GWLP_USERDATA, (LONG_PTR) this);
        std::fprintf (stderr, "[webview] %s hosting\n", composition ? "composition" : "windowed");

        auto options = Microsoft::WRL::Make<CoreWebView2EnvironmentOptions>();
        const auto result = CreateCoreWebView2EnvironmentWithOptions (
            nullptr, userDataFolder.getFullPathName().toWideCharPointer(), options.Get(),
            Callback<ICoreWebView2CreateCoreWebView2EnvironmentCompletedHandler> ([this, alive = std::weak_ptr<bool> (alive)] (HRESULT made, ICoreWebView2Environment* environmentMade) {
                if (alive.expired())
                    return S_OK;
                if (FAILED (made))
                    failed ("CreateCoreWebView2Environment", made);
                else
                    createController (environmentMade);
                return S_OK;
            }).Get());
        if (FAILED (result))
            failed ("CreateCoreWebView2EnvironmentWithOptions", result);
    }

    ~Host()
    {
        alive.reset();
        SetWindowLongPtrW (hwnd, GWLP_USERDATA, 0);
        if (controller != nullptr)
            controller->Close();
    }

    HWND window() const { return hwnd; }

    void focus()
    {
        if (controller != nullptr)
            controller->MoveFocus (COREWEBVIEW2_MOVE_FOCUS_REASON_PROGRAMMATIC);
    }

    void parentMoved()
    {
        if (controller != nullptr)
            controller->NotifyParentWindowPositionChanged();
    }

private:
    void createController (ICoreWebView2Environment* environmentMade)
    {
        environment = environmentMade;
        if (! composition)
        {
            environment->CreateCoreWebView2Controller (
                hwnd, Callback<ICoreWebView2CreateCoreWebView2ControllerCompletedHandler> ([this, alive = std::weak_ptr<bool> (alive)] (HRESULT made, ICoreWebView2Controller* controllerMade) {
                    if (alive.expired())
                        return S_OK;
                    if (FAILED (made))
                        failed ("CreateCoreWebView2Controller", made);
                    else
                        start (controllerMade);
                    return S_OK;
                }).Get());
            return;
        }
        ComPtr<ICoreWebView2Environment3> environment3;
        if (const auto result = environment.As (&environment3); FAILED (result))
        {
            failed ("ICoreWebView2Environment3", result);
            return;
        }
        environment3->CreateCoreWebView2CompositionController (
            hwnd, Callback<ICoreWebView2CreateCoreWebView2CompositionControllerCompletedHandler> ([this, alive = std::weak_ptr<bool> (alive)] (HRESULT made, ICoreWebView2CompositionController* controllerMade) {
                if (alive.expired())
                    return S_OK;
                if (FAILED (made))
                {
                    failed ("CreateCoreWebView2CompositionController", made);
                    return S_OK;
                }
                compositionController = controllerMade;
                ComPtr<ICoreWebView2Controller> plain;
                compositionController.As (&plain);
                start (plain.Get());
                return S_OK;
            }).Get());
    }

    void start (ICoreWebView2Controller* controllerMade)
    {
        controller = controllerMade;
        controller->get_CoreWebView2 (&webView);
        if (ComPtr<ICoreWebView2Controller2> controller2; SUCCEEDED (controller.As (&controller2)))
            controller2->put_DefaultBackgroundColor ({ background.getAlpha(), background.getRed(), background.getGreen(), background.getBlue() });
        if (compositionController != nullptr)
            attachVisual();

        ComPtr<ICoreWebView2Settings> settings;
        webView->get_Settings (&settings);
        settings->put_IsStatusBarEnabled (FALSE);
        // Ctrl+wheel zooms the Piano roll and the Playlist, not the page.
        settings->put_IsZoomControlEnabled (FALSE);

        EventRegistrationToken token;
        // { id, command, params } -> { id, ok, result } or { id, ok: false, error }.
        webView->add_WebMessageReceived (Callback<ICoreWebView2WebMessageReceivedEventHandler> ([this] (ICoreWebView2*, ICoreWebView2WebMessageReceivedEventArgs* args) {
            LPWSTR json = nullptr;
            if (FAILED (args->get_WebMessageAsJson (&json)))
                return S_OK;
            const auto message = juce::JSON::parse (take (json));
            const auto id = message["id"];
            onCommand (message["command"].toString(), message["params"], [this, id, alive = std::weak_ptr<bool> (alive)] (const juce::Result& result, const juce::var& value) {
                if (alive.expired() || webView == nullptr)
                    return;
                const auto reply = result.wasOk() ? protocol::object ({ { "id", id }, { "ok", true }, { "result", value } })
                                                  : protocol::object ({ { "id", id }, { "ok", false }, { "error", result.getErrorMessage() } });
                webView->PostWebMessageAsJson (juce::JSON::toString (reply, true).toWideCharPointer());
            });
            return S_OK;
        }).Get(), &token);
        // What the page opens in a new window (a link, Help's pages) goes to the computer's browser.
        webView->add_NewWindowRequested (Callback<ICoreWebView2NewWindowRequestedEventHandler> ([] (ICoreWebView2*, ICoreWebView2NewWindowRequestedEventArgs* args) {
            LPWSTR uri = nullptr;
            if (SUCCEEDED (args->get_Uri (&uri)))
                juce::URL (take (uri)).launchInDefaultBrowser();
            args->put_Handled (TRUE);
            return S_OK;
        }).Get(), &token);
        // The app's dev server may not be up yet when the engine starts: try again until it is.
        webView->add_NavigationCompleted (Callback<ICoreWebView2NavigationCompletedEventHandler> ([this] (ICoreWebView2*, ICoreWebView2NavigationCompletedEventArgs* args) {
            BOOL succeeded = TRUE;
            auto status = COREWEBVIEW2_WEB_ERROR_STATUS_UNKNOWN;
            args->get_IsSuccess (&succeeded);
            args->get_WebErrorStatus (&status);
            if (! succeeded && status != COREWEBVIEW2_WEB_ERROR_STATUS_OPERATION_CANCELED)
                juce::Timer::callAfterDelay (500, [this, alive = std::weak_ptr<bool> (alive)] {
                    if (! alive.expired())
                        webView->Navigate (url.toWideCharPointer());
                });
            return S_OK;
        }).Get(), &token);

        resize();
        controller->put_IsVisible (TRUE);
        webView->Navigate (url.toWideCharPointer());
    }

    /** Composition: WebView2 draws into a visual of ours, shown in our window by DirectComposition. */
    void attachVisual()
    {
        if (const auto result = DCompositionCreateDevice2 (nullptr, IID_PPV_ARGS (&composer)); FAILED (result))
        {
            failed ("DCompositionCreateDevice2", result);
            return;
        }
        composer->CreateTargetForHwnd (hwnd, TRUE, &target);
        composer->CreateVisual (&visual);
        target->SetRoot (visual.Get());
        compositionController->put_RootVisualTarget (visual.Get());
        composer->Commit();

        EventRegistrationToken token;
        compositionController->add_CursorChanged (Callback<ICoreWebView2CursorChangedEventHandler> ([this] (ICoreWebView2CompositionController*, IUnknown*) {
            if (pointerInside)
                SetCursor (cursor());
            return S_OK;
        }).Get(), &token);
    }

    HCURSOR cursor() const
    {
        HCURSOR shown = nullptr;
        compositionController->get_Cursor (&shown);
        return shown != nullptr ? shown : LoadCursor (nullptr, IDC_ARROW);
    }

    void resize()
    {
        if (controller == nullptr)
            return;
        RECT bounds;
        GetClientRect (hwnd, &bounds);
        controller->put_Bounds (bounds);
    }

    /** Composition: the mouse in our window goes to WebView2 (WebView2APISample's `ViewComponent::OnMouseMessage`). */
    void sendMouse (UINT message, WPARAM wParam, LPARAM lParam)
    {
        POINT point { GET_X_LPARAM (lParam), GET_Y_LPARAM (lParam) };
        if (message == WM_MOUSEWHEEL || message == WM_MOUSEHWHEEL)
            ScreenToClient (hwnd, &point);
        if (message == WM_MOUSELEAVE)
            pointerInside = false;
        else if (! pointerInside)
        {
            TRACKMOUSEEVENT track { sizeof (track), TME_LEAVE, hwnd, 0 };
            TrackMouseEvent (&track);
            pointerInside = true;
        }
        if (message == WM_LBUTTONDOWN || message == WM_MBUTTONDOWN || message == WM_RBUTTONDOWN || message == WM_XBUTTONDOWN)
            SetCapture (hwnd);
        else if ((message == WM_LBUTTONUP || message == WM_MBUTTONUP || message == WM_RBUTTONUP || message == WM_XBUTTONUP) && GetCapture() == hwnd)
            ReleaseCapture();
        const auto withData = message == WM_MOUSEWHEEL || message == WM_MOUSEHWHEEL || message == WM_XBUTTONDOWN || message == WM_XBUTTONUP || message == WM_XBUTTONDBLCLK;
        compositionController->SendMouseInput ((COREWEBVIEW2_MOUSE_EVENT_KIND) message,
                                               (COREWEBVIEW2_MOUSE_EVENT_VIRTUAL_KEYS) GET_KEYSTATE_WPARAM (wParam),
                                               withData ? (UINT32) (INT16) HIWORD (wParam) : 0u,
                                               point);
    }

    std::optional<LRESULT> handle (UINT message, WPARAM wParam, LPARAM lParam)
    {
        if (message == WM_SIZE)
        {
            resize();
            return 0;
        }
        if (message == WM_SETFOCUS)
        {
            focus();
            return 0;
        }
        if (message == WM_ERASEBKGND)
        {
            RECT area;
            GetClientRect (hwnd, &area);
            auto* brush = CreateSolidBrush (RGB (background.getRed(), background.getGreen(), background.getBlue()));
            FillRect ((HDC) wParam, &area, brush);
            DeleteObject (brush);
            return 1;
        }
        if (compositionController == nullptr)
            return {};
        if (message == WM_SETCURSOR && LOWORD (lParam) == HTCLIENT)
        {
            SetCursor (cursor());
            return TRUE;
        }
        if (isMouseMessage (message))
        {
            sendMouse (message, wParam, lParam);
            return 0;
        }
        return {};
    }

    static LRESULT CALLBACK windowProc (HWND window, UINT message, WPARAM wParam, LPARAM lParam)
    {
        if (auto* host = reinterpret_cast<Host*> (GetWindowLongPtrW (window, GWLP_USERDATA)))
            if (const auto handled = host->handle (message, wParam, lParam))
                return *handled;
        return DefWindowProcW (window, message, wParam, lParam);
    }

    const juce::String url;
    const juce::Colour background;
    const CommandHandler onCommand;
    const bool composition;
    std::shared_ptr<bool> alive = std::make_shared<bool> (true);
    HWND hwnd = nullptr;
    bool pointerInside = false;
    ComPtr<ICoreWebView2Environment> environment;
    ComPtr<ICoreWebView2Controller> controller;
    ComPtr<ICoreWebView2CompositionController> compositionController;
    ComPtr<ICoreWebView2> webView;
    ComPtr<IDCompositionDevice> composer;
    ComPtr<IDCompositionTarget> target;
    ComPtr<IDCompositionVisual> visual;
};

WebView::WebView (const juce::String& url, const juce::File& userDataFolder, juce::Colour background, CommandHandler onCommand)
    : host (std::make_unique<Host> (url, userDataFolder, background, std::move (onCommand)))
{
    setHWND (host->window());
}

WebView::~WebView()
{
    // WebView2 lets go of the window before `HWNDComponent` destroys it.
    host.reset();
}

void WebView::focus()
{
    host->focus();
}

void WebView::parentMoved()
{
    host->parentMoved();
}
#endif

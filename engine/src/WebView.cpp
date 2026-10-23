#if defined(_WIN32)
 #ifndef NOMINMAX
  #define NOMINMAX
 #endif
 #include <windows.h>
 #include <windowsx.h>
 #include <dcomp.h>
 #include <dwmapi.h>
 #include <ole2.h>
 #include <shellapi.h>
 #include <shlobj.h>
 #include <wrl.h>
 #include <WebView2.h>
 #include <WebView2EnvironmentOptions.h>
 #pragma comment(lib, "dcomp.lib")
 #pragma comment(lib, "dwmapi.lib")
 #pragma comment(lib, "ole32.lib")
 #pragma comment(lib, "shell32.lib")
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

/** Whether pages are drawn through DirectComposition (WebView.h). */
bool composes()
{
    return juce::SystemStats::getEnvironmentVariable ("VAUDIO_WEBVIEW_HOSTING", {}) != "windowed";
}

void failed (const char* what, HRESULT result)
{
    std::fprintf (stderr, "[webview] %s failed (0x%08lx)\n", what, (unsigned long) result);
}

bool isMouseMessage (UINT message)
{
    return (message >= WM_MOUSEFIRST && message <= WM_MOUSELAST) || message == WM_MOUSELEAVE;
}

/** The files an Explorer drag carries (`CF_HDROP`), or none. */
juce::StringArray filesIn (IDataObject* data)
{
    juce::StringArray paths;
    FORMATETC format { CF_HDROP, nullptr, DVASPECT_CONTENT, -1, TYMED_HGLOBAL };
    STGMEDIUM medium {};
    if (data == nullptr || FAILED (data->GetData (&format, &medium)))
        return paths;
    if (auto* drop = static_cast<HDROP> (GlobalLock (medium.hGlobal)))
    {
        const auto count = DragQueryFileW (drop, 0xFFFFFFFF, nullptr, 0);
        for (UINT i = 0; i < count; ++i)
        {
            std::wstring path (DragQueryFileW (drop, i, nullptr, 0) + 1, L'\0');
            DragQueryFileW (drop, i, path.data(), (UINT) path.size());
            paths.add (juce::String (path.c_str()));
        }
        GlobalUnlock (medium.hGlobal);
    }
    ReleaseStgMedium (&medium);
    return paths;
}
} // namespace

/**
 * The window WebView2 lives in, and WebView2 itself: the page's (a child of the shell's window, through
 * `HWNDComponent`) or a window the page opened (a `PanelWindow`'s: a window of its own). Everything here runs on the
 * message thread; WebView2 calls back on it too.
 */
class WebView::Host
{
public:
    Host (const juce::String& urlToShow, const juce::File& userDataFolder, juce::Colour backgroundToUse, CommandHandler handler)
        : url (urlToShow),
          background (backgroundToUse),
          onCommand (std::move (handler)),
          composition (composes())
    {
        registerClass();
        hwnd = CreateWindowExW (0, windowClass, L"", WS_POPUP | WS_CLIPCHILDREN, 0, 0, 0, 0, nullptr, nullptr, GetModuleHandleW (nullptr), nullptr);
        SetWindowLongPtrW (hwnd, GWLP_USERDATA, (LONG_PTR) this);
        // (Drag and drop: OLE, on this thread. Counted, so JUCE's own is undisturbed.)
        oleStarted = SUCCEEDED (OleInitialize (nullptr));
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

    /**
     * A window the page opened (`NewWindowRequested`, its `request` deferred until this is ready): a window of its
     * own with no frame, owned by `owner`, which the page is given as the window it opened, its own document in it.
     */
    Host (ICoreWebView2Environment* environmentToUse, HWND owner, juce::Colour backgroundToUse,
          ComPtr<ICoreWebView2NewWindowRequestedEventArgs> request, ComPtr<ICoreWebView2Deferral> deferral)
        : background (backgroundToUse),
          composition (composes()),
          openedBy (std::move (request)),
          openedWhenReady (std::move (deferral))
    {
        registerClass();
        // A tool window: no taskbar button or Alt+Tab entry, as the plugin windows. (Composed: see-through where the
        // page is, the shared window for menus.)
        hwnd = CreateWindowExW (WS_EX_TOOLWINDOW | (composition ? WS_EX_NOREDIRECTIONBITMAP : 0), windowClass, L"", WS_POPUP | WS_CLIPCHILDREN,
                                0, 0, 480, 320, owner, nullptr, GetModuleHandleW (nullptr), nullptr);
        SetWindowLongPtrW (hwnd, GWLP_USERDATA, (LONG_PTR) this);
        // Shown and hidden at once, as the page's windows are (Windows fades and zooms windows in otherwise).
        const BOOL off = TRUE;
        DwmSetWindowAttribute (hwnd, DWMWA_TRANSITIONS_FORCEDISABLED, &off, sizeof (off));
        oleStarted = SUCCEEDED (OleInitialize (nullptr));
        createController (environmentToUse);
    }

    ~Host()
    {
        alive.reset();
        if (dropTarget != nullptr)
            RevokeDragDrop (hwnd);
        SetWindowLongPtrW (hwnd, GWLP_USERDATA, 0);
        if (openedWhenReady != nullptr)
            openedWhenReady->Complete();
        if (controller != nullptr)
            controller->Close();
        // (The page's is destroyed by `HWNDComponent`; an opened window is its own.)
        if (openedBy != nullptr)
            DestroyWindow (hwnd);
        if (oleStarted)
            OleUninitialize();
    }

    HWND window() const { return hwnd; }
    bool composited() const { return composition; }

    void setBackground (juce::Colour colour)
    {
        background = colour;
        if (ComPtr<ICoreWebView2Controller2> controller2; controller != nullptr && SUCCEEDED (controller.As (&controller2)))
            controller2->put_DefaultBackgroundColor ({ colour.getAlpha(), colour.getRed(), colour.getGreen(), colour.getBlue() });
        InvalidateRect (hwnd, nullptr, TRUE);
    }

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

    void post (const juce::var& message)
    {
        if (webView != nullptr)
            webView->PostWebMessageAsJson (juce::JSON::toString (message, true).toWideCharPointer());
    }

    void navigate (const juce::String& newUrl)
    {
        url = newUrl;
        // (Not made yet: it goes to `url` once it is.)
        if (webView != nullptr)
            webView->Navigate (url.toWideCharPointer());
    }

    void forwardMouse (UINT message, POINT screen)
    {
        if (compositionController == nullptr)
            return;
        if (message == WM_MOUSELEAVE)
        {
            compositionController->SendMouseInput (COREWEBVIEW2_MOUSE_EVENT_KIND_LEAVE, COREWEBVIEW2_MOUSE_EVENT_VIRTUAL_KEYS_NONE, 0, {});
            return;
        }
        ScreenToClient (hwnd, &screen);
        const auto held = message == WM_LBUTTONDOWN || (message == WM_MOUSEMOVE && (GetKeyState (VK_LBUTTON) & 0x8000) != 0);
        compositionController->SendMouseInput ((COREWEBVIEW2_MOUSE_EVENT_KIND) message,
                                               held ? COREWEBVIEW2_MOUSE_EVENT_VIRTUAL_KEYS_LEFT_BUTTON : COREWEBVIEW2_MOUSE_EVENT_VIRTUAL_KEYS_NONE,
                                               0, screen);
    }

    std::function<bool (POINT)> nonClient;
    std::function<void (const juce::StringArray&)> dragged;
    std::function<bool (const juce::String&)> acceptsWindow;
    std::function<void (const juce::String&, std::unique_ptr<PanelWindow>)> windowOpened;
    std::function<void()> leaving;
    /** An opened window was closed by something other than the page (Alt+F4, `window.close`). */
    std::function<void()> closed;

private:
    static void registerClass()
    {
        static const auto registered = [] {
            WNDCLASSEXW type {};
            type.cbSize = sizeof (type);
            type.style = CS_DBLCLKS;
            type.lpfnWndProc = &Host::windowProc;
            type.hInstance = GetModuleHandleW (nullptr);
            type.hCursor = LoadCursor (nullptr, IDC_ARROW);
            type.lpszClassName = windowClass;
            return RegisterClassExW (&type) != 0;
        }();
        juce::ignoreUnused (registered);
    }

    /**
     * Composition: Explorer's drags reach our window, not WebView2's, so they're handed on (WebView2APISample's
     * `DropTarget`), saying first where the files are (`dragged`), with the system's picture of what's dragged.
     */
    class DropTarget final : public Microsoft::WRL::RuntimeClass<Microsoft::WRL::RuntimeClassFlags<Microsoft::WRL::ClassicCom>, IDropTarget>
    {
    public:
        explicit DropTarget (Host& owner) : host (owner)
        {
            CoCreateInstance (CLSID_DragDropHelper, nullptr, CLSCTX_INPROC_SERVER, IID_PPV_ARGS (&helper));
        }

        HRESULT STDMETHODCALLTYPE DragEnter (IDataObject* data, DWORD keys, POINTL at, DWORD* effect) override
        {
            host.dropping = true;
            if (host.dragged != nullptr)
                if (const auto paths = filesIn (data); ! paths.isEmpty())
                    host.dragged (paths);
            POINT point { at.x, at.y };
            if (helper != nullptr)
                helper->DragEnter (host.hwnd, data, &point, *effect);
            ScreenToClient (host.hwnd, &point);
            return controller()->DragEnter (data, keys, point, effect);
        }

        HRESULT STDMETHODCALLTYPE DragOver (DWORD keys, POINTL at, DWORD* effect) override
        {
            POINT point { at.x, at.y };
            if (helper != nullptr)
                helper->DragOver (&point, *effect);
            ScreenToClient (host.hwnd, &point);
            return controller()->DragOver (keys, point, effect);
        }

        HRESULT STDMETHODCALLTYPE DragLeave() override
        {
            host.dropping = false;
            if (helper != nullptr)
                helper->DragLeave();
            return controller()->DragLeave();
        }

        HRESULT STDMETHODCALLTYPE Drop (IDataObject* data, DWORD keys, POINTL at, DWORD* effect) override
        {
            host.dropping = false;
            POINT point { at.x, at.y };
            if (helper != nullptr)
                helper->Drop (data, &point, *effect);
            ScreenToClient (host.hwnd, &point);
            return controller()->Drop (data, keys, point, effect);
        }

    private:
        ICoreWebView2CompositionController3* controller()
        {
            if (controller3 == nullptr)
                host.compositionController.As (&controller3);
            return controller3.Get();
        }

        Host& host;
        ComPtr<ICoreWebView2CompositionController3> controller3;
        ComPtr<IDropTargetHelper> helper;
    };

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
        {
            attachVisual();
            dropTarget = Microsoft::WRL::Make<DropTarget> (*this);
            if (const auto result = RegisterDragDrop (hwnd, dropTarget.Get()); FAILED (result))
                failed ("RegisterDragDrop", result);
        }

        ComPtr<ICoreWebView2Settings> settings;
        webView->get_Settings (&settings);
        settings->put_IsStatusBarEnabled (FALSE);
        // Ctrl+wheel zooms the Piano roll and the Playlist, not the page.
        settings->put_IsZoomControlEnabled (FALSE);
        // The keys are the page's, FL Studio's: F5 is the Playlist, not a reload (nor Ctrl+R, Ctrl+F, Ctrl+P...).
        if (ComPtr<ICoreWebView2Settings3> settings3; SUCCEEDED (settings.As (&settings3)))
            settings3->put_AreBrowserAcceleratorKeysEnabled (FALSE);
        // (Not WebView2's own drag regions, `IsNonClientRegionSupportEnabled`: the page sends them again on nearly every
        // frame while it animates, and its browser process fell behind, growing by 50 MB a second while a song played.
        // The page says where its bars are itself: `host.dragRegions`.)

        EventRegistrationToken token;
        // { id, command, params } -> { id, ok, result } or { id, ok: false, error }.
        webView->add_WebMessageReceived (Callback<ICoreWebView2WebMessageReceivedEventHandler> ([this] (ICoreWebView2*, ICoreWebView2WebMessageReceivedEventArgs* args) {
            LPWSTR json = nullptr;
            if (onCommand == nullptr || FAILED (args->get_WebMessageAsJson (&json)))
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
        // A window of the app's the page opens (a panel) is one of ours, its document the page's own; anything else (a
        // link, Help's pages) goes to the computer's browser.
        webView->add_NewWindowRequested (Callback<ICoreWebView2NewWindowRequestedEventHandler> ([this] (ICoreWebView2*, ICoreWebView2NewWindowRequestedEventArgs* args) {
            LPWSTR name = nullptr;
            ComPtr<ICoreWebView2NewWindowRequestedEventArgs2> named;
            const auto windowName = SUCCEEDED (args->QueryInterface (IID_PPV_ARGS (&named))) && SUCCEEDED (named->get_Name (&name)) ? take (name) : juce::String();
            if (acceptsWindow != nullptr && windowOpened != nullptr && acceptsWindow (windowName))
            {
                ComPtr<ICoreWebView2Deferral> deferral;
                args->GetDeferral (&deferral);
                auto opened = std::make_unique<Host> (environment.Get(), GetAncestor (hwnd, GA_ROOTOWNER), background, args, deferral);
                windowOpened (windowName, std::make_unique<PanelWindow> (std::move (opened)));
                return S_OK;
            }
            LPWSTR uri = nullptr;
            if (SUCCEEDED (args->get_Uri (&uri)))
                juce::URL (take (uri)).launchInDefaultBrowser();
            args->put_Handled (TRUE);
            return S_OK;
        }).Get(), &token);
        if (openedBy != nullptr)
        {
            // The page's `window.close`, or its document went.
            webView->add_WindowCloseRequested (Callback<ICoreWebView2WindowCloseRequestedEventHandler> ([this] (ICoreWebView2*, IUnknown*) {
                if (closed != nullptr)
                    closed();
                return S_OK;
            }).Get(), &token);
            resize();
            controller->put_IsVisible (TRUE);
            // The page's window now: it draws its document into it.
            openedBy->put_NewWindow (webView.Get());
            std::exchange (openedWhenReady, nullptr)->Complete();
            return;
        }
        // A reload, or another address: what the page opened goes with it.
        webView->add_NavigationStarting (Callback<ICoreWebView2NavigationStartingEventHandler> ([this] (ICoreWebView2*, ICoreWebView2NavigationStartingEventArgs*) {
            if (leaving != nullptr)
                leaving();
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
        if (openedBy != nullptr)
        {
            // (Composed, WebView2 knows where it is on the screen only when told: a panel's drag reads `screenX`.)
            if (message == WM_MOVE)
                parentMoved();
            // Alt+F4 on a panel: the page closes it (or keeps it hidden for the next).
            if (message == WM_CLOSE)
            {
                if (closed != nullptr)
                    closed();
                return 0;
            }
            if (message == WM_ACTIVATE && LOWORD (wParam) != WA_INACTIVE)
                focus();
        }
        if (message == WM_SETFOCUS)
        {
            focus();
            return 0;
        }
        if (message == WM_ERASEBKGND)
        {
            if (background.getAlpha() == 0)
                return 1;
            RECT area;
            GetClientRect (hwnd, &area);
            auto* brush = CreateSolidBrush (RGB (background.getRed(), background.getGreen(), background.getBlue()));
            FillRect ((HDC) wParam, &area, brush);
            DeleteObject (brush);
            return 1;
        }
        if (compositionController == nullptr)
            return {};
        // The window's own parts (its title bars, edges, the maximise button): the shell's window answers there. Not
        // while files are dragged over the page: they're dropped on its bars too (the tab strip opens songs).
        if (message == WM_NCHITTEST && ! dropping && nonClient != nullptr && nonClient ({ GET_X_LPARAM (lParam), GET_Y_LPARAM (lParam) }))
            return HTTRANSPARENT;
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

    juce::String url;
    juce::Colour background;
    const CommandHandler onCommand;
    const bool composition;
    /** A window the page opened: what asked for it, and what holds it back until WebView2 is in it. */
    ComPtr<ICoreWebView2NewWindowRequestedEventArgs> openedBy;
    ComPtr<ICoreWebView2Deferral> openedWhenReady;
    std::shared_ptr<bool> alive = std::make_shared<bool> (true);
    HWND hwnd = nullptr;
    bool oleStarted = false;
    bool pointerInside = false;
    /** Explorer is dragging files over the page (`DropTarget`). */
    bool dropping = false;
    ComPtr<ICoreWebView2Environment> environment;
    ComPtr<ICoreWebView2Controller> controller;
    ComPtr<ICoreWebView2CompositionController> compositionController;
    ComPtr<ICoreWebView2> webView;
    ComPtr<IDCompositionDevice> composer;
    ComPtr<IDCompositionTarget> target;
    ComPtr<IDCompositionVisual> visual;
    ComPtr<DropTarget> dropTarget;
};

WebView::WebView (const juce::String& url, const juce::File& userDataFolder, juce::Colour background, CommandHandler onCommand)
    : host (std::make_unique<Host> (url, userDataFolder, background, std::move (onCommand)))
{
    host->dragged = [this] (const juce::StringArray& paths) {
        if (onDragPaths != nullptr)
            onDragPaths (paths);
    };
    host->acceptsWindow = [this] (const juce::String& name) { return acceptsWindow != nullptr && acceptsWindow (name); };
    host->windowOpened = [this] (const juce::String& name, std::unique_ptr<PanelWindow> window) {
        if (onWindowOpened != nullptr)
            onWindowOpened (name, std::move (window));
    };
    host->leaving = [this] {
        if (onLeaving != nullptr)
            onLeaving();
    };
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

void WebView::post (const juce::var& message)
{
    host->post (message);
}

void WebView::navigate (const juce::String& url)
{
    host->navigate (url);
}

bool WebView::composited() const
{
    return host->composited();
}

void WebView::setNonClient (std::function<bool (juce::Point<int>)> isNonClient)
{
    host->nonClient = [isNonClient = std::move (isNonClient)] (POINT screen) { return isNonClient ({ (int) screen.x, (int) screen.y }); };
}

void WebView::forwardMouse (unsigned int message, juce::Point<int> screen)
{
    host->forwardMouse (message, { screen.x, screen.y });
}

PanelWindow::PanelWindow (std::unique_ptr<WebView::Host> hostToUse) : host (std::move (hostToUse))
{
    host->closed = [this] {
        if (onClosed != nullptr)
            onClosed();
    };
    host->dragged = [this] (const juce::StringArray& paths) {
        if (onDragPaths != nullptr)
            onDragPaths (paths);
    };
}

PanelWindow::~PanelWindow() = default;

void PanelWindow::show (bool focus)
{
    if (focus)
    {
        ShowWindow (host->window(), SW_SHOW);
        SetForegroundWindow (host->window());
        return;
    }
    // Without the keyboard: behind the window in use, if it's one of the app's own (a panel, a plugin's), else in
    // front of the others. (Shown later than the one in front, a song's windows opening came up in front of it.)
    auto* inUse = GetForegroundWindow();
    const auto app = GetAncestor (host->window(), GA_ROOTOWNER);
    const auto behind = inUse != nullptr && inUse != host->window() && inUse != app && GetAncestor (inUse, GA_ROOTOWNER) == app;
    SetWindowPos (host->window(), behind ? inUse : HWND_TOP, 0, 0, 0, 0, SWP_NOMOVE | SWP_NOSIZE | SWP_NOACTIVATE | SWP_SHOWWINDOW);
}

void PanelWindow::raise()
{
    if (! IsWindowVisible (host->window()))
        return;
    SetWindowPos (host->window(), HWND_TOP, 0, 0, 0, 0, SWP_NOMOVE | SWP_NOSIZE);
    SetForegroundWindow (host->window());
}

void PanelWindow::hide()
{
    ShowWindow (host->window(), SW_HIDE);
}

bool PanelWindow::isShown() const
{
    return IsWindowVisible (host->window()) != FALSE;
}

void PanelWindow::place (juce::Rectangle<int> bounds)
{
    const auto physical = juce::Desktop::getInstance().getDisplays().logicalToPhysical (bounds);
    SetWindowPos (host->window(), nullptr, physical.getX(), physical.getY(), juce::jmax (1, physical.getWidth()), juce::jmax (1, physical.getHeight()),
                  SWP_NOZORDER | SWP_NOACTIVATE | SWP_NOOWNERZORDER);
}

void PanelWindow::moveBy (juce::Point<int> delta)
{
    RECT frame;
    if (GetWindowRect (host->window(), &frame))
        SetWindowPos (host->window(), nullptr, frame.left + delta.x, frame.top + delta.y, 0, 0, SWP_NOSIZE | SWP_NOZORDER | SWP_NOACTIVATE | SWP_NOOWNERZORDER);
}

void PanelWindow::setBackground (juce::Colour colour)
{
    host->setBackground (colour);
}

void PanelWindow::setTitle (const juce::String& title)
{
    SetWindowTextW (host->window(), title.toWideCharPointer());
}
#endif

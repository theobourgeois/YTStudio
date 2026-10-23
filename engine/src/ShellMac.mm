#include "ShellMac.h"

#import <AppKit/AppKit.h>
#import <QuartzCore/QuartzCore.h>
#import <WebKit/WebKit.h>
#include <algorithm>
#include <cmath>
#include <map>
#include <objc/runtime.h>
#include <vector>

// (Built without ARC, as JUCE is: what's kept is retained by hand.)

namespace
{
macShell::Listener listener;

NSString* ns (const juce::String& text)
{
    return [NSString stringWithUTF8String:text.toRawUTF8()];
}

/** The bar that starts the window (the page's: 40 points for the tab strip or menu row, 52 for Home's). */
CGFloat barHeight = 40;
bool buttonsHidden = false;

/** The last press, which a drag the page asks for a moment later starts from. */
NSEvent* lastMouseDown = nil;

/** The steps View › Zoom goes through, Safari's and Chrome's. */
const double zoomSteps[] = { 0.5, 0.67, 0.75, 0.8, 0.9, 1.0, 1.1, 1.25, 1.5, 1.75, 2.0 };
NSString* const zoomKey = @"pageZoom";

NSWindow* windowOf (juce::Component& window)
{
    auto* peer = window.getPeer();
    return peer != nullptr ? [(NSView*) peer->getNativeHandle() window] : nil;
}

WKWebView* webViewIn (NSView* view)
{
    if ([view isKindOfClass:[WKWebView class]])
        return (WKWebView*) view;
    for (NSView* child in [view subviews])
        if (auto* found = webViewIn (child))
            return found;
    return nil;
}

WKWebView* webViewOf (juce::Component& window)
{
    auto* nsWindow = windowOf (window);
    return nsWindow != nil ? webViewIn ([nsWindow contentView]) : nil;
}

/**
 * The traffic lights in the middle of the page's bar, 18 points in (where Electron's `trafficLightPosition` puts
 * them: src/index.css keeps the page clear of them). macOS lays them out again as the window changes, so this
 * follows each change.
 */
void placeButtons (NSWindow* window)
{
    NSButton* buttons[] = { [window standardWindowButton:NSWindowCloseButton],
                            [window standardWindowButton:NSWindowMiniaturizeButton],
                            [window standardWindowButton:NSWindowZoomButton] };
    if (buttons[0] == nil)
        return;
    for (NSButton* button : buttons)
        [button setHidden:buttonsHidden];
    if (([window styleMask] & NSWindowStyleMaskFullScreen) != 0)
        return;
    NSView* container = [[buttons[0] superview] superview];
    NSRect frame = [container frame];
    frame.size.height = barHeight;
    frame.origin.y = NSHeight ([window frame]) - barHeight;
    [container setFrame:frame];
    // Circles of 12 points, 8 apart, the first 18 in.
    for (int i = 0; i < 3; ++i)
    {
        NSRect place = [buttons[i] frame];
        place.origin.x = 18 - (NSWidth (place) - 12) / 2 + i * 20;
        place.origin.y = (barHeight - NSHeight (place)) / 2;
        [buttons[i] setFrame:place];
    }
}

void setZoom (WKWebView* webView, double zoom)
{
    if (@available (macOS 11.0, *))
        [webView setPageZoom:zoom];
}

/** WKWebView's own handling of a drag from Finder, before we read its paths. */
IMP webKitDraggingEntered = nullptr;
/** WKWebView's own hitTest, for what isn't a plugin showing through the page (`pageHitTest`). */
IMP webKitHitTest = nullptr;
NSView* pageHitTest (id self, SEL selector, NSPoint point);

NSDragOperation draggingEntered (id self, SEL selector, id<NSDraggingInfo> info)
{
    NSArray* urls = [[info draggingPasteboard] readObjectsForClasses:@[ [NSURL class] ] options:@{ NSPasteboardURLReadingFileURLsOnlyKey: @YES }];
    juce::StringArray paths;
    for (NSURL* url in urls)
        paths.add (juce::String::fromUTF8 ([[url path] UTF8String]));
    // Sent before WebKit hands the page the drag, so the page has the paths by the time it's dropped.
    if (! paths.isEmpty() && listener.dragged)
        listener.dragged (paths);
    return reinterpret_cast<NSDragOperation (*) (id, SEL, id)> (webKitDraggingEntered) (self, selector, info);
}

/**
 * JUCE's web view sends ⌘X, ⌘C, ⌘V and ⌘A straight to its text, so the page never sees them (the Piano roll's copy
 * and paste). WebKit's own way gives the page each key first, and the Edit menu has what the page leaves.
 */
void preparePage (WKWebView* webView)
{
    // Once (each window's web view is made once): dress does it, or the first focus if the view came later.
    static WKWebView* prepared = nil;
    if (webView == prepared)
        return;
    prepared = webView;
    setZoom (webView, macShell::pageZoom());
    if (@available (macOS 13.3, *))
        [webView setInspectable:YES];
    // Inspect Element in its menu (Safari's Web Inspector).
    [[[webView configuration] preferences] setValue:@YES forKey:@"developerExtrasEnabled"];

    Class juceClass = object_getClass (webView);
    if (juceClass == [WKWebView class])
        return;
    Method keys = class_getInstanceMethod ([WKWebView class], @selector (performKeyEquivalent:));
    class_replaceMethod (juceClass, @selector (performKeyEquivalent:), method_getImplementation (keys), method_getTypeEncoding (keys));
    Method entered = class_getInstanceMethod ([WKWebView class], @selector (draggingEntered:));
    webKitDraggingEntered = method_getImplementation (entered);
    class_replaceMethod (juceClass, @selector (draggingEntered:), (IMP) draggingEntered, method_getTypeEncoding (entered));
    // The plugins are under the page, showing through the holes it leaves for them (`placePlugins`): a press there is theirs.
    [webView setValue:@NO forKey:@"drawsBackground"];
    Method hit = class_getInstanceMethod ([WKWebView class], @selector (hitTest:));
    webKitHitTest = method_getImplementation (hit);
    class_replaceMethod (juceClass, @selector (hitTest:), (IMP) pageHitTest, method_getTypeEncoding (hit));
}
} // namespace

/**
 * A plugin's view under the page (`macShell::addPluginView`), showing through the hole the page leaves where its
 * frame's body is: takes clicks only in `visibleRects` (its own, top-left based coordinates), the parts of the
 * plugin the page's other windows don't cover.
 */
@interface YTStudioPluginView : NSView
{
@public
    std::vector<NSRect> visibleRects;
}
@end

@implementation YTStudioPluginView
- (BOOL)isFlipped
{
    return YES;
}

/** Whether this point (in its own coordinates) is on a part of the plugin the page's windows leave showing. */
- (BOOL)shows:(NSPoint)local
{
    if ([self isHidden])
        return NO;
    for (const auto& rect : visibleRects)
        if (NSPointInRect (local, rect))
            return YES;
    return NO;
}

- (NSView*)hitTest:(NSPoint)point
{
    return [self shows:[self convertPoint:point fromView:[self superview]]] ? [super hitTest:point] : nil;
}
@end

namespace
{
/** The page's hitTest: a point where a plugin shows through it is the plugin's (its views are the page's siblings). */
NSView* pageHitTest (id self, SEL selector, NSPoint point)
{
    for (NSView* view in [[[(NSView*) self superview] subviews] reverseObjectEnumerator])
        if ([view isKindOfClass:[YTStudioPluginView class]])
            if (NSView* hit = [view hitTest:point])
                return hit;
    return reinterpret_cast<NSView* (*) (id, SEL, NSPoint)> (webKitHitTest) (self, selector, point);
}
} // namespace

/** What the menu items call: the app's own commands go to the listener. */
@interface YTStudioMusicMenus : NSObject
- (void)run:(NSMenuItem*)item;
@end

@implementation YTStudioMusicMenus
- (void)run:(NSMenuItem*)item
{
    NSString* command = [item representedObject];
    // The page's keys (⌘O, ⌘W...) it has caught already: WebKit gives it each before the menus. The menu only shows
    // them, as the Electron apps' does (`registerAccelerator: false`); a click on the item still runs it.
    const auto pressed = [[NSApp currentEvent] type] == NSEventTypeKeyDown;
    if (pressed && [item keyEquivalent].length > 0 && ([command hasPrefix:@"page:"] || [command hasPrefix:@"hide"]))
        return;
    if (listener.menu)
        listener.menu (juce::String::fromUTF8 ([command UTF8String]));
}
@end

namespace
{
YTStudioMusicMenus* menuTarget = nil;

NSMenuItem* item (NSMenu* menu, NSString* title, SEL action, NSString* key = @"", NSEventModifierFlags modifiers = NSEventModifierFlagCommand)
{
    NSMenuItem* added = [menu addItemWithTitle:title action:action keyEquivalent:key];
    [added setKeyEquivalentModifierMask:modifiers];
    return added;
}

/** An item running one of the app's commands (`Listener::menu`). */
NSMenuItem* command (NSMenu* menu, NSString* title, NSString* name, NSString* key = @"", NSEventModifierFlags modifiers = NSEventModifierFlagCommand)
{
    NSMenuItem* added = item (menu, title, @selector (run:), key, modifiers);
    [added setTarget:menuTarget];
    [added setRepresentedObject:name];
    return added;
}

NSMenu* submenu (NSMenu* bar, NSString* title)
{
    NSMenuItem* holder = [bar addItemWithTitle:title action:nil keyEquivalent:@""];
    NSMenu* menu = [[[NSMenu alloc] initWithTitle:title] autorelease];
    [holder setSubmenu:menu];
    return menu;
}

/** The menu bar, as the Electron apps' (electron/main.ts `buildMenu`) for a music app. */
void installMenus (NSString* appName)
{
    if (menuTarget == nil)
        menuTarget = [[YTStudioMusicMenus alloc] init];
    NSMenu* bar = [[[NSMenu alloc] initWithTitle:@""] autorelease];

    NSMenu* app = submenu (bar, appName);
    item (app, [@"About " stringByAppendingString:appName], @selector (orderFrontStandardAboutPanel:), @"", 0);
    [app addItem:[NSMenuItem separatorItem]];
    NSMenu* services = [[[NSMenu alloc] initWithTitle:@"Services"] autorelease];
    [[app addItemWithTitle:@"Services" action:nil keyEquivalent:@""] setSubmenu:services];
    [NSApp setServicesMenu:services];
    [app addItem:[NSMenuItem separatorItem]];
    // Hide (⌘H) and Hide Others (⌥⌘H) leave their keys to the page, which hands back what it doesn't use (`hideApp`).
    command (app, [@"Hide " stringByAppendingString:appName], @"hide", @"h");
    command (app, @"Hide Others", @"hideOthers", @"h", NSEventModifierFlagCommand | NSEventModifierFlagOption);
    item (app, @"Show All", @selector (unhideAllApplications:), @"", 0);
    [app addItem:[NSMenuItem separatorItem]];
    // (JUCE's app delegate asks the app first: the page saves, then everything quits.)
    item (app, [@"Quit " stringByAppendingString:appName], @selector (terminate:), @"q");

    // The page catches these keys itself, wherever the focus is: the menu shows them, and runs them when clicked.
    NSMenu* file = submenu (bar, @"File");
    command (file, @"New Song", @"page:new:music", @"2");
    [file addItem:[NSMenuItem separatorItem]];
    command (file, @"Open…", @"page:open", @"o");
    NSMenu* recent = [[[NSMenu alloc] initWithTitle:@"Open Recent"] autorelease];
    // AppKit fills a menu of this name with the recent documents (NSDocumentController), as Electron's role does.
    [recent performSelector:NSSelectorFromString (@"_setMenuName:") withObject:@"NSRecentDocumentsMenu"];
    item (recent, @"Clear Menu", @selector (clearRecentDocuments:), @"", 0);
    [[file addItemWithTitle:@"Open Recent" action:nil keyEquivalent:@""] setSubmenu:recent];
    [file addItem:[NSMenuItem separatorItem]];
    command (file, @"Home", @"page:home", @"H", NSEventModifierFlagCommand | NSEventModifierFlagShift);
    command (file, @"Show in Finder", @"page:reveal");
    [file addItem:[NSMenuItem separatorItem]];
    // ⌘W closes the project's tab; the window (and with it the app) ⇧⌘W.
    command (file, @"Close Tab", @"page:closeTab", @"w");
    item (file, @"Close Window", @selector (performClose:), @"W", NSEventModifierFlagCommand | NSEventModifierFlagShift);

    // Text fields need these for ⌘C, ⌘V and ⌘Z. The page's own shortcuts get the keys first; what they leave comes here.
    NSMenu* edit = submenu (bar, @"Edit");
    item (edit, @"Undo", @selector (undo:), @"z");
    item (edit, @"Redo", @selector (redo:), @"Z", NSEventModifierFlagCommand | NSEventModifierFlagShift);
    [edit addItem:[NSMenuItem separatorItem]];
    item (edit, @"Cut", @selector (cut:), @"x");
    item (edit, @"Copy", @selector (copy:), @"c");
    item (edit, @"Paste", @selector (paste:), @"v");
    item (edit, @"Paste and Match Style", @selector (pasteAsPlainText:), @"V", NSEventModifierFlagCommand | NSEventModifierFlagOption | NSEventModifierFlagShift);
    item (edit, @"Delete", @selector (delete:), @"", 0);
    item (edit, @"Select All", @selector (selectAll:), @"a");

    NSMenu* view = submenu (bar, @"View");
    // No ⌘R: that's the export in the music editor.
    command (view, @"Reload", @"reload");
    [view addItem:[NSMenuItem separatorItem]];
    command (view, @"Actual Size", @"zoomReset", @"0");
    command (view, @"Zoom In", @"zoomIn", @"=");
    command (view, @"Zoom Out", @"zoomOut", @"-");
    [view addItem:[NSMenuItem separatorItem]];
    item (view, @"Enter Full Screen", @selector (toggleFullScreen:), @"f", NSEventModifierFlagCommand | NSEventModifierFlagControl);

    NSMenu* window = submenu (bar, @"Window");
    item (window, @"Minimize", @selector (performMiniaturize:), @"m");
    item (window, @"Zoom", @selector (performZoom:), @"", 0);
    [window addItem:[NSMenuItem separatorItem]];
    item (window, @"Bring All to Front", @selector (arrangeInFront:), @"", 0);
    [NSApp setWindowsMenu:window];

    NSMenu* help = submenu (bar, @"Help");
    command (help, @"Show Data Folder", @"showData");
    command (help, @"Show Logs", @"showLogs");
    [NSApp setHelpMenu:help];

    [NSApp setMainMenu:bar];
}
} // namespace

namespace macShell
{
void dress (juce::Component& window, const juce::String& appName, Listener newListener)
{
    listener = std::move (newListener);
    installMenus (ns (appName));
    // A DAW plays while it's hidden or covered: App Nap would slow its timers (the page's sync, the plugins' idle).
    static id activity = [[[NSProcessInfo processInfo] beginActivityWithOptions:NSActivityUserInitiatedAllowingIdleSystemSleep | NSActivityLatencyCritical
                                                                         reason:@"Playing and editing music"] retain];
    juce::ignoreUnused (activity);

    auto* nsWindow = windowOf (window);
    if (nsWindow == nil)
        return;
    [nsWindow setStyleMask:[nsWindow styleMask] | NSWindowStyleMaskFullSizeContentView];
    [nsWindow setTitlebarAppearsTransparent:YES];
    [nsWindow setTitleVisibility:NSWindowTitleHidden];
    if (@available (macOS 11.0, *))
        [nsWindow setTitlebarSeparatorStyle:NSTitlebarSeparatorStyleNone];
    placeButtons (nsWindow);

    auto* centre = [NSNotificationCenter defaultCenter];
    for (NSNotificationName name : { NSWindowDidResizeNotification, NSWindowDidEndLiveResizeNotification, NSWindowDidExitFullScreenNotification })
        [centre addObserverForName:name object:nsWindow queue:nil usingBlock:^(NSNotification* note) { placeButtons ([note object]); }];
    [centre addObserverForName:NSWindowWillEnterFullScreenNotification object:nsWindow queue:nil usingBlock:^(NSNotification*) {
        if (listener.fullScreen)
            listener.fullScreen (true);
    }];
    [centre addObserverForName:NSWindowWillExitFullScreenNotification object:nsWindow queue:nil usingBlock:^(NSNotification*) {
        if (listener.fullScreen)
            listener.fullScreen (false);
    }];

    [NSEvent addLocalMonitorForEventsMatchingMask:NSEventMaskLeftMouseDown | NSEventMaskRightMouseDown handler:^NSEvent*(NSEvent* event) {
        if ([event type] == NSEventTypeLeftMouseDown)
        {
            [lastMouseDown release];
            lastMouseDown = [event retain];
        }
        // A press in a plugin's view: its frame comes to the front. (Each view is asked, front to back, rather than
        // the window's hitTest, which the plugins' and JUCE's own views answer as they like.)
        auto* page = [event window] != nil ? webViewIn ([[event window] contentView]) : nil;
        if (listener.pluginPressed && page != nil)
            for (NSView* view in [[[page superview] subviews] reverseObjectEnumerator])
                if ([view isKindOfClass:[YTStudioPluginView class]]
                    && [(YTStudioPluginView*) view shows:[view convertPoint:[event locationInWindow] fromView:nil]])
                {
                    listener.pluginPressed (view);
                    break;
                }
        return event;
    }];

    if (auto* webView = webViewIn ([nsWindow contentView]))
    {
        preparePage (webView);
        [nsWindow makeFirstResponder:webView];
    }
}

void titleBar (juce::Component& window, int height, bool ownButtons)
{
    barHeight = height;
    buttonsHidden = ownButtons;
    if (auto* nsWindow = windowOf (window))
        placeButtons (nsWindow);
}

void dragWindow (juce::Component& window)
{
    auto* nsWindow = windowOf (window);
    // (Let go already: a click, not a drag.)
    if (nsWindow == nil || lastMouseDown == nil || ([NSEvent pressedMouseButtons] & 1) == 0)
        return;
    [nsWindow performWindowDragWithEvent:lastMouseDown];
}

void titleDoubleClicked (juce::Component& window)
{
    auto* nsWindow = windowOf (window);
    if (nsWindow == nil)
        return;
    NSString* action = [[NSUserDefaults standardUserDefaults] stringForKey:@"AppleActionOnDoubleClick"];
    if ([action isEqualToString:@"Minimize"])
        [nsWindow performMiniaturize:nil];
    else if (! [action isEqualToString:@"None"])
        [nsWindow performZoom:nil];
}

void windowAction (juce::Component& window, const juce::String& action)
{
    auto* nsWindow = windowOf (window);
    if (nsWindow == nil)
        return;
    if (action == "minimize")
        [nsWindow performMiniaturize:nil];
    else if (action == "fullscreen")
        [nsWindow toggleFullScreen:nil];
}

void focusPage (juce::Component& window)
{
    auto* nsWindow = windowOf (window);
    auto* webView = nsWindow != nil ? webViewIn ([nsWindow contentView]) : nil;
    if (webView == nil)
        return;
    preparePage (webView);
    if ([nsWindow firstResponder] != webView)
        [nsWindow makeFirstResponder:webView];
}

double pageZoom()
{
    const auto zoom = [[NSUserDefaults standardUserDefaults] doubleForKey:zoomKey];
    return zoom > 0 ? zoom : 1.0;
}

double zoomPage (juce::Component& window, int step)
{
    auto zoom = 1.0;
    if (step != 0)
    {
        const auto now = pageZoom();
        const auto count = (int) (sizeof (zoomSteps) / sizeof (zoomSteps[0]));
        int at = 0;
        for (int i = 0; i < count; ++i)
            if (std::abs (zoomSteps[i] - now) < std::abs (zoomSteps[at] - now))
                at = i;
        zoom = zoomSteps[juce::jlimit (0, count - 1, at + step)];
    }
    [[NSUserDefaults standardUserDefaults] setDouble:zoom forKey:zoomKey];
    if (auto* webView = webViewOf (window))
        setZoom (webView, zoom);
    return zoom;
}

void reloadPage (juce::Component& window)
{
    if (auto* webView = webViewOf (window))
        [webView reload];
}

void hide (bool others)
{
    if (others)
        [NSApp hideOtherApplications:nil];
    else
        [NSApp hide:nil];
}

void noteRecent (const juce::String& path)
{
    [[NSDocumentController sharedDocumentController] noteNewRecentDocumentURL:[NSURL fileURLWithPath:ns (path)]];
}

void* addPluginView (juce::Component& window)
{
    auto* webView = webViewOf (window);
    NSView* parent = webView != nil ? [webView superview] : [windowOf (window) contentView];
    auto* view = [[YTStudioPluginView alloc] initWithFrame:NSMakeRect (0, 0, 1, 1)];
    [view setWantsLayer:YES];
    [view setHidden:YES];
    [parent addSubview:view positioned:NSWindowBelow relativeTo:webView];
    [view release];
    return view;
}

void removePluginView (void* view)
{
    [(NSView*) view removeFromSuperview];
}

namespace
{
/** Where each view goes among its siblings (`placePlugins`): the plugins back to front, then the page over them. */
NSComparisonResult byRank (__kindof NSView* a, __kindof NSView* b, void* context)
{
    const auto& rank = *static_cast<std::map<NSView*, int>*> (context);
    const auto ra = rank.at (a), rb = rank.at (b);
    return ra < rb ? NSOrderedAscending : ra > rb ? NSOrderedDescending : NSOrderedSame;
}

/** Where a plugin takes clicks: `rects` (the view's own coordinates), what of it the page's windows leave showing. */
void showsIn (YTStudioPluginView* view, const std::vector<NSRect>& rects)
{
    view->visibleRects = rects;
}
} // namespace

void placePlugins (juce::Component& window, const std::vector<PluginPlace>& places)
{
    auto* webView = webViewOf (window);
    if (webView == nil)
        return;
    NSView* parent = [webView superview];
    const auto zoom = pageZoom();
    const auto scaled = [zoom] (const juce::Rectangle<double>& r) {
        return NSMakeRect (r.getX() * zoom, r.getY() * zoom, r.getWidth() * zoom, r.getHeight() * zoom);
    };

    [CATransaction begin];
    [CATransaction setDisableActions:YES];
    std::map<NSView*, int> rank;
    int next = 0;
    for (NSView* view in [parent subviews])
        rank[view] = [view isKindOfClass:[YTStudioPluginView class]] ? next++ - 2000000 : next++;
    for (size_t i = 0; i < places.size(); ++i)
    {
        auto* view = (YTStudioPluginView*) places[i].view;
        if ([view superview] != parent)
            continue;
        // (The page's view is flipped, as the plugins' are: its CSS pixels times its zoom are its points.)
        const auto body = scaled (places[i].body);
        [view setFrame:[webView convertRect:body toView:parent]];
        std::vector<NSRect> rects;
        for (const auto& part : places[i].visible)
        {
            auto rect = scaled (part);
            rect.origin.x -= body.origin.x;
            rect.origin.y -= body.origin.y;
            rects.push_back (NSIntersectionRect (rect, [view bounds]));
        }
        rects.erase (std::remove_if (rects.begin(), rects.end(), [] (const NSRect& r) { return NSIsEmptyRect (r); }), rects.end());
        showsIn (view, rects);
        // (Shown even when it's all covered: the page covers it, and uncovers it without waiting for the engine.)
        [view setHidden:NO];
        rank[view] = (int) i - 1000000;
    }
    // Plugins not listed hide (closed or not placed yet); the others go under the page, in the page's order.
    for (NSView* view in [parent subviews])
        if ([view isKindOfClass:[YTStudioPluginView class]] && rank[view] < -1000000)
            [view setHidden:YES];
    bool ordered = true;
    int last = -2000000;
    for (NSView* view in [parent subviews])
    {
        ordered = ordered && rank[view] >= last;
        last = rank[view];
    }
    if (! ordered)
        [parent sortSubviewsUsingFunction:byRank context:&rank];
    [CATransaction commit];
}
} // namespace macShell

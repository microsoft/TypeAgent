// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { WebContentsView, shell } from "electron";
import path from "node:path";
import registerDebug from "debug";
import { ShellWindow } from "./shellWindow.js";
import { loadLocalWebContents } from "./utils.js";
import { BrowserAgentIpc } from "./browserIpc.js";
import {
    detectNavigationType,
    getTabState,
    createTabState,
    updateTabState,
    markUserRefresh,
    clearPendingTimer,
    setPendingTimer,
    cleanupTabState,
    shouldProcessRefresh,
    isAnalyticsUrl,
} from "./navigationUtils.js";

const debug = registerDebug("typeagent:shell:browserViewManager");

// Check if a hostname belongs to Google (for conditional Firefox masking)
function isGoogleDomain(hostname: string): boolean {
    return (
        hostname.endsWith(".google.com") ||
        hostname === "google.com" ||
        hostname.endsWith(".googleapis.com") ||
        hostname.endsWith(".gstatic.com")
    );
}

// Firefox UA — Google trusts Firefox and won't check for Chrome-specific APIs
const FIREFOX_VERSION = "134.0";
const FIREFOX_USER_AGENT = `Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:${FIREFOX_VERSION}) Gecko/20100101 Firefox/${FIREFOX_VERSION}`;

// CDP script injected before any page JavaScript runs.
// Strategy: present as Chrome (natural Chromium) by default, but switch to
// Firefox identity on Google domains to bypass their auth fingerprint checks.
const CDP_FINGERPRINT_SCRIPT = `
// Always: remove webdriver flag (automation detection)
if (Object.getOwnPropertyDescriptor(navigator, 'webdriver')) {
    Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
}
try { delete navigator.__proto__.webdriver; } catch {}

// Conditional: apply Firefox stubs only on Google domains
(function() {
    var host = window.location.hostname;
    if (!host.endsWith('.google.com') && host !== 'google.com') return;

    // Override navigator.userAgent to Firefox
    Object.defineProperty(navigator, 'userAgent', {
        get: function() { return '${FIREFOX_USER_AGENT}'; },
        configurable: true
    });

    // Remove Chrome-specific objects that Firefox doesn't have
    try { delete window.chrome; } catch {}
    try {
        Object.defineProperty(window, 'chrome', { get: function() { return undefined; }, configurable: true });
    } catch {}

    // Remove navigator.userAgentData — Firefox doesn't have Client Hints
    try { delete navigator.userAgentData; } catch {}
    try {
        Object.defineProperty(navigator, 'userAgentData', { get: function() { return undefined; }, configurable: true });
    } catch {}

    // navigator.vendor — Firefox returns empty string, Chrome returns "Google Inc."
    try {
        Object.defineProperty(navigator, 'vendor', { get: function() { return ''; }, configurable: true });
    } catch {}

    // navigator.productSub — Firefox returns "20100101"
    try {
        Object.defineProperty(navigator, 'productSub', { get: function() { return '20100101'; }, configurable: true });
    } catch {}

    // navigator.oscpu — Firefox-specific property
    try {
        Object.defineProperty(navigator, 'oscpu', { get: function() { return 'Windows NT 10.0; Win64; x64'; }, configurable: true });
    } catch {}

    // navigator.buildID — Firefox-specific
    try {
        Object.defineProperty(navigator, 'buildID', { get: function() { return '20181001000000'; }, configurable: true });
    } catch {}
})();
`;

export interface BrowserViewContext {
    id: string;
    url: string;
    title: string;
    favicon?: string;
    isActive: boolean;
    webContentsView: WebContentsView;
    createdAt: Date;
}

export interface TabCreationOptions {
    url: string;
    background?: boolean; // default to false
    parentTabId?: string;
    waitForPageLoad?: boolean;
}

export class BrowserViewManager {
    private browserViews = new Map<string, BrowserViewContext>();
    private activeBrowserViewId: string | null = null;
    private nextTabId = 1;
    private onTabUpdateCallback?: () => void;
    private onNavigationUpdateCallback?: () => void;
    private onPageLoadCompleteCallback?: (tabId: string) => void;
    private viewBounds: Electron.Rectangle | null = null;
    private sessionHeadersConfigured = false;
    constructor(private readonly shellWindow: ShellWindow) {
        debug("BrowserViewManager initialized");
    }

    /**
     * Set callback for tab updates
     */
    setTabUpdateCallback(callback: () => void): void {
        this.onTabUpdateCallback = callback;
    }

    /**
     * Set callback for navigation updates
     */
    setNavigationUpdateCallback(callback: () => void): void {
        this.onNavigationUpdateCallback = callback;
    }

    /**
     * Set callback for page load completion
     */
    setPageLoadCompleteCallback(callback: (tabId: string) => void): void {
        this.onPageLoadCompleteCallback = callback;
    }

    /**
     * Create a new browser tab
     */
    async createBrowserTab(options: TabCreationOptions): Promise<string> {
        const tabId = `tab-${this.nextTabId++}`;

        debug(`Creating new browser tab: ${tabId} for URL: ${options.url}`);

        const webContentsView = new WebContentsView({
            webPreferences: {
                preload: path.join(__dirname, "../preload-cjs/webview.cjs"),
                sandbox: false,
                zoomFactor: 1.0,
            },
        });

        // Register event handlers (synchronous)
        this.setupWebContentsView(webContentsView, tabId);

        const browserViewContext: BrowserViewContext = {
            id: tabId,
            url: options.url,
            title: "New Tab",
            isActive: false,
            webContentsView,
            createdAt: new Date(),
        };

        this.browserViews.set(tabId, browserViewContext);

        // Add to main window but don't show yet
        this.shellWindow.mainWindow.contentView.addChildView(webContentsView);

        // wire up loaded event handlers for the webContents so we can show errors
        webContentsView.webContents.on(
            "did-fail-load",
            (_, errorCode, errorDesc, validatedURL) => {
                debug(
                    `Tab ${tabId} failed to load URL ${options.url}: [${errorCode}] ${errorDesc}`,
                );

                // only show the error if it's for the page the user was asking
                // it's possible some other resource failed to load (image, script, etc.)
                if (validatedURL === options.url) {
                    webContentsView.webContents.executeJavaScript(
                        `document.body.innerHTML = "There was an error loading '${options.url}'.<br />Error Details: <br />${errorCode} - ${errorDesc}"`,
                    );
                }
            },
        );

        webContentsView.webContents.on("focus", () => {
            this.shellWindow.setOverlayVisibility(false);
        });

        // Make the tab active/visible before loading so it appears immediately
        if (this.browserViews.size === 1 || !options.background) {
            this.setActiveBrowserView(tabId);
        } else {
            // Hide the view initially if it's a background tab
            webContentsView.setBounds({ x: 0, y: 0, width: 0, height: 0 });
        }

        // Run CDP fingerprint masking before loading any URL.
        // Use a timeout so a hung debugger doesn't block tab creation.
        try {
            await Promise.race([
                this.setupCDP(webContentsView.webContents, tabId),
                new Promise<void>((_, reject) =>
                    setTimeout(
                        () => reject(new Error("CDP setup timed out")),
                        3000,
                    ),
                ),
            ]);
        } catch (err) {
            debug(`CDP setup skipped for tab ${tabId}: ${err}`);
            // Chrome is the natural default — no fallback UA needed
        }

        // Load the URL or show new tab page
        if (options.url === "about:blank") {
            // Load the new tab HTML file
            loadLocalWebContents(webContentsView.webContents, "newTab.html");
        } else {
            if (options.waitForPageLoad) {
                await webContentsView.webContents
                    .loadURL(options.url)
                    .catch((err) => {
                        debug(
                            `Error loading URL ${webContentsView.webContents.getURL()} in tab ${tabId}:`,
                            err,
                        );

                        webContentsView.webContents.executeJavaScript(
                            `document.body.innerHTML = "There was an error loading '${webContentsView.webContents.getURL()}'.<br />: ${err}"`,
                        );
                    });
            } else {
                webContentsView.webContents
                    .loadURL(options.url)
                    .catch((err) => {
                        debug(
                            `Error loading URL ${webContentsView.webContents.getURL()} in tab ${tabId}:`,
                            err,
                        );
                        webContentsView.webContents.executeJavaScript(
                            `document.body.innerHTML = "There was an error loading '${webContentsView.webContents.getURL()}'.<br />: ${err}"`,
                        );
                    });
            }
        }

        debug(`Browser tab created: ${tabId}`);
        return tabId;
    }

    /**
     * Attach Chrome DevTools Protocol to a tab's webContents.
     * Strategy: present as Chrome (natural Chromium) for most sites, but
     * switch to Firefox identity on Google domains to bypass auth fingerprint
     * checks. CDP injects a conditional script before page JS runs, and
     * onBeforeSendHeaders modifies HTTP headers only for Google requests.
     */
    private async setupCDP(
        webContents: Electron.WebContents,
        tabId: string,
    ): Promise<void> {
        try {
            webContents.debugger.attach("1.3");
        } catch (err) {
            debug(`CDP attach failed for tab ${tabId}: ${err}`);
            return;
        }

        webContents.debugger.on("detach", (_event, reason) => {
            debug(`CDP detached for tab ${tabId}: ${reason}`);
        });

        try {
            // Inject conditional fingerprint script — applies Firefox stubs
            // only on Google domains, leaves other sites as natural Chrome.
            await webContents.debugger.sendCommand(
                "Page.addScriptToEvaluateOnNewDocument",
                { source: CDP_FINGERPRINT_SCRIPT },
            );

            // Set up per-request header modification (session-wide, register once).
            // For Google domains: set Firefox UA and strip Sec-CH-UA headers.
            // For other domains: leave headers as-is (natural Chrome).
            if (!this.sessionHeadersConfigured) {
                this.sessionHeadersConfigured = true;
                webContents.session.webRequest.onBeforeSendHeaders(
                    (details, callback) => {
                        try {
                            const url = new URL(details.url);
                            if (isGoogleDomain(url.hostname)) {
                                const headers = {
                                    ...details.requestHeaders,
                                };
                                headers["User-Agent"] = FIREFOX_USER_AGENT;
                                for (const key of Object.keys(headers)) {
                                    if (
                                        key.toLowerCase().startsWith("sec-ch-")
                                    ) {
                                        delete headers[key];
                                    }
                                }
                                callback({ requestHeaders: headers });
                            } else {
                                callback({});
                            }
                        } catch {
                            callback({});
                        }
                    },
                );
            }

            debug(
                `CDP setup complete for tab ${tabId} (Chrome default, Firefox for Google)`,
            );
        } catch (err) {
            debug(`CDP command failed for tab ${tabId}: ${err}`);
            try {
                webContents.debugger.detach();
            } catch {}
        }
    }

    /**
     * Set up event listeners and context for a WebContentsView.
     * This is synchronous — CDP setup runs separately before loadURL.
     */
    private setupWebContentsView(
        webContentsView: WebContentsView,
        tabId: string,
    ): void {
        const webContents = webContentsView.webContents;

        // If Google blocks sign-in, detect it and open in system browser.
        // Google shows "This browser or app may not be secure" — we detect
        // this via page title since the URL pattern varies.
        let lastNavigatedUrl = "";
        webContents.on("did-navigate", (_, url) => {
            lastNavigatedUrl = url;
        });

        // Handle title updates
        webContents.on("page-title-updated", (_, title) => {
            this.updateTabTitle(tabId, title);
            this.notifyTabUpdate();

            // Detect Google auth block by page title
            if (
                lastNavigatedUrl.includes("accounts.google.com") &&
                title.toLowerCase().includes("not secure")
            ) {
                debug(
                    "Google blocked sign-in in embedded browser, opening in system browser: %s",
                    lastNavigatedUrl,
                );
                shell.openExternal(lastNavigatedUrl);
            }
        });

        // Handle favicon updates
        webContents.on("page-favicon-updated", (_, favicons) => {
            if (favicons.length > 0) {
                this.updateTabFavicon(tabId, favicons[0]);
                this.notifyTabUpdate();
            }
        });

        // Handle navigation events with unified handler
        webContents.on("did-finish-load", async () => {
            const url = webContents.getURL();
            await this.handleNavigation(webContents, url, tabId, false);
            this.notifyPageLoadComplete(tabId);

            // Check for Google auth block after page loads
            if (url.includes("accounts.google.com")) {
                try {
                    const blocked = await webContents.executeJavaScript(
                        `document.body?.innerText?.includes("browser or app may not be secure") ?? false`,
                    );
                    if (blocked) {
                        debug(
                            "Google auth block detected via page content, opening in system browser",
                        );
                        shell.openExternal(url);
                    }
                } catch {
                    // ignore — page may have navigated away
                }
            }
        });

        webContents.on("did-start-loading", () => {
            this.notifyNavigationUpdate();
        });

        webContents.on("did-navigate", (_, url) => {
            this.updateTabUrl(tabId, url);
            this.notifyTabUpdate();
            this.notifyNavigationUpdate();
        });

        webContents.on("did-navigate-in-page", async (_, url) => {
            await this.handleNavigation(webContents, url, tabId, false);
        });

        // Detect user-initiated refreshes
        webContents.on("before-input-event", (_, input) => {
            if (
                input.key === "F5" ||
                (input.key === "r" && (input.control || input.meta))
            ) {
                markUserRefresh(tabId);
            }
        });

        // Override reload to detect user refreshes
        const originalReload = webContents.reload.bind(webContents);
        webContents.reload = function () {
            markUserRefresh(tabId);
            return originalReload();
        };

        // Handle new window requests (convert to new tabs)
        webContents.setWindowOpenHandler((details) => {
            debug(`New window request from tab ${tabId}: ${details.url}`);

            // Create new tab for the URL.  Go thru the shellWindow.
            this.shellWindow.createBrowserTab(new URL(details.url), {
                background: false, // New windows should be foreground
            });

            return { action: "deny" }; // Deny the window creation since we handled it
        });

        // Set tab context for automation routing
        (webContents as any)._tabId = tabId;

        debug(`WebContentsView setup complete for tab: ${tabId}`);
    }

    /**
     * Switch to a specific browser tab
     */
    setActiveBrowserView(tabId: string): boolean {
        const browserView = this.browserViews.get(tabId);
        if (!browserView) {
            debug(`Cannot activate tab ${tabId}: not found`);
            return false;
        }

        // Hide current active tab
        if (this.activeBrowserViewId) {
            const currentActive = this.browserViews.get(
                this.activeBrowserViewId,
            );
            if (currentActive) {
                currentActive.isActive = false;
                currentActive.webContentsView.setBounds({
                    x: 0,
                    y: 0,
                    width: 0,
                    height: 0,
                });
            }
        }

        // Show new active tab
        browserView.isActive = true;
        this.activeBrowserViewId = tabId;

        // Update bounds to show the tab (will be properly positioned by layout manager)
        this.updateActiveBrowserViewBounds();

        debug(`Activated browser tab: ${tabId}`);
        return true;
    }

    /**
     * Close a browser tab
     */
    closeBrowserTab(tabId: string): boolean {
        const browserView: BrowserViewContext | undefined =
            this.browserViews.get(tabId);
        if (!browserView) {
            debug(`Cannot close tab ${tabId}: not found`);
            return false;
        }

        debug(`Closing browser tab: ${tabId}`);

        // Clean up navigation state
        cleanupTabState(tabId);

        // Remove from main window
        this.shellWindow.mainWindow.contentView.removeChildView(
            browserView.webContentsView,
        );

        // Close the web contents
        browserView.webContentsView.webContents.close();

        // Remove from our tracking
        this.browserViews.delete(tabId);

        // If this was the active tab, switch to another one
        if (this.activeBrowserViewId === tabId) {
            this.activeBrowserViewId = null;

            // Switch to the most recently created tab
            const remainingTabs = Array.from(this.browserViews.values()).sort(
                (a, b) => b.createdAt.getTime() - a.createdAt.getTime(),
            );

            if (remainingTabs.length > 0) {
                this.setActiveBrowserView(remainingTabs[0].id);
            }
        }

        debug(`Browser tab closed: ${tabId}`);
        return true;
    }

    /**
     * Get the active browser view
     */
    getActiveBrowserView(): BrowserViewContext | null {
        if (!this.activeBrowserViewId) {
            return null;
        }
        return this.browserViews.get(this.activeBrowserViewId) || null;
    }

    /**
     * Get all browser tabs
     */
    getAllBrowserTabs(): BrowserViewContext[] {
        return Array.from(this.browserViews.values());
    }

    /**
     * Get browser tab by ID
     */
    getBrowserTab(tabId: string): BrowserViewContext | null {
        return this.browserViews.get(tabId) || null;
    }

    /**
     * Update tab title
     */
    private updateTabTitle(tabId: string, title: string): void {
        const browserView = this.browserViews.get(tabId);
        if (browserView) {
            browserView.title = title;
            debug(`Updated title for tab ${tabId}: ${title}`);
        }
    }

    /**
     * Update tab favicon
     */
    private updateTabFavicon(tabId: string, favicon: string): void {
        const browserView = this.browserViews.get(tabId);
        if (browserView) {
            browserView.favicon = favicon;
            debug(`Updated favicon for tab ${tabId}: ${favicon}`);
        }
    }

    /**
     * Update tab URL
     */
    private updateTabUrl(tabId: string, url: string): void {
        const browserView = this.browserViews.get(tabId);
        if (browserView) {
            browserView.url = url;
            debug(`Updated URL for tab ${tabId}: ${url}`);
        }
    }

    /**
     * Set the bounds for the browser view area
     * @param bounds Bounds rectangle
     */
    public setBounds(bounds: Electron.Rectangle): void {
        this.viewBounds = bounds;
        this.updateActiveBrowserViewBounds();
    }

    /**
     * Update bounds for the active browser view
     */
    private updateActiveBrowserViewBounds(): void {
        const activeView = this.getActiveBrowserView();
        if (!activeView || !this.viewBounds) {
            return;
        }

        const headerHeight = 40; // Height of the tab/navigation header
        const browserViewBounds = { ...this.viewBounds };
        browserViewBounds.y = headerHeight;

        activeView.webContentsView.setBounds(browserViewBounds);
        debug(`Updated active browser view bounds:`, browserViewBounds);
    }

    /**
     * Check if there are any browser tabs open
     */
    hasBrowserTabs(): boolean {
        return this.browserViews.size > 0;
    }

    /**
     * Get tab context for automation routing
     */
    getTabContext(webContents: Electron.WebContents): string | null {
        return (webContents as any)._tabId || null;
    }

    /**
     * Navigate active tab back
     */
    goBack(): boolean {
        const activeView = this.getActiveBrowserView();
        if (!activeView) {
            return false;
        }

        const navigationHistory =
            activeView.webContentsView.webContents.navigationHistory;
        if (navigationHistory.canGoBack()) {
            navigationHistory.goBack();
            return true;
        }
        return false;
    }

    /**
     * Navigate active tab forward
     */
    goForward(): boolean {
        const activeView = this.getActiveBrowserView();
        if (!activeView) {
            return false;
        }

        const navigationHistory =
            activeView.webContentsView.webContents.navigationHistory;
        if (navigationHistory.canGoForward()) {
            navigationHistory.goForward();
            return true;
        }
        return false;
    }

    /**
     * Reload active tab
     */
    reload(): boolean {
        const activeView = this.getActiveBrowserView();
        if (!activeView) {
            return false;
        }

        activeView.webContentsView.webContents.reload();
        return true;
    }

    /**
     * Get navigation state for active tab
     */
    getNavigationState(): { canGoBack: boolean; canGoForward: boolean } {
        const activeView = this.getActiveBrowserView();
        if (!activeView) {
            return { canGoBack: false, canGoForward: false };
        }

        const navigationHistory =
            activeView.webContentsView.webContents.navigationHistory;
        return {
            canGoBack: navigationHistory.canGoBack(),
            canGoForward: navigationHistory.canGoForward(),
        };
    }

    /**
     * Clean up all browser tabs
     */
    cleanup(): void {
        debug("Closing all browser tabs");

        for (const [tabId] of this.browserViews) {
            this.closeBrowserTab(tabId);
        }

        this.activeBrowserViewId = null;
    }

    /**
     * Notify parent about tab updates
     */
    private notifyTabUpdate(): void {
        if (this.onTabUpdateCallback) {
            this.onTabUpdateCallback();
        }
    }

    /**
     * Notify parent about navigation updates
     */
    private notifyNavigationUpdate(): void {
        if (this.onNavigationUpdateCallback) {
            this.onNavigationUpdateCallback();
        }
    }

    /**
     * Notify parent about page load completion
     */
    private notifyPageLoadComplete(tabId: string): void {
        if (this.onPageLoadCompleteCallback) {
            this.onPageLoadCompleteCallback(tabId);
        }
    }

    /**
     * Handle navigation events with deduplication and refresh detection
     */
    private async handleNavigation(
        webContents: Electron.WebContents,
        url: string,
        tabId: string,
        isUserInitiated: boolean = false,
    ): Promise<void> {
        if (!url.startsWith("http://") && !url.startsWith("https://")) {
            return;
        }

        const title = webContents.getTitle();
        const navigationType = detectNavigationType(
            tabId,
            url,
            title,
            isUserInitiated,
        );

        let tabState = getTabState(tabId);
        if (!tabState) {
            tabState = createTabState(tabId);
        }

        clearPendingTimer(tabId);

        switch (navigationType) {
            case "duplicate":
                debug(`Skipping duplicate navigation for tab ${tabId}: ${url}`);
                return;

            case "tracking":
                debug(
                    `Skipping tracking parameter navigation for tab ${tabId}: ${url}`,
                );
                return;

            case "refresh":
                const decision = shouldProcessRefresh(tabState);
                if (!decision.process) {
                    debug(
                        `Skipping refresh for tab ${tabId}: ${decision.reason}`,
                    );
                    return;
                }
                debug(
                    `Processing refresh for tab ${tabId}: ${decision.reason}`,
                );
                break;

            case "new":
                debug(`New navigation for tab ${tabId}: ${url}`);
                break;
        }

        if (isAnalyticsUrl(url)) {
            debug(`Skipping analytics URL for tab ${tabId}: ${url}`);
            return;
        }

        const timer = setTimeout(async () => {
            const contentReady = await this.waitForContentReady(webContents);

            if (contentReady) {
                await this.sendNavigationToBrowserAgent(url, title, tabId);

                updateTabState(tabId, url, title, true, isUserInitiated);

                this.updateTabUrl(tabId, url);
                this.notifyNavigationUpdate();
                this.notifyTabUpdate();
            }
        }, 300);

        setPendingTimer(tabId, timer);
    }

    /**
     * Wait for content to be ready using content script detection
     */
    private async waitForContentReady(
        webContents: Electron.WebContents,
    ): Promise<boolean> {
        try {
            if (webContents.isLoading()) {
                return false;
            }

            const result = await webContents.executeJavaScript(`
                (async () => {
                    if (typeof awaitPageIncrementalLoad === 'function') {
                        return await awaitPageIncrementalLoad();
                    }

                    // Fallback: basic document ready check
                    if (document.readyState === 'complete') {
                        return true;
                    }

                    return true; // Default fallback
                })()
            `);

            return result === true;
        } catch (error) {
            debug("Content ready detection failed:", error);
            return true; // Always fallback to proceeding
        }
    }

    /**
     * Send navigation event to browser agent via WebSocket
     */
    private async sendNavigationToBrowserAgent(
        url: string,
        title: string,
        tabId: string,
    ): Promise<void> {
        try {
            // Get WebSocket connection to browser agent
            const browserIpc = BrowserAgentIpc.getinstance();
            if (!browserIpc.isConnected()) {
                await browserIpc.ensureWebsocketConnected();
            }

            const message = {
                method: "handlePageNavigation",
                params: {
                    url,
                    title,
                    tabId,
                    timestamp: Date.now(),
                },
            };

            await browserIpc.send(message);
            debug(`Sent navigation message for ${url}`);
        } catch (error) {
            debug(`Failed to send navigation to browser agent:`, error);
        }
    }
}

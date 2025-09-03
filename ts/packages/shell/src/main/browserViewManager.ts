// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { WebContentsView, BrowserWindow } from "electron";
import path from "node:path";
import registerDebug from "debug";

const debug = registerDebug("typeagent:shell:browserViewManager");

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
    background?: boolean;
    parentTabId?: string;
    waitForPageLoad?: boolean;
}

export class BrowserViewManager {
    private browserViews = new Map<string, BrowserViewContext>();
    private activeBrowserViewId: string | null = null;
    private nextTabId = 1;
    private mainWindow: BrowserWindow;
    private onTabUpdateCallback?: () => void;
    private onNavigationUpdateCallback?: () => void;
    private onPageLoadCompleteCallback?: (tabId: string) => void;
    private onTabClosedCallback?: (tabId: string) => void;
    private viewBounds: Electron.Rectangle | null = null;
    constructor(mainWindow: BrowserWindow) {
        this.mainWindow = mainWindow;
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
     * Set callback for tab closed
     * @param callback - The tab closed callback
     */
    setTabClosedCallback(callback: (tabId: string) => void): void {
        this.onTabClosedCallback = callback;
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

        // Set up WebContentsView with browser view context
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
        this.mainWindow.contentView.addChildView(webContentsView);

        // Load the URL or show new tab page
        if (options.url === "about:blank") {
            // Load the new tab HTML file
            webContentsView.webContents.loadFile(
                path.join(__dirname, "../renderer/newTab.html"),
            );
        } else {
            if (options.waitForPageLoad) {
                await webContentsView.webContents.loadURL(options.url);
            } else {
                webContentsView.webContents.loadURL(options.url);
            }
        }

        // If this is the first tab or not background, make it active
        if (this.browserViews.size === 1 || !options.background) {
            this.setActiveBrowserView(tabId);
        } else {
            // Hide the view initially if it's a background tab
            webContentsView.setBounds({ x: 0, y: 0, width: 0, height: 0 });
        }

        debug(`Browser tab created: ${tabId}`);
        return tabId;
    }

    /**
     * Set up event listeners and context for a WebContentsView
     */
    private setupWebContentsView(
        webContentsView: WebContentsView,
        tabId: string,
    ): void {
        const webContents = webContentsView.webContents;

        // Set user agent
        webContents.setUserAgent(
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36 Edg/124.0.0.0",
        );

        // Handle title updates
        webContents.on("page-title-updated", (_, title) => {
            this.updateTabTitle(tabId, title);
            this.notifyTabUpdate();
        });

        // Handle favicon updates
        webContents.on("page-favicon-updated", (_, favicons) => {
            if (favicons.length > 0) {
                this.updateTabFavicon(tabId, favicons[0]);
                this.notifyTabUpdate();
            }
        });

        // Handle navigation events
        webContents.on("did-finish-load", () => {
            this.updateTabUrl(tabId, webContents.getURL());
            this.notifyNavigationUpdate();
            this.notifyTabUpdate();
            this.notifyPageLoadComplete(tabId);
        });

        webContents.on("did-start-loading", () => {
            this.notifyNavigationUpdate();
        });

        webContents.on("did-navigate", (_, url) => {
            this.updateTabUrl(tabId, url);
            this.notifyTabUpdate();
            this.notifyNavigationUpdate();
        });

        webContents.on("did-navigate-in-page", (_, url) => {
            this.updateTabUrl(tabId, url);
            this.notifyTabUpdate();
            this.notifyNavigationUpdate();
        });

        // Handle new window requests (convert to new tabs)
        webContents.setWindowOpenHandler((details) => {
            debug(`New window request from tab ${tabId}: ${details.url}`);

            // Create new tab for the URL
            this.createBrowserTab({
                url: details.url,
                background: false, // New windows should be foreground
                parentTabId: tabId,
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

        // Remove from main window
        this.mainWindow.contentView.removeChildView(
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

        // remove the tab from the browser header
        this.onTabClosedCallback?.(tabId);

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
        browserViewBounds.height -= headerHeight;

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
    closeAllTabs(): void {
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
}

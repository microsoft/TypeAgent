// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import {
    BrowserWindow,
    DevicePermissionHandlerHandlerDetails,
    globalShortcut,
    ipcMain,
    WebContents,
    WebContentsView,
} from "electron";
import path from "node:path";
import { WebSocketMessageV2 } from "common-utils";
import { runDemo } from "./demo.js";
import {
    ShellUserSettings,
    ShellWindowState,
    ShellSettingManager,
    BrowserTabState,
} from "./shellSettings.js";
import { loadLocalWebContents } from "./utils.js";
import { BrowserAgentIpc } from "./browserIpc.js";
import {
    BrowserViewManager,
    BrowserViewContext,
} from "./browserViewManager.js";

import registerDebug from "debug";
const debugShellWindow = registerDebug("typeagent:shell:window");
const debugShellWindowError = registerDebug("typeagent:shell:window:error");

const isMac = process.platform === "darwin";
const isLinux = process.platform === "linux";
function setupResizeHandler(mainWindow: BrowserWindow, handler: () => void) {
    let scheduleHandler: (() => void) | undefined;
    let timeout: NodeJS.Timeout | undefined;
    mainWindow.on("resize", handler);
    if (isLinux) {
        // Workaround for electron bug where getContentSize isn't updated when "resize" event is fired
        // https://github.com/electron/electron/issues/42586
        scheduleHandler = () => {
            debugShellWindow("Scheduled Maximize/Unmaximize update");
            timeout = setTimeout(() => {
                timeout = undefined;
                debugShellWindow(
                    "Running scheduled Maximize/Unmaximize update",
                );
                handler();
            }, 100);
        };
        mainWindow.on("maximize", scheduleHandler);
        mainWindow.on("unmaximize", scheduleHandler);
    }

    // Clean up function for close
    return () => {
        clearTimeout(timeout);
        mainWindow.removeListener("resize", handler);
        if (scheduleHandler !== undefined) {
            mainWindow.removeListener("maximize", scheduleHandler);
            mainWindow.removeListener("unmaximize", scheduleHandler);
        }
    };
}

type BottomAlignedPosition = { left: number; bottom: number };
type OverlayData = BottomAlignedPosition & {
    width: number;
    height: number;
};

export class ShellWindow {
    public static getInstance(): ShellWindow | undefined {
        return this.instance;
    }
    private static instance: ShellWindow | undefined;

    public readonly mainWindow: BrowserWindow;
    public readonly chatView: WebContentsView;
    private readonly overlayWebContentsViews: Map<
        WebContentsView,
        OverlayData
    > = new Map();

    private verticalLayout: boolean;
    private contentVisible: boolean = false;
    // For use in horizontal layout
    private chatWidth: number;
    private contentWidth: number; // include dividerSize
    private windowHeight: number;

    // For use in vertical layout
    private chatHeight: number;
    private contentHeight: number; // include dividerSize
    private windowWidth: number;

    private readonly contentLoadP: Promise<void>[];
    private readonly handlers = new Map<string, (event: any) => void>();
    private closing: boolean = false;

    // Multi-tab browser support
    private readonly browserViewManager: BrowserViewManager;

    public get inlineBrowser(): WebContentsView {
        // Always use multi-tab browser
        const activeBrowserView =
            this.browserViewManager.getActiveBrowserView();
        if (!activeBrowserView) {
            throw new Error("No browser tab is open");
        }
        return activeBrowserView.webContentsView;
    }

    private updateOverlayWebContentsViewBounds() {
        for (const [view, data] of this.overlayWebContentsViews.entries()) {
            this.setOverlayWebContentsViewBounds(view, data);
        }
    }

    private setOverlayWebContentsViewBounds(
        view: WebContentsView,
        data: OverlayData,
    ) {
        const chatBounds = this.chatView.getBounds();
        const zoomFactor = this.chatView.webContents.zoomFactor;
        const left = chatBounds.x + data.left * zoomFactor;
        const bottom =
            chatBounds.y + chatBounds.height - data.bottom * zoomFactor;
        const width = data.width * zoomFactor;
        const height = data.height * zoomFactor;
        const newBounds = {
            x: left,
            y: bottom - height,
            width,
            height,
        };
        view.setBounds(newBounds);
        view.webContents.setZoomFactor(zoomFactor);
    }

    public updateOverlayWebContentsView(
        view: WebContentsView,
        update?: Partial<OverlayData>,
    ) {
        if (update) {
            let data = this.overlayWebContentsViews.get(view);
            if (data === undefined) {
                this.mainWindow.contentView.addChildView(view);
                const bounds = view.getBounds();
                data = {
                    left: 0,
                    bottom: 0,
                    width: bounds.width,
                    height: bounds.height,
                };

                this.overlayWebContentsViews.set(view, data);
            }

            if (update.left) {
                data.left = update.left;
            }
            if (update.bottom) {
                data.bottom = update.bottom;
            }

            if (update.width) {
                data.width = update.width;
            }
            if (update.height) {
                data.height = update.height;
            }

            this.setOverlayWebContentsViewBounds(view, data);
        } else {
            this.overlayWebContentsViews.delete(view);
            this.mainWindow.contentView.removeChildView(view);
        }
    }

    constructor(private readonly settings: ShellSettingManager) {
        if (ShellWindow.instance !== undefined) {
            throw new Error("ShellWindow already created");
        }

        const state = this.settings.window;
        this.chatWidth = state.chatWidth;
        this.chatHeight = state.chatHeight;
        this.contentWidth = state.contentWidth;
        this.contentHeight = state.contentHeight;
        this.windowWidth = state.windowWidth;
        this.windowHeight = state.windowHeight;

        const uiSettings = this.settings.user.ui;
        // Calculate the initial window bound.
        this.verticalLayout = uiSettings.verticalLayout;
        const mainWindow = createMainWindow(
            this.getWindowBounds({ x: state.x, y: state.y }, false),
        );

        setupDevicePermissions(mainWindow);

        // Initialize browser view manager
        this.browserViewManager = new BrowserViewManager(this);

        // Set up event callbacks for browser view manager
        this.browserViewManager.setTabUpdateCallback(() => {
            this.sendTabsUpdate();
        });

        this.browserViewManager.setNavigationUpdateCallback(() => {
            this.sendNavigationUpdate();
        });

        this.browserViewManager.setPageLoadCompleteCallback((tabId: string) => {
            // Only restore focus if this is the active tab
            const activeTab = this.browserViewManager.getActiveBrowserView();
            if (activeTab && activeTab.id === tabId) {
                this.chatView.webContents.focus();
                this.chatView.webContents.send("focus-chat-input");
            }
        });

        this.browserViewManager.setTabClosedCallback((tabId: string) => {
            this.mainWindow.webContents.send("browser-tab-closed", tabId);

            // Update layout if no tabs left
            if (!this.hasBrowserTabs()) {
                this.setWindowSize(this.getWindowPositionState());
            }
        });

        const resizeHandlerCleanup = setupResizeHandler(mainWindow, () =>
            this.updateContentSize(),
        );
        mainWindow.on("close", () => {
            this.cleanup();
            this.settings.save(this.getWindowState());

            mainWindow.hide();
            // Remove the handler to avoid update the content size on close
            resizeHandlerCleanup();
            // Close all browser tabs on window close
            this.browserViewManager.closeAllTabs();
        });

        mainWindow.on("closed", () => {
            ShellWindow.instance = undefined;
        });

        const chatView = createChatView(state);
        this.setupZoomHandlers(chatView.webContents, (zoomFactor) => {
            this.updateOverlayWebContentsViewBounds();
            this.updateZoomInTitle(zoomFactor);
        });

        mainWindow.contentView.addChildView(chatView);

        this.mainWindow = mainWindow;
        this.chatView = chatView;

        this.installHandler("dom ready", () => {
            this.ready();
        });

        // Browser tab management IPC handlers
        ipcMain.on("browser-new-tab", () => {
            this.createBrowserTab(new URL("about:blank"), {
                background: false,
            });
            this.sendTabsUpdate();

            // Restore focus to chat after creating new tab
            this.chatView.webContents.focus();
            this.chatView.webContents.send("focus-chat-input");
        });

        ipcMain.on("browser-close-tab", (_, tabId: string) => {
            const success = this.closeBrowserTab(tabId);
            if (success) {
                this.sendTabsUpdate();

                // Update layout if no tabs left
                if (!this.hasBrowserTabs()) {
                    this.setWindowSize(this.getWindowPositionState());
                }

                // Restore focus to chat after closing tab
                this.chatView.webContents.focus();
                this.chatView.webContents.send("focus-chat-input");
            }
        });

        ipcMain.on("browser-switch-tab", (_, tabId: string) => {
            const success = this.switchBrowserTab(tabId);
            if (success) {
                this.sendTabsUpdate();
            }
        });

        ipcMain.on("browser-go-back", () => {
            if (this.browserGoBack()) {
                this.sendNavigationUpdate();
            }
        });

        ipcMain.on("browser-go-forward", () => {
            if (this.browserGoForward()) {
                this.sendNavigationUpdate();
            }
        });

        ipcMain.on("browser-reload", () => {
            this.browserReload();
        });

        const contentLoadP: Promise<void>[] = [];
        contentLoadP.push(
            loadLocalWebContents(chatView.webContents, "chatView.html"),
        );

        contentLoadP.push(
            loadLocalWebContents(mainWindow.webContents, "viewHost.html"),
        );
        this.contentLoadP = contentLoadP;
        ShellWindow.instance = this;
    }

    public async waitForContentLoaded() {
        try {
            await Promise.all(this.contentLoadP);
        } catch (e) {
            if (this.closing) {
                // Ignore errors if the window is closing
                return;
            }
            throw e;
        }
    }

    public showAndFocus() {
        if (this.closing) {
            return;
        }
        this.mainWindow.show();
        this.mainWindow.focus();
    }

    private async ready() {
        // Send settings asap
        this.sendUserSettingChanged();

        // Make sure content is loaded so we can adjust the size including the divider.
        await this.waitForContentLoaded();
        this.updateContentSize();

        const mainWindow = this.mainWindow;
        mainWindow.show();

        // Main window shouldn't zoom, otherwise the divider position won't be correct.  Setting it here just to make sure.
        this.setZoomFactor(1, mainWindow.webContents);

        const states = this.settings.window;
        if (states.devTools) {
            this.chatView.webContents.openDevTools();
        }

        // Restore browser tabs if they were previously open
        if (states.browserTabsJson) {
            try {
                const browserTabsState: BrowserTabState[] = JSON.parse(
                    states.browserTabsJson,
                );
                debugShellWindow(
                    `Restoring ${browserTabsState.length} browser tabs`,
                );

                // Restore each tab
                for (const tabState of browserTabsState) {
                    try {
                        const tabId = await this.createBrowserTab(
                            new URL(tabState.url),
                            {
                                background: !tabState.isActive,
                            },
                        );
                        debugShellWindow(
                            `Restored tab: ${tabId} - ${tabState.title} (${tabState.url})`,
                        );
                    } catch (e) {
                        debugShellWindowError(
                            `Failed to restore tab ${tabState.title} (${tabState.url}): ${e}`,
                        );
                    }
                }
            } catch (e) {
                debugShellWindowError(
                    `Failed to parse browser tabs JSON: ${e}`,
                );
            }
        }

        globalShortcut.register("Alt+Right", () => {
            this.chatView.webContents.send("send-demo-event", "Alt+Right");
        });

        // Register Ctrl+L / Cmd+L and Ctrl+E / Cmd+E to focus chat input
        globalShortcut.register("CommandOrControl+L", () => {
            this.chatView.webContents.focus();
            this.chatView.webContents.send("focus-chat-input");
        });

        globalShortcut.register("CommandOrControl+E", () => {
            this.chatView.webContents.focus();
            this.chatView.webContents.send("focus-chat-input");
        });
    }

    private installHandler(name: string, handler: (event: any) => void) {
        this.handlers.set(name, handler);
        ipcMain.on(name, handler);
    }

    private cleanup() {
        this.closing = true;
        for (const [key, handler] of this.handlers) {
            ipcMain.removeListener(key, handler);
        }
        this.handlers.clear();

        // Clean up browser IPC handlers
        ipcMain.removeAllListeners("browser-new-tab");
        ipcMain.removeAllListeners("browser-close-tab");
        ipcMain.removeAllListeners("browser-switch-tab");
        ipcMain.removeAllListeners("browser-go-back");
        ipcMain.removeAllListeners("browser-go-forward");
        ipcMain.removeAllListeners("browser-reload");

        globalShortcut.unregister("Alt+Right");
        globalShortcut.unregister("CommandOrControl+L");
        globalShortcut.unregister("CommandOrControl+E");
    }

    public sendMessageToInlineWebContent(message: WebSocketMessageV2) {
        const activeBrowserView =
            this.browserViewManager.getActiveBrowserView();
        activeBrowserView?.webContentsView.webContents.send(
            "received-from-browser-ipc",
            message,
        );
    }

    public runDemo(interactive: boolean = false) {
        runDemo(this.mainWindow, this.chatView, interactive);
    }

    // ================================================================
    // Settings
    // ================================================================
    public getUserSettings() {
        return this.settings.user;
    }

    public setUserSettings(userSettings: ShellUserSettings) {
        // This comes from the renderer process, so we don't need to call sendUserSettingChanged
        this.settings.setUserSettings(userSettings);
        this.settings.save(this.getWindowState());
    }
    public setUserSettingValue(name: string, value: unknown) {
        const changed = this.settings.setUserSettingValue(name, value);
        if (changed) {
            // Overly general test for need to update window size,
            // as some of the UI settings doesn't need to update the window size
            if (name.startsWith("ui")) {
                const position = this.getWindowPositionState();
                this.verticalLayout = this.settings.user.ui.verticalLayout;
                this.setWindowSize(position);
            }
            this.sendUserSettingChanged();
            this.settings.save(this.getWindowState());
        }
        return changed;
    }

    private getWindowPositionState(): { x: number; y: number } {
        const bounds = this.mainWindow.getContentBounds();
        const addContent = this.verticalLayout && !this.contentVisible;

        return {
            x: bounds.x,
            y: addContent ? bounds.y - this.contentHeight : bounds.y,
        };
    }
    public getWindowState(): ShellWindowState {
        // Get browser tabs state for saving
        const browserTabs = this.browserViewManager.getAllBrowserTabs();
        const activeBrowserView =
            this.browserViewManager.getActiveBrowserView();

        const browserTabsState: BrowserTabState[] | undefined =
            browserTabs.length > 0
                ? browserTabs.map((tab) => ({
                      id: tab.id,
                      url: tab.url,
                      title: tab.title,
                      isActive: tab.isActive,
                  }))
                : undefined;

        const browserTabsJson = browserTabsState
            ? JSON.stringify(browserTabsState)
            : undefined;

        return {
            ...this.getWindowPositionState(),
            chatWidth: this.chatWidth,
            chatHeight: this.chatHeight,
            contentWidth: this.contentWidth,
            contentHeight: this.contentHeight,
            windowWidth: this.windowWidth,
            windowHeight: this.windowHeight,
            zoomLevel: this.chatView.webContents.zoomFactor,
            devTools: this.chatView.webContents.isDevToolsOpened(),
            canvas: this.browserViewManager.getActiveBrowserView()?.url, // Save active tab URL
            browserTabsJson: browserTabsJson,
            activeBrowserTabId: activeBrowserView?.id,
        };
    }

    public setWindowState(settings: ShellWindowState) {
        this.mainWindow.setBounds({
            x: settings.x,
            y: settings.y,
            width: settings.windowWidth,
            height: settings.windowHeight,
        });

        this.setZoomFactor(settings.zoomLevel, this.chatView.webContents);

        this.settings.save(this.getWindowState());
    }

    private sendUserSettingChanged() {
        this.chatView.webContents.send("settings-changed", this.settings.user);
    }

    // ================================================================
    // UI
    // ================================================================
    public updateContentSize(newDividerPos?: number) {
        const bounds = this.mainWindow.getContentBounds();
        debugShellWindow(
            `Updating content size with window bound: ${JSON.stringify(bounds)}`,
        );

        const dividerSize = 4; // 4px divider
        const verticalLayout = this.verticalLayout;
        const { width, height } = bounds;

        let dividerPos = -1;
        let chatViewBounds: Electron.Rectangle;
        if (verticalLayout) {
            this.windowWidth = width;
            let chatHeight = this.chatHeight;

            // Keep existing chat height unless the divider position changed.
            if (newDividerPos !== undefined) {
                chatHeight = height - newDividerPos - dividerSize;
            }
            // Clamp for window resize.
            if (chatHeight < 0) {
                chatHeight = 0;
            } else if (chatHeight > height - dividerSize) {
                chatHeight = height - dividerSize;
            }

            this.chatHeight = chatHeight;

            if (this.contentVisible) {
                const contentHeight = height - chatHeight - dividerSize;
                this.contentHeight = contentHeight;
                dividerPos = contentHeight;

                const browserViewBounds = {
                    x: 0,
                    y: 0,
                    width: width,
                    height: contentHeight,
                };

                // Update browser view manager for multi-tab layout
                this.browserViewManager.setBounds(browserViewBounds);
            }

            chatViewBounds = {
                x: 0,
                y: height - chatHeight,
                width,
                height: chatHeight,
            };
        } else {
            this.windowHeight = height;
            let chatWidth = this.chatWidth;
            // Keep existing chat width unless the divider position changed.
            if (newDividerPos !== undefined) {
                chatWidth = newDividerPos;
            }
            // Clamp for window resize.
            if (chatWidth < 0) {
                chatWidth = 0;
            } else if (chatWidth > width - dividerSize) {
                chatWidth = width - dividerSize;
            }
            this.chatWidth = chatWidth;

            if (this.contentVisible) {
                const contentWidth = width - chatWidth - dividerSize;
                this.contentWidth = contentWidth;
                dividerPos = chatWidth;

                const browserViewBounds = {
                    x: dividerPos + dividerSize,
                    y: 0,
                    width: contentWidth,
                    height,
                };

                // Update browser view manager for multi-tab layout
                this.browserViewManager.setBounds(browserViewBounds);
            }

            chatViewBounds = {
                x: 0,
                y: 0,
                width: chatWidth,
                height: height,
            };
        }
        debugShellWindow(`Chat view bounds: ${JSON.stringify(chatViewBounds)}`);
        this.chatView.setBounds(chatViewBounds);

        this.updateOverlayWebContentsViewBounds();

        const dividerLayout = {
            verticalLayout,
            pos: dividerPos,
        };

        // Set the divider position
        debugShellWindow("Divider Pos", dividerLayout);
        this.mainWindow.webContents.send("set-layout", dividerLayout);
    }

    public toggleTopMost() {
        this.mainWindow.setAlwaysOnTop(!this.mainWindow.isAlwaysOnTop());
    }

    public showDialog(dialogName: string) {
        this.chatView.webContents.send("show-dialog", dialogName);
    }

    // ================================================================
    // Multi-Tab Browser Support
    // ================================================================

    /**
     * Resolve custom typeagent-browser protocol URLs
     */
    public resolveCustomProtocolUrl(targetUrl: URL): URL {
        const browserExtensionUrls = (global as any).browserExtensionUrls;
        if (browserExtensionUrls) {
            // Map custom protocol to actual extension URL
            const libraryName = targetUrl.pathname;

            if (libraryName && browserExtensionUrls[libraryName]) {
                const resolvedUrl = new URL(browserExtensionUrls[libraryName]);
                debugShellWindow(
                    `Resolved custom protocol URL: ${targetUrl.toString()} -> ${resolvedUrl.toString()}`,
                );
                return resolvedUrl;
            } else {
                throw new Error(`Unknown library page: ${libraryName}`);
            }
        } else {
            throw new Error(
                "Browser extension not loaded - library pages unavailable",
            );
        }
    }

    private getWindowBounds(
        position: { x: number; y: number },
        hasBrowserTabs: boolean,
    ) {
        const uiSettings = this.settings.user.ui;
        let bounds: Electron.Rectangle;
        if (this.verticalLayout) {
            bounds = {
                ...position,
                width: this.windowWidth,
                height: this.chatHeight,
            };
            const contentVisible =
                uiSettings.verticalContentAlwaysVisible || hasBrowserTabs;
            if (contentVisible) {
                bounds.height += this.contentHeight;
            } else {
                bounds.y += this.contentHeight;
            }
            this.contentVisible = contentVisible;
        } else {
            bounds = {
                ...position,
                width: this.chatWidth,
                height: this.windowHeight,
            };
            const contentVisible =
                uiSettings.horizontalContentAlwaysVisible || hasBrowserTabs;
            if (contentVisible) {
                bounds.width += this.contentWidth;
            }

            this.contentVisible = contentVisible;
        }
        return bounds;
    }

    private setWindowSize(position: { x: number; y: number }) {
        const bounds = this.getWindowBounds(position, this.hasBrowserTabs());
        debugShellWindow("Set window bound: ", bounds, this.contentVisible);
        this.mainWindow.setBounds(bounds);

        if (isLinux) {
            // Workaround for electron bug where getContentSize isn't updated when "resize" event is fired
            // https://github.com/electron/electron/issues/42586
            setTimeout(() => {
                this.updateContentSize();
            }, 100);
        } else {
            this.updateContentSize();
        }
    }

    /**
     * Create a new browser tab and navigate to the specified page
     */
    public async createBrowserTab(
        url: URL,
        options?: { background?: boolean; waitForPageLoad?: boolean },
    ): Promise<string> {
        // Handle custom typeagent-browser protocol
        let resolvedUrl = url;
        if (url.protocol === "typeagent-browser:") {
            resolvedUrl = this.resolveCustomProtocolUrl(url);
        }

        const tabId = await this.browserViewManager.createBrowserTab({
            url: resolvedUrl.toString(),
            background: options?.background,
            waitForPageLoad: options?.waitForPageLoad,
        });

        // Re-add overlay views so they are on top
        for (const views of this.overlayWebContentsViews.keys()) {
            this.mainWindow.contentView.addChildView(views);
        }

        // setup zoom handlers for the new browser tab
        this.setupZoomHandlers(
            this.browserViewManager.getBrowserTab(tabId)?.webContentsView
                ?.webContents,
        );

        // Update layout when first tab is created
        if (this.browserViewManager.getAllBrowserTabs().length === 1) {
            this.setWindowSize(this.getWindowPositionState());
        }

        // Send update to renderer
        this.sendTabsUpdate();

        // Restore focus to chat after tab operations
        if (!options?.background) {
            // Small delay to let browser view settle
            setTimeout(() => {
                if (!this.chatView.webContents.isDestroyed()) {
                    this.chatView.webContents.focus();
                    this.chatView.webContents.send("focus-chat-input");
                }
            }, 50);
        }

        return tabId;
    }

    /**
     * Switch to a specific browser tab
     */
    public switchBrowserTab(tabId: string): boolean {
        const success = this.browserViewManager.setActiveBrowserView(tabId);
        if (success) {
            this.updateContentSize();
        }
        return success;
    }

    /**
     * Close a browser tab
     */
    public closeBrowserTab(tabId: string): boolean {
        const success = this.browserViewManager.closeBrowserTab(tabId);
        if (success) {
            this.updateContentSize();

            // Restore focus to chat after closing tab
            this.chatView.webContents.focus();
            this.chatView.webContents.send("focus-chat-input");
        }
        return success;
    }

    /**
     * Get the active browser view
     */
    public getActiveBrowserView(): BrowserViewContext | null {
        return this.browserViewManager.getActiveBrowserView();
    }

    /**
     * Get all browser tabs
     */
    public getAllBrowserTabs(): BrowserViewContext[] {
        return this.browserViewManager.getAllBrowserTabs();
    }

    /**
     * Check if browser tabs are open
     */
    public hasBrowserTabs(): boolean {
        return this.browserViewManager.hasBrowserTabs();
    }

    /**
     * Get browser navigation state
     */
    public getBrowserNavigationState(): {
        canGoBack: boolean;
        canGoForward: boolean;
    } {
        // Always use multi-tab browser
        return this.browserViewManager.getNavigationState();
    }

    /**
     * Navigate browser back
     */
    public browserGoBack(): boolean {
        // Always use multi-tab browser
        return this.browserViewManager.goBack();
    }

    /**
     * Navigate browser forward
     */
    public browserGoForward(): boolean {
        // Always use multi-tab browser
        return this.browserViewManager.goForward();
    }

    /**
     * Reload active browser tab
     */
    public browserReload(): boolean {
        // Always use multi-tab browser
        return this.browserViewManager.reload();
    }

    /**
     * Send tab updates to renderer
     */
    private sendTabsUpdate(): void {
        const tabs = this.getAllBrowserTabs().map((tab) => ({
            id: tab.id,
            title: tab.title,
            url: tab.url,
            favicon: tab.favicon,
            isActive: tab.isActive,
        }));

        const activeTab = this.getActiveBrowserView();
        const tabsData = {
            tabs,
            activeTabId: activeTab?.id || null,
            navigationState: this.getBrowserNavigationState(),
        };

        this.mainWindow.webContents.send("browser-tabs-updated", tabsData);

        // Also send to all browser tab WebContents for tab validation
        this.browserViewManager.getAllBrowserTabs().forEach((tab) => {
            tab.webContentsView.webContents.send(
                "browser-tabs-updated",
                tabsData,
            );
        });
    }

    /**
     * Send navigation state update to renderer
     */
    private sendNavigationUpdate(): void {
        const navigationState = this.getBrowserNavigationState();
        this.mainWindow.webContents.send(
            "browser-navigation-updated",
            navigationState,
        );
    }

    // ================================================================
    // PDF Viewer Support
    // ================================================================
    public async checkTypeAgentConnection(): Promise<boolean> {
        try {
            const browserIpc = BrowserAgentIpc.getinstance();
            const webSocket = await browserIpc.ensureWebsocketConnected();
            return webSocket !== undefined && webSocket.readyState === 1; // WebSocket.OPEN
        } catch (error) {
            debugShellWindowError(
                "Error checking TypeAgent connection:",
                error,
            );
            return false;
        }
    }

    public async openPDFViewer(pdfUrl: string): Promise<void> {
        try {
            debugShellWindow(`Opening PDF viewer for: ${pdfUrl}`);

            const viewerUrl = await this.constructPDFViewerUrl(pdfUrl);
            this.createBrowserTab(new URL(viewerUrl), { background: false });
            return Promise.resolve();
        } catch (error) {
            debugShellWindowError("Error opening PDF viewer:", error);
            throw error;
        }
    }

    private async constructPDFViewerUrl(pdfUrl: string): Promise<string> {
        try {
            const browserIpc = BrowserAgentIpc.getinstance();

            const response = await new Promise<any>((resolve, reject) => {
                const timeoutId = setTimeout(() => {
                    reject(new Error("Timeout getting view host URL"));
                }, 10000);

                const messageId = Math.random().toString(36).substring(7);
                const message = {
                    id: messageId,
                    method: "getViewHostUrl",
                    params: {},
                };

                const originalHandler = browserIpc.onMessageReceived;
                browserIpc.onMessageReceived = (response: any) => {
                    if (response.id === messageId) {
                        clearTimeout(timeoutId);
                        browserIpc.onMessageReceived = originalHandler;
                        resolve(response.result);
                    } else if (originalHandler) {
                        originalHandler(response);
                    }
                };

                browserIpc.send(message).catch(reject);
            });

            if (!response || !response.url) {
                throw new Error(
                    "Unable to get view host URL from TypeAgent service",
                );
            }

            const viewerUrl = `${response.url}/pdf/?url=${encodeURIComponent(pdfUrl)}`;
            debugShellWindow(`Constructed PDF viewer URL: ${viewerUrl}`);
            return viewerUrl;
        } catch (error) {
            debugShellWindowError("Error constructing PDF viewer URL:", error);
            throw new Error("Failed to get TypeAgent PDF service URL");
        }
    }

    private dispatcherReadyPromiseResolvers:
        | PromiseWithResolvers<void>
        | undefined = Promise.withResolvers<void>();
    public dispatcherInitialized() {
        if (this.dispatcherReadyPromiseResolvers === undefined) {
            throw new Error("Dispatcher already initialized");
        }
        this.dispatcherReadyPromiseResolvers.resolve();
        this.dispatcherReadyPromiseResolvers = undefined;

        // Notify the renderer process that the dispatcher is initialized
        this.chatView.webContents.send("dispatcher-initialized");

        // Give focus to the chat view once initialization is done.
        this.chatView.webContents.focus();
    }

    // ================================================================
    // Zoom Handler
    // ================================================================
    private setupZoomHandlers(
        webContents: WebContents | undefined,
        onZoomChanged?: (zoomFactor: number) => void,
    ) {
        if (!webContents) return;

        webContents.on("before-input-event", (_event, input) => {
            if (
                (isMac ? input.meta : input.control) &&
                input.type === "keyDown"
            ) {
                if (
                    input.key === "NumpadAdd" ||
                    input.key === "+" ||
                    input.key === "="
                ) {
                    this.zoomIn(webContents, onZoomChanged);
                } else if (input.key === "-" || input.key === "NumpadMinus") {
                    this.zoomOut(webContents, onZoomChanged);
                } else if (input.key === "0") {
                    this.setZoomFactor(1, webContents, onZoomChanged);
                }
            }
        });

        // Register mouse wheel as well.
        webContents.on("zoom-changed", (_event, zoomDirection) => {
            if (zoomDirection === "in") {
                this.zoomIn(webContents, onZoomChanged);
            } else {
                this.zoomOut(webContents, onZoomChanged);
            }
        });
    }

    private zoomIn(
        webContents: WebContents,
        onZoomChanged?: (zoomFactor: number) => void,
    ) {
        this.setZoomFactor(
            webContents.zoomFactor + 0.1,
            webContents,
            onZoomChanged,
        );
    }

    private zoomOut(
        webContents: WebContents,
        onZoomChanged?: (zoomFactor: number) => void,
    ) {
        this.setZoomFactor(
            webContents.zoomFactor - 0.1,
            webContents,
            onZoomChanged,
        );
    }

    /**
     * Sets the zoom factor for the active window/tab.
     * @param zoomFactor - The zoom factor to set for the active window/tab
     */
    public setZoomFactor(
        zoomFactor: number,
        webContents: WebContents,
        onZoomChanged?: (zoomFactor: number) => void,
    ) {
        // limit zoom factor to reasonable numbers
        if (zoomFactor < 0.25) {
            zoomFactor = 0.25;
        } else if (zoomFactor > 5) {
            zoomFactor = 5;
        }

        webContents.zoomFactor = zoomFactor;
        onZoomChanged?.(zoomFactor);
    }

    /**
     * Updates the window title to include the current zoom level.
     * @param zoomFactor - The zoom factor to show in the title
     */
    private updateZoomInTitle(zoomFactor: number) {
        const prevTitle = this.mainWindow.getTitle();
        const prevZoomIndex = prevTitle.indexOf(" Zoom: ");
        const summary =
            prevZoomIndex !== -1
                ? prevTitle.substring(0, prevZoomIndex)
                : prevTitle;
        const zoomTitle =
            zoomFactor === 1 ? "" : ` Zoom: ${Math.round(zoomFactor * 100)}%`;
        this.mainWindow.setTitle(`${summary}${zoomTitle}`);

        // Update the page title to match the window title as well for backwards compat with Playwright tests
        this.chatView.webContents.executeJavaScript(
            `document.title = '${summary}${zoomTitle}';`,
        );
    }
}

function createMainWindow(bounds: Electron.Rectangle) {
    const mainWindow = new BrowserWindow({
        ...bounds,
        show: false,
        autoHideMenuBar: true,
        webPreferences: {
            preload: path.join(__dirname, "../preload/expose.mjs"),
            sandbox: false,
            zoomFactor: 1,
        },
    });

    // This (seemingly redundant) call is needed when we use a BrowserView.
    // Without this call, the mainWindow opens using default width/height, not the
    // values saved in ShellSettings
    mainWindow.setBounds(bounds);
    mainWindow.removeMenu();

    // make sure links are opened in the the shell
    mainWindow.webContents.setWindowOpenHandler(() => {
        // TODO: add logic for opening in external browser if a modifier key is pressed
        //shell.openExternal(details.url);
        return { action: "allow" };
    });

    return mainWindow;
}

function createChatView(state: ShellWindowState) {
    const chatView = new WebContentsView({
        webPreferences: {
            preload: path.join(__dirname, "../preload/chatView.mjs"),
            sandbox: false,
            zoomFactor: state.zoomLevel,
        },
    });

    return chatView;
}

/**
 * Allows the application to gain access to camera devices
 * @param mainWindow the main browser window
 */
function setupDevicePermissions(mainWindow: BrowserWindow) {
    let grantedDeviceThroughPermHandler;

    mainWindow.webContents.session.on(
        "select-usb-device",
        (event, details, callback) => {
            // Add events to handle devices being added or removed before the callback on
            // `select-usb-device` is called.
            mainWindow.webContents.session.on(
                "usb-device-added",
                (_event, device) => {
                    console.log("usb-device-added FIRED WITH", device);
                    // Optionally update details.deviceList
                },
            );

            mainWindow.webContents.session.on(
                "usb-device-removed",
                (_event, device) => {
                    console.log("usb-device-removed FIRED WITH", device);
                    // Optionally update details.deviceList
                },
            );

            event.preventDefault();
            if (details.deviceList && details.deviceList.length > 0) {
                const deviceToReturn = details.deviceList.find((device) => {
                    return (
                        !grantedDeviceThroughPermHandler ||
                        device.deviceId !==
                            grantedDeviceThroughPermHandler.deviceId
                    );
                });
                if (deviceToReturn) {
                    callback(deviceToReturn.deviceId);
                } else {
                    callback();
                }
            }
        },
    );

    mainWindow.webContents.session.setPermissionCheckHandler(
        (
            _webContents: WebContents | null,
            permission,
            _requestingOrigin,
            details,
        ): boolean => {
            if (
                (permission === "usb" &&
                    details.securityOrigin === "file:///") ||
                (permission === "media" &&
                    (details.securityOrigin?.startsWith("http://localhost") ||
                        details.securityOrigin?.startsWith(
                            "https://localhost",
                        ))) ||
                permission.endsWith("fullscreen")
            ) {
                return true;
            }

            return false;
        },
    );

    mainWindow.webContents.session.setDevicePermissionHandler(
        (details: DevicePermissionHandlerHandlerDetails): boolean => {
            if (details.deviceType === "usb" && details.origin === "file://") {
                if (!grantedDeviceThroughPermHandler) {
                    grantedDeviceThroughPermHandler = details.device;
                    return true;
                } else {
                    return false;
                }
            }
            return false;
        },
    );
}

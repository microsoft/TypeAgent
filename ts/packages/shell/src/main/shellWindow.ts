// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import {
    BrowserWindow,
    DevicePermissionHandlerHandlerDetails,
    globalShortcut,
    ipcMain,
    shell,
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
import { isProd } from "./index.js";
import { BrowserAgentIpc } from "./browserIpc.js";
import {
    BrowserViewManager,
    BrowserViewContext,
} from "./browserViewManager.js";

import registerDebug from "debug";
const debugShellWindow = registerDebug("typeagent:shell:window");
const debugShellWindowError = registerDebug("typeagent:shell:window:error");

const userAgent =
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36 Edg/124.0.0.0";
const isMac = process.platform === "darwin";
const isLinux = process.platform === "linux";

function setupResizeHandler(mainWindow: BrowserWindow, handler: () => void) {
    let scheduleHandler: (() => void) | undefined;
    mainWindow.on("resize", handler);
    if (isLinux) {
        // Workaround for electron bug where getContentSize isn't updated when "resize" event is fired
        // https://github.com/electron/electron/issues/42586
        scheduleHandler = () => {
            debugShellWindow("Scheduled Maximize/Unmaximize update");
            setTimeout(() => {
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
        mainWindow.removeListener("resize", handler);
        if (scheduleHandler !== undefined) {
            mainWindow.removeListener("maximize", scheduleHandler);
            mainWindow.removeListener("unmaximize", scheduleHandler);
        }
    };
}

export class ShellWindow {
    public static getInstance(): ShellWindow | undefined {
        return this.instance;
    }
    private static instance: ShellWindow | undefined;

    public readonly mainWindow: BrowserWindow;
    public readonly chatView: WebContentsView;
    private inlineWidth: number;
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
    constructor(private readonly settings: ShellSettingManager) {
        if (ShellWindow.instance !== undefined) {
            throw new Error("ShellWindow already created");
        }

        const state = this.settings.window;
        this.inlineWidth = state.inlineWidth;
        const mainWindow = createMainWindow(state);

        setupDevicePermissions(mainWindow);
        this.setupWebContents(mainWindow.webContents);

        // Initialize browser view manager
        this.browserViewManager = new BrowserViewManager(mainWindow);

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
        this.setupWebContents(chatView.webContents);
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
                    // No more browser tabs - shrink the window back to chat-only size
                    const mainWindow = this.mainWindow;
                    const mainWindowSize = mainWindow.getBounds();
                    const newWidth = mainWindowSize.width - this.inlineWidth;

                    debugShellWindow(
                        `Shrinking window after closing last browser tab: ${mainWindowSize.width} - ${this.inlineWidth} = ${newWidth}`,
                    );

                    mainWindow.setBounds({
                        width: newWidth,
                    });
                    this.updateContentSize();
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
        // HMR for renderer base on electron-vite cli.
        // Load the remote URL for development or the local html file for production.
        if (!isProd && process.env["ELECTRON_RENDERER_URL"]) {
            contentLoadP.push(
                chatView.webContents.loadURL(
                    process.env["ELECTRON_RENDERER_URL"],
                ),
            );
        } else {
            contentLoadP.push(
                chatView.webContents.loadFile(
                    path.join(__dirname, "../renderer/index.html"),
                ),
            );
        }

        contentLoadP.push(
            mainWindow.webContents.loadFile(
                path.join(__dirname, "../renderer/viewHost.html"),
            ),
        );

        this.contentLoadP = contentLoadP;

        this.updateContentSize();
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

    private ready() {
        // Send settings asap
        this.sendUserSettingChanged();

        const mainWindow = this.mainWindow;
        mainWindow.show();
        // Main window shouldn't zoom, otherwise the divider position won't be correct.  Setting it here just to make sure.
        this.setZoomLevel(1, mainWindow.webContents);

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
                        const tabId = this.createBrowserTab(
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

    private setupWebContents(webContents: WebContents) {
        this.setupZoomHandlers(webContents);
        webContents.setUserAgent(userAgent);
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
            this.sendUserSettingChanged();
            this.settings.save(this.getWindowState());
        }
        return changed;
    }

    private getWindowState(): ShellWindowState {
        const position = this.mainWindow.getPosition();
        const size = this.mainWindow.getSize();

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
            x: position[0],
            y: position[1],
            width: size[0] - (browserTabsJson ? this.inlineWidth : 0),
            height: size[1],
            inlineWidth: this.inlineWidth,
            zoomLevel: this.chatView.webContents.zoomFactor,
            devTools: this.chatView.webContents.isDevToolsOpened(),
            canvas: this.browserViewManager.getActiveBrowserView()?.url, // Save active tab URL
            browserTabsJson: browserTabsJson,
            activeBrowserTabId: activeBrowserView?.id,
        };
    }

    private sendUserSettingChanged() {
        this.chatView.webContents.send("settings-changed", this.settings.user);
    }

    // ================================================================
    // UI
    // ================================================================
    public updateContentSize(newChatWidth?: number) {
        const bounds = this.mainWindow.getContentBounds();
        debugShellWindow(
            `Updating content size with window bound: ${JSON.stringify(bounds)}`,
        );

        const { width, height } = bounds;
        let chatWidth = width;

        // Check if we have browser tabs
        const hasBrowserContent = this.browserViewManager.hasBrowserTabs();

        if (hasBrowserContent) {
            // If no explicit chat width provided, calculate it from the total width and saved inline width
            // chatWidth = newChatWidth ?? (width - this.inlineWidth);
            chatWidth = newChatWidth ?? this.chatView.getBounds().width;
            if (chatWidth < 0) {
                chatWidth = 0;
            } else if (chatWidth > width - 4) {
                chatWidth = width - 4;
            }
            const inlineWidth = width - chatWidth;
            this.inlineWidth = inlineWidth;

            const browserViewBounds = {
                x: chatWidth + 4, // 4px divider
                y: 0,
                width: width - chatWidth - 4,
                height: height,
            };

            // Update browser view manager for multi-tab layout
            this.browserViewManager.setBounds(browserViewBounds);
        } else {
            // No browser content - chat should fill the entire width
            chatWidth = width;
            // Don't update inlineWidth when no browser content, keep the saved value for future use
        }

        const chatViewBounds = {
            x: 0,
            y: 0,
            width: chatWidth,
            height: height,
        };

        debugShellWindow(`Chat view bounds: ${JSON.stringify(chatViewBounds)}`);
        this.chatView.setBounds(chatViewBounds);

        // Set the divider position
        const dividerLeft = hasBrowserContent ? chatWidth : -1;
        debugShellWindow(`Divider left: ${dividerLeft}`);
        this.mainWindow.webContents.send("set-divider-left", dividerLeft);
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
    private resolveCustomProtocolUrl(targetUrl: URL): URL {
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

        // setup zoom handlers for the new browser tab
        this.setupZoomHandlers(
            this.browserViewManager.getBrowserTab(tabId)?.webContentsView
                ?.webContents,
        );

        // Update layout when first tab is created
        if (this.browserViewManager.getAllBrowserTabs().length === 1) {
            // This is the first browser tab - expand the window to accommodate browser section
            const mainWindow = this.mainWindow;
            const mainWindowSize = mainWindow.getBounds();
            const newWidth = mainWindowSize.width + this.inlineWidth;

            debugShellWindow(
                `Expanding window for first browser tab: ${mainWindowSize.width} + ${this.inlineWidth} = ${newWidth}`,
            );

            mainWindow.setBounds({
                width: newWidth,
            });
            this.updateContentSize();
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
    private setupZoomHandlers(webContents: WebContents | undefined) {
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
                    this.zoomIn(webContents);
                } else if (input.key === "-" || input.key === "NumpadMinus") {
                    this.zoomOut(webContents);
                } else if (input.key === "0") {
                    this.setZoomLevel(1, webContents);
                }
            }
        });

        // Register mouse wheel as well.
        webContents.on("zoom-changed", (_event, zoomDirection) => {
            if (zoomDirection === "in") {
                this.zoomIn(webContents);
            } else {
                this.zoomOut(webContents);
            }
        });
    }

    private zoomIn(webContents: WebContents) {
        this.setZoomLevel(webContents.zoomFactor + 0.1, webContents);
    }

    private zoomOut(webContents: WebContents) {
        this.setZoomLevel(webContents.zoomFactor - 0.1, webContents);
    }

    /**
     * Sets the zoom level for the active window/tab.
     * @param zoomFactor - The zoom factor to set for the active window/tab
     */
    public setZoomLevel(zoomFactor: number, webContents: WebContents) {
        // limit zoom factor to reasonable numbers
        if (zoomFactor < 0.1) {
            zoomFactor = 0.1;
        } else if (zoomFactor > 10) {
            zoomFactor = 10;
        }

        webContents.zoomFactor = zoomFactor;

        // only update the zoom in the title for the zoom factor of the main (chat) window
        this.updateZoomInTitle(this.chatView.webContents.zoomFactor);
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
    }
}

function createMainWindow(state: ShellWindowState) {
    const mainWindow = new BrowserWindow({
        width: state.width,
        height: state.height,
        show: false,
        autoHideMenuBar: true,
        webPreferences: {
            preload: path.join(__dirname, "../preload/main.mjs"),
            sandbox: false,
            zoomFactor: 1,
        },
        x: state.x,
        y: state.y,
    });

    // This (seemingly redundant) call is needed when we use a BrowserView.
    // Without this call, the mainWindow opens using default width/height, not the
    // values saved in ShellSettings
    mainWindow.setBounds({
        width: state.width,
        height: state.height,
    });

    mainWindow.removeMenu();

    // make sure links are opened in the external browser
    mainWindow.webContents.setWindowOpenHandler((details) => {
        shell.openExternal(details.url);
        return { action: "deny" };
    });

    return mainWindow;
}

function createChatView(state: ShellWindowState) {
    const chatView = new WebContentsView({
        webPreferences: {
            preload: path.join(__dirname, "../preload/index.mjs"),
            sandbox: false,
            zoomFactor: state.zoomLevel,
        },
    });

    // ensure links are opened in a new browser window
    chatView.webContents.setWindowOpenHandler((details) => {
        // TODO: add logic for keeping things in the browser window
        shell.openExternal(details.url);
        return { action: "deny" };
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

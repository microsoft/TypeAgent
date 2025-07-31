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
    ShellSettings,
    ShellUserSettings,
    ShellWindowState,
    ShellSettingManager,
} from "./shellSettings.js";
import { isProd } from "./index.js";
import { BrowserAgentIpc } from "./browserIpc.js";

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
    private inlineWebContentView: WebContentsView | undefined;
    private targetUrl: string | undefined;
    private inlineWidth: number;
    private readonly contentLoadP: Promise<void>[];
    private readonly handlers = new Map<string, (event: any) => void>();
    private readonly settings: ShellSettingManager;
    private closing: boolean = false;

    public get inlineBrowser(): WebContentsView {
        if (this.inlineWebContentView === undefined) {
            throw new Error("Inline browser is not open");
        }
        return this.inlineWebContentView;
    }
    constructor(shellSettings: ShellSettings, instanceDir: string) {
        if (ShellWindow.instance !== undefined) {
            throw new Error("ShellWindow already created");
        }
        this.settings = new ShellSettingManager(shellSettings, instanceDir);

        this.inlineWidth = shellSettings.window.inlineWidth;

        const state = shellSettings.window;
        const mainWindow = createMainWindow(state);

        setupDevicePermissions(mainWindow);
        this.setupWebContents(mainWindow.webContents);

        const resizeHandlerCleanup = setupResizeHandler(mainWindow, () =>
            this.updateContentSize(),
        );
        mainWindow.on("close", () => {
            this.cleanup();
            this.settings.save(this.getWindowState());

            mainWindow.hide();
            // Remove the handler to avoid update the content size on close
            resizeHandlerCleanup();
            this.closeInlineBrowser(false);
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
        mainWindow.webContents.zoomFactor = 1;

        const states = this.settings.window;
        const user = this.settings.user;
        if (states.devTools) {
            this.chatView.webContents.openDevTools();
        }

        // open the canvas if it was previously open
        if (user.canvas) {
            this.openInlineBrowser(new URL(user.canvas)).catch((e) => {
                // Don't care if this failed.
                debugShellWindowError(
                    `Failed to open canvas URL ${user.canvas} on app start: ${e}`,
                );
            });
        }

        globalShortcut.register("Alt+Right", () => {
            this.chatView.webContents.send("send-demo-event", "Alt+Right");
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

        globalShortcut.unregister("Alt+Right");
    }

    public sendMessageToInlineWebContent(message: WebSocketMessageV2) {
        this.inlineWebContentView?.webContents.send(
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

        return {
            x: position[0],
            y: position[1],
            width: size[0] - (this.inlineWebContentView ? this.inlineWidth : 0),
            height: size[1],
            inlineWidth: this.inlineWidth,
            zoomLevel: this.chatView.webContents.zoomFactor,
            devTools: this.chatView.webContents.isDevToolsOpened(),
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
        if (this.inlineWebContentView) {
            chatWidth = newChatWidth ?? this.chatView.getBounds().width;
            if (chatWidth < 0) {
                chatWidth = 0;
            } else if (chatWidth > width - 4) {
                chatWidth = width - 4;
            }
            const inlineWidth = width - chatWidth;
            this.inlineWidth = inlineWidth;
            const inlineBounds = {
                x: chatWidth + 4,
                y: 0,
                width: inlineWidth,
                height: height,
            };
            debugShellWindow(
                `Inline browser bounds: ${JSON.stringify(inlineBounds)}`,
            );
            this.inlineWebContentView.setBounds({
                x: chatWidth + 4,
                y: 0,
                width: inlineWidth,
                height: height,
            });
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
        const dividerLeft = this.inlineWebContentView ? chatWidth : -1;
        debugShellWindow(`Divider left: ${dividerLeft}`);
        this.mainWindow.webContents.send("set-divider-left", dividerLeft);
    }

    public toggleTopMost() {
        this.mainWindow.setAlwaysOnTop(!this.mainWindow.isAlwaysOnTop());
    }

    public showDialog(dialogName: string) {
        this.chatView.webContents.send("show-dialog", dialogName);
    }

    public get inlineBrowserUrl(): string | undefined {
        return this.targetUrl;
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
            return this.openInlineBrowser(new URL(viewerUrl));
        } catch (error) {
            debugShellWindowError("Error opening PDF viewer:", error);
            throw error;
        }
    }

    private async constructPDFViewerUrl(pdfUrl: string): Promise<string> {
        try {
            const browserIpc = BrowserAgentIpc.getinstance();
            console.trace();

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

    // ================================================================
    // Inline browser
    // ================================================================
    public async openInlineBrowser(targetUrl: URL) {
        const mainWindow = this.mainWindow;
        const mainWindowSize = mainWindow.getBounds();
        let newWindow: boolean = false;
        let inlineWebContentView = this.inlineWebContentView;
        if (!inlineWebContentView) {
            newWindow = true;

            inlineWebContentView = new WebContentsView({
                webPreferences: {
                    preload: path.join(__dirname, "../preload-cjs/webview.cjs"),
                    sandbox: false,
                    zoomFactor: this.chatView.webContents.zoomFactor,
                },
            });

            this.setupWebContents(inlineWebContentView.webContents);

            mainWindow.contentView.addChildView(inlineWebContentView);
            this.inlineWebContentView = inlineWebContentView;

            mainWindow.setBounds({
                width: mainWindowSize.width + this.inlineWidth,
            });
            this.updateContentSize();
        }

        const targetUrlString = targetUrl.toString();
        // only open the requested canvas if it isn't already opened
        if (this.targetUrl !== targetUrlString || newWindow) {
            this.targetUrl = targetUrlString;
            // indicate in the settings which canvas is open
            this.setUserSettingValue("canvas", targetUrlString);

            if (
                this.dispatcherReadyPromise !== undefined &&
                targetUrlString.startsWith("http://localhost")
            ) {
                await this.dispatcherReadyPromise;
            }

            return inlineWebContentView.webContents.loadURL(targetUrlString);
        }
    }

    private dispatcherReady: (() => void) | undefined;
    private dispatcherReadyPromise: Promise<void> | undefined = new Promise(
        (resolve) => {
            this.dispatcherReady = () => {
                resolve();
                this.dispatcherReady = undefined;
                this.dispatcherReadyPromise = undefined;
            };
        },
    );
    public dispatcherInitialized() {
        this.dispatcherReady?.();
    }

    public closeInlineBrowser(save: boolean = true) {
        const inlineWebContentView = this.inlineWebContentView;
        if (inlineWebContentView === undefined) {
            return false;
        }
        const browserBounds = inlineWebContentView.getBounds();
        inlineWebContentView.webContents.close();
        this.mainWindow.contentView.removeChildView(inlineWebContentView);
        this.inlineWebContentView = undefined;

        const mainWindowSize = this.mainWindow.getBounds();
        this.mainWindow.setBounds({
            width: mainWindowSize.width - browserBounds.width,
        });

        this.updateContentSize();

        // clear the canvas settings
        if (save) {
            this.targetUrl = undefined;
            this.setUserSettingValue("canvas", undefined);
        }
        return true;
    }

    // ================================================================
    // Zoom Handler
    // ================================================================
    private setupZoomHandlers(webContents: WebContents) {
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
                    this.zoomIn();
                } else if (input.key === "-" || input.key === "NumpadMinus") {
                    this.zoomOut();
                } else if (input.key === "0") {
                    this.setZoomLevel(1);
                }
            }
        });

        // Register mouse wheel as well.
        webContents.on("zoom-changed", (_event, zoomDirection) => {
            if (zoomDirection === "in") {
                this.zoomIn();
            } else {
                this.zoomOut();
            }
        });
    }

    private zoomIn() {
        this.setZoomLevel(this.chatView.webContents.zoomFactor + 0.1);
    }

    private zoomOut() {
        this.setZoomLevel(this.chatView.webContents.zoomFactor - 0.1);
    }

    public setZoomLevel(zoomFactor: number) {
        if (zoomFactor < 0.1) {
            zoomFactor = 0.1;
        } else if (zoomFactor > 10) {
            zoomFactor = 10;
        }

        for (const view of this.mainWindow.contentView.children) {
            if (view instanceof WebContentsView) {
                view.webContents.zoomFactor = zoomFactor;
            }
        }

        this.updateZoomInTitle(zoomFactor);
    }

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

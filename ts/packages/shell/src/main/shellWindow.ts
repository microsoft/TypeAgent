// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import {
    BrowserWindow,
    DevicePermissionHandlerHandlerDetails,
    shell,
    WebContents,
    WebContentsView,
} from "electron";
import path from "node:path";
import { ShellSettings } from "./shellSettings.js";
import { is } from "@electron-toolkit/utils";
import { WebSocketMessageV2 } from "common-utils";
import { runDemo } from "./demo.js";

const inlineBrowserSize = 1000;
const userAgent =
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36 Edg/124.0.0.0";
const isMac = process.platform === "darwin";
const isLinux = process.platform === "linux";
export class ShellWindow {
    public readonly mainWindow: BrowserWindow;
    public readonly chatView: WebContentsView;
    private inlineWebContentView: WebContentsView | undefined;
    private readonly contentLoadP: Promise<void>[];

    constructor(public readonly settings: ShellSettings) {
        const mainWindow = createMainWindow(settings);
        const chatView = createChatView(settings);

        setupDevicePermissions(mainWindow);
        this.setupWebContents(mainWindow.webContents);
        this.setupWebContents(chatView.webContents);

        mainWindow.on("ready-to-show", () => {
            mainWindow.show();

            if (settings.devTools) {
                chatView.webContents.openDevTools();
            }
        });

        mainWindow.on("close", () => {
            mainWindow.hide();
            mainWindow.removeAllListeners("move");
            mainWindow.removeAllListeners("moved");
            mainWindow.removeAllListeners("resize");
            mainWindow.removeAllListeners("resized");

            this.closeInlineBrowser(false);

            settings.zoomLevel = chatView.webContents.zoomFactor;
            settings.devTools = chatView.webContents.isDevToolsOpened();
            settings.size = mainWindow.getSize();
            settings.position = mainWindow.getPosition();
        });

        mainWindow.on("closed", () => {
            settings.save();
        });

        if (isLinux) {
            mainWindow.on("move", () => {
                settings.position = mainWindow.getPosition();
            });
        } else {
            mainWindow.on("moved", () => {
                settings.position = mainWindow.getPosition();
            });
        }

        mainWindow.on("resized", () => {
            settings.size = mainWindow.getSize();
        });

        mainWindow.on("resize", () => this.updateContentSize());

        mainWindow.contentView.addChildView(chatView);

        this.mainWindow = mainWindow;
        this.chatView = chatView;

        const contentLoadP: Promise<void>[] = [];
        // HMR for renderer base on electron-vite cli.
        // Load the remote URL for development or the local html file for production.
        if (is.dev && process.env["ELECTRON_RENDERER_URL"]) {
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
    }

    public async waitForContentLoaded() {
        return Promise.all(this.contentLoadP);
    }

    public updateContentSize(newChatWidth?: number) {
        const bounds = this.mainWindow.getContentBounds();
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
            this.inlineWebContentView.setBounds({
                x: chatWidth + 4,
                y: 0,
                width: inlineWidth,
                height: height,
            });
        }

        this.chatView.setBounds({
            x: 0,
            y: 0,
            width: chatWidth,
            height: height,
        });

        // Set the divider position
        this.mainWindow.webContents.send(
            "set-divider-left",
            this.inlineWebContentView ? chatWidth : -1,
        );
    }

    public openInlineBrowser(targetUrl: URL) {
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
                width: mainWindowSize.width + inlineBrowserSize,
            });
            this.updateContentSize();
        }

        // only open the requested canvas if it isn't already opened
        if (this.settings.canvas !== targetUrl.toString() || newWindow) {
            inlineWebContentView.webContents.loadURL(targetUrl.toString());

            // indicate in the settings which canvas is open
            this.settings.canvas = targetUrl.toString().toLocaleLowerCase();

            // write the settings to disk
            this.settings.save();
        }
    }

    public closeInlineBrowser(save: boolean = true) {
        const inlineWebContentView = this.inlineWebContentView;
        if (inlineWebContentView === undefined) {
            return;
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
            this.settings.canvas = undefined;
        }

        // write the settings to disk
        this.settings.save();
    }

    public updateSettings(settings: ShellSettings) {
        // Save the shell configurable settings
        this.settings.microphoneId = settings.microphoneId;
        this.settings.microphoneName = settings.microphoneName;
        this.settings.tts = settings.tts;
        this.settings.ttsSettings = settings.ttsSettings;
        this.settings.agentGreeting = settings.agentGreeting;
        this.settings.partialCompletion = settings.partialCompletion;
        this.settings.darkMode = settings.darkMode;
        this.settings.chatHistory = settings.chatHistory;

        // write the settings to disk
        this.settings.save();
    }
    public toggleTopMost() {
        this.mainWindow.setAlwaysOnTop(!this.mainWindow.isAlwaysOnTop());
    }

    public showDialog(dialogName: string) {
        this.chatView.webContents.send("show-dialog", dialogName);
    }

    public sendMessageToInlineWebContent(message: WebSocketMessageV2) {
        this.inlineWebContentView?.webContents.send("webview-message", message);
    }

    public runDemo(interactive: boolean = false) {
        runDemo(this.mainWindow, this.chatView, interactive);
    }
    private setupWebContents(webContents: WebContents) {
        this.setupZoomHandlers(webContents);
        this.setupDevToolsHandlers(webContents);
        webContents.setUserAgent(userAgent);
    }

    private setupDevToolsHandlers(webContents: WebContents) {
        webContents.on("before-input-event", (_event, input) => {
            if (input.type === "keyDown") {
                if (!is.dev) {
                    // Ignore CommandOrControl + R
                    if (input.code === "KeyR" && (input.control || input.meta))
                        _event.preventDefault();
                } else {
                    // Toggle devtool(F12)
                    if (input.code === "F12") {
                        if (webContents.isDevToolsOpened()) {
                            webContents.closeDevTools();
                        } else {
                            webContents.openDevTools({ mode: "undocked" });
                        }
                    }
                }
            }
        });
    }

    // Zoom handlers
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
        this.settings.zoomLevel = zoomFactor;

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

function createMainWindow(settings: ShellSettings) {
    const mainWindow = new BrowserWindow({
        width: settings.width,
        height: settings.height,
        show: false,
        autoHideMenuBar: true,
        webPreferences: {
            preload: path.join(__dirname, "../preload/index.mjs"),
            sandbox: false,
            zoomFactor: 1,
        },
        x: settings.x,
        y: settings.y,
    });

    console.log(settings.x, settings.y);
    // This (seemingly redundant) call is needed when we use a BrowserView.
    // Without this call, the mainWindow opens using default width/height, not the
    // values saved in ShellSettings
    mainWindow.setBounds({
        width: settings.width,
        height: settings.height,
    });

    mainWindow.removeMenu();

    // make sure links are opened in the external browser
    mainWindow.webContents.setWindowOpenHandler((details) => {
        shell.openExternal(details.url);
        return { action: "deny" };
    });

    return mainWindow;
}

function createChatView(settings: ShellSettings) {
    const chatView = new WebContentsView({
        webPreferences: {
            preload: path.join(__dirname, "../preload/index.mjs"),
            sandbox: false,
            zoomFactor: settings.zoomLevel,
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
                        )))
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

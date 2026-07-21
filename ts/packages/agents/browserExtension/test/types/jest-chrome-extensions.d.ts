// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/**
 * This file extends the jest-chrome types with missing APIs
 */

import "jest-chrome";

// Define a Jest mock type that can be applied to any function
interface JestMockFunction<T extends (...args: any[]) => any> extends Function {
    mockClear(): this;
    mockReset(): this;
    mockImplementation(fn: (...args: Parameters<T>) => ReturnType<T>): this;
    mockImplementationOnce(fn: (...args: Parameters<T>) => ReturnType<T>): this;
    mockReturnValue<T>(value: T): this;
    mockReturnValueOnce<T>(value: T): this;
    mockResolvedValue<T>(value: T): this;
    mockResolvedValueOnce<T>(value: T): this;
    mockRejectedValue(value: Error | any): this;
    mockRejectedValueOnce(value: Error | any): this;
    mock: {
        calls: Parameters<T>[][];
        instances: any[];
        results: { type: string; value: any }[];
        lastCall: Parameters<T>[];
    };
}

// Apply Jest Mock methods to all Chrome API functions
type ChromeJestMock<T> = T extends (...args: infer A) => infer R
    ? JestMockFunction<(...args: A) => R>
    : T extends object
      ? { [K in keyof T]: ChromeJestMock<T[K]> }
      : T;

declare global {
    namespace chrome {
        // Action API (replaced browserAction in Manifest V3)
        namespace action {
            const setBadgeText: ChromeJestMock<
                (details: chrome.action.BadgeTextDetails) => Promise<void>
            >;
            const setBadgeBackgroundColor: ChromeJestMock<
                (
                    details: chrome.action.BadgeBackgroundColorDetails,
                    callback?: () => void,
                ) => Promise<void>
            >;
            const getBadgeText: ChromeJestMock<
                (details: chrome.action.TabDetails) => Promise<string>
            >;

            namespace onClicked {
                const addListener: ChromeJestMock<
                    (callback: (tab: chrome.tabs.Tab) => void) => void
                >;
                const hasListeners: ChromeJestMock<() => boolean>;
                const removeListener: ChromeJestMock<
                    (callback: (tab: chrome.tabs.Tab) => void) => void
                >;
            }
        }

        // SidePanel API (new in Chrome 114)
        namespace sidePanel {
            const open: ChromeJestMock<
                (options?: {
                    tabId?: number;
                    windowId?: number;
                }) => Promise<void>
            >;

            const setOptions: ChromeJestMock<
                (options: chrome.sidePanel.SidePanelOptions) => Promise<void>
            >;

            const getOptions: ChromeJestMock<
                (options?: {
                    tabId?: number;
                }) => Promise<chrome.sidePanel.SidePanelOptions>
            >;

            const setPanelBehavior: ChromeJestMock<
                (options: chrome.sidePanel.PanelBehavior) => Promise<void>
            >;

            interface SidePanelOptions {
                tabId?: number;
                path?: string;
                enabled?: boolean;
            }

            interface PanelBehavior {
                openPanelOnActionClick?: boolean;
            }
        }

        // Scripting API (enhanced in Manifest V3)
        namespace scripting {
            const executeScript: ChromeJestMock<
                (
                    injection: chrome.scripting.ScriptInjection,
                ) => Promise<chrome.scripting.InjectionResult[]>
            >;

            interface InjectionResult {
                frameId: number;
                result: any;
            }

            interface ScriptInjection {
                target: InjectionTarget;
                func?: Function;
                args?: any[];
                files?: string[];
                injectImmediately?: boolean;
            }

            interface InjectionTarget {
                tabId?: number;
                frameIds?: number[];
                allFrames?: boolean;
            }
        }

        // Downloads API
        namespace downloads {
            const download: ChromeJestMock<
                (options: chrome.downloads.DownloadOptions) => Promise<number>
            >;
        }

        // History API
        namespace history {
            const search: ChromeJestMock<
                (
                    query: chrome.history.SearchQuery,
                ) => Promise<chrome.history.HistoryItem[]>
            >;
        }

        // Bookmarks API
        namespace bookmarks {
            const search: ChromeJestMock<
                (
                    query: string | chrome.bookmarks.SearchQuery,
                ) => Promise<chrome.bookmarks.BookmarkTreeNode[]>
            >;
        }

        // Runtime API
        namespace runtime {
            const getURL: ChromeJestMock<(path: string) => string>;
            const getManifest: ChromeJestMock<() => chrome.runtime.Manifest>;
            const sendMessage: ChromeJestMock<
                (
                    message: any,
                    options?: chrome.runtime.MessageOptions,
                ) => Promise<any>
            >;
            const connect: ChromeJestMock<
                (
                    connectInfo?: chrome.runtime.ConnectInfo,
                ) => chrome.runtime.Port
            >;
            const id: string;

            namespace onMessage {
                const addListener: ChromeJestMock<
                    (
                        callback: (
                            message: any,
                            sender: chrome.runtime.MessageSender,
                            sendResponse: (response?: any) => void,
                        ) => void | boolean,
                    ) => void
                >;
                const hasListeners: ChromeJestMock<() => boolean>;
                const removeListener: ChromeJestMock<
                    (
                        callback: (
                            message: any,
                            sender: chrome.runtime.MessageSender,
                            sendResponse: (response?: any) => void,
                        ) => void | boolean,
                    ) => void
                >;
            }

            namespace onInstalled {
                const addListener: ChromeJestMock<
                    (
                        callback: (
                            details: chrome.runtime.InstalledDetails,
                        ) => void,
                    ) => void
                >;
                const hasListeners: ChromeJestMock<() => boolean>;
                const removeListener: ChromeJestMock<
                    (
                        callback: (
                            details: chrome.runtime.InstalledDetails,
                        ) => void,
                    ) => void
                >;
            }

            namespace onStartup {
                const addListener: ChromeJestMock<
                    (callback: () => void) => void
                >;
                const hasListeners: ChromeJestMock<() => boolean>;
                const removeListener: ChromeJestMock<
                    (callback: () => void) => void
                >;
            }

            namespace onConnect {
                const addListener: ChromeJestMock<
                    (callback: (port: chrome.runtime.Port) => void) => void
                >;
                const hasListeners: ChromeJestMock<() => boolean>;
                const removeListener: ChromeJestMock<
                    (callback: (port: chrome.runtime.Port) => void) => void
                >;
            }
        }

        // Search API
        namespace search {
            const query: ChromeJestMock<
                (queryInfo: chrome.search.QueryInfo) => Promise<void>
            >;
        }

        // ContextMenus API
        namespace contextMenus {
            const create: ChromeJestMock<
                (
                    createProperties: chrome.contextMenus.CreateProperties,
                    callback?: () => void,
                ) => string | number
            >;
            const remove: ChromeJestMock<
                (
                    menuItemId: string | number,
                    callback?: () => void,
                ) => Promise<void>
            >;

            namespace onClicked {
                const addListener: ChromeJestMock<
                    (
                        callback: (
                            info: chrome.contextMenus.OnClickData,
                            tab?: chrome.tabs.Tab,
                        ) => void,
                    ) => void
                >;
                const hasListeners: ChromeJestMock<() => boolean>;
                const removeListener: ChromeJestMock<
                    (
                        callback: (
                            info: chrome.contextMenus.OnClickData,
                            tab?: chrome.tabs.Tab,
                        ) => void,
                    ) => void
                >;
            }
        }

        // Tabs API
        namespace tabs {
            const query: ChromeJestMock<
                (queryInfo: chrome.tabs.QueryInfo) => Promise<chrome.tabs.Tab[]>
            >;
            const get: ChromeJestMock<
                (tabId: number) => Promise<chrome.tabs.Tab>
            >;
            const create: ChromeJestMock<
                (
                    createProperties: chrome.tabs.CreateProperties,
                ) => Promise<chrome.tabs.Tab>
            >;
            const update: ChromeJestMock<
                (
                    tabId: number | undefined,
                    updateProperties: chrome.tabs.UpdateProperties,
                ) => Promise<chrome.tabs.Tab | undefined>
            >;
            const remove: ChromeJestMock<
                (tabIds: number | number[]) => Promise<void>
            >;
            const sendMessage: ChromeJestMock<
                (
                    tabId: number,
                    message: any,
                    options?: chrome.tabs.MessageSendOptions,
                ) => Promise<any>
            >;
            const captureVisibleTab: ChromeJestMock<
                (
                    windowId?: number,
                    options?: chrome.tabs.CaptureVisibleTabOptions,
                ) => Promise<string>
            >;
            const getZoom: ChromeJestMock<(tabId?: number) => Promise<number>>;
            const setZoom: ChromeJestMock<
                (tabId?: number, zoomFactor?: number) => Promise<void>
            >;
            const goBack: ChromeJestMock<(tabId?: number) => Promise<void>>;
            const goForward: ChromeJestMock<(tabId?: number) => Promise<void>>;

            namespace onActivated {
                const addListener: ChromeJestMock<
                    (
                        callback: (
                            activeInfo: chrome.tabs.TabActiveInfo,
                        ) => void,
                    ) => void
                >;
                const hasListeners: ChromeJestMock<() => boolean>;
                const removeListener: ChromeJestMock<
                    (
                        callback: (
                            activeInfo: chrome.tabs.TabActiveInfo,
                        ) => void,
                    ) => void
                >;
            }

            namespace onCreated {
                const addListener: ChromeJestMock<
                    (callback: (tab: chrome.tabs.Tab) => void) => void
                >;
                const hasListeners: ChromeJestMock<() => boolean>;
                const removeListener: ChromeJestMock<
                    (callback: (tab: chrome.tabs.Tab) => void) => void
                >;
            }

            namespace onRemoved {
                const addListener: ChromeJestMock<
                    (
                        callback: (
                            tabId: number,
                            removeInfo: chrome.tabs.TabRemoveInfo,
                        ) => void,
                    ) => void
                >;
                const hasListeners: ChromeJestMock<() => boolean>;
                const removeListener: ChromeJestMock<
                    (
                        callback: (
                            tabId: number,
                            removeInfo: chrome.tabs.TabRemoveInfo,
                        ) => void,
                    ) => void
                >;
            }

            namespace onUpdated {
                const addListener: ChromeJestMock<
                    (
                        callback: (
                            tabId: number,
                            changeInfo: chrome.tabs.TabChangeInfo,
                            tab: chrome.tabs.Tab,
                        ) => void,
                    ) => void
                >;
                const hasListeners: ChromeJestMock<() => boolean>;
                const removeListener: ChromeJestMock<
                    (
                        callback: (
                            tabId: number,
                            changeInfo: chrome.tabs.TabChangeInfo,
                            tab: chrome.tabs.Tab,
                        ) => void,
                    ) => void
                >;
            }
        }

        // TTS API
        namespace tts {
            const speak: ChromeJestMock<
                (
                    utterance: string,
                    options?: chrome.tts.TtsOptions,
                    callback?: () => void,
                ) => void
            >;
            const stop: ChromeJestMock<() => void>;
        }

        // WebNavigation API
        namespace webNavigation {
            const getAllFrames: ChromeJestMock<
                (
                    details: chrome.webNavigation.GetAllFrameDetails,
                ) => Promise<chrome.webNavigation.GetAllFrameResultDetails[]>
            >;
        }

        // Windows API
        namespace windows {
            const get: ChromeJestMock<
                (
                    windowId: number,
                    getInfo?: chrome.windows.GetInfo,
                ) => Promise<chrome.windows.Window>
            >;
            const getAll: ChromeJestMock<
                (
                    getInfo?: chrome.windows.GetInfo,
                ) => Promise<chrome.windows.Window[]>
            >;
            const create: ChromeJestMock<
                (
                    createData?: chrome.windows.CreateData,
                ) => Promise<chrome.windows.Window>
            >;
            const update: ChromeJestMock<
                (
                    windowId: number,
                    updateInfo: chrome.windows.UpdateInfo,
                ) => Promise<chrome.windows.Window>
            >;
            const remove: ChromeJestMock<(windowId: number) => Promise<void>>;
            const WINDOW_ID_NONE: number;

            namespace onCreated {
                const addListener: ChromeJestMock<
                    (callback: (window: chrome.windows.Window) => void) => void
                >;
                const hasListeners: ChromeJestMock<() => boolean>;
                const removeListener: ChromeJestMock<
                    (callback: (window: chrome.windows.Window) => void) => void
                >;
            }

            namespace onRemoved {
                const addListener: ChromeJestMock<
                    (callback: (windowId: number) => void) => void
                >;
                const hasListeners: ChromeJestMock<() => boolean>;
                const removeListener: ChromeJestMock<
                    (callback: (windowId: number) => void) => void
                >;
            }

            namespace onFocusChanged {
                const addListener: ChromeJestMock<
                    (callback: (windowId: number) => void) => void
                >;
                const hasListeners: ChromeJestMock<() => boolean>;
                const removeListener: ChromeJestMock<
                    (callback: (windowId: number) => void) => void
                >;
            }
        }

        // Storage API
        namespace storage {
            interface StorageArea {
                get: ChromeJestMock<
                    (
                        keys?: string | string[] | object | null,
                    ) => Promise<{ [key: string]: any }>
                >;
                set: ChromeJestMock<(items: object) => Promise<void>>;
                remove: ChromeJestMock<
                    (keys: string | string[]) => Promise<void>
                >;
                clear: ChromeJestMock<() => Promise<void>>;
            }

            const local: StorageArea;
            const sync: StorageArea;
            const session: StorageArea;

            namespace onChanged {
                const addListener: ChromeJestMock<
                    (
                        callback: (
                            changes: {
                                [key: string]: chrome.storage.StorageChange;
                            },
                            areaName: string,
                        ) => void,
                    ) => void
                >;
                const hasListeners: ChromeJestMock<() => boolean>;
                const removeListener: ChromeJestMock<
                    (
                        callback: (
                            changes: {
                                [key: string]: chrome.storage.StorageChange;
                            },
                            areaName: string,
                        ) => void,
                    ) => void
                >;
            }
        }
    }
}

// Export to ensure module is processed
export {};

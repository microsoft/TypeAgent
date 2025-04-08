// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/// <reference path="../../lib/lib.android.d.ts" />

import {
    ClientAPI,
    NotifyCommands,
    SpeechToken,
    ShellSettingsType,
} from "../../preload/electronTypes.js";
import { ChatView } from "./chatView";
import { TabView } from "./tabView";
import { recognizeOnce } from "./speech";
import { setSpeechToken } from "./speechToken";
import { iconHelp, iconMetrics, iconSettings } from "./icon";
import { SettingsView } from "./settingsView";
import { HelpView } from "./helpView";
import { MetricsView } from "./metricsView";
import { CameraView } from "./cameraView";
import { createWebSocket, webapi, webdispatcher } from "./webSocketAPI";
import * as jose from "jose";
import { AppAgentEvent } from "@typeagent/agent-sdk";
import { ClientIO, Dispatcher } from "agent-dispatcher";
import { swapContent } from "./setContent";

export function getClientAPI(): ClientAPI {
    if (globalThis.api !== undefined) {
        return globalThis.api;
    } else {
        return getWebSocketAPI();
    }
}

export function getDispatcher(): Dispatcher {
    if (globalThis.dispatcher !== undefined) {
        return globalThis.dispatcher;
    }
    return getWebDispatcher();
}

export function getWebSocketAPI(): ClientAPI {
    if (globalThis.webApi === undefined) {
        globalThis.webApi = webapi;

        createWebSocket(true).then((ws) => (globalThis.ws = ws));
    }

    return globalThis.webApi;
}

export function getWebDispatcher(): Dispatcher {
    if (globalThis.webDispatcher === undefined) {
        globalThis.webDispatcher = webdispatcher;
    }

    return globalThis.webDispatcher;
}

function addEvents(
    chatView: ChatView,
    agents: Map<string, string>,
    settingsView: SettingsView,
    tabsView: TabView,
    cameraView: CameraView,
) {
    const clientIO: ClientIO = {
        clear: () => {
            chatView.clear();
        },
        exit: () => {
            window.close();
        },
        setDisplayInfo: (source, requestId, actionIndex, action) => {
            chatView.setDisplayInfo(source, requestId, actionIndex, action);
        },
        setDisplay: (message) => {
            chatView.addAgentMessage(message);
        },
        appendDisplay: (message, mode) => {
            chatView.addAgentMessage(message, { appendMode: mode });
        },
        appendDiagnosticData: (requestId, data) => {
            // TODO: append data instead of replace
            chatView.setActionData(requestId, data);
        },
        setDynamicDisplay: (
            source,
            requestId,
            actionIndex,
            displayId,
            nextRefreshMs,
        ) => {
            chatView.setDynamicDisplay(
                source,
                requestId,
                actionIndex,
                displayId,
                nextRefreshMs,
            );
        },
        askYesNo: async (message, requestId, _defaultValue) => {
            return chatView.askYesNo(message, requestId, "");
        },
        proposeAction: async (actionTemplates, requestId, source) => {
            return chatView.proposeAction(actionTemplates, requestId, source);
        },
        notify: (event, requestId, data, source) => {
            switch (event) {
                case "explained":
                    chatView.notifyExplained(requestId, data);
                    break;
                case "randomCommandSelected":
                    chatView.randomCommandSelected(requestId, data.message);
                    break;
                case "showNotifications":
                    switch (data) {
                        case NotifyCommands.Clear:
                            notifications.length = 0;
                            break;
                        case NotifyCommands.ShowAll:
                            showNotifications(
                                requestId,
                                chatView,
                                notifications,
                                true,
                            );
                            break;
                        case NotifyCommands.ShowSummary:
                            summarizeNotifications(
                                requestId,
                                chatView,
                                notifications,
                            );
                            break;
                        case NotifyCommands.ShowUnread:
                            showNotifications(
                                requestId,
                                chatView,
                                notifications,
                            );
                            break;
                        default:
                            console.log("unknown notify command");
                            break;
                    }
                    break;
                case AppAgentEvent.Error:
                case AppAgentEvent.Warning:
                case AppAgentEvent.Info:
                    notifications.push({
                        event,
                        source,
                        data,
                        read: false,
                        requestId,
                    });
                    break;
                default:
                // ignore
            }
        },
        takeAction: (action, data) => {
            // Android object gets injected on Android devices, otherwise unavailable
            try {
                console.log(`Take Action '${action}' Data: ${data}`);
                let d: any = data;
                switch (action) {
                    case "show-camera": {
                        cameraView.show();
                        break;
                    }
                    case "set-alarm": {
                        Android?.setAlarm(d.time);
                        break;
                    }
                    case "call-phonenumber": {
                        Android?.callPhoneNumber(d.phoneNumber);
                        break;
                    }
                    case "send-sms": {
                        Android?.sendSMS(d.phoneNumber, d.message);
                        break;
                    }
                    case "search-nearby": {
                        Android?.searchNearby(d.searchTerm);
                        break;
                    }
                    case "automate-phone-ui": {
                        Android.automateUI(d.originalRequest);
                    }
                }
            } catch (e) {
                console.log(e);
            }
        },
    };

    const api = getClientAPI();
    api.registerClientIO(clientIO);

    api.onListenEvent((_, name, token, useLocalWhisper) => {
        console.log(`listen event: ${name}`);
        if (useLocalWhisper) {
            recognizeOnce(
                undefined,
                "phraseDiv",
                "reco",
                (message: string) => {
                    chatView.addUserMessage(message);
                },
                useLocalWhisper,
            );
        } else {
            if (token) {
                setSpeechToken(token);
                if (name === "Alt+M") {
                    recognizeOnce(
                        token,
                        "phraseDiv",
                        "reco",
                        (message: string) => {
                            chatView.addUserMessage(message);
                        },
                        useLocalWhisper,
                    );
                }
            } else {
                console.log("no token");
            }
        }
    });
    api.onSettingSummaryChanged((_, __, registeredAgents) => {
        agents.clear();
        for (let key of registeredAgents.keys()) {
            agents.set(key, registeredAgents.get(key) as string);
        }
    });
    api.onSendInputText((_, message) => {
        chatView.showInputText(message);
    });
    api.onSendDemoEvent((_, name) => {
        (window as any).electron.ipcRenderer.send("send-demo-event", name);
    });
    api.onHelpRequested((_, key) => {
        console.log(`User asked for help via ${key}`);
        chatView.addUserMessage(`@help`);
    });
    api.onShowDialog((_, key) => {
        if (key.toLocaleLowerCase() == "settings") {
            tabsView.showTab(key);
        }

        tabsView.showTab(key);
    });
    api.onSettingsChanged((_, value: ShellSettingsType) => {
        settingsView.shellSettings = value;
    });
    api.onChatHistory((_, history: string) => {
        if (settingsView.shellSettings.chatHistory) {
            // load the history
            chatView.getScrollContainer().innerHTML = history;

            // add the separator
            if (history.length > 0) {
                // don't add a separator if there's already one there
                if (
                    !chatView
                        .getScrollContainer()
                        .children[0].classList.contains("chat-separator")
                ) {
                    let separator: HTMLDivElement =
                        document.createElement("div");
                    separator.classList.add("chat-separator");
                    separator.innerHTML =
                        '<div class="chat-separator-line"></div><div class="chat-separator-text">previously</div><div class="chat-separator-line"></div>';

                    chatView.getScrollContainer().prepend(separator);
                }

                // make all old messages "inactive" and set the context for each separator
                let lastSeparatorText: HTMLDivElement | null;
                for (
                    let i = 0;
                    i < chatView.getScrollContainer().children.length;
                    i++
                ) {
                    // gray out this item
                    const div = chatView.getScrollContainer().children[i];
                    div.classList.add("history");

                    // is this a separator?
                    const separator = div.querySelector(".chat-separator-text");
                    if (separator != null) {
                        lastSeparatorText = div.querySelector(
                            ".chat-separator-text",
                        );
                    }

                    // get the timestamp for this chat bubble (if applicable)
                    const span: HTMLSpanElement | null =
                        div.querySelector(".timestring");

                    if (span !== null) {
                        const timeStamp: Date = new Date(
                            span.attributes["data"].value,
                        );
                        lastSeparatorText!.innerText =
                            getDateDifferenceDescription(new Date(), timeStamp);
                    }

                    // rewire up action-data click handler
                    const nameDiv = div.querySelector(".agent-name.clickable");
                    if (nameDiv != null) {
                        const messageDiv = div.querySelector(
                            ".chat-message-content",
                        );

                        if (messageDiv) {
                            nameDiv.addEventListener("click", () => {
                                swapContent(
                                    nameDiv as HTMLSpanElement,
                                    messageDiv as HTMLDivElement,
                                );
                            });
                        }
                    }

                    // TODO: wire up any other functionality (player agent?)
                }
            }
        }
    });
    api.onFileSelected((_, fileName: string, fileContent: string) => {
        chatView.chatInput.loadImageContent(fileName, fileContent);
    });
}

function showNotifications(
    requestId: string,
    chatView: ChatView,
    messages: Array<any>,
    showRead: boolean = false,
) {
    const status: string = showRead ? "all" : "the new";
    let html: string = `Here are ${status} notifications:<br/> <ul>`;

    for (let i = 0; i < messages.length; i++) {
        if (showRead || !messages[i].read) {
            html += `<li class="notification-${messages[i].event}">${messages[i].event} ${messages[i].data.toString()}</li>`;

            messages[i].read = true;
        }
    }

    html += "</ul><br/>";
    console.log(requestId + chatView);

    chatView.addAgentMessage(
        {
            message: { type: "html", content: html },
            source: "shell.showNotifications",
            requestId: requestId,
        },
        { notification: true },
    );
}

function summarizeNotifications(
    requestId: string,
    chatView: ChatView,
    messages: Array<any>,
) {
    const msgMap: Map<AppAgentEvent, number> = new Map<AppAgentEvent, number>();

    let read: number = 0;

    for (let i = 0; i < messages.length; i++) {
        if (!msgMap.has(messages[i].event)) {
            msgMap.set(messages[i].event, 0);
        }

        msgMap.set(messages[i].event, msgMap.get(messages[i].event)! + 1);

        if (messages[i].read) {
            read++;
        }
    }

    let summary = `There are <b>${messages.length - read}</b> unread and <b>${read}</b> notifications in total.<br/><br/>
    <div style="display: flex;justify-content: space-evenly">`;
    for (const [key, value] of msgMap) {
        summary += `<span class="notification-${key}">${key}:</span> <b>${value}</b>`;
    }
    summary += `</div><br/><span style="font-size: 10px">Run @notify show [all | unread] so see notifications.</span>`;

    chatView.addAgentMessage({
        message: {
            type: "html",
            content: summary,
        },
        requestId: requestId,
        source: "shell.notificationSummary",
    });
}

const notifications = new Array();

export class IdGenerator {
    private count = 0;
    public genId() {
        return `cmd-${this.count++}`;
    }
}

document.addEventListener("DOMContentLoaded", async function () {
    const wrapper = document.getElementById("wrapper")!;
    const idGenerator = new IdGenerator();
    const agents = new Map<string, string>();

    const tabs = new TabView(
        ["Settings", "Metrics", "Help"],
        [iconSettings(), iconMetrics(), iconHelp()],
        [iconSettings(), iconMetrics(), iconHelp()],
    );
    wrapper.appendChild(tabs.getContainer());

    document.onkeyup = (ev: KeyboardEvent) => {
        if (ev.key == "Escape") {
            tabs.closeTabs();
            ev.preventDefault();
        }
    };

    const chatView = new ChatView(idGenerator, agents);
    const cameraView = new CameraView((image: HTMLImageElement) => {
        // copy image
        const newImage: HTMLImageElement = document.createElement("img");
        newImage.src = image.src;

        newImage.classList.add("chat-input-dropImage");
        chatView.chatInput.textarea.getTextEntry().append(newImage);

        if (chatView.chatInput.sendButton !== undefined) {
            chatView.chatInput.sendButton.disabled =
                chatView.chatInput.textarea.getTextEntry().innerHTML.length ==
                0;
        }
    });

    wrapper.appendChild(cameraView.getContainer());
    wrapper.appendChild(chatView.getMessageElm());

    chatView.chatInput.camButton.onclick = () => {
        cameraView.toggleVisibility();
    };

    chatView.chatInput.attachButton.onclick = () => {
        if ((window as any).electron) {
            (window as any).electron.ipcRenderer.send("open-image-file");
        }
    };

    const settingsView = new SettingsView(chatView);
    chatView.settingsView = settingsView;
    tabs.getTabContainerByName("Settings").append(settingsView.getContainer());
    tabs.getTabContainerByName("Metrics").append(
        new MetricsView().getContainer(),
    );
    tabs.getTabContainerByName("Help").append(new HelpView().getContainer());

    addEvents(chatView, agents, settingsView, tabs, cameraView);

    chatView.chatInputFocus();

    try {
        if (Android !== undefined) {
            Bridge.interfaces.Android.domReady((userMessage: string) => {
                chatView.addUserMessage(userMessage);
            });
        }
    } catch (e) {
        console.log(e);
    }

    // get the users's name to show in the chat view
    let token: SpeechToken | undefined = await getClientAPI().getSpeechToken();
    const actualToken = token?.token.substring(token?.token.indexOf("#"));
    if (actualToken) {
        const decoded = jose.decodeJwt(actualToken);

        if (decoded.given_name) {
            chatView.userGivenName = decoded.given_name
                .toString()
                .toLocaleLowerCase();
        }
    }

    watchForDOMChanges(chatView.getScrollContainer());

    if ((window as any).electron) {
        (window as any).electron.ipcRenderer.send("dom ready");
    }
});

function watchForDOMChanges(element: HTMLDivElement) {
    // ignore attribute changes but watch for
    const config = { attributes: false, childList: true, subtree: true };

    // timeout
    let idleCounter: number = 0;

    // observer callback
    const observer = new MutationObserver(() => {
        // increment the idle counter
        idleCounter++;

        // decrement the idle counter
        setTimeout(() => {
            if (--idleCounter == 0) {
                // last one notifies main process
                if ((window as any).electron) {
                    (window as any).electron.ipcRenderer.send(
                        "dom changed",
                        element.innerHTML,
                    );
                }
            }
        }, 3000);
    });

    // start observing
    observer.observe(element!, config);

    // observer.disconnect();
}

function getDateDifferenceDescription(date1: Date, date2: Date): string {
    const diff = Math.abs(date1.getTime() - date2.getTime());
    const diffMinutes = Math.floor(diff / (1000 * 60));
    const diffHours = Math.floor(diff / (1000 * 60 * 60));
    const diffDays = Math.floor(diff / (1000 * 60 * 60 * 24));
    const diffWeeks = Math.floor(diff / (1000 * 60 * 60 * 24 * 7));
    const diffMonths = Math.floor(diff / (1000 * 60 * 60 * 24 * 30));
    const diffYears = Math.floor(diff / (1000 * 60 * 60 * 24 * 365));

    if (diffMinutes < 1) {
        return "just now";
    } else if (diffMinutes < 15) {
        return "a few minutes ago";
    } else if (diffMinutes < 60) {
        return "under an hour ago";
    } else if (diffHours < 2) {
        return "an hour ago";
    } else if (diffDays < 1) {
        return "earlier today";
    } else if (diffDays < 2) {
        return "yesterday";
    } else if (diffDays < 7) {
        return date1.toLocaleDateString("en-US", { weekday: "long" });
    } else if (diffWeeks < 2) {
        return "last week";
    } else if (diffMonths < 2) {
        return "last month";
    } else if (diffYears < 2) {
        return "last year";
    } else {
        return date1.toLocaleDateString("en-US", { weekday: "long" });
    }
}

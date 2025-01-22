// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/// <reference path="../../lib/lib.android.d.ts" />

import {
    ClientAPI,
    NotifyCommands,
    SpeechToken,
} from "../../preload/electronTypes";
import { ChatView } from "./chatView";
import { TabView } from "./tabView";
import { recognizeOnce } from "./speech";
import { setSpeechToken } from "./speechToken";
import { iconHelp, iconMetrics, iconSettings } from "./icon";
import { SettingsView } from "./settingsView";
import { HelpView } from "./helpView";
import { MetricsView } from "./metricsView";
import { ShellSettings } from "../../main/shellSettings";
import { CameraView } from "./cameraView";
import { createWebSocket, webapi, webdispatcher } from "./webSocketAPI";
import * as jose from "jose";
import { AppAgentEvent } from "@typeagent/agent-sdk";
import { ClientIO, Dispatcher } from "agent-dispatcher";

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
    api.onSettingSummaryChanged((_, summary, registeredAgents) => {
        document.title = summary;
        document.title += ` Zoom: ${settingsView.shellSettings.zoomLevel * 100}%`;

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
    api.onSettingsChanged((_, value: ShellSettings) => {
        let newTitle = document.title.substring(
            0,
            document.title.indexOf("Zoom: "),
        );

        document.title = `${newTitle} Zoom: ${value.zoomLevel * 100}%`;

        settingsView.shellSettings = value;
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

    if ((window as any).electron) {
        (window as any).electron.ipcRenderer.send("dom ready");
    }
});

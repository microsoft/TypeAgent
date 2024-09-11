// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

//import { ShellSettings } from "../../main/shellSettings";
import { ClientAPI, NotifyCommands } from "../../preload/electronTypes";
import { ChatView } from "./chatView";
import { TabView } from "./tabView";
import { recognizeOnce } from "./speech";
import { setSpeechToken } from "./speechToken";
import { iconHelp, iconMetrics, iconSettings } from "./icon";
import { SettingsView } from "./settingsView";
import { HelpView } from "./helpView";
import { MetricsView } from "./metricsView";
import { ShellSettings } from "../../main/shellSettings";
import { AppAgentEvent } from "@typeagent/agent-sdk";
import { CameraView } from "./cameraView";

export function getClientAPI(): ClientAPI {
    return globalThis.api;
}

function addEvents(
    chatView: ChatView,
    agents: Map<string, string>,
    settingsView: SettingsView,
    tabsView: TabView,
) {
    console.log("add listen event");
    const api = getClientAPI();
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
    api.onResponse((_, agentMessage) => {
        chatView.addAgentMessage(agentMessage);
    });
    api.onSetDynamicActionDisplay(
        (_, source, id, actionIndex, displayId, nextRefreshMs) =>
            chatView.setDynamicDisplay(
                source,
                id,
                actionIndex,
                displayId,
                nextRefreshMs,
            ),
    );
    api.onSetPartialInputHandler((_, enabled) => {
        chatView.enablePartialInputHandler(enabled);
    });
    api.onActionCommand((_, actionTemplates, command, requestId) => {
        chatView.actionCommand(actionTemplates, command, requestId);
    });
    api.onSearchMenuCommand((_, menuId, command, prefix, choices, visible) => {
        chatView.searchMenuCommand(menuId, command, prefix, choices, visible);
    });
    api.onClear((_) => {
        chatView.clear();
    });
    api.onStatusMessage((_, message, temporary) => {
        chatView.showStatusMessage(message, temporary);
    });
    api.onMarkRequestExplained((_, id, timestamp, fromCache) => {
        chatView.markRequestExplained(id, timestamp, fromCache);
    });
    api.onRandomCommandSelected((_, id, message) => {
        chatView.randomCommandSelected(id, message);
    });
    api.onAskYesNo(async (_, askYesNoId, message, id, source) => {
        chatView.askYesNo(askYesNoId, message, id, source);
    });
    api.onQuestion(async (_, questionId, message, id, source) => {
        chatView.question(questionId, message, id, source);
    });
    api.onSettingSummaryChanged((_, summary, registeredAgents) => {
        document.title = summary;

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
    api.onRandomMessageRequested((_, key) => {
        console.log(`User asked for a random message via ${key}`);
        chatView.addUserMessage(`@random`);
    });
    api.onShowDialog((_, key) => {
        if (key == "Settings") {
            settingsView.showTabs();
        }

        tabsView.showTab(key);
    });
    api.onSettingsChanged((_, value: ShellSettings) => {
        console.log("Settings Updated\n" + value);
        settingsView.shellSettings = value;
    });
    api.onNotificationCommand((_, requestId: string, data: any) => {
        switch (data) {
            case NotifyCommands.Clear:
                notifications.length = 0;
                break;
            case NotifyCommands.ShowAll:
                showNotifications(requestId, chatView, notifications, true);
                break;
            case NotifyCommands.ShowSummary:
                summarizeNotifications(
                    requestId,
                    chatView,
                    agents,
                    notifications,
                );
                break;
            case NotifyCommands.ShowUnread:
                showNotifications(requestId, chatView, notifications);
                break;
            default:
                console.log("unknown notify command");
                break;
        }
    });
    api.onNotify(
        (
            _,
            event: AppAgentEvent,
            requestId: string,
            source: string,
            data: any,
        ) => {
            //if (settingsView.shellSettings.notifyFilter.indexOf(event) > -1) {
            //    showNotifications(requestId, chatView, [ { event, source, data, read: false  } ]);
            //} else {
            notifications.push({ event, source, data, read: false, requestId });
            //}
        },
    );
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
            message: html,
            source: "shell",
            requestId: requestId,
        },
        false,
        true,
    );
}

function summarizeNotifications(
    requestId: string,
    chatView: ChatView,
    agents: Map<string, string>,
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
        message: summary,
        requestId: requestId,
        source: agents.get("shell")!,
    });
}

const notifications = new Array();

export class IdGenerator {
    private count = 0;
    public genId() {
        return `cmd-${this.count++}`;
    }
}

document.addEventListener("DOMContentLoaded", function () {
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
        image.classList.add("chat-inpput-dropImage");
        chatView.chatInput.textarea.textEntry.append(image);
    });

    wrapper.appendChild(cameraView.getContainer());
    wrapper.appendChild(chatView.getMessageElm());

    chatView.chatInput.camButton.onclick = () => {
        cameraView.toggleVisibility();
    };

    chatView.chatInput.camButton.onclick = () => {
        cameraView.toggleVisibility();
    };

    const settingsView = new SettingsView(tabs, chatView);
    tabs.getTabContainerByName("Settings").append(settingsView.getContainer());
    tabs.getTabContainerByName("Metrics").append(
        new MetricsView().getContainer(),
    );
    tabs.getTabContainerByName("Help").append(new HelpView().getContainer());

    addEvents(chatView, agents, settingsView, tabs);

    chatView.chatInputFocus();

    (window as any).electron.ipcRenderer.send("dom ready");
});

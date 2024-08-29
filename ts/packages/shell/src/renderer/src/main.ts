// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

//import { ShellSettings } from "../../main/shellSettings";
import { ClientAPI } from "../../preload/electronTypes";
import { ChatView } from "./chatView";
import { TabView } from "./tabView";
import { SpeechInfo, recognizeOnce, selectMicrophone } from "./speech";
import { iconHelp, iconMetrics, iconSettings } from "./icon";
import { SettingsView } from "./settingsView";
import { HelpView } from "./helpView";
import { MetricsView } from "./metricsView";

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
                chatView.speechInfo.speechToken = token;
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
    api.onResponse((_, response, id, source: string, actionIndex?: number) => {
        if (response !== undefined) {
            chatView.addAgentMessage(response, id, source, actionIndex);
        }
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
    api.onStatusMessage((_, message, id, source: string, temporary) => {
        chatView.showStatusMessage(message, id, source, temporary);
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
    api.onMicrophoneChangeRequested((_, micId, micName) => {
        selectMicrophone(settingsView.microphoneSources, micId, micName);
    });
    api.onShowDialog((_, key) => {
        tabsView.showTab(key);
    });
}

export class IdGenerator {
    private count = 0;
    public genId() {
        return `cmd-${this.count++}`;
    }
}

document.addEventListener("DOMContentLoaded", function () {
    const wrapper = document.getElementById("wrapper")!;
    const idGenerator = new IdGenerator();
    const speechInfo = new SpeechInfo();
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

    const chatView = new ChatView(idGenerator, speechInfo, agents);
    wrapper.appendChild(chatView.getMessageElm());

    const settingsView = new SettingsView();
    tabs.getTabContainerByName("Settings").append(settingsView.getContainer());
    tabs.getTabContainerByName("Metrics").append(
        new MetricsView().getContainer(),
    );
    tabs.getTabContainerByName("Help").append(new HelpView().getContainer());

    addEvents(chatView, agents, settingsView, tabs);
    (window as any).electron.ipcRenderer.send("dom ready");
});

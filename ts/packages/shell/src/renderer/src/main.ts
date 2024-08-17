// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { ClientAPI } from "../../preload/electronTypes";
import { ChatView } from "./chatView";
import { SpeechInfo, enumerateMicrophones, recognizeOnce } from "./speech";

export function getClientAPI(): ClientAPI {
    return globalThis.api;
}

function addEvents(chatView: ChatView) {
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
    api.onResponse(
        (_, response, id, actionIndex?: number, groupId?: string) => {
            if (response !== undefined) {
                chatView.addAgentMessage(response, id, actionIndex, groupId);
            }
        },
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
    api.onUpdate((_, updateMessage: string, groupId: string) => {
        if (updateMessage !== undefined) {
            chatView.updateGroup(updateMessage, groupId);
        }
    });
    api.onStatusMessage((_, message, id, temporary) => {
        chatView.showStatusMessage(message, id, temporary);
    });
    api.onMarkRequestExplained((_, id, timestamp, fromCache) => {
        chatView.markRequestExplained(id, timestamp, fromCache);
    });
    api.onRandomCommandSelected((_, id, message) => {
        chatView.randomCommandSelected(id, message);
    });
    api.onAskYesNo(async (_, askYesNoId, message, id) => {
        chatView.askYesNo(askYesNoId, message, id);
    });
    api.onQuestion(async (_, questionId, message, id) => {
        chatView.question(questionId, message, id);
    });
    api.onSettingSummaryChanged((_, summary) => {
        document.title = summary;
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
    const chatView = new ChatView(idGenerator, speechInfo);
    wrapper.appendChild(chatView.getMessageElm());
    const microphoneSources = document.getElementById(
        "microphoneSources",
    )! as HTMLSelectElement;

    enumerateMicrophones(microphoneSources);
    addEvents(chatView);
    (window as any).electron.ipcRenderer.send("dom ready");
});

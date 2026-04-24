// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/// <reference path="../../lib/lib.android.d.ts" />

import {
    ClientAPI,
    NotifyCommands,
    SpeechToken,
    ShellUserSettings,
    Client,
    SearchMenuItem,
    UserExpression,
} from "../../preload/electronTypes";
import { ChatView } from "./chat/chatView";
import { TabView } from "./tabView";
import { getSpeechToken, setSpeechToken } from "./speechToken";
import { iconHelp, iconMetrics, iconSettings } from "./icon";
import { SettingsView } from "./settingsView";
import { HelpView } from "./helpView";
import { MetricsView } from "./chat/metricsView";
import { CameraView } from "./cameraView";
import { createWebSocket, webapi } from "./webSocketAPI";
import * as jose from "jose";
import { AppAgentEvent } from "@typeagent/agent-sdk";
import {
    ClientIO,
    Dispatcher,
    PendingInteractionRequest,
    PendingInteractionResponse,
    RequestId,
} from "agent-dispatcher";
import { swapContent } from "./setContent";
import { remoteSearchMenuUIOnCompletion } from "./searchMenuUI/remoteSearchMenuUI";
import { ChatInput } from "./chat/chatInput";
import { escapeHtml } from "./chat/conversationCommands";

export function isElectron(): boolean {
    return globalThis.api !== undefined;
}

export function getClientAPI(): ClientAPI {
    if (globalThis.api !== undefined) {
        return globalThis.api;
    } else {
        return getWebSocketAPI();
    }
}

export function getAndroidAPI() {
    return globalThis.Android;
}

function getWebSocketAPI(): ClientAPI {
    if (globalThis.webApi === undefined) {
        globalThis.webApi = webapi;

        createWebSocket(true).then((ws) => (globalThis.ws = ws));
    }

    return globalThis.webApi;
}

async function initializeChatHistory(chatView: ChatView) {
    const result = await getClientAPI().getChatHistory();
    if (result === undefined) {
        return;
    }
    const { html: history, seq } = result;
    maxSeqSeen = seq;

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
            let separator: HTMLDivElement = document.createElement("div");
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
                lastSeparatorText = div.querySelector(".chat-separator-text");
            }

            // get the timestamp for this chat bubble (if applicable)
            const span: HTMLSpanElement | null =
                div.querySelector(".timestring");

            if (span !== null) {
                const timeStamp: Date = new Date(span.attributes["data"].value);
                lastSeparatorText!.innerText = getDateDifferenceDescription(
                    new Date(),
                    timeStamp,
                );
            }

            // rewire up action-data click handler
            const nameDiv = div.querySelector(".agent-name.clickable");
            if (nameDiv != null) {
                const messageDiv = div.querySelector(".chat-message-content");

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

function registerClient(
    chatView: ChatView,
    agents: Map<string, string>,
    settingsView: SettingsView,
    tabsView: TabView,
    cameraView: CameraView,
    chatHistoryReady: Promise<void>,
) {
    // Dispatcher reference set in dispatcherInitialized; needed for
    // respondToInteraction calls from deferred interaction handlers.
    let dispatcher: Dispatcher | undefined;

    // Track pending deferred interactions so they can be dismissed when
    // resolved or cancelled by another client / timeout.
    const pendingInteractions = new Map<string, () => void>();

    const clientIO: ClientIO = {
        clear: () => {
            chatView.clear();
        },
        exit: () => {
            window.close();
        },
        shutdown: () => {
            window.close();
        },
        setUserRequest: (requestId, command, seq?) => {
            if (seq !== undefined) {
                maxSeqSeen = Math.max(maxSeqSeen, seq);
            }
            chatView.setActiveRequestId(requestId.requestId);
            // For remote clients or replay, creates a new MessageGroup
            // keyed by UUID. For local clients, this is a no-op because
            // addRemoteUserMessage skips pending locals — they get promoted
            // lazily by getMessageGroup when the first output arrives.
            chatView.addRemoteUserMessage(requestId, command);
        },
        setDisplayInfo: (requestId, source, actionIndex, action, seq?) => {
            if (seq !== undefined) {
                maxSeqSeen = Math.max(maxSeqSeen, seq);
            }
            chatView.setDisplayInfo(requestId, source, actionIndex, action);
        },
        setDisplay: (message, seq?) => {
            if (seq !== undefined) {
                maxSeqSeen = Math.max(maxSeqSeen, seq);
            }
            chatView.addAgentMessage(message);
        },
        appendDisplay: (message, mode, seq?) => {
            if (seq !== undefined) {
                maxSeqSeen = Math.max(maxSeqSeen, seq);
            }
            chatView.addAgentMessage(message, { appendMode: mode });
        },
        appendDiagnosticData: (requestId, data) => {
            chatView.appendDiagnosticData(requestId, data);
        },
        setDynamicDisplay: (
            requestId,
            source,
            actionIndex,
            displayId,
            nextRefreshMs,
        ) => {
            chatView.setDynamicDisplay(
                requestId,
                source,
                actionIndex,
                displayId,
                nextRefreshMs,
            );
        },
        question: async (requestId, message, choices) => {
            // For binary Yes/No with a known requestId, delegate to the existing chatView UI.
            if (
                requestId !== undefined &&
                choices.length === 2 &&
                choices[0] === "Yes" &&
                choices[1] === "No"
            ) {
                const yes = await chatView.askYesNo(requestId, message, "");
                return yes ? 0 : 1;
            }
            // General multi-choice and broadcast (no requestId) are not yet implemented
            // in the Shell renderer — the main process handles those via dialog.showMessageBox.
            throw new Error(
                "Main process should have handled multi-choice question",
            );
        },
        requestChoice: (
            requestId,
            choiceId,
            type,
            message,
            choices,
            source,
        ) => {
            chatView.showChoice(
                requestId,
                choiceId,
                type,
                message,
                choices,
                source,
            );
        },
        proposeAction: async (requestId, actionTemplates, source) => {
            return chatView.proposeAction(requestId, actionTemplates, source);
        },
        notify: (requestId, event, data, source, seq?) => {
            if (seq !== undefined) {
                maxSeqSeen = Math.max(maxSeqSeen, seq);
            }
            switch (event) {
                case "explained":
                    chatView.notifyExplained(requestId, data);
                    break;
                case "randomCommandSelected":
                    chatView.randomCommandSelected(requestId, data.message);
                    break;
                case "grammarRule":
                    // Update roadrunner color based on grammar result.
                    // Grammar details are diagnostic-only — accessible via
                    // the clickable label, not displayed inline.
                    chatView.updateGrammarResult(
                        requestId,
                        data.success,
                        data.message,
                    );
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

                // Display-focused events - for now show toast notification inline
                // TODO: Design for toast notifications in shell
                case AppAgentEvent.Inline:
                case AppAgentEvent.Toast:
                    chatView.addNotificationMessage(data, source, requestId);
                    // Also add to notifications list for @notify show
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
        openLocalView: async () => {
            throw new Error("Main process should have handled openLocalView");
        },
        closeLocalView: async () => {
            throw new Error("Main process should have handled closeLocalView");
        },
        requestInteraction: (interaction: PendingInteractionRequest) => {
            if (!dispatcher) {
                console.warn(
                    "requestInteraction: dispatcher not yet initialized",
                );
                return;
            }

            const interactionId = interaction.interactionId;

            // Cancellation mechanism: race the UI promise against a
            // locally-controlled cancellation promise.
            let cancelReject: (() => void) | undefined;
            const cancelPromise = new Promise<never>((_, reject) => {
                cancelReject = () => reject(new Error("interaction dismissed"));
            });
            // Prevent unhandled rejection if cancellation fires after the UI
            // promise wins the race.
            cancelPromise.catch(() => {});
            pendingInteractions.set(interactionId, cancelReject!);

            const handle = async () => {
                try {
                    let response: PendingInteractionResponse;

                    if (interaction.type === "question") {
                        const { message, choices } = interaction;
                        const requestId =
                            interaction.requestId ??
                            (`pending-${interactionId}` as unknown as RequestId);
                        const source = interaction.source;

                        if (
                            choices.length === 2 &&
                            choices[0] === "Yes" &&
                            choices[1] === "No"
                        ) {
                            const yes = await Promise.race([
                                chatView.askYesNo(requestId, message, source),
                                cancelPromise,
                            ]);
                            response = {
                                interactionId,
                                type: "question",
                                value: yes ? 0 : 1,
                            };
                        } else {
                            // TODO: implement general multi-choice UI;
                            // falling back to default for now.
                            console.warn(
                                `requestInteraction: multi-choice questions not yet supported in Shell (${choices.length} choices)`,
                            );
                            return;
                        }
                    } else if (interaction.type === "proposeAction") {
                        const requestId =
                            interaction.requestId ??
                            (`pending-${interactionId}` as unknown as RequestId);
                        const result = await Promise.race([
                            chatView.proposeAction(
                                requestId,
                                interaction.actionTemplates,
                                interaction.source,
                            ),
                            cancelPromise,
                        ]);
                        response = {
                            interactionId,
                            type: "proposeAction",
                            value: result,
                        };
                    } else {
                        console.warn(`requestInteraction: unknown type`);
                        return;
                    }

                    await dispatcher!.respondToInteraction(response);
                } catch (e: unknown) {
                    // Only swallow dismissal errors; log unexpected failures.
                    if (
                        !(e instanceof Error) ||
                        e.message !== "interaction dismissed"
                    ) {
                        console.error(
                            "requestInteraction: unexpected error",
                            e,
                        );
                    }
                } finally {
                    pendingInteractions.delete(interactionId);
                }
            };

            handle();
        },
        interactionResolved: (interactionId: string) => {
            const cancel = pendingInteractions.get(interactionId);
            if (cancel) {
                cancel();
                pendingInteractions.delete(interactionId);
            }
        },
        interactionCancelled: (interactionId: string) => {
            const cancel = pendingInteractions.get(interactionId);
            if (cancel) {
                cancel();
                pendingInteractions.delete(interactionId);
            }
        },
        takeAction: (_, action, data) => {
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
                        getAndroidAPI()?.setAlarm(d.time);
                        break;
                    }
                    case "call-phonenumber": {
                        getAndroidAPI()?.callPhoneNumber(d.phoneNumber);
                        break;
                    }
                    case "send-sms": {
                        getAndroidAPI()?.sendSMS(d.phoneNumber, d.message);
                        break;
                    }
                    case "search-nearby": {
                        getAndroidAPI()?.searchNearby(d.searchTerm);
                        break;
                    }
                    case "automate-phone-ui": {
                        getAndroidAPI()?.automateUI(d.originalRequest);
                        break;
                    }
                    case "open-folder": {
                        getClientAPI().openFolder(data as string);
                        break;
                    }
                    case "manage-conversation": {
                        const payload = d as {
                            subcommand: string;
                            name?: string;
                            newName?: string;
                        };
                        const api = getClientAPI();
                        (async () => {
                            switch (payload.subcommand) {
                                case "new": {
                                    if (!payload.name) {
                                        // TODO: prompt the user for a name inline instead of warning,
                                        // so that NL "create a new conversation" works end-to-end.
                                        chatView.addNotificationMessage(
                                            {
                                                type: "html",
                                                content:
                                                    "A name is required to create a new conversation.",
                                                kind: "warning",
                                            },
                                            "conversation",
                                            undefined,
                                        );
                                        break;
                                    }
                                    const created =
                                        await api.conversationCreate(
                                            payload.name,
                                        );
                                    const switchResult =
                                        await api.conversationSwitch(
                                            created.conversationId,
                                        );
                                    const msg = switchResult.success
                                        ? `✅ Created and switched to conversation "<b>${escapeHtml(created.name)}</b>"`
                                        : `✅ Created conversation "<b>${escapeHtml(created.name)}</b>" but could not switch: ${escapeHtml(switchResult.error ?? "unknown error")}`;
                                    chatView.addNotificationMessage(
                                        {
                                            type: "html",
                                            content: msg,
                                            kind: "info",
                                        },
                                        "conversation",
                                        undefined,
                                    );
                                    break;
                                }
                                case "list": {
                                    const sessions =
                                        await api.conversationList();
                                    const current =
                                        await api.conversationGetCurrent();
                                    let html: string;
                                    if (sessions.length === 0) {
                                        html = "No conversations found.";
                                    } else {
                                        const lines = sessions.map((s) => {
                                            const isCurrent =
                                                current &&
                                                s.conversationId ===
                                                    current.conversationId;
                                            const marker = isCurrent
                                                ? " ← <b>current</b>"
                                                : "";
                                            const date = new Date(
                                                s.createdAt,
                                            ).toLocaleDateString();
                                            return `• <b>${escapeHtml(s.name)}</b> (${escapeHtml(s.conversationId)}) — ${s.clientCount} client(s), created ${date}${marker}`;
                                        });
                                        html = `<b>Conversations (${sessions.length})</b><br>${lines.join("<br>")}`;
                                    }
                                    chatView.addNotificationMessage(
                                        {
                                            type: "html",
                                            content: html,
                                            kind: "info",
                                        },
                                        "conversation",
                                        undefined,
                                    );
                                    break;
                                }
                                case "info": {
                                    const cur =
                                        await api.conversationGetCurrent();
                                    const html = cur
                                        ? `Current conversation: <b>${escapeHtml(cur.name)}</b> (${escapeHtml(cur.conversationId)})`
                                        : "No active conversation.";
                                    chatView.addNotificationMessage(
                                        {
                                            type: "html",
                                            content: html,
                                            kind: "info",
                                        },
                                        "conversation",
                                        undefined,
                                    );
                                    break;
                                }
                                case "switch": {
                                    if (!payload.name) {
                                        chatView.addNotificationMessage(
                                            {
                                                type: "html",
                                                content:
                                                    "A conversation name is required to switch.",
                                                kind: "warning",
                                            },
                                            "conversation",
                                            undefined,
                                        );
                                        break;
                                    }
                                    const sessions =
                                        await api.conversationList();
                                    const match = sessions.find(
                                        (s) =>
                                            s.name.toLowerCase() ===
                                            payload.name!.toLowerCase(),
                                    );
                                    if (!match) {
                                        chatView.addNotificationMessage(
                                            {
                                                type: "html",
                                                content: `No conversation named "<b>${escapeHtml(payload.name)}</b>" found.`,
                                                kind: "warning",
                                            },
                                            "conversation",
                                            undefined,
                                        );
                                        break;
                                    }
                                    const result = await api.conversationSwitch(
                                        match.conversationId,
                                    );
                                    if (!result.success) {
                                        chatView.addNotificationMessage(
                                            {
                                                type: "html",
                                                content: `❌ ${escapeHtml(result.error ?? "Failed to switch conversation")}`,
                                                kind: "warning",
                                            },
                                            "conversation",
                                            undefined,
                                        );
                                    }
                                    break;
                                }
                                case "rename": {
                                    if (!payload.newName) {
                                        chatView.addNotificationMessage(
                                            {
                                                type: "html",
                                                content:
                                                    "A new name is required to rename the conversation.",
                                                kind: "warning",
                                            },
                                            "conversation",
                                            undefined,
                                        );
                                        break;
                                    }
                                    let conversationId: string;
                                    if (payload.name) {
                                        const sessions =
                                            await api.conversationList();
                                        const match = sessions.find(
                                            (s) =>
                                                s.name.toLowerCase() ===
                                                payload.name!.toLowerCase(),
                                        );
                                        if (!match) {
                                            chatView.addNotificationMessage(
                                                {
                                                    type: "html",
                                                    content: `No conversation named "<b>${escapeHtml(payload.name)}</b>" found.`,
                                                    kind: "warning",
                                                },
                                                "conversation",
                                                undefined,
                                            );
                                            break;
                                        }
                                        conversationId = match.conversationId;
                                    } else {
                                        const cur =
                                            await api.conversationGetCurrent();
                                        if (!cur) {
                                            chatView.addNotificationMessage(
                                                {
                                                    type: "html",
                                                    content:
                                                        "No active conversation to rename.",
                                                    kind: "warning",
                                                },
                                                "conversation",
                                                undefined,
                                            );
                                            break;
                                        }
                                        conversationId = cur.conversationId;
                                    }
                                    await api.conversationRename(
                                        conversationId,
                                        payload.newName,
                                    );
                                    chatView.addNotificationMessage(
                                        {
                                            type: "html",
                                            content: `✅ Renamed conversation to "<b>${escapeHtml(payload.newName)}</b>"`,
                                            kind: "info",
                                        },
                                        "conversation",
                                        undefined,
                                    );
                                    break;
                                }
                                case "delete": {
                                    if (!payload.name) {
                                        chatView.addNotificationMessage(
                                            {
                                                type: "html",
                                                content:
                                                    "A conversation name is required to delete.",
                                                kind: "warning",
                                            },
                                            "conversation",
                                            undefined,
                                        );
                                        break;
                                    }
                                    const sessions =
                                        await api.conversationList();
                                    const match = sessions.find(
                                        (s) =>
                                            s.name.toLowerCase() ===
                                            payload.name!.toLowerCase(),
                                    );
                                    if (!match) {
                                        chatView.addNotificationMessage(
                                            {
                                                type: "html",
                                                content: `❌ Conversation "<b>${escapeHtml(payload.name)}</b>" not found.`,
                                                kind: "warning",
                                            },
                                            "conversation",
                                            undefined,
                                        );
                                        break;
                                    }
                                    await api.conversationDelete(
                                        match.conversationId,
                                    );
                                    chatView.addNotificationMessage(
                                        {
                                            type: "html",
                                            content: `🗑️ Deleted conversation "<b>${escapeHtml(match.name)}</b>"`,
                                            kind: "info",
                                        },
                                        "conversation",
                                        undefined,
                                    );
                                    break;
                                }
                                default: {
                                    chatView.addNotificationMessage(
                                        {
                                            type: "html",
                                            content: `Unknown manage-conversation subcommand: "<b>${escapeHtml(payload.subcommand)}</b>"`,
                                            kind: "warning",
                                        },
                                        "conversation",
                                        undefined,
                                    );
                                    break;
                                }
                            }
                        })().catch((e) =>
                            chatView.addNotificationMessage(
                                {
                                    type: "html",
                                    content: `❌ ${escapeHtml(e?.message ?? String(e))}`,
                                    kind: "warning",
                                },
                                "conversation",
                                undefined,
                            ),
                        );
                        break;
                    }
                }
            } catch (e) {
                console.log(e);
            }
        },
    };

    const client: Client = {
        clientIO,
        async dispatcherInitialized(d: Dispatcher): Promise<void> {
            dispatcher = d;
            chatView.initializeDispatcher(d);
            await chatHistoryReady;

            // Signal that the dispatcher is fully initialised.
            // Tests wait for this attribute before sending the first request.
            chatView
                .getScrollContainer()
                .setAttribute("data-dispatcher-ready", "true");
        },
        updateRegisterAgents(updatedAgents: [string, string][]): void {
            agents.clear();
            for (const [key, value] of updatedAgents) {
                agents.set(key, value);
            }
        },
        async showInputText(message: string): Promise<void> {
            return chatView.showInputText(message);
        },
        showDialog(key: string): void {
            if (key.toLocaleLowerCase() == "settings") {
                tabsView.showTab(key);
            }

            tabsView.showTab(key);
        },
        updateSettings(settings: ShellUserSettings): void {
            settingsView.shellSettings = settings;
        },
        fileSelected(fileName: string, fileContent: string): void {
            chatView.chatInput?.loadImageContent(fileName, fileContent);
        },
        listen(token: SpeechToken | undefined, useLocalWhisper: boolean): void {
            if (token !== undefined) {
                setSpeechToken(token);
            }

            chatView.chatInput?.recognizeOnce(token, useLocalWhisper);
        },
        toggleAlwaysListen(waitforWakeWord: boolean): void {
            chatView.chatInput?.toggleContinuous(waitforWakeWord);
        },
        focusInput(): void {
            chatView.chatInput?.focus();
        },
        searchMenuCompletion(id: number, item: SearchMenuItem) {
            remoteSearchMenuUIOnCompletion(id, item);
        },
        titleUpdated(title: string): void {
            document.title = title;
        },
        continuousSpeechProcessed(expressions: UserExpression[]): void {
            console.log(
                `Continuous speech processed: ${JSON.stringify(expressions)}`,
            );

            for (const expression of expressions) {
                if (expression.complete_statement) {
                    // if (
                    //     expression.type === "question" ||
                    //     expression.type === "command"
                    // ) {
                    chatView.addUserMessage(JSON.stringify(expression.text));
                    //}
                }
            }
        },
        tabRestoreStatus(count: number): void {
            // Ensure shell has an icon in the agents map
            if (!agents.has("shell")) {
                agents.set("shell", "\uD83D\uDC1A");
            }
            if (count > 0) {
                chatView.addNotificationMessage(
                    `Restoring ${count} browser tab${count > 1 ? "s" : ""}...`,
                    "shell",
                    "tab-restore",
                );
            } else {
                chatView.addNotificationMessage(
                    `Browser tabs restored.`,
                    "shell",
                    "tab-restore",
                );
            }
        },
        systemNotification(
            message: string,
            id: string,
            _timestamp: number,
        ): void {
            // Ensure shell has an icon in the agents map
            if (!agents.has("shell")) {
                agents.set("shell", "\uD83D\uDC1A");
            }
            chatView.addNotificationMessage(message, "shell", id);
        },
        conversationChanged(_conversationId: string, _name: string): void {
            // Conversation changed — no UI to update (dropdown removed)
        },
        markHistoryEntries(): void {
            for (const child of chatView.getScrollContainer().children) {
                child.classList.add("history");
            }
        },
    };

    getClientAPI().registerClient(client);
}

function showNotifications(
    requestId: RequestId,
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

    chatView.addAgentMessage(
        {
            message: { type: "html", content: html },
            source: "shell.showNotifications",
            requestId,
        },
        { notification: true },
    );
}

function summarizeNotifications(
    requestId: RequestId,
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
        requestId,
        source: "shell.notificationSummary",
    });
}

const notifications = new Array();

// Tracks the highest display log seq seen by this client.
// Set from saved snapshot and updated as live entries arrive.
let maxSeqSeen: number = -1;

export class IdGenerator {
    private count = 0;
    public genId() {
        return `cmd-${this.count++}`;
    }
}

document.addEventListener("DOMContentLoaded", async function () {
    const inputOnly =
        new URLSearchParams(window.location.search).get("inputOnly") === "true";
    const wrapper = document.getElementById("wrapper")!;
    const idGenerator = new IdGenerator();
    const agents = new Map<string, string>();

    const tabs = new TabView(
        ["Settings", "Metrics", "Help"],
        [iconSettings(), iconMetrics(), iconHelp()],
        [iconSettings(), iconMetrics(), iconHelp()],
    );

    const chatView = new ChatView(idGenerator, agents, inputOnly);
    const chatInput = new ChatInput({}, "phraseDiv");

    chatView.setChatInput(chatInput);

    const chatHistoryReady = initializeChatHistory(chatView);

    const cameraView = new CameraView((image: HTMLImageElement) => {
        // copy image
        const newImage: HTMLImageElement = document.createElement("img");
        newImage.src = image.src;

        newImage.classList.add("chat-input-dropImage");
        chatView.chatInput?.textarea.getTextEntry().append(newImage);

        if (chatView.chatInput?.sendButton !== undefined) {
            chatView.chatInput.sendButton.disabled =
                chatView.chatInput.textarea.getTextEntry().innerHTML.length ==
                0;
        }
    });

    wrapper.appendChild(cameraView.getContainer());
    wrapper.appendChild(chatView.getMessageElm());

    chatView.chatInput!.camButton.onclick = () => {
        cameraView.toggleVisibility();
    };

    chatView.chatInput!.attachButton.onclick = () => {
        getClientAPI().openImageFile();
    };

    const settingsView = new SettingsView(chatView);
    chatView.settingsView = settingsView;
    tabs.getTabContainerByName("Settings").append(settingsView.getContainer());
    tabs.getTabContainerByName("Metrics").append(
        new MetricsView().getContainer(),
    );
    tabs.getTabContainerByName("Help").append(new HelpView().getContainer());

    registerClient(
        chatView,
        agents,
        settingsView,
        tabs,
        cameraView,
        chatHistoryReady,
    );

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
    let token: SpeechToken | undefined = await getSpeechToken();
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
});

function watchForDOMChanges(element: HTMLDivElement) {
    // timeout
    let lastModifiedTime: number = 0;
    let hasTimeout = false;
    const scheduleSaveChatHistory = () => {
        if (hasTimeout) {
            // Already scheduled.
            return;
        }
        hasTimeout = true;
        setTimeout(() => {
            hasTimeout = false;
            const idleTime = Date.now() - lastModifiedTime;
            if (idleTime >= 250) {
                getClientAPI().saveChatHistory(element.innerHTML, maxSeqSeen);
            } else {
                // not idle long enough, reschedule
                scheduleSaveChatHistory();
            }
        });
    };
    // observer
    const observer = new MutationObserver(() => {
        // Update the last modified time
        lastModifiedTime = Date.now();

        // schedule to save chat history
        scheduleSaveChatHistory();
    });

    // ignore attribute changes but watch for
    const config = { attributes: false, childList: true, subtree: true };
    // start observing
    observer.observe(element, config);

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

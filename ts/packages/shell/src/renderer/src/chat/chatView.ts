// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { IdGenerator } from "../main";
import { ChatInput } from "./chatInput";
import { ExpandableTextArea } from "./expandableTextArea";
import { handleConversationCommand } from "./conversationCommands";
import { iconCheckMarkCircle, iconX } from "../icon";
import {
    DisplayAppendMode,
    DisplayContent,
    DynamicDisplay,
    TypeAgentAction,
} from "@typeagent/agent-sdk";
import { TTS } from "../tts/tts";
import {
    Dispatcher,
    IAgentMessage,
    NotifyExplainedData,
    RequestId,
    TemplateEditConfig,
} from "agent-dispatcher";

import { PartialCompletion } from "../partial";
import { InputChoice } from "../choicePanel";
import { MessageGroup } from "./messageGroup";
import { SettingsView } from "../settingsView";
import { uint8ArrayToBase64 } from "@typeagent/common-utils";

const DynamicDisplayMinRefreshIntervalMs = 15;

// The canonical MessageGroup key is requestId.requestId — a UUID assigned by
// the dispatcher (via randomUUID()). This value is guaranteed to be unique
// within a session, which decouples the keying strategy from the client-assigned
// clientRequestId. Client-side messages (e.g. notifications) set requestId to
// "" and use clientRequestId as the map key instead.
//
// Returns undefined when requestId.requestId is empty (""), which indicates
// the message was generated client-side and has no server-assigned UUID.
function getMessageGroupId(requestId: RequestId): string | undefined {
    return requestId.requestId || undefined;
}

export class ChatView {
    private readonly topDiv: HTMLDivElement;
    private readonly messageDiv: HTMLDivElement;
    // Server-UUID-keyed MessageGroups (promoted from pendingLocalGroups, or
    // created directly for remote replay via addRemoteUserMessage).
    private readonly idToMessageGroup: Map<string, MessageGroup> = new Map();
    // Locally-created MessageGroups waiting for the server-assigned UUID.
    // Keyed by the temp clientRequestId (e.g. "cmd-0"). Moved into
    // idToMessageGroup (under the canonical UUID) when setUserRequest arrives.
    private readonly pendingLocalGroups: Map<string, MessageGroup> = new Map();
    // Client-only MessageGroups that will never receive a server UUID
    // (e.g. notifications, agent-initiated messages). Keyed by clientRequestId.
    private readonly clientMessageGroups: Map<string, MessageGroup> = new Map();
    private inputContainer: HTMLDivElement | undefined;
    private _settingsView: SettingsView | undefined;
    private _dispatcher: Dispatcher | undefined;
    private partialCompletionEnabled: boolean = false;
    private partialCompletionInline: boolean = true;
    private partialCompletion: PartialCompletion | undefined;
    private commandBackStack: string[] = [];
    private commandBackStackIndex = 0;

    private hideMetrics = true;
    private isScrolling = false;

    private _voiceBanner: HTMLElement;

    public userGivenName: string = "";
    public chatInput: ChatInput | undefined;
    public tts?: TTS | undefined;
    public onRequestComplete?: () => void;
    private activeRequestId?: string;
    private stopButton?: HTMLButtonElement;

    private notificationCount = 0;
    constructor(
        private idGenerator: IdGenerator,
        private readonly agents: Map<string, string>,
        inputOnly: boolean,
    ) {
        // the main container
        this.topDiv = document.createElement("div");
        this.topDiv.className = "chat-container";

        this.messageDiv = document.createElement("div");
        this.messageDiv.className = "chat scroll_enabled";
        this.messageDiv.addEventListener("scrollend", () => {
            if (this.isScrolling) {
                if (this.messageDiv.scrollTop === 0) {
                    this.isScrolling = false;
                    return;
                }
                this.messageDiv.scrollTo(0, 0);
            }
        });
        if (inputOnly) {
            this.messageDiv.style.visibility = "hidden";
        }

        this.topDiv.appendChild(this.messageDiv);

        // Voice mode banner — shown when voice mode is active
        this._voiceBanner = document.createElement("div");
        this._voiceBanner.className = "voice-mode-banner";
        this._voiceBanner.textContent = "Voice Mode";
        this.topDiv.appendChild(this._voiceBanner);

        // wire up messages from iframes so we can resize them
        window.onmessage = (e) => {
            const source = e.data as string;
            if (
                source.startsWith("slideshow_") ||
                source.startsWith("aivideo_") ||
                source.startsWith("monitorlayout_")
            ) {
                const temp: string[] = source.split("_");
                if (temp.length != 3) {
                    return;
                }

                const name = temp[0];
                const hash = temp[1];
                const size = temp[2];

                // find the iframe from which this message originated
                const iframes = document.getElementsByTagName("iframe");
                for (let i = 0; i < iframes.length; i++) {
                    if (iframes[i].srcdoc.indexOf(`${name}_${hash}`) > -1) {
                        // resize the host iframe to fit the content size as reported by the iframe
                        iframes[i].style.height = size + "px";

                        break;
                    }
                }
            } else {
                console.log("Unknown message received: " + e.data);
            }
        };
    }

    private getDispatcher(): Dispatcher {
        if (this._dispatcher === undefined) {
            throw new Error("Dispatcher is not initialized");
        }
        return this._dispatcher;
    }

    public initializeDispatcher(dispatcher: Dispatcher) {
        if (this._dispatcher !== undefined) {
            throw new Error("Dispatcher already initialized");
        }

        if (this.chatInput === undefined) {
            throw new Error("Chat input is not initialized");
        }

        this._dispatcher = dispatcher;

        this.chatInput.textarea.enable(true);
        this.chatInput.focus();

        // Create stop button (hidden by default, shares position with send button)
        this.stopButton = document.createElement("button");
        this.stopButton.className = "chat-input-button chat-stop-button";
        this.stopButton.innerHTML = "■";
        this.stopButton.style.display = "none";
        this.stopButton.addEventListener("click", () => this.cancelCommand());
        this.chatInput.sendButton.parentElement?.appendChild(this.stopButton);

        // Wire request completion to toggle buttons back
        this.onRequestComplete = () => {
            this.activeRequestId = undefined;
            this.showStopButton(false);
        };

        // Escape key cancels during processing
        document.addEventListener("keydown", (e) => {
            if (e.key === "Escape" && this.activeRequestId) {
                e.preventDefault();
                this.cancelCommand();
            }
        });

        // delay initialization.
        if (this.partialCompletionEnabled) {
            this.ensurePartialCompletion();
        }
    }

    public setActiveRequestId(requestId: string) {
        this.activeRequestId = requestId;
        this.showStopButton(true);
    }

    private cancelCommand() {
        if (this.activeRequestId && this._dispatcher) {
            this._dispatcher.cancelCommand(this.activeRequestId);
        }
    }

    private showStopButton(processing: boolean) {
        if (!this.chatInput || !this.stopButton) return;
        if (processing) {
            this.chatInput.sendButton.style.display = "none";
            this.stopButton.style.display = "";
        } else {
            this.stopButton.style.display = "none";
            this.chatInput.sendButton.style.display = "";
        }
    }

    private ensurePartialCompletion() {
        if (
            this.partialCompletion === undefined &&
            this._dispatcher !== undefined &&
            this.inputContainer !== undefined &&
            this.chatInput !== undefined
        ) {
            this.partialCompletion = new PartialCompletion(
                this.inputContainer,
                this.chatInput.textarea,
                this.getDispatcher(),
                this.partialCompletionInline,
                () => this.toggleCompletionMode(),
            );
        }
    }

    private toggleCompletionMode() {
        const newInline = !this.partialCompletionInline;
        this.partialCompletionInline = newInline;
        this.partialCompletion?.switchMode(newInline);
        this._settingsView?.setInlineCompletions(newInline);
    }

    public enablePartialInput(enabled: boolean, inline: boolean) {
        this.partialCompletionEnabled = enabled;
        if (this.partialCompletionInline !== inline) {
            // Reinitialize partial completion with new mode
            this.partialCompletion?.close();
            this.partialCompletion = undefined;
            this.partialCompletionInline = inline;
        }

        if (enabled) {
            this.ensurePartialCompletion();
        } else {
            this.partialCompletion?.close();
            this.partialCompletion = undefined;
        }
    }

    private dynamicDisplays: {
        source: string;
        id: RequestId;
        actionIndex: number;
        displayId: string;
        nextRefreshTime: number;
    }[] = [];
    private timer: number | undefined = undefined;
    private scheduledRefreshTime: number | undefined = undefined;
    setDynamicDisplay(
        requestId: RequestId,
        source: string,
        actionIndex: number,
        displayId: string,
        nextRefreshMs: number,
    ) {
        const now = Date.now();
        const agentMessage = this.ensureAgentMessage({
            message: "",
            requestId,
            source: source,
            actionIndex: actionIndex,
        });
        if (agentMessage === undefined) {
            return;
        }
        this.dynamicDisplays.push({
            source,
            id: requestId,
            actionIndex,
            displayId,
            nextRefreshTime:
                Math.max(nextRefreshMs, DynamicDisplayMinRefreshIntervalMs) +
                now,
        });

        this.scheduleDynamicDisplayRefresh(now);
    }
    private scheduleDynamicDisplayRefresh(now: number) {
        if (this.dynamicDisplays.length === 0) {
            return;
        }
        this.dynamicDisplays.sort(
            (a, b) => a.nextRefreshTime - b.nextRefreshTime,
        );
        const nextRefreshTime = this.dynamicDisplays[0].nextRefreshTime;
        const scheduledRefreshTime = this.scheduledRefreshTime;
        if (
            scheduledRefreshTime === undefined ||
            nextRefreshTime < scheduledRefreshTime
        ) {
            if (this.timer !== undefined) {
                window.clearInterval(this.timer);
                this.timer = undefined;
            }
            const interval = nextRefreshTime - now;
            this.scheduledRefreshTime = nextRefreshTime;
            this.timer = window.setTimeout(() => {
                this.scheduledRefreshTime = undefined;
                this.timer = undefined;
                this.refreshDynamicDisplays();
            }, interval);
        }
    }

    private async refreshDynamicDisplays() {
        const now = Date.now();
        let item = this.dynamicDisplays[0];
        const currentDisplay = new Map<string, DynamicDisplay>();
        while (item && item.nextRefreshTime <= now) {
            this.dynamicDisplays.shift()!;
            const { id, source, actionIndex, displayId } = item;
            try {
                // Only call getDynamicDisplay once if there are multiple
                let result = currentDisplay.get(`${source}:${displayId}`);
                if (result === undefined) {
                    result = await this.getDispatcher().getDynamicDisplay(
                        source,
                        "html",
                        displayId,
                    );
                    currentDisplay.set(`${source}:${displayId}`, result);
                }
                this.addAgentMessage(
                    {
                        message: result.content,
                        requestId: id,
                        source: source,
                        actionIndex: actionIndex,
                    },
                    { scrollToMessage: true },
                );
                if (result.nextRefreshMs !== -1) {
                    this.dynamicDisplays.push({
                        source,
                        id,
                        actionIndex,
                        displayId,
                        nextRefreshTime:
                            Math.max(
                                result.nextRefreshMs,
                                DynamicDisplayMinRefreshIntervalMs,
                            ) + now,
                    });
                }
            } catch (error: any) {
                currentDisplay.set(`${source}:${displayId}`, {
                    content: error.message,
                    nextRefreshMs: -1,
                });
                this.addAgentMessage(
                    {
                        message: error.message,
                        requestId: id,
                        source: source,
                        actionIndex: actionIndex,
                    },
                    { scrollToMessage: true },
                );
            }

            item = this.dynamicDisplays[0];
        }
        this.scheduleDynamicDisplayRefresh(now);
    }

    private getMessageGroup(requestId: RequestId) {
        const id = getMessageGroupId(requestId);

        // Server-assigned UUID exists — look up directly.
        if (id !== undefined) {
            const messageGroup = this.idToMessageGroup.get(id);
            if (messageGroup !== undefined) {
                return messageGroup;
            }

            // Lazy promotion: check whether the clientRequestId matches a
            // pending local MessageGroup. The first server message carrying
            // both the UUID and the matching clientRequestId promotes the
            // pending entry into idToMessageGroup.
            const clientId = requestId.clientRequestId as string | undefined;
            if (clientId) {
                const pending = this.pendingLocalGroups.get(clientId);
                if (pending) {
                    this.pendingLocalGroups.delete(clientId);
                    this.idToMessageGroup.set(id, pending);
                    return pending;
                }
            }

            // "system" is a reserved sentinel set by broadcastSystemMessage on
            // the server (sharedDispatcher.ts).  It can never collide with a
            // real UUID (randomUUID() produces RFC 4122 format).  Auto-create a
            // notification group so join/leave messages are displayed.
            if (id === "system") {
                const mgId = `notification-system-${this.notificationCount++}`;
                const mg: MessageGroup = new MessageGroup(
                    this,
                    this.settingsView!,
                    "",
                    this.messageDiv,
                    undefined,
                    this.agents,
                    this.hideMetrics,
                );
                this.clientMessageGroups.set(mgId, mg);
                mg.hideUserMessage();
                return mg;
            }

            console.error(`Invalid requestId ${id}`);
            return undefined;
        }

        // Client-side message (no server UUID) — use clientRequestId as key.
        const clientId = requestId.clientRequestId as string | undefined;
        if (!clientId) {
            console.error(`Invalid requestId: no id or clientRequestId`);
            return undefined;
        }

        const messageGroup = this.clientMessageGroups.get(clientId);
        if (messageGroup !== undefined) {
            return messageGroup;
        }

        // Auto-create for notification message groups.
        if (
            clientId.startsWith("agent-") ||
            clientId.startsWith("notification-")
        ) {
            const mg: MessageGroup = new MessageGroup(
                this,
                this.settingsView!,
                "",
                this.messageDiv,
                undefined,
                this.agents,
                this.hideMetrics,
            );
            this.clientMessageGroups.set(clientId, mg);
            mg.hideUserMessage();
            return mg;
        }

        console.error(`Invalid clientRequestId ${clientId}`);
        return undefined;
    }

    showStatusMessage(msg: IAgentMessage, temporary: boolean) {
        this.getMessageGroup(msg.requestId)?.addStatusMessage(msg, temporary);
        this.updateScroll();
    }

    clear() {
        this.messageDiv.replaceChildren();
        this.idToMessageGroup.clear();
        this.pendingLocalGroups.clear();
        this.clientMessageGroups.clear();
        this.commandBackStackIndex = -1;
        this.commandBackStack = [];
    }

    async addUserMessage(
        request: string | { type: "html"; content: string },
        hidden: boolean = false,
    ) {
        let requestText: string;
        if (typeof request === "string") {
            requestText = request;
        } else if (request.type === "html") {
            let tempDiv: HTMLDivElement = document.createElement("div");
            tempDiv.innerHTML = request.content;
            requestText = tempDiv.innerText;
        } else {
            requestText = request.content;
        }

        // Intercept /conversation (UI slash command only, NOT @conversation).
        // @conversation is dispatched to the in-process/remote dispatcher which
        // handles it correctly in both local and remote modes.
        const t = requestText.trim();
        if (t.startsWith("/conversation") || t.startsWith("@conversation")) {
            const handled = await handleConversationCommand(requestText, {
                addSystemMessage: (content: string) => {
                    this.addNotificationMessage(
                        { type: "html", content, kind: "info" },
                        "conversation",
                        undefined,
                    );
                },
                clear: () => {
                    this.clear();
                },
            });
            if (handled) {
                return;
            }
        }

        const localId = this.idGenerator.genId();

        let images: string[] = [];
        if (typeof request === "string") {
            // requestText already set above
        } else if (request.type === "html") {
            let tempDiv: HTMLDivElement = document.createElement("div");
            tempDiv.innerHTML = request.content;
            images = await this.extractMultiModalContent(tempDiv);
            requestText = tempDiv.innerText;
            request.content = tempDiv.innerHTML;
        } else {
            requestText = request.content;
        }

        // Start command processing first so we have the promise for MessageGroup.
        // localId becomes clientRequestId in the RequestId; the server assigns
        // a UUID (requestId.requestId) and broadcasts it via setUserRequest.
        const commandResult = this.getDispatcher().processCommand(
            requestText,
            localId,
            images,
        );

        const mg: MessageGroup = new MessageGroup(
            this,
            this.settingsView!,
            request,
            this.messageDiv,
            commandResult,
            this.agents,
            this.hideMetrics,
        );

        if (hidden) {
            mg.hideUserMessage();
        }

        // Hold in pending map until setUserRequest arrives with the UUID.
        this.pendingLocalGroups.set(localId, mg);
        this.updateScroll();
        this.commandBackStackIndex = 0;
        this.commandBackStack = [];
    }

    addRemoteUserMessage(requestId: RequestId, command: string) {
        const id = requestId.requestId;
        if (!id || this.idToMessageGroup.has(id)) {
            return;
        }

        // Don't create a remote MG if this is actually a local command
        // still waiting for promotion (handled lazily by getMessageGroup).
        const localId = requestId.clientRequestId as string | undefined;
        if (localId && this.pendingLocalGroups.has(localId)) {
            return;
        }

        const mg: MessageGroup = new MessageGroup(
            this,
            this.settingsView!,
            command,
            this.messageDiv,
            undefined,
            this.agents,
            this.hideMetrics,
        );

        this.idToMessageGroup.set(id, mg);
        this.updateScroll();
    }

    async extractMultiModalContent(tempDiv: HTMLDivElement): Promise<string[]> {
        let images = tempDiv.querySelectorAll<HTMLImageElement>(
            ".chat-input-dropImage",
        );
        let retVal: string[] = new Array<string>(images.length);
        for (let i = 0; i < images.length; i++) {
            images[i].classList.remove("chat-input-dropImage");
            images[i].classList.add("chat-input-image");

            if (images[i].src.startsWith("data:image")) {
                retVal[i] = images[i].src;
            } else if (images[i].src.startsWith("blob:")) {
                let response = await fetch(images[i].src);
                let blob = await response.blob();
                let ab = await blob.arrayBuffer();
                retVal[i] =
                    `data:image/png;base64,` +
                    uint8ArrayToBase64(new Uint8Array(ab));
            } else {
                console.log("Unknown image source type.");
            }
        }

        return retVal;
    }

    notifyExplained(requestId: RequestId, data: NotifyExplainedData) {
        this.getMessageGroup(requestId)?.notifyExplained(data);
    }

    updateGrammarResult(
        requestId: RequestId,
        success: boolean,
        message?: string,
    ) {
        this.getMessageGroup(requestId)?.updateGrammarResult(success, message);
    }

    randomCommandSelected(requestId: RequestId, message: string) {
        if (message.length > 0) {
            this.getMessageGroup(requestId)?.updateUserMessage(message);
        }
    }

    setDisplayInfo(
        requestId: RequestId,
        source: string,
        actionIndex?: number,
        action?: TypeAgentAction | string[],
    ) {
        this.getMessageGroup(requestId)?.setDisplayInfo(
            source,
            actionIndex,
            action,
        );
    }

    setActionData(requestId: RequestId, data: any) {
        this.getMessageGroup(requestId)?.setActionData(requestId, data);
    }

    private getNotificationMessageGroupId(
        requestId: string | RequestId | undefined,
        source: string,
    ) {
        if (requestId !== undefined) {
            if (typeof requestId === "string") {
                return `notification-async-${source}-${requestId}`;
            }
            const messageGroupId = getMessageGroupId(requestId);
            if (messageGroupId !== undefined) {
                return `notification-request-${messageGroupId}`;
            }
        }
        return `notification-generic-${this.notificationCount++}`;
    }

    public addNotificationMessage(
        message: string | DisplayContent,
        source: string,
        requestId: string | RequestId | undefined,
    ) {
        const agentMessage: IAgentMessage = {
            message,
            requestId: {
                requestId: "",
                clientRequestId: this.getNotificationMessageGroupId(
                    requestId,
                    source,
                ),
            },
            source,
            actionIndex: 0,
        };
        this.addAgentMessage(agentMessage, {
            appendMode: "temporary",
            notification: true,
            scrollToMessage: typeof requestId === "string",
        });
    }
    addAgentMessage(
        msg: IAgentMessage,
        options?: {
            appendMode?: DisplayAppendMode;
            scrollToMessage?: boolean;
            notification?: boolean;
        },
    ) {
        const scrollToMessage = options?.scrollToMessage ?? false;
        const notification = options?.notification ?? false;
        const content: DisplayContent = msg.message;

        const agentMessage = this.ensureAgentMessage(msg, notification);
        if (agentMessage === undefined) {
            return;
        }

        agentMessage.setMessage(
            content,
            msg.source,
            options?.appendMode,
            msg.sourceIcon,
        );

        if (!scrollToMessage) {
            this.updateScroll();
            this.chatInputFocus();
        }
    }
    updateScroll() {
        // REVIEW: electron 35 (chrome 134) scrollIntoView behavior changed compared to electron 30 (chrome 124)
        // Multiple call to scrollIntoView has no effect for the latter call(?)
        // Switch to use scrollTo instead and keep track of progress.

        if (this.isScrolling) {
            return;
        }
        this.isScrolling = true;

        // Add a delay to allow for element animation to start
        window.setTimeout(() => {
            if (this.messageDiv.scrollTop === 0) {
                this.isScrolling = false;
                return;
            }
            this.messageDiv.scrollTo(0, 0);
        }, 100);
    }
    private ensureAgentMessage(msg: IAgentMessage, notification = false) {
        return this.getMessageGroup(msg.requestId)?.ensureAgentMessage(
            msg,
            notification,
        );
    }
    public chatInputFocus() {
        this.chatInput?.focus();
    }

    public async askYesNo(
        requestId: RequestId,
        message: string,
        source: string,
    ): Promise<boolean> {
        const agentMessage = this.ensureAgentMessage({
            message: "",
            requestId,
            source,
        });
        if (agentMessage === undefined) {
            throw new Error(`Invalid requestId ${requestId}`);
        }
        agentMessage.setMessage(message, source, "inline");
        const choices: InputChoice[] = [
            {
                text: "Yes",
                element: iconCheckMarkCircle(),
                selectKey: ["Enter"],
                value: true,
            },
            {
                text: "No",
                element: iconX(),
                selectKey: ["Delete"],
                value: false,
            },
        ];
        const p = new Promise<boolean>((resolve) => {
            agentMessage.addChoicePanel(choices, (choice) => {
                agentMessage.setMessage(`  ${choice.text}`, source, "inline");
                resolve(choice.value);
            });
        });
        this.updateScroll();
        return p;
    }

    public showChoice(
        requestId: RequestId,
        choiceId: string,
        type: "yesNo" | "multiChoice",
        _message: string,
        choiceLabels: string[],
        source: string,
    ) {
        // Append choice UI to the last agent message (the action result bubble)
        const messageGroup = this.getMessageGroup(requestId);
        if (!messageGroup) return;

        const agentMessage =
            messageGroup.getLastAgentMessage() ??
            this.ensureAgentMessage({ message: "", requestId, source });
        if (!agentMessage) return;

        if (type === "yesNo") {
            const choices: InputChoice[] = [
                {
                    text: "Yes (Enter)",
                    element: iconCheckMarkCircle(),
                    selectKey: ["Enter"],
                    value: true,
                },
                {
                    text: "No (Del)",
                    element: iconX(),
                    selectKey: ["Delete"],
                    value: false,
                },
            ];
            agentMessage.addChoicePanel(choices, (choice) => {
                this.getDispatcher().respondToChoice(choiceId, choice.value);
            });
        } else {
            // multiChoice — checkboxes
            agentMessage.addCheckboxPanel(
                choiceLabels,
                (selectedIndices: number[]) => {
                    this.getDispatcher().respondToChoice(
                        choiceId,
                        selectedIndices,
                    );
                },
            );
        }
        this.updateScroll();
    }

    public async proposeAction(
        requestId: RequestId,
        actionTemplates: TemplateEditConfig,
        source: string,
    ) {
        const agentMessage = this.ensureAgentMessage({
            message: "",
            requestId,
            source,
        });
        if (agentMessage === undefined) {
            throw new Error(`Invalid requestId ${requestId}`);
        }
        return agentMessage?.proposeAction(
            this.getDispatcher(),
            actionTemplates,
        );
    }
    public setVoiceMode(enabled: boolean): void {
        if (enabled) {
            document.body.classList.add("voice-mode");
        } else {
            document.body.classList.remove("voice-mode");
        }
        this.chatInput?.setVoiceMode(enabled);
    }

    public setClaudeFocus(active: boolean): void {
        this._voiceBanner.classList.toggle("claude-focus", active);
        this._voiceBanner.textContent = active ? "Claude Focus" : "Voice Mode";
    }

    getMessageElm() {
        return this.topDiv;
    }
    getScrollContainer() {
        return this.messageDiv;
    }

    async showInputText(message: string) {
        return this.chatInput?.showInputText(message);
    }

    public setMetricsVisible(visible: boolean) {
        this.hideMetrics = !visible;
        for (const messageGroup of this.idToMessageGroup.values()) {
            messageGroup.setMetricsVisible(visible);
        }
        for (const messageGroup of this.pendingLocalGroups.values()) {
            messageGroup.setMetricsVisible(visible);
        }
        for (const messageGroup of this.clientMessageGroups.values()) {
            messageGroup.setMetricsVisible(visible);
        }
    }

    public set settingsView(value: SettingsView) {
        this._settingsView = value;
    }

    public get settingsView(): SettingsView | undefined {
        return this._settingsView;
    }

    public setInputMode(verticalLayout: boolean) {
        if (verticalLayout) {
            //this.topDiv.parentElement?.classList.add("write-only");
            this.topDiv.parentElement?.classList.remove("read-only");
        } else {
            //this.topDiv.parentElement?.classList.remove("write-only");
            this.topDiv.parentElement?.classList.remove("read-only");
        }
    }

    /**
     * Hosts a chat input control within the chat view.
     * @param input The chat input to set. This method can only be called once.
     */
    public setChatInput(input: ChatInput) {
        if (this.chatInput !== undefined) {
            throw new Error("Chat input already set");
        }

        // event handler for the text entry send event
        input.textarea.onSend = (messageHtml: string) => {
            // message from chat input are from innerHTML
            this.addUserMessage({
                type: "html",
                content: messageHtml,
            });
        };

        input.textarea.onChange = (
            _eta: ExpandableTextArea,
            isInput: boolean,
        ) => {
            if (this.partialCompletion) {
                if (isInput) {
                    this.partialCompletion.update(true);
                } else {
                    this.partialCompletion.hide();
                }
            }
        };

        input.textarea.onMouseWheel = (
            _eta: ExpandableTextArea,
            ev: WheelEvent,
        ) => {
            this.partialCompletion?.handleMouseWheel(ev);
        };

        input.textarea.onKeydown = (
            _eta: ExpandableTextArea,
            ev: KeyboardEvent,
        ) => {
            if (this.partialCompletion?.handleSpecialKeys(ev) === true) {
                return false;
            }

            // history
            if (!ev.altKey && !ev.ctrlKey) {
                if (ev.key == "ArrowUp" || ev.key == "ArrowDown") {
                    const currentContent: string =
                        this.chatInput?.textarea.getTextEntry().innerHTML ?? "";

                    if (
                        this.commandBackStack.length === 0 ||
                        this.commandBackStack[this.commandBackStackIndex] !==
                            currentContent
                    ) {
                        const messages: NodeListOf<Element> =
                            this.messageDiv.querySelectorAll(
                                ".chat-message-container-user:not(.history):not(.chat-message-hidden) .chat-message-content",
                            );
                        this.commandBackStack = Array.from(messages).map(
                            (m: Element) =>
                                m.firstElementChild?.innerHTML.replace(
                                    'class="chat-input-image"',
                                    'class="chat-input-dropImage"',
                                ) ?? "",
                        );

                        this.commandBackStack.unshift(currentContent);
                        this.commandBackStackIndex = 0;
                    }

                    if (
                        ev.key == "ArrowUp" &&
                        this.commandBackStackIndex <
                            this.commandBackStack.length - 1
                    ) {
                        this.commandBackStackIndex++;
                    } else if (
                        ev.key == "ArrowDown" &&
                        this.commandBackStackIndex > 0
                    ) {
                        this.commandBackStackIndex--;
                    }

                    if (this.chatInput) {
                        const content =
                            this.commandBackStack[this.commandBackStackIndex];
                        this.chatInput.textarea.getTextEntry().innerHTML =
                            content;
                    }

                    this.chatInput?.textarea.moveCursorToEnd();

                    return false;
                }
            }

            return true;
        };

        this.chatInput = input;
        this.inputContainer = this.chatInput.getInputContainer();

        // Add the input div at the bottom so it's always visible
        this.topDiv.append(this.inputContainer);
    }
}

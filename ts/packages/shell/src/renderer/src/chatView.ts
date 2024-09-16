// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { IdGenerator, getClientAPI } from "./main";
import { ChatInput, ExpandableTextarea, questionInput } from "./chatInput";
import { SearchMenu } from "./search";
import { AnsiUp } from "ansi_up";
import { iconCheckMarkCircle, iconX, iconRoadrunner } from "./icon";
import {
    ActionInfo,
    ActionTemplateSequence,
    ActionUICommand,
    SearchMenuItem,
} from "../../preload/electronTypes";
import { ActionCascade } from "./ActionCascade";
import {
    DisplayAppendMode,
    DisplayContent,
    DisplayType,
    DisplayMessageKind,
    DynamicDisplay,
} from "@typeagent/agent-sdk";
import { TTS } from "./tts";
import { IAgentMessage } from "agent-dispatcher";
import DOMPurify from "dompurify";
import { PhaseTiming, RequestMetrics } from "agent-dispatcher";

export interface InputChoice {
    element: HTMLElement;
    text: string;
    selectKey?: string[];
    onSelected: (choice: InputChoice) => void;
}

export interface ChoicePanel {
    choices: InputChoice[];
    panelDiv: HTMLDivElement;
}

interface ISymbolNode {
    symbolName: string;
    children: ISymbolNode[];
    parent?: ISymbolNode;
}

enum SymbolType {
    Union,
    Action,
    Parameter,
    Object,
    String,
    Boolean,
    Number,
    Array,
}

function symbolNode(
    symbolName: string,
    symbolType: SymbolType,
    children: ISymbolNode[],
    parent?: ISymbolNode,
): ISymbolNode {
    const newSym = {
        symbolName,
        symbolType,
        children,
        parent,
    };
    newSym.children.forEach((child) => {
        child.parent = newSym;
    });
    return newSym;
}

function symbolsFromStrings(
    symbolNames: string[],
    symbolType: SymbolType,
    parent: ISymbolNode,
): ISymbolNode[] {
    return symbolNames.map((name) => symbolNode(name, symbolType, [], parent));
}

export class PlayerShimCursor {
    actionNames = [
        "play",
        "status",
        "pause",
        "resume",
        "stop",
        "next",
        "previous",
        "shuffle",
        "listDevices",
        "selectDevice",
        "setVolume",
        "changeVolume",
        "searchTracks",
        "listPlaylists",
        "getPlaylist",
        "getAlbum",
        "getFavorites",
        "filterTracks",
        "createPlaylist",
        "deletePlaylist",
        "getQueue",
        "unknown",
    ];
    root: ISymbolNode = symbolNode("root", SymbolType.Union, []);
    cursor: ISymbolNode = this.root;
    constructor() {
        this.root.children = symbolsFromStrings(
            this.actionNames,
            SymbolType.Action,
            this.root,
        );
        this.setParameters();
    }

    setParameters() {
        for (const child of this.root.children) {
            switch (child.symbolName) {
                case "play": {
                    const queryNode = symbolNode(
                        "query",
                        SymbolType.Object,
                        [],
                    );
                    child.children = [
                        symbolNode("trackNumber", SymbolType.Number, [], child),
                        symbolNode("trackRange", SymbolType.Array, [], child),
                        symbolNode("quantity", SymbolType.Number, [], child),
                        queryNode,
                    ];
                    queryNode.children = [
                        symbolNode("name", SymbolType.String, [], queryNode),
                        symbolNode("type", SymbolType.String, [], queryNode),
                    ];
                    break;
                }
                case "selectDevice":
                    child.children = [
                        symbolNode("keyword", SymbolType.String, [], child),
                    ];
                    break;
                case "shuffle":
                    child.children = [
                        symbolNode("on", SymbolType.Boolean, [], child),
                    ];
                    break;
                case "setVolume":
                    child.children = [
                        symbolNode(
                            "newVolumeLevel",
                            SymbolType.Number,
                            [],
                            child,
                        ),
                    ];
                    break;
                case "changeVolume":
                    child.children = [
                        symbolNode(
                            "volumeChangePercentage",
                            SymbolType.Number,
                            [],
                            child,
                        ),
                    ];
                    break;
                case "searchTracks":
                    child.children = [
                        symbolNode("query", SymbolType.String, [], child),
                    ];
                    break;
                case "getPlaylist":
                    child.children = [
                        symbolNode("name", SymbolType.String, [], child),
                    ];
                    break;
                case "getAlbum":
                    child.children = [
                        symbolNode("name", SymbolType.String, [], child),
                    ];
                    break;
                case "filterTracks": {
                    child.children = [
                        symbolNode("filterType", SymbolType.String, [], child),
                        symbolNode("filterValue", SymbolType.String, [], child),
                        symbolNode("negate", SymbolType.Boolean, [], child),
                    ];
                    break;
                }
                case "createPlaylist":
                    child.children = [
                        symbolNode("name", SymbolType.String, [], child),
                    ];
                    break;
                case "deletePlaylist":
                    child.children = [
                        symbolNode("name", SymbolType.String, [], child),
                    ];
                    break;
                case "unknown":
                    child.children = [
                        symbolNode("text", SymbolType.String, [], child),
                    ];
                    break;
            }
        }
    }

    open(name: string) {
        const child = this.cursor.children.find(
            (child) => child.symbolName === name,
        );
        if (child) {
            this.cursor = child;
        }
    }

    close() {
        if (this.cursor.parent !== undefined) {
            this.cursor = this.cursor.parent;
        }
    }
    symbolNames() {
        return this.cursor.children.map((child) => child.symbolName);
    }
}

class MessageContainer {
    public readonly div: HTMLDivElement;
    private readonly messageBodyDiv: HTMLDivElement;
    private readonly messageDiv: HTMLDivElement;
    private readonly timestampDiv: HTMLDivElement;
    private readonly iconDiv: HTMLDivElement;
    private metricsDetailDiv?: HTMLDivElement;
    private ttsMetricsDiv?: HTMLDivElement;
    private lastAppendMode?: DisplayAppendMode;
    private completed = false;

    public get source() {
        return this._source;
    }
    constructor(
        className: string,
        private _source: string,
        agents: Map<string, string>,
        beforeElem: Element,
        private hideMetrics,
    ) {
        const div = document.createElement("div");
        div.className = className;

        const timestampDiv = createTimestampDiv(
            new Date(),
            "chat-timestamp-left",
        );
        div.append(timestampDiv);
        this.timestampDiv = timestampDiv;

        const agentIconDiv = document.createElement("div");
        agentIconDiv.className = "agent-icon";
        agentIconDiv.innerText = agents
            .get(_source)
            ?.toString()
            .substring(0, 1) as string;
        div.append(agentIconDiv);
        this.iconDiv = agentIconDiv;

        const messageBodyDiv = document.createElement("div");
        const bodyClass = this.hideMetrics
            ? "chat-message-body-hide-metrics"
            : "chat-message-body";
        messageBodyDiv.className = `${bodyClass} chat-message-agent`;
        div.append(messageBodyDiv);
        this.messageBodyDiv = messageBodyDiv;

        const message = document.createElement("div");
        message.className = "chat-message-content";
        messageBodyDiv.append(message);
        this.messageDiv = message;

        // The chat message list has the style flex-direction: column-reverse;
        beforeElem.before(div);

        this.div = div;
    }

    public getMessage() {
        return this.messageDiv.innerText;
    }
    public setMessage(
        content: DisplayContent,
        source: string,
        sourceIcon?: string,
        appendMode?: DisplayAppendMode,
    ) {
        if (typeof content !== "string" && content.kind === "info") {
            // Don't display info
            return;
        }

        // Flush last temporary reset the lastAppendMode.
        this.flushLastTemporary();

        this._source = source;
        // set source and source icon
        (this.timestampDiv.firstChild as HTMLDivElement).innerText = source; // name
        this.iconDiv.innerText = sourceIcon ?? "❔"; // icon

        setContent(
            this.messageDiv,
            content,
            appendMode === "inline" && this.lastAppendMode !== "inline"
                ? "block"
                : appendMode,
        );
        this.lastAppendMode = appendMode;

        this.updateDivState();
    }

    public complete() {
        this.completed = true;
        this.flushLastTemporary();
        this.updateDivState();
    }

    private updateDivState() {
        if (this.completed && !this.messageDiv.firstChild) {
            this.hide();
        } else {
            this.show();
        }
    }

    private flushLastTemporary() {
        if (this.lastAppendMode === "temporary") {
            this.messageDiv.lastChild?.remove();
            this.lastAppendMode = undefined;
        }
    }

    private ensureMetricsDiv() {
        if (this.metricsDetailDiv === undefined) {
            const metricsContainer = document.createElement("div");
            metricsContainer.className =
                "chat-message-metrics chat-message-metrics-left";
            this.messageBodyDiv.append(metricsContainer);

            const metricsDetails = document.createElement("div");
            metricsDetails.className = "metrics-details";
            metricsContainer.append(metricsDetails);
            this.metricsDetailDiv = metricsDetails;
        }
        return this.metricsDetailDiv;
    }
    public updateMetrics(metrics: PhaseTiming, total?: number) {
        const metricsDiv = this.ensureMetricsDiv();
        updateMetrics(metricsDiv, "Action", metrics, total);
        if (this.ttsMetricsDiv) {
            metricsDiv.prepend(this.ttsMetricsDiv);
        }
    }

    public addTTSTiming(timing: PhaseTiming) {
        if (this.ttsMetricsDiv === undefined) {
            const ttsMetricsDiv = document.createElement("div");
            this.ensureMetricsDiv().prepend(ttsMetricsDiv);
            ttsMetricsDiv.className = "metrics-tts";
            this.ttsMetricsDiv = ttsMetricsDiv;
        }
        const firstChunkTime = timing.marks?.["First Chunk"];
        const firstChunkTimeStr = firstChunkTime
            ? `<br>TTS First Chunk: <b>${formatTimeReaderFriendly(timing.marks!["First Chunk"].duration)}</b>`
            : "";
        this.ttsMetricsDiv!.innerHTML = `TTS Synthesis: <b>${formatTimeReaderFriendly(timing.duration!)}</b>${firstChunkTimeStr}`;
    }
    public show() {
        this.div.classList.remove("chat-message-hidden");
    }
    public hide() {
        this.div.classList.add("chat-message-hidden");
    }
    public scrollIntoView() {
        this.div.scrollIntoView(false);
    }

    public setMetricsVisible(visible: boolean) {
        this.hideMetrics = !visible;
        updateMetricsVisibility(visible, this.messageBodyDiv);
    }
}

function updateMetricsVisibility(visible: boolean, div: HTMLDivElement) {
    const addClass = visible
        ? "chat-message-body"
        : "chat-message-body-hide-metrics";
    const removeClass = visible
        ? "chat-message-body-hide-metrics"
        : "chat-message-body";
    div.classList.remove(removeClass);
    div.classList.add(addClass);
}

class MessageGroup {
    public readonly userMessageContainer: HTMLDivElement;
    public readonly userMessageBody: HTMLDivElement;
    public readonly userMessage: HTMLDivElement;
    public userMetricsDiv?: HTMLDivElement;
    private statusMessage: MessageContainer | undefined;
    private readonly agentMessages: MessageContainer[] = [];
    constructor(
        private readonly chatView: ChatView,
        request: DisplayContent,
        container: HTMLDivElement,
        requestPromise: Promise<RequestMetrics | undefined>,
        timeStamp: Date,
        public agents: Map<string, string>,
        private hideMetrics,
    ) {
        const userMessageContainer = document.createElement("div");
        userMessageContainer.className = "chat-message-right";

        const timeStampDiv = createTimestampDiv(
            timeStamp,
            "chat-timestamp-right",
        );
        userMessageContainer.appendChild(timeStampDiv);

        const userMessageBody = document.createElement("div");
        const bodyClass = this.hideMetrics
            ? "chat-message-body-hide-metrics"
            : "chat-message-body";
        userMessageBody.className = `${bodyClass} chat-message-user`;
        userMessageContainer.appendChild(userMessageBody);

        const userMessage = document.createElement("div");
        userMessage.className = "chat-message-content";
        userMessageBody.appendChild(userMessage);

        setContent(userMessage, request);

        if (container.firstChild) {
            container.firstChild.before(userMessageContainer);

            userMessageContainer.scrollIntoView(false);
        } else {
            container.append(userMessageContainer);
        }

        this.userMessageContainer = userMessageContainer;
        this.userMessageBody = userMessageBody;
        this.userMessage = userMessage;

        requestPromise
            .then((metrics) => this.requestCompleted(metrics))
            .catch((error) => this.requestException(error));
    }

    public setMetricsVisible(visible: boolean) {
        this.hideMetrics = !visible;
        updateMetricsVisibility(visible, this.userMessageBody);
        this.statusMessage?.setMetricsVisible(visible);
        for (const agentMessage of this.agentMessages) {
            agentMessage.setMetricsVisible(visible);
        }
    }
    private requestCompleted(metrics: RequestMetrics | undefined) {
        this.updateMetrics(metrics);
        if (this.statusMessage === undefined) {
            this.addStatusMessage(
                { message: "Command completed", source: "shell" },
                false,
            );
        } else {
            this.statusMessage.complete();
            this.chatView.updateScroll();
        }

        const tts = this.chatView.tts;
        if (tts) {
            for (const agentMessage of this.agentMessages) {
                if (agentMessage.source === "chat") {
                    const message = agentMessage.getMessage();
                    if (message) {
                        tts.speak(message).then((timings) => {
                            if (timings) {
                                agentMessage.addTTSTiming(timings);
                            }
                        });
                    }
                }
            }
        }
    }

    private requestException(error: any) {
        console.error(error);
        this.addStatusMessage(
            { message: `Processing Error: ${error}`, source: "shell" },
            false,
        );
    }

    private ensureStatusMessage(source: string) {
        if (this.statusMessage === undefined) {
            this.statusMessage = new MessageContainer(
                "chat-message-left",
                source,
                this.agents,
                this.userMessageContainer,
                this.hideMetrics,
            );
        }

        return this.statusMessage;
    }

    public addStatusMessage(msg: IAgentMessage, temporary: boolean) {
        let message = msg.message;
        const statusMessage = this.ensureStatusMessage(msg.source);
        statusMessage.setMessage(
            message,
            msg.source,
            this.agents.get(msg.source),
            temporary ? "temporary" : "block",
        );

        this.updateMetrics(msg.metrics);
        this.chatView.updateScroll();
    }

    public updateMetrics(metrics?: RequestMetrics) {
        if (metrics) {
            if (metrics.parse !== undefined) {
                if (this.userMetricsDiv === undefined) {
                    const metricsContainer = document.createElement("div");
                    metricsContainer.className =
                        "chat-message-metrics chat-message-metrics-right";
                    this.userMessageBody.append(metricsContainer);

                    this.userMetricsDiv = document.createElement("div");
                    metricsContainer.append(this.userMetricsDiv);
                    this.userMetricsDiv.className = "metrics-details";
                }
                updateMetrics(
                    this.userMetricsDiv,
                    "Translation",
                    metrics.parse,
                );
            }

            if (metrics.command !== undefined) {
                this.statusMessage?.updateMetrics(metrics.command);
            }

            for (let i = 0; i < this.agentMessages.length; i++) {
                const agentMessage = this.agentMessages[i];
                const info = metrics.actions[i];
                if (info !== undefined) {
                    agentMessage.updateMetrics(
                        info,
                        i === this.agentMessages.length - 1
                            ? metrics.duration
                            : undefined,
                    );
                }
            }
        }
    }

    public ensureAgentMessage(msg: IAgentMessage, notification = false) {
        const statusMessage = this.ensureStatusMessage(msg.source);

        const index = msg.actionIndex;
        if (index === undefined) {
            return statusMessage;
        }
        const agentMessage = this.agentMessages[index];
        if (agentMessage === undefined) {
            let beforeElem = statusMessage;
            for (let i = 0; i < index + 1; i++) {
                if (this.agentMessages[i] === undefined) {
                    const newAgentMessage = new MessageContainer(
                        "chat-message-left",
                        msg.source,
                        this.agents,
                        beforeElem.div,
                        this.hideMetrics,
                    );
                    if (notification) {
                        newAgentMessage.div.classList.add("notification");
                    }
                    this.agentMessages[i] = newAgentMessage;
                }
                beforeElem = this.agentMessages[i];
            }
            this.chatView.updateScroll();
        }

        this.updateMetrics(msg.metrics);
        return this.agentMessages[index];
    }

    public updateMessageText(message: string) {
        this.userMessage.textContent = message;
    }
}

const ansi_up = new AnsiUp();
ansi_up.use_classes = true;

function textToHtml(text: string): string {
    const value = ansi_up.ansi_to_html(text);
    const line = value.replace(/\n/gm, "<br>");
    return line;
}

function stripAnsi(text: string): string {
    return text
        .replace(/&/gm, "&amp;")
        .replace(/</gm, "&lt;")
        .replace(/>/gm, "&gt;")
        .replace(/\x1b\[[0-9;]*m/g, "");
}

const enableText2Html = true;
export function setContent(
    elm: HTMLElement,
    content: DisplayContent,
    appendMode?: DisplayAppendMode,
) {
    // Remove existing content if we are not appending.
    if (appendMode === undefined) {
        while (elm.firstChild) {
            elm.removeChild(elm.firstChild);
        }
    }

    let type: DisplayType;
    let kind: DisplayMessageKind | undefined;
    let text: string;
    if (typeof content === "string") {
        type = "text";
        text = content;
    } else {
        type = content.type;
        text = content.content;
        kind = content.kind;
    }

    const kindStyle = kind ? `chat-message-kind-${kind}` : undefined;

    let contentDiv = elm.lastChild as HTMLDivElement | null;
    if (
        appendMode !== "inline" ||
        !contentDiv ||
        (kindStyle !== undefined && !contentDiv.classList.contains(kindStyle))
    ) {
        // Create a new div
        contentDiv = document.createElement("div");
        if (kindStyle) {
            contentDiv.classList.add(kindStyle);
        }
        elm.appendChild(contentDiv);
    }

    let contentElm: HTMLElement = contentDiv;
    if (type === "text") {
        const prevElm = contentDiv.lastChild as HTMLElement | null;
        if (prevElm?.classList.contains("chat-message-agent-text")) {
            // If there is an existing text element then append to it.
            contentElm = prevElm;
        } else {
            const span = document.createElement("span");
            // create a text span so we can set "whitespace: break-spaces" css style of text content.
            span.className = `chat-message-agent-text`;
            contentDiv.appendChild(span);
            contentElm = span;
        }
    }

    // Process content according to type
    const contentHtml =
        type === "html"
            ? DOMPurify.sanitize(text, { ADD_ATTR: ["target"] })
            : enableText2Html
              ? textToHtml(text)
              : stripAnsi(text);

    contentElm.innerHTML += contentHtml;
}

export function createTimestampDiv(timestamp: Date, className: string) {
    const timeStampDiv = document.createElement("div");
    timeStampDiv.classList.add(className);

    const nameDiv = document.createElement("div");
    nameDiv.className = "agent-name";
    timeStampDiv.appendChild(nameDiv); // name placeholder

    const dateDiv = document.createElement("div");
    dateDiv.className = "timestring";
    timeStampDiv.appendChild(dateDiv); // time string

    setContent(
        timeStampDiv.lastChild as HTMLElement,
        timestamp.toLocaleTimeString(),
    );

    return timeStampDiv;
}

function updateMetrics(
    div: HTMLDivElement,
    name: string,
    metrics: PhaseTiming,
    total?: number,
) {
    // clear out previous perf data
    div.innerHTML = "";
    const marksDiv = document.createElement("div");
    div.append(marksDiv);

    if (metrics.marks) {
        for (const [key, value] of Object.entries(metrics.marks)) {
            const { duration, count } = value;
            const avg = duration / count;
            let mDiv = document.createElement("div");
            mDiv.innerHTML = `${key}: <b>${formatTimeReaderFriendly(avg)}${count > 1 ? ` (avg of ${count})` : ""}</b>`;
            marksDiv.append(mDiv);
        }
    }
    if (metrics.duration) {
        let timeDiv = document.createElement("div");
        timeDiv.innerHTML = `${name} Elapsed Time: <b>${formatTimeReaderFriendly(metrics.duration)}</b>${total !== undefined ? `<br>Total Elapsed Time: <b>${formatTimeReaderFriendly(total)}</b>` : ""}`;
        div.append(timeDiv);
    }
}

function formatTimeReaderFriendly(time: number) {
    if (time < 1) {
        return `${time.toFixed(3)}ms`;
    } else if (time > 1000) {
        return `${(time / 1000).toFixed(1)}s`;
    } else {
        return `${time.toFixed(1)}ms`;
    }
}

export function getSelectionXCoord() {
    let sel = window.getSelection();
    let x = 0;
    if (sel) {
        if (sel.rangeCount) {
            let range = sel.getRangeAt(0).cloneRange();
            if (range.getClientRects) {
                range.collapse(true);
                let rects = range.getClientRects();
                if (rects.length > 0) {
                    const rect = rects[0];
                    x = rect.left;
                }
            }
            // Fall back to inserting a temporary element
            if (x == 0) {
                var span = document.createElement("span");
                if (span.getClientRects) {
                    // Ensure span has dimensions and position by
                    // adding a zero-width space character
                    span.appendChild(document.createTextNode("\u200b"));
                    range.insertNode(span);
                    const rect = span.getClientRects()[0];
                    x = rect.left;
                    var spanParent = span.parentNode;
                    if (spanParent) {
                        spanParent.removeChild(span);
                        // Glue any broken text nodes back together
                        spanParent.normalize();
                    }
                }
            }
        }
    }
    return x;
}

export function proposeYesNo(
    chatView: ChatView,
    askYesNoId: number,
    requestId: string,
    source: string,
    _message: string,
) {
    const choices: InputChoice[] = [
        {
            text: "Yes",
            element: iconCheckMarkCircle(),
            selectKey: ["y", "Y", "Enter"],
            onSelected: (_choice) => {
                chatView.answerYesNo(askYesNoId, true, requestId, source);
                chatView.removeChoicePanel();
            },
        },
        {
            text: "No",
            element: iconX(),
            selectKey: ["n", "N", "Delete"],
            onSelected: (_choice) => {
                chatView.answerYesNo(askYesNoId, false, requestId, source);
                chatView.removeChoicePanel();
            },
        },
    ];
    chatView.addChoicePanel(choices);
}

const DynamicDisplayMinRefreshIntervalMs = 15;
export class ChatView {
    private topDiv: HTMLDivElement;
    private messageDiv: HTMLDivElement;
    private inputContainer: HTMLDivElement;

    private idToMessageGroup: Map<string, MessageGroup> = new Map();
    chatInput: ChatInput;
    idToSearchMenu = new Map<string, SearchMenu>();
    searchMenu: SearchMenu | undefined = undefined;
    searchMenuAnswerHandler: ((item: SearchMenuItem) => void) | undefined =
        undefined;
    keyboardListener: undefined | ((event: KeyboardEvent) => void) = undefined;
    partialInputEnabled = false;
    choicePanel: ChoicePanel | undefined = undefined;
    choicePanelOnly = false;
    commandBackStackIndex = -1;
    registeredActions: Map<string, ActionInfo> = new Map<string, ActionInfo>();
    actionCascade: ActionCascade | undefined = undefined;

    private hideMetrics = true;
    constructor(
        private idGenerator: IdGenerator,
        public agents: Map<string, string>,
        public tts?: TTS,
    ) {
        this.topDiv = document.createElement("div");
        this.topDiv.className = "chat-container";
        this.messageDiv = document.createElement("div");
        this.messageDiv.className = "chat scroll_enabled";

        this.chatInput = new ChatInput(
            "phraseDiv",
            "reco",
            (messageHtml) => {
                // message from chat input are from innerHTML
                this.addUserMessage({
                    type: "html",
                    content: messageHtml,
                });
                if (this.searchMenu) {
                    this.cancelSearchMenu();
                }
            },
            (eta: ExpandableTextarea) => {
                if (this.partialInputEnabled) {
                    this.placeSearchMenu();
                    // TODO: NYI
                } else if (this.searchMenu) {
                    this.placeSearchMenu();
                    this.searchMenu.completePrefix(eta.getEditedText());
                }
            },
            (eta: ExpandableTextarea, ev: KeyboardEvent) => {
                if (this.choicePanel) {
                    if (
                        !this.choicePanelInputHandler(ev) ||
                        this.choicePanelOnly
                    ) {
                        return false;
                    }
                } else if (this.searchMenu) {
                    if (
                        this.searchMenu.handleSpecialKeys(
                            ev,
                            eta.getEditedText(),
                        )
                    ) {
                        return false;
                    }
                } else if (this.chatInput) {
                    if (!ev.altKey && !ev.ctrlKey) {
                        if (ev.key == "ArrowUp" || ev.key == "ArrowDown") {
                            const messages = this.messageDiv.querySelectorAll(
                                ".chat-message-user:not(.chat-message-hidden) .chat-message-content",
                            );

                            if (
                                ev.key == "ArrowUp" &&
                                this.commandBackStackIndex < messages.length - 1
                            ) {
                                this.commandBackStackIndex++;
                            } else if (
                                ev.key == "ArrowDown" &&
                                this.commandBackStackIndex > -1
                            ) {
                                this.commandBackStackIndex--;
                            }

                            if (this.commandBackStackIndex == -1) {
                                this.chatInput.clear();
                            } else if (messages.length > 0) {
                                this.chatInput.textarea.textEntry.textContent =
                                    messages[
                                        this.commandBackStackIndex
                                    ].textContent;
                            }
                        }
                    }
                }
                return true;
            },
        );
        this.inputContainer = this.chatInput.getInputContainer();
        this.topDiv.appendChild(this.messageDiv);

        // Add the input div at the bottom so it's always visible
        this.topDiv.append(this.inputContainer);
    }

    choicePanelInputHandler(ev: KeyboardEvent) {
        if (this.choicePanel !== undefined) {
            const key = ev.key;

            const choice = this.choicePanel.choices.find((c) =>
                c.selectKey?.includes(key),
            );
            if (choice) {
                choice.onSelected(choice);
                this.removeChoicePanel();
                return false;
            }
        }
        return true;
    }

    addChoicePanel(choices: InputChoice[], disableOtherInput = true) {
        if (this.choicePanel) {
            this.removeChoicePanel();
        }
        const panelDiv = document.createElement("div");
        panelDiv.className = "chat-message chat-message-right choice-panel";
        this.choicePanel = { choices, panelDiv };
        for (const choice of choices) {
            const choiceDiv = document.createElement("div");
            choiceDiv.className = "action-button";
            choiceDiv.appendChild(choice.element);
            choiceDiv.addEventListener("click", () => {
                this.removeChoicePanel();
                choice.onSelected(choice);
            });
            panelDiv.appendChild(choiceDiv);
        }
        this.choicePanelOnly = disableOtherInput;
        this.inputContainer.after(panelDiv);
    }

    removeChoicePanel() {
        if (this.choicePanel) {
            this.choicePanel.panelDiv.remove();
            this.choicePanel = undefined;
            this.choicePanelOnly = false;
        }
    }

    placeSearchMenu() {
        if (this.searchMenu) {
            let x = Math.floor(getSelectionXCoord());
            const leftBound = this.inputContainer.getBoundingClientRect().left;
            x -= leftBound;
            this.searchMenu.getContainer().style.left = `${x}px`;
        }
    }

    getActionTemplates(requestId: string) {
        const actionInfo = this.registeredActions.get(requestId);
        if (actionInfo === undefined) {
            console.error(`Invalid requestId ${requestId}`);
            return undefined;
        }
        return actionInfo.actionTemplates;
    }

    proposeAction(message: string, requestId: string) {
        // use this div to show the proposed action
        const actionContainer = document.createElement("div");
        actionContainer.className = "action-container";
        if (message === "reserved") {
            // build the action div from the reserved action templates
            const actionTemplates = this.getActionTemplates(requestId);
            if (actionTemplates !== undefined) {
                this.actionCascade = new ActionCascade(actionTemplates);
                const actionDiv = this.actionCascade.toHTML();
                actionDiv.className = "action-text";
                actionContainer.appendChild(actionDiv);
            }
        } else {
            const actionDiv = document.createElement("div");
            actionDiv.className = "action-text";
            setContent(actionDiv, message);
            actionContainer.appendChild(actionDiv);
        }
        return actionContainer;
    }

    registerSearchMenu(
        id: string,
        initialChoices: SearchMenuItem[],
        visible = true,
        prefix = "",
    ) {
        const searchMenu = new SearchMenu(
            (item) => this.searchMenuOnSelection(item),
            false,
        );
        searchMenu.setChoices(initialChoices);
        this.idToSearchMenu.set(id, searchMenu);
        if (visible) {
            this.setSearchMenu(searchMenu, prefix);
        }
    }

    searchMenuOnSelection(item: SearchMenuItem) {
        if (this.searchMenu) {
            console.log(`Selected: ${item.matchText}`);
            if (this.searchMenuAnswerHandler) {
                this.searchMenuAnswerHandler(item);
            } else {
                console.error("No selection handler");
            }
            this.chatInput.clear();
            this.cancelSearchMenu();
        }
    }

    completeSearchMenu(id: string, prefix = "") {
        const searchMenu = this.idToSearchMenu.get(id);
        if (searchMenu) {
            searchMenu.completePrefix(prefix);
        }
    }

    showSearchMenu(id: string, prefix = "") {
        const searchMenu = this.idToSearchMenu.get(id);
        if (searchMenu) {
            this.setSearchMenu(searchMenu, prefix);
        }
    }

    cancelSearchMenu() {
        if (this.searchMenu) {
            this.searchMenu.getContainer().remove();
            this.searchMenu = undefined;
            this.searchMenuAnswerHandler = undefined;
        }
    }

    registerActionStructure(
        actionTemplates: ActionTemplateSequence,
        requestId: string,
    ) {
        this.registeredActions.set(requestId, {
            actionTemplates,
            requestId,
        });
    }

    actionCommand(
        actionTemplates: ActionTemplateSequence,
        command: ActionUICommand,
        requestId: string,
    ) {
        switch (command) {
            case "register":
                this.registerActionStructure(actionTemplates, requestId);
                break;
            case "remove":
                this.registeredActions.delete(requestId);
                break;
            case "replace":
                break;
        }
    }

    searchMenuCommand(
        menuId: string,
        command: string,
        prefix = "",
        choices: SearchMenuItem[] = [],
        visible = true,
    ) {
        switch (command) {
            case "register":
                this.registerSearchMenu(menuId, choices, visible, prefix);
                break;
            case "complete":
                this.completeSearchMenu(menuId, prefix);
                break;
            case "cancel":
                this.cancelSearchMenu();
                break;
            case "legend":
                if (this.searchMenu) {
                    this.searchMenu.addLegend(prefix);
                }
                break;
            case "show":
                this.showSearchMenu(menuId, prefix);
                break;
            case "remove":
                if (this.idToSearchMenu.has(menuId)) {
                    this.cancelSearchMenu();
                    this.idToSearchMenu.delete(menuId);
                }
                break;
        }
    }

    setSearchMenu(searchMenu: SearchMenu, prefix = "") {
        this.searchMenu = searchMenu;
        const searchContainer = this.searchMenu.getContainer();
        this.inputContainer.appendChild(searchContainer);
        this.placeSearchMenu();
        this.searchMenu.completePrefix(prefix);
    }

    enablePartialInputHandler(_enabled: boolean) {
        // this.partialInputEnabled = enabled;
        // console.log(`Partial input handler enabled: ${enabled}`);
    }

    private dynamicDisplays: {
        source: string;
        id: string;
        actionIndex: number;
        displayId: string;
        nextRefreshTime: number;
    }[] = [];
    private timer: number | undefined = undefined;
    private scheduledRefreshTime: number | undefined = undefined;
    setDynamicDisplay(
        source: string,
        id: string,
        actionIndex: number,
        displayId: string,
        nextRefreshMs: number,
    ) {
        const now = Date.now();
        const agentMessage = this.ensureAgentMessage({
            message: "",
            requestId: id,
            source: source,
            actionIndex: actionIndex,
        });
        if (agentMessage === undefined) {
            return;
        }
        this.dynamicDisplays.push({
            source,
            id,
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
                    result = await getClientAPI().getDynamicDisplay(
                        source,
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
                    { dynamicUpdate: true },
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
                    { dynamicUpdate: true },
                );
            }

            item = this.dynamicDisplays[0];
        }
        this.scheduleDynamicDisplayRefresh(now);
    }

    private getMessageGroup(id: string) {
        const messageGroup = this.idToMessageGroup.get(id);
        if (messageGroup === undefined) {
            console.error(`Invalid requestId ${id}`);
        }
        return messageGroup;
    }

    showStatusMessage(msg: IAgentMessage, temporary: boolean) {
        this.getMessageGroup(msg.requestId as string)?.addStatusMessage(
            msg,
            temporary,
        );
        this.updateScroll();
    }

    clear() {
        this.messageDiv.replaceChildren();
        this.idToMessageGroup.clear();
        this.commandBackStackIndex = -1;
    }

    async addUserMessage(request: DisplayContent, hidden: boolean = false) {
        const id = this.idGenerator.genId();

        let images: string[] = [];
        let requestText: string;
        if (typeof request === "string") {
            requestText = request;
        } else if (request.type === "html") {
            let tempDiv: HTMLDivElement = document.createElement("div");
            tempDiv.innerHTML = request.content;
            images = await this.extractMultiModalContent(tempDiv);
            requestText = tempDiv.innerText;
            request.content = tempDiv.innerHTML;
        } else {
            requestText = request.content;
        }

        const mg: MessageGroup = new MessageGroup(
            this,
            request,
            this.messageDiv,
            getClientAPI().processShellRequest(requestText, id, images),
            new Date(),
            this.agents,
            this.hideMetrics,
        );

        if (hidden) {
            mg.userMessageContainer.classList.add("chat-message-hidden");
            mg.userMessage.classList.add("chat-message-hidden");
        }

        this.idToMessageGroup.set(id, mg);
        this.updateScroll();
        this.commandBackStackIndex = -1;
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
                retVal[i] = `data:image/png;base64,` + _arrayBufferToBase64(ab);
            } else {
                console.log("Unknown image source type.");
            }
        }

        return retVal;
    }

    markRequestExplained(id: string, timestamp: string, fromCache?: boolean) {
        const pair = this.idToMessageGroup.get(id);
        if (pair !== undefined) {
            if (timestamp !== undefined) {
                const cachePart = fromCache ? "by cache match" : "by model";
                pair.userMessage.setAttribute(
                    "data-expl",
                    `Explained ${cachePart} at ${timestamp}`,
                );
            }
            pair.userMessage.classList.add("chat-message-explained");
            const icon = iconRoadrunner();
            icon.getElementsByTagName("svg")[0].style.fill = fromCache
                ? "#00c000"
                : "#c0c000";
            icon.className = "chat-message-explained-icon";
            pair.userMessage.appendChild(icon);
        }
    }

    randomCommandSelected(id: string, message: string) {
        const pair = this.idToMessageGroup.get(id);
        if (pair !== undefined) {
            if (message.length > 0) {
                pair.updateMessageText(message);
            }
        }
    }

    addAgentMessage(
        msg: IAgentMessage,
        options?: {
            appendMode?: DisplayAppendMode;
            dynamicUpdate?: boolean;
            notification?: boolean;
        },
    ) {
        const dynamicUpdate = options?.dynamicUpdate ?? false;
        const notification = options?.notification ?? false;
        const content: DisplayContent = msg.message;
        const source: string = msg.source;

        const agentMessage = this.ensureAgentMessage(msg, notification);
        if (agentMessage === undefined) {
            return;
        }
        agentMessage.setMessage(
            content,
            source,
            this.agents.get(source),
            options?.appendMode,
        );

        if (!dynamicUpdate) {
            this.updateScroll();
            this.chatInputFocus();
        }
    }
    updateScroll() {
        if (this.messageDiv.firstElementChild) {
            this.messageDiv.firstElementChild.scrollIntoView(false);
        }
    }

    private ensureAgentMessage(msg: IAgentMessage, notification = false) {
        return this.getMessageGroup(
            msg.requestId as string,
        )?.ensureAgentMessage(msg, notification);
    }

    chatInputFocus() {
        setTimeout(() => {
            const input = this.inputContainer.querySelector(
                "#phraseDiv",
            ) as HTMLDivElement;
            if (input) {
                input.focus();
            }
        }, 0);
    }

    askYesNo(
        askYesNoId: number,
        message: string,
        requestId: string,
        source: string,
    ) {
        const agentMessage = this.ensureAgentMessage({
            message: "",
            requestId,
            source,
        });
        if (agentMessage === undefined) {
            return;
        }
        agentMessage.div.className = "chat-message chat-message-confirm";
        const proposeElm = this.proposeAction(message, requestId);
        agentMessage.div.appendChild(proposeElm);
        proposeYesNo(this, askYesNoId, requestId, message, source);
        this.updateScroll();
    }

    answerYesNo(
        questionId: number,
        answer: boolean,
        requestId: string,
        source: string,
    ) {
        let message = answer ? "Accepted!" : "Rejected!";
        this.showStatusMessage(
            {
                message,
                requestId,
                source,
            },
            true,
        );
        getClientAPI().sendYesNo(questionId, answer);
        this.chatInputFocus();
    }

    question(
        questionId: number,
        message: string,
        requestId: string,
        source: string,
    ) {
        const agentMessage = this.ensureAgentMessage({
            message: "",
            requestId,
            source,
        });
        if (agentMessage === undefined) {
            return;
        }
        agentMessage.div.innerHTML = "";
        this.showStatusMessage({ message, requestId, source }, true);
        if (this.searchMenu) {
            this.searchMenuAnswerHandler = (item) => {
                this.answer(questionId, item.selectedText, requestId);
            };
        } else {
            const replacementElm = questionInput(
                this,
                questionId,
                message,
                requestId,
            );
            agentMessage.div.appendChild(replacementElm);
        }
    }

    answer(questionId: number, answer: string, requestId: string) {
        let message = "Answer sent!";
        let source = "shell";
        this.showStatusMessage({ message, requestId, source }, true);
        console.log(answer);
        getClientAPI().sendAnswer(questionId, answer);
    }

    getMessageElm() {
        return this.topDiv;
    }

    async showInputText(message: string) {
        const input = this.inputContainer.querySelector(
            "#phraseDiv",
        ) as HTMLDivElement;

        for (let i = 0; i < message.length; i++) {
            input.innerHTML += message.charAt(i);
            const keyDelay = 25 + Math.floor(Math.random() * 15);
            await new Promise((f) => setTimeout(f, keyDelay));
        }

        const keyboardEvent = new KeyboardEvent("keydown", {
            key: "Enter",
        });

        input.dispatchEvent(keyboardEvent);

        (window as any).electron.ipcRenderer.send("send-input-text-complete");
    }

    public setMetricsVisible(visible: boolean) {
        this.hideMetrics = !visible;
        for (const messageGroup of this.idToMessageGroup.values()) {
            messageGroup.setMetricsVisible(visible);
        }
    }
}

export function _arrayBufferToBase64(buffer: ArrayBuffer) {
    let binary = "";
    const bytes = new Uint8Array(buffer);
    const len = bytes.byteLength;
    for (var i = 0; i < len; i++) {
        binary += String.fromCharCode(bytes[i]);
    }
    return window.btoa(binary);
}

export function _base64ToArrayBuffer(base64: string): Uint8Array {
    const binaryString = window.atob(base64);
    const len = binaryString.length;
    const bytes: Uint8Array = new Uint8Array(len);
    for (let i = 0; i < len; i++) {
        bytes[i] = binaryString.charCodeAt(i);
    }
    return bytes;
}

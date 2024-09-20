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
import { TTS, TTSMetrics } from "./tts";
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

function metricsString(name: string, duration: number, count = 1) {
    const avg = duration / count;
    return `${name}: <b>${formatTimeReaderFriendly(avg)}${count !== 1 ? `(out of ${count})` : ""}</b>`;
}

class MessageContainer {
    public readonly div: HTMLDivElement;
    private readonly messageBodyDiv: HTMLDivElement;
    private readonly messageDiv: HTMLDivElement;
    private readonly timestampDiv: HTMLDivElement;
    private readonly iconDiv: HTMLDivElement;

    private metricsDiv?: {
        mainMetricsDiv: HTMLDivElement;
        markMetricsDiv: HTMLDivElement;
        ttsMetricsDiv: HTMLDivElement;
        firstResponseMetricsDiv: HTMLDivElement;
    };

    private messageStart?: number;
    private audioStart?: number;
    private ttsFirstChunkTotal: number = 0;
    private ttsFirstChunkCount: number = 0;
    private ttsSynthesisTotal: number = 0;

    private lastAppendMode?: DisplayAppendMode;
    private completed = false;
    private pendingSpeakText: string = "";

    public get source() {
        return this._source;
    }

    private updateSource() {
        const source = this._source;
        const sourceIcon = this.agents.get(source);

        // set source and source icon
        (this.timestampDiv.firstChild as HTMLDivElement).innerText = source; // name
        this.iconDiv.innerText = sourceIcon ?? "❔"; // icon
    }

    constructor(
        private chatView: ChatView,
        className: string,
        private _source: string,
        private readonly agents: Map<string, string>,
        beforeElem: Element,
        private hideMetrics: boolean,
        private readonly requestStart: number,
        private showFirstResponseMetrics = false,
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
        this.updateSource();
    }

    public getMessage() {
        return this.messageDiv.innerText;
    }

    public setMessage(
        content: DisplayContent,
        source: string,
        appendMode?: DisplayAppendMode,
    ) {
        if (typeof content !== "string" && content.kind === "info") {
            // Don't display info
            return;
        }

        if (this.messageStart === undefined) {
            // Don't count dispatcher status messages as first response.
            if (source !== "dispatcher") {
                this.messageStart = performance.now();
                this.updateFirstResponseMetrics();
            }
        }

        // Flush last temporary reset the lastAppendMode.
        this.flushLastTemporary();

        this._source = source;
        this.updateSource();

        const speakText = setContent(
            this.messageDiv,
            content,
            appendMode === "inline" && this.lastAppendMode !== "inline"
                ? "block"
                : appendMode,
        );

        this.speak(speakText, appendMode);

        this.lastAppendMode = appendMode;

        this.updateDivState();
    }

    private speakText(tts: TTS, speakText: string) {
        let cbAudioStart: (() => void) | undefined;
        if (this.audioStart === undefined) {
            this.audioStart = -1;
            cbAudioStart = () => {
                this.audioStart = performance.now();
                this.updateFirstResponseMetrics();
            };
        }
        const p = tts.speak(speakText, cbAudioStart);
        p.then((timing) => {
            if (timing) {
                this.addTTSTiming(timing);
            }
        });
    }

    private speak(
        speakText: string | undefined,
        appendMode?: DisplayAppendMode,
    ) {
        const tts = this.chatView.tts;
        if (tts === undefined) {
            return;
        }
        if (speakText === undefined) {
            // Flush the pending text.
            this.flushPendingSpeak(tts);
            return;
        }

        if (appendMode !== "inline") {
            this.flushPendingSpeak(tts);
            this.speakText(tts, speakText);
            return;
        }

        this.pendingSpeakText += speakText;
        const minSpeak = 10; // TODO: Adjust this value.
        if (this.pendingSpeakText.length <= minSpeak) {
            // Too short to speak.
            return;
        }
        const segmenter = new Intl.Segmenter(navigator.language, {
            granularity: "sentence",
        });
        const segments = Array.from(segmenter.segment(this.pendingSpeakText));

        if (segments.length < 2) {
            // No sentence boundary.
            return;
        }

        // Try Keep the last segment and speak the rest.
        const index = segments[segments.length - 1].index;
        if (index <= minSpeak) {
            // Too short to speak.
            return;
        }

        const speakTextPartial = this.pendingSpeakText.slice(0, index);
        this.pendingSpeakText = this.pendingSpeakText.slice(index);
        this.speakText(tts, speakTextPartial);
    }

    private flushPendingSpeak(tts: TTS) {
        // Flush the pending text.
        if (this.pendingSpeakText) {
            this.speakText(tts, this.pendingSpeakText);
            this.pendingSpeakText = "";
        }
    }

    public complete() {
        this.completed = true;
        if (this.chatView.tts) {
            this.flushPendingSpeak(this.chatView.tts);
        }
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
        if (this.metricsDiv === undefined) {
            const metricsContainer = document.createElement("div");
            metricsContainer.className =
                "chat-message-metrics chat-message-metrics-left";
            this.messageBodyDiv.append(metricsContainer);

            const metricsDetails = document.createElement("div");
            metricsDetails.className = "metrics-details";
            metricsContainer.append(metricsDetails);

            const left = document.createElement("div");
            metricsDetails.append(left);
            const middle = document.createElement("div");
            metricsDetails.append(middle);
            const right = document.createElement("div");
            metricsDetails.append(right);

            const firstResponseMetricsDiv = document.createElement("div");
            left.append(firstResponseMetricsDiv);

            const markMetricsDiv = document.createElement("div");
            middle.append(markMetricsDiv);

            // Only show with dev UI.
            const ttsMetricsDiv = document.createElement("div");
            ttsMetricsDiv.className = "tts-metrics";
            middle.append(ttsMetricsDiv);

            const mainMetricsDiv = document.createElement("div");
            right.append(mainMetricsDiv);

            this.metricsDiv = {
                mainMetricsDiv,
                markMetricsDiv,
                ttsMetricsDiv,
                firstResponseMetricsDiv,
            };
        }
        return this.metricsDiv;
    }

    public updateMainMetrics(metrics?: PhaseTiming, total?: number) {
        if (metrics === undefined && total === undefined) {
            return;
        }
        const metricsDiv = this.ensureMetricsDiv();
        updateMetrics(
            metricsDiv.mainMetricsDiv,
            metricsDiv.markMetricsDiv,
            "Action",
            metrics,
            total,
        );
    }

    private updateFirstResponseMetrics() {
        if (this.showFirstResponseMetrics) {
            const messages: string[] = [];
            if (this.messageStart !== undefined) {
                messages.push(
                    metricsString(
                        "First Message",
                        this.messageStart - this.requestStart,
                    ),
                );
            }
            if (this.audioStart !== undefined) {
                messages.push(
                    metricsString(
                        "First Audio",
                        this.audioStart - this.requestStart,
                    ),
                );
            }
            const div = this.ensureMetricsDiv().firstResponseMetricsDiv;
            div.innerHTML = messages.join("<br>");
        } else if (this.metricsDiv) {
            this.metricsDiv.firstResponseMetricsDiv.innerHTML = "";
        }
    }

    public setFirstResponseMetricsVisibility(visible: boolean) {
        this.showFirstResponseMetrics = visible;
        this.updateFirstResponseMetrics();
    }

    public addTTSTiming(timing: TTSMetrics) {
        const messages: string[] = [];
        if (timing.firstChunkTime) {
            this.ttsFirstChunkTotal += timing.firstChunkTime;
            this.ttsFirstChunkCount++;
        }
        this.ttsSynthesisTotal += timing.duration;

        if (this.ttsFirstChunkCount !== 0) {
            messages.push(
                metricsString(
                    "TTS First Chunk",
                    this.ttsFirstChunkTotal,
                    this.ttsFirstChunkCount,
                ),
            );
        }
        messages.push(metricsString("TTS Synthesis", this.ttsSynthesisTotal));
        this.ensureMetricsDiv().ttsMetricsDiv.innerHTML = messages.join("<br>");
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
    public metricsDiv?: {
        mainMetricsDiv: HTMLDivElement;
        markMetricsDiv: HTMLDivElement;
    };
    private statusMessage: MessageContainer | undefined;
    private readonly agentMessages: MessageContainer[] = [];
    private readonly start: number = performance.now();
    constructor(
        private readonly chatView: ChatView,
        request: DisplayContent,
        container: HTMLDivElement,
        requestPromise: Promise<RequestMetrics | undefined>,
        timeStamp: Date,
        public agents: Map<string, string>,
        private hideMetrics: boolean,
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

        this.chatView.tts?.stop();

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
                this.chatView,
                "chat-message-left",
                source,
                this.agents,
                this.userMessageContainer,
                this.hideMetrics,
                this.start,
                true,
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
            temporary ? "temporary" : "block",
        );

        this.updateMetrics(msg.metrics);
        this.chatView.updateScroll();
    }

    public updateMetrics(metrics?: RequestMetrics) {
        if (metrics) {
            if (metrics.parse !== undefined) {
                if (this.metricsDiv === undefined) {
                    const metricsContainer = document.createElement("div");
                    metricsContainer.className =
                        "chat-message-metrics chat-message-metrics-right";
                    this.userMessageBody.append(metricsContainer);

                    const metricsDetails = document.createElement("div");
                    metricsDetails.className = "metrics-details";
                    metricsContainer.append(metricsDetails);

                    const left = document.createElement("div");
                    metricsDetails.append(left);
                    const right = document.createElement("div");
                    metricsDetails.append(right);
                    this.metricsDiv = {
                        mainMetricsDiv: right,
                        markMetricsDiv: left,
                    };
                }
                updateMetrics(
                    this.metricsDiv.mainMetricsDiv,
                    this.metricsDiv.markMetricsDiv,
                    "Translation",
                    metrics.parse,
                );
            }

            this.statusMessage?.updateMainMetrics(
                metrics.command,
                this.agentMessages.length === 0 ? metrics.duration : undefined,
            );

            for (let i = 0; i < this.agentMessages.length; i++) {
                const agentMessage = this.agentMessages[i];
                const info = metrics.actions[i];
                agentMessage.updateMainMetrics(
                    info,
                    i === this.agentMessages.length - 1
                        ? metrics.duration
                        : undefined,
                );
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
            statusMessage.setFirstResponseMetricsVisibility(false);
            let beforeElem = statusMessage;
            for (let i = 0; i < index + 1; i++) {
                if (this.agentMessages[i] === undefined) {
                    const newAgentMessage = new MessageContainer(
                        this.chatView,
                        "chat-message-left",
                        msg.source,
                        this.agents,
                        beforeElem.div,
                        this.hideMetrics,
                        this.start,
                        i === 0,
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
    return text.replace(/\x1b\[[0-9;]*m/g, "");
}

function encodeTextToHtml(text: string): string {
    return text
        .replace(/&/gm, "&amp;")
        .replace(/</gm, "&lt;")
        .replace(/>/gm, "&gt;");
}

const enableText2Html = true;

function matchKindStyle(elm: HTMLElement, kindStyle?: string) {
    if (kindStyle !== undefined) {
        return elm.classList.contains(kindStyle);
    }
    for (const cls of elm.classList) {
        if (cls.startsWith("chat-message-kind-")) {
            return false;
        }
    }
    return true;
}

export function setContent(
    elm: HTMLElement,
    content: DisplayContent,
    appendMode?: DisplayAppendMode,
): string | undefined {
    // Remove existing content if we are not appending.
    if (appendMode === undefined) {
        while (elm.firstChild) {
            elm.removeChild(elm.firstChild);
        }
    }

    let type: DisplayType;
    let kind: DisplayMessageKind | undefined;
    let text: string;
    let speak: boolean;
    if (typeof content === "string") {
        type = "text";
        text = content;
        speak = false;
    } else {
        type = content.type;
        text = content.content;
        kind = content.kind;
        speak = content.speak ?? false;
    }

    const kindStyle = kind ? `chat-message-kind-${kind}` : undefined;

    let contentDiv = elm.lastChild as HTMLDivElement | null;
    let newDiv = true;
    if (
        appendMode !== "inline" ||
        !contentDiv ||
        !matchKindStyle(contentDiv, kindStyle)
    ) {
        // Create a new div
        contentDiv = document.createElement("div");
        if (kindStyle) {
            contentDiv.classList.add(kindStyle);
        }
        if (appendMode === "inline") {
            contentDiv.style.display = "inline-block";
        }
        elm.appendChild(contentDiv);
        newDiv = false;
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
              : stripAnsi(encodeTextToHtml(text));

    contentElm.innerHTML += contentHtml;

    if (!speak) {
        return undefined;
    }
    if (type === "text") {
        return stripAnsi(text);
    }

    if (newDiv) {
        return contentElm.innerText;
    }

    const parser = new DOMParser();
    return parser.parseFromString(contentHtml, "text/html").body.innerText;
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
    mainMetricsDiv: HTMLDivElement,
    markMetricsDiv: HTMLDivElement,
    name: string,
    metrics?: PhaseTiming,
    total?: number,
) {
    // clear out previous perf data
    mainMetricsDiv.innerHTML = "";
    markMetricsDiv.innerHTML = "";

    if (metrics?.marks) {
        const messages: string[] = [];
        for (const [key, value] of Object.entries(metrics.marks)) {
            const { duration, count } = value;
            messages.push(metricsString(key, duration, count));
        }
        markMetricsDiv.innerHTML = messages.join("<br>");
    }
    const messages: string[] = [];
    if (metrics?.duration) {
        messages.push(metricsString(`${name} Elapsed Time`, metrics.duration));
    }
    if (total !== undefined) {
        messages.push(metricsString("Total Elapsed Time", total));
    }
    mainMetricsDiv.innerHTML = messages.join("<br>");
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

                            if (messages.length !== 0) {
                                if (
                                    ev.key == "ArrowUp" &&
                                    this.commandBackStackIndex <
                                        messages.length - 1
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
                                } else {
                                    const content =
                                        messages[this.commandBackStackIndex]
                                            .textContent;
                                    this.chatInput.textarea.setContent(content);
                                }
                                return false;
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
            ".chat-inpput-dropImage",
        );
        let retVal: string[] = new Array<string>(images.length);
        for (let i = 0; i < images.length; i++) {
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
        agentMessage.setMessage(content, source, options?.appendMode);

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

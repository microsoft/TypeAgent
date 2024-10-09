// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { IdGenerator, getClientAPI } from "./main";
import { ChatInput, ExpandableTextarea, questionInput } from "./chatInput";
import { iconCheckMarkCircle, iconX } from "./icon";
import {
    ActionTemplateSequence
} from "../../preload/electronTypes";
import {
    DisplayAppendMode,
    DisplayContent,
    DynamicDisplay,
} from "@typeagent/agent-sdk";
import { TTS } from "./tts/tts";
import { IAgentMessage } from "agent-dispatcher";

import { PartialCompletion } from "./partial";
import { InputChoice } from "./choicePanel";
import { MessageGroup } from "./messageGroup";

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

const DynamicDisplayMinRefreshIntervalMs = 15;
export class ChatView {
    private topDiv: HTMLDivElement;
    private messageDiv: HTMLDivElement;
    private inputContainer: HTMLDivElement;

    private idToMessageGroup: Map<string, MessageGroup> = new Map();
    chatInput: ChatInput;
    private partialCompletion: PartialCompletion | undefined;

    commandBackStackIndex = -1;

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
            },
            (_eta: ExpandableTextarea) => {
                if (this.partialCompletion) {
                    this.partialCompletion.update();
                }
            },
            (_eta: ExpandableTextarea, ev: KeyboardEvent) => {
                if (this.partialCompletion?.handleSpecialKeys(ev) === true) {
                    return false;
                }

                // history
                if (!ev.altKey && !ev.ctrlKey) {
                    if (ev.key == "ArrowUp" || ev.key == "ArrowDown") {
                        const messages = this.messageDiv.querySelectorAll(
                            ".chat-message-user:not(.chat-message-hidden) .chat-message-content",
                        );

                        if (messages.length !== 0) {
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

                return true;
            },
        );
        this.inputContainer = this.chatInput.getInputContainer();
        this.topDiv.appendChild(this.messageDiv);

        // Add the input div at the bottom so it's always visible
        this.topDiv.append(this.inputContainer);
    }

    enablePartialInput(enabled: boolean) {
        if (enabled) {
            if (this.partialCompletion === undefined) {
                this.partialCompletion = new PartialCompletion(
                    this.inputContainer,
                    this.chatInput.textarea,
                );
            }
        } else {
            this.partialCompletion?.close();
            this.partialCompletion = undefined;
        }
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
            // for agent initiated messages we need to create an associated message group
            if (id.startsWith("agent-")) {
                const mg: MessageGroup = new MessageGroup(
                    this,
                    "",
                    this.messageDiv,
                    undefined,
                    this.agents,
                    this.hideMetrics,
                );

                this.idToMessageGroup.set(id, mg);

                mg.hideUserMessage();

                return mg;
            }

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
            this.agents,
            this.hideMetrics,
        );

        if (hidden) {
            mg.hideUserMessage();
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
        this.idToMessageGroup
            .get(id)
            ?.markRequestExplained(timestamp, fromCache);
    }

    randomCommandSelected(id: string, message: string) {
        const pair = this.idToMessageGroup.get(id);
        if (pair !== undefined) {
            if (message.length > 0) {
                pair.updateUserMessage(message);
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
    public chatInputFocus() {
        this.chatInput.focus();
    }

    public askYesNo(
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
        agentMessage.setMessage(message, source, "inline");
        const choices: InputChoice[] = [
            {
                text: "Yes",
                element: iconCheckMarkCircle(),
                selectKey: ["y", "Y", "Enter"],
                value: true,
            },
            {
                text: "No",
                element: iconX(),
                selectKey: ["n", "N", "Delete"],
                value: false,
            },
        ];
        agentMessage.addChoicePanel(choices, (choice) => {
            agentMessage.setMessage(`  ${choice.text}`, source, "inline");
            getClientAPI().sendYesNo(askYesNoId, choice.value);
        });
        this.updateScroll();
    }

    public proposeAction(
        proposeActionId: number,
        actionTemplates: ActionTemplateSequence,
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
        agentMessage.proposeAction(proposeActionId, actionTemplates);
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

        const replacementElm = questionInput(
            this,
            questionId,
            message,
            requestId,
        );
        agentMessage.div.appendChild(replacementElm);
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

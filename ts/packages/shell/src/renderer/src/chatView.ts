// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { IdGenerator, getClientAPI } from "./main";
import { ChatInput, ExpandableTextarea, questionInput } from "./chatInput";
import { SpeechInfo } from "./speech";
import { SearchMenu } from "./search";
import { AnsiUp } from "ansi_up";
import { iconCheckMarkCircle, iconX, iconRoadrunner } from "./icon";
import {
    ActionInfo,
    ActionTemplateSequence,
    ActionUICommand,
    IAgentMessage,
    IMessageMetrics,
    SearchMenuItem,
} from "../../preload/electronTypes";
import { ActionCascade } from "./ActionCascade";

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

class MessageGroup {
    public readonly userMessageContainer: HTMLDivElement;
    public readonly userMessage: HTMLDivElement;
    private statusMessageDiv: HTMLDivElement | undefined;
    private readonly statusMessages: { message: string; temporary: boolean }[] =
        [];
    private readonly agentMessageDivs: HTMLDivElement[] = [];

    private completed = false;
    constructor(
        request: string,
        container: HTMLDivElement,
        requestPromise: Promise<void>,
        timeStamp: Date,
        public agents: Map<string, string>,
    ) {
        const userMessageContainer = document.createElement("div");
        userMessageContainer.className = "chat-message-right";

        const timeStampDiv = createTimestampDiv(
            timeStamp,
            "chat-timestamp-right",
        );
        userMessageContainer.appendChild(timeStampDiv);

        const userMessage = document.createElement("div");
        userMessage.className = "chat-message-user";
        userMessageContainer.appendChild(userMessage);

        setContent(userMessage, request);

        if (container.firstChild) {
            container.firstChild.before(userMessageContainer);

            userMessageContainer.scrollIntoView(false);
        } else {
            container.append(userMessageContainer);
        }

        this.userMessageContainer = userMessageContainer;
        this.userMessage = userMessage;

        requestPromise
            .then(() => this.requestCompleted())
            .catch((error) => this.requestException(error));
    }

    private requestCompleted() {
        this.completed = true;
        if (this.statusMessages.length === 0) {
            this.addStatusMessage("Request completed", "shell", true);
        }
        this.updateStatusMessageDivState();
    }

    private updateStatusMessageDivState() {
        if (this.statusMessageDiv === undefined) {
            return;
        }
        if (
            !this.completed ||
            this.agentMessageDivs.length === 0 ||
            this.statusMessages.some((m) => !m.temporary)
        ) {
            this.statusMessageDiv.classList.remove("chat-message-hidden");

            if (
                this.userMessageContainer.parentElement?.firstChild ==
                this.statusMessageDiv
            ) {
                this.statusMessageDiv.scrollIntoView(false);
            }

            return;
        }

        if (this.agentMessageDivs.length > 0) {
            this.agentMessageDivs[
                this.agentMessageDivs.length - 1
            ].scrollIntoView(false);
        }

        this.statusMessageDiv.classList.add("chat-message-hidden");
    }

    private requestException(error: any) {
        console.error(error);
        this.addStatusMessage(`Processing Error: ${error}`, `Shell`, false);
    }

    private ensureStatusMessageDiv(source: string) {
        if (this.statusMessageDiv === undefined) {
            this.statusMessageDiv = document.createElement("div");
            this.setupAgentMessageDiv(
                this.statusMessageDiv,
                "chat-message chat-message-temp",
                "chat-message-agent",
                source,
            );
            this.userMessageContainer.before(this.statusMessageDiv);
        }

        return this.statusMessageDiv;
    }

    public addStatusMessage(
        message: string,
        source: string,
        temporary: boolean,
    ) {
        const div = this.ensureStatusMessageDiv(source)
            .lastChild?.previousSibling as HTMLDivElement;
        setSource(this.statusMessageDiv as HTMLDivElement, source, this.agents);

        let contentDiv: HTMLDivElement;
        if (
            this.statusMessages.length !== 0 &&
            this.statusMessages[this.statusMessages.length - 1]?.temporary
        ) {
            contentDiv = div.lastChild as HTMLDivElement;
        } else {
            contentDiv = document.createElement("div");
            div.appendChild(contentDiv);
        }
        this.statusMessages.push({ message, temporary });

        setContent(contentDiv, message);

        this.updateStatusMessageDivState();
    }

    public setupAgentMessageDiv(
        messageDiv: HTMLDivElement,
        classes: string,
        messageClass: string,
        source: string,
        metrics: IMessageMetrics | undefined = undefined
    ) {
        messageDiv.className = classes;

        const timestampDiv = createTimestampDiv(
            new Date(),
            "chat-timestamp-left",
        );
        messageDiv.append(timestampDiv);

        const agentIconDiv = document.createElement("div");
        agentIconDiv.className = "agent-icon";
        agentIconDiv.innerText = this.agents
            .get(source as string)
            ?.toString()
            .substring(0, 1) as string;
        messageDiv.append(agentIconDiv);

        const message = document.createElement("div");
        message.className = messageClass;
        messageDiv.append(message);

        const metricsDiv = document.createElement("div");
        metricsDiv.className = "chat-message-metrics";
        messageDiv.append(metricsDiv);

        if (metrics) {
            if (metrics.duration) {
                if (metrics.duration < 1) {
                    metricsDiv.innerText = `${metrics.duration.toFixed(3)}ms`;
                } else if (metrics.duration > 1000) {
                    metricsDiv.innerText = `${(metrics.duration / 1000).toFixed(1)}s`
                } else {
                    metricsDiv.innerText = `${metrics.duration.toFixed(1)}ms`;
                }
            }
            else {
                metricsDiv.innerText = "no performance data available";
            }
        } else {
            metricsDiv.innerText = "no performance data available";
        }
    }

    public ensureAgentMessage(msg: IAgentMessage) {
        const index = msg.actionIndex ?? 0;
        const agentMessage = this.agentMessageDivs[index];
        if (agentMessage === undefined) {
            let beforeElem = this.ensureStatusMessageDiv(msg.source);
            for (let i = 0; i < index + 1; i++) {
                if (this.agentMessageDivs[i] === undefined) {
                    this.agentMessageDivs[i] = document.createElement("div");
                    this.setupAgentMessageDiv(
                        this.agentMessageDivs[i],
                        "chat-message chat-message-left",
                        "chat-message-agent",
                        msg.source,
                        msg.metrics
                    );

                    // The chat message list has the style flex-direction: column-reverse;
                    beforeElem.before(this.agentMessageDivs[i]);
                }
                beforeElem = this.agentMessageDivs[i];
            }
        }
        this.updateStatusMessageDivState();
        return this.agentMessageDivs[index];
    }

    public updateMessageText(message: string) {
        this.userMessage.textContent = message;
    }
}

const ansi_up = new AnsiUp();
ansi_up.use_classes = true;

function textToHtml(text: string): string {
    const value = ansi_up.ansi_to_html(text);
    const line = value.replace(/\n/gm, "<br>").replace(/  /g, " &nbsp;");
    return line;
}

function stripAnsi(text: string): string {
    return text.replace(/\x1b\[[0-9;]*m/g, "");
}

const enableText2Html = true;
export function setContent(elm: HTMLElement, text: string) {
    if (text.startsWith("<")) {
        elm.innerHTML = text;
    } else if (enableText2Html) {
        elm.innerHTML = textToHtml(text);
    } else {
        elm.innerText = stripAnsi(text);
    }
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

export function setSource(
    agentMessageDiv: HTMLDivElement,
    source: string,
    agents: Map<string, string>,
) {
    (agentMessageDiv.firstChild?.firstChild as HTMLDivElement).innerText =
        source; // name

    const iconDiv: HTMLDivElement = agentMessageDiv
        .children[1] as HTMLDivElement;
    iconDiv.innerText = agents.get(source as string) as string; // icon
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

export class ChatView {
    private topDiv: HTMLDivElement;
    private messageDiv: HTMLDivElement;
    private inputContainer: HTMLDivElement;

    private groupToElements: Map<string, HTMLDivElement[]> = new Map();
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

    constructor(
        private idGenerator: IdGenerator,
        public speechInfo: SpeechInfo,
        public agents: Map<string, string>,
    ) {
        this.topDiv = document.createElement("div");
        this.topDiv.className = "chat-container";
        this.messageDiv = document.createElement("div");
        this.messageDiv.className = "chat scroll_enabled";
        this.chatInput = new ChatInput(
            this.speechInfo,
            "phraseDiv",
            "reco",
            (message) => {
                this.addUserMessage(message);
                if (this.searchMenu) {
                    this.cancelSearchMenu();
                }
            },
            (eta: ExpandableTextarea) => {
                if (this.partialInputEnabled) {
                    this.placeSearchMenu();
                    getClientAPI().sendPartialInput(eta.getEditedText());
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
                            const messages =
                                this.messageDiv.querySelectorAll(
                                    ".chat-message-user",
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

    private getMessageGroup(id: string) {
        const messageGroup = this.idToMessageGroup.get(id);
        if (messageGroup === undefined) {
            console.error(`Invalid requestId ${id}`);
        }
        return messageGroup;
    }

    showStatusMessage(
        msg: IAgentMessage,
        temporary: boolean,
    ) {
        this.getMessageGroup(msg.requestId as string)?.addStatusMessage(msg.message, msg.source, temporary);
    }

    clear() {
        this.messageDiv.replaceChildren();
        this.idToMessageGroup.clear();
        this.groupToElements.clear();
        this.commandBackStackIndex = -1;
    }

    addUserMessage(request: string) {
        const id = this.idGenerator.genId();
        this.idToMessageGroup.set(
            id,
            new MessageGroup(
                request,
                this.messageDiv,
                getClientAPI().processShellRequest(request, id),
                new Date(),
                this.agents,
            ),
        );
        this.commandBackStackIndex = -1;
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
        msg: IAgentMessage
    ) {
        const text: string = msg.message;
        const source: string = msg.source;
        let groupId: string | undefined = msg.groupId;

        const messageContainer = this.ensureAgentMessage(msg) as HTMLDivElement;
        const message = messageContainer.lastChild?.previousSibling as HTMLDivElement;
        if (message === undefined) {
            return undefined;
        }

        setSource(messageContainer, source, this.agents);
        setContent(message, text);
        if (!groupId) {
            const innerDiv = message.firstChild as HTMLDivElement;
            if (innerDiv && innerDiv.dataset && innerDiv.dataset.group) {
                console.log(`group: ${innerDiv.dataset.group}`);
                groupId = innerDiv.dataset.group;
            }
        }
        if (groupId) {
            let group = this.groupToElements.get(groupId);
            if (group === undefined) {
                group = [];
                this.groupToElements.set(groupId, group);
            }
            group.push(message);
        }
        this.chatInputFocus();
    }

    private ensureAgentMessage(msg: IAgentMessage) {
        return this.getMessageGroup(msg.requestId as string)?.ensureAgentMessage(msg);
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
        const agentMessage = this.ensureAgentMessage({ message: "", requestId, source});
        if (agentMessage === undefined) {
            return;
        }
        agentMessage.className = "chat-message chat-message-confirm";
        const proposeElm = this.proposeAction(message, requestId);
        agentMessage.appendChild(proposeElm);
        proposeYesNo(this, askYesNoId, requestId, message, source);
    }

    answerYesNo(
        questionId: number,
        answer: boolean,
        requestId: string,
        source: string,
    ) {
        let message = answer ? "Accepted!" : "Rejected!";
        this.showStatusMessage({
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
        const agentMessage = this.ensureAgentMessage({ message: "", requestId, source });
        if (agentMessage === undefined) {
            return;
        }
        agentMessage.innerHTML = "";
        this.showStatusMessage({message, requestId, source}, true);
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
            agentMessage.appendChild(replacementElm);
        }
    }

    answer(questionId: number, answer: string, requestId: string) {
        let message = "Answer sent!";
        let source = "shell";
        this.showStatusMessage({ message, requestId, source}, true);
        console.log(answer);
        getClientAPI().sendAnswer(questionId, answer);
    }

    updateGroup(text: string, groupId: string) {
        const group = this.groupToElements.get(groupId);
        if (group !== undefined) {
            for (const message of group) {
                message.innerHTML = text;
            }
        }
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
}

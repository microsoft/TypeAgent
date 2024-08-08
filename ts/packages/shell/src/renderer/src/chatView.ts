// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { IdGenerator, getClientAPI } from "./main";
import {
    ChatInput,
    proposeAction,
    //    questionInput,
    ExpandableTextarea,
    questionInput,
} from "./chatInput";
import { SpeechInfo } from "./speech";
import { SearchMenu } from "./search";
import { AnsiUp } from "ansi_up";
import { iconCheckMarkCircle, iconX, iconRoadrunner } from "./icon";
import {
    SearchMenuItem,
    TemplateParamObject,
} from "../../preload/electronTypes";

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
    ) {
        const userMessage = document.createElement("div");
        userMessage.className = "chat-message chat-message-right";
        setContent(userMessage, request);

        if (container.firstChild) {
            container.firstChild.before(userMessage);

            userMessage.scrollIntoView(false);
        } else {
            container.append(userMessage);
        }

        this.userMessage = userMessage;

        requestPromise
            .then(() => this.requestCompleted())
            .catch((error) => this.requestException(error));
    }

    private requestCompleted() {
        this.completed = true;
        if (this.statusMessages.length === 0) {
            this.addStatusMessage("Request completed", true);
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
                this.userMessage.parentElement?.firstChild ==
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
        this.addStatusMessage(`Processing Error: ${error}`, false);
    }

    private ensureStatusMessageDiv() {
        if (this.statusMessageDiv === undefined) {
            this.statusMessageDiv = document.createElement("div");
            this.userMessage.before(this.statusMessageDiv);
        }

        return this.statusMessageDiv;
    }
    public addStatusMessage(message: string, temporary: boolean) {
        const div = this.ensureStatusMessageDiv();

        div.className = "chat-message chat-message-temp";
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

    public ensureAgentMessage(actionIndex?: number) {
        const index = actionIndex ?? 0;
        const agentMessage = this.agentMessageDivs[index];
        if (agentMessage === undefined) {
            let beforeElem = this.ensureStatusMessageDiv();
            for (let i = 0; i < index + 1; i++) {
                if (this.agentMessageDivs[i] === undefined) {
                    this.agentMessageDivs[i] = document.createElement("div");
                    // The chat message list has the style flex-direction: column-reverse;
                    beforeElem.before(this.agentMessageDivs[i]);
                }
                beforeElem = this.agentMessageDivs[i];
            }
        }
        this.updateStatusMessageDivState();
        return this.agentMessageDivs[index];
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
    _message: string,
) {
    const choices: InputChoice[] = [
        {
            text: "Yes",
            element: iconCheckMarkCircle(),
            selectKey: ["y", "Y", "Enter"],
            onSelected: (_choice) => {
                chatView.answerYesNo(askYesNoId, true, requestId);
                chatView.removeChoicePanel();
            },
        },
        {
            text: "No",
            element: iconX(),
            selectKey: ["n", "N", "Delete"],
            onSelected: (_choice) => {
                chatView.answerYesNo(askYesNoId, false, requestId);
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
    private microphoneSources: HTMLSelectElement;
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

    constructor(
        private idGenerator: IdGenerator,
        public speechInfo: SpeechInfo,
    ) {
        this.topDiv = document.createElement("div");
        this.topDiv.className = "chat-container";
        this.microphoneSources = document.createElement("select");
        this.microphoneSources.id = "microphoneSources";
        this.microphoneSources.className = "chat-input-micSelector";
        this.topDiv.appendChild(this.microphoneSources);
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
                            const messages = this.messageDiv.querySelectorAll(
                                ".chat-message-right",
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

    actionCommand(
        _actionAgent: string,
        _actionName: string,
        _parameterStructure: TemplateParamObject,
        _command: string,
        _requestId: string,
    ) {
        /*
        switch (command) {
            case "confirmAction":
                this.confirmAction(
                    actionAgent,
                    actionName,
                    parameterStructure,
                    requestId,
                );
                break;
            case "replaceAction":
                this.replaceAction(
                    actionAgent,
                    actionName,
                    parameterStructure,
                    requestId,
                );
                break;
            default:
                console.error(`Unhandled action command: ${command}`);
                break;
        }
                */
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

    showStatusMessage(message: string, id: string, temporary: boolean) {
        this.getMessageGroup(id)?.addStatusMessage(message, temporary);
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

    addAgentMessage(
        text: string,
        id: string,
        actionIndex?: number,
        groupId?: string,
    ) {
        const message = this.ensureAgentMessage(id, actionIndex);
        if (message === undefined) {
            return undefined;
        }
        message.className = "chat-message chat-message-left";
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

    private ensureAgentMessage(id: string, actionIndex?: number) {
        return this.getMessageGroup(id)?.ensureAgentMessage(actionIndex);
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

    askYesNo(askYesNoId: number, message: string, requestId: string) {
        const agentMessage = this.ensureAgentMessage(requestId);
        if (agentMessage === undefined) {
            return;
        }
        agentMessage.className = "chat-message chat-message-confirm";
        const proposeElm = proposeAction(message);
        agentMessage.appendChild(proposeElm);
        proposeYesNo(this, askYesNoId, requestId, message);
    }

    answerYesNo(questionId: number, answer: boolean, requestId: string) {
        this.showStatusMessage(
            answer ? "Accepted!" : "Rejected!",
            requestId,
            true,
        );
        getClientAPI().sendYesNo(questionId, answer);
        this.chatInputFocus();
    }

    question(questionId: number, message: string, requestId: string) {
        const agentMessage = this.ensureAgentMessage(requestId);
        if (agentMessage === undefined) {
            return;
        }
        agentMessage.innerHTML = "";
        this.showStatusMessage(message, requestId, true);
        if (this.searchMenu) {
            this.searchMenuAnswerHandler = (item) => {
                this.answer(questionId, item.matchText, requestId);
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
        this.showStatusMessage("Answer sent!", requestId, true);
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

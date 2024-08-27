// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import {
    DispatcherAction,
    DispatcherAgent,
    DispatcherAgentContext,
    Storage,
    TurnImpression,
    createTurnImpressionFromDisplay,
} from "@typeagent/agent-sdk";
import {
    ListAction,
    AddItemsAction,
    RemoveItemsAction,
    CreateListAction,
    GetListAction,
} from "./listSchema.js";

export function instantiate(): DispatcherAgent {
    return {
        initializeAgentContext: initializeListContext,
        updateAgentContext: updateListContext,
        executeAction: executeListAction,
        validateWildcardMatch: listValidateWildcardMatch,
    };
}

type ListActionContext = {
    store: MemoryListCollection | undefined;
};

async function executeListAction(
    action: DispatcherAction,
    context: DispatcherAgentContext<ListActionContext>,
) {
    let result = await handleListAction(action as ListAction, context.context);
    return result;
}

// returns true if the item is a closed-class form in English (no cross-language for now)
function isClosedClass(item: string) {
    // sorted list of closed-class words in English
    const englishClosedClassWords = [
        "the",
        "and",
        "or",
        "but",
        "so",
        "of",
        "in",
        "on",
        "at",
        "to",
        "for",
        "with",
        "by",
        "from",
        "about",
        "as",
        "if",
        "then",
        "than",
        "when",
        "where",
        "why",
        "how",
        // reference words
        "this",
        "that",
        "these",
        "those",
        "it",
        "them",
    ];
    for (const word of item.split(" ")) {
        if (englishClosedClassWords.includes(word)) {
            return true;
        }
    }
    return false;
}

// returns true if the item is a simple noun; using heuristic for now
function simpleNoun(item: string) {
    return item.split(" ").length < 3 && !isClosedClass(item);
}

function validateWildcardItems(
    items: string[],
    context: DispatcherAgentContext<ListActionContext>,
) {
    for (const item of items) {
        if (!simpleNoun(item)) {
            return false;
        }
    }
    return true;
}

async function listValidateWildcardMatch(
    action: DispatcherAction,
    context: DispatcherAgentContext<ListActionContext>,
) {
    if (action.actionName === "addItems") {
        const addItemsAction = action as AddItemsAction;
        return validateWildcardItems(addItemsAction.parameters.items, context);
    } else if (action.actionName === "removeItems") {
        const removeItemsAction = action as RemoveItemsAction;
        return validateWildcardItems(
            removeItemsAction.parameters.items,
            context,
        );
    }
    return true;
}

async function initializeListContext() {
    return { store: undefined };
}

interface List {
    items: string[];
    name: string;
}

interface MemoryList {
    name: string;
    itemsSet: Set<string>;
}

function createMemoryList(list: List): MemoryList {
    return {
        name: list.name,
        itemsSet: new Set(list.items),
    };
}

class MemoryListCollection {
    private lists = new Map<string, MemoryList>();
    constructor(
        rawLists: List[],
        private storage: Storage,
        private listStoreName: string,
    ) {
        rawLists.forEach((list) => {
            const lookupName = list.name;
            if (lookupName !== undefined) {
                this.lists.set(lookupName, createMemoryList(list));
            }
        });
    }

    createList(name: string) {
        if (!this.lists.has(name)) {
            this.lists.set(name, { name: name, itemsSet: new Set() });
            return true;
        } else {
            return false;
        }
    }

    addItems(listName: string, items: string[]) {
        this.createList(listName);
        const list = this.getList(listName);
        if (list !== undefined) {
            for (const item of items) {
                list.itemsSet.add(item);
            }
        }
    }

    removeItems(listName: string, items: string[]) {
        const list = this.getList(listName);
        if (list !== undefined) {
            for (const item of items) {
                list.itemsSet.delete(item);
            }
        }
    }

    getList(name: string): MemoryList | undefined {
        return this.lists.get(name);
    }

    serialize(): string {
        const lists = Array.from(this.lists.values()).map((memList) => {
            return {
                name: memList.name,
                items: Array.from(memList.itemsSet),
            };
        });
        return JSON.stringify(lists);
    }

    // for now, whole list and synchronous for simplicity
    async save() {
        return this.storage.write(this.listStoreName, this.serialize());
    }
}

/**
 * Create a new named list store for the given session
 * @param session
 * @param listStoreName
 */
async function createListStoreForSession(
    storage: Storage,
    listStoreName: string,
) {
    let lists: List[] = [];
    // check whether file exists
    if (await storage.exists(listStoreName)) {
        const data = await storage.read(listStoreName, "utf8");
        lists = JSON.parse(data);
    } else {
        await storage.write(listStoreName, JSON.stringify(lists));
    }
    return new MemoryListCollection(lists, storage, listStoreName);
}

async function updateListContext(
    enable: boolean,
    context: DispatcherAgentContext<ListActionContext>,
): Promise<void> {
    if (enable && context.sessionStorage) {
        context.context.store = await createListStoreForSession(
            context.sessionStorage,
            "lists.json",
        );
    } else {
        context.context.store = undefined;
    }
}

async function handleListAction(
    action: ListAction,
    listContext: ListActionContext,
) {
    let result: TurnImpression | undefined = undefined;
    let displayText: string | undefined = undefined;
    switch (action.actionName) {
        case "addItems": {
            const addAction = action as AddItemsAction;
            console.log(
                `Adding items: ${addAction.parameters.items} to list ${addAction.parameters.listName}`,
            );
            if (listContext.store !== undefined) {
                listContext.store.addItems(
                    addAction.parameters.listName,
                    addAction.parameters.items,
                );
                await listContext.store.save();
                displayText = `Added items: ${addAction.parameters.items} to list ${addAction.parameters.listName}`;
                result = createTurnImpressionFromDisplay(displayText);
                result.literalText = `Added item: ${addAction.parameters.items} to list ${addAction.parameters.listName}`;
                result.entities = [
                    {
                        name: addAction.parameters.listName,
                        type: ["list"],
                    },
                ];
                for (const item of addAction.parameters.items) {
                    result.entities.push({
                        name: item,
                        type: ["item"],
                    });
                }
            }
            break;
        }
        case "removeItems": {
            const removeAction = action as RemoveItemsAction;
            console.log(
                `Removing items: ${removeAction.parameters.items} from list ${removeAction.parameters.listName}`,
            );
            if (listContext.store !== undefined) {
                listContext.store.removeItems(
                    removeAction.parameters.listName,
                    removeAction.parameters.items,
                );
                await listContext.store.save();
                displayText = `Removed items: ${removeAction.parameters.items} from list ${removeAction.parameters.listName}`;
                result = createTurnImpressionFromDisplay(displayText);
                result.literalText = `Removed items: ${removeAction.parameters.items} from list ${removeAction.parameters.listName}`;
                result.entities = [
                    {
                        name: removeAction.parameters.listName,
                        type: ["list"],
                    },
                ];
                for (const item of removeAction.parameters.items) {
                    result.entities.push({
                        name: item,
                        type: ["item"],
                    });
                }
            }
            break;
        }
        case "createList": {
            const createListAction = action as CreateListAction;
            if (listContext.store !== undefined) {
                if (
                    listContext.store.createList(
                        createListAction.parameters.listName,
                    )
                ) {
                    console.log(
                        `Created list: ${createListAction.parameters.listName}`,
                    );
                    displayText = `Created list: ${createListAction.parameters.listName}`;
                    await listContext.store.save();
                } else {
                    console.log(
                        `List already exists: ${createListAction.parameters.listName}`,
                    );
                    displayText = `List already exists: ${createListAction.parameters.listName}`;
                }
                result = createTurnImpressionFromDisplay(displayText);
                result.literalText = `Created list: ${createListAction.parameters.listName}`;
                result.entities = [
                    {
                        name: createListAction.parameters.listName,
                        type: ["list"],
                    },
                ];
            }
            break;
        }
        case "getList": {
            const getListAction = action as GetListAction;
            const list = listContext.store?.getList(
                getListAction.parameters.listName,
            );
            if (list !== undefined) {
                const plainList = Array.from(list.itemsSet);
                // set displayText to html list of the items
                displayText = `<ul>${plainList
                    .map((item) => `<li>${item}</li>`)
                    .join("")}</ul>`;
                result = createTurnImpressionFromDisplay(displayText);
                result.literalText = `I've shown you all the items in list ${getListAction.parameters.listName} `;
                result.entities = [
                    {
                        name: getListAction.parameters.listName,
                        type: ["list"],
                    },
                ];
            }
            break;
        }
        default:
            throw new Error(`Unknown action: ${action.actionName}`);
    }
    return result;
}

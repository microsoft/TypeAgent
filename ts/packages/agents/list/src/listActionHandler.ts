// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import {
    ActionContext,
    AppAgent,
    SessionContext,
    Storage,
    ActionResult,
    TypeAgentAction,
} from "@typeagent/agent-sdk";
import {
    createActionResultFromTextDisplay,
    createActionResultFromHtmlDisplay,
    createActionResultFromError,
} from "@typeagent/agent-sdk/helpers/action";
import { ListAction } from "./listSchema.js";

export function instantiate(): AppAgent {
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
    action: TypeAgentAction<ListAction>,
    context: ActionContext<ListActionContext>,
) {
    let result = await handleListAction(
        action,
        context.sessionContext.agentContext,
    );
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
    context: SessionContext<ListActionContext>,
) {
    for (const item of items) {
        if (!simpleNoun(item)) {
            return false;
        }
    }
    return true;
}

async function listValidateWildcardMatch(
    action: ListAction,
    context: SessionContext<ListActionContext>,
) {
    if (action.actionName === "addItems") {
        const addItemsAction = action;
        return validateWildcardItems(addItemsAction.parameters.items, context);
    } else if (action.actionName === "removeItems") {
        const removeItemsAction = action;
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
    context: SessionContext<ListActionContext>,
): Promise<void> {
    if (enable && context.sessionStorage) {
        context.agentContext.store = await createListStoreForSession(
            context.sessionStorage,
            "lists.json",
        );
    } else {
        context.agentContext.store = undefined;
    }
}

async function handleListAction(
    action: ListAction,
    listContext: ListActionContext,
) {
    let result: ActionResult | undefined = undefined;
    let displayText: string | undefined = undefined;
    switch (action.actionName) {
        case "addItems": {
            const store = listContext.store;
            if (store === undefined) {
                return createActionResultFromError(
                    "List store not initialized",
                );
            }
            const addAction = action;
            if (addAction.parameters.items.length === 0) {
                throw new Error("No items to add");
            }
            if (addAction.parameters.listName === "") {
                throw new Error("List name is empty");
            }

            store.addItems(
                addAction.parameters.listName,
                addAction.parameters.items,
            );
            await store.save();
            displayText = `Added items: ${addAction.parameters.items} to list ${addAction.parameters.listName}`;
            result = createActionResultFromTextDisplay(
                displayText,
                displayText,
            );
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

            break;
        }
        case "removeItems": {
            const store = listContext.store;
            if (store === undefined) {
                return createActionResultFromError(
                    "List store not initialized",
                );
            }
            const removeAction = action;
            if (removeAction.parameters.items.length === 0) {
                throw new Error("No items to remove");
            }
            if (removeAction.parameters.listName === "") {
                throw new Error("List name is empty");
            }

            store.removeItems(
                removeAction.parameters.listName,
                removeAction.parameters.items,
            );
            await store.save();
            displayText = `Removed items: ${removeAction.parameters.items} from list ${removeAction.parameters.listName}`;
            result = createActionResultFromTextDisplay(
                displayText,
                displayText,
            );
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

            break;
        }
        case "createList": {
            const store = listContext.store;
            if (store === undefined) {
                return createActionResultFromError(
                    "List store not initialized",
                );
            }
            const createListAction = action;
            const listName = createListAction.parameters.listName;

            if (store.createList(listName)) {
                displayText = `Created list: ${listName}`;
                await store.save();
            } else {
                displayText = `List already exists: ${listName}`;
            }
            result = createActionResultFromTextDisplay(
                displayText,
                displayText,
            );
            result.entities = [
                {
                    name: createListAction.parameters.listName,
                    type: ["list"],
                },
            ];

            break;
        }
        case "getList": {
            const store = listContext.store;
            if (store === undefined) {
                return createActionResultFromError(
                    "List store not initialized",
                );
            }
            const getListAction = action;
            const listName = getListAction.parameters.listName;
            const list = store.getList(listName);
            if (list === undefined) {
                return createActionResultFromError(
                    `List '${listName}' not found`,
                );
            }
            if (list.itemsSet.size === 0) {
                displayText = `List '${listName}' is empty`;
                result = createActionResultFromTextDisplay(
                    displayText,
                    displayText,
                );
                result.entities = [
                    {
                        name: listName,
                        type: ["list"],
                    },
                ];
                break;
            }
            const plainList = Array.from(list.itemsSet);
            // set displayText to html list of the items
            displayText = `<ul>${plainList
                .map((item) => `<li>${item}</li>`)
                .join("")}</ul>`;
            result = createActionResultFromHtmlDisplay(
                displayText,
                `List '${listName}' has items: ${plainList.join(",")}`,
            );
            result.entities = [
                {
                    name: listName,
                    type: ["list"],
                },
                ...plainList.map((item) => ({
                    name: item,
                    type: ["item"],
                })),
            ];
            break;
        }
        case "clearList": {
            const store = listContext.store;
            if (store === undefined) {
                return createActionResultFromError(
                    "List store not initialized",
                );
            }
            const clearListAction = action;
            const listName = clearListAction.parameters.listName;
            const list = store.getList(listName);
            if (list === undefined) {
                return createActionResultFromError(
                    `List '${listName}' not found`,
                );
            }

            list.itemsSet.clear();
            await store.save();
            displayText = `Cleared list: ${listName}`;
            result = createActionResultFromTextDisplay(
                displayText,
                displayText,
            );
            result.entities = [
                {
                    name: clearListAction.parameters.listName,
                    type: ["list"],
                },
            ];

            break;
        }
        default:
            throw new Error(`Unknown action: ${(action as any).actionName}`);
    }
    return result;
}

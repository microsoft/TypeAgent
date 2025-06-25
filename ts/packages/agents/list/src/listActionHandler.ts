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
    createActionResultFromMarkdownDisplay,
    createActionResult,
} from "@typeagent/agent-sdk/helpers/action";
import { ListAction, ListActivity } from "./listSchema.js";

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
    action: TypeAgentAction<ListAction | ListActivity>,
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
    action: ListAction | ListActivity,
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

function getEntities(list: string, items?: string[]) {
    const entities = [
        {
            name: list,
            type: ["list"],
        },
    ];
    if (items) {
        for (const item of items) {
            entities.push({
                name: item,
                type: ["item"],
            });
        }
    }
    return entities;
}

function getStore(listContext: ListActionContext) {
    if (listContext.store === undefined) {
        throw new Error("List store not initialized");
    }
    return listContext.store;
}

function getList(listContext: ListActionContext, listName: string) {
    const list = getStore(listContext).getList(listName);
    if (list === undefined) {
        throw new Error(`List '${listName}' not found`);
    }
    return list;
}

function getListDisplay(
    listContext: ListActionContext,
    listName: string,
    suffix?: string,
) {
    const list = getList(listContext, listName);
    if (list.itemsSet.size === 0) {
        return createActionResult(
            `List '${listName}' is empty.${suffix ? `\n${suffix}` : ""}`,
            undefined,
            getEntities(listName),
        );
    }
    const plainList = Array.from(list.itemsSet);

    // set displayText to markdown list of the items
    return createActionResultFromMarkdownDisplay(
        `List '${listName}' has items:\n\n${plainList.map((item) => `- ${item}`).join("\n")}${suffix ? `\n\n${suffix}` : ""}`,
        undefined,
        getEntities(listName, plainList),
    );
}
async function handleListAction(
    action: TypeAgentAction<ListAction | ListActivity>,
    listContext: ListActionContext,
) {
    let result: ActionResult | undefined = undefined;
    let displayText: string | undefined = undefined;
    switch (action.actionName) {
        case "addItems": {
            const store = getStore(listContext);
            const { items, listName } = action.parameters;
            if (items.length === 0) {
                throw new Error("No items to add");
            }
            if (listName === "") {
                throw new Error("List name is empty");
            }

            store.addItems(listName, items);
            await store.save();
            displayText = `Added items: ${items} to list ${listName}`;
            result = createActionResultFromTextDisplay(
                displayText,
                displayText,
            );
            result.entities = getEntities(listName, items);
            break;
        }
        case "removeItems": {
            const store = getStore(listContext);
            const { items, listName } = action.parameters;
            if (items.length === 0) {
                throw new Error("No items to remove");
            }
            if (listName === "") {
                throw new Error("List name is empty");
            }

            store.removeItems(listName, items);
            await store.save();
            displayText = `Removed items: ${items} from list ${listName}`;
            result = createActionResultFromTextDisplay(
                displayText,
                displayText,
            );
            result.entities = getEntities(listName, items);
            break;
        }
        case "createList": {
            const store = getStore(listContext);
            const listName = action.parameters.listName;

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
            result.entities = getEntities(listName);
            break;
        }
        case "getList": {
            result = getListDisplay(listContext, action.parameters.listName);
            break;
        }
        case "clearList": {
            const store = getStore(listContext);
            const clearListAction = action;
            const listName = clearListAction.parameters.listName;
            const list = getList(listContext, listName);
            list.itemsSet.clear();
            await store.save();
            displayText = `Cleared list: ${listName}`;
            result = createActionResultFromTextDisplay(
                displayText,
                displayText,
            );
            result.entities = getEntities(listName);
            break;
        }
        case "startEditList": {
            result = getListDisplay(
                listContext,
                action.parameters.listName,
                "What do you want to add or remove from this list?",
            );
            // TODO: formalize the schema for activityContext
            result.activityContext = {
                activityName: "edit",
                description: "editing list",
                state: {
                    listName: action.parameters.listName,
                },
            };
            break;
        }
        default:
            throw new Error(`Unknown action: ${(action as any).actionName}`);
    }
    return result;
}

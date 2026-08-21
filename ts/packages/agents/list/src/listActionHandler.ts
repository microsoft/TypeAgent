// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import {
    ActionContext,
    AppAgent,
    SessionContext,
    Storage,
    ActionResult,
    TypeAgentAction,
    Entity,
} from "@typeagent/agent-sdk";
import {
    ChoiceManager,
    createActionResultFromTextDisplay,
    createStructuredResult,
    createYesNoChoiceResult,
} from "@typeagent/agent-sdk/helpers/action";
import { ListAction, ListActivity } from "./listSchema.js";
import {
    isPlaceholderListName,
    normalizeListName,
    RECOVERED_LIST_NAME,
} from "./listNameUtils.js";

export {
    isPlaceholderListName,
    normalizeListName,
    RECOVERED_LIST_NAME,
} from "./listNameUtils.js";
export function instantiate(): AppAgent {
    return {
        initializeAgentContext: initializeListContext,
        updateAgentContext: updateListContext,
        executeAction: executeListAction,
        validateWildcardMatch: listValidateWildcardMatch,
        handleChoice: (choiceId, response, context) =>
            (
                context as ActionContext<ListActionContext>
            ).sessionContext.agentContext.choiceManager.handleChoice(
                choiceId,
                response,
                context,
            ),
    };
}

type ListActionContext = {
    store: MemoryListCollection | undefined;
    choiceManager: ChoiceManager;
};

async function executeListAction(
    action: TypeAgentAction<ListAction | ListActivity>,
    context: ActionContext<ListActionContext>,
) {
    const result = await handleListAction(
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
    _context: SessionContext<ListActionContext>,
) {
    for (const item of items) {
        if (!simpleNoun(item)) {
            return false;
        }
    }
    return true;
}

function listNameFromAction(
    action: ListAction | ListActivity,
): string | undefined {
    if (
        action.actionName === "addItems" ||
        action.actionName === "removeItems" ||
        action.actionName === "createList" ||
        action.actionName === "getList" ||
        action.actionName === "clearList" ||
        action.actionName === "startEditList"
    ) {
        return action.parameters.listName;
    }
    return undefined;
}

/**
 * Reject grammar matches whose listName is only a determiner / "list"
 * (after stripping leading dets). Exported for unit tests.
 */
export async function listValidateWildcardMatch(
    action: ListAction | ListActivity,
    context: SessionContext<ListActionContext>,
) {
    const listName = listNameFromAction(action);
    if (listName !== undefined && isPlaceholderListName(listName)) {
        return false;
    }

    if (action.actionName === "addItems") {
        return validateWildcardItems(action.parameters.items, context);
    } else if (action.actionName === "removeItems") {
        return validateWildcardItems(action.parameters.items, context);
    }
    return true;
}

/** Normalize listName and reject placeholders at execute time. */
function requireListName(listName: string): string {
    const normalized = normalizeListName(listName);
    if (normalized === "" || isPlaceholderListName(normalized)) {
        throw new Error(
            'List name is missing or only a reference phrase (e.g. "the list"); clarify which list',
        );
    }
    return normalized;
}

async function initializeListContext() {
    return { store: undefined, choiceManager: new ChoiceManager() };
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

/**
 * Collapse legacy/raw list records onto normalized keys.
 * Placeholder keys ("the", "list", "my", "it", …) are not kept as identities,
 * but any items under them are salvaged into RECOVERED_LIST_NAME so hydrate
 * never permanently drops user data from the pre-fix failure mode.
 * RECOVERED_LIST_NAME itself is a canonical, addressable store key (aliases
 * "recovered" / "the recovered list" normalize to it) so a salvage-only store
 * is steady-state and does not rewrite on every session load.
 * Exported for unit tests.
 */
export function coalesceStoredLists(rawLists: List[]): List[] {
    const map = new Map<string, Set<string>>();
    const salvaged = new Set<string>();
    if (!Array.isArray(rawLists)) {
        return [];
    }
    for (const list of rawLists) {
        // Corrupted / hand-edited entries: null name, non-string name, or
        // non-object rows. Salvage any items we can still read.
        if (list == null || typeof list !== "object") {
            continue;
        }
        const rawName = (list as List).name;
        const rawItems = Array.isArray((list as List).items)
            ? (list as List).items
            : [];
        if (typeof rawName !== "string") {
            for (const item of rawItems) {
                if (typeof item === "string") {
                    salvaged.add(item);
                }
            }
            continue;
        }
        const name = normalizeListName(rawName);
        if (isPlaceholderListName(name)) {
            for (const item of rawItems) {
                if (typeof item === "string") {
                    salvaged.add(item);
                }
            }
            continue;
        }
        let items = map.get(name);
        if (items === undefined) {
            items = new Set<string>();
            map.set(name, items);
        }
        for (const item of rawItems) {
            if (typeof item === "string") {
                items.add(item);
            }
        }
    }
    if (salvaged.size > 0) {
        let items = map.get(RECOVERED_LIST_NAME);
        if (items === undefined) {
            items = new Set<string>();
            map.set(RECOVERED_LIST_NAME, items);
        }
        for (const item of salvaged) {
            items.add(item);
        }
    }
    return Array.from(map.entries()).map(([name, itemsSet]) => ({
        name,
        items: Array.from(itemsSet),
    }));
}

/**
 * True when raw disk records would change under coalesce (dirty names, merges,
 * or placeholder salvage). Used to decide whether to rewrite lists.json on load.
 */
export function storedListsNeedRewrite(rawLists: List[]): boolean {
    if (!Array.isArray(rawLists)) {
        return true;
    }
    const coalesced = coalesceStoredLists(rawLists);
    if (coalesced.length !== rawLists.length) {
        return true;
    }
    // Build multiset comparison on normalized shape (order-independent names).
    const rawByName = new Map<string, Set<string>>();
    for (const list of rawLists) {
        if (list == null || typeof list !== "object") {
            return true;
        }
        if (typeof list.name !== "string") {
            return true;
        }
        // Any non-canonical name on disk must be rewritten.
        if (list.name !== normalizeListName(list.name)) {
            return true;
        }
        if (isPlaceholderListName(list.name)) {
            return true;
        }
        if (rawByName.has(list.name)) {
            return true; // duplicate keys → merge
        }
        const itemSet = new Set<string>();
        for (const item of list.items ?? []) {
            if (typeof item === "string") {
                itemSet.add(item);
            } else {
                return true; // non-string item → rewrite
            }
        }
        rawByName.set(list.name, itemSet);
    }
    for (const list of coalesced) {
        const rawItems = rawByName.get(list.name);
        if (rawItems === undefined) {
            return true;
        }
        if (rawItems.size !== list.items.length) {
            return true;
        }
        for (const item of list.items) {
            if (!rawItems.has(item)) {
                return true;
            }
        }
    }
    return false;
}

class MemoryListCollection {
    private lists = new Map<string, MemoryList>();
    constructor(
        rawLists: List[],
        private storage: Storage,
        private listStoreName: string,
    ) {
        for (const list of coalesceStoredLists(rawLists)) {
            this.lists.set(list.name, createMemoryList(list));
        }
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
        if (list === undefined) {
            throw new Error(`List '${listName}' not found`);
        }
        for (const item of items) {
            list.itemsSet.delete(item);
        }
    }

    getList(name: string): MemoryList | undefined {
        return this.lists.get(name);
    }

    deleteList(name: string): boolean {
        return this.lists.delete(name);
    }

    getListNames(): string[] {
        return Array.from(this.lists.keys());
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
    let existed = false;
    // check whether file exists
    if (await storage.exists(listStoreName)) {
        existed = true;
        const data = await storage.read(listStoreName, "utf8");
        lists = JSON.parse(data);
    } else {
        await storage.write(listStoreName, JSON.stringify(lists));
    }
    const store = new MemoryListCollection(lists, storage, listStoreName);
    // Persist scrubbed/normalized keys immediately so read-only sessions and
    // process exit before a mutate do not leave polluted keys on disk.
    if (existed && storedListsNeedRewrite(lists)) {
        await store.save();
    }
    return store;
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

// Represent a list as a single entity whose current items are carried as a
// facet (e.g. grocery -> { items: ["eggs", "cheese"] }). Items are deliberately
// NOT emitted as separate top-level entities: a floating item entity with no
// link to its list caused follow-up requests ("add cheese") to re-add the prior
// item, and enumerating the items on the list entity gives the model the
// containment it needs to resolve references like "the potatoes".
function getEntities(list: string, items?: string[]): Entity[] {
    const listEntity: Entity = {
        name: list,
        type: ["list"],
    };
    if (items && items.length > 0) {
        listEntity.facets = [{ name: "items", value: items }];
    }
    return [listEntity];
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
    return buildListResult(listName, Array.from(list.itemsSet), suffix);
}

// Build the structured display for a list: a heading + list block (or an
// empty-state text block) plus a machine-readable rawData payload. Pure —
// exported for unit tests.
export function buildListResult(
    listName: string,
    items: string[],
    suffix?: string,
) {
    if (items.length === 0) {
        return createStructuredResult(
            [
                { kind: "heading", level: 3, text: `List '${listName}'` },
                { kind: "text", text: "This list is empty." },
                ...(suffix ? [{ kind: "text" as const, text: suffix }] : []),
            ],
            {
                entities: getEntities(listName),
                rawData: { name: listName, items: [] },
            },
        );
    }
    const plainList = items;

    // Render the list as a structured heading + list block. The SDK derives
    // the markdown/text fallback for clients that can't render blocks.
    const count = plainList.length;
    return createStructuredResult(
        [
            {
                kind: "heading",
                level: 3,
                text: `List '${listName}' — ${count} item${count === 1 ? "" : "s"}`,
            },
            {
                kind: "list",
                items: plainList.map((item) => ({ text: item })),
            },
            ...(suffix ? [{ kind: "text" as const, text: suffix }] : []),
        ],
        {
            entities: getEntities(listName, plainList),
            rawData: { name: listName, items: plainList },
        },
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
            const { items } = action.parameters;
            const listName = requireListName(action.parameters.listName);
            if (items.length === 0) {
                throw new Error("No items to add");
            }

            store.addItems(listName, items);
            await store.save();
            displayText = `Added items: ${items} to list ${listName}`;
            result = createActionResultFromTextDisplay(
                displayText,
                displayText,
            );
            result.entities = getEntities(
                listName,
                Array.from(store.getList(listName)?.itemsSet ?? []),
            );
            break;
        }
        case "removeItems": {
            const store = getStore(listContext);
            const { items } = action.parameters;
            const listName = requireListName(action.parameters.listName);
            if (items.length === 0) {
                throw new Error("No items to remove");
            }

            store.removeItems(listName, items);
            await store.save();
            displayText = `Removed items: ${items} from list ${listName}`;
            result = createActionResultFromTextDisplay(
                displayText,
                displayText,
            );
            result.entities = getEntities(
                listName,
                Array.from(store.getList(listName)?.itemsSet ?? []),
            );
            break;
        }
        case "createList": {
            const store = getStore(listContext);
            const listName = requireListName(action.parameters.listName);

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
            result.resultEntity = {
                name: listName,
                type: ["list"],
            };
            break;
        }
        case "getList": {
            const listName = requireListName(action.parameters.listName);
            result = getListDisplay(listContext, listName);
            break;
        }
        case "listLists": {
            const store = getStore(listContext);
            const names = store.getListNames();
            if (names.length === 0) {
                result = createStructuredResult(
                    [
                        { kind: "heading", level: 3, text: "Lists" },
                        { kind: "text", text: "There are no lists yet." },
                    ],
                    { entities: [] },
                );
            } else {
                result = createStructuredResult(
                    [
                        {
                            kind: "heading",
                            level: 3,
                            text: `Lists — ${names.length} list${names.length === 1 ? "" : "s"}`,
                        },
                        {
                            kind: "list",
                            items: names.map((name) => ({ text: name })),
                        },
                    ],
                    {
                        entities: names.map((name) => ({
                            name,
                            type: ["list"],
                        })),
                        rawData: { lists: names },
                    },
                );
            }
            break;
        }
        case "clearList": {
            const store = getStore(listContext);
            const listName = requireListName(action.parameters.listName);
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
        case "deleteList": {
            const listName = action.parameters.listName;
            getList(listContext, listName);
            result = createYesNoChoiceResult(
                listContext.choiceManager,
                `Delete list '${listName}'? This cannot be undone.`,
                async (confirmed, liveActionContext) => {
                    if (!confirmed) {
                        return createActionResultFromTextDisplay(
                            `Kept list: ${listName}`,
                            `Kept list: ${listName}`,
                        );
                    }
                    const liveListContext = (
                        liveActionContext as ActionContext<ListActionContext>
                    ).sessionContext.agentContext;
                    const liveStore = getStore(liveListContext);
                    getList(liveListContext, listName);
                    liveStore.deleteList(listName);
                    await liveStore.save();
                    return createActionResultFromTextDisplay(
                        `Deleted list: ${listName}`,
                        `Deleted list: ${listName}`,
                    );
                },
            );
            break;
        }
        case "startEditList": {
            const listName = requireListName(action.parameters.listName);
            result = getListDisplay(
                listContext,
                listName,
                "What do you want to add or remove from this list?",
            );
            // TODO: formalize the schema for activityContext
            result.activityContext = {
                activityName: "edit",
                description: "editing list",
                state: {
                    listName,
                },
            };
            break;
        }
        default:
            throw new Error(`Unknown action: ${(action as any).actionName}`);
    }
    return result;
}

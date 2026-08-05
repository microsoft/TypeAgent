// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

export type ListAction =
    | AddItemsAction
    | RemoveItemsAction
    | CreateListAction
    | GetListAction
    | ClearListAction
    | DeleteListAction
    | ListListsAction;

export type ListActivity = StartEditList;

// Name of a list such as "grocery", "to do", "shopping", "packing", "gift",
// "book", "idea", "movie", "garden task", "place to visit". Names should be
// lower case and stemmed to the singular form (e.g., "movies" -> "movie").
export type ListName = string;

// add one or more items to a list; if the list does not exist, create it
export type AddItemsAction = {
    actionName: "addItems";
    parameters: {
        items: string[];
        // name of the list such as "grocery", "to do", "shopping", "packing",
        // "gift", "book", "idea", "movie", "garden task", "place to visit"
        listName: ListName;
    };
};

// remove one or more items from a list
export type RemoveItemsAction = {
    actionName: "removeItems";
    parameters: {
        items: string[];
        listName: ListName;
    };
};
// create a new, empty list, for example "create a new list named grocery",
// "make a to do list", "start a packing list"
export type CreateListAction = {
    actionName: "createList";
    parameters: {
        listName: ListName;
    };
};

// use this action to show the user what's on a specific, named list, for
// example, "What's on my grocery list?" or "what are the contents of my to
// do list?" Do NOT use this for questions about whether any list(s) exist at
// all (e.g., "is there a list available", "do I have any lists") — those are
// "listLists" instead.
export type GetListAction = {
    actionName: "getList";
    parameters: {
        listName: ListName;
    };
};

// remove all items from a list but keep the (now empty) list itself, for
// example "clear my grocery list", "empty the to do list". Use "deleteList"
// instead if the user wants the list itself gone, not just emptied. If it's
// genuinely unclear whether the user wants the list emptied or removed
// entirely, prefer "clearList" — it's the non-destructive, reversible choice
// (the list still exists afterward), whereas "deleteList" cannot be undone.
export type ClearListAction = {
    actionName: "clearList";
    parameters: {
        listName: ListName;
    };
};

// permanently remove a list itself (not just its items), for example
// "delete my grocery list", "remove the to do list", "get rid of the packing
// list". Use "clearList" instead if the user only wants the items emptied
// while keeping the list. Only use "deleteList" when the user's intent to
// remove the list itself (not just its contents) is unambiguous — if unsure,
// prefer "clearList" since it can't be undone.
export type DeleteListAction = {
    actionName: "deleteList";
    parameters: {
        listName: ListName;
    };
};

// use this action to show the user which lists exist (an existence/inventory
// question about lists in general, not any specific list's contents), for
// example, "what lists are there?", "show me my lists", "what lists do I
// have?", "is there a list available?", "is there a list?", "do I have any
// lists?"
export type ListListsAction = {
    actionName: "listLists";
    parameters: {};
};

export type StartEditList = {
    actionName: "startEditList";
    parameters: {
        listName: ListName;
    };
};

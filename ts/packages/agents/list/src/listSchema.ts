// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

export type ListAction =
    | AddItemsAction
    | RemoveItemsAction
    | CreateListAction
    | GetListAction
    | ClearListAction;

export type ListActivity = StartEditList;

// add one or more items to a list; if the list does not exist, create it
export type AddItemsAction = {
    actionName: "addItems";
    parameters: {
        items: string[];
        // name of the list such as "grocery", "to do", "shopping", "packing", "gift","book","idea","movie","garden task","place to visit"
        // names should be lower case and should be stemmed to the singular form (e.g., "movies" should be "movie")
        listName: string;
    };
};

// remove one or more items from a list
export type RemoveItemsAction = {
    actionName: "removeItems";
    parameters: {
        items: string[];
        listName: string;
    };
};
export type CreateListAction = {
    actionName: "createList";
    parameters: {
        listName: string;
    };
};

// use this action to show the user what's on the list, for example, "What's on my grocery list?" or "what are the contents of my to do list?"
export type GetListAction = {
    actionName: "getList";
    parameters: {
        listName: string;
    };
};

export type ClearListAction = {
    actionName: "clearList";
    parameters: {
        listName: string;
    };
};

export type StartEditList = {
    actionName: "startEditList";
    parameters: {
        listName: string;
    };
};

// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

export type AddToCart = {
    actionName: "addToCart";
    parameters: {
        productName: string;
    };
};

export type RemoveFromCart = {
    actionName: "removeFromCart";
    parameters: {
        productName: string;
    };
};

export type GetShoppingCart = {
    actionName: "getShoppingCart";
    parameters: {
        storeName?: string;
    };
};

export type BuyAllInList = {
    actionName: "buyAllInList";
    parameters: {
        listName: string;
        storeName?: string;
    };
};

export type SaveListForLater = {
    actionName: "saveListForLater";
    parameters: {
        listName: string;
    };
};

export type AddToList = {
    actionName: "addToList";
    parameters: {
        listName: string;
        productName: string;
    };
};

export type BuyItAgain = {
    actionName: "buyItAgain";
    parameters: {
        storeName: string;
        allItems?: boolean;
        productName?: string;
    };
};

export type BuyAllInRecipe = {
    actionName: "buyAllInRecipe";
    parameters: {
        recipeName: string;
        storeName?: string;
    };
};

export type SaveRecipe = {
    actionName: "saveRecipe";
    parameters: {
        recipeName: string;
    };
};

export type DeleteRecipe = {
    actionName: "deleteRecipe";
    parameters: {
        recipeName: string;
    };
};

export type SetPreferredStore = {
    actionName: "setPreferredStore";
    parameters: {
        storeName: string;
    };
};

export type FindNearbyStore = {
    actionName: "findNearbyStore";
};

// IMPORTANT: Use this action when the user query involves search for products on an e-commerce store, such as "aaa batteries"
export type SearchForProduct = {
    actionName: "searchForProduct";
    parameters: {
        keyword: string;
        storeName?: string;
    };
};

export type SearchForRecipe = {
    actionName: "searchForRecipe";
    parameters: {
        keyword: string;
    };
};

export type InstacartActions =
    | AddToCart
    | AddToList
    | BuyAllInList
    | BuyAllInRecipe
    | BuyItAgain
    | FindNearbyStore
    | RemoveFromCart
    | SaveListForLater
    | SetPreferredStore
    | GetShoppingCart
    | SaveRecipe
    | DeleteRecipe
    | SearchForProduct
    | SearchForRecipe;

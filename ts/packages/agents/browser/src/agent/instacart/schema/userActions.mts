// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

export type AddToCartAction = {
    actionName: "addToCartAction";
    parameters: {
        productName: string;
    };
};

export type RemoveFromCartAction = {
    actionName: "removeFromCartAction";
    parameters: {
        productName: string;
    };
};

export type GetShoppingCartAction = {
    actionName: "getShoppingCartAction";
    parameters: {
        storeName?: string;
    };
};

export type BuyAllInListAction = {
    actionName: "buyAllInListAction";
    parameters: {
        listName: string;
        storeName?: string;
    };
};

export type SaveListForLaterAction = {
    actionName: "saveListForLaterAction";
    parameters: {
        listName: string;
    };
};

export type AddToListAction = {
    actionName: "addToListAction";
    parameters: {
        listName: string;
        productName: string;
    };
};

export type BuyItAgainAction = {
    actionName: "buyItAgainAction";
    parameters: {
        storeName: string;
        allItems?: boolean;
        productName?: string;
    };
};

export type BuyAllInRecipeAction = {
    actionName: "buyAllInRecipeAction";
    parameters: {
        recipeName: string;
        storeName?: string;
    };
};

export type SaveRecipeAction = {
    actionName: "saveRecipeAction";
    parameters: {
        recipeName: string;
    };
};

export type DeleteRecipeAction = {
    actionName: "deleteRecipeAction";
    parameters: {
        recipeName: string;
    };
};

export type SetPreferredStoreAction = {
    actionName: "setPreferredStoreAction";
    parameters: {
        storeName: string;
    };
};

export type FindNearbyStoreAction = {
    actionName: "findNearbyStoreAction";
};

// IMPORTANT: Use this action when the user query involves search for products on an e-commerce store, such as "aaa batteries"
export type SearchForProductAction = {
    actionName: "searchForProductAction";
    parameters: {
        keyword: string;
        storeName?: string;
    };
};

export type SearchForRecipeAction = {
    actionName: "searchForRecipeAction";
    parameters: {
        keyword: string;
    };
};

export type InstacartActions =
    | AddToCartAction
    | AddToListAction
    | BuyAllInListAction
    | BuyAllInRecipeAction
    | BuyItAgainAction
    | FindNearbyStoreAction
    | RemoveFromCartAction
    | SaveListForLaterAction
    | SetPreferredStoreAction
    | GetShoppingCartAction
    | SaveRecipeAction
    | DeleteRecipeAction
    | SearchForProductAction
    | SearchForRecipeAction;

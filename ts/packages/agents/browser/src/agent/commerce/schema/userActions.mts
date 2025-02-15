// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

export type AddToCartAction = {
    actionName: "addToCartAction";
    parameters: {
        productName: string;
    };
};

// This allows you to view the shopping cart contents
export type ViewShoppingCartAction = {
    actionName: "viewShoppingCartAction";
};

export type FindNearbyStoreAction = {
    actionName: "findNearbyStoreAction";
};

// Use this action for user queries such as "where is product X in the store"
export type GetLocationInStore = {
    actionName: "getLocationInStore";
    parameters: {
        productName: string;
    };
};

// IMPORTANT: Use this action when the user query involves search for products on an e-commerce store, such as "aaa batteries"
export type SearchForProductAction = {
    actionName: "searchForProductAction";
    parameters: {
        productName: string;
    };
};

export type SelectSearchResult = {
    actionName: "selectSearchResult";
    parameters: {
        position: number;
        productName?: string;
    };
};

export type ShoppingActions =
    | AddToCartAction
    | ViewShoppingCartAction
    | FindNearbyStoreAction
    | GetLocationInStore
    | SearchForProductAction
    | SelectSearchResult;

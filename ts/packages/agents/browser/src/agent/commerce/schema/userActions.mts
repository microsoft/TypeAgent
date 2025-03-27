// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

export type AddToCart = {
    actionName: "addToCart";
    parameters: {
        productName: string;
    };
};

// This allows you to view the shopping cart contents
export type ViewShoppingCart = {
    actionName: "viewShoppingCart";
};

export type FindNearbyStore = {
    actionName: "findNearbyStore";
};

// Use this action for user queries such as "where is product X in the store"
export type GetLocationInStore = {
    actionName: "getLocationInStore";
    parameters: {
        productName: string;
    };
};

// IMPORTANT: Use this action when the user query involves search for products on an e-commerce store, such as "aaa batteries"
export type SearchForProduct = {
    actionName: "searchForProduct";
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
    | AddToCart
    | ViewShoppingCart
    | FindNearbyStore
    | GetLocationInStore
    | SearchForProduct
    | SelectSearchResult;

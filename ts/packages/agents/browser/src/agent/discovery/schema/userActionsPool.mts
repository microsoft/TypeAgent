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
        selectionCriteria?: string;
    };
};

// This allows users to select individual results on the search results page.
export type SelectSearchResult = {
    actionName: "selectSearchResult";
    parameters: {
        position: number;
        productName?: string;
    };
};

export type NavigateToPage = {
    actionName: "navigateToPage";
    parameters: {
        keywords: string;
    };
};

export type BrowseProductCategories = {
    actionName: "browseProductCategories";
    parameters: {
        categoryName?: string;
    };
};

// This allows users to filter products based on a criteria such as price, size, shipping options etc.
export type FilterProducts = {
    actionName: "filterProducts";
    parameters: {
        filterCriteria: string;
    };
};

export type SignUpForNewsletter = {
    actionName: "signUpForNewsletter";
    parameters: {
        emailAddress: string;
    };
};

// Follow a link to view  a product details page
export type NavigateToProductPage = {
    actionName: "navigateToProductPage";
    parameters: {
        productName: string;
    };
};

export type UserPageActions =
    | AddToCart
    | BrowseProductCategories
    | FilterProducts
    | FindNearbyStore
    | GetLocationInStore
    | NavigateToPage
    | NavigateToProductPage
    | RemoveFromCart
    | SearchForProduct
    | SelectSearchResult
    | SignUpForNewsletter
    | ViewShoppingCart;

export type UserActionsList = {
    actions: UserPageActions[];
};

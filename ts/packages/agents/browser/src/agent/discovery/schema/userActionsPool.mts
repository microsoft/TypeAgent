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

export type BrowseProductCategoriesAction = {
    actionName: "browseProductCategoriesAction";
    parameters: {
        categoryName?: string;
    };
};

// This allows users to filter products based on a criteria such as price, size, shipping options etc.
export type FilterProductsAction = {
    actionName: "filterProductsAction";
    parameters: {
        filterCriteria: string;
    };
};

export type SignUpForNewsletterAction = {
    actionName: "signUpForNewsletterAction";
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
    | AddToCartAction
    | BrowseProductCategoriesAction
    | FilterProductsAction
    | FindNearbyStoreAction
    | GetLocationInStore
    | NavigateToPage
    | NavigateToProductPage
    | RemoveFromCartAction
    | SearchForProductAction
    | SelectSearchResult
    | SignUpForNewsletterAction
    | ViewShoppingCartAction;

export type UserActionsList = {
    actions: UserPageActions[];
};

// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

export type AddToCartAction = {
  actionName: "AddToCartAction";
  parameters: {
    productName: string;
  };
};

export type FindNearbyStoreAction = {
  actionName: "FindNearbyStoreAction";
};

// Use this action for user queries such as "where is product X in the store"
export type GetLocationInStore = {
  actionName: "GetLocationInStore";
  parameters: {
    productName: string;
  };
};

// IMPORTANT: Use this action when the user query involves search for products on an e-commerce store, such as "aaa batteries"
export type SearchForProductAction = {
  actionName: "SearchForProductAction";
  parameters: {
    productName: string;
  };
};

// This allows users to select individual results on the search results page.
export type SelectSearchResult = {
  actionName: "SelectSearchResult";
  parameters: {
    position: number;
    productName?: string;
  };
};

export type NavigateToHomePage = {
  actionName: "NavigateToHomePage";
  parameters: {
    linkCssSelector: string;
  };
};

// Follow a link to view  a store landing page
export type NavigateToStorePage = {
  actionName: "NavigateToStorePage";
  parameters: {
    linkCssSelector: string;
  };
};

// Follow a link to view  a product details page
export type NavigateToProductPage = {
  actionName: "NavigateToProductPage";
  parameters: {
    linkCssSelector: string;
  };
};

// Follow a link to view  a recipe details page. This link is typically named "Recipe" or "Recipes"
export type NavigateToRecipePage = {
  actionName: "NavigateToRecipePage";
  parameters: {
    linkCssSelector: string;
  };
};

export type NavigateToListPage = {
  actionName: "NavigateToListPage";
  parameters: {
    linkCssSelector: string;
  };
};

// Navigate to the "Buy it again" page. This page may also be called Past Orders.
export type NavigateToBuyItAgainPage = {
  actionName: "NavigateToBuyItAgainPage";
  parameters: {
    linkCssSelector: string;
  };
};

// This link opens the shopping cart. Its usually indicated by a cart or bag icon.
export type NavigateToShoppingCartPage = {
  actionName: "NavigateToShoppingCartPage";
  parameters: {
    linkCssSelector: string;
  };
};

export type NavigateToOtherPage = {
  actionName: "NavigateToOtherPage";
  parameters: {
    pageType: string;
    linkCssSelector: string;
  };
};

export type UserPageActions =
  | AddToCartAction
  | FindNearbyStoreAction
  | GetLocationInStore
  | SearchForProductAction
  | SelectSearchResult
  | NavigateToBuyItAgainPage
  | NavigateToHomePage
  | NavigateToListPage
  | NavigateToOtherPage
  | NavigateToProductPage
  | NavigateToRecipePage
  | NavigateToShoppingCartPage
  | NavigateToStorePage;

export type UserActionsList = {
  actions: UserPageActions[];
};

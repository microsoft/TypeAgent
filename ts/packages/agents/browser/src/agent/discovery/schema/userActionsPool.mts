// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

export type AddToCartAction = {
  actionName: "addToCartAction";
  parameters: {
    productName: string;
  };
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

export type NavigateToHomePage = {
  actionName: "navigateToHomePage";
};

// Follow a link to view  a store landing page
export type NavigateToStorePage = {
  actionName: "navigateToStorePage";
};

// Follow a link to view  a product details page
export type NavigateToProductPage = {
  actionName: "navigateToProductPage";
};

// Follow a link to view  a recipe details page
export type NavigateToRecipePage = {
  actionName: "navigateToRecipePage";
};

export type NavigateToListPage = {
  actionName: "navigateToListPage";
};

export type NavigateToBuyItAgainPage = {
  actionName: "navigateToBuyItAgainPage";
};

export type NavigateToShoppingCartPage = {
  actionName: "navigateToShoppingCartPage";
};

export type NavigateToOtherPage = {
  actionName: "navigateToOtherPage";
  parameters: {
    pageType: string;
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

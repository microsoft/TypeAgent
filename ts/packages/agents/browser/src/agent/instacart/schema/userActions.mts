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

export type ViewCartAction = {
  actionName: "viewCartAction";
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
    listName: string;
    productName: string;
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
    storeName?: string;
  };
};

export type SelectSearchResult = {
  actionName: "selectSearchResult";
  parameters: {
    position?: number;
    productName?: string;
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
  | ViewCartAction
  | SaveRecipeAction
  | DeleteRecipeAction
  | SearchForProductAction
  | SearchForRecipeAction
  | SelectSearchResult;

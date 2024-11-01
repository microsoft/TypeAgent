// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

export type AddToCartAction = {
  actionName: "addToCartAction";
  parameters: {
    productName: string;
  };
};

export type PickUpAtStoreAction = {
  actionName: "pickUpAtStoreAction";
  parameters: {
    productName: string;
    storeLocation?: string;
  };
};

export type LookupAtStoreAction = {
  actionName: "lookupAtStoreAction";
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

// select this action when the user's request needs an answer based on the content on the current webpage
export type AnswerQuestionBasedOnPage = {
  actionName: "answerPageQuestion";
  parameters: {
    question: string;
  };
};

export type ShoppingActions =
  | AddToCartAction
  | PickUpAtStoreAction
  | LookupAtStoreAction
  | SearchForProductAction
  | SelectSearchResult
  | AnswerQuestionBasedOnPage;

// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

export type ProductTile = {
  name: string;
  brand: string;
  price: string;

  // CSS Selector for the link to the product details page
  // Construct the selector based on the element's Id attribute if the id is present.
  detailsLinkSelector: string;

  // css selector for the add to cart button
  addToCartButtonCssSelector: string;
};

// This is only present on the Product Details Page
export type ProductDetailsHeroTile = {
  productName: string;
  price: string;
  rating: string;

  // css selector for text input
  cssSelector: string;

  addToCartButton?: {
    // css selector for the add to cart button
    cssSelector: string;
  };

  addToListButton?: {
    // css selector for the add to cart button
    cssSelector: string;
  };

  storeName?: string;
  // The physical location of the goods, such as the Aisle, Bay or Shelf
  // Only provide this infomration if it present on the page
  physicalLocationInStore?: string;
  numberInStock?: string;
};

export type SearchInput = {
  // css selector for text input
  cssSelector: string;

  // css selector for submit button
  submitButtonCssSelector: string;
};

// The Instacart brand link at the top of the page. Clicking this takes you to the homepage.
export type HomeLink = {
  linkCssSelector: string;
};

// the navigation link to the "Your Lists" view on instacart
export type ListsNavigationLink = {
  linkCssSelector: string;
};

// the navigation link to the "Buy it Again" view on instacart
export type BuyItAgainNavigationLink = {
  linkCssSelector: string;
};

// Information the Physical store location
export type StoreInfo = {
  name: string;
  subtitle: string;
  storeLinkCssSelector: string;
};

export type RecipeBuyButton = {
  cssSelector: string;
  label: string;
  ingredientCount: number;
};

export type RecipeHeroSection = {
  recipeName: string;
  summary: string;
  addAllIngridientsCssSelector: string;
  saveButtonCssSelector: string;
};

// this gives the details for a specific recipe
export type RecipeInfo = {
  name: string;
  ingredients: ProductTile[];
  recipeLinkCssSelector: string;
};

// this captures the recipes visible on the page
export type AllRecipeSearchResults = {
  keyword: string;
  // The complete list of recipes in the search results page
  recipes: RecipeSearchResult[];
};

export type RecipeSearchResult = {
  name: string;
  // The CSS selector for a link to an individual recipe
  recipeLinkCssSelector: string;
};

export type AllListsInfo = {
  lists: [
    {
      name: string;
      cssSelector: string;
    },
  ];
  submitButtonCssSelector: string;
};

export type ListInfo = {
  name: string;
  detailsLinkCssSelector: string;
};

export type ListDetailsInfo = {
  name: string;
  storeName?: string;
  products?: ProductTile[];
};

export type BuyItAgainHeaderSection = {
  allItemsCssSelector: string;
  pastOrdersCssSelector: string;
  products?: ProductTile[];
};

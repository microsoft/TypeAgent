// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

export type SearchInput = {
  // css selector for text input
  cssSelector: string;
};

export type AddToCartButton = {
  // css selector for the add to cart button
  cssSelector: string;
};

export type ProductTile = {
  productName: string;
  price: string;
  rating: string;

  // css selector for text input
  cssSelector: string;

  // CSS Selector for the link to the product details page
  detailsLinkSelector: string;

  addToCartButton?: AddToCartButton;
};

export type SearchPage = {
  productTiles: ProductTile[];
  searchBox: SearchInput;
};

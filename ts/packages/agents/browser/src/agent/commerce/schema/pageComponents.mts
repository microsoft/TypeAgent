// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

export type AddToCartButton = {
  // css selector for the add to cart button
  cssSelector: string;
};

export type ProductTile = {
  productName: string;
  price: string;
  rating: string;

  // CSS Selector for the link to the product details page
  // Construct the selector based on the element's Id attribute if the id is present.
  detailsLinkSelector: string;
};

// This is only present on the Product Details Page
export type ProductDetailsHeroTile = {
  productName: string;
  price: string;
  rating: string;

  // css selector for text input
  cssSelector: string;

  addToCartButton?: AddToCartButton;
  locationInStore?: string;
  numberInStock?: string;
};

export type SearchInput = {
  // css selector for text input
  cssSelector: string;

  // css selector for submit button
  submitButtonCssSelector: string;
};

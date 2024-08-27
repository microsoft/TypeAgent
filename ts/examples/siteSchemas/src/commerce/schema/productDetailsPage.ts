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

    // css selector for text input
    cssSelector: string;

    addToCartButton?: AddToCartButton;
    locationInStore?: string;
    numberInStock?: string;
};

export type ProductDetailsPage = {
    mainProductInfo: ProductTile;
    relatedProductTiles: ProductTile[];
};

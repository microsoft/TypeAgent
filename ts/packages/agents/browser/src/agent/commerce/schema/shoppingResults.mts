// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

export type ProductTile = {
    name: string;
    brand: string;
    price: string;
    quantity: string;
    // This indicates the number of units in stock, or "Out of stock" if item is not available
    availability?: string;

    // CSS Selector for the link to the product details page
    // Construct the selector based on the element's Id attribute if the id is present.
    detailsLinkSelector: string;

    // css selector for the add to cart button
    addToCartButtonCssSelector: string;
};

export type PurchaseResults = {
    addedToCart: ProductTile[];
    // indicates items that are unavailable or out of stock
    unavailable: ProductTile[];

    storeName: string;
    deliveryInformation?: string;
};

// This is a generated summary of the shopping results.
// The message should be concise and friendly. Make sure to communicate any items that were unavailable or out of stock.
export type PurchaseSummary = {
    formattedMessage: string;
};

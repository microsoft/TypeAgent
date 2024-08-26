// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

export type ElementSelector = {
    // CSS Selector for the interactive element on the page
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
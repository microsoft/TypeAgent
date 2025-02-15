// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

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

    addToCartButton?: {
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

// Information the Physical store location
export type StoreLocation = {
    locationName: string;
    zipCode: string;
};

// Information the Physical store location
export type LocationInStore = {
    storeName: string;
    // The physical location of the goods, such as the Aisle, Bay or Shelf
    physicalLocationInStore: string;
    numberInStock?: string;
};

export type NavigationLink = {
    // CSS Selector for the link
    title: string;
    linkCssSelector: string;
};

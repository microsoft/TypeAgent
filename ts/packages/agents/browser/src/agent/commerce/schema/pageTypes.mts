// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

export type SearchBox = {
    featureName: "searchInputBox";
    description: "Input box for searching on the page";
    parameters: {
        cssSelector: string;
    };
};

export type SearchResultsList = {
    featureName: "searchResultsList";
    description: "List of products available from the search results";
    parameters: {
        cssSelector: string;
    };
};

export type ProductDetailsCard = {
    featureName: "productDetailsCard";
    description: "A section that shows the product name, price, images and rating. This also gives an option to add the product to the shopping cart.";
    parameters: {
        cssSelector: string;
    };
};

export type SearchForContent = {
    actionName: "searchForProduct";
    description: "Find content on the page";
    parameters: {
        value: string;
        cssSelector: string;
    };
};

export type LandingPage = {
    description: "The default landing page for the site";
    features: SearchBox;
};

export type SearchResultsPage = {
    description: "The default landing page for the site";
    features: SearchResultsList;
};

export type ProductDetailsPage = {
    description: "The default landing page for the site";
    features: ProductDetailsCard;
};

export type ShoppingCartPage = {
    description: "The default landing page for the site";
    features: SearchBox;
};

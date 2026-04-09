// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

// Page component types used by extractComponent() in webflow scripts.
// These must match the typeName values used in webflow sample scripts
// and the webagent common/pageComponents.ts definitions.

export type SearchInput = {
    cssSelector: string;
    submitButtonCssSelector: string;
};

export type ProductTile = {
    name: string;
    price: string;
    rating?: string;
    brand?: string;
    quantity?: string;
    availability?: string;
    detailsLinkSelector: string;
    addToCartButtonSelector?: string;
};

export type ProductDetailsHero = {
    name: string;
    price: string;
    rating?: string;
    cssSelector: string;
    addToCartButtonSelector?: string;
    addToListButtonSelector?: string;
    storeName?: string;
    physicalLocationInStore?: string;
    numberInStock?: string;
};

export type ShoppingCartButton = {
    label: string;
    detailsLinkSelector: string;
};

export type ShoppingCartDetails = {
    storeName: string;
    deliveryInformation: string;
    totalAmount: string;
    productsInCart?: {
        name: string;
        price: string;
        quantity?: string;
    }[];
    relatedProducts?: {
        name: string;
        price: string;
    }[];
};

export type NavigationLink = {
    title: string;
    linkSelector: string;
};

export type Button = {
    title: string;
    cssSelector: string;
};

export type TextInput = {
    title: string;
    cssSelector: string;
    placeholderText?: string;
};

export type Element = {
    title: string;
    cssSelector: string;
};

export type DropdownControl = {
    title: string;
    cssSelector: string;
    values: {
        text: string;
        value: string;
    }[];
};

export type StoreInfo = {
    name: string;
    subtitle?: string;
    linkSelector?: string;
    zipCode?: string;
};

export type NearbyStoresList = {
    stores: {
        name: string;
        subtitle?: string;
        linkSelector: string;
    }[];
};

// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

export interface PageComponentDefinition {
    typeName: string;
    schema: string;
}

// Universal search input - works on most e-commerce sites
export const SearchInput: PageComponentDefinition = {
    typeName: "SearchInput",
    schema: `{
    // CSS selector for the search text input
    cssSelector: string;
    // CSS selector for the search submit button
    submitButtonCssSelector: string;
}`,
};

// Product tile on search results or listing pages
export const ProductTile: PageComponentDefinition = {
    typeName: "ProductTile",
    schema: `{
    name: string;
    price: string;
    rating?: string;
    brand?: string;
    quantity?: string;
    // "In stock", "Out of stock", or quantity available
    availability?: string;
    // CSS selector for link to product details page
    detailsLinkSelector: string;
    // CSS selector for add-to-cart button (if visible on listing)
    addToCartButtonSelector?: string;
}`,
};

// Product details page hero section
export const ProductDetailsHero: PageComponentDefinition = {
    typeName: "ProductDetailsHero",
    schema: `{
    name: string;
    price: string;
    rating?: string;
    cssSelector: string;
    addToCartButtonSelector?: string;
    addToListButtonSelector?: string;
    storeName?: string;
    // The physical location of the goods, such as the Aisle, Bay or Shelf
    physicalLocationInStore?: string;
    numberInStock?: string;
}`,
};

// Shopping cart button in header/nav
export const ShoppingCartButton: PageComponentDefinition = {
    typeName: "ShoppingCartButton",
    schema: `{
    label: string;
    detailsLinkSelector: string;
}`,
};

// Shopping cart details view
export const ShoppingCartDetails: PageComponentDefinition = {
    typeName: "ShoppingCartDetails",
    schema: `{
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
}`,
};

// Generic navigation link
export const NavigationLink: PageComponentDefinition = {
    typeName: "NavigationLink",
    schema: `{
    title: string;
    linkSelector: string;
}`,
};

// Generic button
export const Button: PageComponentDefinition = {
    typeName: "Button",
    schema: `{
    title: string;
    cssSelector: string;
}`,
};

// Generic text input field
export const TextInput: PageComponentDefinition = {
    typeName: "TextInput",
    schema: `{
    title: string;
    cssSelector: string;
    placeholderText?: string;
}`,
};

// Store/location info
export const StoreInfo: PageComponentDefinition = {
    typeName: "StoreInfo",
    schema: `{
    name: string;
    subtitle?: string;
    linkSelector?: string;
    zipCode?: string;
}`,
};

// List of nearby stores
export const NearbyStoresList: PageComponentDefinition = {
    typeName: "NearbyStoresList",
    schema: `{
    stores: {
        name: string;
        subtitle?: string;
        linkSelector: string;
    }[];
}`,
};

// Lookup map for string-based access (backwards compatibility)
export const COMMON_COMPONENTS: Record<string, PageComponentDefinition> = {
    SearchInput,
    ProductTile,
    ProductDetailsHero,
    ShoppingCartButton,
    ShoppingCartDetails,
    NavigationLink,
    Button,
    TextInput,
    StoreInfo,
    NearbyStoresList,
};

// TypeScript interfaces for type safety in WebAgents
export interface SearchInputType {
    cssSelector: string;
    submitButtonCssSelector: string;
}

export interface ProductTileType {
    name: string;
    price: string;
    rating?: string;
    brand?: string;
    quantity?: string;
    availability?: string;
    detailsLinkSelector: string;
    addToCartButtonSelector?: string;
}

export interface ProductDetailsHeroType {
    name: string;
    price: string;
    rating?: string;
    cssSelector: string;
    addToCartButtonSelector?: string;
    addToListButtonSelector?: string;
    storeName?: string;
    physicalLocationInStore?: string;
    numberInStock?: string;
}

export interface ShoppingCartButtonType {
    label: string;
    detailsLinkSelector: string;
}

export interface ShoppingCartDetailsType {
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
}

export interface NavigationLinkType {
    title: string;
    linkSelector: string;
}

export interface ButtonType {
    title: string;
    cssSelector: string;
}

export interface TextInputType {
    title: string;
    cssSelector: string;
    placeholderText?: string;
}

export interface StoreInfoType {
    name: string;
    subtitle?: string;
    linkSelector?: string;
    zipCode?: string;
}

export interface NearbyStoresListType {
    stores: {
        name: string;
        subtitle?: string;
        linkSelector: string;
    }[];
}

// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

// Available browser methods for webFlow scripts.
// The script's `browser` parameter implements this interface.

export interface WebFlowBrowserMethods {
    navigateTo(url: string): Promise<void>;
    goBack(): Promise<void>;
    awaitPageLoad(timeout?: number): Promise<void>;
    awaitPageInteraction(timeout?: number): Promise<void>;
    getCurrentUrl(): Promise<string>;

    // Click an element by CSS selector.
    click(cssSelector: string): Promise<void>;
    // Click then wait for page interaction + load.
    clickAndWait(cssSelector: string, timeout?: number): Promise<void>;
    // Click a link and wait for navigation (same as clickAndWait).
    followLink(cssSelector: string): Promise<void>;

    // Enter text into an input identified by CSS selector.
    enterText(cssSelector: string, text: string): Promise<void>;
    // Enter text at page scope without targeting a specific element.
    enterTextOnPage(text: string, submitForm?: boolean): Promise<void>;
    clearAndType(cssSelector: string, text: string): Promise<void>;
    pressKey(key: string): Promise<void>;
    // Select a value from a <select> dropdown by CSS selector.
    selectOption(cssSelector: string, value: string): Promise<void>;

    getPageText(): Promise<string>;

    waitForNavigation(timeout?: number): Promise<void>;

    // LLM-based extraction that finds page elements matching a component schema.
    // Returns an object whose shape matches the component's schema definition.
    // Use this to locate elements on the page — it returns CSS selectors you can
    // pass directly to click, enterText, selectOption, etc.
    extractComponent<T = unknown>(
        componentDef: ComponentDef,
        userRequest?: string,
    ): Promise<T>;
}

export type ComponentDef = {
    typeName: string;
    schema: string;
};

// --- Available component schemas for extractComponent ---

export type SearchInputComponent = {
    cssSelector: string;
    submitButtonCssSelector: string;
};

export type ProductTileComponent = {
    name: string;
    price: string;
    detailsLinkSelector: string;
    addToCartButtonSelector?: string;
};

export type ProductDetailsHeroComponent = {
    name: string;
    price: string;
    cssSelector: string;
    addToCartButtonSelector?: string;
};

export type ShoppingCartButtonComponent = {
    label: string;
    detailsLinkSelector: string;
};

export type ShoppingCartDetailsComponent = {
    storeName: string;
    totalAmount: string;
    productsInCart?: { name: string; price: string; quantity?: string }[];
};

export type NavigationLinkComponent = {
    title: string;
    linkSelector: string;
};

export type ButtonComponent = {
    title: string;
    cssSelector: string;
};

export type TextInputComponent = {
    title: string;
    cssSelector: string;
    placeholderText?: string;
};

// Generic clickable element found by visible text
export type ElementComponent = {
    title: string;
    cssSelector: string;
};

// Dropdown/select control with its available options
export type DropdownControlComponent = {
    title: string;
    cssSelector: string;
    values: { text: string; value: string }[];
};

export type StoreInfoComponent = {
    name: string;
    linkSelector?: string;
    zipCode?: string;
};

export type NearbyStoresListComponent = {
    stores: { name: string; linkSelector: string }[];
};

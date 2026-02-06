// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

// This allows you to view the shopping cart contents
export type ViewShoppingCart = {
    actionName: "viewShoppingCart";
};

export type FindNearbyStore = {
    actionName: "findNearbyStore";
};

// Use this action for user queries such as "where is product X in the store"
export type GetLocationInStore = {
    actionName: "getLocationInStore";
    parameters: {
        productName: string;
    };
};

export type BuyProduct = {
    actionName: "buyProduct";
    parameters: {
        // the original user request
        userRequest: string;
        productName?: string;
    };
};

export type SearchForReservation = {
    actionName: "searchForReservation";
    parameters: {
        restaurantName: string;
        // provide an AM or PM time. If the user gives a meal-based time such as breakfast or dinner,
        // translate this into a correspodning AM or PM time.
        time: string;
        // default value is 1
        numberOfPeople: number;
    };
};

export type SelectReservation = {
    actionName: "selectReservation";
    parameters: {
        time: string;
    };
};

/**
 * Get an element from the page by natural language description
 * Example: "Find the Home button", "Get the search input field"
 */
export type GetElementByDescription = {
    actionName: "getElementByDescription";
    parameters: {
        // Natural language description of the element to find
        elementDescription: string;

        // Optional hint about element type (button, input, link, etc.)
        elementType?: string;
    };
};

/**
 * Check if the current page state matches an expected condition
 * Example: "Verify the page shows the shopping cart"
 */
export type IsPageStateMatched = {
    actionName: "isPageStateMatched";
    parameters: {
        // Expected page state description
        expectedStateDescription: string;
    };
};

/**
 * Query page content to answer a question
 * Example: "How many batteries are in stock?", "What is the product price?"
 */
export type QueryPageContent = {
    actionName: "queryPageContent";
    parameters: {
        // The question to answer
        query: string;
    };
};

export type ShoppingActions =
    | ViewShoppingCart
    | FindNearbyStore
    | GetLocationInStore
    | BuyProduct
    | SearchForReservation
    | SelectReservation
    | GetElementByDescription
    | IsPageStateMatched
    | QueryPageContent;

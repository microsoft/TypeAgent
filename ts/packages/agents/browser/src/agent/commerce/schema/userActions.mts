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
        numberOfPeople:number;
    };
};

export type SelectReservation = {
    actionName: "selectReservation";
    parameters: {
        time: string;
    };
};

export type ShoppingActions =
    | ViewShoppingCart
    | FindNearbyStore
    | GetLocationInStore
    | BuyProduct
    | SearchForReservation
    | SelectReservation;

// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

export type PropertyValueType = string | number | boolean;

// Used when the property value is inferred or implied by the request and no substring or entity is used to compute value.
export interface ImplicitProperty {
    name: string;
    value: PropertyValueType;
    isImplicit: true;
}

// Use this if the property value comes directly from the request.
export interface Property {
    name: string;
    value: PropertyValueType;
    // all substring(s) from the original request that is needed to compute the value.
    substrings: string[];
    implied: boolean; // implied by the context of the substrings in the request
}

// Use this if the property value is only in the conversation history and not from the request.
export interface EntityProperty {
    name: string;
    value: PropertyValueType;
    // all substring(s) from the original request that references the entity.
    substrings: string[];
    // the index of the entity in the history.
    entityIndex: number;
}

export interface PropertyExplanation {
    properties: (Property | ImplicitProperty | EntityProperty)[];
}

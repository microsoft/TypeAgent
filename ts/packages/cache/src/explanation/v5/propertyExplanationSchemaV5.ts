// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

export type PropertyValuetype = string | number | boolean;

// Used when the property value is inferred or implied by the request and no substring helped infer the value.
export interface ImplicitProperty {
    name: string;
    value: PropertyValuetype;
    isImplicit: true;
}

export interface Property {
    name: string;
    value: PropertyValuetype;
    // all substring(s) from the original request that is needed to compute the value.  The text must be exact copy of a part of the original request. Do NOT change the text by correct misspelling or grammar.
    substrings: string[];
}

export interface PropertyExplanation {
    properties: (Property | ImplicitProperty)[];
}

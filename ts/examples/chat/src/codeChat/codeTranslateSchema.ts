// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

export type TranslationResponse = Translation | NoResponse;

export type Translation = {
    responseType: "translate";
    translation: string;
    params?: Parameter[];
    returnValue?: ReturnValue;
};

export type Parameter = {
    name: string;
    description: string;
};

export type ReturnValue = {
    description: string;
};

// Use when you cannot make a translation
export type NoResponse = {
    responseType: "noResponse";
    reason: string;
};

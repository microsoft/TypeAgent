// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

// A description of the page state.
export type PageState = {
    // a short name for the page type. This is presented in camelCase
    pageType: string;
    description: string;
    possibleNextUserAction?: string[];
};

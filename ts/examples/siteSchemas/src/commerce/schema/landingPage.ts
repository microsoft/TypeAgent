// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

export type SearchInput = {
    // css selector for text input
    cssSelector: string;

    // css selector for submit button
    submitButtonCssSelector: string;
};

export type LandingPage = {
    searchBox: SearchInput;
};

// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

export type CrosswordClue = {
    number: number;
    text: string;
    // The CSS Selector for the HTML element that holds the clue
    // Construct the selector based on the element's Id attribute if the id is present.
    cssSelector?: string;
};

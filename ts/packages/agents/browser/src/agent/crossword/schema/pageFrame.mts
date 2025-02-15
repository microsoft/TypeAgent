// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

export type CrosswordPresence = {
    // This indicates that a crossword is present on the page. A crossword has a grid
    // of squares and a list of clues (for down and across). Only set this value to true
    // if the full crossword is present in the current HTML.
    crossWordPresent: boolean;
    // The CSS Selector for the HTML element that contains crossword clues for Across
    cluesRoootAcrossCSSSelector: string;
    // The CSS Selector for the HTML element that contains crossword clues for Down
    cluesRoootDownCSSSelector: string;
};

// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

export type CrosswordClue = {
    number: number;
    text: string;
    // The CSS Selector for the HTML element that holds the clue
    // Construct the selector based on the element's Id attribute if the id is present.
    cssSelector: string;
};

// VERY IMPORTANT: you MUST include ALL the clues.
export type Crossword = {
    across: CrosswordClue[];
    down: CrosswordClue[];
};

// IMPORTANT: The CrosswordPresence type only has three fields - crossWordPresent, cluesRoootAcrossCSSSelector,
// and  cluesRoootDownCSSSelector. You must ONLY return these fields when returning a CrosswordPresence response.
export type CrosswordPresence = {
    // This indicats that a crossword is present on the page. A crossword has a grid
    // of squares and a list of clues (for down and across). Only set this value to true
    // if the full crossword is present in the current HTML.
    crossWordPresent: boolean;
    // The CSS Selector for the HTML element that contains crossword clues for Across
    cluesRoootAcrossCSSSelector: string;
    // The CSS Selector for the HTML element that contains crossword clues for Down
    cluesRoootDownCSSSelector: string;
};

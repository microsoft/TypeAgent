// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

jest.mock("../../src/extension/webagent/crossword/CrosswordWebAgent", () => ({
    CrosswordWebAgent: jest.fn().mockImplementation(() => ({
        name: "crossword",
        urlPatterns: [],
        initialize: jest.fn(),
    })),
}));

import { hasVisibleExolvePuzzle } from "../../src/extension/sites/crossword";

describe("Exolve detection", () => {
    afterAll(() => {
        window.dispatchEvent(new Event("pagehide"));
    });

    beforeEach(() => {
        document.body.replaceChildren();
    });

    function addClue(): Element {
        document.body.innerHTML =
            '<div class="xlv-frame"><div class="xlv-clues"><span class="xlv-clue-text">A clue</span></div></div>';
        return document.querySelector(".xlv-clue-text")!;
    }

    test("requires a supported clue inside a frame", () => {
        document.body.innerHTML =
            '<span class="xlv-clue-text">Not a puzzle</span>';
        expect(hasVisibleExolvePuzzle()).toBe(false);
    });

    test("ignores an unrendered template", () => {
        addClue();
        expect(hasVisibleExolvePuzzle()).toBe(false);
    });

    test("accepts rendered clues but not visibility-hidden clones", () => {
        const clue = addClue();
        Object.defineProperty(clue, "getClientRects", {
            value: () => [{ x: 0, y: 0, width: 100, height: 20 }],
        });
        expect(hasVisibleExolvePuzzle()).toBe(true);
        clue.setAttribute("style", "visibility: hidden");
        expect(hasVisibleExolvePuzzle()).toBe(false);
    });
});

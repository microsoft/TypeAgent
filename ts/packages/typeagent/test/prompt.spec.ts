// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { JSONStringifyInChunks } from "../src/prompt";

describe("JSONPromptBuilder", () => {
    test("getChunks", () => {
        const author = {
            firstName: "Jane",
            lastName: "Austen",
            books: [
                "Pride and Prejudice",
                "Mansfield Park",
                "Sense and Sensibility",
                "Emma",
            ],
        };
        let chunkNumber = 0;
        let expectedChunks = 3;
        for (const chunk of JSONStringifyInChunks(author, 20)) {
            expect(chunk.length).toBeGreaterThan(0);
            ++chunkNumber;
            switch (chunkNumber) {
                case 1:
                    expect(chunk.search("Jane")).toBeGreaterThan(0);
                    expect(chunk.search("Austen")).toBeGreaterThan(0);
                    expect(chunk.search("Mansfield Park")).toBeLessThan(0);
                    break;
                case 2:
                    expect(chunk.search("Mansfield Park")).toBeGreaterThan(0);
                    expect(chunk.search("Emma")).toBeLessThan(0);
                    break;
                case 3:
                    expect(chunk.search("Mansfield Park")).toBeLessThan(0);
                    expect(chunk.search("Emma")).toBeGreaterThan(0);
            }
        }
        expect(chunkNumber).toEqual(expectedChunks);
    });
});

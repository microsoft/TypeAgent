// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/**
 * Placeholder listName rejection — grammar can bind "the"/"my"/"list" from
 * phrases like "add ham to the list". Those must not be treated as real lists.
 */

import { isPlaceholderListName } from "../src/listNameUtils.js";

describe("isPlaceholderListName", () => {
    test.each([
        "the",
        "that",
        "my",
        "a",
        "an",
        "this",
        "these",
        "those",
        "your",
        "list",
        "the list",
        "my list",
        "that list",
        "",
        "  ",
        "THE",
        "My",
    ])("rejects placeholder %j", (name) => {
        expect(isPlaceholderListName(name)).toBe(true);
    });

    test.each([
        "grocery",
        "shopping",
        "Contoso grocery",
        "to do",
        "q3 packing",
        "gift",
    ])("accepts real list name %j", (name) => {
        expect(isPlaceholderListName(name)).toBe(false);
    });
});

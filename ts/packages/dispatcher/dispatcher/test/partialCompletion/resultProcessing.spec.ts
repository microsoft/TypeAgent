// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import {
    PartialCompletionSession,
    CommandCompletionResult,
    CompletionGroup,
    makeMenu,
    makeDispatcher,
    makeCompletionResult,
    getPos,
    anyPosition,
} from "./helpers.js";

describe("PartialCompletionSession — result processing", () => {
    test("startIndex narrows the anchor (current) to input[0..startIndex]", async () => {
        const menu = makeMenu();
        // startIndex=4 means grammar consumed "play" (4 chars); the
        // trailing space is the separator between anchor and completions.
        const result = makeCompletionResult(["song", "shuffle"], 4);
        const dispatcher = makeDispatcher(result);
        const session = new PartialCompletionSession(menu, dispatcher);

        session.update("play song", getPos);
        await Promise.resolve();

        // prefix should be "song" (the text after anchor "play" + separator " ")
        expect(menu.updatePrefix).toHaveBeenCalledWith("song", anyPosition);
    });

    test("group order preserved: items appear in backend-provided group order", async () => {
        const menu = makeMenu();
        const group1: CompletionGroup = {
            name: "grammar",
            completions: ["by"],
            sorted: true,
        };
        const group2: CompletionGroup = {
            name: "entities",
            completions: ["Bohemian Rhapsody"],
            sorted: true,
        };
        const result: CommandCompletionResult = {
            startIndex: 4,
            completions: [group1, group2],
            closedSet: false,
            directionSensitive: false,
            afterWildcard: "none",
        };
        const dispatcher = makeDispatcher(result);
        const session = new PartialCompletionSession(menu, dispatcher);

        session.update("play ", getPos);
        await Promise.resolve();

        const calls = menu.setChoices.mock.calls;
        const items = calls[calls.length - 1][0] as {
            sortIndex: number;
            selectedText: string;
        }[];
        const byIndex = items.find((i) => i.selectedText === "by")!.sortIndex;
        const bohIndex = items.find(
            (i) => i.selectedText === "Bohemian Rhapsody",
        )!.sortIndex;
        expect(byIndex).toBeLessThan(bohIndex);
    });

    test("needQuotes propagated from group to each SearchMenuItem", async () => {
        const menu = makeMenu();
        const group: CompletionGroup = {
            name: "entities",
            completions: ["Bohemian Rhapsody"],
            needQuotes: true,
            sorted: true,
        };
        const result: CommandCompletionResult = {
            startIndex: 4,
            completions: [group],
            closedSet: false,
            directionSensitive: false,
            afterWildcard: "none",
        };
        const dispatcher = makeDispatcher(result);
        const session = new PartialCompletionSession(menu, dispatcher);

        session.update("play ", getPos);
        await Promise.resolve();

        expect(menu.setChoices).toHaveBeenCalledWith(
            expect.arrayContaining([
                expect.objectContaining({
                    selectedText: "Bohemian Rhapsody",
                    needQuotes: true,
                }),
            ]),
        );
    });

    test("unsorted group items are sorted alphabetically", async () => {
        const menu = makeMenu();
        const group: CompletionGroup = {
            name: "test",
            completions: ["zebra", "apple", "mango"],
            sorted: false,
            separatorMode: "none",
        };
        const result: CommandCompletionResult = {
            startIndex: 0,
            completions: [group],
            closedSet: false,
            directionSensitive: false,
            afterWildcard: "none",
        };
        const dispatcher = makeDispatcher(result);
        const session = new PartialCompletionSession(menu, dispatcher);

        session.update("x", getPos);
        await Promise.resolve();

        const calls = menu.setChoices.mock.calls;
        const items = calls[calls.length - 1][0] as { selectedText: string }[];
        const texts = items.map((i) => i.selectedText);
        expect(texts).toEqual(["apple", "mango", "zebra"]);
    });

    test("empty completions list does not call setChoices with items", async () => {
        const menu = makeMenu();
        const result: CommandCompletionResult = {
            startIndex: 0,
            completions: [{ name: "empty", completions: [] }],
            closedSet: false,
            directionSensitive: false,
            afterWildcard: "none",
        };
        const dispatcher = makeDispatcher(result);
        const session = new PartialCompletionSession(menu, dispatcher);

        session.update("play", getPos);
        await Promise.resolve();

        // Only the initial setChoices([]) call (cancel) should have been made
        expect(menu.setChoices).toHaveBeenCalledTimes(1);
        expect(menu.setChoices).toHaveBeenCalledWith([]);
    });

    test("emojiChar from group is propagated to each SearchMenuItem", async () => {
        const menu = makeMenu();
        const group: CompletionGroup = {
            name: "agents",
            completions: ["player", "calendar"],
            emojiChar: "\uD83C\uDFB5",
            sorted: true,
            separatorMode: "none",
        };
        const result: CommandCompletionResult = {
            startIndex: 0,
            completions: [group],
            closedSet: false,
            directionSensitive: false,
            afterWildcard: "none",
        };
        const dispatcher = makeDispatcher(result);
        const session = new PartialCompletionSession(menu, dispatcher);

        session.update("", getPos);
        await Promise.resolve();

        expect(menu.setChoices).toHaveBeenCalledWith(
            expect.arrayContaining([
                expect.objectContaining({
                    selectedText: "player",
                    emojiChar: "\uD83C\uDFB5",
                }),
                expect.objectContaining({
                    selectedText: "calendar",
                    emojiChar: "\uD83C\uDFB5",
                }),
            ]),
        );
    });

    test("emojiChar absent from group means no emojiChar on items", async () => {
        const menu = makeMenu();
        const group: CompletionGroup = {
            name: "plain",
            completions: ["alpha"],
            sorted: true,
            separatorMode: "none",
        };
        const result: CommandCompletionResult = {
            startIndex: 0,
            completions: [group],
            closedSet: false,
            directionSensitive: false,
            afterWildcard: "none",
        };
        const dispatcher = makeDispatcher(result);
        const session = new PartialCompletionSession(menu, dispatcher);

        session.update("", getPos);
        await Promise.resolve();

        const calls = menu.setChoices.mock.calls;
        const items = calls[calls.length - 1][0] as Record<string, unknown>[];
        expect(items[0].emojiChar).toBeUndefined();
    });

    test("sorted group preserves order while unsorted group is alphabetized", async () => {
        const menu = makeMenu();
        const sortedGroup: CompletionGroup = {
            name: "grammar",
            completions: ["zebra", "apple"],
            sorted: true,
            separatorMode: "none",
        };
        const unsortedGroup: CompletionGroup = {
            name: "entities",
            completions: ["cherry", "banana"],
            sorted: false,
            separatorMode: "none",
        };
        const result: CommandCompletionResult = {
            startIndex: 0,
            completions: [sortedGroup, unsortedGroup],
            closedSet: false,
            directionSensitive: false,
            afterWildcard: "none",
        };
        const dispatcher = makeDispatcher(result);
        const session = new PartialCompletionSession(menu, dispatcher);

        session.update("x", getPos);
        await Promise.resolve();

        const calls = menu.setChoices.mock.calls;
        const items = calls[calls.length - 1][0] as {
            selectedText: string;
            sortIndex: number;
        }[];
        const texts = items.map((i) => i.selectedText);

        // Sorted group: order preserved (zebra before apple)
        // Unsorted group: alphabetized (banana before cherry)
        // Cross-group: sorted group first
        expect(texts).toEqual(["zebra", "apple", "banana", "cherry"]);

        // sortIndex is sequential across both groups
        expect(items.map((i) => i.sortIndex)).toEqual([0, 1, 2, 3]);
    });

    test("negative startIndex falls back to full input as anchor", async () => {
        const menu = makeMenu();
        const result = makeCompletionResult(["song"], -1, {
            separatorMode: "none",
        });
        const dispatcher = makeDispatcher(result);
        const session = new PartialCompletionSession(menu, dispatcher);

        session.update("play", getPos);
        await Promise.resolve();

        // Anchor is "play" (full input).  rawPrefix="" → updatePrefix("", ...)
        expect(menu.updatePrefix).toHaveBeenCalledWith("", anyPosition);
    });

    test("startIndex=0 sets empty anchor", async () => {
        const menu = makeMenu();
        const result = makeCompletionResult(["play"], 0, {
            separatorMode: "none",
        });
        const dispatcher = makeDispatcher(result);
        const session = new PartialCompletionSession(menu, dispatcher);

        session.update("play", getPos);
        await Promise.resolve();

        // Anchor is "" (empty).  rawPrefix="play" → updatePrefix("play", ...)
        expect(menu.updatePrefix).toHaveBeenCalledWith("play", anyPosition);
    });

    test("startIndex beyond input length falls back to full input as anchor", async () => {
        const menu = makeMenu();
        // startIndex=99 is beyond "play" (length 4) — anchor falls back to "play"
        const result = makeCompletionResult(["song"], 99, {
            separatorMode: "none",
        });
        const dispatcher = makeDispatcher(result);
        const session = new PartialCompletionSession(menu, dispatcher);

        session.update("play", getPos);
        await Promise.resolve();

        // Anchor is "play" (full input).  reuseSession is called with the captured
        // input "play", so rawPrefix="" and updatePrefix is called with "".
        expect(menu.updatePrefix).toHaveBeenCalledWith("", anyPosition);
    });
});

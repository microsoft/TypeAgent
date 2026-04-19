// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import {
    CommandCompletionResult,
    CompletionGroup,
    makeSession,
    makeDispatcher,
    makeCompletionResult,
    loadedItems,
} from "./helpers.js";

describe("PartialCompletionSession — result processing", () => {
    test("startIndex narrows the anchor (current) to input[0..startIndex]", async () => {
        // startIndex=4 means grammar consumed "play" (4 chars); the
        // trailing space is the separator between anchor and completions.
        const result = makeCompletionResult(["song", "shuffle"], 4);
        const dispatcher = makeDispatcher(result);
        const { session } = makeSession(dispatcher);

        session.update("play s");
        await Promise.resolve();

        // prefix should be "s" (the text after anchor "play" + separator " ")
        expect(session.getCompletionState()?.prefix).toBe("s");
    });

    test("group order preserved: items appear in backend-provided group order", async () => {
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
        const { session } = makeSession(dispatcher);

        session.update("play ");
        await Promise.resolve();

        const items = session.getCompletionState()!.items as {
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
        const { session } = makeSession(dispatcher);

        session.update("play ");
        await Promise.resolve();

        expect(session.getCompletionState()!.items).toEqual(
            expect.arrayContaining([
                expect.objectContaining({
                    selectedText: "Bohemian Rhapsody",
                    needQuotes: true,
                }),
            ]),
        );
    });

    test("unsorted group items are sorted alphabetically", async () => {
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
        const { session } = makeSession(dispatcher);

        session.update("x");
        await Promise.resolve();

        expect(loadedItems(session)).toEqual(["apple", "mango", "zebra"]);
    });

    test("empty completions list does not load items into the trie", async () => {
        const result: CommandCompletionResult = {
            startIndex: 0,
            completions: [{ name: "empty", completions: [] }],
            closedSet: false,
            directionSensitive: false,
            afterWildcard: "none",
        };
        const dispatcher = makeDispatcher(result);
        const { session } = makeSession(dispatcher);

        session.update("play");
        await Promise.resolve();

        // The key assertion: no completions should be populated.
        expect(session.getCompletionState()).toBeUndefined();
    });

    test("emojiChar from group is propagated to each SearchMenuItem", async () => {
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
        const { session } = makeSession(dispatcher);

        session.update("");
        await Promise.resolve();

        expect(session.getCompletionState()!.items).toEqual(
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
        const { session } = makeSession(dispatcher);

        session.update("");
        await Promise.resolve();

        const items = session.getCompletionState()!.items as Record<
            string,
            unknown
        >[];
        expect(items[0].emojiChar).toBeUndefined();
    });

    test("sorted group preserves order while unsorted group is alphabetized", async () => {
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
        const { session } = makeSession(dispatcher);

        session.update("x");
        await Promise.resolve();

        // Sorted group: order preserved (zebra before apple)
        // Unsorted group: alphabetized (banana before cherry)
        // Cross-group: sorted group first
        expect(loadedItems(session)).toEqual([
            "zebra",
            "apple",
            "banana",
            "cherry",
        ]);
    });

    test("negative startIndex falls back to full input as anchor", async () => {
        const result = makeCompletionResult(["song"], -1, {
            separatorMode: "none",
        });
        const dispatcher = makeDispatcher(result);
        const { session } = makeSession(dispatcher);

        session.update("play");
        await Promise.resolve();

        // Anchor is "play" (full input).  rawPrefix="" → prefix is ""
        expect(session.getCompletionState()?.prefix).toBe("");
    });

    test("startIndex=0 sets empty anchor", async () => {
        const result = makeCompletionResult(["play", "pause"], 0, {
            separatorMode: "none",
        });
        const dispatcher = makeDispatcher(result);
        const { session } = makeSession(dispatcher);

        session.update("p");
        await Promise.resolve();

        // Anchor is "" (empty).  rawPrefix="p" → prefix is "p"
        expect(session.getCompletionState()?.prefix).toBe("p");
    });

    test("startIndex beyond input length falls back to full input as anchor", async () => {
        // startIndex=99 is beyond "play" (length 4) — anchor falls back to "play"
        const result = makeCompletionResult(["song"], 99, {
            separatorMode: "none",
        });
        const dispatcher = makeDispatcher(result);
        const { session } = makeSession(dispatcher);

        session.update("play");
        await Promise.resolve();

        // Anchor is "play" (full input).  reuseSession is called with the captured
        // input "play", so rawPrefix="" and prefix is "".
        expect(session.getCompletionState()?.prefix).toBe("");
    });
});

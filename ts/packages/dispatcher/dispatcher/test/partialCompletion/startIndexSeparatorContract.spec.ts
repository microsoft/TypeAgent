// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

//
// startIndex / separatorMode contract
//
// The PartialCompletionSession relies on a contract between the backend's
// `startIndex` and `separatorMode` fields:
//
//   anchor = input[0..startIndex]
//   rawPrefix = input[startIndex..]
//
// When `separatorMode` is "space" or "spacePunctuation", the session
// requires `rawPrefix` to start with a separator character.  This means:
//
//   (A) startIndex BEFORE the separator (e.g. "play"|" J")
//       → rawPrefix = " J", separator ✓, trie filters on "J"
//       → separatorMode = "space" or "spacePunctuation"
//
//   (B) startIndex AFTER the separator (e.g. "play "|"J")
//       → rawPrefix = "J", no leading separator
//       → separatorMode = "none" or "optionalSpace" (no separator needed)
//       → trie filters on "J" directly
//
//   (C) startIndex AFTER the separator + separatorMode still requires one
//       (e.g. "play "|" J" with separatorMode = "spacePunctuation")
//       → grammar requires a SECOND separator (e.g. double space)
//       → "play  J" works; "play J" triggers A3 re-fetches
//
// The session trusts whatever the agent/grammar returns.
//
// ## Grammar context
//
// The simple grammar matcher uses (A): matchedPrefixLength stops at the
// word boundary, and separatorMode is "spacePunctuation" for Latin text.
//
// A [spacing=none] grammar uses (B): matchedPrefixLength includes all
// consumed characters (no implicit separators), and separatorMode is
// "none".
//

import {
    makeSession,
    makeCompletionResult,
    type MockDispatcher,
    type CommandCompletionResult,
} from "./helpers.js";
import { jest } from "@jest/globals";
import type { ICompletionDispatcher } from "./helpers.js";

// ── Helpers ──────────────────────────────────────────────────────────────────

// Creates a dispatcher whose getCommandCompletion sequentially returns
// the given results (one per call).
function makeSequentialDispatcher(
    ...results: CommandCompletionResult[]
): MockDispatcher {
    const fn = jest.fn<ICompletionDispatcher["getCommandCompletion"]>();
    for (const r of results) {
        fn.mockResolvedValueOnce(r);
    }
    // After exhausting the sequence, return an empty closed result
    fn.mockResolvedValue({
        startIndex: 0,
        completions: [],
        closedSet: true,
        directionSensitive: false,
        afterWildcard: "none",
    });
    return { getCommandCompletion: fn };
}

// ── Pattern A: startIndex before separator, separatorMode requires one ───────

describe("Pattern A — startIndex before separator (separatorMode=spacePunctuation)", () => {
    // Grammar matched "play" (4 chars), standard Latin spacing.
    //   anchor:        "play"
    //   separatorMode: "spacePunctuation"
    //
    // The space between "play" and the entity value is part of rawPrefix,
    // so the session's separator check sees it and passes.

    const result = makeCompletionResult(["Rock", "Jazz", "Blues"], 4, {
        separatorMode: "spacePunctuation",
        closedSet: false,
    });

    test("space after anchor satisfies separator — shows all completions", async () => {
        const dispatcher = makeSequentialDispatcher(result);
        const { session } = makeSession(dispatcher);

        session.update("play");
        await Promise.resolve();

        session.update("play ");

        expect(session.getCompletionState()?.prefix).toBe("");
        expect(dispatcher.getCommandCompletion).toHaveBeenCalledTimes(1);
    });

    test("space then letter — trie filters without re-fetch", async () => {
        const dispatcher = makeSequentialDispatcher(result);
        const { session } = makeSession(dispatcher);

        session.update("play");
        await Promise.resolve();

        session.update("play J");

        expect(session.getCompletionState()?.prefix).toBe("J");
        expect(dispatcher.getCommandCompletion).toHaveBeenCalledTimes(1);
    });

    test("sequential typing — all trie-filtered, single fetch", async () => {
        const dispatcher = makeSequentialDispatcher(result);
        const { session } = makeSession(dispatcher);

        session.update("play");
        await Promise.resolve();

        session.update("play ");
        session.update("play J");
        session.update("play Ja");
        session.update("play Jaz");

        expect(dispatcher.getCommandCompletion).toHaveBeenCalledTimes(1);
        expect(session.getCompletionState()?.prefix).toBe("Jaz");
    });

    test("no separator yet — HIDE+KEEP, no re-fetch", async () => {
        const dispatcher = makeSequentialDispatcher(result);
        const { session } = makeSession(dispatcher);

        session.update("play");
        await Promise.resolve();

        session.update("play J"); // menu shows

        session.update("play"); // back to anchor, no sep

        expect(session.getCompletionState()).toBeUndefined();
        expect(dispatcher.getCommandCompletion).toHaveBeenCalledTimes(1);
    });

    test("non-separator immediately after anchor — A3 re-fetch", async () => {
        const dispatcher = makeSequentialDispatcher(result, result);
        const { session } = makeSession(dispatcher);

        session.update("play");
        await Promise.resolve();

        // "x" is not a separator → A3
        session.update("playx");

        expect(dispatcher.getCommandCompletion).toHaveBeenCalledTimes(2);
    });
});

// ── Pattern B: startIndex after separator, separatorMode="none" ──────────────

describe("Pattern B — startIndex past separator (separatorMode=none)", () => {
    // Simulates a [spacing=none] grammar where whitespace is part of the
    // matched content.  The grammar consumed "play " (5 chars including
    // the space) and reports separatorMode="none" — no further separator
    // needed between anchor and completions.
    //
    //   anchor:        "play " (5 chars)
    //   separatorMode: "none"

    const result = makeCompletionResult(["Rock", "Jazz", "Blues"], 5, {
        separatorMode: "none",
        closedSet: false,
    });

    test("letter after anchor goes straight to trie (no separator needed)", async () => {
        const dispatcher = makeSequentialDispatcher(result);
        const { session } = makeSession(dispatcher);

        session.update("play ");
        await Promise.resolve();

        // rawPrefix = "J", separatorMode="none" → needsSep=false → trie filters
        session.update("play J");

        expect(session.getCompletionState()?.prefix).toBe("J");
        expect(dispatcher.getCommandCompletion).toHaveBeenCalledTimes(1);
    });

    test("sequential typing — all trie-filtered, single fetch", async () => {
        const dispatcher = makeSequentialDispatcher(result);
        const { session } = makeSession(dispatcher);

        session.update("play ");
        await Promise.resolve();

        session.update("play J");
        session.update("play Ja");
        session.update("play Jaz");

        expect(dispatcher.getCommandCompletion).toHaveBeenCalledTimes(1);
        expect(session.getCompletionState()?.prefix).toBe("Jaz");
    });

    test("empty rawPrefix — trie shows all completions", async () => {
        const dispatcher = makeSequentialDispatcher(result);
        const { session } = makeSession(dispatcher);

        session.update("play ");
        await Promise.resolve();

        // rawPrefix = "" → prefix is "" → all items
        expect(session.getCompletionState()?.prefix).toBe("");
        expect(dispatcher.getCommandCompletion).toHaveBeenCalledTimes(1);
    });
});

// ── Pattern B variant: separatorMode="optionalSpace" ──────────────────────────────

describe("Pattern B variant — startIndex past separator (separatorMode=optional)", () => {
    // Same as Pattern B but with separatorMode="optionalSpace" — also does not
    // require a separator.  This covers CJK/mixed script grammars where
    // the grammar consumed through the space but tokens can abut.

    const result = makeCompletionResult(["Rock", "Jazz", "Blues"], 5, {
        separatorMode: "optionalSpace",
        closedSet: false,
    });

    test("letter after anchor filters via trie (no separator needed)", async () => {
        const dispatcher = makeSequentialDispatcher(result);
        const { session } = makeSession(dispatcher);

        session.update("play ");
        await Promise.resolve();

        session.update("play J");

        expect(session.getCompletionState()?.prefix).toBe("J");
        expect(dispatcher.getCommandCompletion).toHaveBeenCalledTimes(1);
    });
});

// ── Double separator: startIndex past first space, separator requires another ─

describe("Double separator — startIndex past separator + separatorMode requiring another", () => {
    // The grammar consumed "play " (including the first space) and still
    // reports separatorMode="spacePunctuation".  This means the grammar
    // requires a SECOND separator before completions.
    //
    //   anchor:        "play " (5 chars)
    //   separatorMode: "spacePunctuation"
    //
    // This is a valid (if unusual) grammar requirement, not a contract
    // violation.  "play  J" (double space) satisfies the separator check.
    //
    // When the user types only a single space plus a letter ("play J"),
    // the non-separator "J" triggers A3 re-fetches — the same re-fetch
    // storm pattern as the open-set C6 case (Issue 3).

    const doubleSepResult = makeCompletionResult(["Rock", "Jazz", "Blues"], 5, {
        separatorMode: "spacePunctuation",
        closedSet: false,
    });

    test("double space satisfies the separator — trie filters correctly", async () => {
        const dispatcher = makeSequentialDispatcher(doubleSepResult);
        const { session } = makeSession(dispatcher);

        session.update("play ");
        await Promise.resolve();

        // "play  J" — double space: rawPrefix = " J", separator ✓
        session.update("play  J");

        expect(session.getCompletionState()?.prefix).toBe("J");
        expect(dispatcher.getCommandCompletion).toHaveBeenCalledTimes(1);
    });

    test("single space + letter triggers A3 re-fetch (separator unsatisfied)", async () => {
        const dispatcher = makeSequentialDispatcher(
            doubleSepResult,
            doubleSepResult,
        );
        const { session } = makeSession(dispatcher);

        session.update("play ");
        await Promise.resolve();

        // "play J" — single space already in anchor, "J" not a separator → A3
        session.update("play J");

        expect(dispatcher.getCommandCompletion).toHaveBeenCalledTimes(2);
    });

    test("repeated A3 re-fetch on each keystroke (same storm as open-set C6)", async () => {
        const dispatcher = makeSequentialDispatcher(
            doubleSepResult,
            doubleSepResult,
            doubleSepResult,
            doubleSepResult,
        );
        const { session } = makeSession(dispatcher);

        session.update("play ");
        await Promise.resolve();

        session.update("play J");
        await Promise.resolve();

        session.update("play Ja");
        await Promise.resolve();

        session.update("play Jaz");
        await Promise.resolve();

        // Each keystroke = 1 A3 re-fetch (same pattern as C6 storm)
        expect(dispatcher.getCommandCompletion).toHaveBeenCalledTimes(4);
    });
});

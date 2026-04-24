// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import {
    makeSession,
    makeDispatcher,
    makeCompletionResult,
    makeMultiGroupResult,
    loadedItems,
    isActive,
} from "./helpers.js";

// ── separatorMode: "space" ────────────────────────────────────────────────────

describe("PartialCompletionSession — separatorMode: space", () => {
    test("defers menu display until trailing space is present", async () => {
        const result = makeCompletionResult(["music"], 4, {
            separatorMode: "space",
        });
        const dispatcher = makeDispatcher(result);
        const { session } = makeSession(dispatcher);

        // Input without trailing space: "play" — no visible items (need space)
        session.update("play");
        await Promise.resolve();

        // Items pre-loaded at L1 (lowestLevelWithItems) but hidden
        // until separator is consumed.
        expect(loadedItems(session)).toEqual(expect.arrayContaining(["music"]));
        expect(isActive(session)).toBe(false);
        // updatePrefix is NOT called (menu not shown)
        expect(session.getCompletionState()).toBeUndefined();
    });

    test("typing separator shows menu without re-fetch", async () => {
        const result = makeCompletionResult(["music"], 4, {
            separatorMode: "space",
        });
        const dispatcher = makeDispatcher(result);
        const { session } = makeSession(dispatcher);

        // First update: "play" — deferred (separatorMode, no trailing space)
        session.update("play");
        await Promise.resolve();

        // Second update: "play " — separator typed, menu should appear
        session.update("play ");

        expect(session.getCompletionState()?.prefix).toBe("");
        // No re-fetch — same dispatcher call count
        expect(dispatcher.getCommandCompletion).toHaveBeenCalledTimes(1);
    });

    test("menu shown after trailing space is typed", async () => {
        const result = makeCompletionResult(["music"], 4);
        const dispatcher = makeDispatcher(result);
        const { session } = makeSession(dispatcher);

        session.update("play ");
        await Promise.resolve();

        expect(session.getCompletionState()!.items).toEqual(
            expect.arrayContaining([
                expect.objectContaining({ selectedText: "music" }),
            ]),
        );
    });
});

// ── separatorMode: "spacePunctuation" ─────────────────────────────────────────

describe("PartialCompletionSession — separatorMode: spacePunctuation", () => {
    test("space satisfies spacePunctuation separator", async () => {
        const result = makeCompletionResult(["music"], 4, {
            separatorMode: "spacePunctuation",
        });
        const dispatcher = makeDispatcher(result);
        const { session } = makeSession(dispatcher);

        session.update("play");
        await Promise.resolve();

        // Space satisfies spacePunctuation
        session.update("play ");

        expect(session.getCompletionState()?.prefix).toBe("");
        expect(dispatcher.getCommandCompletion).toHaveBeenCalledTimes(1);
    });

    test("punctuation satisfies spacePunctuation separator", async () => {
        const result = makeCompletionResult(["music"], 4, {
            separatorMode: "spacePunctuation",
        });
        const dispatcher = makeDispatcher(result);
        const { session } = makeSession(dispatcher);

        session.update("play");
        await Promise.resolve();

        // Punctuation mark satisfies spacePunctuation.
        // The leading punctuation separator is stripped, just like whitespace.
        session.update("play.mu");

        expect(session.getCompletionState()?.prefix).toBe("mu");
        expect(dispatcher.getCommandCompletion).toHaveBeenCalledTimes(1);
    });

    test("letter after anchor triggers re-fetch under spacePunctuation", async () => {
        const result = makeCompletionResult(["music"], 4, {
            separatorMode: "spacePunctuation",
        });
        const dispatcher = makeDispatcher(result);
        const { session } = makeSession(dispatcher);

        session.update("play");
        await Promise.resolve();

        // A letter is neither space nor punctuation — triggers re-fetch (A3)
        session.update("playx");

        expect(dispatcher.getCommandCompletion).toHaveBeenCalledTimes(2);
        expect(dispatcher.getCommandCompletion).toHaveBeenLastCalledWith(
            "playx",
            "forward",
        );
    });

    test("no separator yet hides menu under spacePunctuation", async () => {
        const result = makeCompletionResult(["music"], 4, {
            separatorMode: "spacePunctuation",
        });
        const dispatcher = makeDispatcher(result);
        const { session } = makeSession(dispatcher);

        session.update("play");
        await Promise.resolve();

        // Exact anchor, no separator — menu hidden but session kept
        session.update("play");

        expect(isActive(session)).toBe(false);
        expect(dispatcher.getCommandCompletion).toHaveBeenCalledTimes(1);
    });
});

// ── separatorMode: "optionalSpace" ─────────────────────────────────────────────────

describe("PartialCompletionSession — separatorMode: optional", () => {
    test("completions shown immediately without separator", async () => {
        const result = makeCompletionResult(["music"], 4, {
            separatorMode: "optionalSpace",
        });
        const dispatcher = makeDispatcher(result);
        const { session } = makeSession(dispatcher);

        session.update("play");
        await Promise.resolve();

        // "optionalSpace" does not require a separator — menu shown immediately
        // rawPrefix="" → updatePrefix("", ...)
        expect(session.getCompletionState()?.prefix).toBe("");
    });

    test("typing after anchor filters within session", async () => {
        const result = makeCompletionResult(["music", "movie"], 4, {
            separatorMode: "optionalSpace",
        });
        const dispatcher = makeDispatcher(result);
        const { session } = makeSession(dispatcher);

        session.update("play");
        await Promise.resolve();

        session.update("playmu");

        expect(session.getCompletionState()?.prefix).toBe("mu");
        expect(dispatcher.getCommandCompletion).toHaveBeenCalledTimes(1);
    });

    test("whitespace stripped but punctuation kept in prefix", async () => {
        const result = makeCompletionResult([".music"], 4, {
            separatorMode: "optionalSpace",
        });
        const dispatcher = makeDispatcher(result);
        const { session } = makeSession(dispatcher);

        session.update("play");
        await Promise.resolve();

        // "optionalSpace" only strips whitespace — punctuation is preserved
        session.update("play .mu");

        expect(session.getCompletionState()?.prefix).toBe(".mu");
    });
});

// ── separatorMode: "optionalSpacePunctuation" ─────────────────────────────────

describe("PartialCompletionSession — separatorMode: optionalSpacePunctuation", () => {
    test("completions shown immediately without separator (like optional)", async () => {
        const result = makeCompletionResult(["music"], 4, {
            separatorMode: "optionalSpacePunctuation",
        });
        const dispatcher = makeDispatcher(result);
        const { session } = makeSession(dispatcher);

        session.update("play");
        await Promise.resolve();

        // Like "optionalSpace": no separator required — menu shown at anchor
        expect(session.getCompletionState()?.prefix).toBe("");
    });

    test("typing after anchor filters within session", async () => {
        const result = makeCompletionResult(["music", "movie"], 4, {
            separatorMode: "optionalSpacePunctuation",
        });
        const dispatcher = makeDispatcher(result);
        const { session } = makeSession(dispatcher);

        session.update("play");
        await Promise.resolve();

        session.update("playmu");

        expect(session.getCompletionState()?.prefix).toBe("mu");
        expect(dispatcher.getCommandCompletion).toHaveBeenCalledTimes(1);
    });

    test("space stripped from prefix (like spacePunctuation)", async () => {
        const result = makeCompletionResult(["music"], 4, {
            separatorMode: "optionalSpacePunctuation",
        });
        const dispatcher = makeDispatcher(result);
        const { session } = makeSession(dispatcher);

        session.update("play");
        await Promise.resolve();

        session.update("play mu");

        expect(session.getCompletionState()?.prefix).toBe("mu");
    });

    test("punctuation stripped from prefix (unlike optional)", async () => {
        const result = makeCompletionResult(["music"], 4, {
            separatorMode: "optionalSpacePunctuation",
        });
        const dispatcher = makeDispatcher(result);
        const { session } = makeSession(dispatcher);

        session.update("play");
        await Promise.resolve();

        // Key difference from "optionalSpace": punctuation IS stripped
        session.update("play.mu");

        expect(session.getCompletionState()?.prefix).toBe("mu");
    });

    test("mixed space+punctuation stripped from prefix", async () => {
        const result = makeCompletionResult(["music"], 4, {
            separatorMode: "optionalSpacePunctuation",
        });
        const dispatcher = makeDispatcher(result);
        const { session } = makeSession(dispatcher);

        session.update("play");
        await Promise.resolve();

        // Multiple leading separators (space + punctuation) all stripped
        session.update("play .mu");

        expect(session.getCompletionState()?.prefix).toBe("mu");
    });

    test("no re-fetch when typing past anchor matches trie (separator not required)", async () => {
        const result = makeCompletionResult(["music"], 4, {
            separatorMode: "optionalSpacePunctuation",
        });
        const dispatcher = makeDispatcher(result);
        const { session } = makeSession(dispatcher);

        session.update("play");
        await Promise.resolve();

        // Unlike "spacePunctuation", typing a letter after the anchor does
        // NOT immediately invalidate the session — the separator is optional,
        // so "playm" filters the trie for "m" which matches "music".
        session.update("playm");

        expect(session.getCompletionState()?.prefix).toBe("m");
        expect(dispatcher.getCommandCompletion).toHaveBeenCalledTimes(1);
    });
});

// ── separatorMode + direction interactions ────────────────────────────────────

describe("PartialCompletionSession — separatorMode + direction", () => {
    test("spacePunctuation with backward direction: punctuation separator commits", async () => {
        const result = makeCompletionResult(["music", "movie"], 4, {
            separatorMode: "spacePunctuation",
            directionSensitive: true,
        });
        const dispatcher = makeDispatcher(result);
        const { session } = makeSession(dispatcher);

        session.update("play", "forward");
        await Promise.resolve(); // → ACTIVE, anchor = "play", deferred

        // Type punctuation separator: menu should appear with the completions
        session.update("play.", "backward");

        // Separator satisfies spacePunctuation — menu should show
        expect(session.getCompletionState()?.prefix).toBeDefined();
        // No re-fetch (separator typed after anchor, within same session)
        expect(dispatcher.getCommandCompletion).toHaveBeenCalledTimes(1);
    });

    test("spacePunctuation with backward direction re-fetches when directionSensitive at anchor", async () => {
        // startIndex=4 = anchor length, so anchor = "play", input = "play"
        // directionSensitive=true at exact anchor → A7 applies
        const result = makeCompletionResult(["song", "track"], 4, {
            separatorMode: "spacePunctuation",
            directionSensitive: true,
        });
        const dispatcher = makeDispatcher(result);
        const { session } = makeSession(dispatcher);

        session.update("play", "forward");
        await Promise.resolve(); // → ACTIVE, anchor = "play"

        // Same input, backward direction, at exact anchor + sensitive → A7
        session.update("play", "backward");

        expect(dispatcher.getCommandCompletion).toHaveBeenCalledTimes(2);
        expect(dispatcher.getCommandCompletion).toHaveBeenLastCalledWith(
            "play",
            "backward",
        );
    });
});

// ── separatorMode edge cases ─────────────────────────────────────────────────

describe("PartialCompletionSession — separatorMode edge cases", () => {
    test("re-update with same input before separator does not re-fetch", async () => {
        // Regression: selectionchange can fire again with the same input while
        // the session is waiting for a separator.  Must not trigger a re-fetch.
        const result = makeCompletionResult(["music"], 4, {
            separatorMode: "space",
        });
        const dispatcher = makeDispatcher(result);
        const { session } = makeSession(dispatcher);

        session.update("play");
        await Promise.resolve(); // deferred — waiting for separator

        session.update("play"); // same input again (e.g. selectionchange)

        expect(dispatcher.getCommandCompletion).toHaveBeenCalledTimes(1);
    });

    test("input diverges before separator arrives triggers re-fetch", async () => {
        const result = makeCompletionResult(["music"], 4, {
            separatorMode: "space",
        });
        const dispatcher = makeDispatcher(result);
        const { session } = makeSession(dispatcher);

        session.update("play");
        await Promise.resolve(); // deferred

        // User typed a non-space character instead of a separator
        session.update("play2");

        expect(dispatcher.getCommandCompletion).toHaveBeenCalledTimes(2);
        expect(dispatcher.getCommandCompletion).toHaveBeenLastCalledWith(
            "play2",
            "forward",
        );
    });

    test("separator already in input when result arrives shows menu immediately", async () => {
        // User typed "play " fast enough that the promise resolves after the space.
        const result = makeCompletionResult(["music"], 4, {
            separatorMode: "space",
        });
        const dispatcher = makeDispatcher(result);
        const { session } = makeSession(dispatcher);

        // Fetch was issued for "play" but by the time it resolves the user
        // has already moved on; a second update for "play " is already active.
        // Simulate by updating to "play " *before* awaiting.
        session.update("play");
        // (promise not yet resolved — we rely on the .then() calling reuseSession
        //  with the captured "play" input, which has no separator, so menu stays
        //  hidden.  A subsequent update("play ", ...) then shows it.)
        await Promise.resolve();

        session.update("play ");

        expect(session.getCompletionState()?.prefix).toBe("");
        expect(dispatcher.getCommandCompletion).toHaveBeenCalledTimes(1);
    });
});

// ── SepLevel: consume / narrow / skip-ahead ───────────────────────────────

describe("PartialCompletionSession — SepLevel transitions", () => {
    // Two groups at different levels:
    //   level 0: "optionalSpace" group  →  ["alpha"]
    //   level 1: "space" group          →  ["beta"]
    // (Both visible at level 1, only optionalSpace at level 0.)
    function makeTwoLevelResult() {
        return makeMultiGroupResult(
            [
                { completions: ["alpha"], separatorMode: "optionalSpace" },
                { completions: ["beta"], separatorMode: "space" },
            ],
            4, // anchor = "play"
        );
    }

    test("D1 CONSUME: space group exhausted, punctuation advances to level 2", async () => {
        // Level 1 has both (space and spacePunctuation visible at lv1).
        // Level 2 has only "beta" (spacePunctuation).
        const result = makeMultiGroupResult(
            [
                { completions: ["alpha"], separatorMode: "space" },
                { completions: ["beta"], separatorMode: "spacePunctuation" },
            ],
            4,
        );
        const dispatcher = makeDispatcher(result);
        const { session } = makeSession(dispatcher);

        session.update("play");
        await Promise.resolve();

        // menuSepLevel = 1 via lowestLevelWithItems.
        // Deferred — separator not yet consumed, hidden.
        expect(isActive(session)).toBe(false);

        // Type space: D1 consumes separator, items already loaded at L1.
        session.update("play ");
        expect(isActive(session)).toBe(true);

        // No extra loadLevel — the existing trie at level 1
        // already had the right items loaded by startNewSession.
        // (startNewSession calls loadLevel once; the space update just
        // filters on the already-loaded trie.)

        // Type "play.": anchor "play", rawPrefix=".".
        // D1 consumes "." → charLevel=2 > menuSepLevel=1 → advance to L2.
        // Level 2: only "beta" (spacePunctuation). Trie reloaded.
        // rawPrefix after consumption = "". Matches "beta".
        session.update("play.");
        // Progressive consumption: may go through multiple levels.
        // The last loadLevel call should have the level-2 items.
        expect(session.getCompletionState()!.items).toEqual(
            expect.arrayContaining([
                expect.objectContaining({ matchText: "beta" }),
            ]),
        );
        expect(isActive(session)).toBe(true);
        expect(dispatcher.getCommandCompletion).toHaveBeenCalledTimes(1);
    });

    test("B1 NARROW: backspace from level 1 to level 0 reloads trie", async () => {
        const result = makeTwoLevelResult();
        const dispatcher = makeDispatcher(result);
        const { session } = makeSession(dispatcher);

        session.update("play");
        await Promise.resolve();

        // menuSepLevel=0, trie has "alpha" (optionalSpace at level 0).
        expect(isActive(session)).toBe(true);

        // Type space: D1 consumes " " → charLevel=1 > menuSepLevel=0
        // → advance to L1. Trie reloaded with "alpha" + "beta".
        session.update("play ");
        expect(isActive(session)).toBe(true);

        // Backspace to "play": rawPrefix="", sepLevel=0.
        // B1: sepLevel(0) < menuSepLevel(1) + items at level 0 → NARROW.
        // Trie reloaded with level-0 items ("alpha" only).
        session.update("play");
        // Exactly one loadLevel for the narrow reload.
        expect(session.getCompletionState()!.items).toEqual(
            expect.arrayContaining([
                expect.objectContaining({ matchText: "alpha" }),
            ]),
        );
        // Only "alpha" — "beta" (space mode) not visible at level 0.
        expect(session.getCompletionState()!.items).not.toEqual(
            expect.arrayContaining([
                expect.objectContaining({ matchText: "beta" }),
            ]),
        );
        expect(isActive(session)).toBe(true);
        expect(dispatcher.getCommandCompletion).toHaveBeenCalledTimes(1);
    });

    test("DEFERRED-SEP: skip-ahead hides menu until separator typed", async () => {
        // Only "space" mode items — nothing at level 0.
        const result = makeMultiGroupResult(
            [{ completions: ["music"], separatorMode: "space" }],
            4,
        );
        const dispatcher = makeDispatcher(result);
        const { session } = makeSession(dispatcher);

        session.update("play");
        await Promise.resolve();

        // lowestLevelWithItems → 1. menuSepLevel=1.
        // Deferred — separator not yet consumed, hidden.
        expect(isActive(session)).toBe(false);

        // Same input again — still deferred.
        session.update("play");
        expect(isActive(session)).toBe(false);
        expect(dispatcher.getCommandCompletion).toHaveBeenCalledTimes(1);

        // Type space — separator typed, sepLevel matches menuSepLevel.
        session.update("play ");
        expect(isActive(session)).toBe(true);
        expect(session.getCompletionState()?.prefix).toBe("");
        expect(dispatcher.getCommandCompletion).toHaveBeenCalledTimes(1);
    });

    test("no trie reload when sepLevel stays at same menuSepLevel", async () => {
        const result = makeTwoLevelResult();
        const dispatcher = makeDispatcher(result);
        const { session } = makeSession(dispatcher);

        session.update("play");
        await Promise.resolve();

        // menuSepLevel=0. Trie loaded once with level-0 items.
        // Type more characters that don't change sepLevel:
        session.update("playa");
        session.update("playalp");

        // loadLevel NOT called — trie stays loaded at level 0.
        expect(dispatcher.getCommandCompletion).toHaveBeenCalledTimes(1);
    });

    test("consume then narrow round-trip preserves correct items", async () => {
        const result = makeTwoLevelResult();
        const dispatcher = makeDispatcher(result);
        const { session } = makeSession(dispatcher);

        session.update("play");
        await Promise.resolve();

        // Level 0: "alpha". Level 1: "alpha"+"beta".
        expect(isActive(session)).toBe(true); // "alpha" at level 0

        // Consume: type space → level 1.
        session.update("play ");
        expect(isActive(session)).toBe(true);

        // Narrow: backspace → level 0.
        session.update("play");
        expect(isActive(session)).toBe(true);

        // Consume again: type space → level 1.
        session.update("play ");
        // Exactly one loadLevel for the consume reload.
        expect(session.getCompletionState()!.items).toEqual(
            expect.arrayContaining([
                expect.objectContaining({ matchText: "alpha" }),
                expect.objectContaining({ matchText: "beta" }),
            ]),
        );
        expect(isActive(session)).toBe(true);

        // All within one session — no re-fetch.
        expect(dispatcher.getCommandCompletion).toHaveBeenCalledTimes(1);
    });

    test("optionalSpacePunctuation visible at all three levels", async () => {
        const result = makeMultiGroupResult(
            [
                {
                    completions: ["gamma"],
                    separatorMode: "optionalSpacePunctuation",
                },
            ],
            4,
        );
        const dispatcher = makeDispatcher(result);
        const { session } = makeSession(dispatcher);

        session.update("play");
        await Promise.resolve();

        // Level 0: "gamma" visible (optionalSpacePunctuation at lv0).
        expect(isActive(session)).toBe(true);
        expect(session.getCompletionState()?.prefix).toBe("");

        // Level 1 (space): still visible. optionalSpacePunctuation is in
        // both level 0 and 1 — consumption advances and reloads trie
        // with level-1 items (same single item).
        session.update("play ");
        expect(isActive(session)).toBe(true);

        // Level 2 (punctuation): still visible. Consumption to L2.
        session.update("play.");
        expect(isActive(session)).toBe(true);
        expect(session.getCompletionState()?.prefix).toBe("");

        expect(dispatcher.getCommandCompletion).toHaveBeenCalledTimes(1);
    });

    test("spacePunctuation visible at levels 1 and 2 but not 0", async () => {
        const result = makeMultiGroupResult(
            [
                {
                    completions: ["delta"],
                    separatorMode: "spacePunctuation",
                },
            ],
            4,
        );
        const dispatcher = makeDispatcher(result);
        const { session } = makeSession(dispatcher);

        session.update("play");
        await Promise.resolve();

        // Items pre-loaded at L1 (lowestLevelWithItems) but hidden
        // until separator is consumed.
        expect(isActive(session)).toBe(false);

        // Level 1 (space): visible — separator consumed, items already loaded.
        session.update("play ");
        expect(isActive(session)).toBe(true);

        // Backspace → B1 narrows to L1 (lowestLevelWithItems), hidden
        // because consumed separator was reset.
        session.update("play");
        expect(isActive(session)).toBe(false);

        // Level 2 (punctuation): visible. Consumption to L2.
        session.update("play.");
        expect(isActive(session)).toBe(true);

        expect(dispatcher.getCommandCompletion).toHaveBeenCalledTimes(1);
    });

    test("none mode only visible at level 0", async () => {
        const result = makeMultiGroupResult(
            [{ completions: ["epsilon"], separatorMode: "none" }],
            4,
        );
        const dispatcher = makeDispatcher(result);
        const { session } = makeSession(dispatcher);

        session.update("play");
        await Promise.resolve();

        // Level 0: visible.
        expect(isActive(session)).toBe(true);
        expect(session.getCompletionState()?.prefix).toBe("");

        // Level 1 (space): "none" mode is NOT visible at level 1.
        // D1 consumes " " → charLevel=1 > menuSepLevel=0 → advance to L1.
        // Level 1: no items for "none" mode. Empty trie.
        // D4: accept (closedSet=true).
        // Consume loaded empty trie at level 1 — exactly 1 loadLevel.
        session.update("play ");
        expect(isActive(session)).toBe(false);

        expect(dispatcher.getCommandCompletion).toHaveBeenCalledTimes(1);
    });

    test("step-by-step backward: L0 → L1 → L2 then L2 → L1 → L0", async () => {
        // Three groups at distinct levels:
        //   "instant" (none)              → L0 only
        //   "word"    (space)             → L1 only
        //   "punct"   (spacePunctuation)  → L1 + L2
        const result = makeMultiGroupResult(
            [
                { completions: ["instant"], separatorMode: "none" },
                { completions: ["word"], separatorMode: "space" },
                { completions: ["punct"], separatorMode: "spacePunctuation" },
            ],
            4,
        );
        const dispatcher = makeDispatcher(result);
        const { session } = makeSession(dispatcher);

        // ── Forward: L0 → L1 → L2 ──
        session.update("play");
        await Promise.resolve();

        // L0: only "instant".
        const l0Items = loadedItems(session);
        expect(l0Items).toContain("instant");
        expect(l0Items).not.toContain("word");
        expect(l0Items).not.toContain("punct");
        expect(isActive(session)).toBe(true);

        // Type space → L1: "word" + "punct" (not "instant").
        session.update("play ");
        expect(isActive(session)).toBe(true);
        const l1Items = loadedItems(session);
        expect(l1Items).toContain("word");
        expect(l1Items).toContain("punct");
        expect(l1Items).not.toContain("instant");

        // Type punctuation → L2: only "punct" (not "word", not "instant").
        session.update("play .");
        expect(isActive(session)).toBe(true);
        const l2Items = loadedItems(session);
        expect(l2Items).toContain("punct");
        expect(l2Items).not.toContain("word");
        expect(l2Items).not.toContain("instant");

        // ── Backward: L2 → L1 (delete punctuation) ──
        session.update("play ");
        expect(isActive(session)).toBe(true);
        const backL1Items = loadedItems(session);
        expect(backL1Items).toContain("word");
        expect(backL1Items).toContain("punct");
        expect(backL1Items).not.toContain("instant");

        // ── Backward: L1 → L0 (delete space) ──
        session.update("play");
        expect(isActive(session)).toBe(true);
        const backL0Items = loadedItems(session);
        expect(backL0Items).toContain("instant");
        expect(backL0Items).not.toContain("word");
        expect(backL0Items).not.toContain("punct");

        // All within one session — no re-fetch.
        expect(dispatcher.getCommandCompletion).toHaveBeenCalledTimes(1);
    });

    test("backward with explicit-space item: L2 → L1 (not L0)", async () => {
        // " instant" (optionalSpacePunctuation) visible at all levels.
        // "word" (space) visible at L1 only.
        // "punct" (spacePunctuation) visible at L1 + L2.
        //
        // Forward: "play " → L0 trie matches " instant" (explicit-space priority).
        // But backward from L2 to "play " should land at L1 (space consumed as
        // separator), not L0 (where " instant" would reclaim the space).
        const result = makeMultiGroupResult(
            [
                {
                    completions: [" instant"],
                    separatorMode: "optionalSpacePunctuation",
                },
                { completions: ["word"], separatorMode: "space" },
                { completions: ["punct"], separatorMode: "spacePunctuation" },
            ],
            4,
        );
        const dispatcher = makeDispatcher(result);
        const { session } = makeSession(dispatcher);

        // ── Forward to L0 ──
        session.update("play");
        await Promise.resolve();

        // L0: " instant" visible.
        expect(isActive(session)).toBe(true);

        // Type space: L0 trie matches " instant" (explicit-space priority).
        session.update("play ");
        expect(isActive(session)).toBe(true);
        expect(session.getCompletionState()?.prefix).toBe(" ");

        // Type ".": " ." fails L0 trie → consume " "→L1 → "." fails → consume "."→L2.
        session.update("play .");
        expect(isActive(session)).toBe(true);

        // ── Backward: L2 → L1 ──
        // Delete "." → "play ". Remaining separator = " " → sepLevel=1 → L1.
        session.update("play ");
        expect(isActive(session)).toBe(true);
        const backL1Items = loadedItems(session);
        // L1 has all three items (" instant" + "word" + "punct").
        expect(backL1Items).toContain(" instant");
        expect(backL1Items).toContain("word");
        expect(backL1Items).toContain("punct");

        // ── Backward: L1 → L0 ──
        // Delete space → "play". No separator → sepLevel=0 → L0.
        session.update("play");
        expect(isActive(session)).toBe(true);
        const backL0Items = loadedItems(session);
        // L0 has only " instant" (optionalSpacePunctuation).
        expect(backL0Items).toContain(" instant");
        expect(backL0Items).not.toContain("word");
        expect(backL0Items).not.toContain("punct");

        expect(dispatcher.getCommandCompletion).toHaveBeenCalledTimes(1);
    });

    test("backward from L2 to L1 when separator text changes", async () => {
        // User replaces punctuation with different punctuation.
        // "play ." → "play ,": consumed sep no longer matches → B1 triggers.
        // Remaining separator = "," → sepLevel=2 → stays at L2.
        const result = makeMultiGroupResult(
            [{ completions: ["punct"], separatorMode: "spacePunctuation" }],
            4,
        );
        const dispatcher = makeDispatcher(result);
        const { session } = makeSession(dispatcher);

        session.update("play");
        await Promise.resolve();

        // Forward to L2 via punctuation.
        session.update("play.");
        expect(isActive(session)).toBe(true);

        // Replace "." with "," — consumed sep mismatch triggers B1.
        // Remaining rawPrefix = "," → sepLevel=2 → target L2. Same level,
        // but consumedSep updated to ",".
        session.update("play,");
        expect(isActive(session)).toBe(true);
        expect(session.getCompletionState()?.prefix).toBe("");

        // Replace "," with " " — sepLevel=1 → L1, "punct" still visible.
        session.update("play ");
        expect(isActive(session)).toBe(true);
        expect(session.getCompletionState()?.prefix).toBe("");

        expect(dispatcher.getCommandCompletion).toHaveBeenCalledTimes(1);
    });
});

// ── Gap 3: autoSpacePunctuation resolution in the shell ──────────────────

describe("PartialCompletionSession — autoSpacePunctuation", () => {
    test("Latin-Latin pair resolves to spacePunctuation (separator required)", async () => {
        // Input ends with "d" (Latin), completions start with Latin chars.
        // needsSeparatorInAutoMode('d', 'a') → true → spacePunctuation.
        const result = makeMultiGroupResult(
            [
                {
                    completions: ["alpha", "beta"],
                    separatorMode: "autoSpacePunctuation",
                },
            ],
            4, // startIndex after "word"
        );
        const dispatcher = makeDispatcher(result);
        const { session } = makeSession(dispatcher);

        // "word" — last char is 'd', completions start with 'a'/'b' (Latin).
        // Auto-resolved to spacePunctuation → needs separator.
        session.update("word");
        await Promise.resolve();

        // Level 0: spacePunctuation not visible → menu hidden.
        expect(isActive(session)).toBe(false);

        // Typing space: level 1, spacePunctuation visible.
        session.update("word ");
        expect(isActive(session)).toBe(true);
        expect(session.getCompletionState()?.prefix).toBe("");

        expect(dispatcher.getCommandCompletion).toHaveBeenCalledTimes(1);
    });

    test("Latin-CJK pair resolves to optionalSpacePunctuation (no separator needed)", async () => {
        // Input ends with "d" (Latin), completions start with CJK.
        // needsSeparatorInAutoMode('d', '東') → false → optionalSpacePunctuation.
        const result = makeMultiGroupResult(
            [
                {
                    completions: ["東京", "大阪"],
                    separatorMode: "autoSpacePunctuation",
                },
            ],
            4, // startIndex after "word"
        );
        const dispatcher = makeDispatcher(result);
        const { session } = makeSession(dispatcher);

        // "word" — last char is 'd', completions start with '東'/'大' (CJK).
        // Auto-resolved to optionalSpacePunctuation → no separator needed.
        session.update("word");
        await Promise.resolve();

        // Level 0: optionalSpacePunctuation IS visible → menu shown.
        expect(isActive(session)).toBe(true);

        expect(dispatcher.getCommandCompletion).toHaveBeenCalledTimes(1);
    });

    test("CJK-CJK pair resolves to optionalSpacePunctuation", async () => {
        // Input ends with CJK, completions start with CJK.
        // needsSeparatorInAutoMode('京', '東') → false (CJK is not word-boundary).
        const result = makeMultiGroupResult(
            [
                {
                    completions: ["タワー", "駅"],
                    separatorMode: "autoSpacePunctuation",
                },
            ],
            2, // startIndex after "東京"
        );
        const dispatcher = makeDispatcher(result);
        const { session } = makeSession(dispatcher);

        // "東京" — CJK-CJK → no separator needed.
        session.update("東京");
        await Promise.resolve();

        expect(isActive(session)).toBe(true);

        expect(dispatcher.getCommandCompletion).toHaveBeenCalledTimes(1);
    });

    test("digit-digit pair resolves to spacePunctuation (separator required)", async () => {
        const result = makeMultiGroupResult(
            [
                {
                    completions: ["100", "200"],
                    separatorMode: "autoSpacePunctuation",
                },
            ],
            3, // startIndex after "123"
        );
        const dispatcher = makeDispatcher(result);
        const { session } = makeSession(dispatcher);

        // "123" — digit-digit → separator required.
        session.update("123");
        await Promise.resolve();

        // Digit-digit pair → spacePunctuation → not visible at level 0.
        expect(isActive(session)).toBe(false);

        // Typing space shows menu.
        session.update("123 ");
        expect(isActive(session)).toBe(true);

        expect(dispatcher.getCommandCompletion).toHaveBeenCalledTimes(1);
    });

    test("mixed auto group splits items across partitions", async () => {
        // A single group with autoSpacePunctuation where some items
        // need a separator (Latin-Latin) and some don't (Latin-CJK).
        const result = makeMultiGroupResult(
            [
                {
                    completions: ["alpha", "東京"],
                    separatorMode: "autoSpacePunctuation",
                },
            ],
            4, // startIndex after "word"
        );
        const dispatcher = makeDispatcher(result);
        const { session } = makeSession(dispatcher);

        // "word" — last char 'd' (Latin).
        // "alpha" → needsSep('d','a') = true → spacePunctuation
        // "東京"  → needsSep('d','東') = false → optionalSpacePunctuation
        session.update("word");
        await Promise.resolve();

        // Level 0: only optionalSpacePunctuation items visible → "東京".
        expect(isActive(session)).toBe(true);
        // The trie should have the CJK item at level 0.
        const prefix0 = session.getCompletionState()?.prefix;
        expect(prefix0).toBe("");

        // Typing space → level 1: both spacePunctuation and optional visible.
        session.update("word ");
        expect(isActive(session)).toBe(true);
        // D1 consumes " " → advance to L1, both items loaded.

        expect(dispatcher.getCommandCompletion).toHaveBeenCalledTimes(1);
    });

    test("startIndex=0 uses empty string for character pair (no preceding char)", async () => {
        // When startIndex is 0 there is no preceding character.
        // needsSeparatorInAutoMode guard: startIndex > 0 is false
        // → all items resolve to optionalSpacePunctuation.
        const result = makeMultiGroupResult(
            [
                {
                    completions: ["hello", "world"],
                    separatorMode: "autoSpacePunctuation",
                },
            ],
            0, // start of input
        );
        const dispatcher = makeDispatcher(result);
        const { session } = makeSession(dispatcher);

        session.update("");
        await Promise.resolve();

        // All items → optionalSpacePunctuation → visible at level 0.
        expect(isActive(session)).toBe(true);

        expect(dispatcher.getCommandCompletion).toHaveBeenCalledTimes(1);
    });
});

// ── Gap 4: toPartitions bucketing (multiple groups with different modes) ──

describe("PartialCompletionSession — multi-group partitioning", () => {
    test("two groups with different modes show correct items per level", async () => {
        const result = makeMultiGroupResult(
            [
                { completions: ["cmd1", "cmd2"], separatorMode: "space" },
                {
                    completions: ["entity1"],
                    separatorMode: "optionalSpacePunctuation",
                },
            ],
            4,
        );
        const dispatcher = makeDispatcher(result);
        const { session } = makeSession(dispatcher);

        // "play" — level 0: only optionalSpacePunctuation visible.
        session.update("play");
        await Promise.resolve();

        expect(isActive(session)).toBe(true);
        // Level 0 should only have "entity1" (optionalSpacePunctuation).
        // "cmd1"/"cmd2" (space) need level 1.
        expect(session.getCompletionState()!.items).toEqual(
            expect.arrayContaining([
                expect.objectContaining({ selectedText: "entity1" }),
            ]),
        );
        const items = loadedItems(session);
        expect(items.every((i) => i !== "cmd1")).toBe(true);

        // "play " — level 1: both "space" and "optionalSpacePunctuation" visible.
        session.update("play ");
        expect(isActive(session)).toBe(true);
        // D1 consumes " " → new trie with all level-1 items.
        const level1Items = loadedItems(session);
        expect(level1Items).toContain("cmd1");
        expect(level1Items).toContain("cmd2");
        expect(level1Items).toContain("entity1");

        expect(dispatcher.getCommandCompletion).toHaveBeenCalledTimes(1);
    });

    test("space + spacePunctuation groups: space only at level 1, spacePunctuation at level 1 and 2", async () => {
        const result = makeMultiGroupResult(
            [
                { completions: ["flag"], separatorMode: "space" },
                { completions: ["entity"], separatorMode: "spacePunctuation" },
            ],
            4,
        );
        const dispatcher = makeDispatcher(result);
        const { session } = makeSession(dispatcher);

        // Level 0: neither visible.
        session.update("play");
        await Promise.resolve();
        expect(isActive(session)).toBe(false);

        // Level 1 (space): both visible after consumption.
        session.update("play ");
        expect(isActive(session)).toBe(true);
        const level1Items = loadedItems(session);
        expect(level1Items).toContain("flag");
        expect(level1Items).toContain("entity");

        // Level 2 (punctuation): only spacePunctuation.
        session.update("play.");
        expect(isActive(session)).toBe(true);
        const level2Items = loadedItems(session);
        expect(level2Items).toContain("entity");
        expect(level2Items.includes("flag")).toBe(false);

        expect(dispatcher.getCommandCompletion).toHaveBeenCalledTimes(1);
    });

    test("empty group produces no items", async () => {
        const result = makeMultiGroupResult(
            [
                { completions: [], separatorMode: "space" },
                { completions: ["only"], separatorMode: "optionalSpace" },
            ],
            4,
        );
        const dispatcher = makeDispatcher(result);
        const { session } = makeSession(dispatcher);

        session.update("play");
        await Promise.resolve();

        // Only "only" (optionalSpace) at level 0.
        expect(isActive(session)).toBe(true);
        const items = loadedItems(session);
        expect(items).toHaveLength(1);
        expect(items[0]).toBe("only");

        expect(dispatcher.getCommandCompletion).toHaveBeenCalledTimes(1);
    });

    test("three groups at all levels provide correct item sets", async () => {
        const result = makeMultiGroupResult(
            [
                { completions: ["instant"], separatorMode: "none" },
                { completions: ["word"], separatorMode: "space" },
                { completions: ["punct"], separatorMode: "spacePunctuation" },
            ],
            4,
        );
        const dispatcher = makeDispatcher(result);
        const { session } = makeSession(dispatcher);

        // Level 0: only "none" visible.
        session.update("play");
        await Promise.resolve();
        expect(isActive(session)).toBe(true);
        const level0Items = loadedItems(session);
        expect(level0Items).toContain("instant");
        expect(level0Items).not.toContain("word");
        expect(level0Items).not.toContain("punct");

        // Level 1: "space" + "spacePunctuation" visible, NOT "none".
        session.update("play ");
        expect(isActive(session)).toBe(true);
        const level1Items = loadedItems(session);
        expect(level1Items).toContain("word");
        expect(level1Items).toContain("punct");
        expect(level1Items).not.toContain("instant");

        // Level 2: only "spacePunctuation" visible.
        session.update("play.");
        expect(isActive(session)).toBe(true);
        const level2Items = loadedItems(session);
        expect(level2Items).toContain("punct");
        expect(level2Items).not.toContain("word");
        expect(level2Items).not.toContain("instant");

        expect(dispatcher.getCommandCompletion).toHaveBeenCalledTimes(1);
    });
});

// ── Explicit-space completions (progressive consumption priority) ─────

describe("PartialCompletionSession — explicit-space completions", () => {
    test("explicit-space item matched at L0 without consuming separator", async () => {
        // Completion starts with a literal space: " world" (optionalSpacePunctuation).
        // At L0, " world" is visible. Typing " " should match as trie prefix.
        const result = makeMultiGroupResult(
            [
                {
                    completions: [" world"],
                    separatorMode: "optionalSpacePunctuation",
                },
            ],
            5,
        );
        const dispatcher = makeDispatcher(result);
        const { session } = makeSession(dispatcher);

        session.update("hello");
        await Promise.resolve();

        // " world" is at L0 (optionalSpacePunctuation visible at all levels).
        expect(isActive(session)).toBe(true);

        // Type " " — rawPrefix " " matches " world" at L0, no consumption.
        session.update("hello ");
        expect(isActive(session)).toBe(true);
        expect(session.getCompletionState()?.prefix).toBe(" ");
        // No re-fetch.
        expect(dispatcher.getCommandCompletion).toHaveBeenCalledTimes(1);
    });

    test("explicit-space item narrowed by additional chars", async () => {
        const result = makeMultiGroupResult(
            [
                {
                    completions: [" world", " wonder"],
                    separatorMode: "optionalSpacePunctuation",
                },
            ],
            5,
        );
        const dispatcher = makeDispatcher(result);
        const { session } = makeSession(dispatcher);

        session.update("hello");
        await Promise.resolve();

        // Type " wo" — matches both " world" and " wonder".
        session.update("hello wo");
        expect(isActive(session)).toBe(true);
        expect(session.getCompletionState()?.prefix).toBe(" wo");

        // Type " wor" — narrows to " world" only.
        session.update("hello wor");
        expect(session.getCompletionState()?.prefix).toBe(" wor");
        expect(dispatcher.getCommandCompletion).toHaveBeenCalledTimes(1);
    });

    test("mixed: explicit-space + regular items — space shows L0 first", async () => {
        // " world" at L0 (optionalSpacePunctuation) + "music" at L1 (space).
        // Space should show " world" first; non-matching char cascades to "music".
        const result = makeMultiGroupResult(
            [
                {
                    completions: [" world"],
                    separatorMode: "optionalSpacePunctuation",
                },
                { completions: ["music"], separatorMode: "space" },
            ],
            5,
        );
        const dispatcher = makeDispatcher(result);
        const { session } = makeSession(dispatcher);

        session.update("hello");
        await Promise.resolve();

        // L0 shows " world" (optionalSpacePunctuation visible at L0).
        expect(isActive(session)).toBe(true);

        // Type " " — L0 trie matches " world".
        session.update("hello ");
        expect(isActive(session)).toBe(true);
        expect(session.getCompletionState()?.prefix).toBe(" ");

        // Type " m" — " m" doesn't match " world" at L0.
        // D1 consumes " " → L1 has "music" + " world".
        // rawPrefix "m" → trie matches "music".
        session.update("hello m");
        expect(isActive(session)).toBe(true);
        expect(session.getCompletionState()?.prefix).toBe("m");

        // No re-fetch through any of this.
        expect(dispatcher.getCommandCompletion).toHaveBeenCalledTimes(1);
    });

    test("completionState.prefix reflects menuAnchorIndex after consumption", async () => {
        const result = makeMultiGroupResult(
            [
                {
                    completions: [" world"],
                    separatorMode: "optionalSpacePunctuation",
                },
                { completions: ["music"], separatorMode: "space" },
            ],
            5,
        );
        const dispatcher = makeDispatcher(result);
        const { session } = makeSession(dispatcher);

        session.update("hello");
        await Promise.resolve();

        // At L0, no consumption: prefix starts at anchor.
        expect(session.getCompletionState()?.prefix).toBe("");

        // Type " " — L0 match, no consumption.
        session.update("hello ");
        expect(session.getCompletionState()?.prefix).toBe(" ");

        // Type " m" — consumption happens, menuAnchorIndex advances past " ".
        session.update("hello m");
        expect(session.getCompletionState()?.prefix).toBe("m");
    });
});

// ── D-cascade consumption tests (multi-separator handling) ───────────

describe("PartialCompletionSession — D-cascade consumption", () => {
    test("double space consumed sequentially", async () => {
        const result = makeCompletionResult(["items"], 4, {
            separatorMode: "space",
        });
        const dispatcher = makeDispatcher(result);
        const { session } = makeSession(dispatcher);

        session.update("play");
        await Promise.resolve();

        // "play  i" — two spaces before "i".
        // D1 consume " " → L1, rawPrefix " i".
        // " " at L1 (same level) → consume again → rawPrefix "i" → matches "items".
        session.update("play  i");
        expect(isActive(session)).toBe(true);
        expect(session.getCompletionState()?.prefix).toBe("i");
        expect(dispatcher.getCommandCompletion).toHaveBeenCalledTimes(1);
    });

    test("space then punctuation consumed in two steps (L1 → L2)", async () => {
        const result = makeMultiGroupResult(
            [
                {
                    completions: ["punct"],
                    separatorMode: "spacePunctuation",
                },
            ],
            4,
        );
        const dispatcher = makeDispatcher(result);
        const { session } = makeSession(dispatcher);

        session.update("play");
        await Promise.resolve();

        // "play ." — space then punctuation.
        // D1: " " → L1 (spacePunctuation visible at L1+). rawPrefix ".".
        // L1 trie: "." doesn't match "punct" → D1 again: "." → L2. rawPrefix "".
        // L2 trie: "" → all items → shows "punct".
        session.update("play .");
        expect(isActive(session)).toBe(true);
        expect(session.getCompletionState()?.prefix).toBe("");
        expect(dispatcher.getCommandCompletion).toHaveBeenCalledTimes(1);
    });

    test("punctuation jumps directly to L2 skipping L1", async () => {
        const result = makeMultiGroupResult(
            [
                {
                    completions: ["punct"],
                    separatorMode: "spacePunctuation",
                },
            ],
            4,
        );
        const dispatcher = makeDispatcher(result);
        const { session } = makeSession(dispatcher);

        session.update("play");
        await Promise.resolve();

        // "play." — punctuation directly.
        // D1: "." → L2 (charLevel=2 > menuSepLevel=0). rawPrefix "".
        session.update("play.");
        expect(isActive(session)).toBe(true);
        expect(session.getCompletionState()?.prefix).toBe("");
    });

    test("loop terminates on non-separator after consumption", async () => {
        const result = makeMultiGroupResult(
            [{ completions: ["items"], separatorMode: "space" }],
            4,
            { closedSet: false },
        );
        const dispatcher = makeDispatcher(result);
        const { session } = makeSession(dispatcher);

        session.update("play");
        await Promise.resolve();

        // "play x" — "x" is not separator, L0 has no items.
        // Non-separator guard triggers refetch (closedSet=false).
        session.update("play x");
        await Promise.resolve();
        expect(dispatcher.getCommandCompletion).toHaveBeenCalledTimes(2);
    });

    test("backspace after double consumption narrows to L0", async () => {
        const result = makeMultiGroupResult(
            [
                { completions: ["instant"], separatorMode: "none" },
                {
                    completions: ["punct"],
                    separatorMode: "spacePunctuation",
                },
            ],
            4,
        );
        const dispatcher = makeDispatcher(result);
        const { session } = makeSession(dispatcher);

        session.update("play");
        await Promise.resolve();

        // L0: "instant" visible.
        expect(isActive(session)).toBe(true);

        // Consume space then punct to get to L2.
        session.update("play .");
        expect(isActive(session)).toBe(true);

        // Backspace all the way to "play" — narrows to L0.
        session.update("play");
        expect(isActive(session)).toBe(true);
        // L0 items restored.
        const lastItems = loadedItems(session);
        expect(lastItems).toContain("instant");
        expect(lastItems).not.toContain("punct");

        expect(dispatcher.getCommandCompletion).toHaveBeenCalledTimes(1);
    });

    test("space after punctuation at L2 is still consumed", async () => {
        // Bug scenario: at L2 (punctuation consumed), a space (charLevel=1)
        // should be consumed as additional separator, not break the loop.
        // "play. beta" should match "beta" — the ". " is all separator text.
        const result = makeMultiGroupResult(
            [
                {
                    completions: ["beta"],
                    separatorMode: "spacePunctuation",
                },
            ],
            4,
        );
        const dispatcher = makeDispatcher(result);
        const { session } = makeSession(dispatcher);

        session.update("play");
        await Promise.resolve();

        // Consume "." → L2, items visible.
        session.update("play.");
        expect(isActive(session)).toBe(true);

        // Type space after punctuation — should still be consumed at L2.
        session.update("play. ");
        expect(isActive(session)).toBe(true);
        expect(session.getCompletionState()?.prefix).toBe("");

        // "play. b" — space consumed, "b" narrows to "beta".
        session.update("play. b");
        expect(isActive(session)).toBe(true);
        expect(session.getCompletionState()?.prefix).toBe("b");

        // No re-fetch through any of this.
        expect(dispatcher.getCommandCompletion).toHaveBeenCalledTimes(1);
    });
});

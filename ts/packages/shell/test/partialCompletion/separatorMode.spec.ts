// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import {
    PartialCompletionSession,
    makeMenu,
    makeDispatcher,
    makeCompletionResult,
    getPos,
    anyPosition,
    makeMultiGroupResult,
    lastSetChoicesItems,
} from "./helpers.js";

// ── separatorMode: "space" ────────────────────────────────────────────────────

describe("PartialCompletionSession — separatorMode: space", () => {
    test("defers menu display until trailing space is present", async () => {
        const menu = makeMenu();
        const result = makeCompletionResult(["music"], 4, {
            separatorMode: "space",
        });
        const dispatcher = makeDispatcher(result);
        const session = new PartialCompletionSession(menu, dispatcher);

        // Input without trailing space: "play" — no visible items (need space)
        session.update("play", getPos);
        await Promise.resolve();

        // Items pre-loaded at L1 (lowestLevelWithItems) but hidden
        // until separator is consumed.
        expect(menu.setChoices).toHaveBeenLastCalledWith(
            expect.arrayContaining([
                expect.objectContaining({ selectedText: "music" }),
            ]),
        );
        expect(menu.isActive()).toBe(false);
        // updatePrefix is NOT called (menu not shown)
        expect(menu.updatePrefix).not.toHaveBeenCalled();
    });

    test("typing separator shows menu without re-fetch", async () => {
        const menu = makeMenu();
        const result = makeCompletionResult(["music"], 4, {
            separatorMode: "space",
        });
        const dispatcher = makeDispatcher(result);
        const session = new PartialCompletionSession(menu, dispatcher);

        // First update: "play" — deferred (separatorMode, no trailing space)
        session.update("play", getPos);
        await Promise.resolve();

        // Second update: "play " — separator typed, menu should appear
        session.update("play ", getPos);

        expect(menu.updatePrefix).toHaveBeenCalledWith("", anyPosition);
        // No re-fetch — same dispatcher call count
        expect(dispatcher.getCommandCompletion).toHaveBeenCalledTimes(1);
    });

    test("menu shown after trailing space is typed", async () => {
        const menu = makeMenu();
        const result = makeCompletionResult(["music"], 4);
        const dispatcher = makeDispatcher(result);
        const session = new PartialCompletionSession(menu, dispatcher);

        session.update("play ", getPos);
        await Promise.resolve();

        expect(menu.setChoices).toHaveBeenCalledWith(
            expect.arrayContaining([
                expect.objectContaining({ selectedText: "music" }),
            ]),
        );
    });
});

// ── separatorMode: "spacePunctuation" ─────────────────────────────────────────

describe("PartialCompletionSession — separatorMode: spacePunctuation", () => {
    test("space satisfies spacePunctuation separator", async () => {
        const menu = makeMenu();
        const result = makeCompletionResult(["music"], 4, {
            separatorMode: "spacePunctuation",
        });
        const dispatcher = makeDispatcher(result);
        const session = new PartialCompletionSession(menu, dispatcher);

        session.update("play", getPos);
        await Promise.resolve();

        // Space satisfies spacePunctuation
        session.update("play ", getPos);

        expect(menu.updatePrefix).toHaveBeenCalledWith("", anyPosition);
        expect(dispatcher.getCommandCompletion).toHaveBeenCalledTimes(1);
    });

    test("punctuation satisfies spacePunctuation separator", async () => {
        const menu = makeMenu();
        const result = makeCompletionResult(["music"], 4, {
            separatorMode: "spacePunctuation",
        });
        const dispatcher = makeDispatcher(result);
        const session = new PartialCompletionSession(menu, dispatcher);

        session.update("play", getPos);
        await Promise.resolve();

        // Punctuation mark satisfies spacePunctuation.
        // The leading punctuation separator is stripped, just like whitespace.
        session.update("play.mu", getPos);

        expect(menu.updatePrefix).toHaveBeenCalledWith("mu", anyPosition);
        expect(dispatcher.getCommandCompletion).toHaveBeenCalledTimes(1);
    });

    test("letter after anchor triggers re-fetch under spacePunctuation", async () => {
        const menu = makeMenu();
        const result = makeCompletionResult(["music"], 4, {
            separatorMode: "spacePunctuation",
        });
        const dispatcher = makeDispatcher(result);
        const session = new PartialCompletionSession(menu, dispatcher);

        session.update("play", getPos);
        await Promise.resolve();

        // A letter is neither space nor punctuation — triggers re-fetch (A3)
        session.update("playx", getPos);

        expect(dispatcher.getCommandCompletion).toHaveBeenCalledTimes(2);
        expect(dispatcher.getCommandCompletion).toHaveBeenLastCalledWith(
            "playx",
            "forward",
        );
    });

    test("no separator yet hides menu under spacePunctuation", async () => {
        const menu = makeMenu();
        const result = makeCompletionResult(["music"], 4, {
            separatorMode: "spacePunctuation",
        });
        const dispatcher = makeDispatcher(result);
        const session = new PartialCompletionSession(menu, dispatcher);

        session.update("play", getPos);
        await Promise.resolve();

        // Exact anchor, no separator — menu hidden but session kept
        menu.hide.mockClear();
        session.update("play", getPos);

        expect(menu.hide).toHaveBeenCalled();
        expect(dispatcher.getCommandCompletion).toHaveBeenCalledTimes(1);
    });
});

// ── separatorMode: "optionalSpace" ─────────────────────────────────────────────────

describe("PartialCompletionSession — separatorMode: optional", () => {
    test("completions shown immediately without separator", async () => {
        const menu = makeMenu();
        const result = makeCompletionResult(["music"], 4, {
            separatorMode: "optionalSpace",
        });
        const dispatcher = makeDispatcher(result);
        const session = new PartialCompletionSession(menu, dispatcher);

        session.update("play", getPos);
        await Promise.resolve();

        // "optionalSpace" does not require a separator — menu shown immediately
        // rawPrefix="" → updatePrefix("", ...)
        expect(menu.updatePrefix).toHaveBeenCalledWith("", anyPosition);
    });

    test("typing after anchor filters within session", async () => {
        const menu = makeMenu();
        const result = makeCompletionResult(["music", "movie"], 4, {
            separatorMode: "optionalSpace",
        });
        const dispatcher = makeDispatcher(result);
        const session = new PartialCompletionSession(menu, dispatcher);

        session.update("play", getPos);
        await Promise.resolve();

        session.update("playmu", getPos);

        expect(menu.updatePrefix).toHaveBeenCalledWith("mu", anyPosition);
        expect(dispatcher.getCommandCompletion).toHaveBeenCalledTimes(1);
    });

    test("whitespace stripped but punctuation kept in prefix", async () => {
        const menu = makeMenu();
        const result = makeCompletionResult([".music"], 4, {
            separatorMode: "optionalSpace",
        });
        const dispatcher = makeDispatcher(result);
        const session = new PartialCompletionSession(menu, dispatcher);

        session.update("play", getPos);
        await Promise.resolve();

        // "optionalSpace" only strips whitespace — punctuation is preserved
        session.update("play .mu", getPos);

        expect(menu.updatePrefix).toHaveBeenCalledWith(".mu", anyPosition);
    });
});

// ── separatorMode: "optionalSpacePunctuation" ─────────────────────────────────

describe("PartialCompletionSession — separatorMode: optionalSpacePunctuation", () => {
    test("completions shown immediately without separator (like optional)", async () => {
        const menu = makeMenu();
        const result = makeCompletionResult(["music"], 4, {
            separatorMode: "optionalSpacePunctuation",
        });
        const dispatcher = makeDispatcher(result);
        const session = new PartialCompletionSession(menu, dispatcher);

        session.update("play", getPos);
        await Promise.resolve();

        // Like "optionalSpace": no separator required — menu shown at anchor
        expect(menu.updatePrefix).toHaveBeenCalledWith("", anyPosition);
    });

    test("typing after anchor filters within session", async () => {
        const menu = makeMenu();
        const result = makeCompletionResult(["music", "movie"], 4, {
            separatorMode: "optionalSpacePunctuation",
        });
        const dispatcher = makeDispatcher(result);
        const session = new PartialCompletionSession(menu, dispatcher);

        session.update("play", getPos);
        await Promise.resolve();

        session.update("playmu", getPos);

        expect(menu.updatePrefix).toHaveBeenCalledWith("mu", anyPosition);
        expect(dispatcher.getCommandCompletion).toHaveBeenCalledTimes(1);
    });

    test("space stripped from prefix (like spacePunctuation)", async () => {
        const menu = makeMenu();
        const result = makeCompletionResult(["music"], 4, {
            separatorMode: "optionalSpacePunctuation",
        });
        const dispatcher = makeDispatcher(result);
        const session = new PartialCompletionSession(menu, dispatcher);

        session.update("play", getPos);
        await Promise.resolve();

        session.update("play mu", getPos);

        expect(menu.updatePrefix).toHaveBeenCalledWith("mu", anyPosition);
    });

    test("punctuation stripped from prefix (unlike optional)", async () => {
        const menu = makeMenu();
        const result = makeCompletionResult(["music"], 4, {
            separatorMode: "optionalSpacePunctuation",
        });
        const dispatcher = makeDispatcher(result);
        const session = new PartialCompletionSession(menu, dispatcher);

        session.update("play", getPos);
        await Promise.resolve();

        // Key difference from "optionalSpace": punctuation IS stripped
        session.update("play.mu", getPos);

        expect(menu.updatePrefix).toHaveBeenCalledWith("mu", anyPosition);
    });

    test("mixed space+punctuation stripped from prefix", async () => {
        const menu = makeMenu();
        const result = makeCompletionResult(["music"], 4, {
            separatorMode: "optionalSpacePunctuation",
        });
        const dispatcher = makeDispatcher(result);
        const session = new PartialCompletionSession(menu, dispatcher);

        session.update("play", getPos);
        await Promise.resolve();

        // Multiple leading separators (space + punctuation) all stripped
        session.update("play .mu", getPos);

        expect(menu.updatePrefix).toHaveBeenCalledWith("mu", anyPosition);
    });

    test("no re-fetch when typing past anchor matches trie (separator not required)", async () => {
        const menu = makeMenu();
        const result = makeCompletionResult(["music"], 4, {
            separatorMode: "optionalSpacePunctuation",
        });
        const dispatcher = makeDispatcher(result);
        const session = new PartialCompletionSession(menu, dispatcher);

        session.update("play", getPos);
        await Promise.resolve();

        // Unlike "spacePunctuation", typing a letter after the anchor does
        // NOT immediately invalidate the session — the separator is optional,
        // so "playm" filters the trie for "m" which matches "music".
        session.update("playm", getPos);

        expect(menu.updatePrefix).toHaveBeenCalledWith("m", anyPosition);
        expect(dispatcher.getCommandCompletion).toHaveBeenCalledTimes(1);
    });
});

// ── separatorMode + direction interactions ────────────────────────────────────

describe("PartialCompletionSession — separatorMode + direction", () => {
    test("spacePunctuation with backward direction: punctuation separator commits", async () => {
        const menu = makeMenu();
        const result = makeCompletionResult(["music", "movie"], 4, {
            separatorMode: "spacePunctuation",
            directionSensitive: true,
        });
        const dispatcher = makeDispatcher(result);
        const session = new PartialCompletionSession(menu, dispatcher);

        session.update("play", getPos, "forward");
        await Promise.resolve(); // → ACTIVE, anchor = "play", deferred

        // Type punctuation separator: menu should appear with the completions
        session.update("play.", getPos, "backward");

        // Separator satisfies spacePunctuation — menu should show
        expect(menu.updatePrefix).toHaveBeenCalled();
        // No re-fetch (separator typed after anchor, within same session)
        expect(dispatcher.getCommandCompletion).toHaveBeenCalledTimes(1);
    });

    test("spacePunctuation with backward direction re-fetches when directionSensitive at anchor", async () => {
        const menu = makeMenu();
        // startIndex=4 = anchor length, so anchor = "play", input = "play"
        // directionSensitive=true at exact anchor → A7 applies
        const result = makeCompletionResult(["song", "track"], 4, {
            separatorMode: "spacePunctuation",
            directionSensitive: true,
        });
        const dispatcher = makeDispatcher(result);
        const session = new PartialCompletionSession(menu, dispatcher);

        session.update("play", getPos, "forward");
        await Promise.resolve(); // → ACTIVE, anchor = "play"

        // Same input, backward direction, at exact anchor + sensitive → A7
        session.update("play", getPos, "backward");

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
        const menu = makeMenu();
        const result = makeCompletionResult(["music"], 4, {
            separatorMode: "space",
        });
        const dispatcher = makeDispatcher(result);
        const session = new PartialCompletionSession(menu, dispatcher);

        session.update("play", getPos);
        await Promise.resolve(); // deferred — waiting for separator

        session.update("play", getPos); // same input again (e.g. selectionchange)

        expect(dispatcher.getCommandCompletion).toHaveBeenCalledTimes(1);
    });

    test("input diverges before separator arrives triggers re-fetch", async () => {
        const menu = makeMenu();
        const result = makeCompletionResult(["music"], 4, {
            separatorMode: "space",
        });
        const dispatcher = makeDispatcher(result);
        const session = new PartialCompletionSession(menu, dispatcher);

        session.update("play", getPos);
        await Promise.resolve(); // deferred

        // User typed a non-space character instead of a separator
        session.update("play2", getPos);

        expect(dispatcher.getCommandCompletion).toHaveBeenCalledTimes(2);
        expect(dispatcher.getCommandCompletion).toHaveBeenLastCalledWith(
            "play2",
            "forward",
        );
    });

    test("separator already in input when result arrives shows menu immediately", async () => {
        // User typed "play " fast enough that the promise resolves after the space.
        const menu = makeMenu();
        const result = makeCompletionResult(["music"], 4, {
            separatorMode: "space",
        });
        const dispatcher = makeDispatcher(result);
        const session = new PartialCompletionSession(menu, dispatcher);

        // Fetch was issued for "play" but by the time it resolves the user
        // has already moved on; a second update for "play " is already active.
        // Simulate by updating to "play " *before* awaiting.
        session.update("play", getPos);
        // (promise not yet resolved — we rely on the .then() calling reuseSession
        //  with the captured "play" input, which has no separator, so menu stays
        //  hidden.  A subsequent update("play ", ...) then shows it.)
        await Promise.resolve();

        session.update("play ", getPos);

        expect(menu.updatePrefix).toHaveBeenCalledWith("", anyPosition);
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
        const menu = makeMenu();
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
        const session = new PartialCompletionSession(menu, dispatcher);

        session.update("play", getPos);
        await Promise.resolve();

        // menuSepLevel = 1 via lowestLevelWithItems.
        // Deferred — separator not yet consumed, hidden.
        expect(menu.isActive()).toBe(false);

        // Type space: D1 consumes separator, items already loaded at L1.
        session.update("play ", getPos);
        expect(menu.isActive()).toBe(true);

        // No extra setChoices — the existing trie at level 1
        // already had the right items loaded by startNewSession.
        // (startNewSession calls loadLevel once; the space update just
        // runs updatePrefix on the already-loaded trie.)

        // Type "play.": anchor "play", rawPrefix=".".
        // D1 consumes "." → charLevel=2 > menuSepLevel=1 → advance to L2.
        // Level 2: only "beta" (spacePunctuation). Trie reloaded.
        // rawPrefix after consumption = "". Matches "beta".
        menu.setChoices.mockClear();
        session.update("play.", getPos);
        // Progressive consumption: may go through multiple levels.
        // The last setChoices call should have the level-2 items.
        expect(menu.setChoices).toHaveBeenLastCalledWith(
            expect.arrayContaining([
                expect.objectContaining({ matchText: "beta" }),
            ]),
        );
        expect(menu.isActive()).toBe(true);
        expect(dispatcher.getCommandCompletion).toHaveBeenCalledTimes(1);
    });

    test("B1 NARROW: backspace from level 1 to level 0 reloads trie", async () => {
        const menu = makeMenu();
        const result = makeTwoLevelResult();
        const dispatcher = makeDispatcher(result);
        const session = new PartialCompletionSession(menu, dispatcher);

        session.update("play", getPos);
        await Promise.resolve();

        // menuSepLevel=0, trie has "alpha" (optionalSpace at level 0).
        expect(menu.isActive()).toBe(true);

        // Type space: D1 consumes " " → charLevel=1 > menuSepLevel=0
        // → advance to L1. Trie reloaded with "alpha" + "beta".
        session.update("play ", getPos);
        expect(menu.isActive()).toBe(true);

        // Backspace to "play": rawPrefix="", sepLevel=0.
        // B1: sepLevel(0) < menuSepLevel(1) + items at level 0 → NARROW.
        // Trie reloaded with level-0 items ("alpha" only).
        menu.setChoices.mockClear();
        session.update("play", getPos);
        // Exactly one setChoices for the narrow reload.
        expect(menu.setChoices).toHaveBeenCalledTimes(1);
        expect(menu.setChoices).toHaveBeenCalledWith(
            expect.arrayContaining([
                expect.objectContaining({ matchText: "alpha" }),
            ]),
        );
        // Only "alpha" — "beta" (space mode) not visible at level 0.
        expect(menu.setChoices).not.toHaveBeenCalledWith(
            expect.arrayContaining([
                expect.objectContaining({ matchText: "beta" }),
            ]),
        );
        expect(menu.isActive()).toBe(true);
        expect(dispatcher.getCommandCompletion).toHaveBeenCalledTimes(1);
    });

    test("DEFERRED-SEP: skip-ahead hides menu until separator typed", async () => {
        const menu = makeMenu();
        // Only "space" mode items — nothing at level 0.
        const result = makeMultiGroupResult(
            [{ completions: ["music"], separatorMode: "space" }],
            4,
        );
        const dispatcher = makeDispatcher(result);
        const session = new PartialCompletionSession(menu, dispatcher);

        session.update("play", getPos);
        await Promise.resolve();

        // lowestLevelWithItems → 1. menuSepLevel=1.
        // Deferred — separator not yet consumed, hidden.
        expect(menu.isActive()).toBe(false);

        // Same input again — still deferred.
        session.update("play", getPos);
        expect(menu.isActive()).toBe(false);
        expect(dispatcher.getCommandCompletion).toHaveBeenCalledTimes(1);

        // Type space — separator typed, sepLevel matches menuSepLevel.
        session.update("play ", getPos);
        expect(menu.isActive()).toBe(true);
        expect(menu.updatePrefix).toHaveBeenLastCalledWith(
            "",
            expect.anything(),
        );
        expect(dispatcher.getCommandCompletion).toHaveBeenCalledTimes(1);
    });

    test("no trie reload when sepLevel stays at same menuSepLevel", async () => {
        const menu = makeMenu();
        const result = makeTwoLevelResult();
        const dispatcher = makeDispatcher(result);
        const session = new PartialCompletionSession(menu, dispatcher);

        session.update("play", getPos);
        await Promise.resolve();

        // menuSepLevel=0. Trie loaded once with level-0 items.
        // Type more characters that don't change sepLevel:
        menu.setChoices.mockClear();
        session.update("playa", getPos);
        session.update("playalp", getPos);

        // setChoices NOT called — trie stays loaded at level 0.
        expect(menu.setChoices).not.toHaveBeenCalled();
        expect(dispatcher.getCommandCompletion).toHaveBeenCalledTimes(1);
    });

    test("consume then narrow round-trip preserves correct items", async () => {
        const menu = makeMenu();
        const result = makeTwoLevelResult();
        const dispatcher = makeDispatcher(result);
        const session = new PartialCompletionSession(menu, dispatcher);

        session.update("play", getPos);
        await Promise.resolve();

        // Level 0: "alpha". Level 1: "alpha"+"beta".
        expect(menu.isActive()).toBe(true); // "alpha" at level 0

        // Consume: type space → level 1.
        session.update("play ", getPos);
        expect(menu.isActive()).toBe(true);

        // Narrow: backspace → level 0.
        session.update("play", getPos);
        expect(menu.isActive()).toBe(true);

        // Consume again: type space → level 1.
        menu.setChoices.mockClear();
        session.update("play ", getPos);
        // Exactly one setChoices for the consume reload.
        expect(menu.setChoices).toHaveBeenCalledTimes(1);
        expect(menu.setChoices).toHaveBeenCalledWith(
            expect.arrayContaining([
                expect.objectContaining({ matchText: "alpha" }),
                expect.objectContaining({ matchText: "beta" }),
            ]),
        );
        expect(menu.isActive()).toBe(true);

        // All within one session — no re-fetch.
        expect(dispatcher.getCommandCompletion).toHaveBeenCalledTimes(1);
    });

    test("optionalSpacePunctuation visible at all three levels", async () => {
        const menu = makeMenu();
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
        const session = new PartialCompletionSession(menu, dispatcher);

        session.update("play", getPos);
        await Promise.resolve();

        // Level 0: "gamma" visible (optionalSpacePunctuation at lv0).
        expect(menu.isActive()).toBe(true);
        expect(menu.updatePrefix).toHaveBeenLastCalledWith(
            "",
            expect.anything(),
        );

        // Level 1 (space): still visible. optionalSpacePunctuation is in
        // both level 0 and 1 — consumption advances and reloads trie
        // with level-1 items (same single item).
        session.update("play ", getPos);
        expect(menu.isActive()).toBe(true);

        // Level 2 (punctuation): still visible. Consumption to L2.
        session.update("play.", getPos);
        expect(menu.isActive()).toBe(true);
        expect(menu.updatePrefix).toHaveBeenLastCalledWith(
            "",
            expect.anything(),
        );

        expect(dispatcher.getCommandCompletion).toHaveBeenCalledTimes(1);
    });

    test("spacePunctuation visible at levels 1 and 2 but not 0", async () => {
        const menu = makeMenu();
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
        const session = new PartialCompletionSession(menu, dispatcher);

        session.update("play", getPos);
        await Promise.resolve();

        // Items pre-loaded at L1 (lowestLevelWithItems) but hidden
        // until separator is consumed.
        expect(menu.isActive()).toBe(false);

        // Level 1 (space): visible — separator consumed, items already loaded.
        menu.setChoices.mockClear();
        session.update("play ", getPos);
        expect(menu.isActive()).toBe(true);
        expect(menu.setChoices).not.toHaveBeenCalled();

        // Backspace → B1 narrows to L1 (lowestLevelWithItems), hidden
        // because consumed separator was reset.
        session.update("play", getPos);
        expect(menu.isActive()).toBe(false);

        // Level 2 (punctuation): visible. Consumption to L2.
        session.update("play.", getPos);
        expect(menu.isActive()).toBe(true);

        expect(dispatcher.getCommandCompletion).toHaveBeenCalledTimes(1);
    });

    test("none mode only visible at level 0", async () => {
        const menu = makeMenu();
        const result = makeMultiGroupResult(
            [{ completions: ["epsilon"], separatorMode: "none" }],
            4,
        );
        const dispatcher = makeDispatcher(result);
        const session = new PartialCompletionSession(menu, dispatcher);

        session.update("play", getPos);
        await Promise.resolve();

        // Level 0: visible.
        expect(menu.isActive()).toBe(true);
        expect(menu.updatePrefix).toHaveBeenLastCalledWith(
            "",
            expect.anything(),
        );

        // Level 1 (space): "none" mode is NOT visible at level 1.
        // D1 consumes " " → charLevel=1 > menuSepLevel=0 → advance to L1.
        // Level 1: no items for "none" mode. Empty trie.
        // D4: accept (closedSet=true).
        // Consume loaded empty trie at level 1 — exactly 1 setChoices.
        menu.setChoices.mockClear();
        session.update("play ", getPos);
        expect(menu.isActive()).toBe(false);
        expect(menu.setChoices).toHaveBeenCalledTimes(1);

        expect(dispatcher.getCommandCompletion).toHaveBeenCalledTimes(1);
    });

    test("step-by-step backward: L0 → L1 → L2 then L2 → L1 → L0", async () => {
        // Three groups at distinct levels:
        //   "instant" (none)              → L0 only
        //   "word"    (space)             → L1 only
        //   "punct"   (spacePunctuation)  → L1 + L2
        const menu = makeMenu();
        const result = makeMultiGroupResult(
            [
                { completions: ["instant"], separatorMode: "none" },
                { completions: ["word"], separatorMode: "space" },
                { completions: ["punct"], separatorMode: "spacePunctuation" },
            ],
            4,
        );
        const dispatcher = makeDispatcher(result);
        const session = new PartialCompletionSession(menu, dispatcher);

        // ── Forward: L0 → L1 → L2 ──
        session.update("play", getPos);
        await Promise.resolve();

        // L0: only "instant".
        const l0Items = lastSetChoicesItems(menu);
        expect(l0Items).toContain("instant");
        expect(l0Items).not.toContain("word");
        expect(l0Items).not.toContain("punct");
        expect(menu.isActive()).toBe(true);

        // Type space → L1: "word" + "punct" (not "instant").
        session.update("play ", getPos);
        expect(menu.isActive()).toBe(true);
        const l1Items = lastSetChoicesItems(menu);
        expect(l1Items).toContain("word");
        expect(l1Items).toContain("punct");
        expect(l1Items).not.toContain("instant");

        // Type punctuation → L2: only "punct" (not "word", not "instant").
        session.update("play .", getPos);
        expect(menu.isActive()).toBe(true);
        const l2Items = lastSetChoicesItems(menu);
        expect(l2Items).toContain("punct");
        expect(l2Items).not.toContain("word");
        expect(l2Items).not.toContain("instant");

        // ── Backward: L2 → L1 (delete punctuation) ──
        menu.setChoices.mockClear();
        session.update("play ", getPos);
        expect(menu.isActive()).toBe(true);
        const backL1Items = lastSetChoicesItems(menu);
        expect(backL1Items).toContain("word");
        expect(backL1Items).toContain("punct");
        expect(backL1Items).not.toContain("instant");

        // ── Backward: L1 → L0 (delete space) ──
        menu.setChoices.mockClear();
        session.update("play", getPos);
        expect(menu.isActive()).toBe(true);
        const backL0Items = lastSetChoicesItems(menu);
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
        const menu = makeMenu();
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
        const session = new PartialCompletionSession(menu, dispatcher);

        // ── Forward to L0 ──
        session.update("play", getPos);
        await Promise.resolve();

        // L0: " instant" visible.
        expect(menu.isActive()).toBe(true);

        // Type space: L0 trie matches " instant" (explicit-space priority).
        session.update("play ", getPos);
        expect(menu.isActive()).toBe(true);
        expect(menu.updatePrefix).toHaveBeenLastCalledWith(
            " ",
            expect.anything(),
        );

        // Type ".": " ." fails L0 trie → consume " "→L1 → "." fails → consume "."→L2.
        session.update("play .", getPos);
        expect(menu.isActive()).toBe(true);

        // ── Backward: L2 → L1 ──
        // Delete "." → "play ". Remaining separator = " " → sepLevel=1 → L1.
        menu.setChoices.mockClear();
        session.update("play ", getPos);
        expect(menu.isActive()).toBe(true);
        const backL1Items = lastSetChoicesItems(menu);
        // L1 has all three items (" instant" + "word" + "punct").
        expect(backL1Items).toContain(" instant");
        expect(backL1Items).toContain("word");
        expect(backL1Items).toContain("punct");

        // ── Backward: L1 → L0 ──
        // Delete space → "play". No separator → sepLevel=0 → L0.
        menu.setChoices.mockClear();
        session.update("play", getPos);
        expect(menu.isActive()).toBe(true);
        const backL0Items = lastSetChoicesItems(menu);
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
        const menu = makeMenu();
        const result = makeMultiGroupResult(
            [{ completions: ["punct"], separatorMode: "spacePunctuation" }],
            4,
        );
        const dispatcher = makeDispatcher(result);
        const session = new PartialCompletionSession(menu, dispatcher);

        session.update("play", getPos);
        await Promise.resolve();

        // Forward to L2 via punctuation.
        session.update("play.", getPos);
        expect(menu.isActive()).toBe(true);

        // Replace "." with "," — consumed sep mismatch triggers B1.
        // Remaining rawPrefix = "," → sepLevel=2 → target L2. Same level,
        // but consumedSep updated to ",".
        session.update("play,", getPos);
        expect(menu.isActive()).toBe(true);
        expect(menu.updatePrefix).toHaveBeenLastCalledWith(
            "",
            expect.anything(),
        );

        // Replace "," with " " — sepLevel=1 → L1, "punct" still visible.
        session.update("play ", getPos);
        expect(menu.isActive()).toBe(true);
        expect(menu.updatePrefix).toHaveBeenLastCalledWith(
            "",
            expect.anything(),
        );

        expect(dispatcher.getCommandCompletion).toHaveBeenCalledTimes(1);
    });
});

// ── Gap 3: autoSpacePunctuation resolution in the shell ──────────────────

describe("PartialCompletionSession — autoSpacePunctuation", () => {
    test("Latin-Latin pair resolves to spacePunctuation (separator required)", async () => {
        // Input ends with "d" (Latin), completions start with Latin chars.
        // needsSeparatorInAutoMode('d', 'a') → true → spacePunctuation.
        const menu = makeMenu();
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
        const session = new PartialCompletionSession(menu, dispatcher);

        // "word" — last char is 'd', completions start with 'a'/'b' (Latin).
        // Auto-resolved to spacePunctuation → needs separator.
        session.update("word", getPos);
        await Promise.resolve();

        // Level 0: spacePunctuation not visible → menu hidden.
        expect(menu.isActive()).toBe(false);

        // Typing space: level 1, spacePunctuation visible.
        session.update("word ", getPos);
        expect(menu.isActive()).toBe(true);
        expect(menu.updatePrefix).toHaveBeenCalledWith("", anyPosition);

        expect(dispatcher.getCommandCompletion).toHaveBeenCalledTimes(1);
    });

    test("Latin-CJK pair resolves to optionalSpacePunctuation (no separator needed)", async () => {
        // Input ends with "d" (Latin), completions start with CJK.
        // needsSeparatorInAutoMode('d', '東') → false → optionalSpacePunctuation.
        const menu = makeMenu();
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
        const session = new PartialCompletionSession(menu, dispatcher);

        // "word" — last char is 'd', completions start with '東'/'大' (CJK).
        // Auto-resolved to optionalSpacePunctuation → no separator needed.
        session.update("word", getPos);
        await Promise.resolve();

        // Level 0: optionalSpacePunctuation IS visible → menu shown.
        expect(menu.isActive()).toBe(true);
        expect(menu.setChoices).toHaveBeenCalled();

        expect(dispatcher.getCommandCompletion).toHaveBeenCalledTimes(1);
    });

    test("CJK-CJK pair resolves to optionalSpacePunctuation", async () => {
        // Input ends with CJK, completions start with CJK.
        // needsSeparatorInAutoMode('京', '東') → false (CJK is not word-boundary).
        const menu = makeMenu();
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
        const session = new PartialCompletionSession(menu, dispatcher);

        // "東京" — CJK-CJK → no separator needed.
        session.update("東京", getPos);
        await Promise.resolve();

        expect(menu.isActive()).toBe(true);

        expect(dispatcher.getCommandCompletion).toHaveBeenCalledTimes(1);
    });

    test("digit-digit pair resolves to spacePunctuation (separator required)", async () => {
        const menu = makeMenu();
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
        const session = new PartialCompletionSession(menu, dispatcher);

        // "123" — digit-digit → separator required.
        session.update("123", getPos);
        await Promise.resolve();

        // Digit-digit pair → spacePunctuation → not visible at level 0.
        expect(menu.isActive()).toBe(false);

        // Typing space shows menu.
        session.update("123 ", getPos);
        expect(menu.isActive()).toBe(true);

        expect(dispatcher.getCommandCompletion).toHaveBeenCalledTimes(1);
    });

    test("mixed auto group splits items across partitions", async () => {
        // A single group with autoSpacePunctuation where some items
        // need a separator (Latin-Latin) and some don't (Latin-CJK).
        const menu = makeMenu();
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
        const session = new PartialCompletionSession(menu, dispatcher);

        // "word" — last char 'd' (Latin).
        // "alpha" → needsSep('d','a') = true → spacePunctuation
        // "東京"  → needsSep('d','東') = false → optionalSpacePunctuation
        session.update("word", getPos);
        await Promise.resolve();

        // Level 0: only optionalSpacePunctuation items visible → "東京".
        expect(menu.isActive()).toBe(true);
        // The trie should have the CJK item at level 0.
        const prefix0 = menu.updatePrefix.mock.calls[0]?.[0];
        expect(prefix0).toBe("");

        // Typing space → level 1: both spacePunctuation and optional visible.
        menu.setChoices.mockClear();
        session.update("word ", getPos);
        expect(menu.isActive()).toBe(true);
        // D1 consumes " " → advance to L1, both items loaded.
        expect(menu.setChoices).toHaveBeenCalledTimes(1);

        expect(dispatcher.getCommandCompletion).toHaveBeenCalledTimes(1);
    });

    test("startIndex=0 uses empty string for character pair (no preceding char)", async () => {
        // When startIndex is 0 there is no preceding character.
        // needsSeparatorInAutoMode guard: startIndex > 0 is false
        // → all items resolve to optionalSpacePunctuation.
        const menu = makeMenu();
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
        const session = new PartialCompletionSession(menu, dispatcher);

        session.update("", getPos);
        await Promise.resolve();

        // All items → optionalSpacePunctuation → visible at level 0.
        expect(menu.isActive()).toBe(true);

        expect(dispatcher.getCommandCompletion).toHaveBeenCalledTimes(1);
    });
});

// ── Gap 4: toPartitions bucketing (multiple groups with different modes) ──

describe("PartialCompletionSession — multi-group partitioning", () => {
    test("two groups with different modes show correct items per level", async () => {
        const menu = makeMenu();
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
        const session = new PartialCompletionSession(menu, dispatcher);

        // "play" — level 0: only optionalSpacePunctuation visible.
        session.update("play", getPos);
        await Promise.resolve();

        expect(menu.isActive()).toBe(true);
        // Level 0 should only have "entity1" (optionalSpacePunctuation).
        // "cmd1"/"cmd2" (space) need level 1.
        expect(menu.setChoices).toHaveBeenCalledWith(
            expect.arrayContaining([
                expect.objectContaining({ selectedText: "entity1" }),
            ]),
        );
        const items = lastSetChoicesItems(menu);
        expect(items.every((i) => i !== "cmd1")).toBe(true);

        // "play " — level 1: both "space" and "optionalSpacePunctuation" visible.
        menu.setChoices.mockClear();
        session.update("play ", getPos);
        expect(menu.isActive()).toBe(true);
        // D1 consumes " " → new trie with all level-1 items.
        expect(menu.setChoices).toHaveBeenCalledTimes(1);
        const level1Items = lastSetChoicesItems(menu);
        expect(level1Items).toContain("cmd1");
        expect(level1Items).toContain("cmd2");
        expect(level1Items).toContain("entity1");

        expect(dispatcher.getCommandCompletion).toHaveBeenCalledTimes(1);
    });

    test("space + spacePunctuation groups: space only at level 1, spacePunctuation at level 1 and 2", async () => {
        const menu = makeMenu();
        const result = makeMultiGroupResult(
            [
                { completions: ["flag"], separatorMode: "space" },
                { completions: ["entity"], separatorMode: "spacePunctuation" },
            ],
            4,
        );
        const dispatcher = makeDispatcher(result);
        const session = new PartialCompletionSession(menu, dispatcher);

        // Level 0: neither visible.
        session.update("play", getPos);
        await Promise.resolve();
        expect(menu.isActive()).toBe(false);

        // Level 1 (space): both visible after consumption.
        session.update("play ", getPos);
        expect(menu.isActive()).toBe(true);
        const level1Items = lastSetChoicesItems(menu);
        expect(level1Items).toContain("flag");
        expect(level1Items).toContain("entity");

        // Level 2 (punctuation): only spacePunctuation.
        session.update("play.", getPos);
        expect(menu.isActive()).toBe(true);
        const level2Items = lastSetChoicesItems(menu);
        expect(level2Items).toContain("entity");
        expect(level2Items.includes("flag")).toBe(false);

        expect(dispatcher.getCommandCompletion).toHaveBeenCalledTimes(1);
    });

    test("empty group produces no items", async () => {
        const menu = makeMenu();
        const result = makeMultiGroupResult(
            [
                { completions: [], separatorMode: "space" },
                { completions: ["only"], separatorMode: "optionalSpace" },
            ],
            4,
        );
        const dispatcher = makeDispatcher(result);
        const session = new PartialCompletionSession(menu, dispatcher);

        session.update("play", getPos);
        await Promise.resolve();

        // Only "only" (optionalSpace) at level 0.
        expect(menu.isActive()).toBe(true);
        const items = lastSetChoicesItems(menu);
        expect(items).toHaveLength(1);
        expect(items[0]).toBe("only");

        expect(dispatcher.getCommandCompletion).toHaveBeenCalledTimes(1);
    });

    test("three groups at all levels provide correct item sets", async () => {
        const menu = makeMenu();
        const result = makeMultiGroupResult(
            [
                { completions: ["instant"], separatorMode: "none" },
                { completions: ["word"], separatorMode: "space" },
                { completions: ["punct"], separatorMode: "spacePunctuation" },
            ],
            4,
        );
        const dispatcher = makeDispatcher(result);
        const session = new PartialCompletionSession(menu, dispatcher);

        // Level 0: only "none" visible.
        session.update("play", getPos);
        await Promise.resolve();
        expect(menu.isActive()).toBe(true);
        const level0Items = lastSetChoicesItems(menu);
        expect(level0Items).toContain("instant");
        expect(level0Items).not.toContain("word");
        expect(level0Items).not.toContain("punct");

        // Level 1: "space" + "spacePunctuation" visible, NOT "none".
        session.update("play ", getPos);
        expect(menu.isActive()).toBe(true);
        const level1Items = lastSetChoicesItems(menu);
        expect(level1Items).toContain("word");
        expect(level1Items).toContain("punct");
        expect(level1Items).not.toContain("instant");

        // Level 2: only "spacePunctuation" visible.
        session.update("play.", getPos);
        expect(menu.isActive()).toBe(true);
        const level2Items = lastSetChoicesItems(menu);
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
        const menu = makeMenu();
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
        const session = new PartialCompletionSession(menu, dispatcher);

        session.update("hello", getPos);
        await Promise.resolve();

        // " world" is at L0 (optionalSpacePunctuation visible at all levels).
        expect(menu.isActive()).toBe(true);

        // Type " " — rawPrefix " " matches " world" at L0, no consumption.
        session.update("hello ", getPos);
        expect(menu.isActive()).toBe(true);
        expect(menu.updatePrefix).toHaveBeenLastCalledWith(
            " ",
            expect.anything(),
        );
        // No re-fetch.
        expect(dispatcher.getCommandCompletion).toHaveBeenCalledTimes(1);
    });

    test("explicit-space item narrowed by additional chars", async () => {
        const menu = makeMenu();
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
        const session = new PartialCompletionSession(menu, dispatcher);

        session.update("hello", getPos);
        await Promise.resolve();

        // Type " wo" — matches both " world" and " wonder".
        session.update("hello wo", getPos);
        expect(menu.isActive()).toBe(true);
        expect(menu.updatePrefix).toHaveBeenLastCalledWith(
            " wo",
            expect.anything(),
        );

        // Type " wor" — narrows to " world" only.
        session.update("hello wor", getPos);
        expect(menu.updatePrefix).toHaveBeenLastCalledWith(
            " wor",
            expect.anything(),
        );
        expect(dispatcher.getCommandCompletion).toHaveBeenCalledTimes(1);
    });

    test("mixed: explicit-space + regular items — space shows L0 first", async () => {
        // " world" at L0 (optionalSpacePunctuation) + "music" at L1 (space).
        // Space should show " world" first; non-matching char cascades to "music".
        const menu = makeMenu();
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
        const session = new PartialCompletionSession(menu, dispatcher);

        session.update("hello", getPos);
        await Promise.resolve();

        // L0 shows " world" (optionalSpacePunctuation visible at L0).
        expect(menu.isActive()).toBe(true);

        // Type " " — L0 trie matches " world".
        session.update("hello ", getPos);
        expect(menu.isActive()).toBe(true);
        expect(menu.updatePrefix).toHaveBeenLastCalledWith(
            " ",
            expect.anything(),
        );

        // Type " m" — " m" doesn't match " world" at L0.
        // D1 consumes " " → L1 has "music" + " world".
        // rawPrefix "m" → trie matches "music".
        session.update("hello m", getPos);
        expect(menu.isActive()).toBe(true);
        expect(menu.updatePrefix).toHaveBeenLastCalledWith(
            "m",
            expect.anything(),
        );

        // No re-fetch through any of this.
        expect(dispatcher.getCommandCompletion).toHaveBeenCalledTimes(1);
    });

    test("getCompletionPrefix reflects menuAnchorIndex after consumption", async () => {
        const menu = makeMenu();
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
        const session = new PartialCompletionSession(menu, dispatcher);

        session.update("hello", getPos);
        await Promise.resolve();

        // At L0, no consumption: prefix starts at anchor.
        expect(session.getCompletionPrefix("hello")).toBe("");

        // Type " " — L0 match, no consumption.
        session.update("hello ", getPos);
        expect(session.getCompletionPrefix("hello ")).toBe(" ");

        // Type " m" — consumption happens, menuAnchorIndex advances past " ".
        session.update("hello m", getPos);
        expect(session.getCompletionPrefix("hello m")).toBe("m");
    });
});

// ── D-cascade consumption tests (multi-separator handling) ───────────

describe("PartialCompletionSession — D-cascade consumption", () => {
    test("double space consumed sequentially", async () => {
        const menu = makeMenu();
        const result = makeCompletionResult(["items"], 4, {
            separatorMode: "space",
        });
        const dispatcher = makeDispatcher(result);
        const session = new PartialCompletionSession(menu, dispatcher);

        session.update("play", getPos);
        await Promise.resolve();

        // "play  i" — two spaces before "i".
        // D1 consume " " → L1, rawPrefix " i".
        // " " at L1 (same level) → consume again → rawPrefix "i" → matches "items".
        session.update("play  i", getPos);
        expect(menu.isActive()).toBe(true);
        expect(menu.updatePrefix).toHaveBeenLastCalledWith(
            "i",
            expect.anything(),
        );
        expect(dispatcher.getCommandCompletion).toHaveBeenCalledTimes(1);
    });

    test("space then punctuation consumed in two steps (L1 → L2)", async () => {
        const menu = makeMenu();
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
        const session = new PartialCompletionSession(menu, dispatcher);

        session.update("play", getPos);
        await Promise.resolve();

        // "play ." — space then punctuation.
        // D1: " " → L1 (spacePunctuation visible at L1+). rawPrefix ".".
        // L1 trie: "." doesn't match "punct" → D1 again: "." → L2. rawPrefix "".
        // L2 trie: "" → all items → shows "punct".
        session.update("play .", getPos);
        expect(menu.isActive()).toBe(true);
        expect(menu.updatePrefix).toHaveBeenLastCalledWith(
            "",
            expect.anything(),
        );
        expect(dispatcher.getCommandCompletion).toHaveBeenCalledTimes(1);
    });

    test("punctuation jumps directly to L2 skipping L1", async () => {
        const menu = makeMenu();
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
        const session = new PartialCompletionSession(menu, dispatcher);

        session.update("play", getPos);
        await Promise.resolve();

        // "play." — punctuation directly.
        // D1: "." → L2 (charLevel=2 > menuSepLevel=0). rawPrefix "".
        session.update("play.", getPos);
        expect(menu.isActive()).toBe(true);
        expect(menu.updatePrefix).toHaveBeenLastCalledWith(
            "",
            expect.anything(),
        );
    });

    test("loop terminates on non-separator after consumption", async () => {
        const menu = makeMenu();
        const result = makeMultiGroupResult(
            [{ completions: ["items"], separatorMode: "space" }],
            4,
            { closedSet: false },
        );
        const dispatcher = makeDispatcher(result);
        const session = new PartialCompletionSession(menu, dispatcher);

        session.update("play", getPos);
        await Promise.resolve();

        // "play x" — "x" is not separator, L0 has no items.
        // Non-separator guard triggers refetch (closedSet=false).
        session.update("play x", getPos);
        await Promise.resolve();
        expect(dispatcher.getCommandCompletion).toHaveBeenCalledTimes(2);
    });

    test("backspace after double consumption narrows to L0", async () => {
        const menu = makeMenu();
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
        const session = new PartialCompletionSession(menu, dispatcher);

        session.update("play", getPos);
        await Promise.resolve();

        // L0: "instant" visible.
        expect(menu.isActive()).toBe(true);

        // Consume space then punct to get to L2.
        session.update("play .", getPos);
        expect(menu.isActive()).toBe(true);

        // Backspace all the way to "play" — narrows to L0.
        session.update("play", getPos);
        expect(menu.isActive()).toBe(true);
        // L0 items restored.
        const lastItems = lastSetChoicesItems(menu);
        expect(lastItems).toContain("instant");
        expect(lastItems).not.toContain("punct");

        expect(dispatcher.getCommandCompletion).toHaveBeenCalledTimes(1);
    });

    test("space after punctuation at L2 is still consumed", async () => {
        // Bug scenario: at L2 (punctuation consumed), a space (charLevel=1)
        // should be consumed as additional separator, not break the loop.
        // "play. beta" should match "beta" — the ". " is all separator text.
        const menu = makeMenu();
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
        const session = new PartialCompletionSession(menu, dispatcher);

        session.update("play", getPos);
        await Promise.resolve();

        // Consume "." → L2, items visible.
        session.update("play.", getPos);
        expect(menu.isActive()).toBe(true);

        // Type space after punctuation — should still be consumed at L2.
        session.update("play. ", getPos);
        expect(menu.isActive()).toBe(true);
        expect(menu.updatePrefix).toHaveBeenLastCalledWith(
            "",
            expect.anything(),
        );

        // "play. b" — space consumed, "b" narrows to "beta".
        session.update("play. b", getPos);
        expect(menu.isActive()).toBe(true);
        expect(menu.updatePrefix).toHaveBeenLastCalledWith(
            "b",
            expect.anything(),
        );

        // No re-fetch through any of this.
        expect(dispatcher.getCommandCompletion).toHaveBeenCalledTimes(1);
    });
});

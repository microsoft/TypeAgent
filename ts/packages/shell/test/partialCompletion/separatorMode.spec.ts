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

        // Trie is preloaded with all items but the menu stays hidden.
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

// ── SepLevel: widen / narrow / skip-ahead ──────────────────────────────────

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

    test("D1 WIDEN: space group exhausted, punctuation widens to level 2", async () => {
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
        // rawPrefix="" → sepLevel=0, B2 BEFORE-MENU (hide).
        expect(menu.isActive()).toBe(false);

        // Type space: sepLevel=1, menuSepLevel=1. Trie has alpha+beta.
        session.update("play ", getPos);
        expect(menu.isActive()).toBe(true);

        // No extra setChoices between B2→show — the existing trie at level 1
        // already had the right items loaded by startNewSession.
        // (startNewSession calls loadLevel once; the space update just
        // runs updatePrefix on the already-loaded trie.)

        // Type "play.": anchor "play", rawPrefix=".", sepLevel=2.
        // Trie is at level 1 (alpha+beta). prefix at level 1 = trimStart(".") = ".".
        // "." doesn't match "alpha" or "beta". Menu not active (C3 fails).
        // D1: sepLevel(2) > menuSepLevel(1) → widen to level 2.
        // Level 2: only "beta" (spacePunctuation). Trie reloaded.
        // Stripped prefix at level 2: strip "." → "". Matches "beta".
        menu.setChoices.mockClear();
        session.update("play.", getPos);
        // Exactly one setChoices for the widen reload.
        expect(menu.setChoices).toHaveBeenCalledTimes(1);
        expect(menu.setChoices).toHaveBeenCalledWith(
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

        // Type space: sepLevel=1, menuSepLevel=0.
        // D1: sepLevel(1) > menuSepLevel(0) → widen to level 1.
        // Level 1: "alpha" + "beta". Trie reloaded, prefix="" → shows both.
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

    test("B2 BEFORE-MENU: skip-ahead hides menu until separator typed", async () => {
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
        // rawPrefix="" → sepLevel=0 < menuSepLevel=1 → B2 BEFORE-MENU.
        expect(menu.isActive()).toBe(false);

        // Same input again — still B2.
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

    test("widen then narrow round-trip preserves correct items", async () => {
        const menu = makeMenu();
        const result = makeTwoLevelResult();
        const dispatcher = makeDispatcher(result);
        const session = new PartialCompletionSession(menu, dispatcher);

        session.update("play", getPos);
        await Promise.resolve();

        // Level 0: "alpha". Level 1: "alpha"+"beta".
        expect(menu.isActive()).toBe(true); // "alpha" at level 0

        // Widen: type space → level 1.
        session.update("play ", getPos);
        expect(menu.isActive()).toBe(true);

        // Narrow: backspace → level 0.
        session.update("play", getPos);
        expect(menu.isActive()).toBe(true);

        // Widen again: type space → level 1.
        menu.setChoices.mockClear();
        session.update("play ", getPos);
        // Exactly one setChoices for the widen reload.
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
        // both level 0 and 1 — widen reloads the trie with level-1 items,
        // but it's the same single item.
        menu.setChoices.mockClear();
        session.update("play ", getPos);
        expect(menu.isActive()).toBe(true);
        // Widen from 0→1 reloads trie (1 setChoices call).
        expect(menu.setChoices).toHaveBeenCalledTimes(1);

        // Level 2 (punctuation): still visible. Widen from 1→2.
        menu.setChoices.mockClear();
        session.update("play.", getPos);
        expect(menu.isActive()).toBe(true);
        expect(menu.updatePrefix).toHaveBeenLastCalledWith(
            "",
            expect.anything(),
        );
        // Widen from 1→2 reloads trie (1 setChoices call).
        expect(menu.setChoices).toHaveBeenCalledTimes(1);

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

        // Level 0: no items (spacePunctuation not at level 0).
        // Skip-ahead to level 1. B2 at anchor → hidden.
        expect(menu.isActive()).toBe(false);

        // Level 1 (space): visible.
        // No extra setChoices — trie was already loaded at level 1 by startNewSession.
        menu.setChoices.mockClear();
        session.update("play ", getPos);
        expect(menu.isActive()).toBe(true);
        expect(menu.setChoices).not.toHaveBeenCalled();

        // Backspace → hidden (B2 at anchor).
        session.update("play", getPos);
        expect(menu.isActive()).toBe(false);
        // No setChoices on B2 — trie stays loaded at level 1.
        expect(menu.setChoices).not.toHaveBeenCalled();

        // Level 2 (punctuation): visible. Widen from 1→2.
        menu.setChoices.mockClear();
        session.update("play.", getPos);
        expect(menu.isActive()).toBe(true);
        expect(menu.setChoices).toHaveBeenCalledTimes(1);

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
        // Trie at level 0 has "epsilon", stripped prefix at level 0 = " ".
        // " " doesn't match "epsilon" → C3 fails.
        // D1: sepLevel(1) > menuSepLevel(0) → widen to level 1.
        // Level 1: no items for "none" mode. Empty trie.
        // D4: accept (closedSet=true).
        // Widen loaded empty trie at level 1 — exactly 1 setChoices.
        menu.setChoices.mockClear();
        session.update("play ", getPos);
        expect(menu.isActive()).toBe(false);
        expect(menu.setChoices).toHaveBeenCalledTimes(1);

        expect(dispatcher.getCommandCompletion).toHaveBeenCalledTimes(1);
    });
});

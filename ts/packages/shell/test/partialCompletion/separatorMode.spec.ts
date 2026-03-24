// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import {
    PartialCompletionSession,
    makeMenu,
    makeDispatcher,
    makeCompletionResult,
    getPos,
    anyPosition,
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

        // Input without trailing space: "play" — choices are loaded but menu is not shown
        session.update("play", getPos);
        await Promise.resolve();

        // setChoices IS called with actual items (trie is populated for later)
        expect(menu.setChoices).toHaveBeenCalledWith(
            expect.arrayContaining([
                expect.objectContaining({ selectedText: "music" }),
            ]),
        );
        // But updatePrefix is NOT called yet (menu not shown)
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
        const result = makeCompletionResult(["music"], 4, {
            separatorMode: undefined,
        });
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

    test("terminal punctuation-only suffix hides menu without re-fetch", async () => {
        // Regression: typing "?" at end of "what's on the shopping list?"
        // was treated as a spacePunctuation separator, stripping it to ""
        // and showing ALL completions as ghost text.
        const menu = makeMenu();
        const result = makeCompletionResult(["list"], 28, {
            separatorMode: "spacePunctuation",
        });
        const dispatcher = makeDispatcher(result);
        const session = new PartialCompletionSession(menu, dispatcher);

        // Anchor is established at "what's on the shopping list"
        session.update("what's on the shopping list", getPos);
        await Promise.resolve();

        // User types "?" — purely punctuation, no whitespace
        menu.updatePrefix.mockClear();
        menu.hide.mockClear();
        session.update("what's on the shopping list?", getPos);

        // Menu must be hidden, not shown with ghost completions
        expect(menu.hide).toHaveBeenCalled();
        expect(menu.updatePrefix).not.toHaveBeenCalled();
        // No re-fetch — session is kept alive
        expect(dispatcher.getCommandCompletion).toHaveBeenCalledTimes(1);
    });
});

// ── separatorMode: "optional" ─────────────────────────────────────────────────

describe("PartialCompletionSession — separatorMode: optional", () => {
    test("completions shown immediately without separator", async () => {
        const menu = makeMenu();
        const result = makeCompletionResult(["music"], 4, {
            separatorMode: "optional",
        });
        const dispatcher = makeDispatcher(result);
        const session = new PartialCompletionSession(menu, dispatcher);

        session.update("play", getPos);
        await Promise.resolve();

        // "optional" does not require a separator — menu shown immediately
        // rawPrefix="" → updatePrefix("", ...)
        expect(menu.updatePrefix).toHaveBeenCalledWith("", anyPosition);
    });

    test("typing after anchor filters within session", async () => {
        const menu = makeMenu();
        const result = makeCompletionResult(["music", "movie"], 4, {
            separatorMode: "optional",
        });
        const dispatcher = makeDispatcher(result);
        const session = new PartialCompletionSession(menu, dispatcher);

        session.update("play", getPos);
        await Promise.resolve();

        session.update("playmu", getPos);

        expect(menu.updatePrefix).toHaveBeenCalledWith("mu", anyPosition);
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

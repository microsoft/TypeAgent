// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import {
    PartialCompletionSession,
    makeMenu,
    makeDispatcher,
    makeCompletionResult,
    getPos,
} from "./helpers.js";

// ── direction-based completion ────────────────────────────────────────────────
//
// The direction parameter ("forward" or "backward") resolves structural
// ambiguity when the input is valid.  "forward" means the user is moving
// ahead; "backward" means they're reconsidering.  B4 (uniquely satisfied)
// always triggers a re-fetch regardless of direction.

describe("PartialCompletionSession — direction-based completion", () => {
    test("uniquely satisfied always triggers re-fetch", async () => {
        const menu = makeMenu();
        const result = makeCompletionResult(["song"], 4, {
            separatorMode: "space",
            closedSet: true,
        });
        const dispatcher = makeDispatcher(result);
        const session = new PartialCompletionSession(menu, dispatcher);

        session.update("play ", getPos);
        await Promise.resolve(); // → ACTIVE, anchor = "play"

        session.update("play song", getPos);

        // "song" uniquely matched — B4 fires immediately
        expect(dispatcher.getCommandCompletion).toHaveBeenCalledTimes(2);
        expect(dispatcher.getCommandCompletion).toHaveBeenLastCalledWith(
            "play song",
            "forward",
        );
    });

    test("direction parameter is forwarded to dispatcher", async () => {
        const menu = makeMenu();
        const result = makeCompletionResult(["song"], 4, {
            separatorMode: "space",
        });
        const dispatcher = makeDispatcher(result);
        const session = new PartialCompletionSession(menu, dispatcher);

        session.update("play ", getPos);

        expect(dispatcher.getCommandCompletion).toHaveBeenCalledWith(
            "play ",
            "forward",
        );
    });

    test("B5 committed-past-boundary still fires", async () => {
        const menu = makeMenu();
        const result = makeCompletionResult(["set", "setWindowState"], 4, {
            separatorMode: "space",
        });
        const dispatcher = makeDispatcher(result);
        const session = new PartialCompletionSession(menu, dispatcher);

        session.update("play ", getPos);
        await Promise.resolve();

        // "set " — contains separator after exact match → B5 fires
        session.update("play set ", getPos);

        expect(dispatcher.getCommandCompletion).toHaveBeenCalledTimes(2);
        expect(dispatcher.getCommandCompletion).toHaveBeenLastCalledWith(
            "play set ",
            "forward",
        );
    });

    test("open-set no-matches still triggers re-fetch (C6 unaffected)", async () => {
        const menu = makeMenu();
        const result = makeCompletionResult(["song"], 4, {
            separatorMode: "space",
            closedSet: false,
        });
        const dispatcher = makeDispatcher(result);
        const session = new PartialCompletionSession(menu, dispatcher);

        session.update("play ", getPos);
        await Promise.resolve();

        // "xyz" — no trie match, closedSet=false → C6 re-fetch
        session.update("play xyz", getPos);

        expect(dispatcher.getCommandCompletion).toHaveBeenCalledTimes(2);
    });

    test("backward direction is forwarded to dispatcher on new session", () => {
        const menu = makeMenu();
        const dispatcher = makeDispatcher();
        const session = new PartialCompletionSession(menu, dispatcher);

        session.update("play", getPos, "backward");

        expect(dispatcher.getCommandCompletion).toHaveBeenCalledWith(
            "play",
            "backward",
        );
    });

    test("backward direction is forwarded on re-fetch after unique match", async () => {
        const menu = makeMenu();
        const result = makeCompletionResult(["song"], 4, {
            separatorMode: "space",
            closedSet: true,
        });
        const dispatcher = makeDispatcher(result);
        const session = new PartialCompletionSession(menu, dispatcher);

        session.update("play ", getPos);
        await Promise.resolve(); // → ACTIVE, anchor = "play"

        // Uniquely satisfied → re-fetch; backward direction forwarded
        session.update("play song", getPos, "backward");

        expect(dispatcher.getCommandCompletion).toHaveBeenCalledTimes(2);
        expect(dispatcher.getCommandCompletion).toHaveBeenLastCalledWith(
            "play song",
            "backward",
        );
    });

    test("backward direction is forwarded on anchor-divergence re-fetch", async () => {
        const menu = makeMenu();
        const result = makeCompletionResult(["song"], 4, {
            separatorMode: "space",
        });
        const dispatcher = makeDispatcher(result);
        const session = new PartialCompletionSession(menu, dispatcher);

        session.update("play ", getPos);
        await Promise.resolve(); // → ACTIVE, anchor = "play"

        // Backspace past anchor — anchor diverged, triggers new session
        session.update("pla", getPos, "backward");

        expect(dispatcher.getCommandCompletion).toHaveBeenCalledTimes(2);
        expect(dispatcher.getCommandCompletion).toHaveBeenLastCalledWith(
            "pla",
            "backward",
        );
    });

    test("backward on IDLE starts new session with backward", () => {
        const menu = makeMenu();
        const dispatcher = makeDispatcher();
        const session = new PartialCompletionSession(menu, dispatcher);

        session.update("play music", getPos, "backward");

        expect(dispatcher.getCommandCompletion).toHaveBeenCalledWith(
            "play music",
            "backward",
        );
    });

    test("default direction is forward when omitted", () => {
        const menu = makeMenu();
        const dispatcher = makeDispatcher();
        const session = new PartialCompletionSession(menu, dispatcher);

        session.update("play", getPos);

        expect(dispatcher.getCommandCompletion).toHaveBeenCalledWith(
            "play",
            "forward",
        );
    });

    test("direction change re-fetches when directionSensitive is true", async () => {
        const menu = makeMenu();
        // startIndex=5 so anchor = "play " (the full initial input).
        const result = makeCompletionResult(["song", "track"], 5, {
            separatorMode: "none",
            directionSensitive: true,
        });
        const dispatcher = makeDispatcher(result);
        const session = new PartialCompletionSession(menu, dispatcher);

        session.update("play ", getPos, "forward");
        await Promise.resolve(); // → ACTIVE, anchor = "play "

        // Same input, different direction, at exact anchor → re-fetch
        session.update("play ", getPos, "backward");

        expect(dispatcher.getCommandCompletion).toHaveBeenCalledTimes(2);
        expect(dispatcher.getCommandCompletion).toHaveBeenLastCalledWith(
            "play ",
            "backward",
        );
    });

    test("direction change reuses when past anchor boundary", async () => {
        const menu = makeMenu();
        // startIndex=4 so anchor = "play"; "play " extends past anchor.
        const result = makeCompletionResult(["song", "track"], 4, {
            separatorMode: "space",
            directionSensitive: true,
        });
        const dispatcher = makeDispatcher(result);
        const session = new PartialCompletionSession(menu, dispatcher);

        session.update("play ", getPos, "forward");
        await Promise.resolve(); // → ACTIVE, anchor = "play"

        // Different direction but input extends past anchor — the
        // direction-sensitive boundary has been passed; reuse.
        session.update("play ", getPos, "backward");

        expect(dispatcher.getCommandCompletion).toHaveBeenCalledTimes(1);
    });

    test("direction change reuses when directionSensitive is false", async () => {
        const menu = makeMenu();
        const result = makeCompletionResult(["song", "track"], 4, {
            separatorMode: "space",
            directionSensitive: false,
        });
        const dispatcher = makeDispatcher(result);
        const session = new PartialCompletionSession(menu, dispatcher);

        session.update("play ", getPos, "forward");
        await Promise.resolve(); // → ACTIVE

        // Same input, different direction, but not sensitive → reuse
        session.update("play ", getPos, "backward");

        expect(dispatcher.getCommandCompletion).toHaveBeenCalledTimes(1);
    });

    test("same direction reuses even when directionSensitive is true", async () => {
        const menu = makeMenu();
        const result = makeCompletionResult(["song", "track"], 4, {
            separatorMode: "space",
            directionSensitive: true,
        });
        const dispatcher = makeDispatcher(result);
        const session = new PartialCompletionSession(menu, dispatcher);

        session.update("play ", getPos, "forward");
        await Promise.resolve(); // → ACTIVE

        // Same direction → reuse, no re-fetch needed
        session.update("play ", getPos, "forward");

        expect(dispatcher.getCommandCompletion).toHaveBeenCalledTimes(1);
    });

    test("direction change with extended input reuses (past anchor boundary)", async () => {
        const menu = makeMenu();
        const result = makeCompletionResult(["song", "track"], 4, {
            separatorMode: "space",
            directionSensitive: true,
        });
        const dispatcher = makeDispatcher(result);
        const session = new PartialCompletionSession(menu, dispatcher);

        session.update("play ", getPos, "forward");
        await Promise.resolve(); // → ACTIVE, anchor = "play"

        // User typed further past the anchor, then changed direction.
        // The direction-sensitive boundary was at "play"; the user has
        // committed past it, so the loaded completions are still valid.
        session.update("play so", getPos, "backward");

        expect(dispatcher.getCommandCompletion).toHaveBeenCalledTimes(1);
    });
});

// ── committed-past-boundary (hasExactMatch) ───────────────────────────────────

describe("PartialCompletionSession — committed-past-boundary re-fetch", () => {
    test("closedSet=true: typing space after exact match triggers re-fetch", async () => {
        const menu = makeMenu();
        const result = makeCompletionResult(
            ["set", "setWindowState", "setWindowZoomLevel"],
            4,
            { separatorMode: "space", closedSet: true },
        );
        const dispatcher = makeDispatcher(result);
        const session = new PartialCompletionSession(menu, dispatcher);

        session.update("play ", getPos);
        await Promise.resolve(); // → ACTIVE, anchor = "play"

        // User types "set " — prefix is "set ", exact match "set" + separator
        session.update("play set ", getPos);

        expect(menu.hasExactMatch).toHaveBeenCalledWith("set");
        expect(dispatcher.getCommandCompletion).toHaveBeenCalledTimes(2);
        expect(dispatcher.getCommandCompletion).toHaveBeenLastCalledWith(
            "play set ",
            "forward",
        );
    });

    test("closedSet=true: typing multiple spaces after exact match triggers re-fetch", async () => {
        const menu = makeMenu();
        const result = makeCompletionResult(
            ["set", "setWindowState", "setWindowZoomLevel"],
            4,
            { separatorMode: "space", closedSet: true },
        );
        const dispatcher = makeDispatcher(result);
        const session = new PartialCompletionSession(menu, dispatcher);

        session.update("play ", getPos);
        await Promise.resolve();

        // Double space after "set"
        session.update("play set  ", getPos);

        expect(dispatcher.getCommandCompletion).toHaveBeenCalledTimes(2);
    });

    test("closedSet=true: typing punctuation after exact match triggers re-fetch", async () => {
        const menu = makeMenu();
        const result = makeCompletionResult(
            ["set", "setWindowState", "setWindowZoomLevel"],
            4,
            { separatorMode: "space", closedSet: true },
        );
        const dispatcher = makeDispatcher(result);
        const session = new PartialCompletionSession(menu, dispatcher);

        session.update("play ", getPos);
        await Promise.resolve();

        // Punctuation after "set"
        session.update("play set.", getPos);

        expect(menu.hasExactMatch).toHaveBeenCalledWith("set");
        expect(dispatcher.getCommandCompletion).toHaveBeenCalledTimes(2);
    });

    test("closedSet=true: typing separator after non-matching text does NOT re-fetch", async () => {
        const menu = makeMenu();
        const result = makeCompletionResult(
            ["set", "setWindowState", "setWindowZoomLevel"],
            4,
            { separatorMode: "space", closedSet: true },
        );
        const dispatcher = makeDispatcher(result);
        const session = new PartialCompletionSession(menu, dispatcher);

        session.update("play ", getPos);
        await Promise.resolve();

        // "xyz" is not a known completion — closedSet=true should suppress re-fetch
        session.update("play xyz ", getPos);

        expect(menu.hasExactMatch).toHaveBeenCalledWith("xyz");
        expect(dispatcher.getCommandCompletion).toHaveBeenCalledTimes(1);
    });
});

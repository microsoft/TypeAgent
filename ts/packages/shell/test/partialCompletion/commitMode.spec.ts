// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import {
    PartialCompletionSession,
    makeMenu,
    makeDispatcher,
    makeCompletionResult,
    getPos,
} from "./helpers.js";

// ── commitMode ────────────────────────────────────────────────────────────────

describe("PartialCompletionSession — commitMode", () => {
    test("commitMode=explicit (default): uniquely satisfied does NOT re-fetch", async () => {
        const menu = makeMenu();
        // Default commitMode (omitted → "explicit")
        const result = makeCompletionResult(["song"], 4, {
            separatorMode: "space",
            closedSet: true,
        });
        const dispatcher = makeDispatcher(result);
        const session = new PartialCompletionSession(menu, dispatcher);

        session.update("play ", getPos);
        await Promise.resolve(); // → ACTIVE, anchor = "play"

        session.update("play song", getPos);

        // "song" uniquely matched, but commitMode="explicit" — B4 suppressed
        expect(dispatcher.getCommandCompletion).toHaveBeenCalledTimes(1);
    });

    test("commitMode=explicit: uniquely satisfied + trailing space triggers re-fetch via B5", async () => {
        const menu = makeMenu();
        const result = makeCompletionResult(["song"], 4, {
            separatorMode: "space",
            closedSet: true,
        });
        const dispatcher = makeDispatcher(result);
        const session = new PartialCompletionSession(menu, dispatcher);

        session.update("play ", getPos);
        await Promise.resolve(); // → ACTIVE, anchor = "play"

        // First: "play song" — uniquely satisfied but suppressed (no trailing space)
        session.update("play song", getPos);
        expect(dispatcher.getCommandCompletion).toHaveBeenCalledTimes(1);

        // Second: "play song " — user typed space → B5 fires (committed past boundary)
        session.update("play song ", getPos);
        expect(dispatcher.getCommandCompletion).toHaveBeenCalledTimes(2);
        expect(dispatcher.getCommandCompletion).toHaveBeenLastCalledWith(
            "play song ",
        );
    });

    test("commitMode=eager: uniquely satisfied triggers immediate re-fetch", async () => {
        const menu = makeMenu();
        const result = makeCompletionResult(["song"], 4, {
            separatorMode: "space",
            commitMode: "eager",
        });
        const dispatcher = makeDispatcher(result);
        const session = new PartialCompletionSession(menu, dispatcher);

        session.update("play ", getPos);
        await Promise.resolve(); // → ACTIVE, anchor = "play"

        session.update("play song", getPos);

        // commitMode="eager" — B4 fires immediately
        expect(dispatcher.getCommandCompletion).toHaveBeenCalledTimes(2);
        expect(dispatcher.getCommandCompletion).toHaveBeenLastCalledWith(
            "play song",
        );
    });

    test("commitMode=explicit: B5 committed-past-boundary still fires", async () => {
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
        );
    });

    test("commitMode=explicit: open-set no-matches still triggers re-fetch (C6 unaffected)", async () => {
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

    test("commitMode defaults to explicit when omitted from result", async () => {
        const menu = makeMenu();
        // No commitMode in result — defaults to "explicit"
        const result = makeCompletionResult(["song"], 4, {
            separatorMode: "space",
            closedSet: true,
        });
        const dispatcher = makeDispatcher(result);
        const session = new PartialCompletionSession(menu, dispatcher);

        session.update("play ", getPos);
        await Promise.resolve();

        session.update("play song", getPos);

        // Default commitMode="explicit" — B4 suppressed
        expect(dispatcher.getCommandCompletion).toHaveBeenCalledTimes(1);
    });

    test("commitMode=explicit + closedSet=false: uniquely satisfied does NOT re-fetch", async () => {
        const menu = makeMenu();
        const result = makeCompletionResult(["song"], 4, {
            separatorMode: "space",
            closedSet: false,
        });
        const dispatcher = makeDispatcher(result);
        const session = new PartialCompletionSession(menu, dispatcher);

        session.update("play ", getPos);
        await Promise.resolve();

        // "song" uniquely matches — commitMode="explicit" must suppress re-fetch
        // even though closedSet=false (closedSet describes THIS level, not next)
        session.update("play song", getPos);
        expect(dispatcher.getCommandCompletion).toHaveBeenCalledTimes(1);

        // Only after typing a separator should B5 trigger a re-fetch
        session.update("play song ", getPos);
        expect(dispatcher.getCommandCompletion).toHaveBeenCalledTimes(2);
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

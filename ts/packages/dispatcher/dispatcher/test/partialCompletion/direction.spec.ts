// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { jest } from "@jest/globals";
import {
    ICompletionDispatcher,
    CommandCompletionResult,
    makeSession,
    makeDispatcher,
    makeCompletionResult,
} from "./helpers.js";

// ── direction-based completion ────────────────────────────────────────────────
//
// The direction parameter ("forward" or "backward") resolves structural
// ambiguity when the input is valid.  "forward" means the user is moving
// ahead; "backward" means they're reconsidering.  B4 (uniquely satisfied)
// always triggers a re-fetch regardless of direction.

describe("PartialCompletionSession — direction-based completion", () => {
    test("uniquely satisfied always triggers re-fetch", async () => {
        const result = makeCompletionResult(["song"], 4, {
            separatorMode: "space",
            closedSet: true,
        });
        const dispatcher = makeDispatcher(result);
        const { session } = makeSession(dispatcher);

        session.update("play ");
        await Promise.resolve(); // → ACTIVE, anchor = "play"

        session.update("play song");

        // "song" uniquely matched — B4 fires immediately
        expect(dispatcher.getCommandCompletion).toHaveBeenCalledTimes(2);
        expect(dispatcher.getCommandCompletion).toHaveBeenLastCalledWith(
            "play song",
            "forward",
        );
    });

    test("direction parameter is forwarded to dispatcher", async () => {
        const result = makeCompletionResult(["song"], 4, {
            separatorMode: "space",
        });
        const dispatcher = makeDispatcher(result);
        const { session } = makeSession(dispatcher);

        session.update("play ");

        expect(dispatcher.getCommandCompletion).toHaveBeenCalledWith(
            "play ",
            "forward",
        );
    });

    test("B5 committed-past-boundary still fires", async () => {
        const result = makeCompletionResult(["set", "setWindowState"], 4, {
            separatorMode: "space",
        });
        const dispatcher = makeDispatcher(result);
        const { session } = makeSession(dispatcher);

        session.update("play ");
        await Promise.resolve();

        // "set " — contains separator after exact match → B5 fires
        session.update("play set ");

        expect(dispatcher.getCommandCompletion).toHaveBeenCalledTimes(2);
        expect(dispatcher.getCommandCompletion).toHaveBeenLastCalledWith(
            "play set ",
            "forward",
        );
    });

    test("open-set no-matches still triggers re-fetch (C6 unaffected)", async () => {
        const result = makeCompletionResult(["song"], 4, {
            separatorMode: "space",
            closedSet: false,
        });
        const dispatcher = makeDispatcher(result);
        const { session } = makeSession(dispatcher);

        session.update("play ");
        await Promise.resolve();

        // "xyz" — no trie match, closedSet=false → C6 re-fetch
        session.update("play xyz");

        expect(dispatcher.getCommandCompletion).toHaveBeenCalledTimes(2);
    });

    test("backward direction is forwarded to dispatcher on new session", () => {
        const dispatcher = makeDispatcher();
        const { session } = makeSession(dispatcher);

        session.update("play", "backward");

        expect(dispatcher.getCommandCompletion).toHaveBeenCalledWith(
            "play",
            "backward",
        );
    });

    test("backward direction is forwarded on re-fetch after unique match", async () => {
        const result = makeCompletionResult(["song"], 4, {
            separatorMode: "space",
            closedSet: true,
        });
        const dispatcher = makeDispatcher(result);
        const { session } = makeSession(dispatcher);

        session.update("play ");
        await Promise.resolve(); // → ACTIVE, anchor = "play"

        // Uniquely satisfied → re-fetch; backward direction forwarded
        session.update("play song", "backward");

        expect(dispatcher.getCommandCompletion).toHaveBeenCalledTimes(2);
        expect(dispatcher.getCommandCompletion).toHaveBeenLastCalledWith(
            "play song",
            "backward",
        );
    });

    test("backward direction is forwarded on anchor-divergence re-fetch", async () => {
        const result = makeCompletionResult(["song"], 4, {
            separatorMode: "space",
        });
        const dispatcher = makeDispatcher(result);
        const { session } = makeSession(dispatcher);

        session.update("play ");
        await Promise.resolve(); // → ACTIVE, anchor = "play"

        // Backspace past anchor — anchor diverged, triggers new session
        session.update("pla", "backward");

        expect(dispatcher.getCommandCompletion).toHaveBeenCalledTimes(2);
        expect(dispatcher.getCommandCompletion).toHaveBeenLastCalledWith(
            "pla",
            "backward",
        );
    });

    test("backward on IDLE starts new session with backward", () => {
        const dispatcher = makeDispatcher();
        const { session } = makeSession(dispatcher);

        session.update("play music", "backward");

        expect(dispatcher.getCommandCompletion).toHaveBeenCalledWith(
            "play music",
            "backward",
        );
    });

    test("default direction is forward when omitted", () => {
        const dispatcher = makeDispatcher();
        const { session } = makeSession(dispatcher);

        session.update("play");

        expect(dispatcher.getCommandCompletion).toHaveBeenCalledWith(
            "play",
            "forward",
        );
    });

    test("direction change re-fetches when directionSensitive is true", async () => {
        // startIndex=5 so anchor = "play " (the full initial input).
        const result = makeCompletionResult(["song", "track"], 5, {
            separatorMode: "none",
            directionSensitive: true,
        });
        const dispatcher = makeDispatcher(result);
        const { session } = makeSession(dispatcher);

        session.update("play ", "forward");
        await Promise.resolve(); // → ACTIVE, anchor = "play "

        // Same input, different direction, at exact anchor → re-fetch
        session.update("play ", "backward");

        expect(dispatcher.getCommandCompletion).toHaveBeenCalledTimes(2);
        expect(dispatcher.getCommandCompletion).toHaveBeenLastCalledWith(
            "play ",
            "backward",
        );
    });

    test("direction change reuses when past anchor boundary", async () => {
        // startIndex=4 so anchor = "play"; "play " extends past anchor.
        const result = makeCompletionResult(["song", "track"], 4, {
            separatorMode: "space",
            directionSensitive: true,
        });
        const dispatcher = makeDispatcher(result);
        const { session } = makeSession(dispatcher);

        session.update("play ", "forward");
        await Promise.resolve(); // → ACTIVE, anchor = "play"

        // Different direction but input extends past anchor — the
        // direction-sensitive boundary has been passed; reuse.
        session.update("play ", "backward");

        expect(dispatcher.getCommandCompletion).toHaveBeenCalledTimes(1);
    });

    test("direction change reuses when directionSensitive is false", async () => {
        const result = makeCompletionResult(["song", "track"], 4, {
            separatorMode: "space",
            directionSensitive: false,
        });
        const dispatcher = makeDispatcher(result);
        const { session } = makeSession(dispatcher);

        session.update("play ", "forward");
        await Promise.resolve(); // → ACTIVE

        // Same input, different direction, but not sensitive → reuse
        session.update("play ", "backward");

        expect(dispatcher.getCommandCompletion).toHaveBeenCalledTimes(1);
    });

    test("same direction reuses even when directionSensitive is true", async () => {
        const result = makeCompletionResult(["song", "track"], 4, {
            separatorMode: "space",
            directionSensitive: true,
        });
        const dispatcher = makeDispatcher(result);
        const { session } = makeSession(dispatcher);

        session.update("play ", "forward");
        await Promise.resolve(); // → ACTIVE

        // Same direction → reuse, no re-fetch needed
        session.update("play ", "forward");

        expect(dispatcher.getCommandCompletion).toHaveBeenCalledTimes(1);
    });

    test("direction change with extended input reuses (past anchor boundary)", async () => {
        const result = makeCompletionResult(["song", "track"], 4, {
            separatorMode: "space",
            directionSensitive: true,
        });
        const dispatcher = makeDispatcher(result);
        const { session } = makeSession(dispatcher);

        session.update("play ", "forward");
        await Promise.resolve(); // → ACTIVE, anchor = "play"

        // User typed further past the anchor, then changed direction.
        // The direction-sensitive boundary was at "play"; the user has
        // committed past it, so the loaded completions are still valid.
        session.update("play so", "backward");

        expect(dispatcher.getCommandCompletion).toHaveBeenCalledTimes(1);
    });
});

// ── committed-past-boundary (hasExactMatch) ───────────────────────────────────

describe("PartialCompletionSession — committed-past-boundary re-fetch", () => {
    test("closedSet=true: typing space after exact match triggers re-fetch", async () => {
        const result = makeCompletionResult(
            ["set", "setWindowState", "setWindowZoomLevel"],
            4,
            { separatorMode: "space", closedSet: true },
        );
        const dispatcher = makeDispatcher(result);
        const { session } = makeSession(dispatcher);

        session.update("play ");
        await Promise.resolve(); // → ACTIVE, anchor = "play"

        // User types "set " — prefix is "set ", exact match "set" + separator
        session.update("play set ");

        expect(dispatcher.getCommandCompletion).toHaveBeenCalledTimes(2);
        expect(dispatcher.getCommandCompletion).toHaveBeenLastCalledWith(
            "play set ",
            "forward",
        );
    });

    test("closedSet=true: typing multiple spaces after exact match triggers re-fetch", async () => {
        const result = makeCompletionResult(
            ["set", "setWindowState", "setWindowZoomLevel"],
            4,
            { separatorMode: "space", closedSet: true },
        );
        const dispatcher = makeDispatcher(result);
        const { session } = makeSession(dispatcher);

        session.update("play ");
        await Promise.resolve();

        // Double space after "set"
        session.update("play set  ");

        expect(dispatcher.getCommandCompletion).toHaveBeenCalledTimes(2);
    });

    test("closedSet=true: typing punctuation after exact match triggers re-fetch", async () => {
        const result = makeCompletionResult(
            ["set", "setWindowState", "setWindowZoomLevel"],
            4,
            { separatorMode: "space", closedSet: true },
        );
        const dispatcher = makeDispatcher(result);
        const { session } = makeSession(dispatcher);

        session.update("play ");
        await Promise.resolve();

        // Punctuation after "set"
        session.update("play set.");

        expect(dispatcher.getCommandCompletion).toHaveBeenCalledTimes(2);
    });

    test("closedSet=true: typing separator after non-matching text does NOT re-fetch", async () => {
        const result = makeCompletionResult(
            ["set", "setWindowState", "setWindowZoomLevel"],
            4,
            { separatorMode: "space", closedSet: true },
        );
        const dispatcher = makeDispatcher(result);
        const { session } = makeSession(dispatcher);

        session.update("play ");
        await Promise.resolve();

        // "xyz" is not a known completion — closedSet=true should suppress re-fetch
        session.update("play xyz ");

        expect(dispatcher.getCommandCompletion).toHaveBeenCalledTimes(1);
    });
});

// ── direction change while PENDING ────────────────────────────────────────────

describe("PartialCompletionSession — direction change while PENDING", () => {
    test("direction change while PENDING is suppressed (no re-fetch)", () => {
        // Never-resolving promise keeps session in PENDING
        const dispatcher: ICompletionDispatcher = {
            getCommandCompletion: jest
                .fn<ICompletionDispatcher["getCommandCompletion"]>()
                .mockReturnValue(new Promise(() => {})),
        };
        const { session } = makeSession(dispatcher);

        session.update("play", "forward");
        // Still PENDING — second update with different direction is suppressed
        session.update("play", "backward");

        expect(dispatcher.getCommandCompletion).toHaveBeenCalledTimes(1);
    });

    test("stale resolution after direction change is ignored", async () => {
        let resolveFn!: (v: CommandCompletionResult) => void;
        const pending = new Promise<CommandCompletionResult>(
            (resolve) => (resolveFn = resolve),
        );
        const forwardResult = makeCompletionResult(["song"], 4, {
            directionSensitive: true,
        });
        const backwardResult = makeCompletionResult(["play"], 0, {
            directionSensitive: true,
        });
        const dispatcher: ICompletionDispatcher = {
            getCommandCompletion: jest
                .fn<ICompletionDispatcher["getCommandCompletion"]>()
                .mockReturnValueOnce(pending)
                .mockResolvedValue(backwardResult),
        };
        const { session } = makeSession(dispatcher);

        // First update starts PENDING
        session.update("play", "forward");

        // Resolve stale promise (forward result)
        resolveFn(forwardResult);
        await Promise.resolve();

        // Session processed the result — anchor is now "play"
        // Now change direction — if at exact anchor + directionSensitive, re-fetch
        session.update("play", "backward");

        // Depending on A7: session was established with forwardResult,
        // direction changes at exact anchor with directionSensitive=true → re-fetch
        expect(dispatcher.getCommandCompletion).toHaveBeenCalledTimes(2);
        expect(dispatcher.getCommandCompletion).toHaveBeenLastCalledWith(
            "play",
            "backward",
        );
    });

    test("hide during PENDING then diverged input with new direction triggers new session", async () => {
        let resolveFn!: (v: CommandCompletionResult) => void;
        const pending = new Promise<CommandCompletionResult>(
            (resolve) => (resolveFn = resolve),
        );
        const dispatcher: ICompletionDispatcher = {
            getCommandCompletion: jest
                .fn<ICompletionDispatcher["getCommandCompletion"]>()
                .mockReturnValueOnce(pending)
                .mockResolvedValue(makeCompletionResult(["song"], 4)),
        };
        const { session } = makeSession(dispatcher);

        session.update("play", "forward");

        // Hide cancels the in-flight fetch
        session.hide();

        // Resolve the now-stale promise
        resolveFn(makeCompletionResult(["song"], 4));
        await Promise.resolve();

        // Diverged input with backward — anchor was "play", "stop"
        // does not match → triggers a new session
        session.update("stop", "backward");

        expect(dispatcher.getCommandCompletion).toHaveBeenCalledTimes(2);
        expect(dispatcher.getCommandCompletion).toHaveBeenLastCalledWith(
            "stop",
            "backward",
        );
    });
});

// ── direction detection edge cases ────────────────────────────────────────────
//
// These tests exercise direction sequences that match the detection logic
// in partial.ts:
//   direction = input.length < previousInput.length &&
//               previousInput.startsWith(input) ? "backward" : "forward"
//
// They verify the session handles all edge cases correctly:
// - true backspace (strict prefix, shorter)
// - replacement (same length but different content → forward)
// - non-prefix change (different text → forward)

describe("PartialCompletionSession — direction detection patterns", () => {
    test("backspace produces backward direction: 'play' → 'pla'", async () => {
        const result1 = makeCompletionResult(["song"], 4, {
            directionSensitive: true,
        });
        const result2 = makeCompletionResult(["play"], 0);
        const dispatcher: ICompletionDispatcher = {
            getCommandCompletion: jest
                .fn<ICompletionDispatcher["getCommandCompletion"]>()
                .mockResolvedValueOnce(result1)
                .mockResolvedValue(result2),
        };
        const { session } = makeSession(dispatcher);

        session.update("play", "forward");
        await Promise.resolve();

        // "pla" is a strict prefix of "play" and shorter → backward
        session.update("pla", "backward");

        expect(dispatcher.getCommandCompletion).toHaveBeenCalledTimes(2);
        expect(dispatcher.getCommandCompletion).toHaveBeenLastCalledWith(
            "pla",
            "backward",
        );
    });

    test("replacement is forward: 'abc' → 'abd' (same length, different content)", async () => {
        const dispatcher = makeDispatcher();
        const { session } = makeSession(dispatcher);

        // "abc" starts a new session
        session.update("abc", "forward");
        await Promise.resolve(); // → ACTIVE, anchor = "abc"

        // "abd" is not shorter than "abc" → forward by partial.ts logic.
        // But "abd" doesn't start with anchor "abc" → diverged → re-fetch.
        session.update("abd", "forward");

        expect(dispatcher.getCommandCompletion).toHaveBeenCalledTimes(2);
        expect(dispatcher.getCommandCompletion).toHaveBeenLastCalledWith(
            "abd",
            "forward",
        );
    });

    test("non-prefix change is forward: 'hello' → 'world'", async () => {
        const dispatcher: ICompletionDispatcher = {
            getCommandCompletion: jest
                .fn<ICompletionDispatcher["getCommandCompletion"]>()
                .mockResolvedValueOnce(makeCompletionResult(["next"], 5))
                .mockResolvedValue(makeCompletionResult(["next"], 5)),
        };
        const { session } = makeSession(dispatcher);

        session.update("hello", "forward");
        await Promise.resolve();

        // "world" is not a prefix continuation of "hello" → forward
        session.update("world", "forward");

        expect(dispatcher.getCommandCompletion).toHaveBeenCalledTimes(2);
        expect(dispatcher.getCommandCompletion).toHaveBeenLastCalledWith(
            "world",
            "forward",
        );
    });

    test("empty to non-empty is forward", () => {
        const dispatcher = makeDispatcher();
        const { session } = makeSession(dispatcher);

        session.update("", "forward");
        session.update("p", "forward");

        // Both calls should be forward
        expect(dispatcher.getCommandCompletion).toHaveBeenCalledTimes(1);
        // First call fetches for ""
        expect(dispatcher.getCommandCompletion).toHaveBeenCalledWith(
            "",
            "forward",
        );
    });

    test("non-empty to empty is backward", async () => {
        const result = makeCompletionResult(["song"], 4, {
            directionSensitive: true,
        });
        const dispatcher: ICompletionDispatcher = {
            getCommandCompletion: jest
                .fn<ICompletionDispatcher["getCommandCompletion"]>()
                .mockResolvedValueOnce(result)
                .mockResolvedValue(makeCompletionResult(["play"], 0)),
        };
        const { session } = makeSession(dispatcher);

        session.update("play", "forward");
        await Promise.resolve();

        // Clearing input (all backspace) → "" is prefix of "play" and shorter
        session.update("", "backward");

        expect(dispatcher.getCommandCompletion).toHaveBeenCalledTimes(2);
        expect(dispatcher.getCommandCompletion).toHaveBeenLastCalledWith(
            "",
            "backward",
        );
    });
});

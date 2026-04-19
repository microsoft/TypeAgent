// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { jest } from "@jest/globals";
import {
    ICompletionDispatcher,
    makeSession,
    makeDispatcher,
    makeCompletionResult,
    isActive,
} from "./helpers.js";

// ── getCompletionState — prefix field ─────────────────────────────────────────

describe("PartialCompletionSession — getCompletionState prefix", () => {
    test("returns undefined when session is IDLE", () => {
        const { session } = makeSession(makeDispatcher());
        expect(session.getCompletionState()).toBeUndefined();
    });

    test("returns prefix from completion state", async () => {
        const result = makeCompletionResult(["song", "sonata"], 4);
        const { session } = makeSession(makeDispatcher(result));

        session.update("play son");
        await Promise.resolve();

        expect(session.getCompletionState()?.prefix).toBe("son");
    });

    test("returns undefined when input diverges from anchor", async () => {
        const result = makeCompletionResult(["song"], 4);
        const { session } = makeSession(makeDispatcher(result));

        session.update("play song");
        await Promise.resolve();

        // Diverge — "stop" doesn't start with anchor "play", triggers re-fetch.
        // During the fetch the trie is empty, so completions are unavailable.
        session.update("stop");
        expect(session.getCompletionState()).toBeUndefined();
    });

    test("separatorMode: returns stripped prefix when separator is present", async () => {
        const result = makeCompletionResult(["music"], 4, {
            separatorMode: "space",
        });
        const { session } = makeSession(makeDispatcher(result));

        session.update("play");
        await Promise.resolve();

        // Advance state by calling update with the separator-bearing input.
        // This triggers progressive consumption (space consumed, L1 loaded).
        session.update("play mu");

        // After consumption: menuAnchorIndex past the space, prefix = "mu".
        expect(session.getCompletionState()?.prefix).toBe("mu");
    });

    test("separatorMode: returns undefined when separator is absent", async () => {
        const result = makeCompletionResult(["music"], 4, {
            separatorMode: "space",
        });
        const { session } = makeSession(makeDispatcher(result));

        session.update("play");
        await Promise.resolve();

        // No separator yet — state is undefined (deferred)
        expect(session.getCompletionState()).toBeUndefined();
    });
});

// ── accept ────────────────────────────────────────────────────────────────────

describe("PartialCompletionSession — accept", () => {
    test("clears session so next update re-fetches", async () => {
        const dispatcher = makeDispatcher(makeCompletionResult(["song"], 4));
        const { session } = makeSession(dispatcher);

        session.update("play song");
        await Promise.resolve(); // → ACTIVE

        session.accept();

        // After accept, next update should fetch fresh completions
        session.update("play song");
        expect(dispatcher.getCommandCompletion).toHaveBeenCalledTimes(2);
    });

    test("fires onUpdate when completions were visible", async () => {
        const dispatcher = makeDispatcher(
            makeCompletionResult(["song", "sonata"], 4, {
                separatorMode: "optionalSpace",
            }),
        );
        const { session, onUpdate } = makeSession(dispatcher);

        session.update("play son");
        await Promise.resolve();

        // Completions are visible (not uniquely satisfied).
        expect(session.getCompletionState()).toBeDefined();
        onUpdate.mockClear();
        session.accept();

        // accept() transitions from defined → undefined, so onUpdate fires.
        expect(onUpdate).toHaveBeenCalled();
    });

    test("skips onUpdate when completions were already hidden", async () => {
        const dispatcher = makeDispatcher(makeCompletionResult(["song"], 4));
        const { session, onUpdate } = makeSession(dispatcher);

        session.update("play song");
        await Promise.resolve();

        // "song" uniquely satisfied → completionState already undefined.
        expect(session.getCompletionState()).toBeUndefined();
        onUpdate.mockClear();
        session.accept();

        expect(onUpdate).not.toHaveBeenCalled();
    });
});

// ── @-command routing ─────────────────────────────────────────────────────────

describe("PartialCompletionSession — @command routing", () => {
    test("@ command with trailing space fetches full input", () => {
        const dispatcher = makeDispatcher();
        const { session } = makeSession(dispatcher);

        session.update("@config ");

        expect(dispatcher.getCommandCompletion).toHaveBeenCalledWith(
            "@config ",
            "forward",
        );
    });

    test("@ command with partial word fetches full input (backend filters)", () => {
        const dispatcher = makeDispatcher();
        const { session } = makeSession(dispatcher);

        session.update("@config c");

        // Backend receives full input and returns completions with the
        // correct startIndex; no word-boundary truncation needed.
        expect(dispatcher.getCommandCompletion).toHaveBeenCalledWith(
            "@config c",
            "forward",
        );
    });

    test("@ command with no space fetches full input", () => {
        const dispatcher = makeDispatcher();
        const { session } = makeSession(dispatcher);

        session.update("@config");

        expect(dispatcher.getCommandCompletion).toHaveBeenCalledWith(
            "@config",
            "forward",
        );
    });

    test("@ command in PENDING state does not re-fetch", () => {
        const dispatcher: ICompletionDispatcher = {
            getCommandCompletion: jest
                .fn<ICompletionDispatcher["getCommandCompletion"]>()
                .mockReturnValue(new Promise(() => {})),
        };
        const { session } = makeSession(dispatcher);

        session.update("@config ");
        session.update("@config c"); // same anchor: "@config " — PENDING reuse

        expect(dispatcher.getCommandCompletion).toHaveBeenCalledTimes(1);
    });

    test("@ command: separatorMode defers menu until space typed", async () => {
        // Backend returns subcommands with separatorMode: "space"
        // (anchor = "@config", subcommands follow after a space)
        const result = makeCompletionResult(["clear", "theme"], 7, {
            separatorMode: "space",
        });
        const dispatcher = makeDispatcher(result);
        const { session } = makeSession(dispatcher);

        // User types "@config" → completions loaded, deferred (no separator yet)
        session.update("@config");
        await Promise.resolve();

        // Items pre-loaded at lowest non-empty level (L1) but hidden
        // until separator is consumed.
        expect(isActive(session)).toBe(false);

        // User types space → separator present, consumption advances to L1.
        session.update("@config ");

        expect(isActive(session)).toBe(true);
        expect(session.getCompletionState()?.prefix).toBe("");
        // No re-fetch — same session handles both states
        expect(dispatcher.getCommandCompletion).toHaveBeenCalledTimes(1);
    });

    test("@ command: typing after space filters within same session", async () => {
        // Backend: separatorMode, anchor = "@config"
        const result = makeCompletionResult(["clear", "theme"], 7, {
            separatorMode: "space",
        });
        const dispatcher = makeDispatcher(result);
        const { session } = makeSession(dispatcher);

        session.update("@config");
        await Promise.resolve();

        // Type space + partial subcommand
        session.update("@config cl");

        expect(session.getCompletionState()?.prefix).toBe("cl");
        expect(dispatcher.getCommandCompletion).toHaveBeenCalledTimes(1);
    });

    test("@ command: empty result (closedSet=true) suppresses re-fetch", async () => {
        const dispatcher = makeDispatcher();
        const { session } = makeSession(dispatcher);

        session.update("@unknown");
        await Promise.resolve(); // → empty completions, closedSet=true

        // Still within anchor — no re-fetch
        session.update("@unknownmore");

        expect(dispatcher.getCommandCompletion).toHaveBeenCalledTimes(1);
    });

    test("@ command: backspace past anchor after empty result triggers re-fetch", async () => {
        const dispatcher = makeDispatcher();
        const { session } = makeSession(dispatcher);

        session.update("@unknown");
        await Promise.resolve(); // → empty completions with current="@unknown"

        // Backspace past anchor
        session.update("@unknow");

        expect(dispatcher.getCommandCompletion).toHaveBeenCalledTimes(2);
        expect(dispatcher.getCommandCompletion).toHaveBeenLastCalledWith(
            "@unknow",
            "forward",
        );
    });
});

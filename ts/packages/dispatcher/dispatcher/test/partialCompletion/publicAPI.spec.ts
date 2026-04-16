// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { jest } from "@jest/globals";
import {
    ICompletionDispatcher,
    makeSession,
    makeDispatcher,
    makeCompletionResult,
} from "./helpers.js";

// ── getCompletionPrefix ───────────────────────────────────────────────────────

describe("PartialCompletionSession — getCompletionPrefix", () => {
    test("returns undefined when session is IDLE", () => {
        const { session } = makeSession(makeDispatcher());
        expect(session.getCompletionPrefix("anything")).toBeUndefined();
    });

    test("returns suffix after anchor when input starts with anchor", async () => {
        const result = makeCompletionResult(["song"], 4);
        const { session } = makeSession(makeDispatcher(result));

        session.update("play song");
        await Promise.resolve();

        expect(session.getCompletionPrefix("play song")).toBe("song");
    });

    test("returns undefined when input diverges from anchor", async () => {
        const result = makeCompletionResult(["song"], 4);
        const { session } = makeSession(makeDispatcher(result));

        session.update("play song");
        await Promise.resolve();

        // Input no longer starts with anchor "play"
        expect(session.getCompletionPrefix("stop")).toBeUndefined();
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
        expect(session.getCompletionPrefix("play mu")).toBe("mu");
    });

    test("separatorMode: returns undefined when separator is absent", async () => {
        const result = makeCompletionResult(["music"], 4, {
            separatorMode: "space",
        });
        const { session } = makeSession(makeDispatcher(result));

        session.update("play");
        await Promise.resolve();

        // No separator yet — undefined means no replacement should happen
        expect(session.getCompletionPrefix("play")).toBeUndefined();
    });
});

// ── resetToIdle ───────────────────────────────────────────────────────────────

describe("PartialCompletionSession — resetToIdle", () => {
    test("clears session so next update re-fetches", async () => {
        const dispatcher = makeDispatcher(makeCompletionResult(["song"], 4));
        const { session } = makeSession(dispatcher);

        session.update("play song");
        await Promise.resolve(); // → ACTIVE

        session.resetToIdle();

        // After reset, next update should fetch fresh completions
        session.update("play song");
        expect(dispatcher.getCommandCompletion).toHaveBeenCalledTimes(2);
    });

    test("does not hide the menu (caller is responsible for that)", async () => {
        const dispatcher = makeDispatcher(makeCompletionResult(["song"], 4));
        const { session, menu } = makeSession(dispatcher);

        session.update("play song");
        await Promise.resolve();

        menu.hide.mockClear();
        session.resetToIdle();

        expect(menu.hide).not.toHaveBeenCalled();
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
        const { session, menu } = makeSession(dispatcher);

        // User types "@config" → completions loaded, deferred (no separator yet)
        session.update("@config");
        await Promise.resolve();

        // Items pre-loaded at lowest non-empty level (L1) but hidden
        // until separator is consumed.
        expect(menu.isActive()).toBe(false);
        expect(menu.updatePrefix).not.toHaveBeenCalled();

        // User types space → separator present, consumption advances to L1.
        session.update("@config ");

        expect(menu.isActive()).toBe(true);
        expect(menu.updatePrefix).toHaveBeenCalledWith("");
        // No re-fetch — same session handles both states
        expect(dispatcher.getCommandCompletion).toHaveBeenCalledTimes(1);
    });

    test("@ command: typing after space filters within same session", async () => {
        // Backend: separatorMode, anchor = "@config"
        const result = makeCompletionResult(["clear", "theme"], 7, {
            separatorMode: "space",
        });
        const dispatcher = makeDispatcher(result);
        const { session, menu } = makeSession(dispatcher);

        session.update("@config");
        await Promise.resolve();

        // Type space + partial subcommand
        session.update("@config cl");

        expect(menu.updatePrefix).toHaveBeenCalledWith("cl");
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

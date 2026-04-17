// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { jest } from "@jest/globals";
import {
    ICompletionDispatcher,
    CommandCompletionResult,
    MockDispatcher,
    makeSession,
    makeDispatcher,
    makeCompletionResult,
    isActive,
    getItemTexts,
} from "./helpers.js";

// ── Type-ahead: user types faster than the backend responds ──────────────────

describe("PartialCompletionSession — type-ahead during pending fetch", () => {
    // Helper: create a dispatcher whose first call returns a deferred
    // promise (manually resolvable), and optionally a second result.
    function makeDeferredDispatcher(): {
        dispatcher: ICompletionDispatcher;
        mock: jest.MockedFunction<
            ICompletionDispatcher["getCommandCompletion"]
        >;
        resolve1: (result: CommandCompletionResult) => void;
        reject1: (error: Error) => void;
    } {
        let resolve1!: (result: CommandCompletionResult) => void;
        let reject1!: (error: Error) => void;
        const p1 = new Promise<CommandCompletionResult>((res, rej) => {
            resolve1 = res;
            reject1 = rej;
        });
        const mock = jest
            .fn<ICompletionDispatcher["getCommandCompletion"]>()
            .mockReturnValueOnce(p1);
        return {
            dispatcher: { getCommandCompletion: mock },
            mock,
            resolve1,
            reject1,
        };
    }

    test("extending prefix: completions shown for latest input, single onUpdate", async () => {
        // Backend returns completions for "p": ["play", "pause", "playlist"]
        const result = makeCompletionResult(["pause", "play", "playlist"], 0, {
            separatorMode: "none",
        });
        const { dispatcher, mock, resolve1 } = makeDeferredDispatcher();
        const { session, onUpdate } = makeSession(dispatcher);

        // User types "p" → starts fetch
        session.update("p");
        expect(mock).toHaveBeenCalledTimes(1);
        expect(mock).toHaveBeenCalledWith("p", "forward");

        // User types "play" while fetch is pending → reuse (A1 PENDING)
        session.update("play");
        expect(mock).toHaveBeenCalledTimes(1); // no new fetch

        // Clear onUpdate calls from the pending-state notifications
        onUpdate.mockClear();

        // Fetch resolves — should evaluate against "play" (lastInput), not "p"
        resolve1(result);
        await Promise.resolve(); // flush microtask

        // Completions should be filtered for "play", not "p"
        expect(isActive(session)).toBe(true);
        const items = getItemTexts(session);
        expect(items).toContain("play");
        expect(items).toContain("playlist");
        expect(items).not.toContain("pause"); // "pause" doesn't match prefix "play"
        expect(session.getCompletionState()?.prefix).toBe("play");
    });

    test("diverged input: stale result triggers new fetch for current input", async () => {
        const result1 = makeCompletionResult(["play", "pause"], 0, {
            separatorMode: "none",
        });
        const result2 = makeCompletionResult(["email", "embed"], 0, {
            separatorMode: "none",
        });
        const { dispatcher, mock, resolve1 } = makeDeferredDispatcher();
        // Set up the second call to return result2
        mock.mockResolvedValueOnce(result2);
        const { session } = makeSession(dispatcher);

        // User types "play" → starts fetch
        session.update("play");
        expect(mock).toHaveBeenCalledTimes(1);

        // User backspaces and types "em" — still pending (A1)
        session.update("em");
        expect(mock).toHaveBeenCalledTimes(1);

        // First fetch resolves with "play" results
        resolve1(result1);
        await Promise.resolve(); // flush microtask

        // Session should detect divergence and start new fetch for "em"
        expect(mock).toHaveBeenCalledTimes(2);
        expect(mock).toHaveBeenLastCalledWith("em", "forward");

        // Resolve second fetch
        await Promise.resolve();

        // Now completions should be for "em"
        expect(isActive(session)).toBe(true);
        expect(getItemTexts(session)).toEqual(
            expect.arrayContaining(["email", "embed"]),
        );
        expect(session.getCompletionState()?.prefix).toBe("em");
    });

    test("type-ahead during fetch error: new fetch for current input", async () => {
        const result2 = makeCompletionResult(["stop", "store"], 0, {
            separatorMode: "none",
        });
        const { dispatcher, mock, reject1 } = makeDeferredDispatcher();
        mock.mockResolvedValueOnce(result2);
        const { session } = makeSession(dispatcher);

        // User types "play" → starts fetch
        session.update("play");
        expect(mock).toHaveBeenCalledTimes(1);

        // User types "stop" while fetch is pending
        session.update("stop");
        expect(mock).toHaveBeenCalledTimes(1);

        // First fetch fails
        reject1(new Error("network error"));
        await Promise.resolve(); // flush microtask
        await Promise.resolve(); // flush catch handler

        // Should start new fetch for "stop"
        expect(mock).toHaveBeenCalledTimes(2);
        expect(mock).toHaveBeenLastCalledWith("stop", "forward");
    });

    test("fetch error with unchanged input: no retry", async () => {
        const { dispatcher, mock, reject1 } = makeDeferredDispatcher();
        const { session } = makeSession(dispatcher);

        // User types "play" → starts fetch
        session.update("play");
        expect(mock).toHaveBeenCalledTimes(1);

        // No type-ahead — input stays "play"

        // Fetch fails
        reject1(new Error("network error"));
        await Promise.resolve();
        await Promise.resolve();

        // Should NOT retry — avoids infinite retry loop
        expect(mock).toHaveBeenCalledTimes(1);
    });

    test("fetch error with type-ahead: re-fetch resolves and shows completions", async () => {
        // Full round-trip: error → reconcile → new fetch → completions shown.
        const result2 = makeCompletionResult(["stop", "store"], 0, {
            separatorMode: "none",
        });
        const { dispatcher, mock, reject1 } = makeDeferredDispatcher();
        mock.mockResolvedValueOnce(result2);
        const { session } = makeSession(dispatcher);

        // User types "play" → starts fetch
        session.update("play");
        expect(mock).toHaveBeenCalledTimes(1);

        // User types "sto" while fetch is pending
        session.update("sto");

        // First fetch fails
        reject1(new Error("network error"));
        await Promise.resolve(); // flush microtask
        await Promise.resolve(); // flush catch handler

        // reconcileTypeAhead should detect diverged input and re-fetch
        expect(mock).toHaveBeenCalledTimes(2);
        expect(mock).toHaveBeenLastCalledWith("sto", "forward");

        // Second fetch resolves
        await Promise.resolve();

        // Completions for "sto" should now be active
        expect(isActive(session)).toBe(true);
        const items = getItemTexts(session);
        expect(items).toContain("stop");
        expect(items).toContain("store");
        expect(session.getCompletionState()?.prefix).toBe("sto");
    });

    test("empty result with type-ahead: new fetch for current input", async () => {
        // Backend returns empty completions for "xyz"
        const emptyResult: CommandCompletionResult = {
            startIndex: 0,
            completions: [],
            closedSet: true,
            directionSensitive: false,
            afterWildcard: "none",
        };
        // Second result: startIndex=4 so anchor="play", prefix=""
        const result2 = makeCompletionResult(["song", "sonata"], 4, {
            separatorMode: "none",
        });
        const { dispatcher, mock, resolve1 } = makeDeferredDispatcher();
        mock.mockResolvedValueOnce(result2);
        const { session } = makeSession(dispatcher);

        // User types "xyz" → starts fetch
        session.update("xyz");
        expect(mock).toHaveBeenCalledTimes(1);

        // User changes to "play" while pending
        session.update("play");

        // First fetch resolves with empty result
        resolve1(emptyResult);
        await Promise.resolve();

        // Should start new fetch for "play"
        expect(mock).toHaveBeenCalledTimes(2);
        expect(mock).toHaveBeenLastCalledWith("play", "forward");

        // Resolve second fetch (.then microtask)
        await Promise.resolve();
        expect(isActive(session)).toBe(true);
        expect(getItemTexts(session)).toEqual(
            expect.arrayContaining(["song", "sonata"]),
        );
    });

    test("direction tracked: latest direction used after type-ahead", async () => {
        const result = makeCompletionResult(["play", "pause"], 0, {
            separatorMode: "none",
            directionSensitive: true,
        });
        const result2 = makeCompletionResult(["back", "backward"], 0, {
            separatorMode: "none",
        });
        const { dispatcher, mock, resolve1 } = makeDeferredDispatcher();
        mock.mockResolvedValueOnce(result2);
        const { session } = makeSession(dispatcher);

        // User types "play" forward → starts fetch
        session.update("play", "forward");
        expect(mock).toHaveBeenCalledTimes(1);

        // User backspaces to "b" (backward direction)
        session.update("b", "backward");

        // First fetch resolves — input diverged
        resolve1(result);
        await Promise.resolve();

        // New fetch should use "backward" direction
        expect(mock).toHaveBeenCalledTimes(2);
        expect(mock).toHaveBeenLastCalledWith("b", "backward");
    });

    test("no type-ahead: completions shown normally (no re-fetch)", async () => {
        const result = makeCompletionResult(["play", "pause", "playlist"], 0, {
            separatorMode: "none",
        });
        const { dispatcher, mock, resolve1 } = makeDeferredDispatcher();
        const { session } = makeSession(dispatcher);

        // User types "p" → starts fetch
        session.update("p");
        expect(mock).toHaveBeenCalledTimes(1);

        // No further typing — fetch resolves
        resolve1(result);
        await Promise.resolve();

        // Completions shown for "p", no extra fetch
        expect(mock).toHaveBeenCalledTimes(1);
        expect(isActive(session)).toBe(true);
        expect(session.getCompletionState()?.prefix).toBe("p");
        expect(getItemTexts(session)).toEqual(
            expect.arrayContaining(["play", "pause", "playlist"]),
        );
    });

    test("explicitClose suppression still works when input unchanged", async () => {
        // Scenario: user types past anchor, dismisses → refetch returns
        // same anchor → suppress reopen (user already dismissed these).
        const result = makeCompletionResult(["song", "sonata"], 5, {
            separatorMode: "none",
        });
        const dispatcher = makeDispatcher(result);
        const { session } = makeSession(dispatcher);

        // Initial session: "play " → anchor="play ", items at L0
        session.update("play ");
        await Promise.resolve();
        expect(isActive(session)).toBe(true);

        // User types further to filter
        session.update("play so");
        expect(isActive(session)).toBe(true);

        // User dismisses at "play so" — input ≠ anchor → refetch
        session.dismiss("play so", "forward");
        await Promise.resolve();

        // Refetch returns startIndex=5 → anchor="play " = explicitCloseAnchor
        // Input unchanged → suppression activates → menu stays hidden
        expect(isActive(session)).toBe(false);
    });

    test("explicitClose with type-ahead: does not suppress reopen", async () => {
        // Scenario: user dismisses at "play so", types further during refetch.
        // Even though the refetch returns the same anchor, the user typed
        // ahead so suppression should NOT activate.
        const result = makeCompletionResult(["song", "sonata"], 5, {
            separatorMode: "none",
        });
        const dispatcher = makeDispatcher(result);
        const { session } = makeSession(dispatcher);

        // Initial session: "play " → anchor="play ", items at L0
        session.update("play ");
        await Promise.resolve();
        expect(isActive(session)).toBe(true);

        // User types further
        session.update("play so");

        // Create deferred for the dismiss-refetch
        let resolve2!: (result: CommandCompletionResult) => void;
        const p2 = new Promise<CommandCompletionResult>((res) => {
            resolve2 = res;
        });
        (dispatcher as MockDispatcher).getCommandCompletion.mockReturnValueOnce(
            p2,
        );

        // User dismisses at "play so" — starts refetch
        session.dismiss("play so", "forward");

        // User types "play son" while refetch is pending
        session.update("play son");

        // Refetch resolves with same anchor (startIndex=5 → anchor="play ")
        resolve2(result);
        await Promise.resolve();

        // Suppression bypassed because lastInput="play son" ≠ input="play so".
        // reuseSession evaluates "play son" against the trie → active.
        expect(isActive(session)).toBe(true);
        expect(session.getCompletionState()?.prefix).toBe("son");
    });
});

// ── No extraneous re-fetches during type-ahead ───────────────────────────────

describe("PartialCompletionSession — type-ahead fetch count", () => {
    // Helper: deferred dispatcher with controllable resolve/reject.
    function makeDeferredDispatcher(): {
        dispatcher: ICompletionDispatcher;
        mock: jest.MockedFunction<
            ICompletionDispatcher["getCommandCompletion"]
        >;
        resolve: (result: CommandCompletionResult) => void;
        reject: (error: Error) => void;
    } {
        let resolve!: (result: CommandCompletionResult) => void;
        let reject!: (error: Error) => void;
        const p = new Promise<CommandCompletionResult>((res, rej) => {
            resolve = res;
            reject = rej;
        });
        const mock = jest
            .fn<ICompletionDispatcher["getCommandCompletion"]>()
            .mockReturnValueOnce(p);
        return {
            dispatcher: { getCommandCompletion: mock },
            mock,
            resolve,
            reject,
        };
    }

    test("rapid keystrokes within prefix: exactly 1 fetch", async () => {
        // "p" → "pl" → "pla" → "play" — all during one pending fetch.
        const result = makeCompletionResult(["pause", "play", "playlist"], 0, {
            separatorMode: "none",
        });
        const { dispatcher, mock, resolve } = makeDeferredDispatcher();
        const { session } = makeSession(dispatcher);

        session.update("p");
        session.update("pl");
        session.update("pla");
        session.update("play");
        expect(mock).toHaveBeenCalledTimes(1);

        resolve(result);
        await Promise.resolve();

        // Trie covers "play" — no extra fetch needed.
        expect(mock).toHaveBeenCalledTimes(1);
        expect(isActive(session)).toBe(true);
        expect(session.getCompletionState()?.prefix).toBe("play");
    });

    test("type-ahead past separator: exactly 1 fetch when trie covers it", async () => {
        // Fetch for "play" returns anchor="play", items with separatorMode "space".
        // User types "play so" during fetch — separator + prefix "so".
        const result = makeCompletionResult(["song", "sonata"], 4, {
            separatorMode: "space",
        });
        const { dispatcher, mock, resolve } = makeDeferredDispatcher();
        const { session } = makeSession(dispatcher);

        session.update("play");
        session.update("play ");
        session.update("play s");
        session.update("play so");
        expect(mock).toHaveBeenCalledTimes(1);

        resolve(result);
        await Promise.resolve();

        // Progressive consumption handles the space, trie matches "so".
        expect(mock).toHaveBeenCalledTimes(1);
        expect(isActive(session)).toBe(true);
        expect(session.getCompletionState()?.prefix).toBe("so");
    });

    test("type-ahead with backspace within anchor: exactly 1 fetch", async () => {
        // "play" → fetch → user backspaces to "pla" (still within anchor "p").
        const result = makeCompletionResult(["pause", "play", "playlist"], 0, {
            separatorMode: "none",
        });
        const { dispatcher, mock, resolve } = makeDeferredDispatcher();
        const { session } = makeSession(dispatcher);

        session.update("play");
        session.update("pla"); // backspace, still starts with anchor
        expect(mock).toHaveBeenCalledTimes(1);

        resolve(result);
        await Promise.resolve();

        // "pla" is within anchor "p" — trie handles it, no re-fetch.
        expect(mock).toHaveBeenCalledTimes(1);
        expect(isActive(session)).toBe(true);
    });

    test("diverged then returned: exactly 2 fetches", async () => {
        // "play" → fetch → "em" (diverged) → resolve → re-fetch for "em".
        // No third fetch after the second resolves.
        const result1 = makeCompletionResult(["play"], 0, {
            separatorMode: "none",
        });
        const result2 = makeCompletionResult(["email", "embed"], 0, {
            separatorMode: "none",
        });
        const { dispatcher, mock, resolve } = makeDeferredDispatcher();
        mock.mockResolvedValueOnce(result2);
        const { session } = makeSession(dispatcher);

        session.update("play");
        session.update("em"); // diverge
        expect(mock).toHaveBeenCalledTimes(1);

        resolve(result1);
        await Promise.resolve(); // first .then → reconcile → startNewSession("em")
        expect(mock).toHaveBeenCalledTimes(2);

        await Promise.resolve(); // second .then
        // No third fetch — "em" result services current input.
        expect(mock).toHaveBeenCalledTimes(2);
        expect(isActive(session)).toBe(true);
    });

    test("multiple keystrokes during pending, all within trie: exactly 1 fetch", async () => {
        // Fetch returns many items; user types several chars — all matched.
        const result = makeCompletionResult(
            ["apple", "application", "apply", "apricot"],
            0,
            { separatorMode: "none" },
        );
        const { dispatcher, mock, resolve } = makeDeferredDispatcher();
        const { session } = makeSession(dispatcher);

        session.update("a");
        session.update("ap");
        session.update("app");
        session.update("appl");

        resolve(result);
        await Promise.resolve();

        expect(mock).toHaveBeenCalledTimes(1);
        expect(isActive(session)).toBe(true);
        expect(session.getCompletionState()?.prefix).toBe("appl");
        const items = getItemTexts(session);
        expect(items).toContain("apple");
        expect(items).toContain("application");
        expect(items).toContain("apply");
        expect(items).not.toContain("apricot");
    });

    test("uniquely satisfied during type-ahead: exactly 2 fetches", async () => {
        // Fetch for "p" returns ["play"]. User types "play" during fetch.
        // After resolve, "play" uniquely satisfies → reconcile → re-fetch.
        const result1 = makeCompletionResult(["play"], 0, {
            separatorMode: "none",
            closedSet: true,
            afterWildcard: "none",
        });
        const result2 = makeCompletionResult(["song", "sonata"], 4, {
            separatorMode: "none",
        });
        const { dispatcher, mock, resolve } = makeDeferredDispatcher();
        mock.mockResolvedValueOnce(result2);
        const { session } = makeSession(dispatcher);

        session.update("p");
        session.update("play");
        expect(mock).toHaveBeenCalledTimes(1);

        resolve(result1);
        await Promise.resolve();

        // "play" uniquely satisfied in trie → reuseSession returns false
        // → reconcile detects input changed ("play" ≠ "p") → startNewSession
        expect(mock).toHaveBeenCalledTimes(2);
        expect(mock).toHaveBeenLastCalledWith("play", "forward");

        await Promise.resolve();
        // No third fetch.
        expect(mock).toHaveBeenCalledTimes(2);
    });

    test("empty result, unchanged input: exactly 1 fetch (no retry)", async () => {
        const emptyResult: CommandCompletionResult = {
            startIndex: 0,
            completions: [],
            closedSet: true,
            directionSensitive: false,
            afterWildcard: "none",
        };
        const { dispatcher, mock, resolve } = makeDeferredDispatcher();
        const { session } = makeSession(dispatcher);

        session.update("xyz");
        // No type-ahead
        resolve(emptyResult);
        await Promise.resolve();

        // Empty result, same input — no retry.
        expect(mock).toHaveBeenCalledTimes(1);
        expect(isActive(session)).toBe(false);
    });

    test("error then unchanged input: exactly 1 fetch (no retry)", async () => {
        const { dispatcher, mock, reject } = makeDeferredDispatcher();
        const { session } = makeSession(dispatcher);

        session.update("xyz");
        reject(new Error("fail"));
        await Promise.resolve();
        await Promise.resolve();

        expect(mock).toHaveBeenCalledTimes(1);
    });

    test("error then diverged input: exactly 2 fetches", async () => {
        const result2 = makeCompletionResult(["email"], 0, {
            separatorMode: "none",
        });
        const { dispatcher, mock, reject } = makeDeferredDispatcher();
        mock.mockResolvedValueOnce(result2);
        const { session } = makeSession(dispatcher);

        session.update("xyz");
        session.update("em");
        reject(new Error("fail"));
        await Promise.resolve();
        await Promise.resolve();

        expect(mock).toHaveBeenCalledTimes(2);
        expect(mock).toHaveBeenLastCalledWith("em", "forward");

        await Promise.resolve();
        // No third fetch.
        expect(mock).toHaveBeenCalledTimes(2);
    });

    test("continued typing after fetch resolves: no unnecessary re-fetch", async () => {
        // Fetch resolves, user keeps typing within the trie.
        const result = makeCompletionResult(["song", "sonata", "sonic"], 4, {
            separatorMode: "space",
        });
        const { dispatcher, mock, resolve } = makeDeferredDispatcher();
        const { session } = makeSession(dispatcher);

        session.update("play");
        resolve(result);
        await Promise.resolve();
        expect(mock).toHaveBeenCalledTimes(1);

        // Continue typing — all within trie via progressive consumption.
        session.update("play ");
        expect(mock).toHaveBeenCalledTimes(1);
        session.update("play s");
        expect(mock).toHaveBeenCalledTimes(1);
        session.update("play so");
        expect(mock).toHaveBeenCalledTimes(1);

        expect(isActive(session)).toBe(true);
        expect(session.getCompletionState()?.prefix).toBe("so");
    });
});

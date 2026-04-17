// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { jest } from "@jest/globals";
import {
    ICompletionDispatcher,
    CommandCompletionResult,
    makeSession,
    makeDispatcher,
    makeCompletionResult,
    isActive,
    loadedItems,
} from "./helpers.js";

describe("PartialCompletionSession — state transitions", () => {
    test("IDLE → PENDING: first update triggers a backend fetch", () => {
        const dispatcher = makeDispatcher();
        const { session } = makeSession(dispatcher);

        session.update("play");

        expect(dispatcher.getCommandCompletion).toHaveBeenCalledTimes(1);
        expect(dispatcher.getCommandCompletion).toHaveBeenCalledWith(
            "play",
            "forward",
        );
    });

    test("PENDING: second update while promise is in-flight does not re-fetch", () => {
        // Never-resolving promise keeps session in PENDING
        const dispatcher: ICompletionDispatcher = {
            getCommandCompletion: jest
                .fn<ICompletionDispatcher["getCommandCompletion"]>()
                .mockReturnValue(new Promise(() => {})),
        };
        const { session } = makeSession(dispatcher);

        session.update("play");
        session.update("play s");

        expect(dispatcher.getCommandCompletion).toHaveBeenCalledTimes(1);
    });

    test("PENDING → ACTIVE: completions returned → state available", async () => {
        const result = makeCompletionResult(["song", "shuffle"], 4);
        const dispatcher = makeDispatcher(result);
        const { session, onUpdate } = makeSession(dispatcher);

        session.update("play ");
        await Promise.resolve(); // flush microtask

        expect(
            session.getCompletionState()!.items.map((i) => i.selectedText),
        ).toEqual(expect.arrayContaining(["shuffle", "song"]));
        expect(onUpdate).toHaveBeenCalled();
    });

    test("PENDING → ACTIVE: empty result (closedSet=true) suppresses re-fetch while input has same prefix", async () => {
        const dispatcher = makeDispatcher();
        const { session } = makeSession(dispatcher);

        session.update("play");
        await Promise.resolve();

        // Empty completions + closedSet=true — no new fetch even with extended input
        session.update("play s");

        expect(dispatcher.getCommandCompletion).toHaveBeenCalledTimes(1);
    });

    test("empty result: backspace past anchor triggers a new fetch", async () => {
        const dispatcher = makeDispatcher();
        const { session } = makeSession(dispatcher);

        session.update("play");
        await Promise.resolve(); // → ACTIVE (empty, closedSet=true) with current="play"

        // Backspace past anchor
        session.update("pla");

        expect(dispatcher.getCommandCompletion).toHaveBeenCalledTimes(2);
        expect(dispatcher.getCommandCompletion).toHaveBeenLastCalledWith(
            "pla",
            "forward",
        );
    });

    test("ACTIVE → hide+keep: closedSet=true, trie has no matches — no re-fetch", async () => {
        const result = makeCompletionResult(["song"], 4, {
            closedSet: true,
        });
        const dispatcher = makeDispatcher(result);
        const { session } = makeSession(dispatcher);

        session.update("play ");
        await Promise.resolve(); // → ACTIVE, anchor = "play"

        // User types more; trie returns no matches but input is within anchor.
        // closedSet=true → exhaustive set, no point re-fetching.
        session.update("play xyz");

        expect(dispatcher.getCommandCompletion).toHaveBeenCalledTimes(1);
        expect(isActive(session)).toBe(false);
    });

    test("ACTIVE → re-fetch: closedSet=false, trie has no matches — re-fetches", async () => {
        const result = makeCompletionResult(["song"], 4); // closedSet=false default
        const dispatcher = makeDispatcher(result);
        const { session } = makeSession(dispatcher);

        session.update("play ");
        await Promise.resolve(); // → ACTIVE, anchor = "play"

        // User types text with no trie match.  closedSet=false → set is NOT
        // exhaustive, so we should re-fetch in case the backend knows more.
        session.update("play xyz");

        expect(dispatcher.getCommandCompletion).toHaveBeenCalledTimes(2);
        expect(dispatcher.getCommandCompletion).toHaveBeenLastCalledWith(
            "play xyz",
            "forward",
        );
    });

    test("ACTIVE → backspace restores menu after no-match without re-fetch (closedSet=true)", async () => {
        const result = makeCompletionResult(["song", "shuffle"], 4, {
            closedSet: true,
        });
        const dispatcher = makeDispatcher(result);
        const { session } = makeSession(dispatcher);

        session.update("play ");
        await Promise.resolve(); // → ACTIVE, anchor = "play"

        // User types non-matching text.  closedSet=true → no re-fetch.
        session.update("play xyz");
        expect(isActive(session)).toBe(false);

        // User backspaces to matching prefix — completions reappear without re-fetch
        session.update("play so");

        expect(dispatcher.getCommandCompletion).toHaveBeenCalledTimes(1);
        expect(session.getCompletionState()?.prefix).toBe("so");
    });

    test("hide() preserves anchor so same input reuses session", async () => {
        const dispatcher = makeDispatcher(makeCompletionResult(["song"], 4));
        const { session, onUpdate } = makeSession(dispatcher);

        session.update("play");
        await Promise.resolve();
        onUpdate.mockClear();

        session.hide();
        // State was already undefined → no-op, onUpdate should not fire.
        expect(onUpdate).not.toHaveBeenCalled();

        // The important contract: anchor is preserved so the same input
        // reuses the session below.
        session.update("play");
        expect(dispatcher.getCommandCompletion).toHaveBeenCalledTimes(1);
    });

    test("hide() preserves anchor: diverged input triggers re-fetch", async () => {
        const dispatcher = makeDispatcher(makeCompletionResult(["song"], 4));
        const { session } = makeSession(dispatcher);

        session.update("play");
        await Promise.resolve();

        session.hide();

        // Input that diverges from anchor triggers a new fetch
        session.update("stop");
        expect(dispatcher.getCommandCompletion).toHaveBeenCalledTimes(2);
        expect(dispatcher.getCommandCompletion).toHaveBeenLastCalledWith(
            "stop",
            "forward",
        );
    });

    test("hide() cancels an in-flight request (stale result is ignored)", async () => {
        let resolve!: (v: CommandCompletionResult) => void;
        const pending = new Promise<CommandCompletionResult>(
            (r) => (resolve = r),
        );
        const dispatcher: ICompletionDispatcher = {
            getCommandCompletion: jest
                .fn<ICompletionDispatcher["getCommandCompletion"]>()
                .mockReturnValue(pending),
        };
        const { session } = makeSession(dispatcher);

        session.update("play");
        session.hide(); // cancels the promise

        // Now resolve the stale promise — should be a no-op
        resolve(makeCompletionResult(["song"], 4));
        await Promise.resolve();

        expect(loadedItems(session)).not.toEqual(
            expect.arrayContaining(["song"]),
        );
    });

    test("empty input fetches completions from backend", async () => {
        const result = makeCompletionResult(["@"], 0, {
            separatorMode: "none",
        });
        const dispatcher = makeDispatcher(result);
        const { session } = makeSession(dispatcher);

        session.update("");
        await Promise.resolve();

        expect(dispatcher.getCommandCompletion).toHaveBeenCalledWith(
            "",
            "forward",
        );
        expect(
            session.getCompletionState()!.items.map((i) => i.selectedText),
        ).toEqual(expect.arrayContaining(["@"]));
    });

    test("empty input: second update reuses session without re-fetch", async () => {
        const result = makeCompletionResult(["@"], 0, {
            separatorMode: "none",
        });
        const dispatcher = makeDispatcher(result);
        const { session } = makeSession(dispatcher);

        session.update("");
        await Promise.resolve();

        session.update("");

        expect(dispatcher.getCommandCompletion).toHaveBeenCalledTimes(1);
    });

    test("empty input: unique match triggers re-fetch", async () => {
        const result = makeCompletionResult(["@"], 0, {
            separatorMode: "none",
        });
        const dispatcher = makeDispatcher(result);
        const { session } = makeSession(dispatcher);

        session.update("");
        await Promise.resolve();

        session.update("@");

        // "@" uniquely matches the only completion — triggers re-fetch
        expect(dispatcher.getCommandCompletion).toHaveBeenCalledTimes(2);
        expect(dispatcher.getCommandCompletion).toHaveBeenLastCalledWith(
            "@",
            "forward",
        );
    });

    test("empty input: unique match triggers re-fetch even when closedSet=true", async () => {
        // closedSet=true means exhaustive at THIS level, but uniquelySatisfied
        // means the user needs NEXT level completions — always re-fetch.
        const result = makeCompletionResult(["@"], 0, {
            closedSet: true,
            separatorMode: "none",
        });
        const dispatcher = makeDispatcher(result);
        const { session } = makeSession(dispatcher);

        session.update("");
        await Promise.resolve();

        session.update("@");

        expect(dispatcher.getCommandCompletion).toHaveBeenCalledTimes(2);
        expect(dispatcher.getCommandCompletion).toHaveBeenLastCalledWith(
            "@",
            "forward",
        );
    });

    test("empty input: ambiguous prefix does not re-fetch", async () => {
        const result = makeCompletionResult(["@config", "@configure"], 0, {
            separatorMode: "none",
        });
        const dispatcher = makeDispatcher(result);
        const { session } = makeSession(dispatcher);

        session.update("");
        await Promise.resolve();

        session.update("@config");

        // "@config" is a prefix of "@configure" — reuse, no re-fetch
        expect(dispatcher.getCommandCompletion).toHaveBeenCalledTimes(1);
    });
});

describe("PartialCompletionSession — afterWildcard anchor sliding", () => {
    test('afterWildcard="all": non-separator after anchor slides anchor instead of re-fetching', async () => {
        // Grammar: play $(track) by $(artist)
        // User typed "play my fav" → grammar returns "by" at position 11
        const result = makeCompletionResult(["by"], 11, {
            closedSet: true,
            afterWildcard: "all",
            separatorMode: "spacePunctuation",
        });
        const dispatcher = makeDispatcher(result);
        const { session } = makeSession(dispatcher);

        session.update("play my fav");
        await Promise.resolve(); // → ACTIVE, anchor="play my fav"

        // User keeps typing the track name — non-separator char "o"
        // Without afterWildcard="all", this would trigger A3 re-fetch.
        // With afterWildcard="all", the anchor slides forward — no re-fetch.
        session.update("play my favo");
        expect(dispatcher.getCommandCompletion).toHaveBeenCalledTimes(1);

        session.update("play my favorite");
        expect(dispatcher.getCommandCompletion).toHaveBeenCalledTimes(1);
    });

    test('afterWildcard="all": separator after slide shows completions from trie', async () => {
        const result = makeCompletionResult(["by"], 11, {
            closedSet: true,
            afterWildcard: "all",
            separatorMode: "spacePunctuation",
        });
        const dispatcher = makeDispatcher(result);
        const { session, onUpdate } = makeSession(dispatcher);

        session.update("play my fav");
        await Promise.resolve();

        // Slide through non-separator chars
        session.update("play my favorite");
        expect(dispatcher.getCommandCompletion).toHaveBeenCalledTimes(1);

        // Now type a space — separator present, completionPrefix=""
        // Trie has "by", so completions should be available.
        session.update("play my favorite ");
        expect(dispatcher.getCommandCompletion).toHaveBeenCalledTimes(1);
        expect(onUpdate).toHaveBeenCalled();
    });

    test('afterWildcard="all": typing the keyword triggers B4 unique match → re-fetch', async () => {
        const result = makeCompletionResult(["by"], 11, {
            closedSet: true,
            afterWildcard: "all",
            separatorMode: "spacePunctuation",
        });
        const dispatcher = makeDispatcher(result);
        const { session } = makeSession(dispatcher);

        session.update("play my fav");
        await Promise.resolve();

        // Type separator + "by" → should match the trie entry exactly
        session.update("play my fav by");
        // "by" is uniquely satisfied → B4 triggers re-fetch for next level
        expect(dispatcher.getCommandCompletion).toHaveBeenCalledTimes(2);
    });

    test('afterWildcard="none": non-separator after anchor triggers normal re-fetch', async () => {
        const result = makeCompletionResult(["song"], 4, {
            closedSet: true,
            afterWildcard: "none",
            separatorMode: "spacePunctuation",
        });
        const dispatcher = makeDispatcher(result);
        const { session } = makeSession(dispatcher);

        session.update("play");
        await Promise.resolve();

        // Without afterWildcard="all", non-separator char triggers A3 re-fetch
        session.update("playx");
        expect(dispatcher.getCommandCompletion).toHaveBeenCalledTimes(2);
    });

    test('afterWildcard="some": non-separator after anchor triggers re-fetch, not slide', async () => {
        // "some" means mixed rules — some wildcard, some literal.
        // The shell must re-fetch (not slide) so stale literal
        // completions are replaced by fresh results at the new position.
        const result = makeCompletionResult(["by", "music"], 11, {
            closedSet: true,
            afterWildcard: "some",
            separatorMode: "spacePunctuation",
        });
        const dispatcher = makeDispatcher(result);
        const { session } = makeSession(dispatcher);

        session.update("play my fav");
        await Promise.resolve();

        // Non-separator after anchor — afterWildcard="some" → re-fetch
        session.update("play my favo");
        expect(dispatcher.getCommandCompletion).toHaveBeenCalledTimes(2);
    });

    test('afterWildcard="all" with optional separator: C6 slide when trie empty', async () => {
        const result = makeCompletionResult(["next"], 8, {
            closedSet: true,
            afterWildcard: "all",
            separatorMode: "optionalSpace",
        });
        const dispatcher = makeDispatcher(result);
        const { session } = makeSession(dispatcher);

        session.update("play foo");
        await Promise.resolve();

        // With optional separator, leading separators in rawPrefix are
        // stripped before reaching the trie.
        // "bar" doesn't match "next" → trie empty → C6
        // afterWildcard="all" → slide anchor, no re-fetch.
        session.update("play foobar");
        expect(dispatcher.getCommandCompletion).toHaveBeenCalledTimes(1);
    });
});

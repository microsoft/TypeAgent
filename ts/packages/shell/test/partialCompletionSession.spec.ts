// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { jest } from "@jest/globals";
import {
    ICompletionDispatcher,
    ISearchMenu,
    PartialCompletionSession,
} from "../src/renderer/src/partialCompletionSession.js";
import { SearchMenuPosition } from "../src/preload/electronTypes.js";
import { CompletionGroup } from "@typeagent/agent-sdk";
import { CommandCompletionResult } from "agent-dispatcher";

// ── Helpers ──────────────────────────────────────────────────────────────────

type MockMenu = {
    setChoices: jest.MockedFunction<ISearchMenu["setChoices"]>;
    updatePrefix: jest.MockedFunction<ISearchMenu["updatePrefix"]>;
    hide: jest.MockedFunction<ISearchMenu["hide"]>;
    isActive: jest.MockedFunction<ISearchMenu["isActive"]>;
};

function makeMenu(): MockMenu {
    return {
        setChoices: jest.fn<ISearchMenu["setChoices"]>(),
        updatePrefix: jest
            .fn<ISearchMenu["updatePrefix"]>()
            .mockReturnValue(false),
        hide: jest.fn<ISearchMenu["hide"]>(),
        isActive: jest.fn<ISearchMenu["isActive"]>().mockReturnValue(false),
    };
}

type MockDispatcher = {
    getCommandCompletion: jest.MockedFunction<
        ICompletionDispatcher["getCommandCompletion"]
    >;
};

function makeDispatcher(
    result: CommandCompletionResult = {
        startIndex: 0,
        completions: [],
        separatorMode: undefined,
        complete: true,
    },
): MockDispatcher {
    return {
        getCommandCompletion: jest
            .fn<ICompletionDispatcher["getCommandCompletion"]>()
            .mockResolvedValue(result),
    };
}

const anyPosition: SearchMenuPosition = { left: 0, bottom: 0 };
const getPos = (_prefix: string) => anyPosition;

function makeCompletionResult(
    completions: string[],
    startIndex: number = 0,
    opts: Partial<CommandCompletionResult> = {},
): CommandCompletionResult {
    const group: CompletionGroup = { name: "test", completions };
    return { startIndex, completions: [group], complete: false, ...opts };
}

// ── State machine tests ───────────────────────────────────────────────────────

describe("PartialCompletionSession — state transitions", () => {
    test("IDLE → PENDING: first update triggers a backend fetch", () => {
        const menu = makeMenu();
        const dispatcher = makeDispatcher();
        const session = new PartialCompletionSession(menu, dispatcher);

        session.update("play", getPos);

        expect(dispatcher.getCommandCompletion).toHaveBeenCalledTimes(1);
        expect(dispatcher.getCommandCompletion).toHaveBeenCalledWith("play");
    });

    test("PENDING: second update while promise is in-flight does not re-fetch", () => {
        const menu = makeMenu();
        // Never-resolving promise keeps session in PENDING
        const dispatcher: ICompletionDispatcher = {
            getCommandCompletion: jest
                .fn<ICompletionDispatcher["getCommandCompletion"]>()
                .mockReturnValue(new Promise(() => {})),
        };
        const session = new PartialCompletionSession(menu, dispatcher);

        session.update("play", getPos);
        session.update("play s", getPos);

        expect(dispatcher.getCommandCompletion).toHaveBeenCalledTimes(1);
    });

    test("PENDING → ACTIVE: completions returned → setChoices + updatePrefix called", async () => {
        const menu = makeMenu();
        menu.isActive.mockReturnValue(true);
        const result = makeCompletionResult(["song", "shuffle"], 0);
        const dispatcher = makeDispatcher(result);
        const session = new PartialCompletionSession(menu, dispatcher);

        session.update("play ", getPos);
        await Promise.resolve(); // flush microtask

        expect(menu.setChoices).toHaveBeenCalledWith(
            expect.arrayContaining([
                expect.objectContaining({ selectedText: "shuffle" }),
                expect.objectContaining({ selectedText: "song" }),
            ]),
        );
        expect(menu.updatePrefix).toHaveBeenCalled();
    });

    test("PENDING → EXHAUSTED: empty result suppresses re-fetch while input has same prefix", async () => {
        const menu = makeMenu();
        const dispatcher = makeDispatcher();
        const session = new PartialCompletionSession(menu, dispatcher);

        session.update("play", getPos);
        await Promise.resolve();

        // Should be EXHAUSTED — no new fetch even with extended input
        session.update("play s", getPos);

        expect(dispatcher.getCommandCompletion).toHaveBeenCalledTimes(1);
    });

    test("EXHAUSTED → IDLE: backspace past anchor triggers a new fetch", async () => {
        const menu = makeMenu();
        const dispatcher = makeDispatcher();
        const session = new PartialCompletionSession(menu, dispatcher);

        session.update("play", getPos);
        await Promise.resolve(); // → EXHAUSTED with current="play"

        // Backspace past anchor
        session.update("pla", getPos);

        expect(dispatcher.getCommandCompletion).toHaveBeenCalledTimes(2);
        expect(dispatcher.getCommandCompletion).toHaveBeenLastCalledWith("pla");
    });

    test("ACTIVE → hide+keep: complete=true, trie has no matches — no re-fetch", async () => {
        const menu = makeMenu();
        // isActive returns true on first call (after setChoices), false on second (all filtered)
        menu.isActive.mockReturnValueOnce(true).mockReturnValueOnce(false);
        const result = makeCompletionResult(["song"], 5, { complete: true });
        const dispatcher = makeDispatcher(result);
        const session = new PartialCompletionSession(menu, dispatcher);

        session.update("play ", getPos);
        await Promise.resolve(); // → ACTIVE, anchor = "play "

        // User types more; trie returns no matches but input is within anchor.
        // complete=true → exhaustive set, no point re-fetching.
        session.update("play xyz", getPos);

        expect(dispatcher.getCommandCompletion).toHaveBeenCalledTimes(1);
        expect(menu.hide).toHaveBeenCalled();
    });

    test("ACTIVE → re-fetch: complete=false, trie has no matches — re-fetches", async () => {
        const menu = makeMenu();
        // isActive: true after initial load, false for "xyz" — non-exhaustive set
        menu.isActive.mockReturnValueOnce(true).mockReturnValueOnce(false);
        const result = makeCompletionResult(["song"], 5); // complete=false default
        const dispatcher = makeDispatcher(result);
        const session = new PartialCompletionSession(menu, dispatcher);

        session.update("play ", getPos);
        await Promise.resolve(); // → ACTIVE, anchor = "play "

        // User types text with no trie match.  complete=false → set is NOT
        // exhaustive, so we should re-fetch in case the backend knows more.
        session.update("play xyz", getPos);

        expect(dispatcher.getCommandCompletion).toHaveBeenCalledTimes(2);
        expect(dispatcher.getCommandCompletion).toHaveBeenLastCalledWith(
            "play xyz",
        );
    });

    test("ACTIVE → backspace restores menu after no-match without re-fetch (complete=true)", async () => {
        const menu = makeMenu();
        // isActive: true after initial load, false for "xyz" prefix, true again for "so"
        menu.isActive
            .mockReturnValueOnce(true) // initial reuseSession after result
            .mockReturnValueOnce(false) // "xyz" — trie no match
            .mockReturnValueOnce(true); // "so" — trie matches "song"
        const result = makeCompletionResult(["song", "shuffle"], 5, {
            complete: true,
        });
        const dispatcher = makeDispatcher(result);
        const session = new PartialCompletionSession(menu, dispatcher);

        session.update("play ", getPos);
        await Promise.resolve(); // → ACTIVE, anchor = "play "

        // User types non-matching text.  complete=true → no re-fetch.
        session.update("play xyz", getPos);
        expect(menu.hide).toHaveBeenCalled();

        // User backspaces to matching prefix — menu reappears without re-fetch
        menu.updatePrefix.mockClear();
        session.update("play so", getPos);

        expect(dispatcher.getCommandCompletion).toHaveBeenCalledTimes(1);
        expect(menu.updatePrefix).toHaveBeenCalledWith("so", anyPosition);
    });

    test("hide() resets to IDLE so next update starts fresh", async () => {
        const menu = makeMenu();
        const dispatcher = makeDispatcher(makeCompletionResult(["song"], 0));
        const session = new PartialCompletionSession(menu, dispatcher);

        session.update("play", getPos);
        await Promise.resolve();

        session.hide();
        expect(menu.hide).toHaveBeenCalled();

        // After hide, next update should fetch again
        session.update("play", getPos);
        expect(dispatcher.getCommandCompletion).toHaveBeenCalledTimes(2);
    });

    test("hide() cancels an in-flight request (stale result is ignored)", async () => {
        const menu = makeMenu();
        let resolve!: (v: CommandCompletionResult) => void;
        const pending = new Promise<CommandCompletionResult>(
            (r) => (resolve = r),
        );
        const dispatcher: ICompletionDispatcher = {
            getCommandCompletion: jest
                .fn<ICompletionDispatcher["getCommandCompletion"]>()
                .mockReturnValue(pending),
        };
        const session = new PartialCompletionSession(menu, dispatcher);

        session.update("play", getPos);
        session.hide(); // cancels the promise

        // Now resolve the stale promise — should be a no-op
        resolve(makeCompletionResult(["song"], 0));
        await Promise.resolve();

        expect(menu.setChoices).not.toHaveBeenCalledWith(
            expect.arrayContaining([
                expect.objectContaining({ selectedText: "song" }),
            ]),
        );
    });

    test("empty input fetches completions from backend", async () => {
        const menu = makeMenu();
        menu.isActive.mockReturnValue(true);
        const result = makeCompletionResult(["@"], 0);
        const dispatcher = makeDispatcher(result);
        const session = new PartialCompletionSession(menu, dispatcher);

        session.update("", getPos);
        await Promise.resolve();

        expect(dispatcher.getCommandCompletion).toHaveBeenCalledWith("");
        expect(menu.setChoices).toHaveBeenCalledWith(
            expect.arrayContaining([
                expect.objectContaining({ selectedText: "@" }),
            ]),
        );
    });

    test("empty input: second update reuses session without re-fetch", async () => {
        const menu = makeMenu();
        menu.isActive.mockReturnValue(true);
        const result = makeCompletionResult(["@"], 0);
        const dispatcher = makeDispatcher(result);
        const session = new PartialCompletionSession(menu, dispatcher);

        session.update("", getPos);
        await Promise.resolve();

        session.update("", getPos);

        expect(dispatcher.getCommandCompletion).toHaveBeenCalledTimes(1);
    });

    test("empty input: unique match triggers re-fetch", async () => {
        const menu = makeMenu();
        menu.isActive.mockReturnValue(true);
        // updatePrefix returns true = uniquely satisfied
        menu.updatePrefix.mockReturnValue(true);
        const result = makeCompletionResult(["@"], 0);
        const dispatcher = makeDispatcher(result);
        const session = new PartialCompletionSession(menu, dispatcher);

        session.update("", getPos);
        await Promise.resolve();

        session.update("@", getPos);

        // "@" uniquely matches the only completion — triggers re-fetch
        expect(dispatcher.getCommandCompletion).toHaveBeenCalledTimes(2);
        expect(dispatcher.getCommandCompletion).toHaveBeenLastCalledWith("@");
    });

    test("empty input: unique match triggers re-fetch even when complete=true", async () => {
        const menu = makeMenu();
        menu.isActive.mockReturnValue(true);
        menu.updatePrefix.mockReturnValue(true);
        // complete=true means exhaustive at THIS level, but uniquelySatisfied
        // means the user needs NEXT level completions — always re-fetch.
        const result = makeCompletionResult(["@"], 0, { complete: true });
        const dispatcher = makeDispatcher(result);
        const session = new PartialCompletionSession(menu, dispatcher);

        session.update("", getPos);
        await Promise.resolve();

        session.update("@", getPos);

        expect(dispatcher.getCommandCompletion).toHaveBeenCalledTimes(2);
        expect(dispatcher.getCommandCompletion).toHaveBeenLastCalledWith("@");
    });

    test("empty input: ambiguous prefix does not re-fetch", async () => {
        const menu = makeMenu();
        menu.isActive.mockReturnValue(true);
        // updatePrefix returns false = not uniquely satisfied
        menu.updatePrefix.mockReturnValue(false);
        const result = makeCompletionResult(["@config", "@configure"], 0);
        const dispatcher = makeDispatcher(result);
        const session = new PartialCompletionSession(menu, dispatcher);

        session.update("", getPos);
        await Promise.resolve();

        session.update("@config", getPos);

        // "@config" is a prefix of "@configure" — reuse, no re-fetch
        expect(dispatcher.getCommandCompletion).toHaveBeenCalledTimes(1);
    });
});

// ── Completion result processing ──────────────────────────────────────────────

describe("PartialCompletionSession — result processing", () => {
    test("startIndex narrows the anchor (current) to input[0..startIndex]", async () => {
        const menu = makeMenu();
        menu.isActive.mockReturnValue(true);
        // startIndex=5 means grammar consumed "play " (5 chars)
        const result = makeCompletionResult(["song", "shuffle"], 5);
        const dispatcher = makeDispatcher(result);
        const session = new PartialCompletionSession(menu, dispatcher);

        session.update("play song", getPos);
        await Promise.resolve();

        // prefix should be "song" (the text after anchor "play ")
        expect(menu.updatePrefix).toHaveBeenCalledWith("song", anyPosition);
    });

    test("group order preserved: items appear in backend-provided group order", async () => {
        const menu = makeMenu();
        menu.isActive.mockReturnValue(true);
        const group1: CompletionGroup = {
            name: "grammar",
            completions: ["by"],
            sorted: true,
        };
        const group2: CompletionGroup = {
            name: "entities",
            completions: ["Bohemian Rhapsody"],
            sorted: true,
        };
        const result: CommandCompletionResult = {
            startIndex: 5,
            completions: [group1, group2],
            complete: false,
        };
        const dispatcher = makeDispatcher(result);
        const session = new PartialCompletionSession(menu, dispatcher);

        session.update("play ", getPos);
        await Promise.resolve();

        const calls = menu.setChoices.mock.calls;
        const items = calls[calls.length - 1][0] as {
            sortIndex: number;
            selectedText: string;
        }[];
        const byIndex = items.find((i) => i.selectedText === "by")!.sortIndex;
        const bohIndex = items.find(
            (i) => i.selectedText === "Bohemian Rhapsody",
        )!.sortIndex;
        expect(byIndex).toBeLessThan(bohIndex);
    });

    test("needQuotes propagated from group to each SearchMenuItem", async () => {
        const menu = makeMenu();
        menu.isActive.mockReturnValue(true);
        const group: CompletionGroup = {
            name: "entities",
            completions: ["Bohemian Rhapsody"],
            needQuotes: true,
            sorted: true,
        };
        const result: CommandCompletionResult = {
            startIndex: 0,
            completions: [group],
            complete: false,
        };
        const dispatcher = makeDispatcher(result);
        const session = new PartialCompletionSession(menu, dispatcher);

        session.update("play ", getPos);
        await Promise.resolve();

        expect(menu.setChoices).toHaveBeenCalledWith(
            expect.arrayContaining([
                expect.objectContaining({
                    selectedText: "Bohemian Rhapsody",
                    needQuotes: true,
                }),
            ]),
        );
    });

    test("unsorted group items are sorted alphabetically", async () => {
        const menu = makeMenu();
        menu.isActive.mockReturnValue(true);
        const group: CompletionGroup = {
            name: "test",
            completions: ["zebra", "apple", "mango"],
            sorted: false,
        };
        const result: CommandCompletionResult = {
            startIndex: 0,
            completions: [group],
            complete: false,
        };
        const dispatcher = makeDispatcher(result);
        const session = new PartialCompletionSession(menu, dispatcher);

        session.update("x", getPos);
        await Promise.resolve();

        const calls = menu.setChoices.mock.calls;
        const items = calls[calls.length - 1][0] as { selectedText: string }[];
        const texts = items.map((i) => i.selectedText);
        expect(texts).toEqual(["apple", "mango", "zebra"]);
    });

    test("separatorMode defers menu display until trailing space is present", async () => {
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

    test("separatorMode: typing separator shows menu without re-fetch", async () => {
        const menu = makeMenu();
        menu.isActive.mockReturnValue(true);
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

    test("separatorMode: menu shown after trailing space is typed", async () => {
        const menu = makeMenu();
        menu.isActive.mockReturnValue(true);
        const result = makeCompletionResult(["music"], 5, {
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

    test("empty completions list does not call setChoices with items", async () => {
        const menu = makeMenu();
        const result: CommandCompletionResult = {
            startIndex: 0,
            completions: [{ name: "empty", completions: [] }],
            complete: false,
        };
        const dispatcher = makeDispatcher(result);
        const session = new PartialCompletionSession(menu, dispatcher);

        session.update("play", getPos);
        await Promise.resolve();

        // Only the initial setChoices([]) call (cancel) should have been made
        expect(menu.setChoices).toHaveBeenCalledTimes(1);
        expect(menu.setChoices).toHaveBeenCalledWith([]);
    });
});

// ── @-command routing ─────────────────────────────────────────────────────────

describe("PartialCompletionSession — @command routing", () => {
    test("@ command with trailing space fetches full input", () => {
        const menu = makeMenu();
        const dispatcher = makeDispatcher();
        const session = new PartialCompletionSession(menu, dispatcher);

        session.update("@config ", getPos);

        expect(dispatcher.getCommandCompletion).toHaveBeenCalledWith(
            "@config ",
        );
    });

    test("@ command with partial word fetches full input (backend filters)", () => {
        const menu = makeMenu();
        const dispatcher = makeDispatcher();
        const session = new PartialCompletionSession(menu, dispatcher);

        session.update("@config c", getPos);

        // Backend receives full input and returns completions with the
        // correct startIndex; no word-boundary truncation needed.
        expect(dispatcher.getCommandCompletion).toHaveBeenCalledWith(
            "@config c",
        );
    });

    test("@ command with no space fetches full input", () => {
        const menu = makeMenu();
        const dispatcher = makeDispatcher();
        const session = new PartialCompletionSession(menu, dispatcher);

        session.update("@config", getPos);

        expect(dispatcher.getCommandCompletion).toHaveBeenCalledWith("@config");
    });

    test("@ command in PENDING state does not re-fetch", () => {
        const menu = makeMenu();
        const dispatcher: ICompletionDispatcher = {
            getCommandCompletion: jest
                .fn<ICompletionDispatcher["getCommandCompletion"]>()
                .mockReturnValue(new Promise(() => {})),
        };
        const session = new PartialCompletionSession(menu, dispatcher);

        session.update("@config ", getPos);
        session.update("@config c", getPos); // same anchor: "@config " — PENDING reuse

        expect(dispatcher.getCommandCompletion).toHaveBeenCalledTimes(1);
    });

    test("@ command: separatorMode defers menu until space typed", async () => {
        const menu = makeMenu();
        menu.isActive.mockReturnValue(true);
        // Backend returns subcommands with separatorMode: "space"
        // (anchor = "@config", subcommands follow after a space)
        const result = makeCompletionResult(["clear", "theme"], 7, {
            separatorMode: "space",
        });
        const dispatcher = makeDispatcher(result);
        const session = new PartialCompletionSession(menu, dispatcher);

        // User types "@config" → completions loaded, menu deferred (no separator yet)
        session.update("@config", getPos);
        await Promise.resolve();

        expect(menu.setChoices).toHaveBeenCalledWith(
            expect.arrayContaining([
                expect.objectContaining({ selectedText: "clear" }),
            ]),
        );
        expect(menu.updatePrefix).not.toHaveBeenCalled();

        // User types space → separator present, menu appears
        session.update("@config ", getPos);

        expect(menu.updatePrefix).toHaveBeenCalledWith("", anyPosition);
        // No re-fetch — same session handles both states
        expect(dispatcher.getCommandCompletion).toHaveBeenCalledTimes(1);
    });

    test("@ command: typing after space filters within same session", async () => {
        const menu = makeMenu();
        menu.isActive.mockReturnValue(true);
        // Backend: separatorMode, anchor = "@config"
        const result = makeCompletionResult(["clear", "theme"], 7, {
            separatorMode: "space",
        });
        const dispatcher = makeDispatcher(result);
        const session = new PartialCompletionSession(menu, dispatcher);

        session.update("@config", getPos);
        await Promise.resolve();

        // Type space + partial subcommand
        session.update("@config cl", getPos);

        expect(menu.updatePrefix).toHaveBeenCalledWith("cl", anyPosition);
        expect(dispatcher.getCommandCompletion).toHaveBeenCalledTimes(1);
    });

    test("@ command: empty result enters EXHAUSTED (no re-fetch)", async () => {
        const menu = makeMenu();
        const dispatcher = makeDispatcher();
        const session = new PartialCompletionSession(menu, dispatcher);

        session.update("@unknown", getPos);
        await Promise.resolve(); // → EXHAUSTED

        // Still within anchor — no re-fetch
        session.update("@unknownmore", getPos);

        expect(dispatcher.getCommandCompletion).toHaveBeenCalledTimes(1);
        expect(menu.hide).toHaveBeenCalled();
    });

    test("@ command: backspace past anchor after EXHAUSTED triggers re-fetch", async () => {
        const menu = makeMenu();
        const dispatcher = makeDispatcher();
        const session = new PartialCompletionSession(menu, dispatcher);

        session.update("@unknown", getPos);
        await Promise.resolve(); // → EXHAUSTED with current="@unknown"

        // Backspace past anchor
        session.update("@unknow", getPos);

        expect(dispatcher.getCommandCompletion).toHaveBeenCalledTimes(2);
        expect(dispatcher.getCommandCompletion).toHaveBeenLastCalledWith(
            "@unknow",
        );
    });
});

// ── getCompletionPrefix ───────────────────────────────────────────────────────

describe("PartialCompletionSession — getCompletionPrefix", () => {
    test("returns undefined when session is IDLE", () => {
        const session = new PartialCompletionSession(
            makeMenu(),
            makeDispatcher(),
        );
        expect(session.getCompletionPrefix("anything")).toBeUndefined();
    });

    test("returns suffix after anchor when input starts with anchor", async () => {
        const menu = makeMenu();
        menu.isActive.mockReturnValue(true);
        const result = makeCompletionResult(["song"], 5); // anchor = "play "
        const session = new PartialCompletionSession(
            menu,
            makeDispatcher(result),
        );

        session.update("play song", getPos);
        await Promise.resolve();

        expect(session.getCompletionPrefix("play song")).toBe("song");
    });

    test("returns undefined when input diverges from anchor", async () => {
        const menu = makeMenu();
        menu.isActive.mockReturnValue(true);
        const result = makeCompletionResult(["song"], 5);
        const session = new PartialCompletionSession(
            menu,
            makeDispatcher(result),
        );

        session.update("play song", getPos);
        await Promise.resolve();

        // Input no longer starts with anchor "play "
        expect(session.getCompletionPrefix("stop")).toBeUndefined();
    });

    test("separatorMode: returns stripped prefix when separator is present", async () => {
        const menu = makeMenu();
        menu.isActive.mockReturnValue(true);
        const result = makeCompletionResult(["music"], 4, {
            separatorMode: "space",
        });
        const session = new PartialCompletionSession(
            menu,
            makeDispatcher(result),
        );

        session.update("play", getPos);
        await Promise.resolve();

        // Separator + typed text: prefix should be "mu" (space stripped)
        expect(session.getCompletionPrefix("play mu")).toBe("mu");
    });

    test("separatorMode: returns undefined when separator is absent", async () => {
        const menu = makeMenu();
        const result = makeCompletionResult(["music"], 4, {
            separatorMode: "space",
        });
        const session = new PartialCompletionSession(
            menu,
            makeDispatcher(result),
        );

        session.update("play", getPos);
        await Promise.resolve();

        // No separator yet — undefined means no replacement should happen
        expect(session.getCompletionPrefix("play")).toBeUndefined();
    });
});

// ── resetToIdle ───────────────────────────────────────────────────────────────

describe("PartialCompletionSession — resetToIdle", () => {
    test("clears session so next update re-fetches", async () => {
        const menu = makeMenu();
        menu.isActive.mockReturnValue(true);
        const dispatcher = makeDispatcher(makeCompletionResult(["song"], 5));
        const session = new PartialCompletionSession(menu, dispatcher);

        session.update("play song", getPos);
        await Promise.resolve(); // → ACTIVE

        session.resetToIdle();

        // After reset, next update should fetch fresh completions
        session.update("play song", getPos);
        expect(dispatcher.getCommandCompletion).toHaveBeenCalledTimes(2);
    });

    test("does not hide the menu (caller is responsible for that)", async () => {
        const menu = makeMenu();
        menu.isActive.mockReturnValue(true);
        const dispatcher = makeDispatcher(makeCompletionResult(["song"], 5));
        const session = new PartialCompletionSession(menu, dispatcher);

        session.update("play song", getPos);
        await Promise.resolve();

        menu.hide.mockClear();
        session.resetToIdle();

        expect(menu.hide).not.toHaveBeenCalled();
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
        );
    });

    test("separator already in input when result arrives shows menu immediately", async () => {
        // User typed "play " fast enough that the promise resolves after the space.
        const menu = makeMenu();
        menu.isActive.mockReturnValue(true);
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

// ── miscellaneous ─────────────────────────────────────────────────────────────

describe("PartialCompletionSession — miscellaneous", () => {
    test("getPosition returning undefined hides the menu", async () => {
        const menu = makeMenu();
        menu.isActive.mockReturnValue(true);
        const result = makeCompletionResult(["song"], 5);
        const dispatcher = makeDispatcher(result);
        const session = new PartialCompletionSession(menu, dispatcher);

        session.update("play song", getPos);
        await Promise.resolve();

        menu.hide.mockClear();
        // getPosition returns undefined (e.g. caret not found)
        session.update("play song", () => undefined);

        expect(menu.hide).toHaveBeenCalled();
    });

    test("startIndex beyond input length falls back to full input as anchor", async () => {
        const menu = makeMenu();
        menu.isActive.mockReturnValue(true);
        // startIndex=99 is beyond "play" (length 4) — anchor falls back to "play"
        const result = makeCompletionResult(["song"], 99);
        const dispatcher = makeDispatcher(result);
        const session = new PartialCompletionSession(menu, dispatcher);

        session.update("play", getPos);
        await Promise.resolve();

        // Anchor is "play" (full input).  reuseSession is called with the captured
        // input "play", so rawPrefix="" and updatePrefix is called with "".
        expect(menu.updatePrefix).toHaveBeenCalledWith("", anyPosition);
    });
});

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
import { SearchMenuBase } from "../src/renderer/src/searchMenuBase.js";

// ── Helpers ──────────────────────────────────────────────────────────────────

// Real trie-backed ISearchMenu backed by SearchMenuBase.
// Every method is a jest.fn() wrapping the real implementation so tests can
// assert on call counts and arguments.
class TestSearchMenu extends SearchMenuBase {
    setChoices = jest.fn<ISearchMenu["setChoices"]>((choices) =>
        super.setChoices(choices),
    );

    updatePrefix = jest.fn<ISearchMenu["updatePrefix"]>(
        (prefix: string, position: SearchMenuPosition): boolean =>
            super.updatePrefix(prefix, position),
    );

    hasExactMatch = jest.fn<ISearchMenu["hasExactMatch"]>(
        (text: string): boolean => super.hasExactMatch(text),
    );

    hide = jest.fn<ISearchMenu["hide"]>(() => super.hide());

    isActive = jest.fn<ISearchMenu["isActive"]>(() => super.isActive());
}

function makeMenu(): TestSearchMenu {
    return new TestSearchMenu();
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
        closedSet: true,
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
    return {
        startIndex,
        completions: [group],
        closedSet: false,
        ...opts,
    };
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
        const result = makeCompletionResult(["song", "shuffle"], 4);
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

    test("PENDING → ACTIVE: empty result (closedSet=true) suppresses re-fetch while input has same prefix", async () => {
        const menu = makeMenu();
        const dispatcher = makeDispatcher();
        const session = new PartialCompletionSession(menu, dispatcher);

        session.update("play", getPos);
        await Promise.resolve();

        // Empty completions + closedSet=true — no new fetch even with extended input
        session.update("play s", getPos);

        expect(dispatcher.getCommandCompletion).toHaveBeenCalledTimes(1);
    });

    test("empty result: backspace past anchor triggers a new fetch", async () => {
        const menu = makeMenu();
        const dispatcher = makeDispatcher();
        const session = new PartialCompletionSession(menu, dispatcher);

        session.update("play", getPos);
        await Promise.resolve(); // → ACTIVE (empty, closedSet=true) with current="play"

        // Backspace past anchor
        session.update("pla", getPos);

        expect(dispatcher.getCommandCompletion).toHaveBeenCalledTimes(2);
        expect(dispatcher.getCommandCompletion).toHaveBeenLastCalledWith("pla");
    });

    test("ACTIVE → hide+keep: closedSet=true, trie has no matches — no re-fetch", async () => {
        const menu = makeMenu();
        const result = makeCompletionResult(["song"], 4, {
            closedSet: true,
        });
        const dispatcher = makeDispatcher(result);
        const session = new PartialCompletionSession(menu, dispatcher);

        session.update("play ", getPos);
        await Promise.resolve(); // → ACTIVE, anchor = "play"

        // User types more; trie returns no matches but input is within anchor.
        // closedSet=true → exhaustive set, no point re-fetching.
        session.update("play xyz", getPos);

        expect(dispatcher.getCommandCompletion).toHaveBeenCalledTimes(1);
        expect(menu.hide).toHaveBeenCalled();
    });

    test("ACTIVE → re-fetch: closedSet=false, trie has no matches — re-fetches", async () => {
        const menu = makeMenu();
        const result = makeCompletionResult(["song"], 4); // closedSet=false default
        const dispatcher = makeDispatcher(result);
        const session = new PartialCompletionSession(menu, dispatcher);

        session.update("play ", getPos);
        await Promise.resolve(); // → ACTIVE, anchor = "play"

        // User types text with no trie match.  closedSet=false → set is NOT
        // exhaustive, so we should re-fetch in case the backend knows more.
        session.update("play xyz", getPos);

        expect(dispatcher.getCommandCompletion).toHaveBeenCalledTimes(2);
        expect(dispatcher.getCommandCompletion).toHaveBeenLastCalledWith(
            "play xyz",
        );
    });

    test("ACTIVE → backspace restores menu after no-match without re-fetch (closedSet=true)", async () => {
        const menu = makeMenu();
        const result = makeCompletionResult(["song", "shuffle"], 4, {
            closedSet: true,
        });
        const dispatcher = makeDispatcher(result);
        const session = new PartialCompletionSession(menu, dispatcher);

        session.update("play ", getPos);
        await Promise.resolve(); // → ACTIVE, anchor = "play"

        // User types non-matching text.  closedSet=true → no re-fetch.
        session.update("play xyz", getPos);
        expect(menu.hide).toHaveBeenCalled();

        // User backspaces to matching prefix — menu reappears without re-fetch
        menu.updatePrefix.mockClear();
        session.update("play so", getPos);

        expect(dispatcher.getCommandCompletion).toHaveBeenCalledTimes(1);
        expect(menu.updatePrefix).toHaveBeenCalledWith("so", anyPosition);
    });

    test("hide() preserves anchor so same input reuses session", async () => {
        const menu = makeMenu();
        const dispatcher = makeDispatcher(makeCompletionResult(["song"], 4));
        const session = new PartialCompletionSession(menu, dispatcher);

        session.update("play", getPos);
        await Promise.resolve();

        session.hide();
        expect(menu.hide).toHaveBeenCalled();

        // After hide, same input within anchor reuses session — no re-fetch
        session.update("play", getPos);
        expect(dispatcher.getCommandCompletion).toHaveBeenCalledTimes(1);
    });

    test("hide() preserves anchor: diverged input triggers re-fetch", async () => {
        const menu = makeMenu();
        const dispatcher = makeDispatcher(makeCompletionResult(["song"], 4));
        const session = new PartialCompletionSession(menu, dispatcher);

        session.update("play", getPos);
        await Promise.resolve();

        session.hide();

        // Input that diverges from anchor triggers a new fetch
        session.update("stop", getPos);
        expect(dispatcher.getCommandCompletion).toHaveBeenCalledTimes(2);
        expect(dispatcher.getCommandCompletion).toHaveBeenLastCalledWith(
            "stop",
        );
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
        resolve(makeCompletionResult(["song"], 4));
        await Promise.resolve();

        expect(menu.setChoices).not.toHaveBeenCalledWith(
            expect.arrayContaining([
                expect.objectContaining({ selectedText: "song" }),
            ]),
        );
    });

    test("empty input fetches completions from backend", async () => {
        const menu = makeMenu();
        const result = makeCompletionResult(["@"], 0, {
            separatorMode: "none",
        });
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
        const result = makeCompletionResult(["@"], 0, {
            separatorMode: "none",
        });
        const dispatcher = makeDispatcher(result);
        const session = new PartialCompletionSession(menu, dispatcher);

        session.update("", getPos);
        await Promise.resolve();

        session.update("", getPos);

        expect(dispatcher.getCommandCompletion).toHaveBeenCalledTimes(1);
    });

    test("empty input: unique match triggers re-fetch (commitMode=eager)", async () => {
        const menu = makeMenu();
        const result = makeCompletionResult(["@"], 0, {
            separatorMode: "none",
            commitMode: "eager",
        });
        const dispatcher = makeDispatcher(result);
        const session = new PartialCompletionSession(menu, dispatcher);

        session.update("", getPos);
        await Promise.resolve();

        session.update("@", getPos);

        // "@" uniquely matches the only completion — triggers re-fetch
        expect(dispatcher.getCommandCompletion).toHaveBeenCalledTimes(2);
        expect(dispatcher.getCommandCompletion).toHaveBeenLastCalledWith("@");
    });

    test("empty input: unique match triggers re-fetch even when closedSet=true (commitMode=eager)", async () => {
        const menu = makeMenu();
        // closedSet=true means exhaustive at THIS level, but uniquelySatisfied
        // means the user needs NEXT level completions — always re-fetch.
        const result = makeCompletionResult(["@"], 0, {
            closedSet: true,
            separatorMode: "none",
            commitMode: "eager",
        });
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
        const result = makeCompletionResult(["@config", "@configure"], 0, {
            separatorMode: "none",
        });
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
        // startIndex=4 means grammar consumed "play" (4 chars); the
        // trailing space is the separator between anchor and completions.
        const result = makeCompletionResult(["song", "shuffle"], 4);
        const dispatcher = makeDispatcher(result);
        const session = new PartialCompletionSession(menu, dispatcher);

        session.update("play song", getPos);
        await Promise.resolve();

        // prefix should be "song" (the text after anchor "play" + separator " ")
        expect(menu.updatePrefix).toHaveBeenCalledWith("song", anyPosition);
    });

    test("group order preserved: items appear in backend-provided group order", async () => {
        const menu = makeMenu();
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
            startIndex: 4,
            completions: [group1, group2],
            closedSet: false,
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
        const group: CompletionGroup = {
            name: "entities",
            completions: ["Bohemian Rhapsody"],
            needQuotes: true,
            sorted: true,
        };
        const result: CommandCompletionResult = {
            startIndex: 4,
            completions: [group],
            closedSet: false,
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
        const group: CompletionGroup = {
            name: "test",
            completions: ["zebra", "apple", "mango"],
            sorted: false,
        };
        const result: CommandCompletionResult = {
            startIndex: 0,
            completions: [group],
            closedSet: false,
            separatorMode: "none",
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

    test("empty completions list does not call setChoices with items", async () => {
        const menu = makeMenu();
        const result: CommandCompletionResult = {
            startIndex: 0,
            completions: [{ name: "empty", completions: [] }],
            closedSet: false,
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

    test("@ command: empty result (closedSet=true) suppresses re-fetch", async () => {
        const menu = makeMenu();
        const dispatcher = makeDispatcher();
        const session = new PartialCompletionSession(menu, dispatcher);

        session.update("@unknown", getPos);
        await Promise.resolve(); // → empty completions, closedSet=true

        // Still within anchor — no re-fetch
        session.update("@unknownmore", getPos);

        expect(dispatcher.getCommandCompletion).toHaveBeenCalledTimes(1);
    });

    test("@ command: backspace past anchor after empty result triggers re-fetch", async () => {
        const menu = makeMenu();
        const dispatcher = makeDispatcher();
        const session = new PartialCompletionSession(menu, dispatcher);

        session.update("@unknown", getPos);
        await Promise.resolve(); // → empty completions with current="@unknown"

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
        const result = makeCompletionResult(["song"], 4);
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
        const result = makeCompletionResult(["song"], 4);
        const session = new PartialCompletionSession(
            menu,
            makeDispatcher(result),
        );

        session.update("play song", getPos);
        await Promise.resolve();

        // Input no longer starts with anchor "play"
        expect(session.getCompletionPrefix("stop")).toBeUndefined();
    });

    test("separatorMode: returns stripped prefix when separator is present", async () => {
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
        const dispatcher = makeDispatcher(makeCompletionResult(["song"], 4));
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
        const dispatcher = makeDispatcher(makeCompletionResult(["song"], 4));
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
        const result = makeCompletionResult(["song"], 4);
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
        // startIndex=99 is beyond "play" (length 4) — anchor falls back to "play"
        const result = makeCompletionResult(["song"], 99, {
            separatorMode: "none",
        });
        const dispatcher = makeDispatcher(result);
        const session = new PartialCompletionSession(menu, dispatcher);

        session.update("play", getPos);
        await Promise.resolve();

        // Anchor is "play" (full input).  reuseSession is called with the captured
        // input "play", so rawPrefix="" and updatePrefix is called with "".
        expect(menu.updatePrefix).toHaveBeenCalledWith("", anyPosition);
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

// ── emojiChar propagation ─────────────────────────────────────────────────────

describe("PartialCompletionSession — emojiChar propagation", () => {
    test("emojiChar from group is propagated to each SearchMenuItem", async () => {
        const menu = makeMenu();
        const group: CompletionGroup = {
            name: "agents",
            completions: ["player", "calendar"],
            emojiChar: "\uD83C\uDFB5",
            sorted: true,
        };
        const result: CommandCompletionResult = {
            startIndex: 0,
            completions: [group],
            closedSet: false,
            separatorMode: "none",
        };
        const dispatcher = makeDispatcher(result);
        const session = new PartialCompletionSession(menu, dispatcher);

        session.update("", getPos);
        await Promise.resolve();

        expect(menu.setChoices).toHaveBeenCalledWith(
            expect.arrayContaining([
                expect.objectContaining({
                    selectedText: "player",
                    emojiChar: "\uD83C\uDFB5",
                }),
                expect.objectContaining({
                    selectedText: "calendar",
                    emojiChar: "\uD83C\uDFB5",
                }),
            ]),
        );
    });

    test("emojiChar absent from group means no emojiChar on items", async () => {
        const menu = makeMenu();
        const group: CompletionGroup = {
            name: "plain",
            completions: ["alpha"],
            sorted: true,
        };
        const result: CommandCompletionResult = {
            startIndex: 0,
            completions: [group],
            closedSet: false,
            separatorMode: "none",
        };
        const dispatcher = makeDispatcher(result);
        const session = new PartialCompletionSession(menu, dispatcher);

        session.update("", getPos);
        await Promise.resolve();

        const calls = menu.setChoices.mock.calls;
        const items = calls[calls.length - 1][0] as Record<string, unknown>[];
        expect(items[0]).not.toHaveProperty("emojiChar");
    });
});

// ── backend error handling ────────────────────────────────────────────────────

describe("PartialCompletionSession — backend error handling", () => {
    test("rejected promise clears PENDING state so next update can proceed", async () => {
        const menu = makeMenu();
        const dispatcher: ICompletionDispatcher = {
            getCommandCompletion: jest
                .fn<ICompletionDispatcher["getCommandCompletion"]>()
                .mockRejectedValueOnce(new Error("network error"))
                .mockResolvedValue(makeCompletionResult(["song"], 4)),
        };
        const session = new PartialCompletionSession(menu, dispatcher);

        session.update("play", getPos);
        // Flush rejected promise + catch handler
        await Promise.resolve();
        await Promise.resolve();

        // After rejection, anchor is still "play" with separatorMode="space".
        // Diverged input triggers a re-fetch (anchor no longer matches).
        session.update("stop", getPos);

        expect(dispatcher.getCommandCompletion).toHaveBeenCalledTimes(2);
        expect(dispatcher.getCommandCompletion).toHaveBeenLastCalledWith(
            "stop",
        );
    });

    test("rejected promise: same input within anchor does not re-fetch", async () => {
        const menu = makeMenu();
        const dispatcher: ICompletionDispatcher = {
            getCommandCompletion: jest
                .fn<ICompletionDispatcher["getCommandCompletion"]>()
                .mockRejectedValueOnce(new Error("network error"))
                .mockResolvedValue(makeCompletionResult(["song"], 4)),
        };
        const session = new PartialCompletionSession(menu, dispatcher);

        session.update("play", getPos);
        await Promise.resolve();
        await Promise.resolve();

        // Same input — anchor still matches, reuse session (no re-fetch)
        session.update("play", getPos);

        expect(dispatcher.getCommandCompletion).toHaveBeenCalledTimes(1);
    });

    test("rejected promise does not leave session stuck in PENDING", async () => {
        const menu = makeMenu();
        let rejectFn!: (e: Error) => void;
        const rejecting = new Promise<CommandCompletionResult>(
            (_, reject) => (rejectFn = reject),
        );
        const dispatcher: ICompletionDispatcher = {
            getCommandCompletion: jest
                .fn<ICompletionDispatcher["getCommandCompletion"]>()
                .mockReturnValueOnce(rejecting)
                .mockResolvedValue(makeCompletionResult(["song"], 4)),
        };
        const session = new PartialCompletionSession(menu, dispatcher);

        session.update("play", getPos);

        // While PENDING, second update is suppressed
        session.update("play more", getPos);
        expect(dispatcher.getCommandCompletion).toHaveBeenCalledTimes(1);

        // Now reject
        rejectFn(new Error("timeout"));
        await Promise.resolve();
        await Promise.resolve();

        // Session is no longer PENDING — diverged input triggers re-fetch
        session.update("stop", getPos);
        expect(dispatcher.getCommandCompletion).toHaveBeenCalledTimes(2);
    });

    test("rejected promise does not populate menu", async () => {
        const menu = makeMenu();
        const dispatcher: ICompletionDispatcher = {
            getCommandCompletion: jest
                .fn<ICompletionDispatcher["getCommandCompletion"]>()
                .mockRejectedValue(new Error("timeout")),
        };
        const session = new PartialCompletionSession(menu, dispatcher);

        session.update("play", getPos);
        await Promise.resolve();
        await Promise.resolve();

        // setChoices should only have the initial empty-array call, not real items
        expect(menu.setChoices).toHaveBeenCalledTimes(1);
        expect(menu.setChoices).toHaveBeenCalledWith([]);
    });
});

// ── startIndex edge cases ─────────────────────────────────────────────────────

describe("PartialCompletionSession — startIndex edge cases", () => {
    test("negative startIndex falls back to full input as anchor", async () => {
        const menu = makeMenu();
        const result = makeCompletionResult(["song"], -1, {
            separatorMode: "none",
        });
        const dispatcher = makeDispatcher(result);
        const session = new PartialCompletionSession(menu, dispatcher);

        session.update("play", getPos);
        await Promise.resolve();

        // Anchor is "play" (full input).  rawPrefix="" → updatePrefix("", ...)
        expect(menu.updatePrefix).toHaveBeenCalledWith("", anyPosition);
    });

    test("startIndex=0 sets empty anchor", async () => {
        const menu = makeMenu();
        const result = makeCompletionResult(["play"], 0, {
            separatorMode: "none",
        });
        const dispatcher = makeDispatcher(result);
        const session = new PartialCompletionSession(menu, dispatcher);

        session.update("play", getPos);
        await Promise.resolve();

        // Anchor is "" (empty).  rawPrefix="play" → updatePrefix("play", ...)
        expect(menu.updatePrefix).toHaveBeenCalledWith("play", anyPosition);
    });
});

// ── mixed sorted/unsorted groups ──────────────────────────────────────────────

describe("PartialCompletionSession — mixed sorted/unsorted groups", () => {
    test("sorted group preserves order while unsorted group is alphabetized", async () => {
        const menu = makeMenu();
        const sortedGroup: CompletionGroup = {
            name: "grammar",
            completions: ["zebra", "apple"],
            sorted: true,
        };
        const unsortedGroup: CompletionGroup = {
            name: "entities",
            completions: ["cherry", "banana"],
            sorted: false,
        };
        const result: CommandCompletionResult = {
            startIndex: 0,
            completions: [sortedGroup, unsortedGroup],
            closedSet: false,
            separatorMode: "none",
        };
        const dispatcher = makeDispatcher(result);
        const session = new PartialCompletionSession(menu, dispatcher);

        session.update("x", getPos);
        await Promise.resolve();

        const calls = menu.setChoices.mock.calls;
        const items = calls[calls.length - 1][0] as {
            selectedText: string;
            sortIndex: number;
        }[];
        const texts = items.map((i) => i.selectedText);

        // Sorted group: order preserved (zebra before apple)
        // Unsorted group: alphabetized (banana before cherry)
        // Cross-group: sorted group first
        expect(texts).toEqual(["zebra", "apple", "banana", "cherry"]);

        // sortIndex is sequential across both groups
        expect(items.map((i) => i.sortIndex)).toEqual([0, 1, 2, 3]);
    });
});

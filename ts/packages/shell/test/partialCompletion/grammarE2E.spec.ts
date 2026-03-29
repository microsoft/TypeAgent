// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { jest } from "@jest/globals";
import {
    PartialCompletionSession,
    ICompletionDispatcher,
    CommandCompletionResult,
    makeMenu,
    getPos,
    TestSearchMenu,
} from "./helpers.js";
import {
    loadGrammarRules,
    matchGrammarCompletion,
    type Grammar,
    type GrammarCompletionResult,
} from "action-grammar";
import { CompletionGroup, CompletionDirection } from "@typeagent/agent-sdk";

// ── Grammar-based mock dispatcher ────────────────────────────────────────────
//
// Bridges the real grammar matcher to the ICompletionDispatcher interface
// expected by PartialCompletionSession.  Entity values are supplied via a
// static map keyed by property name — no real agent or backend needed.

type EntityMap = Record<string, string[]>;

function makeGrammarDispatcher(
    grammar: Grammar,
    entities: EntityMap = {},
): ICompletionDispatcher & {
    getCommandCompletion: jest.MockedFunction<
        ICompletionDispatcher["getCommandCompletion"]
    >;
} {
    const impl = (
        input: string,
        direction: CompletionDirection,
    ): Promise<CommandCompletionResult> => {
        const result: GrammarCompletionResult = matchGrammarCompletion(
            grammar,
            input,
            undefined,
            direction,
        );

        const startIndex = result.matchedPrefixLength ?? 0;
        const completions: CompletionGroup[] = [];

        // Keyword completions from the grammar.
        if (result.completions.length > 0) {
            completions.push({
                name: "Keywords",
                completions: result.completions,
            });
        }

        // Entity completions: for each property the grammar identifies as
        // needing a value, look up mocked entity data.
        if (result.properties !== undefined) {
            for (const prop of result.properties) {
                for (const propName of prop.propertyNames) {
                    const values = entities[propName];
                    if (values !== undefined && values.length > 0) {
                        completions.push({
                            name: `entity:${propName}`,
                            completions: values,
                            kind: "entity",
                        });
                    }
                }
            }
        }

        return Promise.resolve({
            startIndex,
            completions,
            separatorMode: result.separatorMode,
            closedSet: result.closedSet ?? true,
            directionSensitive: result.directionSensitive,
            openWildcard: result.openWildcard,
        });
    };

    return {
        getCommandCompletion: jest
            .fn<ICompletionDispatcher["getCommandCompletion"]>()
            .mockImplementation(impl),
    };
}

// ── Helpers ──────────────────────────────────────────────────────────────────

// Flush the microtask queue so the completion promise resolves.
const flush = () => Promise.resolve();

// ── Test grammars ────────────────────────────────────────────────────────────

const musicGrammar = loadGrammarRules(
    "music.grammar",
    [
        `<Start> = play $(name) -> { name };`,
        `<Start> = play $(name) by $(artist) -> { name, artist };`,
        `<Start> = skip -> "skip";`,
        `<Start> = pause -> "pause";`,
    ].join("\n"),
);

const musicEntities: EntityMap = {
    name: ["Shake It Off", "Shape of You", "Bohemian Rhapsody"],
    artist: ["Taylor Swift", "Ed Sheeran", "Queen"],
};

const settingsGrammar = loadGrammarRules(
    "settings.grammar",
    [
        `<Start> = set $(prop:<Prop>) $(value) -> { prop, value };`,
        `<Prop> = volume -> "volume";`,
        `<Prop> = brightness -> "brightness";`,
    ].join("\n"),
);

const settingsEntities: EntityMap = {
    value: ["low", "medium", "high"],
};

// ── Tests ────────────────────────────────────────────────────────────────────

describe("PartialCompletionSession — grammar e2e with mocked entities", () => {
    // ── Music grammar: keyword → entity → keyword → entity ───────────

    describe("music grammar: keyword completions", () => {
        let menu: TestSearchMenu;
        let dispatcher: ReturnType<typeof makeGrammarDispatcher>;
        let session: PartialCompletionSession;

        beforeEach(async () => {
            menu = makeMenu();
            dispatcher = makeGrammarDispatcher(musicGrammar, musicEntities);
            session = new PartialCompletionSession(menu, dispatcher);
        });

        test("empty input fetches and shows keyword completions", async () => {
            session.update("", getPos);
            await flush();

            expect(dispatcher.getCommandCompletion).toHaveBeenCalledTimes(1);
            expect(menu.setChoices).toHaveBeenCalledWith(
                expect.arrayContaining([
                    expect.objectContaining({ matchText: "pause" }),
                    expect.objectContaining({ matchText: "play" }),
                    expect.objectContaining({ matchText: "skip" }),
                ]),
            );
            expect(menu.isActive()).toBe(true);
        });

        test("typing 'p' reuses session and trie narrows to 'pause', 'play'", async () => {
            session.update("", getPos);
            await flush();

            session.update("p", getPos);

            // No new fetch — trie handles narrowing.
            expect(dispatcher.getCommandCompletion).toHaveBeenCalledTimes(1);
            expect(menu.updatePrefix).toHaveBeenLastCalledWith(
                "p",
                expect.anything(),
            );
            expect(menu.isActive()).toBe(true);
        });

        test("typing 'sk' narrows to 'skip'", async () => {
            session.update("", getPos);
            await flush();

            session.update("sk", getPos);

            expect(dispatcher.getCommandCompletion).toHaveBeenCalledTimes(1);
            expect(menu.updatePrefix).toHaveBeenLastCalledWith(
                "sk",
                expect.anything(),
            );
            // "skip" matches prefix "sk" but is not uniquely satisfied (prefix ≠ full text)
            expect(menu.isActive()).toBe(true);
        });

        test("typing 'skip' uniquely satisfies → re-fetches for next level", async () => {
            session.update("", getPos);
            await flush();

            session.update("skip", getPos);

            // 'skip' exact-matches one entry → uniquelySatisfied → re-fetch
            expect(dispatcher.getCommandCompletion).toHaveBeenCalledTimes(2);
            expect(dispatcher.getCommandCompletion).toHaveBeenLastCalledWith(
                "skip",
                "forward",
            );
        });
    });

    describe("music grammar: keyword → entity transition", () => {
        let menu: TestSearchMenu;
        let dispatcher: ReturnType<typeof makeGrammarDispatcher>;
        let session: PartialCompletionSession;

        beforeEach(async () => {
            menu = makeMenu();
            dispatcher = makeGrammarDispatcher(musicGrammar, musicEntities);
            session = new PartialCompletionSession(menu, dispatcher);
        });

        test("'play' uniquely satisfies keyword → re-fetches with entity results", async () => {
            session.update("", getPos);
            await flush();

            session.update("play", getPos);
            await flush();

            // First fetch for "", second for "play"
            expect(dispatcher.getCommandCompletion).toHaveBeenCalledTimes(2);

            // Grammar returns properties for "name" → mock entities injected.
            // separatorMode is "spacePunctuation", so menu is hidden until
            // space is typed (HIDE+KEEP).
            expect(menu.setChoices).toHaveBeenLastCalledWith(
                expect.arrayContaining([
                    expect.objectContaining({ matchText: "Bohemian Rhapsody" }),
                    expect.objectContaining({ matchText: "Shake It Off" }),
                    expect.objectContaining({ matchText: "Shape of You" }),
                ]),
            );
        });

        test("'play' with separator deferred — menu hidden until space typed", async () => {
            session.update("", getPos);
            await flush();
            session.update("play", getPos);
            await flush();

            // separatorMode="spacePunctuation" and rawPrefix="" → HIDE+KEEP
            expect(menu.isActive()).toBe(false);
        });

        test("'play ' (with space) shows entity completions", async () => {
            session.update("", getPos);
            await flush();
            session.update("play", getPos);
            await flush();

            session.update("play ", getPos);

            // Separator present → menu activated with entity items.
            expect(menu.isActive()).toBe(true);
            expect(menu.updatePrefix).toHaveBeenLastCalledWith(
                "",
                expect.anything(),
            );
        });

        test("'play sha' narrows entities via trie", async () => {
            session.update("", getPos);
            await flush();
            session.update("play", getPos);
            await flush();

            session.update("play sha", getPos);

            // Trie prefix "sha" matches "Shake It Off" and "Shape of You"
            expect(menu.updatePrefix).toHaveBeenLastCalledWith(
                "sha",
                expect.anything(),
            );
            expect(menu.isActive()).toBe(true);
        });

        test("'play Shake It Off' uniquely satisfies entity → re-fetches", async () => {
            session.update("", getPos);
            await flush();
            session.update("play", getPos);
            await flush();

            session.update("play Shake It Off", getPos);

            // "Shake It Off" uniquely matches → re-fetch for next level
            expect(dispatcher.getCommandCompletion).toHaveBeenCalledTimes(3);
            expect(dispatcher.getCommandCompletion).toHaveBeenLastCalledWith(
                "play Shake It Off",
                "forward",
            );
        });
    });

    describe("music grammar: multi-level hierarchy (entity → keyword → entity)", () => {
        let menu: TestSearchMenu;
        let dispatcher: ReturnType<typeof makeGrammarDispatcher>;
        let session: PartialCompletionSession;

        beforeEach(async () => {
            menu = makeMenu();
            dispatcher = makeGrammarDispatcher(musicGrammar, musicEntities);
            session = new PartialCompletionSession(menu, dispatcher);
        });

        test("after entity match, 'by' keyword appears", async () => {
            // Bootstrap through: "" → "play" → "play Shake It Off"
            session.update("", getPos);
            await flush();
            session.update("play", getPos);
            await flush();
            session.update("play Shake It Off", getPos);
            await flush();

            // Grammar at "play Shake It Off": completions=["by"],
            // separatorMode="spacePunctuation"
            expect(menu.setChoices).toHaveBeenLastCalledWith(
                expect.arrayContaining([
                    expect.objectContaining({ matchText: "by" }),
                ]),
            );
        });

        test("'by' keyword separator deferred, then shown with space", async () => {
            session.update("", getPos);
            await flush();
            session.update("play", getPos);
            await flush();
            session.update("play Shake It Off", getPos);
            await flush();

            // separatorMode="spacePunctuation", rawPrefix="" → deferred
            expect(menu.isActive()).toBe(false);

            // Type space
            session.update("play Shake It Off ", getPos);
            expect(menu.isActive()).toBe(true);
        });

        test("typing 'by' uniquely satisfies → re-fetches for artist entities", async () => {
            session.update("", getPos);
            await flush();
            session.update("play", getPos);
            await flush();
            session.update("play Shake It Off", getPos);
            await flush();

            session.update("play Shake It Off by", getPos);
            await flush();

            // "by" uniquely satisfied → re-fetch → grammar returns artist properties
            expect(dispatcher.getCommandCompletion).toHaveBeenLastCalledWith(
                "play Shake It Off by",
                "forward",
            );
            // Entity values for "artist" should be loaded
            expect(menu.setChoices).toHaveBeenLastCalledWith(
                expect.arrayContaining([
                    expect.objectContaining({ matchText: "Ed Sheeran" }),
                    expect.objectContaining({ matchText: "Queen" }),
                    expect.objectContaining({ matchText: "Taylor Swift" }),
                ]),
            );
        });

        test("artist entities narrowed by trie after typing prefix", async () => {
            session.update("", getPos);
            await flush();
            session.update("play", getPos);
            await flush();
            session.update("play Shake It Off", getPos);
            await flush();
            session.update("play Shake It Off by", getPos);
            await flush();

            session.update("play Shake It Off by T", getPos);
            expect(menu.updatePrefix).toHaveBeenLastCalledWith(
                "T",
                expect.anything(),
            );
            // "Taylor Swift" matches prefix "T"
            expect(menu.isActive()).toBe(true);
        });
    });

    // ── Settings grammar: keyword → keyword alternatives → entity ────

    describe("settings grammar: keyword alternatives then entity", () => {
        let menu: TestSearchMenu;
        let dispatcher: ReturnType<typeof makeGrammarDispatcher>;
        let session: PartialCompletionSession;

        beforeEach(async () => {
            menu = makeMenu();
            dispatcher = makeGrammarDispatcher(
                settingsGrammar,
                settingsEntities,
            );
            session = new PartialCompletionSession(menu, dispatcher);
        });

        test("empty input shows 'set' keyword", async () => {
            session.update("", getPos);
            await flush();

            expect(menu.setChoices).toHaveBeenCalledWith(
                expect.arrayContaining([
                    expect.objectContaining({ matchText: "set" }),
                ]),
            );
            expect(menu.isActive()).toBe(true);
        });

        test("'set' uniquely satisfies → re-fetch shows property alternatives", async () => {
            session.update("", getPos);
            await flush();

            session.update("set", getPos);
            await flush();

            // Grammar returns completions: ["volume", "brightness"]
            expect(dispatcher.getCommandCompletion).toHaveBeenCalledTimes(2);
            expect(menu.setChoices).toHaveBeenLastCalledWith(
                expect.arrayContaining([
                    expect.objectContaining({ matchText: "brightness" }),
                    expect.objectContaining({ matchText: "volume" }),
                ]),
            );
        });

        test("'set v' narrows property alternatives via trie", async () => {
            session.update("", getPos);
            await flush();
            session.update("set", getPos);
            await flush();

            session.update("set v", getPos);

            // Trie prefix "v" → only "volume" matches
            expect(menu.updatePrefix).toHaveBeenLastCalledWith(
                "v",
                expect.anything(),
            );
            expect(menu.isActive()).toBe(true);
        });

        test("'set volume' uniquely satisfies → re-fetch shows entity values", async () => {
            session.update("", getPos);
            await flush();
            session.update("set", getPos);
            await flush();

            session.update("set volume", getPos);
            await flush();

            // "volume" uniquely satisfied → re-fetch → grammar returns
            // properties for "value" → mock entities injected
            expect(dispatcher.getCommandCompletion).toHaveBeenCalledTimes(3);
            expect(menu.setChoices).toHaveBeenLastCalledWith(
                expect.arrayContaining([
                    expect.objectContaining({ matchText: "high" }),
                    expect.objectContaining({ matchText: "low" }),
                    expect.objectContaining({ matchText: "medium" }),
                ]),
            );
        });

        test("'set volume ' (with space) shows entity values in menu", async () => {
            session.update("", getPos);
            await flush();
            session.update("set", getPos);
            await flush();
            session.update("set volume", getPos);
            await flush();

            session.update("set volume ", getPos);

            expect(menu.isActive()).toBe(true);
            expect(menu.updatePrefix).toHaveBeenLastCalledWith(
                "",
                expect.anything(),
            );
        });

        test("'set volume m' narrows entity values to 'medium'", async () => {
            session.update("", getPos);
            await flush();
            session.update("set", getPos);
            await flush();
            session.update("set volume", getPos);
            await flush();

            session.update("set volume m", getPos);

            expect(menu.updatePrefix).toHaveBeenLastCalledWith(
                "m",
                expect.anything(),
            );
            expect(menu.isActive()).toBe(true);
        });
    });

    // ── Open wildcard / anchor sliding ───────────────────────────────

    describe("music grammar: open wildcard behavior", () => {
        let menu: TestSearchMenu;
        let dispatcher: ReturnType<typeof makeGrammarDispatcher>;
        let session: PartialCompletionSession;

        beforeEach(async () => {
            menu = makeMenu();
            dispatcher = makeGrammarDispatcher(musicGrammar, musicEntities);
            session = new PartialCompletionSession(menu, dispatcher);
        });

        test("after 'play X' typing more text slides anchor (openWildcard)", async () => {
            session.update("", getPos);
            await flush();
            session.update("play", getPos);
            await flush();

            // The entity trie has no match for "unknown" so with
            // closedSet=false, a re-fetch happens.
            session.update("play unknown", getPos);
            await flush();

            // Grammar at "play unknown" returns openWildcard=true, completions=["by"]
            // Further typing past the anchor without a separator should slide.
            const fetchCountBefore =
                dispatcher.getCommandCompletion.mock.calls.length;
            session.update("play unknown text", getPos);

            // openWildcard=true + non-separator after anchor → anchor slides
            // No new fetch — the session slides the anchor forward.
            expect(dispatcher.getCommandCompletion).toHaveBeenCalledTimes(
                fetchCountBefore,
            );
        });

        test("'by' keyword appears after wildcard text with space", async () => {
            session.update("", getPos);
            await flush();
            session.update("play", getPos);
            await flush();
            session.update("play unknown", getPos);
            await flush();

            // After typing space, the separator is satisfied and trie filters.
            session.update("play unknown ", getPos);

            expect(menu.updatePrefix).toHaveBeenLastCalledWith(
                "",
                expect.anything(),
            );
            expect(menu.isActive()).toBe(true);
        });
    });

    // ── Direction sensitivity ────────────────────────────────────────

    describe("direction sensitivity", () => {
        test("backward at direction-sensitive anchor triggers re-fetch", async () => {
            const menu = makeMenu();
            const dispatcher = makeGrammarDispatcher(
                musicGrammar,
                musicEntities,
            );
            const session = new PartialCompletionSession(menu, dispatcher);

            session.update("", getPos);
            await flush();
            session.update("play", getPos);
            await flush();

            // Grammar at "play" returns directionSensitive=true.
            // A backward update at the exact anchor should re-fetch.
            const fetchCountBefore =
                dispatcher.getCommandCompletion.mock.calls.length;
            session.update("play", getPos, "backward");

            expect(dispatcher.getCommandCompletion).toHaveBeenCalledTimes(
                fetchCountBefore + 1,
            );
            expect(dispatcher.getCommandCompletion).toHaveBeenLastCalledWith(
                "play",
                "backward",
            );
        });

        test("backward past anchor (typing beyond) does not re-fetch", async () => {
            const menu = makeMenu();
            const dispatcher = makeGrammarDispatcher(
                musicGrammar,
                musicEntities,
            );
            const session = new PartialCompletionSession(menu, dispatcher);

            session.update("", getPos);
            await flush();
            session.update("play", getPos);
            await flush();

            // Type past the anchor first.
            session.update("play ", getPos);
            const fetchCountBefore =
                dispatcher.getCommandCompletion.mock.calls.length;

            // Backward with text past the anchor — direction-sensitive
            // check only fires at exact anchor.
            session.update("play ", getPos, "backward");

            expect(dispatcher.getCommandCompletion).toHaveBeenCalledTimes(
                fetchCountBefore,
            );
        });
    });

    // ── getCompletionPrefix public API ───────────────────────────────

    describe("getCompletionPrefix with grammar results", () => {
        test("returns correct prefix after separator", async () => {
            const menu = makeMenu();
            const dispatcher = makeGrammarDispatcher(
                musicGrammar,
                musicEntities,
            );
            const session = new PartialCompletionSession(menu, dispatcher);

            session.update("", getPos);
            await flush();
            session.update("play", getPos);
            await flush();

            // anchor="play", separatorMode="spacePunctuation"
            expect(session.getCompletionPrefix("play ")).toBe("");
            expect(session.getCompletionPrefix("play sha")).toBe("sha");
        });

        test("returns undefined before separator is typed", async () => {
            const menu = makeMenu();
            const dispatcher = makeGrammarDispatcher(
                musicGrammar,
                musicEntities,
            );
            const session = new PartialCompletionSession(menu, dispatcher);

            session.update("", getPos);
            await flush();
            session.update("play", getPos);
            await flush();

            // No separator typed yet → prefix is undefined.
            expect(session.getCompletionPrefix("play")).toBeUndefined();
        });

        test("returns undefined when input diverged from anchor", async () => {
            const menu = makeMenu();
            const dispatcher = makeGrammarDispatcher(
                musicGrammar,
                musicEntities,
            );
            const session = new PartialCompletionSession(menu, dispatcher);

            session.update("", getPos);
            await flush();
            session.update("play", getPos);
            await flush();

            // Diverged — "pla" doesn't start with anchor "play"
            expect(session.getCompletionPrefix("pla")).toBeUndefined();
        });
    });
});

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

        // Keyword completions from the grammar — each grammar group
        // already carries its own separatorMode.
        for (const g of result.groups) {
            if (g.completions.length > 0) {
                completions.push({
                    name: "Keywords",
                    completions: g.completions,
                    separatorMode: g.separatorMode,
                });
            }
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
            closedSet: result.closedSet ?? true,
            directionSensitive: result.directionSensitive,
            afterWildcard: result.afterWildcard,
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

// Keyword-only grammar for trailing-separator session behavior tests.
const keywordGrammar = loadGrammarRules(
    "keyword.grammar",
    `<Start> = play music loudly -> true;`,
);

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
            await flush();

            // 'skip' exact-matches one entry → uniquelySatisfied → re-fetch
            expect(dispatcher.getCommandCompletion).toHaveBeenCalledTimes(2);
            expect(dispatcher.getCommandCompletion).toHaveBeenLastCalledWith(
                "skip",
                "forward",
            );
            // "skip" is terminal — no further completions, menu inactive.
            expect(menu.isActive()).toBe(false);
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
            // Entity group has separatorMode "space" → deferred until space typed.
            // Trie is preloaded with all items (no prior groups visible).
            expect(menu.setChoices).toHaveBeenLastCalledWith(
                expect.arrayContaining([
                    expect.objectContaining({ matchText: "Bohemian Rhapsody" }),
                    expect.objectContaining({ matchText: "Shake It Off" }),
                    expect.objectContaining({ matchText: "Shape of You" }),
                ]),
            );
            // Entities deferred (separatorMode "spacePunctuation", no separator typed).
            expect(menu.isActive()).toBe(false);
        });

        test("'play' with separator deferred — menu hidden until space typed", async () => {
            session.update("", getPos);
            await flush();
            session.update("play", getPos);
            await flush();

            // separatorMode="spacePunctuation" and rawPrefix="" → HIDE+KEEP
            expect(dispatcher.getCommandCompletion).toHaveBeenCalledTimes(2);
            expect(menu.isActive()).toBe(false);
        });

        test("'play ' (with space) shows entity completions", async () => {
            session.update("", getPos);
            await flush();
            session.update("play", getPos);
            await flush();

            // Trie was preloaded — no redundant setChoices after space.
            menu.setChoices.mockClear();
            session.update("play ", getPos);

            // No new fetch — trie already populated at anchor "play".
            expect(dispatcher.getCommandCompletion).toHaveBeenCalledTimes(2);
            expect(menu.setChoices).not.toHaveBeenCalled();
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

            // No new fetch — trie handles narrowing.
            expect(dispatcher.getCommandCompletion).toHaveBeenCalledTimes(2);
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
            await flush();

            // "Shake It Off" uniquely matches → re-fetch for next level
            expect(dispatcher.getCommandCompletion).toHaveBeenCalledTimes(3);
            expect(dispatcher.getCommandCompletion).toHaveBeenLastCalledWith(
                "play Shake It Off",
                "forward",
            );
            // Next-level "by" keyword deferred (separatorMode "spacePunctuation").
            expect(menu.isActive()).toBe(false);
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
            // separatorMode="spacePunctuation" → deferred until separator typed.
            // Trie is preloaded with all items (no prior groups visible).
            expect(menu.setChoices).toHaveBeenLastCalledWith(
                expect.arrayContaining([
                    expect.objectContaining({ matchText: "by" }),
                ]),
            );
            expect(menu.isActive()).toBe(false);

            // Type space → "by" becomes visible.
            // Trie was already preloaded — no redundant setChoices call.
            menu.setChoices.mockClear();
            session.update("play Shake It Off ", getPos);
            expect(menu.isActive()).toBe(true);
            expect(menu.setChoices).not.toHaveBeenCalled();
        });

        test("'by' keyword separator deferred, then shown with space", async () => {
            session.update("", getPos);
            await flush();
            session.update("play", getPos);
            await flush();
            session.update("play Shake It Off", getPos);
            await flush();

            // separatorMode="spacePunctuation", rawPrefix="" → deferred
            expect(dispatcher.getCommandCompletion).toHaveBeenCalledTimes(3);
            expect(menu.isActive()).toBe(false);

            // Type space — trie was preloaded, no redundant setChoices.
            menu.setChoices.mockClear();
            session.update("play Shake It Off ", getPos);
            expect(dispatcher.getCommandCompletion).toHaveBeenCalledTimes(3);
            expect(menu.setChoices).not.toHaveBeenCalled();
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
            expect(dispatcher.getCommandCompletion).toHaveBeenCalledTimes(4);
            expect(dispatcher.getCommandCompletion).toHaveBeenLastCalledWith(
                "play Shake It Off by",
                "forward",
            );
            // Entity values loaded but deferred (separatorMode "space",
            // rawPrefix "" → not visible yet).
            // Trie is preloaded with all items (no prior groups visible).
            expect(menu.setChoices).toHaveBeenLastCalledWith(
                expect.arrayContaining([
                    expect.objectContaining({ matchText: "Ed Sheeran" }),
                    expect.objectContaining({ matchText: "Queen" }),
                    expect.objectContaining({ matchText: "Taylor Swift" }),
                ]),
            );
            // Entities deferred (separatorMode "spacePunctuation").
            expect(menu.isActive()).toBe(false);
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
            // No new fetch — trie handles narrowing.
            expect(dispatcher.getCommandCompletion).toHaveBeenCalledTimes(4);
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

            expect(dispatcher.getCommandCompletion).toHaveBeenCalledTimes(1);
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
            // with separatorMode "spacePunctuation" → deferred.
            expect(dispatcher.getCommandCompletion).toHaveBeenCalledTimes(2);
            // Trie is preloaded with all items (no prior groups visible).
            expect(menu.setChoices).toHaveBeenLastCalledWith(
                expect.arrayContaining([
                    expect.objectContaining({ matchText: "brightness" }),
                    expect.objectContaining({ matchText: "volume" }),
                ]),
            );
            // Properties deferred (separatorMode "spacePunctuation").
            expect(menu.isActive()).toBe(false);
        });

        test("'set v' narrows property alternatives via trie", async () => {
            session.update("", getPos);
            await flush();
            session.update("set", getPos);
            await flush();

            session.update("set v", getPos);

            // No new fetch — trie handles narrowing.
            expect(dispatcher.getCommandCompletion).toHaveBeenCalledTimes(2);
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
            // Entity group has separatorMode "space" → deferred.
            // Trie is preloaded with all items (no prior groups visible).
            expect(menu.setChoices).toHaveBeenLastCalledWith(
                expect.arrayContaining([
                    expect.objectContaining({ matchText: "high" }),
                    expect.objectContaining({ matchText: "low" }),
                    expect.objectContaining({ matchText: "medium" }),
                ]),
            );
            // Entities deferred (separatorMode "spacePunctuation").
            expect(menu.isActive()).toBe(false);
        });

        test("'set volume ' (with space) shows entity values in menu", async () => {
            session.update("", getPos);
            await flush();
            session.update("set", getPos);
            await flush();
            session.update("set volume", getPos);
            await flush();

            // Trie was preloaded — no redundant setChoices after space.
            menu.setChoices.mockClear();
            session.update("set volume ", getPos);

            // No new fetch — trie already populated at anchor "set volume".
            expect(dispatcher.getCommandCompletion).toHaveBeenCalledTimes(3);
            expect(menu.setChoices).not.toHaveBeenCalled();
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

            // No new fetch — trie handles narrowing.
            expect(dispatcher.getCommandCompletion).toHaveBeenCalledTimes(3);
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

        // Prime the session through "play unknown" so the wildcard
        // is active and the keyword trie is populated.
        async function primeWildcard(): Promise<void> {
            session.update("", getPos);
            await flush();
            session.update("play", getPos);
            await flush();
            session.update("play unknown", getPos);
            await flush();
        }

        test("after 'play X' typing more text slides anchor (afterWildcard)", async () => {
            await primeWildcard();

            // Grammar at "play unknown" returns afterWildcard="all", completions=["by"]
            // Further typing past the anchor without a separator should slide.
            const fetchCountBefore =
                dispatcher.getCommandCompletion.mock.calls.length;
            session.update("play unknown text", getPos);

            // afterWildcard="all" + non-separator after anchor → anchor slides
            // No new fetch — the session slides the anchor forward.
            expect(dispatcher.getCommandCompletion).toHaveBeenCalledTimes(
                fetchCountBefore,
            );
            // Sliding hides the menu (no separator typed).
            expect(menu.isActive()).toBe(false);
        });

        test("'by' keyword appears after wildcard text with space", async () => {
            await primeWildcard();

            const fetchCountAfterPrime =
                dispatcher.getCommandCompletion.mock.calls.length;

            // Trie was preloaded — no redundant setChoices after space.
            menu.setChoices.mockClear();
            // After typing space, the separator is satisfied and trie filters.
            session.update("play unknown ", getPos);

            // No new fetch — trie already populated at anchor.
            expect(dispatcher.getCommandCompletion).toHaveBeenCalledTimes(
                fetchCountAfterPrime,
            );
            expect(menu.setChoices).not.toHaveBeenCalled();
            expect(menu.updatePrefix).toHaveBeenLastCalledWith(
                "",
                expect.anything(),
            );
            expect(menu.isActive()).toBe(true);
        });

        test("'play unknown b' narrows keyword to 'by' via trie", async () => {
            await primeWildcard();

            const fetchCountBefore =
                dispatcher.getCommandCompletion.mock.calls.length;

            // Typing past the separator — trie prefix "b" narrows to "by".
            session.update("play unknown b", getPos);

            expect(dispatcher.getCommandCompletion).toHaveBeenCalledTimes(
                fetchCountBefore,
            );
            expect(menu.updatePrefix).toHaveBeenLastCalledWith(
                "b",
                expect.anything(),
            );
            // The trie should show "by" as a narrowed match.
            expect(menu.setChoices).toHaveBeenLastCalledWith(
                expect.arrayContaining([
                    expect.objectContaining({ matchText: "by" }),
                ]),
            );
            expect(menu.isActive()).toBe(true);
        });

        test("'play unknown ' → 'play unknown' → 'play unknown ' round-trip", async () => {
            await primeWildcard();

            session.update("play unknown ", getPos);
            expect(menu.isActive()).toBe(true);

            // Backspace hides.
            session.update("play unknown", getPos);
            expect(menu.isActive()).toBe(false);

            const fetchCountBefore =
                dispatcher.getCommandCompletion.mock.calls.length;

            // Re-type space — menu reappears without re-fetch.
            session.update("play unknown ", getPos);
            expect(menu.isActive()).toBe(true);
            expect(dispatcher.getCommandCompletion).toHaveBeenCalledTimes(
                fetchCountBefore,
            );
        });

        test("double space 'play unknown  ' shows keyword menu", async () => {
            await primeWildcard();

            const fetchCountAfterPrime =
                dispatcher.getCommandCompletion.mock.calls.length;

            session.update("play unknown  ", getPos);

            // No new fetch — extra space does not trigger re-fetch.
            expect(dispatcher.getCommandCompletion).toHaveBeenCalledTimes(
                fetchCountAfterPrime,
            );
            // Extra space should not break the trie display.
            expect(menu.isActive()).toBe(true);
        });

        test("wildcard extends across word boundaries — slide, show, slide, show", async () => {
            await primeWildcard();

            const fetchCountAfterPrime =
                dispatcher.getCommandCompletion.mock.calls.length;

            // 1. Space after wildcard: separator satisfied, menu shows "by".
            session.update("play unknown ", getPos);
            expect(menu.isActive()).toBe(true);
            expect(dispatcher.getCommandCompletion).toHaveBeenCalledTimes(
                fetchCountAfterPrime,
            );

            // 2. Non-separator 't' after separator: the trie has no match
            //    for "t" (only "by"), so noMatchPolicy="slide" slides anchor.
            session.update("play unknown t", getPos);
            expect(menu.isActive()).toBe(false);
            expect(dispatcher.getCommandCompletion).toHaveBeenCalledTimes(
                fetchCountAfterPrime,
            );

            // 3. Continue typing the second word — still sliding.
            session.update("play unknown text", getPos);
            expect(dispatcher.getCommandCompletion).toHaveBeenCalledTimes(
                fetchCountAfterPrime,
            );

            // 4. Another space: separator satisfied again, menu reappears
            //    with "by" from the cached trie.
            session.update("play unknown text ", getPos);
            expect(menu.isActive()).toBe(true);
            expect(menu.updatePrefix).toHaveBeenLastCalledWith(
                "",
                expect.anything(),
            );
            expect(dispatcher.getCommandCompletion).toHaveBeenCalledTimes(
                fetchCountAfterPrime,
            );
        });

        test("wildcard → keyword → entity: 'play unknown by' shows artist entities", async () => {
            await primeWildcard();

            // "by" uniquely satisfies the keyword → re-fetch.
            session.update("play unknown by", getPos);
            await flush();

            expect(dispatcher.getCommandCompletion).toHaveBeenLastCalledWith(
                "play unknown by",
                "forward",
            );
            // Grammar returns artist properties → mock entities injected.
            // Entity group has separatorMode "space" → deferred at anchor.
            // Trie is preloaded with all items (no prior groups visible).
            expect(menu.setChoices).toHaveBeenLastCalledWith(
                expect.arrayContaining([
                    expect.objectContaining({ matchText: "Ed Sheeran" }),
                    expect.objectContaining({ matchText: "Queen" }),
                    expect.objectContaining({ matchText: "Taylor Swift" }),
                ]),
            );
            // Entities deferred (separatorMode "spacePunctuation").
            expect(menu.isActive()).toBe(false);
        });
    });

    // ── Cross-rule afterWildcard AND-merge ─────────────────────────────
    //
    // Regression test: when a wildcard rule and a literal keyword rule
    // both produce string completions at the same matchedPrefixLength,
    // afterWildcard should be "none" (AND-merge).  The shell should
    // re-fetch instead of sliding when the user types into the wildcard,
    // so that the literal keyword's stale completion is replaced by
    // fresh results at the new position.

    describe("cross-rule afterWildcard AND-merge", () => {
        // Rule A: play $(name) by $(artist) — wildcard rule
        // Rule B: play beautiful music       — literal keyword rule
        const crossRuleGrammar = loadGrammarRules(
            "crossrule.grammar",
            [
                `import { SongName, ArtistName };`,
                `<Start> = play $(song:SongName) by $(artist:ArtistName) -> { actionName: "playBy", parameters: { song, artist } };`,
                `<Start> = play beautiful music -> "playBeautifulMusic";`,
            ].join("\n"),
        );

        let menu: TestSearchMenu;
        let dispatcher: ReturnType<typeof makeGrammarDispatcher>;
        let session: PartialCompletionSession;

        beforeEach(async () => {
            menu = makeMenu();
            dispatcher = makeGrammarDispatcher(crossRuleGrammar);
            session = new PartialCompletionSession(menu, dispatcher);
        });

        test("'play beautiful' has afterWildcard=\"some\" — mixed candidates deferred", async () => {
            session.update("play beautiful", getPos);
            await flush();

            expect(dispatcher.getCommandCompletion).toHaveBeenCalledTimes(1);
            // Both rules contribute at mpl=14:
            //   "music" from Rule B (literal, position-sensitive)
            //   "by" from Rule A (wildcard-stable)
            // afterWildcard="some" → noMatchPolicy="refetch"
            // separatorMode="spacePunctuation" → items deferred at anchor.
            // Trie is preloaded with all items (no prior groups visible).
            expect(menu.setChoices).toHaveBeenLastCalledWith(
                expect.arrayContaining([
                    expect.objectContaining({ matchText: "music" }),
                    expect.objectContaining({ matchText: "by" }),
                ]),
            );
            expect(menu.isActive()).toBe(false);

            // Type space → items become visible.
            // Trie was already preloaded — no redundant setChoices call.
            menu.setChoices.mockClear();
            session.update("play beautiful ", getPos);
            expect(dispatcher.getCommandCompletion).toHaveBeenCalledTimes(1);
            expect(menu.isActive()).toBe(true);
            expect(menu.setChoices).not.toHaveBeenCalled();
        });

        test("typing into wildcard triggers re-fetch, not slide", async () => {
            session.update("play beautiful", getPos);
            await flush();

            const fetchCountAfterPrime =
                dispatcher.getCommandCompletion.mock.calls.length;

            // Type a non-separator char past the anchor.
            // With afterWildcard="none" (AND-merge), this should re-fetch
            // instead of sliding — the anchor is no longer valid.
            session.update("play beautifull", getPos);

            // A re-fetch should have been triggered.
            expect(dispatcher.getCommandCompletion).toHaveBeenCalledTimes(
                fetchCountAfterPrime + 1,
            );
        });

        test("re-fetch at new position drops stale literal completion", async () => {
            session.update("play beautiful", getPos);
            await flush();

            // Type more — triggers re-fetch since afterWildcard="some".
            session.update("play beautifull", getPos);
            await flush();

            expect(dispatcher.getCommandCompletion).toHaveBeenCalledTimes(2);
            // At "play beautifull", only the wildcard rule contributes.
            // "music" should be gone — it was position-sensitive to
            // "play beautiful" (exact partial match of Rule B).
            // Trie is preloaded with only "by" (no "music").
            expect(menu.setChoices).toHaveBeenLastCalledWith(
                expect.arrayContaining([
                    expect.objectContaining({ matchText: "by" }),
                ]),
            );
            expect(menu.setChoices).not.toHaveBeenLastCalledWith(
                expect.arrayContaining([
                    expect.objectContaining({ matchText: "music" }),
                ]),
            );
            expect(menu.isActive()).toBe(false);

            // Type space → items become visible.
            // Trie was already preloaded — no redundant setChoices call.
            menu.setChoices.mockClear();
            session.update("play beautifull ", getPos);
            expect(dispatcher.getCommandCompletion).toHaveBeenCalledTimes(2);
            expect(menu.isActive()).toBe(true);
            expect(menu.setChoices).not.toHaveBeenCalled();
        });

        test("space then non-matching prefix triggers re-fetch (afterWildcard some)", async () => {
            session.update("play beautiful", getPos);
            await flush();

            // Space satisfies the separator — menu shows both entries.
            session.update("play beautiful ", getPos);
            expect(menu.isActive()).toBe(true);

            const fetchCountBefore =
                dispatcher.getCommandCompletion.mock.calls.length;

            // "s" doesn't match any trie entry ("music", "by").
            // afterWildcard="some" → noMatchPolicy="refetch" → re-fetch.
            session.update("play beautiful s", getPos);
            expect(dispatcher.getCommandCompletion).toHaveBeenCalledTimes(
                fetchCountBefore + 1,
            );
        });

        test("space then matching prefix narrows trie to valid entry", async () => {
            session.update("play beautiful", getPos);
            await flush();

            // Space → menu shows "music" and "by".
            session.update("play beautiful ", getPos);
            expect(dispatcher.getCommandCompletion).toHaveBeenCalledTimes(1);
            expect(menu.isActive()).toBe(true);

            // "b" matches "by" in the trie — no new fetch.
            session.update("play beautiful b", getPos);
            expect(dispatcher.getCommandCompletion).toHaveBeenCalledTimes(1);
            expect(menu.isActive()).toBe(true);

            // Verify the trie filtered to only "by".
            expect(menu.updatePrefix).toHaveBeenLastCalledWith(
                "b",
                expect.anything(),
            );
        });

        test('single-rule wildcard still slides (afterWildcard="all")', async () => {
            // "play hello" — only the wildcard rule matches, no literal
            // rule conflict.  afterWildcard="all" → sliding works.
            session.update("play hello", getPos);
            await flush();

            const fetchCountAfterPrime =
                dispatcher.getCommandCompletion.mock.calls.length;

            // Type more text — should NOT re-fetch, anchor slides.
            session.update("play hello world", getPos);
            expect(dispatcher.getCommandCompletion).toHaveBeenCalledTimes(
                fetchCountAfterPrime,
            );
            // Sliding hides the menu (no separator typed).
            expect(menu.isActive()).toBe(false);

            // After separator, "by" reappears from the cached trie.
            session.update("play hello world ", getPos);
            expect(dispatcher.getCommandCompletion).toHaveBeenCalledTimes(
                fetchCountAfterPrime,
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
            await flush();

            expect(dispatcher.getCommandCompletion).toHaveBeenCalledTimes(
                fetchCountBefore + 1,
            );
            expect(dispatcher.getCommandCompletion).toHaveBeenLastCalledWith(
                "play",
                "backward",
            );
            // Entities deferred after backward re-fetch.
            expect(menu.isActive()).toBe(false);
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
            // Menu still active — separator present, entity items visible.
            expect(menu.isActive()).toBe(true);
        });
    });

    // ── Trailing-separator session behavior (keyword-only grammar) ───

    describe("keyword grammar: trailing-separator session behavior", () => {
        let menu: TestSearchMenu;
        let dispatcher: ReturnType<typeof makeGrammarDispatcher>;
        let session: PartialCompletionSession;

        beforeEach(async () => {
            menu = makeMenu();
            dispatcher = makeGrammarDispatcher(keywordGrammar, {});
            session = new PartialCompletionSession(menu, dispatcher);
        });

        test("backspace from 'play ' to 'play' hides menu, no re-fetch", async () => {
            session.update("", getPos);
            await flush();
            session.update("play", getPos);
            await flush();
            session.update("play ", getPos);

            const fetchCountBefore =
                dispatcher.getCommandCompletion.mock.calls.length;

            // Backspace removes the space.
            session.update("play", getPos);
            expect(menu.isActive()).toBe(false);

            // No re-fetch — previous result still valid at anchor "play".
            expect(dispatcher.getCommandCompletion).toHaveBeenCalledTimes(
                fetchCountBefore,
            );
        });

        test("'play ' → 'play' → 'play ' round-trip shows menu again", async () => {
            session.update("", getPos);
            await flush();
            session.update("play", getPos);
            await flush();

            session.update("play ", getPos);
            expect(menu.isActive()).toBe(true);
            expect(menu.setChoices).toHaveBeenLastCalledWith(
                expect.arrayContaining([
                    expect.objectContaining({ matchText: "music" }),
                ]),
            );

            // Backspace to "play"
            session.update("play", getPos);
            expect(menu.isActive()).toBe(false);

            // Re-type space — menu should reappear without re-fetch.
            session.update("play ", getPos);
            expect(dispatcher.getCommandCompletion).toHaveBeenCalledTimes(2);
            expect(menu.isActive()).toBe(true);
        });

        test("'play ' → 'pla' diverges anchor → re-fetches", async () => {
            session.update("", getPos);
            await flush();
            session.update("play", getPos);
            await flush();

            const fetchCountBefore =
                dispatcher.getCommandCompletion.mock.calls.length;
            session.update("pla", getPos);

            // Input is shorter than anchor — anchor diverged → re-fetch.
            expect(dispatcher.getCommandCompletion).toHaveBeenCalledTimes(
                fetchCountBefore + 1,
            );
        });

        test("double space 'play  ' strips separator and shows menu", async () => {
            session.update("", getPos);
            await flush();
            session.update("play", getPos);
            await flush();

            session.update("play  ", getPos);

            // No new fetch — double space does not trigger re-fetch.
            expect(dispatcher.getCommandCompletion).toHaveBeenCalledTimes(2);
            // The extra space should not leak into the trie filter.
            // Menu should be active with "music" offered.
            expect(menu.isActive()).toBe(true);
            expect(menu.setChoices).toHaveBeenLastCalledWith(
                expect.arrayContaining([
                    expect.objectContaining({ matchText: "music" }),
                ]),
            );
        });
    });

    // ── Trailing-separator with entity transitions ───────────────────

    describe("music grammar: trailing-separator entity behavior", () => {
        let menu: TestSearchMenu;
        let dispatcher: ReturnType<typeof makeGrammarDispatcher>;
        let session: PartialCompletionSession;

        beforeEach(async () => {
            menu = makeMenu();
            dispatcher = makeGrammarDispatcher(musicGrammar, musicEntities);
            session = new PartialCompletionSession(menu, dispatcher);
        });

        test("backspace from 'play ' to 'play' hides entity menu, no re-fetch", async () => {
            session.update("", getPos);
            await flush();
            session.update("play", getPos);
            await flush();
            session.update("play ", getPos);

            const fetchCountBefore =
                dispatcher.getCommandCompletion.mock.calls.length;

            // Backspace removes the space — entity menu should hide.
            session.update("play", getPos);
            expect(menu.isActive()).toBe(false);

            expect(dispatcher.getCommandCompletion).toHaveBeenCalledTimes(
                fetchCountBefore,
            );
        });

        test("double space 'play  ' shows entity completions", async () => {
            session.update("", getPos);
            await flush();
            session.update("play", getPos);
            await flush();

            session.update("play  ", getPos);

            // No new fetch — double space does not trigger re-fetch.
            expect(dispatcher.getCommandCompletion).toHaveBeenCalledTimes(2);
            // Double space should not break entity display.
            expect(menu.isActive()).toBe(true);
            expect(menu.setChoices).toHaveBeenLastCalledWith(
                expect.arrayContaining([
                    expect.objectContaining({ matchText: "Bohemian Rhapsody" }),
                    expect.objectContaining({ matchText: "Shake It Off" }),
                    expect.objectContaining({ matchText: "Shape of You" }),
                ]),
            );
        });

        test("unknown prefix 'play xyz' triggers re-fetch (closedSet=false)", async () => {
            session.update("", getPos);
            await flush();
            session.update("play", getPos);
            await flush();

            // "xyz" doesn't match any entity in the trie.
            // closedSet=false → C1 re-fetch.
            session.update("play xyz", getPos);
            await flush();

            expect(dispatcher.getCommandCompletion).toHaveBeenCalledTimes(3);
            expect(dispatcher.getCommandCompletion).toHaveBeenLastCalledWith(
                "play xyz",
                "forward",
            );
        });
    });

    // ── Open wildcard trailing-separator behavior ────────────────────

    describe("music grammar: wildcard backspace behavior", () => {
        test("backspace from 'play unknown ' to 'play unknown' hides menu, no re-fetch", async () => {
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
            session.update("play unknown", getPos);
            await flush();
            session.update("play unknown ", getPos);

            const fetchCountBefore =
                dispatcher.getCommandCompletion.mock.calls.length;

            // Backspace removes the space after wildcard text.
            session.update("play unknown", getPos);
            expect(menu.isActive()).toBe(false);

            expect(dispatcher.getCommandCompletion).toHaveBeenCalledTimes(
                fetchCountBefore,
            );
        });
    });

    // ── Separator-mode conflict filtering ──────────────────────────────
    //
    // When a spacing=none rule and a default-spacing (auto) rule both
    // match the same prefix, the grammar reports a separator conflict:
    //   - No trailing separator: none-mode candidates survive, closedSet=false
    //   - Trailing separator: requiring-mode candidates survive, P advances by 1
    //
    // These tests verify the session handles the conflict metadata
    // correctly: anchor positioning, re-fetch on backspace, and proper
    // trie filtering.

    describe("separator-mode conflict: spacing=none + auto alternation", () => {
        // NoneRule needs no separator ("abcd"), AutoRule needs one ("ab cd").
        // Both produce completion "cd" at P=2, but with incompatible sep modes.
        const conflictGrammar = loadGrammarRules(
            "conflict.grammar",
            [
                `<NoneRule> [spacing=none] = ab cd -> "none";`,
                `<AutoRule> = ab cd -> "auto";`,
                `<Start> = $(x:<NoneRule>) -> x | $(x:<AutoRule>) -> x;`,
            ].join("\n"),
        );

        let menu: TestSearchMenu;
        let dispatcher: ReturnType<typeof makeGrammarDispatcher>;
        let session: PartialCompletionSession;

        beforeEach(async () => {
            menu = makeMenu();
            dispatcher = makeGrammarDispatcher(conflictGrammar, {});
            session = new PartialCompletionSession(menu, dispatcher);
        });

        test("'ab' no trailing sep: none-mode completions, closedSet=false", async () => {
            session.update("ab", getPos);
            await flush();

            // Grammar reports: completions=["cd"], separatorMode="none",
            // closedSet=false (candidates were dropped).
            expect(dispatcher.getCommandCompletion).toHaveBeenCalledTimes(1);
            expect(menu.setChoices).toHaveBeenLastCalledWith(
                expect.arrayContaining([
                    expect.objectContaining({ matchText: "cd" }),
                ]),
            );
            // separatorMode="none" means menu is active immediately
            // (no separator needed).
            expect(menu.isActive()).toBe(true);
        });

        test("'ab ' trailing sep: both groups visible, no re-fetch (closedSet=true)", async () => {
            session.update("ab", getPos);
            await flush();

            // "none" group is immediately visible — no preload.
            expect(dispatcher.getCommandCompletion).toHaveBeenCalledTimes(1);
            expect(menu.isActive()).toBe(true);

            // Type space — in the per-group model, both groups are
            // preserved (closedSet=true). The "none" mode "cd" was already
            // visible; now the "spacePunctuation" mode "cd" also becomes
            // visible. Both groups are loaded at the same anchor — no re-fetch.
            menu.setChoices.mockClear();
            session.update("ab ", getPos);

            // No new fetch — both groups already loaded at anchor "ab".
            expect(dispatcher.getCommandCompletion).toHaveBeenCalledTimes(1);
            // setChoices IS called again (visibility changed — more items now visible).
            expect(menu.setChoices).toHaveBeenCalledWith(
                expect.arrayContaining([
                    expect.objectContaining({ matchText: "cd" }),
                ]),
            );
            expect(menu.updatePrefix).toHaveBeenLastCalledWith(
                "",
                expect.anything(),
            );
            expect(menu.isActive()).toBe(true);
        });

        test("backspace from 'ab ' to 'ab': reuses session (anchor unchanged)", async () => {
            session.update("ab", getPos);
            await flush();
            session.update("ab ", getPos);

            // In the per-group model, no re-fetch happened at "ab "
            // (both groups preserved, closedSet=true → noMatchPolicy=accept).
            // Anchor is still "ab". Backspace to "ab" is at the anchor.
            session.update("ab", getPos);

            // No re-fetch — same anchor, same session.
            expect(dispatcher.getCommandCompletion).toHaveBeenCalledTimes(1);
            // "none" mode "cd" is still visible; "spacePunctuation" mode
            // "cd" is hidden (separator removed). Menu shows "cd".
            expect(menu.isActive()).toBe(true);
        });

        test("double space 'ab  ': optional mode strips extra space, menu stays visible", async () => {
            session.update("ab", getPos);
            await flush();
            session.update("ab ", getPos);
            await flush();

            // Double space: anchor is "ab " (P=3), rawPrefix=" " (second space).
            // separatorMode="optionalSpacePunctuation" → needsSep=false, but "optionalSpacePunctuation"
            // still strips leading whitespace → completionPrefix="".
            // Empty prefix matches all completions → menu shows.
            session.update("ab  ", getPos);
            await flush();

            // No new fetch — both groups already loaded at anchor "ab".
            expect(dispatcher.getCommandCompletion).toHaveBeenCalledTimes(1);
            expect(menu.updatePrefix).toHaveBeenLastCalledWith(
                "",
                expect.anything(),
            );
            expect(menu.isActive()).toBe(true);
        });

        test("'ab c' partial match narrows trie to 'cd'", async () => {
            session.update("ab", getPos);
            await flush();

            // 'abc' without separator: closedSet=false, "c" doesn't match "cd"
            // in the trie (anchor is "ab", separatorMode="none", rawPrefix="c")
            // → trie prefix "c" narrows to "cd".
            session.update("abc", getPos);

            // No new fetch — trie handles narrowing.
            expect(dispatcher.getCommandCompletion).toHaveBeenCalledTimes(1);
            expect(menu.updatePrefix).toHaveBeenLastCalledWith(
                "c",
                expect.anything(),
            );
            expect(menu.isActive()).toBe(true);
        });

        test("'ab ' → 'ab c' narrows to 'cd' via trie", async () => {
            session.update("ab", getPos);
            await flush();
            session.update("ab ", getPos);
            await flush();

            // At anchor "ab " (P=3), separatorMode="optionalSpacePunctuation",
            // rawPrefix="c" → trie prefix "c" → matches "cd".
            session.update("ab c", getPos);

            // No new fetch — trie handles narrowing.
            expect(dispatcher.getCommandCompletion).toHaveBeenCalledTimes(1);
            expect(menu.updatePrefix).toHaveBeenLastCalledWith(
                "c",
                expect.anything(),
            );
            expect(menu.isActive()).toBe(true);
        });
    });

    // ── SepLevel transitions with real grammar output ────────────────

    describe("SepLevel transitions with conflict grammar", () => {
        // The conflict grammar has two rules for "ab cd":
        //   NoneRule [spacing=none]: separatorMode="none" → level 0 only
        //   AutoRule:                separatorMode="space" → level 1 only
        // This produces two groups at different SepLevels.

        let menu: TestSearchMenu;
        let dispatcher: ReturnType<typeof makeGrammarDispatcher>;
        let session: PartialCompletionSession;

        const conflictGrammar2 = loadGrammarRules(
            "conflict2.grammar",
            [
                `<NoneRule> [spacing=none] = ab cd -> "none";`,
                `<AutoRule> = ab cd -> "auto";`,
                `<Start> = $(x:<NoneRule>) -> x | $(x:<AutoRule>) -> x;`,
            ].join("\n"),
        );

        beforeEach(async () => {
            menu = makeMenu();
            dispatcher = makeGrammarDispatcher(conflictGrammar2, {});
            session = new PartialCompletionSession(menu, dispatcher);
        });

        test("widen: 'ab' at level 0, type space widens to level 1", async () => {
            session.update("ab", getPos);
            await flush();

            // "ab" → none-mode "cd" at level 0. Menu active.
            expect(menu.isActive()).toBe(true);

            // Type space: rawPrefix=" ", sepLevel=1, menuSepLevel=0.
            // " " doesn't match "cd" at level 0 → C3 fails.
            // D1: sepLevel(1) > menuSepLevel(0) → widen to 1.
            // Level 1: space-mode "cd". Trie reloaded.
            menu.setChoices.mockClear();
            session.update("ab ", getPos);
            // Exactly one setChoices for the widen reload.
            expect(menu.setChoices).toHaveBeenCalledTimes(1);
            expect(menu.isActive()).toBe(true);
            expect(menu.updatePrefix).toHaveBeenLastCalledWith(
                "",
                expect.anything(),
            );
            expect(dispatcher.getCommandCompletion).toHaveBeenCalledTimes(1);
        });

        test("narrow: 'ab ' back to 'ab' reloads level-0 trie", async () => {
            session.update("ab", getPos);
            await flush();

            // Widen to level 1.
            session.update("ab ", getPos);
            expect(menu.isActive()).toBe(true);

            // Backspace to "ab": sepLevel=0 < menuSepLevel=1.
            // B1: items at level 0 (none-mode "cd") → NARROW.
            menu.setChoices.mockClear();
            session.update("ab", getPos);
            // Exactly one setChoices for the narrow reload.
            expect(menu.setChoices).toHaveBeenCalledTimes(1);
            expect(menu.isActive()).toBe(true);
            expect(dispatcher.getCommandCompletion).toHaveBeenCalledTimes(1);
        });

        test("narrow/widen round-trip: level transitions are idempotent", async () => {
            session.update("ab", getPos);
            await flush();

            // Cycle: 0 → 1 → 0 → 1
            session.update("ab ", getPos); // widen to 1
            session.update("ab", getPos); // narrow to 0
            session.update("ab ", getPos); // widen to 1 again

            expect(menu.isActive()).toBe(true);
            expect(menu.updatePrefix).toHaveBeenLastCalledWith(
                "",
                expect.anything(),
            );
            // No re-fetches through the entire round-trip.
            expect(dispatcher.getCommandCompletion).toHaveBeenCalledTimes(1);
        });

        test("trie narrows correctly after widen", async () => {
            session.update("ab", getPos);
            await flush();

            // Widen to level 1.
            session.update("ab ", getPos);
            expect(menu.isActive()).toBe(true);

            // Type "c": trie prefix "c" narrows to "cd".
            // No setChoices — trie already loaded at level 1.
            menu.setChoices.mockClear();
            session.update("ab c", getPos);
            expect(menu.isActive()).toBe(true);
            expect(menu.updatePrefix).toHaveBeenLastCalledWith(
                "c",
                expect.anything(),
            );
            expect(menu.setChoices).not.toHaveBeenCalled();
            expect(dispatcher.getCommandCompletion).toHaveBeenCalledTimes(1);
        });

        test("trie narrows at level 0 without separator", async () => {
            session.update("ab", getPos);
            await flush();

            // At level 0, none-mode "cd" visible.
            // Type "c" without separator: trie prefix "c" → "cd".
            // No setChoices — trie already loaded at level 0.
            menu.setChoices.mockClear();
            session.update("abc", getPos);
            expect(menu.isActive()).toBe(true);
            expect(menu.updatePrefix).toHaveBeenLastCalledWith(
                "c",
                expect.anything(),
            );
            expect(menu.setChoices).not.toHaveBeenCalled();
            expect(dispatcher.getCommandCompletion).toHaveBeenCalledTimes(1);
        });

        test("initial fetch with separator: 'ab ' widens on first reuseSession", async () => {
            // Start with the space already typed — the session's first
            // reuseSession (called at the end of startNewSession) must
            // widen from the lowestLevelWithItems (level 0) to level 1.
            session.update("ab ", getPos);
            await flush();

            expect(dispatcher.getCommandCompletion).toHaveBeenCalledTimes(1);
            // startNewSession: lowestLevelWithItems → 0 (none-mode "cd"),
            // but inputSepLevel=1 → skip ahead to level 1 (space-mode "cd").
            // loadLevel loads level-1 items directly.  reuseSession runs
            // with rawPrefix=" ", sepLevel=1 = menuSepLevel(1) → C succeeds.
            expect(menu.isActive()).toBe(true);
            expect(menu.updatePrefix).toHaveBeenLastCalledWith(
                "",
                expect.anything(),
            );
            // startNewSession skips the intermediate lv0 load and
            // jumps directly to lv1 (the target level for sepLevel=1).
            // Two setChoices: initial clear + loadLevel at lv1.
            expect(menu.setChoices).toHaveBeenCalledTimes(2);

            // Narrow back to "ab": level 0 reloaded.
            menu.setChoices.mockClear();
            session.update("ab", getPos);
            expect(menu.setChoices).toHaveBeenCalledTimes(1);
            expect(menu.isActive()).toBe(true);
            expect(dispatcher.getCommandCompletion).toHaveBeenCalledTimes(1);
        });
    });

    describe("SepLevel transitions with music grammar", () => {
        let menu: TestSearchMenu;
        let dispatcher: ReturnType<typeof makeGrammarDispatcher>;
        let session: PartialCompletionSession;

        beforeEach(async () => {
            menu = makeMenu();
            dispatcher = makeGrammarDispatcher(musicGrammar, musicEntities);
            session = new PartialCompletionSession(menu, dispatcher);
        });

        test("entity level: skip-ahead to level 1, B2 hides at anchor", async () => {
            // Navigate to entity level.
            session.update("", getPos);
            await flush();
            session.update("play", getPos);
            await flush();

            // After 'play' uniquely satisfies, re-fetch returns entities
            // with separatorMode="spacePunctuation" → level 1+.
            // lowestLevelWithItems → 1. menuSepLevel=1.
            // rawPrefix="" → sepLevel=0 < menuSepLevel=1 → B2, hidden.
            expect(menu.isActive()).toBe(false);

            // Type space → sepLevel=1 = menuSepLevel → C: entities shown.
            // No setChoices — trie already loaded at level 1 by startNewSession.
            menu.setChoices.mockClear();
            session.update("play ", getPos);
            expect(menu.isActive()).toBe(true);
            expect(menu.setChoices).not.toHaveBeenCalled();
        });

        test("entity level: punctuation triggers re-fetch (entities are default/space mode)", async () => {
            session.update("", getPos);
            await flush();
            session.update("play", getPos);
            await flush();

            const fetchCountBefore =
                dispatcher.getCommandCompletion.mock.calls.length;

            // Entity group has separatorMode=undefined → level 1 only.
            // Type punctuation: sepLevel=2 > menuSepLevel=1.
            // Level 1 trie has entities, prefix=trimStart(".")="." → no match.
            // D1: try widen to 2, but no items at level 2 (undefined ≡ space).
            // D3: noMatchPolicy="refetch" (closedSet=false) → re-fetch.
            session.update("play.", getPos);
            expect(dispatcher.getCommandCompletion).toHaveBeenCalledTimes(
                fetchCountBefore + 1,
            );
        });

        test("keyword level: backspace from entity to keyword hides menu", async () => {
            session.update("", getPos);
            await flush();
            session.update("play", getPos);
            await flush();
            session.update("play ", getPos);
            expect(menu.isActive()).toBe(true); // entities shown

            // Backspace to "play" — separator removed.
            // rawPrefix="" → sepLevel=0 < menuSepLevel(1).
            // B2: no items at level 0 (entities are spacePunctuation) → hide.
            session.update("play", getPos);
            expect(menu.isActive()).toBe(false);

            // Re-type space: menu reappears.
            // No setChoices — trie stays loaded at level 1 through B2.
            menu.setChoices.mockClear();
            session.update("play ", getPos);
            expect(menu.isActive()).toBe(true);
            expect(menu.setChoices).not.toHaveBeenCalled();
        });

        test("getCompletionPrefix tracks menuSepLevel correctly", async () => {
            session.update("", getPos);
            await flush();
            session.update("play", getPos);
            await flush();

            // At anchor "play", menuSepLevel=1 (entities are default/space mode).
            // No separator typed: sepLevel(0) < menuSepLevel(1) → undefined.
            expect(session.getCompletionPrefix("play")).toBeUndefined();

            // Space typed: sepLevel(1) >= menuSepLevel(1) → stripped prefix.
            expect(session.getCompletionPrefix("play ")).toBe("");
            expect(session.getCompletionPrefix("play sha")).toBe("sha");

            // Punctuation: sepLevel(2) >= menuSepLevel(1) → stripped at level 1.
            // stripAtLevel(".sha", 1) = trimStart(".sha") = ".sha" (punct preserved).
            expect(session.getCompletionPrefix("play.sha")).toBe(".sha");
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

    // ── explicitHide() — level shift, hide, or refetch ───────────────────

    describe("explicitHide() — level shift, hide, or refetch", () => {
        test("same level + input past anchor, accept policy → hide (no refetch)", async () => {
            const menu = makeMenu();
            const dispatcher = makeGrammarDispatcher(
                musicGrammar,
                musicEntities,
            );
            const session = new PartialCompletionSession(menu, dispatcher);

            // Establish keyword completions at anchor=""; closedSet=true.
            session.update("", getPos);
            await flush();

            // Narrow to "p…" via trie — no re-fetch.
            session.update("p", getPos);
            expect(menu.isActive()).toBe(true);

            const fetchCountBefore =
                dispatcher.getCommandCompletion.mock.calls.length;

            // Escape at "p": same sepLevel(0), input "p" ≠ anchor "" but
            // noMatchPolicy="accept" (closedSet=true, afterWildcard="none")
            // → refetch can't help, just hide.
            session.explicitHide("p", getPos, "forward");

            expect(dispatcher.getCommandCompletion).toHaveBeenCalledTimes(
                fetchCountBefore,
            );
            expect(menu.isActive()).toBe(false);

            // Session data preserved — typing more still works via reuseSession.
            session.update("pa", getPos);
            expect(menu.isActive()).toBe(true);
        });

        test("no refetch when input equals anchor", async () => {
            const menu = makeMenu();
            const dispatcher = makeGrammarDispatcher(
                musicGrammar,
                musicEntities,
            );
            const session = new PartialCompletionSession(menu, dispatcher);

            // Establish anchor = "".
            session.update("", getPos);
            await flush();

            const fetchCountBefore =
                dispatcher.getCommandCompletion.mock.calls.length;

            // input === anchor → no level shift, no advance → just hide.
            session.explicitHide("", getPos, "forward");

            expect(dispatcher.getCommandCompletion).toHaveBeenCalledTimes(
                fetchCountBefore,
            );
            expect(menu.isActive()).toBe(false);
        });

        test("same entity level + input past anchor → refetch, suppress reopen", async () => {
            const menu = makeMenu();
            const dispatcher = makeGrammarDispatcher(
                musicGrammar,
                musicEntities,
            );
            const session = new PartialCompletionSession(menu, dispatcher);

            // Navigate to entity completions at anchor="play".
            session.update("", getPos);
            await flush();
            session.update("play", getPos);
            await flush();
            session.update("play ", getPos); // separator → menu active
            expect(menu.isActive()).toBe(true);

            const fetchCountBefore =
                dispatcher.getCommandCompletion.mock.calls.length;

            // Escape at "play ": same sepLevel(1), input ≠ anchor → refetch.
            // Backend returns startIndex=4 → anchor "play" unchanged →
            // explicitCloseAnchor matches → suppress reopen.
            session.explicitHide("play ", getPos, "forward");
            await flush();

            expect(dispatcher.getCommandCompletion).toHaveBeenCalledTimes(
                fetchCountBefore + 1,
            );
            expect(dispatcher.getCommandCompletion).toHaveBeenLastCalledWith(
                "play ",
                "forward",
            );
            expect(menu.isActive()).toBe(false);

            // Session data refreshed — typing more narrows without another refetch.
            session.update("play sha", getPos);
            expect(menu.isActive()).toBe(true);
        });

        test("level change on explicitHide keeps menu visible (widen)", async () => {
            // Conflict grammar: NoneRule at level 0, AutoRule at level 1.
            const grammar = loadGrammarRules(
                "explicithide-conflict.grammar",
                [
                    `<NoneRule> [spacing=none] = ab cd -> "none";`,
                    `<AutoRule> = ab cd -> "auto";`,
                    `<Start> = $(x:<NoneRule>) -> x | $(x:<AutoRule>) -> x;`,
                ].join("\n"),
            );
            const menu = makeMenu();
            const dispatcher = makeGrammarDispatcher(grammar, {});
            const session = new PartialCompletionSession(menu, dispatcher);

            // "ab" → level 0 (none-mode "cd"). Menu active.
            session.update("ab", getPos);
            await flush();
            expect(menu.isActive()).toBe(true);

            const fetchCountBefore =
                dispatcher.getCommandCompletion.mock.calls.length;

            // explicitHide with "ab " → level shift widens to level 1.
            // Level changed → menu stays visible with level-1 items.
            session.explicitHide("ab ", getPos, "forward");

            expect(dispatcher.getCommandCompletion).toHaveBeenCalledTimes(
                fetchCountBefore,
            );
            // Menu stays visible — new items the user hasn't seen.
            expect(menu.isActive()).toBe(true);
        });

        test("level change on explicitHide keeps menu visible (narrow)", async () => {
            const grammar = loadGrammarRules(
                "explicithide-conflict2.grammar",
                [
                    `<NoneRule> [spacing=none] = ab cd -> "none";`,
                    `<AutoRule> = ab cd -> "auto";`,
                    `<Start> = $(x:<NoneRule>) -> x | $(x:<AutoRule>) -> x;`,
                ].join("\n"),
            );
            const menu = makeMenu();
            const dispatcher = makeGrammarDispatcher(grammar, {});
            const session = new PartialCompletionSession(menu, dispatcher);

            // "ab" at level 0, then widen to level 1.
            session.update("ab", getPos);
            await flush();
            session.update("ab ", getPos);
            expect(menu.isActive()).toBe(true);

            const fetchCountBefore =
                dispatcher.getCommandCompletion.mock.calls.length;

            // explicitHide with "ab" → level shift narrows to level 0.
            // Level changed → menu stays visible with level-0 items.
            session.explicitHide("ab", getPos, "forward");

            expect(dispatcher.getCommandCompletion).toHaveBeenCalledTimes(
                fetchCountBefore,
            );
            // Menu stays visible — different level items.
            expect(menu.isActive()).toBe(true);
        });

        test("refetch triggered; anchor advances → session moves to next level", async () => {
            const menu = makeMenu();
            const dispatcher = makeGrammarDispatcher(
                musicGrammar,
                musicEntities,
            );
            const session = new PartialCompletionSession(menu, dispatcher);

            // Navigate to entity completions at anchor="play".
            session.update("", getPos);
            await flush();
            session.update("play", getPos);
            await flush();
            session.update("play ", getPos); // separator → menu active

            // Explicit close with the full entity already typed.
            // No level shift: same sepLevel(1).
            // input ≠ anchor → refetch.
            // Grammar advances startIndex past 4 → new anchor → reopen.
            session.explicitHide("play Shake It Off", getPos, "forward");
            await flush();

            // Refetch was issued with the full entity string.
            expect(dispatcher.getCommandCompletion).toHaveBeenCalledTimes(3);
            expect(dispatcher.getCommandCompletion).toHaveBeenLastCalledWith(
                "play Shake It Off",
                "forward",
            );

            // Next-level completions loaded but deferred
            // (separatorMode "spacePunctuation", rawPrefix "" → not visible).
            // Trie is preloaded with all items (no prior groups visible).
            expect(menu.setChoices).toHaveBeenLastCalledWith(
                expect.arrayContaining([
                    expect.objectContaining({ matchText: "by" }),
                ]),
            );

            // Typing the separator at the new anchor reveals the "by" completion.
            // Trie was already preloaded — no redundant setChoices call.
            menu.setChoices.mockClear();
            session.update("play Shake It Off ", getPos);
            expect(menu.isActive()).toBe(true);
            expect(menu.setChoices).not.toHaveBeenCalled();
        });
    });
});

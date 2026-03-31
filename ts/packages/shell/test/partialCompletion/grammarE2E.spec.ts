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
        });

        test("'by' keyword appears after wildcard text with space", async () => {
            await primeWildcard();

            // After typing space, the separator is satisfied and trie filters.
            session.update("play unknown ", getPos);

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
            expect(menu.setChoices).toHaveBeenCalled();
            const lastChoices =
                menu.setChoices.mock.calls[
                    menu.setChoices.mock.calls.length - 1
                ][0];
            expect(lastChoices).toEqual(
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

            session.update("play unknown  ", getPos);

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
            expect(menu.setChoices).toHaveBeenLastCalledWith(
                expect.arrayContaining([
                    expect.objectContaining({ matchText: "Ed Sheeran" }),
                    expect.objectContaining({ matchText: "Queen" }),
                    expect.objectContaining({ matchText: "Taylor Swift" }),
                ]),
            );
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

        test("'play beautiful' has afterWildcard=\"none\" — mixed candidates", async () => {
            session.update("play beautiful", getPos);
            await flush();

            // Both rules contribute at mpl=14:
            //   "music" from Rule B (literal, position-sensitive)
            //   "by" from Rule A (wildcard-stable)
            // AND-merge → afterWildcard="none" → noMatchPolicy="refetch"
            const choices = menu.setChoices.mock.calls.at(-1)![0];
            expect(choices).toEqual(
                expect.arrayContaining([
                    expect.objectContaining({ matchText: "music" }),
                    expect.objectContaining({ matchText: "by" }),
                ]),
            );
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

            // Type more — triggers re-fetch since afterWildcard="none".
            session.update("play beautifull", getPos);
            await flush();

            // At "play beautifull", only the wildcard rule contributes.
            // "music" should be gone — it was position-sensitive to
            // "play beautiful" (exact partial match of Rule B).
            const choices = menu.setChoices.mock.calls.at(-1)![0];
            expect(choices).toEqual(
                expect.arrayContaining([
                    expect.objectContaining({ matchText: "by" }),
                ]),
            );
            expect(choices).not.toEqual(
                expect.arrayContaining([
                    expect.objectContaining({ matchText: "music" }),
                ]),
            );
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
            expect(menu.isActive()).toBe(true);

            // "b" matches "by" in the trie — menu narrows correctly.
            session.update("play beautiful b", getPos);
            expect(menu.isActive()).toBe(true);

            // Verify the trie filtered to only "by".
            const updateArgs = menu.updatePrefix.mock.calls.at(-1)!;
            expect(updateArgs[0]).toBe("b");
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

            // After separator, "by" reappears from the cached trie.
            session.update("play hello world ", getPos);
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

    // ── explicitHide() — explicit close and conditional refetch ──────────

    describe("explicitHide() — explicit close with conditional refetch", () => {
        test("no refetch when noMatchPolicy=accept (keyword level, closed set)", async () => {
            const menu = makeMenu();
            const dispatcher = makeGrammarDispatcher(
                musicGrammar,
                musicEntities,
            );
            const session = new PartialCompletionSession(menu, dispatcher);

            // Establish keyword completions at anchor=""; closedSet=true → accept.
            session.update("", getPos);
            await flush();

            // Narrow to "p…" via trie — no re-fetch.
            session.update("p", getPos);
            expect(menu.isActive()).toBe(true);

            const fetchCountBefore =
                dispatcher.getCommandCompletion.mock.calls.length;

            // Explicit close: input "p" ≠ anchor "" but noMatchPolicy=accept → skip refetch.
            session.explicitHide("p", getPos, "forward");

            expect(dispatcher.getCommandCompletion).toHaveBeenCalledTimes(
                fetchCountBefore,
            );
            expect(menu.hide).toHaveBeenCalled();
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

            // input === anchor → skip refetch.
            session.explicitHide("", getPos, "forward");

            expect(dispatcher.getCommandCompletion).toHaveBeenCalledTimes(
                fetchCountBefore,
            );
        });

        test("refetch triggered; same anchor → reopen suppressed", async () => {
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
            session.update("play sha", getPos); // trie filters to Shake/Shape
            expect(menu.isActive()).toBe(true);

            const fetchCountBefore =
                dispatcher.getCommandCompletion.mock.calls.length;

            // Escape while menu shows entity completions for prefix "sha".
            // Grammar resolves "play sha" to startIndex=4 → anchor "play" unchanged.
            session.explicitHide("play sha", getPos, "forward");
            await flush();

            // Refetch was issued with the full current input.
            expect(dispatcher.getCommandCompletion).toHaveBeenCalledTimes(
                fetchCountBefore + 1,
            );
            expect(dispatcher.getCommandCompletion).toHaveBeenLastCalledWith(
                "play sha",
                "forward",
            );
            // Same anchor → reopen suppressed: menu stays hidden.
            expect(menu.isActive()).toBe(false);
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
            // Grammar consumes "play Shake It Off" entirely → startIndex advances
            // past 4 → new anchor differs from "play" → reopen is NOT suppressed.
            session.explicitHide("play Shake It Off", getPos, "forward");
            await flush();

            // Refetch was issued with the full entity string.
            expect(dispatcher.getCommandCompletion).toHaveBeenLastCalledWith(
                "play Shake It Off",
                "forward",
            );

            // Next-level completions include the "by" keyword.
            expect(menu.setChoices).toHaveBeenLastCalledWith(
                expect.arrayContaining([
                    expect.objectContaining({ matchText: "by" }),
                ]),
            );

            // Typing the separator at the new anchor reveals the "by" completion.
            session.update("play Shake It Off ", getPos);
            expect(menu.isActive()).toBe(true);
        });
    });
});

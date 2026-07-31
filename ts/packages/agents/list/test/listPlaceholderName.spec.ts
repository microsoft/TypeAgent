// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/**
 * Placeholder listName rejection — grammar can bind "the"/"my"/"list" from
 * phrases like "add ham to the list", or "a grocery" from determiner+name
 * compounds, "it"/"them"/"me"/"they"/"we"/"she" from anaphora, "new" from
 * CreateList's optional adjective, "grocery list"/"grocery lists" when the
 * trailing list token is eaten by the wildcard, deictics like "this one"/
 * "the other list"/"first one"/"those ones"/"the current list", quantifiers
 * ("both lists", "every list", "none of them"), independent possessives
 * ("mine"), interrogatives ("which list"), partial anaphora ("lots of them"),
 * possessives ("list's"), or punctuated LLM/STT artifacts ("the list.", "list?").
 * Normalize strips edge punctuation (Unicode-safe), possessives, leading
 * dets/quantifiers/selection deictics (not anaphoric pronouns), all trailing
 * "list"/"lists", casefolds, and maps the salvage alias to RECOVERED_LIST_NAME.
 * Leftovers that are still placeholders must not be real lists. Real multi-word
 * names like "me time" and non-ASCII names like "café" stay intact. The salvage
 * key is addressable so recovered items remain reachable.
 */

import {
    isPlaceholderListName,
    normalizeListName,
    RECOVERED_LIST_NAME,
} from "../src/listNameUtils.js";
import {
    coalesceStoredLists,
    listValidateWildcardMatch,
    storedListsNeedRewrite,
} from "../src/listActionHandler.js";
import type { ListAction, ListActivity } from "../src/listSchema.js";
import type { SessionContext } from "@typeagent/agent-sdk";

describe("normalizeListName", () => {
    test.each([
        ["a grocery", "grocery"],
        ["that shopping", "shopping"],
        ["your packing", "packing"],
        ["the list", "list"],
        ["my list", "list"],
        ["an idea", "idea"],
        ["  A   Grocery  ", "grocery"],
        // trailing generic "list" / "lists" (including repeats — idempotent)
        ["grocery list", "grocery"],
        ["the grocery list", "grocery"],
        ["Grocery List", "grocery"],
        ["GROCERY LIST", "grocery"],
        ["shopping list", "shopping"],
        ["to do list", "to do"],
        ["grocery lists", "grocery"],
        ["Grocery Lists", "grocery"],
        ["the grocery lists", "grocery"],
        ["grocery list list", "grocery"],
        ["shopping lists list", "shopping"],
        ["grocery list lists", "grocery"],
        ["the grocery list list", "grocery"],
        // possessives
        ["list's", "list"],
        ["the list's", "list"],
        ["my list's", "list"],
        ["grocery list's", "grocery"],
        ["grocery's", "grocery"],
        // anaphoric dets
        ["another grocery", "grocery"],
        ["the other shopping", "shopping"],
        ["the same packing", "packing"],
        // all-det + trailing list collapses to bare "list" (still a placeholder)
        ["another list", "list"],
        ["the other list", "list"],
        ["the same list", "list"],
        ["this one", "one"],
        ["that one", "one"],
        // selection deictics are NOT leading-stripped (preserve "whole foods");
        // "the current list" → strip det + trailing list → bare "current"
        ["the current list", "current"],
        ["the active list", "active"],
        ["the default list", "default"],
        ["the whole list", "whole"],
        ["the entire list", "entire"],
        ["current", "current"],
        ["active", "active"],
        ["whole grocery list", "whole grocery"],
        ["the whole grocery list", "whole grocery"],
        ["whole foods list", "whole foods"],
        ["active tasks", "active tasks"],
        ["current events", "current events"],
        // quantifiers are NOT leading-stripped (preserve "most wanted");
        // trailing list still peels: "both lists" → "both"
        ["both lists", "both"],
        ["every list", "every"],
        ["all lists", "all"],
        ["any list", "any"],
        ["some list", "some"],
        ["each list", "each"],
        ["either list", "either"],
        ["none of them", "none of them"],
        ["both grocery", "both grocery"],
        ["every shopping", "every shopping"],
        ["most wanted", "most wanted"],
        ["many thanks", "many thanks"],
        // interrogative det still strips when leading
        ["which", "which"],
        ["which one", "one"],
        ["which list", "list"],
        ["which grocery", "grocery"],
        // ordinals + one kept as multi-token for all-closed-class reject
        ["first one", "first one"],
        ["last one", "last one"],
        ["next one", "next one"],
        ["the previous one", "previous one"],
        ["the first one", "first one"],
        ["those ones", "ones"],
        ["these ones", "ones"],
        ["the ones", "ones"],
        // leading anaphora is NOT stripped (preserve real names)
        ["me a", "me a"],
        ["me a new", "me a new"],
        ["me time", "me time"],
        ["us travel", "us travel"],
        ["it projects", "it projects"],
        ["you team", "you team"],
        ["US travel", "us travel"],
        // single-token input is not leading-stripped
        ["the", "the"],
        ["list", "list"],
        ["lists", "lists"],
        ["grocery", "grocery"],
        ["Grocery", "grocery"],
        ["GROCERY", "grocery"],
        ["mine", "mine"],
        ["both", "both"],
        ["they", "they"],
        // salvage alias → canonical store key
        ["recovered", RECOVERED_LIST_NAME],
        ["Recovered", RECOVERED_LIST_NAME],
        ["__recovered__", RECOVERED_LIST_NAME],
        ["the recovered list", RECOVERED_LIST_NAME],
        ["recovered list", RECOVERED_LIST_NAME],
        // punctuation (LLM/STT)
        ["the.", "the"],
        ["list,", "list"],
        ["it!", "it"],
        ["my?", "my"],
        ["the list.", "list"],
        ["list?", "list"],
        ["my list,", "list"],
        ["grocery list!", "grocery"],
        ["Grocery Lists.", "grocery"],
        // Unicode letters preserved (not ASCII-stripped)
        ["café", "café"],
        ["Café", "café"],
        ["résumé", "résumé"],
        ["café list", "café"],
        ["the café list", "café"],
        ["買い物", "買い物"],
        ["買い物 list", "買い物"],
        ["café!", "café"],
        // non-determiner first token kept (casefolded)
        ["Contoso grocery", "contoso grocery"],
        ["to do", "to do"],
        ["q3 packing", "q3 packing"],
        ["New York", "new york"],
        ["first aid", "first aid"],
        ["next week", "next week"],
        ["", ""],
        ["  ", ""],
    ])("normalize %j → %j", (input, expected) => {
        expect(normalizeListName(input)).toBe(expected);
    });

    test("normalize is idempotent (including repeated trailing list)", () => {
        for (const input of [
            "grocery list list",
            "shopping lists list",
            "the grocery list",
            "a grocery",
            "recovered",
            "__recovered__",
            "the recovered list",
            "grocery list's",
            "the current list",
        ]) {
            const once = normalizeListName(input);
            expect(normalizeListName(once)).toBe(once);
        }
    });
});

describe("isPlaceholderListName", () => {
    test.each([
        "the",
        "that",
        "my",
        "a",
        "an",
        "this",
        "these",
        "those",
        "your",
        "our",
        "his",
        "her",
        "its",
        "their",
        "list",
        "lists",
        "the list",
        "my list",
        "that list",
        "its list",
        "a list",
        "the lists",
        "my lists",
        // possessives
        "list's",
        "the list's",
        "my list's",
        // anaphoric pronouns (object + subject forms)
        "it",
        "them",
        "me",
        "him",
        "us",
        "you",
        "they",
        "we",
        "she",
        "he",
        "IT",
        "Them",
        "They",
        "me a",
        // independent possessives
        "mine",
        "yours",
        "ours",
        "theirs",
        "hers",
        "Mine",
        "yours list",
        // quantifiers
        "any",
        "all",
        "both",
        "every",
        "each",
        "some",
        "either",
        "neither",
        "none",
        "more",
        "many",
        "several",
        "few",
        "most",
        "both lists",
        "every list",
        "all lists",
        "any list",
        "some list",
        "each list",
        "either list",
        "more lists",
        "many lists",
        "none of them",
        "none of those",
        // quantifier + of + anaphora leftovers / glue-led junk
        "of them",
        "of those",
        "of it",
        "of grocery",
        "all of them",
        "both of them",
        "some of it",
        "any of these",
        "lots of them",
        "lots of groceries",
        "rest of those",
        "rest of the grocery",
        "the rest of the grocery list",
        // partial anaphora with content head
        "lots of them",
        "rest of them",
        "rest of those",
        "which of them",
        "lots",
        "rest",
        // interrogative
        "which",
        "which one",
        "which list",
        // selection / session deictics
        "current",
        "active",
        "default",
        "whole",
        "entire",
        "the current list",
        "the active list",
        "the default list",
        "the whole list",
        "the entire list",
        "current list",
        "active list",
        // deictic "own" leftover
        "own",
        "my own",
        "my own list",
        // small cardinals
        "two",
        "three",
        "the two",
        "the three lists",
        "those two",
        // bare CreateList adjective
        "new",
        "NEW",
        "a new",
        "me a new",
        // deictic / anaphoric dets
        "one",
        "ones",
        "this one",
        "that one",
        "those ones",
        "these ones",
        "the ones",
        "other",
        "another",
        "same",
        "the other",
        "the other list",
        "another list",
        "the same list",
        "another lists",
        // ordinal + one deictics
        "first one",
        "last one",
        "next one",
        "previous one",
        "the previous one",
        "the first one",
        "second one",
        "the last one",
        // punctuation-glued placeholders
        "the.",
        "list,",
        "it!",
        "my?",
        "the list.",
        "list?",
        "my list,",
        "lists!",
        "mine!",
        "both lists.",
        "",
        "  ",
        "THE",
        "My",
        "ITS",
        "Lists",
    ])("rejects placeholder %j", (name) => {
        expect(isPlaceholderListName(name)).toBe(true);
    });

    test.each([
        "grocery",
        "shopping",
        "Contoso grocery",
        "to do",
        "q3 packing",
        "gift",
        // determiner+name compounds normalize to a real name
        "a grocery",
        "that shopping",
        "your packing",
        "my grocery",
        "an idea",
        "its shopping",
        "another grocery",
        "the other shopping",
        // trailing list(s) collapses to real name
        "grocery list",
        "the grocery list",
        "Grocery List",
        "shopping list",
        "to do list",
        "grocery lists",
        "Grocery Lists",
        "grocery list!",
        "grocery list list",
        "grocery list's",
        // multi-word with "new" as part of a real name stays usable
        "New York",
        "new hires",
        // ordinal + real noun stays usable
        "first aid",
        "next week",
        "last christmas",
        // anaphoric-pronoun-leading real names (not stripped)
        "me time",
        "us travel",
        "it projects",
        "you team",
        "US travel",
        // Unicode / non-ASCII real names
        "café",
        "résumé",
        "café list",
        "the café",
        "買い物",
        "買い物 list",
        // selection deictic + real name (not stripped)
        "whole grocery",
        "the whole grocery list",
        "whole foods",
        "active tasks",
        "current events",
        "default settings",
        "entire catalog",
        // quantifier + open-class compound (not stripped)
        "most wanted",
        "many thanks",
        "few ingredients",
        "several projects",
        "more errands",
        // open-class head + of + anaphor is a real name
        "photos of them",
        "pictures of those",
        // salvage key is addressable (not a placeholder)
        "recovered",
        "__recovered__",
        "the recovered list",
        "Recovered",
    ])("accepts real list name %j", (name) => {
        expect(isPlaceholderListName(name)).toBe(false);
    });
});

describe("listValidateWildcardMatch", () => {
    const ctx = {} as SessionContext<any>;

    function action(
        actionName: ListAction["actionName"] | ListActivity["actionName"],
        listName: string,
        items?: string[],
    ): ListAction | ListActivity {
        if (actionName === "addItems" || actionName === "removeItems") {
            return {
                actionName,
                parameters: { listName, items: items ?? ["milk"] },
            } as ListAction;
        }
        if (actionName === "listLists") {
            return { actionName: "listLists", parameters: {} };
        }
        return {
            actionName,
            parameters: { listName },
        } as ListAction | ListActivity;
    }

    test.each([
        "the",
        "my",
        "list",
        "lists",
        "the list",
        "the lists",
        "its",
        "it",
        "them",
        "me",
        "they",
        "we",
        "she",
        "mine",
        "yours",
        "ours",
        "both",
        "every",
        "all",
        "any",
        "some",
        "none",
        "none of them",
        "both lists",
        "every list",
        "new",
        "a new",
        "one",
        "ones",
        "this one",
        "those ones",
        "first one",
        "last one",
        "the previous one",
        "other",
        "another",
        "same",
        "the other list",
        "which",
        "which one",
        "which list",
        "lots of them",
        "rest of those",
        "the current list",
        "the active list",
        "the default list",
        "the whole list",
        "the entire list",
        "list's",
        "the list's",
        "the.",
        "list?",
        "the list.",
        "",
        "  ",
    ])("rejects placeholder listName %j on createList", async (name) => {
        expect(
            await listValidateWildcardMatch(action("createList", name), ctx),
        ).toBe(false);
    });

    test.each([
        "the",
        "the list",
        "my",
        "list",
        "lists",
        "its",
        "it",
        "them",
        "me",
        "they",
        "mine",
        "both",
        "any",
        "none of them",
        "first one",
        "those ones",
        "another",
        "the other list",
        "this one",
        "which",
        "which one",
        "the current list",
        "list!",
        "list's",
    ])("rejects placeholder listName %j on addItems", async (name) => {
        expect(
            await listValidateWildcardMatch(action("addItems", name), ctx),
        ).toBe(false);
    });

    test.each([
        "getList",
        "clearList",
        "startEditList",
        "removeItems",
    ] as const)("rejects bare 'the list' on %s", async (actionName) => {
        expect(
            await listValidateWildcardMatch(
                action(actionName, "the list"),
                ctx,
            ),
        ).toBe(false);
    });

    test.each([
        "grocery",
        "a grocery",
        "that shopping",
        "your packing",
        "Contoso grocery",
        "to do",
        "q3 packing",
        "grocery list",
        "the grocery list",
        "grocery lists",
        "grocery list list",
        "Grocery",
        "GROCERY LIST",
        "grocery list!",
        "grocery list's",
        "me time",
        "us travel",
        "café",
        "買い物",
        "first aid",
        // salvage aliases must pass wildcard so users can address recovered items
        "recovered",
        "__recovered__",
        "the recovered list",
    ])("accepts usable listName %j on createList", async (name) => {
        expect(
            await listValidateWildcardMatch(action("createList", name), ctx),
        ).toBe(true);
    });

    test.each([
        "getList",
        "clearList",
        "startEditList",
        "addItems",
        "removeItems",
    ] as const)(
        "accepts salvage aliases on %s so recovered items are reachable",
        async (actionName) => {
            for (const name of [
                "recovered",
                "__recovered__",
                "the recovered list",
            ]) {
                expect(
                    await listValidateWildcardMatch(
                        action(actionName, name),
                        ctx,
                    ),
                ).toBe(true);
            }
        },
    );

    test("accepts determiner+name compound on addItems", async () => {
        expect(
            await listValidateWildcardMatch(
                action("addItems", "a grocery", ["eggs"]),
                ctx,
            ),
        ).toBe(true);
    });

    test("accepts trailing-list form on addItems (grammar without literal list)", async () => {
        expect(
            await listValidateWildcardMatch(
                action("addItems", "grocery list", ["ham"]),
                ctx,
            ),
        ).toBe(true);
        expect(
            await listValidateWildcardMatch(
                action("addItems", "the grocery list", ["milk", "eggs"]),
                ctx,
            ),
        ).toBe(true);
        expect(
            await listValidateWildcardMatch(
                action("addItems", "grocery lists", ["bread"]),
                ctx,
            ),
        ).toBe(true);
        expect(
            await listValidateWildcardMatch(
                action("addItems", "grocery list list", ["butter"]),
                ctx,
            ),
        ).toBe(true);
    });

    test("still rejects non-simple item nouns on addItems", async () => {
        expect(
            await listValidateWildcardMatch(
                action("addItems", "grocery", ["the big red apple"]),
                ctx,
            ),
        ).toBe(false);
    });
});

describe("coalesceStoredLists (session hydrate)", () => {
    test("salvages items under placeholder keys into recovered list", () => {
        expect(
            coalesceStoredLists([
                { name: "the", items: ["x"] },
                { name: "list", items: ["y"] },
                { name: "my", items: ["z"] },
                { name: "new", items: ["n"] },
                { name: "it", items: ["i"] },
                { name: "the list", items: ["t"] },
                { name: "mine", items: ["m"] },
                { name: "both", items: ["b"] },
            ]),
        ).toEqual([
            {
                name: RECOVERED_LIST_NAME,
                items: ["x", "y", "z", "n", "i", "t", "m", "b"],
            },
        ]);
    });

    test("salvages placeholder items alongside real lists", () => {
        const result = coalesceStoredLists([
            { name: "the", items: ["lost"] },
            { name: "grocery", items: ["milk"] },
        ]);
        expect(result).toEqual(
            expect.arrayContaining([
                { name: "grocery", items: ["milk"] },
                { name: RECOVERED_LIST_NAME, items: ["lost"] },
            ]),
        );
        expect(result).toHaveLength(2);
    });

    test("does not create recovered list when no placeholder items", () => {
        expect(
            coalesceStoredLists([{ name: "grocery", items: ["milk"] }]),
        ).toEqual([{ name: "grocery", items: ["milk"] }]);
    });

    test("keeps already-canonical salvage list stable (no re-salvage loop)", () => {
        expect(
            coalesceStoredLists([
                { name: RECOVERED_LIST_NAME, items: ["milk"] },
            ]),
        ).toEqual([{ name: RECOVERED_LIST_NAME, items: ["milk"] }]);
        // alias forms also land on the same key
        expect(
            coalesceStoredLists([{ name: "recovered", items: ["eggs"] }]),
        ).toEqual([{ name: RECOVERED_LIST_NAME, items: ["eggs"] }]);
    });

    test("normalizes determiner-prefixed and trailing-list keys", () => {
        expect(
            coalesceStoredLists([
                { name: "a grocery", items: ["eggs"] },
                { name: "Grocery List", items: ["bread"] },
                { name: "the grocery list", items: ["milk"] },
                { name: "grocery lists", items: ["butter"] },
                { name: "grocery list list", items: ["cheese"] },
            ]),
        ).toEqual([
            {
                name: "grocery",
                items: ["eggs", "bread", "milk", "butter", "cheese"],
            },
        ]);
    });

    test("casefolds so mixed-case keys merge", () => {
        expect(
            coalesceStoredLists([
                { name: "Grocery", items: ["a"] },
                { name: "grocery", items: ["b"] },
                { name: "GROCERY", items: ["c"] },
            ]),
        ).toEqual([{ name: "grocery", items: ["a", "b", "c"] }]);
    });

    test("keeps distinct real names including anaphora-leading and Unicode", () => {
        expect(
            coalesceStoredLists([
                { name: "shopping", items: ["soap"] },
                { name: "to do", items: ["call"] },
                { name: "Contoso grocery", items: ["badge"] },
                { name: "me time", items: ["read"] },
                { name: "US travel", items: ["visa"] },
                { name: "café", items: ["latte"] },
                { name: "買い物", items: ["tea"] },
            ]),
        ).toEqual([
            { name: "shopping", items: ["soap"] },
            { name: "to do", items: ["call"] },
            { name: "contoso grocery", items: ["badge"] },
            { name: "me time", items: ["read"] },
            { name: "us travel", items: ["visa"] },
            { name: "café", items: ["latte"] },
            { name: "買い物", items: ["tea"] },
        ]);
    });

    test("merges salvaged items into existing recovered list", () => {
        expect(
            coalesceStoredLists([
                { name: "recovered", items: ["keep"] },
                { name: "the", items: ["from-the"] },
            ]),
        ).toEqual([{ name: RECOVERED_LIST_NAME, items: ["keep", "from-the"] }]);
        expect(
            coalesceStoredLists([
                { name: RECOVERED_LIST_NAME, items: ["keep"] },
                { name: "list", items: ["from-list"] },
            ]),
        ).toEqual([
            { name: RECOVERED_LIST_NAME, items: ["keep", "from-list"] },
        ]);
    });

    test("does not throw on null / non-string names; salvages items", () => {
        const result = coalesceStoredLists([
            { name: null as unknown as string, items: ["from-null"] },
            { name: 42 as unknown as string, items: ["from-num"] },
            { name: undefined as unknown as string, items: ["from-undef"] },
            null as unknown as { name: string; items: string[] },
            { name: "grocery", items: ["milk"] },
        ]);
        expect(result).toEqual(
            expect.arrayContaining([
                { name: "grocery", items: ["milk"] },
                {
                    name: RECOVERED_LIST_NAME,
                    items: expect.arrayContaining([
                        "from-null",
                        "from-num",
                        "from-undef",
                    ]),
                },
            ]),
        );
        expect(result).toHaveLength(2);
    });
});

describe("storedListsNeedRewrite", () => {
    test("false for already-canonical store", () => {
        expect(
            storedListsNeedRewrite([
                { name: "grocery", items: ["milk"] },
                { name: "to do", items: ["call"] },
                { name: "café", items: ["latte"] },
            ]),
        ).toBe(false);
    });

    test("false for steady-state salvage-only store (no rewrite loop)", () => {
        expect(
            storedListsNeedRewrite([
                { name: RECOVERED_LIST_NAME, items: ["milk"] },
            ]),
        ).toBe(false);
        expect(
            storedListsNeedRewrite([
                { name: RECOVERED_LIST_NAME, items: ["a", "b"] },
                { name: "grocery", items: ["eggs"] },
            ]),
        ).toBe(false);
    });

    test("true when salvage alias still uses non-canonical 'recovered' key", () => {
        expect(
            storedListsNeedRewrite([{ name: "recovered", items: ["milk"] }]),
        ).toBe(true);
    });

    test("true for placeholder keys (even with items)", () => {
        expect(storedListsNeedRewrite([{ name: "the", items: ["x"] }])).toBe(
            true,
        );
        expect(storedListsNeedRewrite([{ name: "list", items: [] }])).toBe(
            true,
        );
        expect(storedListsNeedRewrite([{ name: "mine", items: ["x"] }])).toBe(
            true,
        );
    });

    test("true for unnormalized names", () => {
        expect(
            storedListsNeedRewrite([{ name: "a grocery", items: ["eggs"] }]),
        ).toBe(true);
        expect(
            storedListsNeedRewrite([
                { name: "Grocery List", items: ["bread"] },
            ]),
        ).toBe(true);
        expect(
            storedListsNeedRewrite([{ name: "grocery lists", items: ["x"] }]),
        ).toBe(true);
        expect(
            storedListsNeedRewrite([
                { name: "grocery list list", items: ["x"] },
            ]),
        ).toBe(true);
    });

    test("true when duplicate keys would merge", () => {
        expect(
            storedListsNeedRewrite([
                { name: "grocery", items: ["a"] },
                { name: "Grocery", items: ["b"] },
            ]),
        ).toBe(true);
    });

    test("true for null / non-string names without throwing", () => {
        expect(
            storedListsNeedRewrite([
                { name: null as unknown as string, items: ["x"] },
            ]),
        ).toBe(true);
        expect(
            storedListsNeedRewrite([
                { name: 1 as unknown as string, items: [] },
            ]),
        ).toBe(true);
        expect(
            storedListsNeedRewrite([
                null as unknown as { name: string; items: string[] },
            ]),
        ).toBe(true);
    });
});

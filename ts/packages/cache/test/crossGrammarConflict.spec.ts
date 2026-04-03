// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/**
 * Cross-grammar separator-mode conflict filtering tests.
 *
 * When two grammars at the same matchedPrefixLength produce incompatible
 * separator modes ("none" vs requiring), grammarStore filters by
 * trailing separator state — mirroring the within-grammar conflict
 * filtering in grammarCompletion.ts.
 */

import { AgentCache } from "../src/cache/cache.js";
import { loadGrammarRules } from "action-grammar";

const mockExplainerFactory = () => {
    return {
        generate: async () => ({ success: false, message: "Mock explainer" }),
    } as any;
};

describe("Cross-grammar separator-mode conflict filtering", () => {
    let cache: AgentCache;

    beforeEach(() => {
        cache = new AgentCache("test", mockExplainerFactory, undefined);

        // Grammar A: spacing=none — "ab" and "cd" are adjacent (no separator).
        const noneGrammar = loadGrammarRules(
            "noneSchema",
            `<Start> = <NoneRule>;
<NoneRule> [spacing=none] = ab cd -> {
    actionName: "noneAction",
    parameters: {}
};`,
        );

        // Grammar B: default spacing (auto) — "ab" and "cd" need a separator.
        const autoGrammar = loadGrammarRules(
            "autoSchema",
            `<Start> = <AutoRule>;
<AutoRule> = ab cd -> {
    actionName: "autoAction",
    parameters: {}
};`,
        );

        cache.grammarStore.addGrammar("noneSchema", noneGrammar);
        cache.grammarStore.addGrammar("autoSchema", autoGrammar);
    });

    function complete(input: string, direction?: "forward" | "backward") {
        const namespaceKeys = cache.getNamespaceKeys(
            ["noneSchema", "autoSchema"],
            undefined,
        );
        return cache.completion(input, { namespaceKeys }, direction);
    }

    test("'ab' no trailing separator: none-mode grammar survives, requiring dropped", () => {
        const result = complete("ab");
        expect(result).toBeDefined();
        expect(result!.completions).toContain("cd");
        // closedSet forced false so shell re-fetches on sep change.
        expect(result!.closedSet).toBe(false);
        // separatorMode should be "none" (only none-grammar survived).
        expect(result!.separatorMode).toBe("none");
    });

    test("'ab ' trailing separator: requiring-mode grammar survives, none dropped", () => {
        const result = complete("ab ");
        expect(result).toBeDefined();
        expect(result!.completions).toContain("cd");
        expect(result!.closedSet).toBe(false);
        // P advanced past the separator → separatorMode overridden to "optional".
        expect(result!.separatorMode).toBe("optional");
        // matchedPrefixLength advanced by 1 past the trailing separator.
        expect(result!.matchedPrefixLength).toBe(3);
    });

    test("afterWildcard 'all' downgraded to 'some' when grammars dropped", () => {
        // Use grammars with wildcards so afterWildcard can be "all".
        const cache2 = new AgentCache("test2", mockExplainerFactory, undefined);

        const noneWild = loadGrammarRules(
            "noneWild",
            `<Start> = <R>;
<R> [spacing=none] = $(x:string) cd -> {
    actionName: "noneWild",
    parameters: { x }
};`,
        );
        const autoWild = loadGrammarRules(
            "autoWild",
            `<Start> = <R>;
<R> = $(x:string) cd -> {
    actionName: "autoWild",
    parameters: { x }
};`,
        );
        cache2.grammarStore.addGrammar("noneWild", noneWild);
        cache2.grammarStore.addGrammar("autoWild", autoWild);

        const namespaceKeys = cache2.getNamespaceKeys(
            ["noneWild", "autoWild"],
            undefined,
        );
        const result = cache2.completion("hello", { namespaceKeys });
        expect(result).toBeDefined();
        // If grammars were dropped and afterWildcard was "all",
        // it should be downgraded to "some".
        if (result!.afterWildcard !== "none") {
            expect(result!.afterWildcard).not.toBe("all");
        }
    });

    test("no conflict when both grammars have compatible modes", () => {
        // Two auto-spacing grammars — no conflict, both survive.
        const cache3 = new AgentCache("test3", mockExplainerFactory, undefined);

        const g1 = loadGrammarRules(
            "s1",
            `<Start> = <R>;
<R> = ab cd -> {
    actionName: "a1",
    parameters: {}
};`,
        );
        const g2 = loadGrammarRules(
            "s2",
            `<Start> = <R>;
<R> = ab ef -> {
    actionName: "a2",
    parameters: {}
};`,
        );
        cache3.grammarStore.addGrammar("s1", g1);
        cache3.grammarStore.addGrammar("s2", g2);

        const namespaceKeys = cache3.getNamespaceKeys(["s1", "s2"], undefined);
        const result = cache3.completion("ab", { namespaceKeys });
        expect(result).toBeDefined();
        // Both completions present — no filtering.
        expect(result!.completions).toContain("cd");
        expect(result!.completions).toContain("ef");
        // closedSet not forced false (no conflict).
        expect(result!.closedSet).toBe(true);
    });
});

// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/**
 * Backward Compatibility Tests
 *
 * Verifies that the existing completion-based cache system continues to work
 * exactly as it did before the NFA grammar integration was added.
 *
 * These tests intentionally DO NOT use any NFA infrastructure to ensure
 * the default behavior is unchanged.
 */

import { AgentCache } from "../src/cache/cache.js";
import { loadGrammarRules } from "action-grammar";

const mockExplainerFactory = () => {
    return {
        generate: async () => ({ success: false, message: "Mock explainer" }),
    } as any;
};

describe("Backward Compatibility - Completion-Based Cache", () => {
    describe("Basic Grammar Loading and Matching", () => {
        it("should load and match grammar without any NFA infrastructure", () => {
            // This is how grammars were loaded before NFA integration
            const grammarText = `<Start> = <play>;
<play> = play $(track:string) -> {
    actionName: "play",
    parameters: {
        track
    }
};`;

            const grammar = loadGrammarRules("player", grammarText);
            expect(grammar).toBeDefined();

            // Create cache without any NFA configuration
            const cache = new AgentCache(
                "test",
                mockExplainerFactory,
                undefined,
            );

            // Add grammar the old way - just to GrammarStoreImpl
            cache.grammarStore.addGrammar("player", grammar);

            // Match should work without any NFA setup
            const namespaceKeys = cache.getNamespaceKeys(["player"], undefined);
            const matches = cache.match("play Bohemian Rhapsody", {
                namespaceKeys,
            });

            expect(matches.length).toBeGreaterThan(0);
            expect(matches[0]!.match.actions[0].action.actionName).toBe("play");
            expect(matches[0]!.match.actions[0].action.parameters?.track).toBe(
                "Bohemian Rhapsody",
            );
        });

        it("should match multiple grammars without NFA", () => {
            const playerGrammar = loadGrammarRules(
                "player",
                `<Start> = <play>;
<play> = play $(track:string) -> {
    actionName: "play",
    parameters: {
        track
    }
};`,
            );

            const calendarGrammar = loadGrammarRules(
                "calendar",
                `<Start> = <schedule>;
<schedule> = schedule $(event:string) -> {
    actionName: "schedule",
    parameters: {
        event
    }
};`,
            );

            const cache = new AgentCache(
                "test",
                mockExplainerFactory,
                undefined,
            );

            cache.grammarStore.addGrammar("player", playerGrammar);
            cache.grammarStore.addGrammar("calendar", calendarGrammar);

            // Should match player
            const playerKeys = cache.getNamespaceKeys(["player"], undefined);
            const playerMatches = cache.match("play Yesterday", {
                namespaceKeys: playerKeys,
            });
            expect(playerMatches.length).toBeGreaterThan(0);
            expect(playerMatches[0]!.match.actions[0].action.schemaName).toBe(
                "player",
            );

            // Should match calendar
            const calendarKeys = cache.getNamespaceKeys(
                ["calendar"],
                undefined,
            );
            const calendarMatches = cache.match(
                "schedule dentist appointment",
                { namespaceKeys: calendarKeys },
            );
            expect(calendarMatches.length).toBeGreaterThan(0);
            expect(calendarMatches[0]!.match.actions[0].action.schemaName).toBe(
                "calendar",
            );
        });
    });

    describe("Wildcard Matching", () => {
        it("should match wildcards in completion-based mode", () => {
            const grammarText = `<Start> = <setVolume>;
<setVolume> = set volume to $(level:number) -> {
    actionName: "setVolume",
    parameters: {
        level
    }
};`;

            const grammar = loadGrammarRules("player", grammarText);
            const cache = new AgentCache(
                "test",
                mockExplainerFactory,
                undefined,
            );
            cache.grammarStore.addGrammar("player", grammar);

            const namespaceKeys = cache.getNamespaceKeys(["player"], undefined);
            const matches = cache.match("set volume to 50", { namespaceKeys });

            expect(matches.length).toBeGreaterThan(0);
            expect(matches[0]!.match.actions[0].action.actionName).toBe(
                "setVolume",
            );
            expect(matches[0]!.match.actions[0].action.parameters?.level).toBe(
                50,
            );
        });

        it("should handle string wildcards", () => {
            const grammarText = `<Start> = <search>;
<search> = search for $(query:string) -> {
    actionName: "search",
    parameters: {
        query
    }
};`;

            const grammar = loadGrammarRules("search", grammarText);
            const cache = new AgentCache(
                "test",
                mockExplainerFactory,
                undefined,
            );
            cache.grammarStore.addGrammar("search", grammar);

            const namespaceKeys = cache.getNamespaceKeys(["search"], undefined);
            const matches = cache.match(
                "search for machine learning tutorials",
                { namespaceKeys },
            );

            expect(matches.length).toBeGreaterThan(0);
            expect(matches[0]!.match.actions[0].action.actionName).toBe(
                "search",
            );
            expect(matches[0]!.match.actions[0].action.parameters?.query).toBe(
                "machine learning tutorials",
            );
        });
    });

    describe("Grammar Alternatives", () => {
        it("should match multiple alternatives in completion-based mode", () => {
            const grammarText = `<Start> = <play> | <pause> | <stop>;
<play> = play $(track:string) -> {
    actionName: "play",
    parameters: {
        track
    }
};
<pause> = pause -> {
    actionName: "pause",
    parameters: {}
};
<stop> = stop -> {
    actionName: "stop",
    parameters: {}
};`;

            const grammar = loadGrammarRules("player", grammarText);
            const cache = new AgentCache(
                "test",
                mockExplainerFactory,
                undefined,
            );
            cache.grammarStore.addGrammar("player", grammar);

            const namespaceKeys = cache.getNamespaceKeys(["player"], undefined);

            // Test each alternative
            const playMatches = cache.match("play Hello", { namespaceKeys });
            expect(playMatches.length).toBeGreaterThan(0);
            expect(playMatches[0].match.actions[0].action.actionName).toBe(
                "play",
            );

            const pauseMatches = cache.match("pause", { namespaceKeys });
            expect(pauseMatches.length).toBeGreaterThan(0);
            expect(pauseMatches[0].match.actions[0].action.actionName).toBe(
                "pause",
            );

            const stopMatches = cache.match("stop", { namespaceKeys });
            expect(stopMatches.length).toBeGreaterThan(0);
            expect(stopMatches[0].match.actions[0].action.actionName).toBe(
                "stop",
            );
        });
    });

    describe("Optional Patterns", () => {
        it("should match optional tokens", () => {
            const grammarText = `<Start> = <play>;
<play> = play (the)? (song)? $(track:string) -> {
    actionName: "play",
    parameters: {
        track
    }
};`;

            const grammar = loadGrammarRules("player", grammarText);
            const cache = new AgentCache(
                "test",
                mockExplainerFactory,
                undefined,
            );
            cache.grammarStore.addGrammar("player", grammar);

            const namespaceKeys = cache.getNamespaceKeys(["player"], undefined);

            // All these should match
            const matches1 = cache.match("play Yesterday", { namespaceKeys });
            expect(matches1.length).toBeGreaterThan(0);

            const matches2 = cache.match("play the Yesterday", {
                namespaceKeys,
            });
            expect(matches2.length).toBeGreaterThan(0);

            const matches3 = cache.match("play song Yesterday", {
                namespaceKeys,
            });
            expect(matches3.length).toBeGreaterThan(0);

            const matches4 = cache.match("play the song Yesterday", {
                namespaceKeys,
            });
            expect(matches4.length).toBeGreaterThan(0);
        });
    });

    describe("No NFA Configuration", () => {
        it("should work without ever calling configureGrammarGeneration", () => {
            const grammarText = `<Start> = <test>;
<test> = test $(value:string) -> {
    actionName: "test",
    parameters: {
        value
    }
};`;

            const grammar = loadGrammarRules("test", grammarText);
            const cache = new AgentCache(
                "test",
                mockExplainerFactory,
                undefined,
            );

            // Add grammar WITHOUT calling configureGrammarGeneration
            cache.grammarStore.addGrammar("test", grammar);

            // Should still match
            const namespaceKeys = cache.getNamespaceKeys(["test"], undefined);
            const matches = cache.match("test hello world", { namespaceKeys });

            expect(matches.length).toBeGreaterThan(0);
            expect(matches[0]!.match.actions[0].action.actionName).toBe("test");
            expect(matches[0]!.match.actions[0].action.parameters?.value).toBe(
                "hello world",
            );
        });

        it("should work when configureGrammarGeneration is called with completionBased mode", () => {
            const grammarText = `<Start> = <test>;
<test> = test $(value:string) -> {
    actionName: "test",
    parameters: {
        value
    }
};`;

            const grammar = loadGrammarRules("test", grammarText);
            const cache = new AgentCache(
                "test",
                mockExplainerFactory,
                undefined,
            );

            cache.grammarStore.addGrammar("test", grammar);

            // Explicitly configure as completionBased (no NFA infrastructure)
            cache.configureGrammarGeneration(undefined, undefined, false);

            const namespaceKeys = cache.getNamespaceKeys(["test"], undefined);
            const matches = cache.match("test completion based", {
                namespaceKeys,
            });

            expect(matches.length).toBeGreaterThan(0);
            expect(matches[0]!.match.actions[0].action.actionName).toBe("test");
        });
    });

    describe("Empty and No-Match Cases", () => {
        it("should return empty array when no grammar matches", () => {
            const grammarText = `<Start> = <play>;
<play> = play $(track:string) -> {
    actionName: "play",
    parameters: {
        track
    }
};`;

            const grammar = loadGrammarRules("player", grammarText);
            const cache = new AgentCache(
                "test",
                mockExplainerFactory,
                undefined,
            );
            cache.grammarStore.addGrammar("player", grammar);

            const namespaceKeys = cache.getNamespaceKeys(["player"], undefined);
            const matches = cache.match("schedule meeting", { namespaceKeys });

            expect(matches).toEqual([]);
        });

        it("should return empty array when namespace key doesn't match", () => {
            const grammarText = `<Start> = <play>;
<play> = play $(track:string) -> {
    actionName: "play",
    parameters: {
        track
    }
};`;

            const grammar = loadGrammarRules("player", grammarText);
            const cache = new AgentCache(
                "test",
                mockExplainerFactory,
                undefined,
            );
            cache.grammarStore.addGrammar("player", grammar);

            // Use wrong namespace key
            const wrongKeys = cache.getNamespaceKeys(["calendar"], undefined);
            const matches = cache.match("play Hello", {
                namespaceKeys: wrongKeys,
            });

            expect(matches).toEqual([]);
        });
    });
});

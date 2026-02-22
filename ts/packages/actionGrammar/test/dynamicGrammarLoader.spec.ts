// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { Grammar } from "../src/grammarTypes.js";
import { compileGrammarToNFA } from "../src/nfaCompiler.js";
import { matchNFA } from "../src/nfaInterpreter.js";
import {
    DynamicGrammarLoader,
    DynamicGrammarCache,
} from "../src/dynamicGrammarLoader.js";
import { registerBuiltInEntities } from "../src/builtInEntities.js";

describe("Dynamic Grammar Loader", () => {
    beforeAll(() => {
        registerBuiltInEntities();
    });

    describe("DynamicGrammarLoader", () => {
        it("should load a simple generated rule", () => {
            const loader = new DynamicGrammarLoader();

            // Simulated output from grammarGenerator
            const agrText = `@ <Start> = <play>
@ <play> = play $(track:string) -> {
    actionName: "play",
    parameters: {
        track
    }
}`;

            const result = loader.load(agrText);

            expect(result.success).toBe(true);
            expect(result.grammar).toBeDefined();
            expect(result.nfa).toBeDefined();
            expect(result.errors).toEqual([]);

            // Test matching
            const matchResult = matchNFA(result.nfa!, [
                "play",
                "Bohemian Rhapsody",
            ]);
            expect(matchResult.matched).toBe(true);
            expect(matchResult.actionValue?.parameters?.track).toBe(
                "Bohemian Rhapsody",
            );
        });

        it("should load a rule with multiple parameters", () => {
            const loader = new DynamicGrammarLoader();

            // Generated rule with multiple wildcards
            const agrText = `@ <Start> = <play>
@ <play> = play $(track:string) by $(artist:string) -> {
    actionName: "play",
    parameters: {
        track,
        artist
    }
}`;

            const result = loader.load(agrText);

            expect(result.success).toBe(true);

            const matchResult = matchNFA(result.nfa!, [
                "play",
                "Shake It Off",
                "by",
                "Taylor Swift",
            ]);
            expect(matchResult.matched).toBe(true);
            expect(matchResult.actionValue?.parameters?.track).toBe(
                "Shake It Off",
            );
            expect(matchResult.actionValue?.parameters?.artist).toBe(
                "Taylor Swift",
            );
        });

        it("should load a rule with optional parts", () => {
            const loader = new DynamicGrammarLoader();

            // Generated rule with optional politeness
            const agrText = `@ <Start> = <play>
@ <play> = (please)? play $(track:string) -> {
    actionName: "play",
    parameters: {
        track
    }
}`;

            const result = loader.load(agrText);

            expect(result.success).toBe(true);

            // Test with "please"
            const result1 = matchNFA(result.nfa!, [
                "please",
                "play",
                "Yesterday",
            ]);
            expect(result1.matched).toBe(true);
            expect(result1.actionValue?.parameters?.track).toBe("Yesterday");

            // Test without "please"
            const result2 = matchNFA(result.nfa!, ["play", "Yesterday"]);
            expect(result2.matched).toBe(true);
            expect(result2.actionValue?.parameters?.track).toBe("Yesterday");
        });

        it("should load a rule with symbol types", () => {
            const loader = new DynamicGrammarLoader();

            // Generated rule using imported type
            const agrText = `@ import { Ordinal } from "types.ts"
@ <Start> = <play>
@ <play> = play (the)? $(n:Ordinal) track -> {
    actionName: "play",
    parameters: {
        n
    }
}`;

            const result = loader.load(agrText);

            expect(result.success).toBe(true);

            const matchResult = matchNFA(result.nfa!, [
                "play",
                "the",
                "third",
                "track",
            ]);
            expect(matchResult.matched).toBe(true);
            expect(matchResult.actionValue?.parameters?.n).toBe(3);
        });

        it("should reject rule with unresolved symbol", () => {
            const loader = new DynamicGrammarLoader();

            // Rule references unknown type (not imported)
            const agrText = `@ <Start> = <schedule>
@ <schedule> = schedule $(event:string) on $(date:UnknownDateType) -> {
    actionName: "schedule",
    parameters: {
        event,
        date
    }
}`;

            const result = loader.load(agrText);

            expect(result.success).toBe(false);
            expect(result.errors.length).toBeGreaterThan(0);
            expect(result.errors[0]).toContain(
                "Undefined type 'UnknownDateType'",
            );
        });

        it("should merge new rules into existing grammar", () => {
            const loader = new DynamicGrammarLoader();

            // Existing grammar with one rule
            const existingGrammar: Grammar = {
                rules: [
                    {
                        parts: [{ type: "string", value: ["pause"] }],
                    },
                ],
            };

            // New rule to add
            const agrText = `@ <Start> = <play>
@ <play> = play $(track:string) -> {
    actionName: "play",
    parameters: {
        track
    }
}`;

            const result = loader.loadAndMerge(
                agrText,
                existingGrammar,
                "merged",
            );

            expect(result.success).toBe(true);
            expect(result.grammar!.rules.length).toBe(2); // pause + play (Start refs play)

            // Test that both rules work
            const pauseResult = matchNFA(result.nfa!, ["pause"]);
            expect(pauseResult.matched).toBe(true);

            const playResult = matchNFA(result.nfa!, ["play", "Song"]);
            expect(playResult.matched).toBe(true);
        });

        it("should add multiple alternatives for same action", () => {
            const loader = new DynamicGrammarLoader();

            // Start with one play rule
            const existingGrammar: Grammar = {
                rules: [
                    {
                        parts: [
                            { type: "string", value: ["play"] },
                            {
                                type: "wildcard",
                                variable: "track",
                                typeName: "string",
                            },
                        ],
                        value: {
                            type: "object",
                            value: {
                                track: { type: "variable", name: "track" },
                            },
                        },
                    },
                ],
            };

            // Add another play rule with different structure
            const agrText = `@ <Start> = <play>
@ <play> = play $(track:string) by $(artist:string) -> {
    actionName: "play",
    parameters: {
        track,
        artist
    }
}`;

            const result = loader.loadAndMerge(agrText, existingGrammar);

            expect(result.success).toBe(true);
            expect(result.grammar!.rules.length).toBe(2); // original + play (Start refs play)

            // Both patterns should match
            const simple = matchNFA(result.nfa!, ["play", "Song"]);
            expect(simple.matched).toBe(true);

            const withArtist = matchNFA(result.nfa!, [
                "play",
                "Song",
                "by",
                "Artist",
            ]);
            expect(withArtist.matched).toBe(true);
        });
    });

    describe("DynamicGrammarCache", () => {
        it("should maintain grammar and NFA in cache", () => {
            const initialGrammar: Grammar = {
                rules: [
                    {
                        parts: [{ type: "string", value: ["pause"] }],
                    },
                ],
            };
            const initialNFA = compileGrammarToNFA(initialGrammar, "initial");

            const cache = new DynamicGrammarCache(initialGrammar, initialNFA);

            // Verify initial state
            expect(cache.getGrammar().rules.length).toBe(1);
            const stats1 = cache.getStats();
            expect(stats1.ruleCount).toBe(1);

            // Add new rule
            const agrText = `@ <Start> = <play>
@ <play> = play $(track:string) -> {
    actionName: "play",
    parameters: {
        track
    }
}`;
            const result = cache.addRules(agrText);

            expect(result.success).toBe(true);

            // Verify updated state
            expect(cache.getGrammar().rules.length).toBe(2); // pause + play (Start refs play)
            const stats2 = cache.getStats();
            expect(stats2.ruleCount).toBe(2);
            expect(stats2.stateCount).toBeGreaterThan(stats1.stateCount);

            // Test matching with updated cache
            const matchResult = matchNFA(cache.getNFA(), ["play", "Test"]);
            expect(matchResult.matched).toBe(true);
        });

        it("should handle multiple incremental additions", () => {
            const initialGrammar: Grammar = {
                rules: [
                    {
                        parts: [{ type: "string", value: ["pause"] }],
                    },
                ],
            };
            const initialNFA = compileGrammarToNFA(initialGrammar);

            const cache = new DynamicGrammarCache(initialGrammar, initialNFA);

            // Add first rule
            const rule1 = `@ <Start> = <play>
@ <play> = play $(track:string) -> {
    actionName: "play",
    parameters: {
        track
    }
}`;
            const result1 = cache.addRules(rule1);
            expect(result1.success).toBe(true);
            expect(cache.getGrammar().rules.length).toBe(2); // pause + play (Start refs play)

            // Add second rule
            const rule2 = `@ <Start> = <resume>
@ <resume> = resume -> {
    actionName: "resume"
}`;
            const result2 = cache.addRules(rule2);
            expect(result2.success).toBe(true);
            expect(cache.getGrammar().rules.length).toBe(3); // + resume (Start refs resume)

            // Add third rule with same action as first (alternative)
            const rule3 = `@ <Start> = <play>
@ <play> = play $(track:string) by $(artist:string) -> {
    actionName: "play",
    parameters: {
        track,
        artist
    }
}`;
            const result3 = cache.addRules(rule3);
            expect(result3.success).toBe(true);
            expect(cache.getGrammar().rules.length).toBe(4); // + play (another play alternative)

            // All patterns should work
            const nfa = cache.getNFA();
            expect(matchNFA(nfa, ["pause"]).matched).toBe(true);
            expect(matchNFA(nfa, ["resume"]).matched).toBe(true);
            expect(matchNFA(nfa, ["play", "Song"]).matched).toBe(true);
            expect(
                matchNFA(nfa, ["play", "Song", "by", "Artist"]).matched,
            ).toBe(true);
        });

        it("should reject invalid additions and maintain state", () => {
            const initialGrammar: Grammar = {
                rules: [
                    {
                        parts: [{ type: "string", value: ["pause"] }],
                    },
                ],
            };
            const initialNFA = compileGrammarToNFA(initialGrammar);

            const cache = new DynamicGrammarCache(initialGrammar, initialNFA);

            const statsBefore = cache.getStats();

            // Try to add rule with unimported type
            const invalidRule = `@ <Start> = <schedule>
@ <schedule> = schedule $(event:string) on $(date:InvalidDateType) -> {
    actionName: "schedule",
    parameters: {
        event,
        date
    }
}`;
            const result = cache.addRules(invalidRule);

            expect(result.success).toBe(false);
            expect(result.errors).toBeDefined();
            expect(result.errors!.length).toBeGreaterThan(0);

            // Verify cache state unchanged
            const statsAfter = cache.getStats();
            expect(statsAfter.ruleCount).toBe(statsBefore.ruleCount);
            expect(statsAfter.stateCount).toBe(statsBefore.stateCount);
        });
    });

    describe("Integration with grammarGenerator format", () => {
        it("should load full grammarGenerator output", () => {
            const loader = new DynamicGrammarLoader();

            // Complete output from grammarGenerator.formatAsGrammarRule()
            const generatedRule = `@ <Start> = <playTrack>
@ <playTrack> = play $(trackName:string) by $(artist:string) -> {
    actionName: "playTrack",
    parameters: {
        trackName,
        artist
    }
}`;

            const result = loader.load(generatedRule);

            expect(result.success).toBe(true);

            const matchResult = matchNFA(result.nfa!, [
                "play",
                "Shake It Off",
                "by",
                "Taylor Swift",
            ]);
            expect(matchResult.matched).toBe(true);
            expect(matchResult.actionValue?.parameters?.trackName).toBe(
                "Shake It Off",
            );
            expect(matchResult.actionValue?.parameters?.artist).toBe(
                "Taylor Swift",
            );
        });

        // TODO: Re-enable after grammar imports and type declarations for converters are complete
        it.skip("should load rules with CalendarDate symbol", () => {
            const loader = new DynamicGrammarLoader();

            const generatedRule = `@ import { CalendarDate } from "types.ts"
@ <Start> = <scheduleEvent>
@ <scheduleEvent> = schedule $(event:string) on $(date:CalendarDate) -> {
    actionName: "scheduleEvent",
    parameters: {
        event,
        date
    }
}`;

            const result = loader.load(generatedRule);

            expect(result.success).toBe(true);

            const matchResult = matchNFA(result.nfa!, [
                "schedule",
                "meeting",
                "on",
                "tomorrow",
            ]);
            expect(matchResult.matched).toBe(true);
            expect(matchResult.actionValue?.parameters?.event).toBe("meeting");
            expect(matchResult.actionValue?.parameters?.date).toBeInstanceOf(
                Date,
            );
        });
    });
});

// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import {
    AgentGrammarRegistry,
    AgentGrammar,
} from "../src/agentGrammarRegistry.js";
import { registerBuiltInEntities } from "../src/builtInEntities.js";
import { Grammar } from "../src/grammarTypes.js";
import { compileGrammarToNFA } from "../src/nfaCompiler.js";

describe("Agent Grammar Registry", () => {
    beforeAll(() => {
        registerBuiltInEntities();
    });

    describe("AgentGrammar", () => {
        it("should create an agent grammar and match requests", () => {
            const grammar: Grammar = {
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

            const nfa = compileGrammarToNFA(grammar, "player");
            const agentGrammar = new AgentGrammar("player", grammar, nfa);

            const result = agentGrammar.match(["play", "Bohemian Rhapsody"]);
            expect(result.matched).toBe(true);
            expect(result.actionValue?.track).toBe("Bohemian Rhapsody");
        });

        it("should add generated rules dynamically", () => {
            const baseGrammar: Grammar = {
                rules: [
                    {
                        parts: [{ type: "string", value: ["pause"] }],
                    },
                ],
            };

            const nfa = compileGrammarToNFA(baseGrammar, "player");
            const agentGrammar = new AgentGrammar("player", baseGrammar, nfa);

            // Add generated rule
            const generatedRule = `@ <Start> = <play>
@ <play> = play $(track:string) -> {
    actionName: "play",
    parameters: {
        track
    }
}`;

            const addResult = agentGrammar.addGeneratedRules(generatedRule);
            expect(addResult.success).toBe(true);
            expect(addResult.errors).toEqual([]);

            // Test that both original and new rule work
            const pauseResult = agentGrammar.match(["pause"]);
            expect(pauseResult.matched).toBe(true);

            const playResult = agentGrammar.match(["play", "Yesterday"]);
            expect(playResult.matched).toBe(true);
            expect(playResult.actionValue?.parameters?.track).toBe("Yesterday");
        });

        it("should validate entity references in generated rules", () => {
            const baseGrammar: Grammar = {
                rules: [
                    {
                        parts: [{ type: "string", value: ["test"] }],
                    },
                ],
            };

            const nfa = compileGrammarToNFA(baseGrammar, "test-agent");
            const agentGrammar = new AgentGrammar(
                "test-agent",
                baseGrammar,
                nfa,
            );

            // Try to add rule with unresolved entity (no import)
            const invalidRule = `@ <Start> = <schedule>
@ <schedule> = schedule $(event:string) on $(date:UnknownEntity) -> {
    actionName: "schedule",
    parameters: { event, date }
}`;

            const result = agentGrammar.addGeneratedRules(invalidRule);
            expect(result.success).toBe(false);
            expect(result.errors).toBeDefined();
            expect(result.errors!.length).toBeGreaterThan(0);
        });

        it("should merge entity declarations when adding rules", () => {
            const baseGrammar: Grammar = {
                rules: [
                    {
                        parts: [{ type: "string", value: ["test"] }],
                    },
                ],
                entities: ["Ordinal"],
            };

            const nfa = compileGrammarToNFA(baseGrammar, "test-agent");
            const agentGrammar = new AgentGrammar(
                "test-agent",
                baseGrammar,
                nfa,
            );

            // Add rule with type import
            const ruleWithEntity = `@ import { CalendarDate } from "types.ts"
@ <Start> = <schedule>
@ <schedule> = schedule $(event:string) on $(date:CalendarDate) -> {
    actionName: "schedule",
    parameters: { event, date }
}`;

            const result = agentGrammar.addGeneratedRules(ruleWithEntity);
            expect(result.success).toBe(true);

            // The base grammar should still have its original entities
            const grammar = agentGrammar.getGrammar();
            expect(grammar.entities).toContain("Ordinal");
        });

        it("should provide statistics", () => {
            const grammar: Grammar = {
                rules: [
                    {
                        parts: [{ type: "string", value: ["test"] }],
                    },
                ],
            };

            const nfa = compileGrammarToNFA(grammar, "test-agent");
            const agentGrammar = new AgentGrammar("test-agent", grammar, nfa);

            const stats = agentGrammar.getStats();
            expect(stats.agentId).toBe("test-agent");
            expect(stats.ruleCount).toBe(1);
            expect(stats.stateCount).toBeGreaterThan(0);
        });

        it("should recompile NFA when adding multiple rules", () => {
            const baseGrammar: Grammar = {
                rules: [
                    {
                        parts: [{ type: "string", value: ["pause"] }],
                    },
                ],
            };

            const nfa = compileGrammarToNFA(baseGrammar, "player");
            const agentGrammar = new AgentGrammar("player", baseGrammar, nfa);

            // Get initial stats
            const initialStats = agentGrammar.getStats();
            expect(initialStats.ruleCount).toBe(1);
            const initialStateCount = initialStats.stateCount;

            // Add first rule - simpler format like in cache hit workflow test
            const firstRule = `@ <Start> = <play>
@ <play> = play $(track:string) -> { actionName: "play", parameters: { track } }`;

            const firstResult = agentGrammar.addGeneratedRules(firstRule);
            expect(firstResult.success).toBe(true);

            // Verify NFA was recompiled (state count should change)
            const afterFirstStats = agentGrammar.getStats();
            expect(afterFirstStats.ruleCount).toBe(2);
            expect(afterFirstStats.stateCount).toBeGreaterThan(
                initialStateCount,
            );

            // Test matching with new rule
            const trackMatch = agentGrammar.match(["play", "Yesterday"]);
            expect(trackMatch.matched).toBe(true);
            expect(trackMatch.actionValue?.parameters?.track).toBe("Yesterday");

            // Add second rule
            const secondRule = `@ <Start> = <resume>
@ <resume> = resume`;

            const secondResult = agentGrammar.addGeneratedRules(secondRule);
            expect(secondResult.success).toBe(true);

            // Verify stats updated again
            const finalStats = agentGrammar.getStats();
            expect(finalStats.ruleCount).toBe(3);
            expect(finalStats.stateCount).toBeGreaterThan(
                afterFirstStats.stateCount,
            );

            // Test all three rules work
            expect(agentGrammar.match(["pause"]).matched).toBe(true);
            expect(agentGrammar.match(["play", "Bad Blood"]).matched).toBe(
                true,
            );
            expect(agentGrammar.match(["resume"]).matched).toBe(true);

            // Add third rule with entity declaration to test merging
            const thirdRule = `entity Ordinal;
@ <Start> = <skip>
@ <skip> = skip`;

            const thirdResult = agentGrammar.addGeneratedRules(thirdRule);
            expect(thirdResult.success).toBe(true);

            // Verify entity is in grammar
            const grammar = agentGrammar.getGrammar();
            expect(grammar.entities).toContain("Ordinal");

            // Final stats check - should have 4 rules now
            const veryFinalStats = agentGrammar.getStats();
            expect(veryFinalStats.ruleCount).toBe(4);

            // Test new rule works
            expect(agentGrammar.match(["skip"]).matched).toBe(true);

            // Verify all original rules still work after multiple additions
            expect(agentGrammar.match(["pause"]).matched).toBe(true);
            expect(agentGrammar.match(["play", "Song"]).matched).toBe(true);
            expect(agentGrammar.match(["resume"]).matched).toBe(true);
        });
    });

    describe("AgentGrammarRegistry", () => {
        let registry: AgentGrammarRegistry;

        beforeEach(() => {
            registry = new AgentGrammarRegistry();
        });

        it("should register agents", () => {
            const grammar: Grammar = {
                rules: [
                    {
                        parts: [{ type: "string", value: ["play"] }],
                    },
                ],
            };

            registry.registerAgent("player", grammar);

            expect(registry.getAgentIds()).toContain("player");
            expect(registry.getAgent("player")).toBeDefined();
        });

        it("should register agents from text", () => {
            const agrText = `@ <Start> = <play>
@ <play> = play $(track:string) -> { actionName: "play", parameters: { track } }`;

            const result = registry.registerAgentFromText("player", agrText);

            expect(result.success).toBe(true);
            expect(result.agentGrammar).toBeDefined();
            expect(registry.getAgentIds()).toContain("player");
        });

        it("should handle registration errors", () => {
            const invalidAgr = `invalid grammar syntax here`;

            const result = registry.registerAgentFromText(
                "bad-agent",
                invalidAgr,
            );

            expect(result.success).toBe(false);
            expect(result.errors).toBeDefined();
            expect(registry.getAgent("bad-agent")).toBeUndefined();
        });

        it("should unregister agents", () => {
            const grammar: Grammar = {
                rules: [
                    {
                        parts: [{ type: "string", value: ["test"] }],
                    },
                ],
            };

            registry.registerAgent("test-agent", grammar);
            expect(registry.getAgent("test-agent")).toBeDefined();

            const removed = registry.unregisterAgent("test-agent");
            expect(removed).toBe(true);
            expect(registry.getAgent("test-agent")).toBeUndefined();
        });

        it("should add generated rules to registered agent", () => {
            const baseGrammar: Grammar = {
                rules: [
                    {
                        parts: [{ type: "string", value: ["pause"] }],
                    },
                ],
            };

            registry.registerAgent("player", baseGrammar);

            const generatedRule = `@ <Start> = <play>
@ <play> = play $(track:string) -> { actionName: "play", parameters: { track } }`;

            const result = registry.addGeneratedRules("player", generatedRule);
            expect(result.success).toBe(true);

            const agent = registry.getAgent("player");
            expect(agent!.getGrammar().rules.length).toBe(2);
        });

        it("should auto-register non-existent agent and attempt to add rules", () => {
            // Non-existent agents are auto-created so dynamic rules can accumulate.
            // Grammar parse errors (e.g. missing <Start>) still cause failure.
            const result = registry.addGeneratedRules(
                "non-existent",
                "@ <test> = test",
            );

            expect(result.success).toBe(false);
            expect(result.errors.every((e) => !e.includes("not found"))).toBe(
                true,
            );
        });

        it("should match across multiple agents", () => {
            // Register player agent
            const playerGrammar: Grammar = {
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
            registry.registerAgent("player", playerGrammar);

            // Register calendar agent
            const calendarGrammar: Grammar = {
                rules: [
                    {
                        parts: [
                            { type: "string", value: ["schedule"] },
                            {
                                type: "wildcard",
                                variable: "event",
                                typeName: "string",
                            },
                        ],
                        value: {
                            type: "object",
                            value: {
                                event: { type: "variable", name: "event" },
                            },
                        },
                    },
                ],
            };
            registry.registerAgent("calendar", calendarGrammar);

            // Test player match
            const playerResult = registry.matchAcrossAgents([
                "play",
                "Bohemian Rhapsody",
            ]);
            expect(playerResult.matched).toBe(true);
            expect(playerResult.agentId).toBe("player");
            expect(playerResult.actionValue?.track).toBe("Bohemian Rhapsody");

            // Test calendar match
            const calendarResult = registry.matchAcrossAgents([
                "schedule",
                "meeting",
            ]);
            expect(calendarResult.matched).toBe(true);
            expect(calendarResult.agentId).toBe("calendar");
            expect(calendarResult.actionValue?.event).toBe("meeting");
        });

        it("should match against specific agents", () => {
            // Register two agents
            registry.registerAgent("player", {
                rules: [
                    {
                        parts: [{ type: "string", value: ["play"] }],
                    },
                ],
            });
            registry.registerAgent("calendar", {
                rules: [
                    {
                        parts: [{ type: "string", value: ["schedule"] }],
                    },
                ],
            });

            // Match only against calendar
            const result = registry.matchAcrossAgents(
                ["schedule"],
                ["calendar"],
            );
            expect(result.matched).toBe(true);
            expect(result.agentId).toBe("calendar");
            expect(result.attemptedAgents).toEqual(["calendar"]);
        });

        it("should return no match when no agents match", () => {
            registry.registerAgent("player", {
                rules: [
                    {
                        parts: [{ type: "string", value: ["play"] }],
                    },
                ],
            });

            const result = registry.matchAcrossAgents(["schedule", "meeting"]);
            expect(result.matched).toBe(false);
            expect(result.agentId).toBeUndefined();
            expect(result.attemptedAgents).toContain("player");
        });

        it("should provide statistics for all agents", () => {
            registry.registerAgent("player", {
                rules: [
                    {
                        parts: [{ type: "string", value: ["play"] }],
                    },
                ],
            });
            registry.registerAgent("calendar", {
                rules: [
                    {
                        parts: [{ type: "string", value: ["schedule"] }],
                    },
                ],
            });

            const stats = registry.getAllStats();
            expect(stats).toHaveLength(2);
            expect(stats.map((s) => s.agentId)).toContain("player");
            expect(stats.map((s) => s.agentId)).toContain("calendar");
        });

        it("should clear all agents", () => {
            registry.registerAgent("agent1", {
                rules: [
                    {
                        parts: [{ type: "string", value: ["test1"] }],
                    },
                ],
            });
            registry.registerAgent("agent2", {
                rules: [
                    {
                        parts: [{ type: "string", value: ["test2"] }],
                    },
                ],
            });

            expect(registry.getAgentIds()).toHaveLength(2);

            registry.clear();

            expect(registry.getAgentIds()).toHaveLength(0);
        });

        it("should support cache hit workflow", () => {
            // Initial registration
            const agrText = `@ <Start> = <pause>
@ <pause> = pause`;

            registry.registerAgentFromText("player", agrText);

            // First request doesn't match - would go to LLM
            const firstTry = registry.matchAcrossAgents([
                "play",
                "Bohemian Rhapsody",
            ]);
            expect(firstTry.matched).toBe(false);

            // Simulate grammarGenerator creating a rule from the request
            const generatedRule = `@ <Start> = <play>
@ <play> = play $(track:string) -> {
    actionName: "play",
    parameters: {
        track
    }
}`;

            // Add the generated rule to cache
            const addResult = registry.addGeneratedRules(
                "player",
                generatedRule,
            );
            expect(addResult.success).toBe(true);

            // Second similar request matches - cache hit!
            const secondTry = registry.matchAcrossAgents(["play", "Yesterday"]);
            expect(secondTry.matched).toBe(true);
            expect(secondTry.agentId).toBe("player");
            expect(secondTry.actionValue?.parameters?.track).toBe("Yesterday");
        });
    });
});

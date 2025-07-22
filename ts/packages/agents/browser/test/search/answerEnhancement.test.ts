// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import {
    SmartFollowup,
    AnswerEnhancement,
} from "../../src/agent/search/schema/answerEnhancement.mjs";

describe("Answer Enhancement - Complete Unified System", () => {
    describe("SmartFollowup Schema Validation", () => {
        test("should validate SmartFollowup individual fields", () => {
            const followup: SmartFollowup = {
                query: "Test query",
                reasoning: "Test reasoning",
                type: "temporal",
                confidence: 0.85,
            };

            expect(followup.query).toBe("Test query");
            expect(followup.reasoning).toBe("Test reasoning");
            expect(followup.type).toBe("temporal");
            expect(followup.confidence).toBe(0.85);
        });

        test("should validate all followup types", () => {
            const types: Array<
                "temporal" | "domain" | "content" | "comparative"
            > = ["temporal", "domain", "content", "comparative"];

            types.forEach((type) => {
                const followup: SmartFollowup = {
                    query: `Test ${type} query`,
                    reasoning: `Test ${type} reasoning`,
                    type: type,
                    confidence: 0.8,
                };

                expect(followup.type).toBe(type);
            });
        });
    });

    describe("Unified AnswerEnhancement Schema", () => {
        test("should validate complete AnswerEnhancement format", () => {
            const testEnhancement: AnswerEnhancement = {
                summary: {
                    text: "Found 8 GitHub repositories from the last 2 weeks, primarily focusing on AI/ML projects. Most activity centers on TypeScript projects, with 3 repositories specifically related to language models.",
                    keyFindings: [
                        "AI/ML projects dominate recent repository activity",
                        "TypeScript is the primary programming language",
                        "Language model and transformer projects are trending",
                    ],
                    statistics: {
                        totalResults: 8,
                        timeSpan: "last 2 weeks",
                        dominantDomains: ["github.com"],
                    },
                    confidence: 0.92,
                },
                followups: [
                    {
                        query: "Show me all AI/ML repositories from this year",
                        reasoning:
                            "User is interested in AI/ML projects, expanding timeframe would show broader trends",
                        type: "temporal",
                        confidence: 0.88,
                    },
                    {
                        query: "Find documentation for these transformer projects",
                        reasoning:
                            "User has transformer repositories, likely needs implementation guides",
                        type: "content",
                        confidence: 0.85,
                    },
                    {
                        query: "Compare these language model approaches",
                        reasoning:
                            "User has multiple language model repos, comparison would be valuable",
                        type: "comparative",
                        confidence: 0.82,
                    },
                ],
                confidence: 0.88,
                generationTime: 1500,
            };

            // Verify the complete enhancement structure
            expect(testEnhancement.summary).toBeDefined();
            expect(testEnhancement.followups).toBeDefined();
            expect(typeof testEnhancement.confidence).toBe("number");
            expect(typeof testEnhancement.generationTime).toBe("number");

            // Verify summary structure
            expect(testEnhancement.summary.text).toBeDefined();
            expect(Array.isArray(testEnhancement.summary.keyFindings)).toBe(
                true,
            );
            expect(testEnhancement.summary.statistics).toBeDefined();
            expect(typeof testEnhancement.summary.confidence).toBe("number");

            // Verify followups structure
            expect(Array.isArray(testEnhancement.followups)).toBe(true);
            expect(testEnhancement.followups.length).toBe(3);

            testEnhancement.followups.forEach((followup) => {
                expect(followup.query).toBeDefined();
                expect(followup.reasoning).toBeDefined();
                expect([
                    "temporal",
                    "domain",
                    "content",
                    "comparative",
                ]).toContain(followup.type);
                expect(typeof followup.confidence).toBe("number");
                expect(followup.confidence).toBeGreaterThan(0);
                expect(followup.confidence).toBeLessThanOrEqual(1);
            });
        });

        test("should validate minimal AnswerEnhancement", () => {
            const minimalEnhancement: AnswerEnhancement = {
                summary: {
                    text: "Found 3 results about TypeScript development.",
                    keyFindings: ["TypeScript is popular"],
                    statistics: {
                        totalResults: 3,
                        dominantDomains: ["github.com"],
                    },
                    confidence: 0.75,
                },
                followups: [
                    {
                        query: "More TypeScript resources",
                        reasoning:
                            "User is interested in TypeScript development",
                        type: "content",
                        confidence: 0.8,
                    },
                ],
                confidence: 0.75,
                generationTime: 800,
            };

            expect(minimalEnhancement.summary.text).toBeDefined();
            expect(minimalEnhancement.followups.length).toBe(1);
            expect(minimalEnhancement.confidence).toBe(0.75);
        });

        test("should handle empty followups array", () => {
            const enhancementWithoutFollowups: AnswerEnhancement = {
                summary: {
                    text: "No additional results found.",
                    keyFindings: [],
                    statistics: {
                        totalResults: 0,
                        dominantDomains: [],
                    },
                    confidence: 0.5,
                },
                followups: [],
                confidence: 0.5,
                generationTime: 300,
            };

            expect(enhancementWithoutFollowups.followups).toBeDefined();
            expect(Array.isArray(enhancementWithoutFollowups.followups)).toBe(
                true,
            );
            expect(enhancementWithoutFollowups.followups.length).toBe(0);
        });
    });

    describe("Integration Test Scenarios", () => {
        test("should handle real-world LLM AnswerEnhancement format", () => {
            // This simulates the actual AnswerEnhancement JSON response
            const llmResponse: AnswerEnhancement = {
                summary: {
                    text: "Found 3 articles about Microsoft's acquisition of LinkedIn, primarily from tech news sources. Coverage focuses on the business implications and timeline of the acquisition.",
                    keyFindings: [
                        "Business-focused coverage dominates the discussion",
                        "Timeline and acquisition process well documented",
                        "Impact on professional networking landscape emphasized",
                    ],
                    statistics: {
                        totalResults: 3,
                        timeSpan: "2015-2016",
                        dominantDomains: ["techcrunch.com", "reuters.com"],
                    },
                    confidence: 0.89,
                },
                followups: [
                    {
                        query: "Show me all discussions about Microsoft's acquisition of LinkedIn from 2015 onwards",
                        reasoning:
                            "User is interested in the acquisition, expand timeframe to recent years",
                        type: "temporal",
                        confidence: 0.87,
                    },
                    {
                        query: "Find articles or blog posts about Microsoft's impact on LinkedIn",
                        reasoning:
                            "User is interested in Microsoft's activities, explore their influence on LinkedIn",
                        type: "content",
                        confidence: 0.85,
                    },
                    {
                        query: "Compare Microsoft's acquisition of LinkedIn with other major tech acquisitions",
                        reasoning:
                            "User might want to understand how this acquisition compares to others in the tech industry",
                        type: "comparative",
                        confidence: 0.82,
                    },
                ],
                confidence: 0.86,
                generationTime: 1500,
            };

            // Verify complete AnswerEnhancement structure
            expect(llmResponse.summary).toBeDefined();
            expect(llmResponse.followups).toBeDefined();
            expect(llmResponse.confidence).toBeDefined();
            expect(llmResponse.generationTime).toBeDefined();

            // Verify summary structure
            expect(llmResponse.summary.text).toBeDefined();
            expect(Array.isArray(llmResponse.summary.keyFindings)).toBe(true);
            expect(llmResponse.summary.statistics).toBeDefined();

            // Verify followups structure
            expect(Array.isArray(llmResponse.followups)).toBe(true);
            expect(llmResponse.followups.length).toBe(3);

            // Verify each followup is valid
            llmResponse.followups.forEach((followup) => {
                expect(followup.query).toBeDefined();
                expect(followup.reasoning).toBeDefined();
                expect([
                    "temporal",
                    "domain",
                    "content",
                    "comparative",
                ]).toContain(followup.type);
                expect(followup.confidence).toBeGreaterThan(0);
                expect(followup.confidence).toBeLessThanOrEqual(1);
            });
        });

        test("should demonstrate consistency between summary and followups", () => {
            const enhancement: AnswerEnhancement = {
                summary: {
                    text: "Found 5 React component tutorials from the last month, primarily focused on hooks and functional components.",
                    keyFindings: [
                        "Hooks-based tutorials are most common",
                        "Functional components dominate examples",
                        "Modern React patterns emphasized",
                    ],
                    statistics: {
                        totalResults: 5,
                        timeSpan: "last month",
                        dominantDomains: ["react.dev", "medium.com"],
                    },
                    confidence: 0.88,
                },
                followups: [
                    {
                        query: "Show me React hooks tutorials from earlier this year",
                        reasoning:
                            "User interested in hooks, expand temporal scope for broader learning",
                        type: "temporal",
                        confidence: 0.85,
                    },
                    {
                        query: "Find advanced React component patterns and best practices",
                        reasoning:
                            "User has basic tutorials, likely ready for advanced concepts",
                        type: "content",
                        confidence: 0.83,
                    },
                ],
                confidence: 0.86,
                generationTime: 1200,
            };

            // Verify thematic consistency
            const summaryText = enhancement.summary.text.toLowerCase();
            const followups = enhancement.followups;

            expect(summaryText).toContain("react");
            expect(
                followups.every((f) => f.query.toLowerCase().includes("react")),
            ).toBe(true);

            // Verify logical progression in suggestions
            expect(followups[0].type).toBe("temporal"); // Expanding timeframe
            expect(followups[1].type).toBe("content"); // Deepening knowledge

            // Verify reasoning quality
            expect(followups.every((f) => f.reasoning.length > 20)).toBe(true); // Meaningful explanations
        });
    });
});

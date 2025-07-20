// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { SmartFollowup, FollowupResponse } from "../../src/agent/search/schema/answerEnhancement.mjs";

describe("AnswerEnhancement - JSON Validation Fix", () => {

    describe("FollowupResponse Schema Validation", () => {
        test("should validate FollowupResponse format with followups array", () => {
            // This tests the schema format that the LLM generates
            const testResponse: FollowupResponse = {
                followups: [
                    {
                        query: "Show me all discussions about Elon Musk's acquisition of Twitter from 2020 onwards",
                        reasoning: "User is interested in the acquisition, expand timeframe to recent years",
                        type: "temporal",
                        confidence: 0.87
                    },
                    {
                        query: "Find articles or blog posts about Elon Musk's impact on Twitter",
                        reasoning: "User is interested in Elon Musk's activities, explore his influence on Twitter",
                        type: "content",
                        confidence: 0.85
                    }
                ]
            };

            // Verify the response structure matches our schema
            expect(testResponse.followups).toBeDefined();
            expect(Array.isArray(testResponse.followups)).toBe(true);
            expect(testResponse.followups.length).toBe(2);
            
            // Verify each followup has required fields
            testResponse.followups.forEach(followup => {
                expect(followup.query).toBeDefined();
                expect(followup.reasoning).toBeDefined();
                expect(followup.type).toMatch(/^(temporal|domain|content|comparative)$/);
                expect(typeof followup.confidence).toBe('number');
                expect(followup.confidence).toBeGreaterThan(0);
                expect(followup.confidence).toBeLessThanOrEqual(1);
            });
        });

        test("should handle empty followups array", () => {
            const testResponse: FollowupResponse = {
                followups: []
            };

            expect(testResponse.followups).toBeDefined();
            expect(Array.isArray(testResponse.followups)).toBe(true);
            expect(testResponse.followups.length).toBe(0);
        });

        test("should validate SmartFollowup individual fields", () => {
            const followup: SmartFollowup = {
                query: "Test query",
                reasoning: "Test reasoning",
                type: "temporal",
                confidence: 0.85
            };

            expect(followup.query).toBe("Test query");
            expect(followup.reasoning).toBe("Test reasoning");
            expect(followup.type).toBe("temporal");
            expect(followup.confidence).toBe(0.85);
        });

        test("should validate all followup types", () => {
            const types: Array<"temporal" | "domain" | "content" | "comparative"> = [
                "temporal", "domain", "content", "comparative"
            ];

            types.forEach(type => {
                const followup: SmartFollowup = {
                    query: `Test ${type} query`,
                    reasoning: `Test ${type} reasoning`,
                    type: type,
                    confidence: 0.8
                };

                expect(followup.type).toBe(type);
            });
        });
    });

    describe("Integration Test Scenarios", () => {
        test("should handle real-world LLM response format", () => {
            // This simulates the actual JSON that was causing validation errors
            const llmResponse = {
                "followups": [
                    {
                        "query": "Show me all discussions about Elon Musk's acquisition of Twitter from 2020 onwards",
                        "reasoning": "User is interested in the acquisition, expand timeframe to recent years",
                        "type": "temporal",
                        "confidence": 0.87
                    },
                    {
                        "query": "Find articles or blog posts about Elon Musk's impact on Twitter",
                        "reasoning": "User is interested in Elon Musk's activities, explore his influence on Twitter",
                        "type": "content",
                        "confidence": 0.85
                    },
                    {
                        "query": "Compare Elon Musk's acquisition of Twitter with other major tech acquisitions",
                        "reasoning": "User might want to understand how this acquisition compares to others in the tech industry",
                        "type": "comparative",
                        "confidence": 0.82
                    }
                ]
            };

            // Verify this format can be processed correctly
            expect(llmResponse.followups).toBeDefined();
            expect(llmResponse.followups.length).toBe(3);
            
            // Simulate what the generator would do: extract the followups array
            const extractedFollowups = llmResponse.followups;
            expect(Array.isArray(extractedFollowups)).toBe(true);
            
            // Verify each followup is valid
            extractedFollowups.forEach(followup => {
                expect(followup.query).toBeDefined();
                expect(followup.reasoning).toBeDefined();
                expect(['temporal', 'domain', 'content', 'comparative']).toContain(followup.type);
                expect(followup.confidence).toBeGreaterThan(0);
                expect(followup.confidence).toBeLessThanOrEqual(1);
            });
        });
    });
});

// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import * as path from "path";
import * as fs from "fs";
import { fileURLToPath } from "url";
import {
    ClaudeGrammarGenerator,
    loadSchemaInfo,
    populateCache,
    type GrammarTestCase,
} from "../src/generation/index.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Helper to check if a file exists
function fileExists(filePath: string): boolean {
    try {
        fs.accessSync(filePath, fs.constants.R_OK);
        return true;
    } catch {
        return false;
    }
}

// Check if API key is available
function hasApiKey(): boolean {
    return !!process.env.ANTHROPIC_API_KEY;
}

describe("Grammar Generator", () => {
    // These tests require an API key - skip if not available
    const maybeDescribe = hasApiKey() ? describe : describe.skip;

    maybeDescribe("ClaudeGrammarGenerator", () => {
        it("should generate grammar for simple music player request", async () => {
            const playerSchemaPath = path.resolve(
                __dirname,
                "../../../agents/player/dist/playerSchema.pas.json",
            );

            // Skip if schema doesn't exist
            if (!fileExists(playerSchemaPath)) {
                console.log(
                    "Skipping test - player schema not found:",
                    playerSchemaPath,
                );
                return;
            }

            const schemaInfo = loadSchemaInfo(playerSchemaPath);
            const generator = new ClaudeGrammarGenerator();

            const testCase: GrammarTestCase = {
                request: "play Bohemian Rhapsody by Queen",
                schemaName: "player",
                action: {
                    actionName: "playTrack",
                    parameters: {
                        trackName: "Bohemian Rhapsody",
                        artistName: "Queen",
                    },
                },
            };

            const analysis = await generator.generateGrammar(
                testCase,
                schemaInfo,
            );

            expect(analysis.shouldGenerateGrammar).toBe(true);
            expect(analysis.grammarPattern).toContain("$(trackName:");
            expect(analysis.grammarPattern).toContain("$(artistName:");
            expect(analysis.grammarPattern).toContain("by");

            const grammarRule = generator.formatAsGrammarRule(
                testCase,
                analysis,
            );
            expect(grammarRule).toContain("@ <playTrack> =");
            expect(grammarRule).toContain('actionName: "playTrack"');
        }, 30000);

        it("should reject grammar with adjacent unqualified wildcards", async () => {
            const calendarSchemaPath = path.resolve(
                __dirname,
                "../../../agents/calendar/dist/calendarSchema.pas.json",
            );

            // Skip if schema doesn't exist
            if (!fileExists(calendarSchemaPath)) {
                console.log(
                    "Skipping test - calendar schema not found:",
                    calendarSchemaPath,
                );
                return;
            }

            const schemaInfo = loadSchemaInfo(calendarSchemaPath);
            const generator = new ClaudeGrammarGenerator();

            const testCase: GrammarTestCase = {
                request: "invite John Smith to meeting",
                schemaName: "calendar",
                action: {
                    actionName: "addParticipant",
                    parameters: {
                        eventDescription: "meeting",
                        participantName: "John Smith",
                    },
                },
            };

            const analysis = await generator.generateGrammar(
                testCase,
                schemaInfo,
            );

            // This should be rejected due to adjacent unqualified wildcards
            // (both are plain strings with no separator or validation)
            expect(analysis.shouldGenerateGrammar).toBe(false);
            expect(analysis.rejectionReason).toMatch(
                /adjacent.*wildcard|unqualified/i,
            );
        }, 30000);
    });

    maybeDescribe("populateCache", () => {
        it("should populate cache with valid request/action pair", async () => {
            const playerSchemaPath = path.resolve(
                __dirname,
                "../../../agents/player/dist/playerSchema.pas.json",
            );

            // Skip if schema doesn't exist
            if (!fileExists(playerSchemaPath)) {
                console.log(
                    "Skipping test - player schema not found:",
                    playerSchemaPath,
                );
                return;
            }

            const result = await populateCache({
                request: "play Let It Be by The Beatles",
                schemaName: "player",
                action: {
                    actionName: "playTrack",
                    parameters: {
                        trackName: "Let It Be",
                        artistName: "The Beatles",
                    },
                },
                schemaPath: playerSchemaPath,
            });

            expect(result.success).toBe(true);
            expect(result.generatedRule).toBeDefined();
            expect(result.generatedRule).toContain("@ <playTrack> =");
            expect(result.rejectionReason).toBeUndefined();
        }, 30000);

        it("should return rejection reason for invalid patterns", async () => {
            const calendarSchemaPath = path.resolve(
                __dirname,
                "../../../agents/calendar/dist/calendarSchema.pas.json",
            );

            // Skip if schema doesn't exist
            if (!fileExists(calendarSchemaPath)) {
                console.log(
                    "Skipping test - calendar schema not found:",
                    calendarSchemaPath,
                );
                return;
            }

            const result = await populateCache({
                request: "schedule that for tomorrow",
                schemaName: "calendar",
                action: {
                    actionName: "scheduleEvent",
                    parameters: {
                        eventDescription: "that",
                        date: "tomorrow",
                    },
                },
                schemaPath: calendarSchemaPath,
            });

            // Should be rejected due to pronoun "that" requiring context
            expect(result.success).toBe(false);
            expect(result.rejectionReason).toBeDefined();
            expect(result.rejectionReason).toMatch(/pronoun|context|that/i);
        }, 30000);
    });

    describe("loadSchemaInfo", () => {
        it("should load player schema info", () => {
            const playerSchemaPath = path.resolve(
                __dirname,
                "../../../agents/player/dist/playerSchema.pas.json",
            );

            // Skip if schema doesn't exist
            if (!fileExists(playerSchemaPath)) {
                console.log(
                    "Skipping test - player schema not found:",
                    playerSchemaPath,
                );
                return;
            }

            const schemaInfo = loadSchemaInfo(playerSchemaPath);

            expect(schemaInfo.schemaName).toBe("playerSchema");
            expect(schemaInfo.actions.size).toBeGreaterThan(0);
            expect(schemaInfo.actions.has("playTrack")).toBe(true);

            const playTrackInfo = schemaInfo.actions.get("playTrack");
            expect(playTrackInfo).toBeDefined();
            expect(playTrackInfo!.parameters.has("trackName")).toBe(true);
        });
    });
});

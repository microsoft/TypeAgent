// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/**
 * INTEGRATION TESTS - Require API Keys
 *
 * These tests make actual API calls to Claude and require valid API keys to run.
 * They are excluded from the default test suite and CI runs.
 *
 * To run these tests locally:
 * 1. Set up your API keys in .env file
 * 2. Run: npm run test:integration
 *
 * These tests are not run by `npm test` or in CI.
 */

import * as path from "path";
import * as fs from "fs";
import { fileURLToPath } from "url";
import {
    ClaudeGrammarGenerator,
    loadSchemaInfo,
    populateCache,
    type GrammarTestCase,
} from "../src/generation/index.js";
import { loadGrammarRules } from "../src/grammarLoader.js";

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

describe("Grammar Generator", () => {
    describe("ClaudeGrammarGenerator", () => {
        it("should generate grammar for simple music player request", async () => {
            const playerSchemaPath = path.resolve(
                __dirname,
                "../../../agents/player/dist/agent/playerSchema.pas.json",
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
            expect(analysis.grammarPattern.matchPattern).toContain(
                "$(trackName:",
            );
            expect(analysis.grammarPattern.matchPattern).toContain(
                "$(artistName:",
            );
            expect(analysis.grammarPattern.matchPattern).toContain("by");

            const grammarRule = generator.formatAsGrammarRule(
                testCase,
                analysis,
                schemaInfo,
            );
            expect(grammarRule).toContain("<playTrack> =");
            expect(grammarRule).toContain('actionName: "playTrack"');
        }, 30000);

        it("should accept grammar with proper separators between wildcards", async () => {
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

            // This should be accepted because "to" provides clear separation
            // between the two wildcards (participantName and eventDescription)
            expect(analysis.shouldGenerateGrammar).toBe(true);
            expect(analysis.grammarPattern.matchPattern).toContain("to");
        }, 30000);
    });

    describe("populateCache", () => {
        it("should populate cache with valid request/action pair", async () => {
            const playerSchemaPath = path.resolve(
                __dirname,
                "../../../agents/player/dist/agent/playerSchema.pas.json",
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
            expect(result.generatedRule).toContain("<playTrack> =");
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
                "../../../agents/player/dist/agent/playerSchema.pas.json",
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

    describe("Entity Type Usage", () => {
        it("should use MusicDevice entity type for device parameters", async () => {
            const playerSchemaPath = path.resolve(
                __dirname,
                "../../../agents/player/dist/agent/playerSchema.pas.json",
            );

            if (!fileExists(playerSchemaPath)) {
                console.log("Skipping test - player schema not found");
                return;
            }

            const schemaInfo = loadSchemaInfo(playerSchemaPath);
            const generator = new ClaudeGrammarGenerator();

            const testCase: GrammarTestCase = {
                request: "select kitchen device",
                schemaName: "player",
                action: {
                    actionName: "selectDevice",
                    parameters: {
                        deviceName: "kitchen",
                    },
                },
            };

            const analysis = await generator.generateGrammar(
                testCase,
                schemaInfo,
            );

            expect(analysis.shouldGenerateGrammar).toBe(true);

            const grammarRule = generator.formatAsGrammarRule(
                testCase,
                analysis,
                schemaInfo,
            );

            // Should use MusicDevice entity type, not string
            expect(grammarRule).toContain("$(deviceName:MusicDevice)");
            expect(grammarRule).not.toContain("$(deviceName:string)");
        }, 30000);

        it("should use string for parameters without entity types", async () => {
            const playerSchemaPath = path.resolve(
                __dirname,
                "../../../agents/player/dist/agent/playerSchema.pas.json",
            );

            if (!fileExists(playerSchemaPath)) {
                console.log("Skipping test - player schema not found");
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
                        artists: ["Queen"],
                    },
                },
            };

            const analysis = await generator.generateGrammar(
                testCase,
                schemaInfo,
            );

            expect(analysis.shouldGenerateGrammar).toBe(true);

            const grammarRule = generator.formatAsGrammarRule(
                testCase,
                analysis,
                schemaInfo,
            );

            // trackName and artists have paramSpec "checked_wildcard" but no entity type
            // Should use string, not made-up entity type names
            expect(grammarRule).toContain("$(trackName:string)");
            expect(grammarRule).toContain("$(artist:string)"); // singular for array
            expect(grammarRule).not.toContain("TrackName");
            expect(grammarRule).not.toContain("ArtistName");
        }, 30000);

        it("should use singular variable names for array parameters", async () => {
            const playerSchemaPath = path.resolve(
                __dirname,
                "../../../agents/player/dist/agent/playerSchema.pas.json",
            );

            if (!fileExists(playerSchemaPath)) {
                console.log("Skipping test - player schema not found");
                return;
            }

            const schemaInfo = loadSchemaInfo(playerSchemaPath);
            const generator = new ClaudeGrammarGenerator();

            const testCase: GrammarTestCase = {
                request: "play album Abbey Road by The Beatles",
                schemaName: "player",
                action: {
                    actionName: "playAlbum",
                    parameters: {
                        albumName: "Abbey Road",
                        artists: ["The Beatles"],
                    },
                },
            };

            const analysis = await generator.generateGrammar(
                testCase,
                schemaInfo,
            );

            expect(analysis.shouldGenerateGrammar).toBe(true);

            const grammarRule = generator.formatAsGrammarRule(
                testCase,
                analysis,
                schemaInfo,
            );

            // Array parameter "artists" should use singular variable name "artist"
            expect(grammarRule).toContain("$(artist:string)");
            expect(grammarRule).not.toContain("$(artists:");

            // Should map to array correctly
            expect(grammarRule).toContain("artists: [$(artist)]");
        }, 30000);

        it("should handle multiple parameters with mixed types", async () => {
            const playerSchemaPath = path.resolve(
                __dirname,
                "../../../agents/player/dist/agent/playerSchema.pas.json",
            );

            if (!fileExists(playerSchemaPath)) {
                console.log("Skipping test - player schema not found");
                return;
            }

            const schemaInfo = loadSchemaInfo(playerSchemaPath);
            const generator = new ClaudeGrammarGenerator();

            const testCase: GrammarTestCase = {
                request: "set default device to kitchen",
                schemaName: "player",
                action: {
                    actionName: "setDefaultDevice",
                    parameters: {
                        deviceName: "kitchen",
                    },
                },
            };

            const analysis = await generator.generateGrammar(
                testCase,
                schemaInfo,
            );

            expect(analysis.shouldGenerateGrammar).toBe(true);

            const grammarRule = generator.formatAsGrammarRule(
                testCase,
                analysis,
                schemaInfo,
            );

            // deviceName should use MusicDevice entity type
            expect(grammarRule).toContain("$(deviceName:MusicDevice)");
            expect(grammarRule).toContain('actionName: "setDefaultDevice"');
            expect(grammarRule).toContain("deviceName: $(deviceName)");
        }, 30000);

        it("should use paramSpec types for ordinal, number, percentage", async () => {
            const playerSchemaPath = path.resolve(
                __dirname,
                "../../../agents/player/dist/agent/playerSchema.pas.json",
            );

            if (!fileExists(playerSchemaPath)) {
                console.log("Skipping test - player schema not found");
                return;
            }

            const schemaInfo = loadSchemaInfo(playerSchemaPath);
            const generator = new ClaudeGrammarGenerator();

            // Test ordinal paramSpec
            const ordinalTestCase: GrammarTestCase = {
                request: "play the 3rd track",
                schemaName: "player",
                action: {
                    actionName: "playFromCurrentTrackList",
                    parameters: {
                        trackNumber: 3,
                    },
                },
            };

            const ordinalAnalysis = await generator.generateGrammar(
                ordinalTestCase,
                schemaInfo,
            );

            if (ordinalAnalysis.shouldGenerateGrammar) {
                const ordinalRule = generator.formatAsGrammarRule(
                    ordinalTestCase,
                    ordinalAnalysis,
                    schemaInfo,
                );

                // Should use ordinal paramSpec, not string or number
                expect(ordinalRule).toContain("$(trackNumber:ordinal)");
                expect(ordinalRule).not.toContain("$(trackNumber:string)");
            }

            // Test number paramSpec
            const numberTestCase: GrammarTestCase = {
                request: "set volume to 50",
                schemaName: "player",
                action: {
                    actionName: "setVolume",
                    parameters: {
                        newVolumeLevel: 50,
                    },
                },
            };

            const numberAnalysis = await generator.generateGrammar(
                numberTestCase,
                schemaInfo,
            );

            if (numberAnalysis.shouldGenerateGrammar) {
                const numberRule = generator.formatAsGrammarRule(
                    numberTestCase,
                    numberAnalysis,
                    schemaInfo,
                );

                // Should use number paramSpec
                expect(numberRule).toContain("$(newVolumeLevel:number)");
                expect(numberRule).not.toContain("$(newVolumeLevel:string)");
            }

            // Test percentage paramSpec
            const percentageTestCase: GrammarTestCase = {
                request: "increase volume by 10 percent",
                schemaName: "player",
                action: {
                    actionName: "changeVolume",
                    parameters: {
                        volumeChangePercentage: 10,
                    },
                },
            };

            const percentageAnalysis = await generator.generateGrammar(
                percentageTestCase,
                schemaInfo,
            );

            if (percentageAnalysis.shouldGenerateGrammar) {
                const percentageRule = generator.formatAsGrammarRule(
                    percentageTestCase,
                    percentageAnalysis,
                    schemaInfo,
                );

                // Should use percentage paramSpec
                expect(percentageRule).toContain(
                    "$(volumeChangePercentage:percentage)",
                );
                expect(percentageRule).not.toContain(
                    "$(volumeChangePercentage:string)",
                );
            }
        }, 45000);

        it("should generate valid grammar rules that compile", async () => {
            const playerSchemaPath = path.resolve(
                __dirname,
                "../../../agents/player/dist/agent/playerSchema.pas.json",
            );

            if (!fileExists(playerSchemaPath)) {
                console.log("Skipping test - player schema not found");
                return;
            }

            const schemaInfo = loadSchemaInfo(playerSchemaPath);
            const generator = new ClaudeGrammarGenerator();

            const testCase: GrammarTestCase = {
                request: "select living room",
                schemaName: "player",
                action: {
                    actionName: "selectDevice",
                    parameters: {
                        deviceName: "living room",
                    },
                },
            };

            const analysis = await generator.generateGrammar(
                testCase,
                schemaInfo,
            );

            expect(analysis.shouldGenerateGrammar).toBe(true);

            const grammarRule = generator.formatAsGrammarRule(
                testCase,
                analysis,
                schemaInfo,
            );

            // Verify the rule has correct structure
            expect(grammarRule).toContain("<Start> = <selectDevice>");
            expect(grammarRule).toContain("<selectDevice> =");
            expect(grammarRule).toContain('actionName: "selectDevice"');
            expect(grammarRule).toContain("$(deviceName:MusicDevice)");

            // Try to compile the rule to verify it's valid
            try {
                const grammar = loadGrammarRules("player", grammarRule);
                expect(grammar).toBeDefined();
                expect(grammar?.rules.length).toBeGreaterThan(0);
            } catch (error: any) {
                fail(
                    `Generated grammar rule failed to compile: ${error.message}\n\nGenerated rule:\n${grammarRule}`,
                );
            }
        }, 45000);

        it("should handle complex natural language requests", async () => {
            const playerSchemaPath = path.resolve(
                __dirname,
                "../../../agents/player/dist/agent/playerSchema.pas.json",
            );

            if (!fileExists(playerSchemaPath)) {
                console.log("Skipping test - player schema not found");
                return;
            }

            const schemaInfo = loadSchemaInfo(playerSchemaPath);
            const generator = new ClaudeGrammarGenerator();

            // Test creative/natural language request
            const testCase: GrammarTestCase = {
                request: "my ear wants to hear shake it off by taylor swift",
                schemaName: "player",
                action: {
                    actionName: "playTrack",
                    parameters: {
                        trackName: "shake it off",
                        artistName: "taylor swift",
                    },
                },
            };

            const analysis = await generator.generateGrammar(
                testCase,
                schemaInfo,
            );

            // This might be accepted or rejected depending on complexity
            // If accepted, verify it extracted the parameters correctly
            if (analysis.shouldGenerateGrammar) {
                expect(analysis.grammarPattern.matchPattern).toContain(
                    "$(trackName:string)",
                );
                expect(analysis.grammarPattern.matchPattern).toContain(
                    "$(artistName:string)",
                );
                expect(analysis.grammarPattern.matchPattern).toContain("by");
            } else {
                // If rejected, it should have a reasonable rejection reason
                expect(analysis.rejectionReason).toBeDefined();
                console.log(
                    "Complex request rejected:",
                    analysis.rejectionReason,
                );
            }
        }, 30000);

        it("should handle natural phras with validated parameters", async () => {
            const playerSchemaPath = path.resolve(
                __dirname,
                "../../../agents/player/dist/agent/playerSchema.pas.json",
            );

            if (!fileExists(playerSchemaPath)) {
                console.log("Skipping test - player schema not found");
                return;
            }

            const schemaInfo = loadSchemaInfo(playerSchemaPath);
            const generator = new ClaudeGrammarGenerator();

            // Test with "I want to hear" phrasing
            const testCase: GrammarTestCase = {
                request: "I want to hear Blinding Lights by The Weeknd",
                schemaName: "player",
                action: {
                    actionName: "playTrack",
                    parameters: {
                        trackName: "Blinding Lights",
                        artistName: "The Weeknd",
                    },
                },
            };

            const analysis = await generator.generateGrammar(
                testCase,
                schemaInfo,
            );

            // Should be accepted - has clear structure with "by" separator
            expect(analysis.shouldGenerateGrammar).toBe(true);
            expect(analysis.grammarPattern.matchPattern).toContain(
                "$(trackName:string)",
            );
            expect(analysis.grammarPattern.matchPattern).toContain(
                "$(artistName:string)",
            );
            expect(analysis.grammarPattern.matchPattern).toContain("by");
        }, 30000);
    });
});

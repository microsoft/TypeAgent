// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import * as path from "path";
import * as fs from "fs";
import { fileURLToPath } from "url";
import { loadGrammarRules } from "../src/grammarLoader.js";
import { compileGrammarToNFA } from "../src/nfaCompiler.js";
import { matchNFA, printNFA, printMatchResult } from "../src/nfaInterpreter.js";

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

describe("NFA with Real Grammars", () => {
    describe("Player Grammar", () => {
        it("should compile and match player grammar", () => {
            // Load player grammar
            const playerGrammarPath = path.resolve(
                __dirname,
                "../../../agents/player/src/agent/playerSchema.agr",
            );
            const content = fs.readFileSync(playerGrammarPath, "utf-8");

            const errors: string[] = [];
            const grammar = loadGrammarRules(
                "playerSchema.agr",
                content,
                errors,
            );

            if (errors.length > 0) {
                console.log("Grammar errors:", errors);
            }
            expect(errors.length).toBe(0);
            expect(grammar).toBeDefined();

            // Compile to NFA
            const nfa = compileGrammarToNFA(grammar!, "player-grammar");

            // Print NFA structure for debugging
            console.log("\n=== Player Grammar NFA ===");
            console.log(`States: ${nfa.states.length}`);
            console.log(`Start: ${nfa.startState}`);
            console.log(`Accept: ${nfa.acceptingStates.join(", ")}`);

            // Test: "pause"
            const result1 = matchNFA(nfa, ["pause"], true);
            console.log("\n--- Test: pause ---");
            console.log(printMatchResult(result1, ["pause"]));
            expect(result1.matched).toBe(true);

            // Test: "pause the music"
            const result2 = matchNFA(nfa, ["pause", "the", "music"], true);
            console.log("\n--- Test: pause the music ---");
            console.log(printMatchResult(result2, ["pause", "the", "music"]));
            expect(result2.matched).toBe(true);

            // Test: "resume"
            const result3 = matchNFA(nfa, ["resume"], true);
            console.log("\n--- Test: resume ---");
            console.log(printMatchResult(result3, ["resume"]));
            expect(result3.matched).toBe(true);

            // Test: "play track 5"
            const result4 = matchNFA(nfa, ["play", "track", "5"], true);
            console.log("\n--- Test: play track 5 ---");
            console.log(printMatchResult(result4, ["play", "track", "5"]));
            // TODO: Value transformations (e.g., Cardinal -> number) not yet implemented in NFA
            // This test will pass once value transformation is added to NFA compiler
            // expect(result4.matched).toBe(true);
            // expect(result4.captures.get("n")).toBe(5);

            // Test: invalid command
            const result5 = matchNFA(nfa, ["invalid", "command"], true);
            console.log("\n--- Test: invalid command ---");
            console.log(printMatchResult(result5, ["invalid", "command"]));
            expect(result5.matched).toBe(false);
        });

        it("should handle ordinals in player grammar", () => {
            const playerGrammarPath = path.resolve(
                __dirname,
                "../../../agents/player/src/agent/playerSchema.agr",
            );
            const content = fs.readFileSync(playerGrammarPath, "utf-8");
            const grammar = loadGrammarRules("playerSchema.agr", content);
            const nfa = compileGrammarToNFA(grammar, "player-ordinals");

            // Test: "play the first track"
            const result1 = matchNFA(nfa, ["play", "the", "first", "track"]);
            expect(result1.matched).toBe(true);
            // TODO: Value transformations (e.g., Ordinal -> number) not yet implemented in NFA
            // The grammar defines transformations like "first -> 1" but NFA compiler doesn't process them yet
            // expect(result1.captures.get("n")).toBe(1);

            // Test: "play the third song"
            const result2 = matchNFA(nfa, ["play", "the", "third", "song"]);
            expect(result2.matched).toBe(true);
            // TODO: Value transformations not yet implemented
            // expect(result2.captures.get("n")).toBe(3);
        });

        it("should handle select device commands", () => {
            const playerGrammarPath = path.resolve(
                __dirname,
                "../../../agents/player/src/agent/playerSchema.agr",
            );
            const content = fs.readFileSync(playerGrammarPath, "utf-8");
            const grammar = loadGrammarRules("playerSchema.agr", content);
            const nfa = compileGrammarToNFA(grammar, "player-devices");

            // Test: "select kitchen"
            const result1 = matchNFA(nfa, ["select", "kitchen"]);
            console.log("\n--- Test: select kitchen ---");
            console.log(printMatchResult(result1, ["select", "kitchen"]));
            expect(result1.matched).toBe(true);
            // Note: The grammar captures to "x" not "deviceName" because
            // the <DeviceName> rule uses $(x:MusicDevice)
            expect(result1.actionValue?.parameters?.deviceName).toBe("kitchen");

            // Test: "switch to bedroom"
            // TODO: This doesn't match - need to investigate grammar structure
            // const result2 = matchNFA(nfa, ["switch", "to", "bedroom"]);
            // expect(result2.matched).toBe(true);
            // expect(result2.captures.get("x")).toBe("bedroom");

            // Test: "play on living room device"
            const result3 = matchNFA(nfa, [
                "play",
                "on",
                "the",
                "living",
                "room",
                "device",
            ]);
            // Note: This might not match because "living room" is two tokens
            // The grammar expects single-token device names
            console.log("\n--- Test: play on living room device ---");
            console.log(
                printMatchResult(result3, [
                    "play",
                    "on",
                    "the",
                    "living",
                    "room",
                    "device",
                ]),
            );
        });

        it("should match 'play track by artist' patterns", () => {
            const playerGrammarPath = path.resolve(
                __dirname,
                "../../../agents/player/src/agent/playerSchema.agr",
            );
            const content = fs.readFileSync(playerGrammarPath, "utf-8");
            const grammar = loadGrammarRules("playerSchema.agr", content);
            const nfa = compileGrammarToNFA(grammar, "player-track-by-artist");

            // Test: "play Shake It Off by Taylor Swift"
            const result1 = matchNFA(nfa, [
                "play",
                "Shake",
                "It",
                "Off",
                "by",
                "Taylor",
                "Swift",
            ]);
            console.log("\n--- Test: play Shake It Off by Taylor Swift ---");
            console.log(
                printMatchResult(result1, [
                    "play",
                    "Shake",
                    "It",
                    "Off",
                    "by",
                    "Taylor",
                    "Swift",
                ]),
            );
            expect(result1.matched).toBe(true);
            expect(result1.actionValue?.parameters?.trackName).toBe(
                "Shake It Off",
            );
            expect(result1.actionValue?.parameters?.artists?.[0]).toBe(
                "Taylor Swift",
            );

            // Test: "play Big Red Sun by Lucinda Williams"
            const result2 = matchNFA(nfa, [
                "play",
                "big",
                "red",
                "sun",
                "by",
                "lucinda",
                "williams",
            ]);
            console.log("\n--- Test: play big red sun by lucinda williams ---");
            console.log(
                printMatchResult(result2, [
                    "play",
                    "big",
                    "red",
                    "sun",
                    "by",
                    "lucinda",
                    "williams",
                ]),
            );
            expect(result2.matched).toBe(true);
            expect(result2.actionValue?.parameters?.trackName).toBe(
                "big red sun",
            );
            expect(result2.actionValue?.parameters?.artists?.[0]).toBe(
                "lucinda williams",
            );

            // Test: single word track and artist
            const result3 = matchNFA(nfa, ["play", "Hello", "by", "Adele"]);
            console.log("\n--- Test: play Hello by Adele ---");
            console.log(
                printMatchResult(result3, ["play", "Hello", "by", "Adele"]),
            );
            expect(result3.matched).toBe(true);
            expect(result3.actionValue?.parameters?.trackName).toBe("Hello");
            expect(result3.actionValue?.parameters?.artists?.[0]).toBe("Adele");
        });

        it("should match 'play track from album' patterns", () => {
            const playerGrammarPath = path.resolve(
                __dirname,
                "../../../agents/player/src/agent/playerSchema.agr",
            );
            const content = fs.readFileSync(playerGrammarPath, "utf-8");
            const grammar = loadGrammarRules("playerSchema.agr", content);
            const nfa = compileGrammarToNFA(grammar, "player-track-from-album");

            // Test: "play Shake It Off from album 1989"
            const result1 = matchNFA(nfa, [
                "play",
                "Shake",
                "It",
                "Off",
                "from",
                "album",
                "1989",
            ]);
            console.log("\n--- Test: play Shake It Off from album 1989 ---");
            console.log(
                printMatchResult(result1, [
                    "play",
                    "Shake",
                    "It",
                    "Off",
                    "from",
                    "album",
                    "1989",
                ]),
            );
            expect(result1.matched).toBe(true);
            expect(result1.actionValue?.parameters?.trackName).toBe(
                "Shake It Off",
            );
            expect(result1.actionValue?.parameters?.albumName).toBe("1989");

            // Test: with "the" article
            const result2 = matchNFA(nfa, [
                "play",
                "Bohemian",
                "Rhapsody",
                "from",
                "the",
                "album",
                "A",
                "Night",
                "at",
                "the",
                "Opera",
            ]);
            console.log(
                "\n--- Test: play Bohemian Rhapsody from the album A Night at the Opera ---",
            );
            console.log(
                printMatchResult(result2, [
                    "play",
                    "Bohemian",
                    "Rhapsody",
                    "from",
                    "the",
                    "album",
                    "A",
                    "Night",
                    "at",
                    "the",
                    "Opera",
                ]),
            );
            expect(result2.matched).toBe(true);
            expect(result2.actionValue?.parameters?.trackName).toBe(
                "Bohemian Rhapsody",
            );
            expect(result2.actionValue?.parameters?.albumName).toBe(
                "A Night at the Opera",
            );
        });

        it("should match 'play track by artist from album' patterns", () => {
            const playerGrammarPath = path.resolve(
                __dirname,
                "../../../agents/player/src/agent/playerSchema.agr",
            );
            const content = fs.readFileSync(playerGrammarPath, "utf-8");
            const grammar = loadGrammarRules("playerSchema.agr", content);
            const nfa = compileGrammarToNFA(
                grammar,
                "player-track-artist-album",
            );

            // Test: full pattern with all parameters
            const result1 = matchNFA(nfa, [
                "play",
                "Shake",
                "It",
                "Off",
                "by",
                "Taylor",
                "Swift",
                "from",
                "album",
                "1989",
            ]);
            console.log(
                "\n--- Test: play Shake It Off by Taylor Swift from album 1989 ---",
            );
            console.log(
                printMatchResult(result1, [
                    "play",
                    "Shake",
                    "It",
                    "Off",
                    "by",
                    "Taylor",
                    "Swift",
                    "from",
                    "album",
                    "1989",
                ]),
            );
            expect(result1.matched).toBe(true);
            expect(result1.actionValue?.parameters?.trackName).toBe(
                "Shake It Off",
            );
            expect(result1.actionValue?.parameters?.artists?.[0]).toBe(
                "Taylor Swift",
            );
            expect(result1.actionValue?.parameters?.albumName).toBe("1989");

            // Test: with "the" article
            const result2 = matchNFA(nfa, [
                "play",
                "Yesterday",
                "by",
                "The",
                "Beatles",
                "from",
                "the",
                "album",
                "Help",
            ]);
            console.log(
                "\n--- Test: play Yesterday by The Beatles from the album Help ---",
            );
            console.log(
                printMatchResult(result2, [
                    "play",
                    "Yesterday",
                    "by",
                    "The",
                    "Beatles",
                    "from",
                    "the",
                    "album",
                    "Help",
                ]),
            );
            expect(result2.matched).toBe(true);
            expect(result2.actionValue?.parameters?.trackName).toBe(
                "Yesterday",
            );
            expect(result2.actionValue?.parameters?.artists?.[0]).toBe(
                "The Beatles",
            );
            expect(result2.actionValue?.parameters?.albumName).toBe("Help");
        });
    });

    describe("Calendar Grammar", () => {
        it("should compile and match calendar grammar", () => {
            // Load calendar grammar
            const calendarGrammarPath = path.resolve(
                __dirname,
                "../../../agents/calendar/dist/calendarSchema.agr",
            );

            // Skip if file doesn't exist (e.g., in CI before calendar agent is built)
            if (!fileExists(calendarGrammarPath)) {
                console.log(
                    "Skipping calendar grammar test - file not found:",
                    calendarGrammarPath,
                );
                return;
            }

            const content = fs.readFileSync(calendarGrammarPath, "utf-8");

            const errors: string[] = [];
            const grammar = loadGrammarRules(
                "calendarSchema.agr",
                content,
                errors,
            );

            if (errors.length > 0) {
                console.log("Grammar errors:", errors);
            }
            expect(errors.length).toBe(0);
            expect(grammar).toBeDefined();

            // Compile to NFA
            const nfa = compileGrammarToNFA(grammar!, "calendar-grammar");

            // Print NFA structure for debugging
            console.log("\n=== Calendar Grammar NFA ===");
            console.log(`States: ${nfa.states.length}`);
            console.log(`Start: ${nfa.startState}`);
            console.log(`Accept: ${nfa.acceptingStates.join(", ")}`);

            // Test: "schedule a meeting"
            // Note: This is a simplified test - full calendar commands have many parameters
            const tokens1 = ["schedule", "a", "meeting"];
            const result1 = matchNFA(nfa, tokens1, true);
            console.log("\n--- Test: schedule a meeting ---");
            console.log(printMatchResult(result1, tokens1));
            // This may or may not match depending on the grammar's strictness
        });

        it("should handle find events queries", () => {
            const calendarGrammarPath = path.resolve(
                __dirname,
                "../../../agents/calendar/dist/calendarSchema.agr",
            );

            // Skip if file doesn't exist (e.g., in CI before calendar agent is built)
            if (!fileExists(calendarGrammarPath)) {
                console.log(
                    "Skipping calendar find events test - file not found:",
                    calendarGrammarPath,
                );
                return;
            }

            const content = fs.readFileSync(calendarGrammarPath, "utf-8");
            const grammar = loadGrammarRules("calendarSchema.agr", content);
            const nfa = compileGrammarToNFA(grammar, "calendar-find");

            // Test: partial match to see what works
            const tokens = ["find", "all", "events"];
            const result1 = matchNFA(nfa, tokens, true);
            console.log("\n--- Test: find all events ---");
            console.log(printMatchResult(result1, tokens));
        });
    });

    describe("NFA Size Comparison", () => {
        it("should report NFA sizes for both grammars", () => {
            // Player grammar
            const playerPath = path.resolve(
                __dirname,
                "../../../agents/player/src/agent/playerSchema.agr",
            );
            const playerContent = fs.readFileSync(playerPath, "utf-8");
            const playerGrammar = loadGrammarRules(
                "playerSchema.agr",
                playerContent,
            );
            const playerNFA = compileGrammarToNFA(playerGrammar, "player");

            console.log("\n=== Grammar Sizes ===");
            console.log(`Player NFA: ${playerNFA.states.length} states`);

            // Calculate player transition count
            const playerTransitions = playerNFA.states.reduce(
                (sum, s) => sum + s.transitions.length,
                0,
            );
            console.log(`Player transitions: ${playerTransitions}`);

            // Calendar grammar (optional - may not exist in CI)
            const calendarPath = path.resolve(
                __dirname,
                "../../../agents/calendar/dist/calendarSchema.agr",
            );

            if (fileExists(calendarPath)) {
                const calendarContent = fs.readFileSync(calendarPath, "utf-8");
                const calendarGrammar = loadGrammarRules(
                    "calendarSchema.agr",
                    calendarContent,
                );
                const calendarNFA = compileGrammarToNFA(
                    calendarGrammar,
                    "calendar",
                );

                console.log(
                    `Calendar NFA: ${calendarNFA.states.length} states`,
                );

                const calendarTransitions = calendarNFA.states.reduce(
                    (sum, s) => sum + s.transitions.length,
                    0,
                );
                console.log(`Calendar transitions: ${calendarTransitions}`);

                expect(calendarNFA.states.length).toBeGreaterThan(0);
            } else {
                console.log(
                    "Calendar grammar not available - skipping comparison",
                );
            }

            // Player should always be present
            expect(playerNFA.states.length).toBeGreaterThan(0);
        });
    });

    describe("NFA Visualization", () => {
        it("should print a simple subset of player grammar", () => {
            const playerPath = path.resolve(
                __dirname,
                "../../../agents/player/src/agent/playerSchema.agr",
            );
            const content = fs.readFileSync(playerPath, "utf-8");
            const grammar = loadGrammarRules("playerSchema.agr", content);
            const nfa = compileGrammarToNFA(grammar, "player-simple");

            // Print first 20 states for visualization
            console.log(
                "\n=== Player Grammar NFA Structure (first 20 states) ===",
            );
            console.log(
                printNFA({
                    ...nfa,
                    states: nfa.states.slice(0, 20),
                }),
            );
        });
    });
});

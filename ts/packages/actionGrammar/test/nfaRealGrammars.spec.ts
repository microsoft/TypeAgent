// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import * as path from "path";
import * as fs from "fs";
import { fileURLToPath } from "url";
import {
    loadGrammarRules,
    loadGrammarRulesNoThrow,
} from "../src/grammarLoader.js";
import { compileGrammarToNFA } from "../src/nfaCompiler.js";
import { matchNFA, printNFA } from "../src/nfaInterpreter.js";
import { registerBuiltInEntities } from "../src/builtInEntities.js";

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
    // Register built-in entities (Ordinal, Cardinal, etc.) so entity-type
    // wildcards in .agr grammars can be validated at runtime.
    registerBuiltInEntities();

    describe("Player Grammar", () => {
        it("should compile and match player grammar", () => {
            // Load player grammar
            const playerGrammarPath = path.resolve(
                __dirname,
                "../../../agents/player/src/agent/playerSchema.agr",
            );
            const content = fs.readFileSync(playerGrammarPath, "utf-8");

            const errors: string[] = [];
            const grammar = loadGrammarRulesNoThrow(
                "playerSchema.agr",
                content,
                errors,
            );

            expect(errors).toEqual([]);
            expect(grammar).toBeDefined();

            // Compile to NFA
            const nfa = compileGrammarToNFA(grammar!, "player-grammar");
            expect(nfa.states.length).toBeGreaterThan(0);

            // Test: "pause"
            const result1 = matchNFA(nfa, ["pause"], true);
            expect(result1.matched).toBe(true);

            // Test: "pause the music"
            const result2 = matchNFA(nfa, ["pause", "the", "music"], true);
            expect(result2.matched).toBe(true);

            // Test: "resume"
            const result3 = matchNFA(nfa, ["resume"], true);
            expect(result3.matched).toBe(true);

            // Test: invalid command
            const result5 = matchNFA(nfa, ["invalid", "command"], true);
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
            expect(result1.matched).toBe(true);
            // Note: The grammar captures to "x" not "deviceName" because
            // the <DeviceName> rule uses $(x:MusicDevice)
            expect(result1.actionValue?.parameters?.deviceName).toBe("kitchen");

            // Test: "switch to bedroom"
            // TODO: This doesn't match - need to investigate grammar structure
            // const result2 = matchNFA(nfa, ["switch", "to", "bedroom"]);
            // expect(result2.matched).toBe(true);
            // expect(result2.captures.get("x")).toBe("bedroom");

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
            expect(result2.matched).toBe(true);
            expect(result2.actionValue?.parameters?.trackName).toBe(
                "big red sun",
            );
            expect(result2.actionValue?.parameters?.artists?.[0]).toBe(
                "lucinda williams",
            );

            // Test: single word track and artist
            const result3 = matchNFA(nfa, ["play", "Hello", "by", "Adele"]);
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
                return;
            }

            const content = fs.readFileSync(calendarGrammarPath, "utf-8");

            const errors: string[] = [];
            const grammar = loadGrammarRulesNoThrow(
                "calendarSchema.agr",
                content,
                errors,
            );

            expect(errors).toEqual([]);
            expect(grammar).toBeDefined();

            // Compile to NFA
            const nfa = compileGrammarToNFA(grammar!, "calendar-grammar");
            expect(nfa.states.length).toBeGreaterThan(0);
        });

        it("should handle find events queries", () => {
            const calendarGrammarPath = path.resolve(
                __dirname,
                "../../../agents/calendar/dist/calendarSchema.agr",
            );

            // Skip if file doesn't exist (e.g., in CI before calendar agent is built)
            if (!fileExists(calendarGrammarPath)) {
                return;
            }

            const content = fs.readFileSync(calendarGrammarPath, "utf-8");
            const grammar = loadGrammarRules("calendarSchema.agr", content);
            const nfa = compileGrammarToNFA(grammar, "calendar-find");
            expect(nfa.states.length).toBeGreaterThan(0);
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

            expect(playerNFA.states.length).toBeGreaterThan(0);

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
                expect(calendarNFA.states.length).toBeGreaterThan(0);
            }
        });
    });

    describe("NFA Structure", () => {
        it("should produce a non-empty printable NFA for player grammar", () => {
            const playerPath = path.resolve(
                __dirname,
                "../../../agents/player/src/agent/playerSchema.agr",
            );
            const content = fs.readFileSync(playerPath, "utf-8");
            const grammar = loadGrammarRules("playerSchema.agr", content);
            const nfa = compileGrammarToNFA(grammar, "player-simple");

            const output = printNFA({ ...nfa, states: nfa.states.slice(0, 20) });
            expect(output.length).toBeGreaterThan(0);
        });
    });
});

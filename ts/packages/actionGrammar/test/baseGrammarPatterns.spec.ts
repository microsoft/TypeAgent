// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/**
 * Comprehensive tests for base grammar patterns
 *
 * These tests verify that straightforward sentence structures correctly match
 * the player and calendar base grammars without requiring dynamic generation.
 */

import * as path from "path";
import * as fs from "fs";
import { fileURLToPath } from "url";
import { loadGrammarRules } from "../src/grammarLoader.js";
import { compileGrammarToNFA } from "../src/nfaCompiler.js";
import { matchGrammarWithNFA } from "../src/nfaMatcher.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function fileExists(filePath: string): boolean {
    try {
        fs.accessSync(filePath, fs.constants.R_OK);
        return true;
    } catch {
        return false;
    }
}

describe("Base Grammar Pattern Tests", () => {
    describe("Player Grammar - Core Playback Controls", () => {
        let grammar: any;
        let nfa: any;

        beforeAll(() => {
            const playerGrammarPath = path.resolve(
                __dirname,
                "../../../agents/player/src/agent/playerSchema.agr",
            );
            const content = fs.readFileSync(playerGrammarPath, "utf-8");
            grammar = loadGrammarRules("playerSchema.agr", content);
            nfa = compileGrammarToNFA(grammar, "player-base");
        });

        it("should match pause commands", () => {
            const result1 = matchGrammarWithNFA(grammar, nfa, "pause");
            expect(result1.length).toBeGreaterThan(0);
            expect(result1[0].match).toMatchObject({ actionName: "pause" });

            const result2 = matchGrammarWithNFA(grammar, nfa, "pause the music");
            expect(result2.length).toBeGreaterThan(0);
            expect(result2[0].match).toMatchObject({ actionName: "pause" });
        });

        it("should match resume commands", () => {
            const result1 = matchGrammarWithNFA(grammar, nfa, "resume");
            expect(result1.length).toBeGreaterThan(0);
            expect(result1[0].match).toMatchObject({ actionName: "resume" });

            const result2 = matchGrammarWithNFA(grammar, nfa, "resume the music");
            expect(result2.length).toBeGreaterThan(0);
            expect(result2[0].match).toMatchObject({ actionName: "resume" });
        });
    });

    describe("Player Grammar - Play Track By Artist", () => {
        let grammar: any;
        let nfa: any;

        beforeAll(() => {
            const playerGrammarPath = path.resolve(
                __dirname,
                "../../../agents/player/src/agent/playerSchema.agr",
            );
            const content = fs.readFileSync(playerGrammarPath, "utf-8");
            grammar = loadGrammarRules("playerSchema.agr", content);
            nfa = compileGrammarToNFA(grammar, "player-track-artist");
        });

        it("should match 'play X by Y' with multi-word track names", () => {
            const result = matchGrammarWithNFA(
                grammar,
                nfa,
                "play Big Red Sun by Lucinda Williams",
            );
            expect(result.length).toBeGreaterThan(0);
            const action = result[0].match as any;
            expect(action.actionName).toBe("playTrack");
            expect(action.parameters.trackName).toBe("Big Red Sun");
            expect(action.parameters.artists).toEqual(["Lucinda Williams"]);
        });

        it("should match 'play X by Y' with capitalized names", () => {
            const result = matchGrammarWithNFA(
                grammar,
                nfa,
                "play Shake It Off by Taylor Swift",
            );
            expect(result.length).toBeGreaterThan(0);
            const action = result[0].match as any;
            expect(action.actionName).toBe("playTrack");
            expect(action.parameters.trackName).toBe("Shake It Off");
            expect(action.parameters.artists).toEqual(["Taylor Swift"]);
        });

        it("should match 'play X by Y' with lowercase names", () => {
            const result = matchGrammarWithNFA(
                grammar,
                nfa,
                "play shake it off by taylor swift",
            );
            expect(result.length).toBeGreaterThan(0);
            const action = result[0].match as any;
            expect(action.actionName).toBe("playTrack");
            expect(action.parameters.trackName).toBe("shake it off");
            expect(action.parameters.artists).toEqual(["taylor swift"]);
        });

        it("should match 'play X by Y' with single word names", () => {
            const result = matchGrammarWithNFA(
                grammar,
                nfa,
                "play Hello by Adele",
            );
            console.log("DEBUG: result =", JSON.stringify(result, null, 2));
            expect(result.length).toBeGreaterThan(0);
            const action = result[0].match as any;
            console.log("DEBUG: action =", JSON.stringify(action, null, 2));
            expect(action.actionName).toBe("playTrack");
            expect(action.parameters.trackName).toBe("Hello");
            expect(action.parameters.artists).toEqual(["Adele"]);
        });

        it("should match 'play X by Y' with artist having article", () => {
            const result = matchGrammarWithNFA(
                grammar,
                nfa,
                "play Yesterday by The Beatles",
            );
            expect(result.length).toBeGreaterThan(0);
            const action = result[0].match as any;
            expect(action.actionName).toBe("playTrack");
            expect(action.parameters.trackName).toBe("Yesterday");
            expect(action.parameters.artists).toEqual(["The Beatles"]);
        });
    });

    describe("Player Grammar - Play Track From Album", () => {
        let grammar: any;
        let nfa: any;

        beforeAll(() => {
            const playerGrammarPath = path.resolve(
                __dirname,
                "../../../agents/player/src/agent/playerSchema.agr",
            );
            const content = fs.readFileSync(playerGrammarPath, "utf-8");
            grammar = loadGrammarRules("playerSchema.agr", content);
            nfa = compileGrammarToNFA(grammar, "player-track-album");
        });

        it("should match 'play X from album Y'", () => {
            const result = matchGrammarWithNFA(
                grammar,
                nfa,
                "play Shake It Off from album 1989",
            );
            expect(result.length).toBeGreaterThan(0);
            const action = result[0].match as any;
            expect(action.actionName).toBe("playTrack");
            expect(action.parameters.trackName).toBe("Shake It Off");
            expect(action.parameters.albumName).toBe("1989");
        });

        it("should match 'play X from the album Y'", () => {
            const result = matchGrammarWithNFA(
                grammar,
                nfa,
                "play Bohemian Rhapsody from the album A Night at the Opera",
            );
            expect(result.length).toBeGreaterThan(0);
            const action = result[0].match as any;
            expect(action.actionName).toBe("playTrack");
            expect(action.parameters.trackName).toBe("Bohemian Rhapsody");
            expect(action.parameters.albumName).toBe("A Night at the Opera");
        });
    });

    describe("Player Grammar - Play Track By Artist From Album", () => {
        let grammar: any;
        let nfa: any;

        beforeAll(() => {
            const playerGrammarPath = path.resolve(
                __dirname,
                "../../../agents/player/src/agent/playerSchema.agr",
            );
            const content = fs.readFileSync(playerGrammarPath, "utf-8");
            grammar = loadGrammarRules("playerSchema.agr", content);
            nfa = compileGrammarToNFA(grammar, "player-full");
        });

        it("should match full pattern with all parameters", () => {
            const result = matchGrammarWithNFA(
                grammar,
                nfa,
                "play Shake It Off by Taylor Swift from album 1989",
            );
            expect(result.length).toBeGreaterThan(0);
            const action = result[0].match as any;
            expect(action.actionName).toBe("playTrack");
            expect(action.parameters.trackName).toBe("Shake It Off");
            expect(action.parameters.artists).toEqual(["Taylor Swift"]);
            expect(action.parameters.albumName).toBe("1989");
        });

        it("should match with 'the album' variant", () => {
            const result = matchGrammarWithNFA(
                grammar,
                nfa,
                "play Yesterday by The Beatles from the album Help",
            );
            expect(result.length).toBeGreaterThan(0);
            const action = result[0].match as any;
            expect(action.actionName).toBe("playTrack");
            expect(action.parameters.trackName).toBe("Yesterday");
            expect(action.parameters.artists).toEqual(["The Beatles"]);
            expect(action.parameters.albumName).toBe("Help");
        });
    });

    describe("Calendar Grammar - Find Today's Events", () => {
        let grammar: any;
        let nfa: any;

        beforeAll(() => {
            let calendarGrammarPath = path.resolve(
                __dirname,
                "../../../agents/calendar/src/calendarSchema.agr",
            );

            if (!fileExists(calendarGrammarPath)) {
                calendarGrammarPath = path.resolve(
                    __dirname,
                    "../../../agents/calendar/dist/calendarSchema.agr",
                );
            }

            if (!fileExists(calendarGrammarPath)) {
                // Skip suite if calendar grammar not available
                return;
            }

            const content = fs.readFileSync(calendarGrammarPath, "utf-8");
            grammar = loadGrammarRules("calendarSchema.agr", content);
            nfa = compileGrammarToNFA(grammar, "calendar-todays");
        });

        it("should match 'what I have scheduled for today'", () => {
            if (!grammar || !nfa) {
                console.log("Skipping - calendar grammar not available");
                return;
            }

            const result = matchGrammarWithNFA(
                grammar,
                nfa,
                "what I have scheduled for today",
            );
            expect(result.length).toBeGreaterThan(0);
            const action = result[0].match as any;
            expect(action.actionName).toBe("findTodaysEvents");
        });

        it("should match 'what do I have scheduled for today'", () => {
            if (!grammar || !nfa) {
                console.log("Skipping - calendar grammar not available");
                return;
            }

            const result = matchGrammarWithNFA(
                grammar,
                nfa,
                "what do I have scheduled for today",
            );
            expect(result.length).toBeGreaterThan(0);
            const action = result[0].match as any;
            expect(action.actionName).toBe("findTodaysEvents");
        });

        it("should match 'tell me what I have scheduled for today'", () => {
            if (!grammar || !nfa) {
                console.log("Skipping - calendar grammar not available");
                return;
            }

            const result = matchGrammarWithNFA(
                grammar,
                nfa,
                "tell me what I have scheduled for today",
            );
            expect(result.length).toBeGreaterThan(0);
            const action = result[0].match as any;
            expect(action.actionName).toBe("findTodaysEvents");
        });

        it("should match with 'can you' prefix", () => {
            if (!grammar || !nfa) {
                console.log("Skipping - calendar grammar not available");
                return;
            }

            const result = matchGrammarWithNFA(
                grammar,
                nfa,
                "can you tell me what I have scheduled for today",
            );
            expect(result.length).toBeGreaterThan(0);
            const action = result[0].match as any;
            expect(action.actionName).toBe("findTodaysEvents");
        });
    });

    describe("Calendar Grammar - Find This Week's Events", () => {
        let grammar: any;
        let nfa: any;

        beforeAll(() => {
            let calendarGrammarPath = path.resolve(
                __dirname,
                "../../../agents/calendar/src/calendarSchema.agr",
            );

            if (!fileExists(calendarGrammarPath)) {
                calendarGrammarPath = path.resolve(
                    __dirname,
                    "../../../agents/calendar/dist/calendarSchema.agr",
                );
            }

            if (!fileExists(calendarGrammarPath)) {
                return;
            }

            const content = fs.readFileSync(calendarGrammarPath, "utf-8");
            grammar = loadGrammarRules("calendarSchema.agr", content);
            nfa = compileGrammarToNFA(grammar, "calendar-weekly");
        });

        it("should match 'what's happening this week'", () => {
            if (!grammar || !nfa) {
                console.log("Skipping - calendar grammar not available");
                return;
            }

            const result = matchGrammarWithNFA(
                grammar,
                nfa,
                "what's happening this week",
            );
            expect(result.length).toBeGreaterThan(0);
            const action = result[0].match as any;
            expect(action.actionName).toBe("findThisWeeksEvents");
        });

        it("should match 'find what I have scheduled this week'", () => {
            if (!grammar || !nfa) {
                console.log("Skipping - calendar grammar not available");
                return;
            }

            const result = matchGrammarWithNFA(
                grammar,
                nfa,
                "find what I have scheduled this week",
            );
            expect(result.length).toBeGreaterThan(0);
            const action = result[0].match as any;
            expect(action.actionName).toBe("findThisWeeksEvents");
        });

        it("should match with 'can you' prefix", () => {
            if (!grammar || !nfa) {
                console.log("Skipping - calendar grammar not available");
                return;
            }

            const result = matchGrammarWithNFA(
                grammar,
                nfa,
                "can you find what I have scheduled this week",
            );
            expect(result.length).toBeGreaterThan(0);
            const action = result[0].match as any;
            expect(action.actionName).toBe("findThisWeeksEvents");
        });
    });

    describe("Calendar Grammar - Schedule Events", () => {
        let grammar: any;
        let nfa: any;

        beforeAll(() => {
            let calendarGrammarPath = path.resolve(
                __dirname,
                "../../../agents/calendar/src/calendarSchema.agr",
            );

            if (!fileExists(calendarGrammarPath)) {
                calendarGrammarPath = path.resolve(
                    __dirname,
                    "../../../agents/calendar/dist/calendarSchema.agr",
                );
            }

            if (!fileExists(calendarGrammarPath)) {
                return;
            }

            const content = fs.readFileSync(calendarGrammarPath, "utf-8");
            grammar = loadGrammarRules("calendarSchema.agr", content);
            nfa = compileGrammarToNFA(grammar, "calendar-schedule");
        });

        it("should match 'set up meeting on Monday at 3pm'", () => {
            if (!grammar || !nfa) {
                console.log("Skipping - calendar grammar not available");
                return;
            }

            const result = matchGrammarWithNFA(
                grammar,
                nfa,
                "set up meeting on Monday at 3pm",
            );
            expect(result.length).toBeGreaterThan(0);
            const action = result[0].match as any;
            expect(action.actionName).toBe("scheduleEvent");
            expect(action.parameters.description).toBe("meeting");
            expect(action.parameters.date).toBe("Monday");
            expect(action.parameters.time).toBe("3pm");
        });

        it("should match with 'can you' prefix", () => {
            if (!grammar || !nfa) {
                console.log("Skipping - calendar grammar not available");
                return;
            }

            const result = matchGrammarWithNFA(
                grammar,
                nfa,
                "can you set up lunch meeting on Friday at noon",
            );
            expect(result.length).toBeGreaterThan(0);
            const action = result[0].match as any;
            expect(action.actionName).toBe("scheduleEvent");
            expect(action.parameters.description).toBe("lunch meeting");
            expect(action.parameters.date).toBe("Friday");
            expect(action.parameters.time).toBe("noon");
        });

        it("should match multi-word descriptions", () => {
            if (!grammar || !nfa) {
                console.log("Skipping - calendar grammar not available");
                return;
            }

            const result = matchGrammarWithNFA(
                grammar,
                nfa,
                "set up project status review on Tuesday at 2pm",
            );
            expect(result.length).toBeGreaterThan(0);
            const action = result[0].match as any;
            expect(action.actionName).toBe("scheduleEvent");
            expect(action.parameters.description).toBe("project status review");
            expect(action.parameters.date).toBe("Tuesday");
            expect(action.parameters.time).toBe("2pm");
        });
    });
});

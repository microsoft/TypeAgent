// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import * as path from "path";
import * as fs from "fs";
import { fileURLToPath } from "url";
import {
    GrammarStore,
    getSessionGrammarDirPath,
    getSessionGrammarStorePath,
} from "../src/grammarStore.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

describe("GrammarStore", () => {
    const testDir = path.join(__dirname, "../../test-data/grammar-store");
    const testFile = path.join(testDir, "test-store.json");

    beforeEach(() => {
        // Clean up test directory
        if (fs.existsSync(testDir)) {
            fs.rmSync(testDir, { recursive: true });
        }
    });

    afterEach(() => {
        // Clean up test directory
        if (fs.existsSync(testDir)) {
            fs.rmSync(testDir, { recursive: true });
        }
    });

    describe("Basic Operations", () => {
        it("should create a new empty store", () => {
            const store = new GrammarStore();
            const info = store.getInfo();

            expect(info.ruleCount).toBe(0);
            expect(info.schemaCount).toBe(0);
            expect(info.modified).toBe(false);
            expect(info.filePath).toBeUndefined();
        });

        it("should add grammar rules", async () => {
            const store = new GrammarStore();

            await store.addRule({
                grammarText: '@ <playTrack> = "play" $(track:string)',
                schemaName: "player",
                sourceRequest: "play Bohemian Rhapsody",
                actionName: "playTrack",
            });

            const info = store.getInfo();
            expect(info.ruleCount).toBe(1);
            expect(info.schemaCount).toBe(1);
            expect(info.modified).toBe(true);

            const rules = store.getRulesForSchema("player");
            expect(rules).toHaveLength(1);
            expect(rules[0].schemaName).toBe("player");
            expect(rules[0].actionName).toBe("playTrack");
            expect(rules[0].sourceRequest).toBe("play Bohemian Rhapsody");
        });

        it("should handle multiple schemas", async () => {
            const store = new GrammarStore();

            await store.addRule({
                grammarText: '@ <playTrack> = "play" $(track:string)',
                schemaName: "player",
            });

            await store.addRule({
                grammarText: '@ <scheduleEvent> = "schedule" $(event:string)',
                schemaName: "calendar",
            });

            const info = store.getInfo();
            expect(info.ruleCount).toBe(2);
            expect(info.schemaCount).toBe(2);

            expect(store.getRulesForSchema("player")).toHaveLength(1);
            expect(store.getRulesForSchema("calendar")).toHaveLength(1);
        });

        it("should delete rules", async () => {
            const store = new GrammarStore();

            await store.addRule({
                grammarText: '@ <playTrack> = "play" $(track:string)',
                schemaName: "player",
            });

            await store.addRule({
                grammarText: '@ <pause> = "pause"',
                schemaName: "player",
            });

            expect(store.getRulesForSchema("player")).toHaveLength(2);

            const deleted = await store.deleteRule("player", 0);
            expect(deleted).toBe(true);
            expect(store.getRulesForSchema("player")).toHaveLength(1);
        });

        it("should clear all rules", () => {
            const store = new GrammarStore();

            store.addRule({
                grammarText: '@ <playTrack> = "play" $(track:string)',
                schemaName: "player",
            });

            store.clear();

            const info = store.getInfo();
            expect(info.ruleCount).toBe(0);
            expect(info.schemaCount).toBe(0);
        });
    });

    describe("Persistence", () => {
        it("should save and load grammar store", async () => {
            const store1 = new GrammarStore();

            await store1.addRule({
                grammarText: '@ <playTrack> = "play" $(track:string)',
                schemaName: "player",
                sourceRequest: "play music",
                actionName: "playTrack",
            });

            await store1.save(testFile);
            expect(fs.existsSync(testFile)).toBe(true);

            // Load into a new store
            const store2 = new GrammarStore();
            await store2.load(testFile);

            const info = store2.getInfo();
            expect(info.ruleCount).toBe(1);
            expect(info.schemaCount).toBe(1);

            const rules = store2.getRulesForSchema("player");
            expect(rules[0].sourceRequest).toBe("play music");
            expect(rules[0].actionName).toBe("playTrack");
        });

        it("should handle auto-save", async () => {
            const store = new GrammarStore();
            await store.newStore(testFile);
            await store.setAutoSave(true);

            await store.addRule({
                grammarText: '@ <playTrack> = "play" $(track:string)',
                schemaName: "player",
            });

            // File should be automatically saved
            expect(fs.existsSync(testFile)).toBe(true);
            expect(store.isModified()).toBe(false);

            // Load into a new store to verify
            const store2 = new GrammarStore();
            await store2.load(testFile);
            expect(store2.getInfo().ruleCount).toBe(1);
        });

        it("should not save if nothing changed", async () => {
            const store = new GrammarStore();
            await store.save(testFile);

            const stat1 = fs.statSync(testFile);
            await new Promise((resolve) => setTimeout(resolve, 10));

            const saved = await store.save();
            expect(saved).toBe(false);

            const stat2 = fs.statSync(testFile);
            expect(stat1.mtimeMs).toBe(stat2.mtimeMs);
        });
    });

    describe("Grammar Export", () => {
        it("should export schema grammar as .agr file", async () => {
            const store = new GrammarStore();

            await store.addRule({
                grammarText: '@ <playTrack> = "play" $(track:string)',
                schemaName: "player",
                sourceRequest: "play music",
            });

            await store.addRule({
                grammarText: '@ <pause> = "pause"',
                schemaName: "player",
                sourceRequest: "pause",
            });

            const agr = store.exportSchemaGrammar("player");

            expect(agr).toContain("# Dynamic Grammar Rules for player");
            expect(agr).toContain("# 2 rule(s)");
            expect(agr).toContain('@ <playTrack> = "play" $(track:string)');
            expect(agr).toContain('@ <pause> = "pause"');
            expect(agr).toContain('Source: "play music"');
        });

        it("should compile to Grammar object", () => {
            const store = new GrammarStore();

            store.addRule({
                grammarText: "@ <Start> = <playTrack>",
                schemaName: "player",
            });

            store.addRule({
                grammarText:
                    '@ <playTrack> = "play" $(track:string) -> { actionName: "playTrack", parameters: { track: track } }',
                schemaName: "player",
            });

            const grammar = store.compileToGrammar();
            expect(grammar).toBeDefined();
            expect(grammar!.rules.length).toBeGreaterThan(0);
        });
    });

    describe("Session Helpers", () => {
        it("should provide session directory paths", () => {
            const sessionDir = "/home/user/.typeagent/sessions/2026-01-25-001";

            const grammarDir = getSessionGrammarDirPath(sessionDir);
            expect(grammarDir).toBe(path.join(sessionDir, "grammars"));

            const storePath = getSessionGrammarStorePath(sessionDir);
            expect(storePath).toBe(
                path.join(sessionDir, "grammars", "dynamic.json"),
            );
        });
    });
});

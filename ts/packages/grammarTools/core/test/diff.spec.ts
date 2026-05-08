// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import {
    diffGrammars,
    loadGrammarFromBuffer,
    MissingSourceError,
} from "../src/index.js";
import type { LoadedGrammar } from "../src/index.js";

describe("diffGrammars", () => {
    it("detects no differences for identical grammars", () => {
        const source = `<Start> = play -> "play";
<Start> = pause -> "pause";`;

        const a = loadGrammarFromBuffer("a.agr", source);
        const b = loadGrammarFromBuffer("b.agr", source);
        expect(a.ok).toBe(true);
        expect(b.ok).toBe(true);
        if (!a.ok || !b.ok) return;

        const diff = diffGrammars(a.grammar, b.grammar);
        expect(diff.added).toHaveLength(0);
        expect(diff.removed).toHaveLength(0);
        expect(diff.changed).toHaveLength(0);
    });

    it("detects added rules", () => {
        const sourceA = `<Start> = play -> "play";`;
        const sourceB = `<Start> = play -> "play";
<Other> = stop -> "stop";`;

        const a = loadGrammarFromBuffer("a.agr", sourceA);
        const b = loadGrammarFromBuffer("b.agr", sourceB);
        expect(a.ok).toBe(true);
        expect(b.ok).toBe(true);
        if (!a.ok || !b.ok) return;

        const diff = diffGrammars(a.grammar, b.grammar);
        expect(diff.added).toContain("Other");
        expect(diff.removed).toHaveLength(0);
    });

    it("detects removed rules", () => {
        const sourceA = `<Start> = play -> "play";
<Other> = stop -> "stop";`;
        const sourceB = `<Start> = play -> "play";`;

        const a = loadGrammarFromBuffer("a.agr", sourceA);
        const b = loadGrammarFromBuffer("b.agr", sourceB);
        expect(a.ok).toBe(true);
        expect(b.ok).toBe(true);
        if (!a.ok || !b.ok) return;

        const diff = diffGrammars(a.grammar, b.grammar);
        expect(diff.removed).toContain("Other");
        expect(diff.added).toHaveLength(0);
    });

    it("detects changed rules", () => {
        const sourceA = `<Start> = play -> "play";`;
        const sourceB = `<Start> = pause -> "pause";`;

        const a = loadGrammarFromBuffer("a.agr", sourceA);
        const b = loadGrammarFromBuffer("b.agr", sourceB);
        expect(a.ok).toBe(true);
        expect(b.ok).toBe(true);
        if (!a.ok || !b.ok) return;

        const diff = diffGrammars(a.grammar, b.grammar);
        expect(diff.changed).toHaveLength(1);
        expect(diff.changed[0].rule).toBe("Start");
    });

    it("changed rules include before and after text", () => {
        const sourceA = `<Start> = play -> "play";`;
        const sourceB = `<Start> = pause -> "pause";`;

        const a = loadGrammarFromBuffer("a.agr", sourceA);
        const b = loadGrammarFromBuffer("b.agr", sourceB);
        expect(a.ok).toBe(true);
        expect(b.ok).toBe(true);
        if (!a.ok || !b.ok) return;

        const diff = diffGrammars(a.grammar, b.grammar);
        expect(diff.changed[0].before).toBeTruthy();
        expect(diff.changed[0].after).toBeTruthy();
        expect(diff.changed[0].before).not.toBe(diff.changed[0].after);
    });

    it("classifies body changes as 'body'", () => {
        const sourceA = `<Start> = play -> "play";`;
        const sourceB = `<Start> = pause -> "pause";`;

        const a = loadGrammarFromBuffer("a.agr", sourceA);
        const b = loadGrammarFromBuffer("b.agr", sourceB);
        expect(a.ok).toBe(true);
        expect(b.ok).toBe(true);
        if (!a.ok || !b.ok) return;

        const diff = diffGrammars(a.grammar, b.grammar);
        expect(diff.changed[0].reason).toBe("body");
    });

    it("throws MissingSourceError when source is absent", () => {
        const result = loadGrammarFromBuffer(
            "test.agr",
            `<Start> = play -> "play";`,
        );
        expect(result.ok).toBe(true);
        if (!result.ok) return;

        // Strip source files
        const { files: _, ...rest } = result.grammar;
        const stripped = rest as LoadedGrammar;

        expect(() => diffGrammars(stripped, result.grammar)).toThrow(
            MissingSourceError,
        );
    });

    it("handles multiple changes at once", () => {
        const sourceA = `<Start> = play -> "play";
<Action> = stop -> "stop";
<Old> = go -> "go";`;
        const sourceB = `<Start> = play -> "play";
<Action> = halt -> "halt";
<New> = run -> "run";`;

        const a = loadGrammarFromBuffer("a.agr", sourceA);
        const b = loadGrammarFromBuffer("b.agr", sourceB);
        expect(a.ok).toBe(true);
        expect(b.ok).toBe(true);
        if (!a.ok || !b.ok) return;

        const diff = diffGrammars(a.grammar, b.grammar);
        expect(diff.added).toContain("New");
        expect(diff.removed).toContain("Old");
        expect(diff.changed.some((c) => c.rule === "Action")).toBe(true);
    });
});

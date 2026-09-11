// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { format } from "../src/format.js";

/**
 * grammar-tools-core `format` is the AGR prettier used by the LSP and CLI.
 * It parse→writeGrammarRules; quantified bare rule refs must become grouped.
 */
describe("format (AGR prettier)", () => {
    it("returns unparseable input unchanged", () => {
        const bad = `this is not valid <<<`;
        expect(format(bad)).toBe(bad);
    });

    it("rewrites bare <Name>?/*/+ to grouped (<Name>)?/*/+", () => {
        const src = `
            <Owner> = alice | bob;
            <Start> =
                show <Owner>? files -> "opt"
              | tag <Owner>* items -> "star"
              | need <Owner>+ here -> "plus"
            ;
        `;
        const out = format(src);
        expect(out).toContain("(<Owner>)?");
        expect(out).toContain("(<Owner>)*");
        expect(out).toContain("(<Owner>)+");
        expect(out).not.toMatch(/<Owner>\?/);
        expect(out).not.toMatch(/<Owner>\*/);
        expect(out).not.toMatch(/<Owner>\+/);
    });

    it("escapes literal ? * + on write-back", () => {
        const out = format(`<Start> = what is the time\\? -> "q";`);
        expect(out).toMatch(/time\\\?/);
        // Re-format is stable
        expect(format(out)).toBe(out);
    });

    it("keeps already-grouped quantifiers stable", () => {
        const src = `<Start> = (please)? open (<App>)+ -> "ok";\n`;
        // May re-indent; must retain grouped quantifiers and not invent bare ones.
        const out = format(src);
        expect(out).toContain(")?");
        expect(out).toContain(")+");
        expect(format(out)).toBe(out);
    });

    it("does not treat value-side ternary ? as a pattern quantifier", () => {
        const src = `<Start> = $(h:number) pm -> { hours: h < 12 ? h + 12 : h };`;
        const out = format(src);
        expect(out).toContain("?");
        expect(out).toContain("h + 12");
        // Must still parse (format didn't break value expr)
        expect(format(out)).toBe(out);
    });
});

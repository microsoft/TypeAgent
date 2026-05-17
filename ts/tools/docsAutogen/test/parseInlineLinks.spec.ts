// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { parseInlineLinks } from "../src/linkExtraction.js";

describe("parseInlineLinks", () => {
    it("extracts a simple inline link", () => {
        const out = parseInlineLinks("see [foo](./bar.md) for more");
        expect(out).toHaveLength(1);
        expect(out[0]?.text).toBe("foo");
        expect(out[0]?.target).toBe("./bar.md");
        expect(out[0]?.title).toBeUndefined();
        expect(out[0]?.fullMatch).toBe("[foo](./bar.md)");
    });
    it("extracts the title when present", () => {
        const out = parseInlineLinks(
            'click [here](https://example.com "Example")!',
        );
        expect(out).toHaveLength(1);
        expect(out[0]?.target).toBe("https://example.com");
        expect(out[0]?.title).toBe("Example");
    });
    it("skips reference-style links", () => {
        expect(parseInlineLinks("see [text][id] for more")).toHaveLength(0);
    });
    it("skips brackets without parens", () => {
        expect(parseInlineLinks("a [foo] b")).toHaveLength(0);
    });
    it("skips links whose target contains whitespace", () => {
        expect(parseInlineLinks("see [a](b c)")).toHaveLength(0);
    });
    it("skips links with empty target", () => {
        expect(parseInlineLinks("see [a]()")).toHaveLength(0);
    });
    it("extracts multiple links on the same line", () => {
        const out = parseInlineLinks("[a](x) and [b](y) and [c](z)");
        expect(out.map((m) => m.target)).toEqual(["x", "y", "z"]);
    });
    it("reports correct offsets", () => {
        const s = "prefix [a](x) suffix";
        const out = parseInlineLinks(s);
        expect(out[0]?.start).toBe(7);
        expect(out[0]?.end).toBe(13);
        expect(s.slice(out[0]!.start, out[0]!.end)).toBe("[a](x)");
    });
    // ReDoS safety: an adversarial input designed to trip backtracking
    // in the prior `\[([^\]]*)\]\(([^)\s]+)(?:\s+"[^"]*")?\)` pattern.
    // The parser must complete in linear time even at 50k characters.
    it("handles adversarial bracket sequences in linear time", () => {
        const adversarial = "[".repeat(50_000);
        const start = Date.now();
        const out = parseInlineLinks(adversarial);
        const elapsed = Date.now() - start;
        expect(out).toHaveLength(0);
        expect(elapsed).toBeLessThan(100);
    });
    it("handles long unterminated text quickly", () => {
        const adversarial = "[" + "a".repeat(100_000);
        const start = Date.now();
        const out = parseInlineLinks(adversarial);
        const elapsed = Date.now() - start;
        expect(out).toHaveLength(0);
        expect(elapsed).toBeLessThan(100);
    });
    it("handles dense bracket-paren noise quickly", () => {
        const adversarial = "[a](".repeat(50_000);
        const start = Date.now();
        parseInlineLinks(adversarial);
        const elapsed = Date.now() - start;
        expect(elapsed).toBeLessThan(200);
    });
});

// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import {
    renderStalenessFooter,
    stripStalenessFooter,
} from "../src/renderStaleness.js";

describe("renderStalenessFooter", () => {
    it("includes a horizontal rule, the SHA, the date, and the verify hint", () => {
        const out = renderStalenessFooter(
            "a".repeat(40),
            "2026-05-14T21:00:00Z",
            "list-agent",
        );
        expect(out).toContain("---");
        expect(out).toContain("`" + "a".repeat(40) + "`");
        expect(out).toContain("`2026-05-14T21:00:00Z`");
        expect(out).toContain("docs-generate.yml");
        expect(out).toContain("pnpm --filter list-agent docs:verify-links");
    });
    it("contains no markdown link syntax (the SHA is plain backticked)", () => {
        const out = renderStalenessFooter("sha", "date", "pkg");
        expect(/\[[^\]]+\]\([^)]+\)/u.test(out)).toBe(false);
    });
});

describe("stripStalenessFooter", () => {
    it("strips a footer rendered by renderStalenessFooter", () => {
        const body = [
            "## Overview",
            "",
            "stuff",
            "",
            "## Reference",
            "",
            "more stuff",
            "",
            renderStalenessFooter("sha", "date", "pkg").trimEnd(),
        ].join("\n");
        const stripped = stripStalenessFooter(body);
        expect(stripped).not.toContain("docs-generate.yml");
        expect(stripped).toContain("more stuff");
        expect(stripped.trimEnd().endsWith("more stuff")).toBe(true);
    });
    it("leaves bodies without a footer untouched", () => {
        const body = "## Overview\n\nstuff\n\n## Reference\nmore";
        expect(stripStalenessFooter(body)).toBe(body);
    });
    it("does not strip a non-footer trailing horizontal rule", () => {
        const body = "## Overview\n\n---\n\nbody after rule";
        expect(stripStalenessFooter(body)).toBe(body);
    });
});

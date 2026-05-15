// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import {
    countOverviewWords,
    validateOverview,
} from "../src/overviewValidation.js";

describe("countOverviewWords", () => {
    it("counts words in plain prose", () => {
        expect(countOverviewWords("one two three four")).toBe(4);
    });

    it("ignores fenced code blocks", () => {
        const md =
            "Hello world.\n\n```ts\nconst x = 1; const y = 2;\n```\n\nDone.";
        expect(countOverviewWords(md)).toBe(3);
    });

    it("treats consecutive whitespace as one separator", () => {
        expect(countOverviewWords("a    b\n\nc")).toBe(3);
    });

    it("returns 0 for empty body", () => {
        expect(countOverviewWords("")).toBe(0);
    });
});

describe("validateOverview", () => {
    const goodBody = `${"word ".repeat(280).trim()}.`;

    it("passes a clean body in the target band", () => {
        const v = validateOverview(goodBody);
        expect(v.valid).toBe(true);
        expect(v.violations).toEqual([]);
        expect(v.warnings).toEqual([]);
    });

    it("rejects a body that contains a heading", () => {
        const v = validateOverview(`## Overview\n\n${goodBody}`);
        expect(v.valid).toBe(false);
        expect(v.violations.join(" ")).toMatch(/heading/iu);
    });

    it("rejects a body that contains a sub-heading too", () => {
        const v = validateOverview(`### What it does\n\n${goodBody}`);
        expect(v.valid).toBe(false);
        expect(v.violations.join(" ")).toMatch(/heading/iu);
    });

    it("rejects marketing words case-insensitively", () => {
        const v = validateOverview(
            `This is a Powerful and seamless package. ${goodBody}`,
        );
        expect(v.valid).toBe(false);
        expect(v.violations.join(" ")).toMatch(/marketing/iu);
        expect(v.violations.join(" ")).toMatch(/powerful/iu);
        expect(v.violations.join(" ")).toMatch(/seamless/iu);
    });

    it("rejects Mermaid fences", () => {
        const v = validateOverview(
            "```mermaid\ngraph TD\nA-->B\n```\n\n" + goodBody,
        );
        expect(v.valid).toBe(false);
        expect(v.violations.join(" ")).toMatch(/mermaid/iu);
    });

    it("rejects absolute https URLs", () => {
        const v = validateOverview(
            `See https://github.com/microsoft/TypeAgent for context. ${goodBody}`,
        );
        expect(v.valid).toBe(false);
        expect(v.violations.join(" ")).toMatch(/absolute URL/iu);
    });

    it("rejects code fences without a language tag", () => {
        const v = validateOverview("```\nconst x = 1;\n```\n\n" + goodBody);
        expect(v.valid).toBe(false);
        expect(v.violations.join(" ")).toMatch(/language tag/iu);
    });

    it("rejects bodies above the 500-word hard cap", () => {
        const huge = "word ".repeat(600).trim();
        const v = validateOverview(huge);
        expect(v.valid).toBe(false);
        expect(v.violations.join(" ")).toMatch(/hard cap/iu);
    });

    it("warns when below the target band but does not invalidate", () => {
        const v = validateOverview("Just a tiny note about the package.");
        expect(v.valid).toBe(true);
        expect(v.warnings.join(" ")).toMatch(/target band/iu);
    });

    it("warns when above target band but under the hard cap", () => {
        const v = validateOverview("word ".repeat(450).trim());
        expect(v.valid).toBe(true);
        expect(v.warnings.join(" ")).toMatch(/target band/iu);
    });
});

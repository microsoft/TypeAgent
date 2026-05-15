// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import {
    countDocumentationWords,
    validateDocumentation,
} from "../src/documentationValidation.js";

const minimalGood = [
    "## Overview",
    "",
    "Lorem ipsum ".repeat(80).trim(),
    "",
    "## Architecture",
    "",
    "Dolor sit amet ".repeat(80).trim(),
].join("\n");

describe("countDocumentationWords", () => {
    it("counts words in plain prose", () => {
        expect(countDocumentationWords("one two three four")).toBe(4);
    });
    it("ignores fenced code blocks", () => {
        const md =
            "Hello world.\n\n```ts\nconst x = 1; const y = 2;\n```\n\nDone.";
        expect(countDocumentationWords(md)).toBe(3);
    });
    it("treats consecutive whitespace as one separator", () => {
        expect(countDocumentationWords("a    b\n\nc")).toBe(3);
    });
    it("returns 0 for empty body", () => {
        expect(countDocumentationWords("")).toBe(0);
    });
});

describe("validateDocumentation", () => {
    it("passes a multi-section body in the target band", () => {
        const v = validateDocumentation(minimalGood);
        expect(v.valid).toBe(true);
        expect(v.violations).toEqual([]);
        expect(v.sectionHeadings).toContain("Overview");
        expect(v.sectionHeadings).toContain("Architecture");
    });

    it("rejects a body that contains an H1 heading", () => {
        const v = validateDocumentation(`# foo\n\n${minimalGood}`);
        expect(v.valid).toBe(false);
        expect(v.violations.join(" ")).toMatch(/H1/iu);
    });

    it("rejects a body without an Overview section", () => {
        const body = [
            "## Architecture",
            "",
            "lorem ".repeat(80).trim(),
            "",
            "## How to extend",
            "",
            "ipsum ".repeat(80).trim(),
        ].join("\n");
        const v = validateDocumentation(body);
        expect(v.valid).toBe(false);
        expect(v.violations.join(" ")).toMatch(/Overview/u);
    });

    it("rejects a body with no H2 headings at all", () => {
        const v = validateDocumentation("Just one paragraph of prose.");
        expect(v.valid).toBe(false);
        expect(v.violations.join(" ")).toMatch(/heading/iu);
    });

    it("rejects marketing words case-insensitively", () => {
        const v = validateDocumentation(
            `## Overview\n\nThis is a Powerful and seamless package. ${minimalGood}`,
        );
        expect(v.valid).toBe(false);
        expect(v.violations.join(" ")).toMatch(/marketing/iu);
        expect(v.violations.join(" ")).toMatch(/powerful/iu);
        expect(v.violations.join(" ")).toMatch(/seamless/iu);
    });

    it("rejects Mermaid fences", () => {
        const v = validateDocumentation(
            "## Overview\n\n```mermaid\ngraph TD\nA-->B\n```\n\n" + minimalGood,
        );
        expect(v.valid).toBe(false);
        expect(v.violations.join(" ")).toMatch(/mermaid/iu);
    });

    it("rejects absolute https URLs in markdown link syntax", () => {
        const v = validateDocumentation(
            `## Overview\n\nSee [TypeAgent](https://github.com/microsoft/TypeAgent) for context. ${minimalGood}`,
        );
        expect(v.valid).toBe(false);
        expect(v.violations.join(" ")).toMatch(/markdown link syntax/iu);
    });

    it("rejects autolink absolute URLs", () => {
        const v = validateDocumentation(
            `## Overview\n\nVisit <https://aka.ms/foo> to start. ${minimalGood}`,
        );
        expect(v.valid).toBe(false);
        expect(v.violations.join(" ")).toMatch(/autolink/iu);
    });

    it("allows absolute URLs in plain prose and inline code", () => {
        const v = validateDocumentation(
            `## Overview\n\nGo to https://discord.com/developers/applications and copy the token from \`https://aka.ms/foo\`. ${minimalGood}`,
        );
        expect(v.valid).toBe(true);
        expect(v.violations).toEqual([]);
    });

    it("does not flag URLs inside fenced code samples", () => {
        const v = validateDocumentation(
            "## Overview\n\nExample link syntax:\n\n```md\n[a](https://example.com)\n```\n\n" +
                minimalGood,
        );
        expect(v.valid).toBe(true);
    });

    it("rejects code fences without a language tag", () => {
        const v = validateDocumentation(
            `## Overview\n\n\`\`\`\nconst x = 1;\n\`\`\`\n\n${minimalGood}`,
        );
        expect(v.valid).toBe(false);
        expect(v.violations.join(" ")).toMatch(/language tag/iu);
    });

    it("rejects bodies above the documentation hard cap", () => {
        const huge = "## Overview\n\n" + "word ".repeat(3000).trim();
        const v = validateDocumentation(huge);
        expect(v.valid).toBe(false);
        expect(v.violations.join(" ")).toMatch(/hard cap/iu);
    });

    it("warns when below the target band but does not invalidate", () => {
        const v = validateDocumentation(
            "## Overview\n\nJust a tiny note about the package.",
        );
        expect(v.valid).toBe(true);
        expect(v.warnings.join(" ")).toMatch(/target band/iu);
    });

    it("warns when above target band but under the hard cap", () => {
        const v = validateDocumentation(
            "## Overview\n\n" + "word ".repeat(2000).trim(),
        );
        expect(v.valid).toBe(true);
        expect(v.warnings.join(" ")).toMatch(/target band/iu);
    });
});

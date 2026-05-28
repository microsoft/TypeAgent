// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import {
    readReadmeContext,
    stripGeneratedSections,
} from "../src/readReadmeContext.js";

async function tmpPackageDir(): Promise<{
    dir: string;
    cleanup: () => Promise<void>;
}> {
    const root = await fs.mkdtemp(
        path.join(os.tmpdir(), "docsautogen-readme-"),
    );
    return {
        dir: root,
        cleanup: () => fs.rm(root, { recursive: true, force: true }),
    };
}

const SAMPLE_README = `# my-pkg

Hand-written intro paragraph.

## Setup

Install the thing:

\`\`\`bash
pnpm i
\`\`\`

<!-- AUTOGEN:DOCS:START -->
<!-- AUTOGEN:DOCS:HASH:sha256=0000 -->

old generated content that should not leak through

<!-- AUTOGEN:DOCS:END -->

## Trademarks

Standard trademark boilerplate that we don't want to feed the LLM.
`;

describe("readReadmeContext", () => {
    it("returns exists=false when README is missing", async () => {
        const { dir, cleanup } = await tmpPackageDir();
        try {
            const ctx = await readReadmeContext(dir);
            expect(ctx.exists).toBe(false);
            expect(ctx.handAuthored).toBe("");
            expect(ctx.wordCount).toBe(0);
        } finally {
            await cleanup();
        }
    });

    it("strips AUTOGEN region and Trademarks section but keeps hand-written prose", async () => {
        const { dir, cleanup } = await tmpPackageDir();
        try {
            await fs.writeFile(path.join(dir, "README.md"), SAMPLE_README);
            const ctx = await readReadmeContext(dir);
            expect(ctx.exists).toBe(true);
            expect(ctx.handAuthored).toContain("# my-pkg");
            expect(ctx.handAuthored).toContain("Hand-written intro paragraph.");
            expect(ctx.handAuthored).toContain("## Setup");
            expect(ctx.handAuthored).not.toContain("AUTOGEN");
            expect(ctx.handAuthored).not.toContain("old generated content");
            expect(ctx.handAuthored).not.toMatch(/^##\s+Trademarks/mu);
            expect(ctx.handAuthored).not.toContain("trademark boilerplate");
            expect(ctx.wordCount).toBeGreaterThan(0);
        } finally {
            await cleanup();
        }
    });
});

describe("stripGeneratedSections", () => {
    it("returns the input untouched when no AUTOGEN region or Trademarks block is present", () => {
        const input = "# foo\n\nbody";
        expect(stripGeneratedSections(input)).toBe(input);
    });

    it("collapses excess blank lines created by the strip", () => {
        const input =
            "# foo\n\nintro\n\n<!-- AUTOGEN:DOCS:START -->\n\nold body\n\n<!-- AUTOGEN:DOCS:END -->\n\n\n## After";
        const out = stripGeneratedSections(input);
        expect(out).not.toMatch(/\n{3,}/u);
        expect(out).toContain("intro");
        expect(out).toContain("## After");
    });
});

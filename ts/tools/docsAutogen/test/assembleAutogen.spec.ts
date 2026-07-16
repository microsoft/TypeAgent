// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import {
    assembleAutogenBlock,
    computeInputHash,
} from "../src/assembleAutogen.js";
import { parseHashComment } from "../src/contentHash.js";
import type { PackageInputs } from "../src/packageInputs.js";
import type { WorkspacePackage } from "../src/workspaceGraph.js";

function pkg(name: string, relDir: string): WorkspacePackage {
    return {
        name,
        dir: `/repo/ts/${relDir}`,
        relDir,
        packageJson: { name, description: "demo pkg" },
        isPrivate: false,
    };
}

function makeInputs(overrides: Partial<PackageInputs> = {}): PackageInputs {
    const base: PackageInputs = {
        pkg: pkg("@a/foo", "packages/foo"),
        description: "demo pkg",
        workspaceDeps: [],
        externalDeps: [],
        reverseDeps: [],
        sourceFiles: [],
        totalSourceLines: 5000,
        entryPoints: [
            { subpath: ".", resolved: "./dist/index.js", exists: true },
            { subpath: "./b", resolved: "./dist/b.js", exists: true },
            { subpath: "./c", resolved: "./dist/c.js", exists: true },
        ],
        agentSurface: {
            manifestPath: null,
            schemaPath: null,
            grammarPath: null,
            handlerPath: null,
        },
        isAgentPackage: false,
        actions: [],
        envVars: [],
        readmeContext: {
            exists: false,
            raw: "",
            handAuthored: "",
            wordCount: 0,
        },
        existingBlock: null,
    };
    return { ...base, ...overrides };
}

describe("assembleAutogenBlock", () => {
    it("emits hash → SOURCE → H1 → AI doc → Reference → footer in that order", () => {
        const block = assembleAutogenBlock(makeInputs(), {
            headSha: "a".repeat(40),
            isoDate: "2026-05-14T21:00:00Z",
        });
        const idxHash = block.body.indexOf("AUTOGEN:DOCS:HASH:sha256=");
        const idxSource = block.body.indexOf("AUTOGEN:DOCS:SOURCE:");
        const idxTitle = block.body.indexOf(
            "# @a/foo — AI-generated documentation",
        );
        const idxOverview = block.body.indexOf("## Overview");
        const idxReference = block.body.indexOf("## Reference");
        const idxFooter = block.body.indexOf("docs-generate.yml");
        expect(idxHash).toBeGreaterThanOrEqual(0);
        expect(idxSource).toBeGreaterThan(idxHash);
        expect(idxTitle).toBeGreaterThan(idxSource);
        expect(idxOverview).toBeGreaterThan(idxTitle);
        expect(idxReference).toBeGreaterThan(idxOverview);
        expect(idxFooter).toBeGreaterThan(idxReference);
    });

    it("returns a hash that matches the embedded comment", () => {
        const block = assembleAutogenBlock(makeInputs(), {
            headSha: "sha",
            isoDate: "date",
        });
        expect(block.body).toContain(`sha256=${block.hash}`);
        expect(block.hash).toMatch(/^[0-9a-f]{64}$/u);
    });

    it("hash is stable across runs when inputs are equal", () => {
        const a = assembleAutogenBlock(makeInputs(), {
            headSha: "x",
            isoDate: "2026-01-01",
        });
        const b = assembleAutogenBlock(makeInputs(), {
            headSha: "y",
            isoDate: "2099-01-01",
        });
        expect(a.hash).toBe(b.hash);
    });

    it("hash changes when relevant inputs change", () => {
        const a = assembleAutogenBlock(makeInputs(), {
            headSha: "x",
            isoDate: "d",
        });
        const b = assembleAutogenBlock(
            makeInputs({ description: "different description" }),
            { headSha: "x", isoDate: "d" },
        );
        expect(a.hash).not.toBe(b.hash);
    });

    // The idempotency gate in cli.ts computes computeInputHash(inputs) and
    // compares it to the hash parsed out of the on-disk file. If these two
    // ever diverge the gate silently stops skipping (or skips wrongly), so
    // lock the invariant: the standalone hash equals the embedded comment.
    it("computeInputHash equals the hash embedded in the body", () => {
        const inputs = makeInputs();
        const block = assembleAutogenBlock(inputs, {
            headSha: "sha",
            isoDate: "date",
        });
        expect(computeInputHash(inputs)).toBe(block.hash);
        expect(computeInputHash(inputs)).toBe(parseHashComment(block.body));
    });

    it("computeInputHash ignores the LLM body and footer", () => {
        const inputs = makeInputs();
        const withLlm = assembleAutogenBlock(inputs, {
            headSha: "x",
            isoDate: "2026-01-01",
            llmDocumentationBody: "## Overview\n\nSomething specific.",
        });
        const withoutLlm = assembleAutogenBlock(inputs, {
            headSha: "y",
            isoDate: "2099-12-31",
        });
        expect(parseHashComment(withLlm.body)).toBe(computeInputHash(inputs));
        expect(parseHashComment(withoutLlm.body)).toBe(
            computeInputHash(inputs),
        );
    });

    it("embeds the LLM-authored body when supplied", () => {
        const llmBody =
            "## Overview\n\nA crisp factual overview.\n\n## Architecture\n\nLayout details.";
        const block = assembleAutogenBlock(makeInputs(), {
            headSha: "sha",
            isoDate: "date",
            llmDocumentationBody: llmBody,
        });
        expect(block.body).toContain("A crisp factual overview.");
        expect(block.body).toContain("AI-authored documentation");
    });

    it("falls back to a placeholder when no LLM body is supplied", () => {
        const block = assembleAutogenBlock(makeInputs(), {
            headSha: "sha",
            isoDate: "date",
        });
        expect(block.body).toContain("Placeholder documentation");
        expect(block.body).toContain("## Overview");
    });

    it("placeholder banner OMITS the ./README.md link when no README exists", () => {
        const block = assembleAutogenBlock(makeInputs(), {
            headSha: "sha",
            isoDate: "date",
        });
        // The base fixture has readmeContext.exists: false.
        expect(block.body).toContain("Placeholder documentation");
        expect(block.body).not.toContain("[`./README.md`](./README.md)");
    });

    it("placeholder banner INCLUDES the ./README.md link when README exists", () => {
        const block = assembleAutogenBlock(
            makeInputs({
                readmeContext: {
                    exists: true,
                    raw: "# Existing\n\nHand-written.",
                    handAuthored: "# Existing\n\nHand-written.",
                    wordCount: 3,
                },
            }),
            { headSha: "sha", isoDate: "date" },
        );
        expect(block.body).toContain("Placeholder documentation");
        expect(block.body).toContain("[`./README.md`](./README.md)");
    });

    it("renders the deterministic Actions reference for agent packages", () => {
        const block = assembleAutogenBlock(
            makeInputs({
                isAgentPackage: true,
                agentSurface: {
                    manifestPath: "./src/photoManifest.json",
                    schemaPath: "./src/photoSchema.ts",
                    grammarPath: null,
                    handlerPath: "./src/photoHandler.ts",
                },
                actions: [
                    {
                        typeName: "TakePhotoAction",
                        actionName: "takePhoto",
                        description: "Capture a photograph.",
                        samplePhrases: ["take a photo"],
                        parameters: [
                            {
                                name: "caption",
                                optional: true,
                                type: "string",
                                description: "Optional caption.",
                            },
                        ],
                        implemented: true,
                    },
                ],
            }),
            { headSha: "sha", isoDate: "date" },
        );
        expect(block.body).toContain("### Actions");
        expect(block.body).toContain("| User says | Action |");
        // No required parameters → action cell is just the bare name.
        expect(block.body).toContain('| "take a photo" | `takePhoto` |');
    });

    it("flags compact mode and KEEPS Used by when reverse-deps are non-empty", () => {
        const block = assembleAutogenBlock(
            makeInputs({
                totalSourceLines: 50,
                entryPoints: [
                    { subpath: ".", resolved: "./dist/index.js", exists: true },
                ],
                reverseDeps: [pkg("@a/consumer", "packages/consumer")],
            }),
            { headSha: "sha", isoDate: "date" },
        );
        expect(block.compact).toBe(true);
        expect(block.body).toContain("### Used by");
        expect(block.body).toContain("@a/consumer");
    });

    it("flags compact mode and OMITS Used by when reverse-deps are empty", () => {
        const block = assembleAutogenBlock(
            makeInputs({
                totalSourceLines: 50,
                entryPoints: [
                    { subpath: ".", resolved: "./dist/index.js", exists: true },
                ],
                reverseDeps: [],
            }),
            { headSha: "sha", isoDate: "date" },
        );
        expect(block.compact).toBe(true);
        expect(block.body).not.toContain("### Used by");
    });
});

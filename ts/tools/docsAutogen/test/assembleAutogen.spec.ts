// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { assembleAutogenBlock } from "../src/assembleAutogen.js";
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
        existingBlock: null,
    };
    return { ...base, ...overrides };
}

describe("assembleAutogenBlock", () => {
    it("emits hash → Overview → Reference → footer in that order", () => {
        const block = assembleAutogenBlock(makeInputs(), {
            headSha: "a".repeat(40),
            isoDate: "2026-05-14T21:00:00Z",
        });
        const idxHash = block.body.indexOf("AUTOGEN:DOCS:HASH:sha256=");
        const idxOverview = block.body.indexOf("## Overview");
        const idxReference = block.body.indexOf("## Reference");
        const idxFooter = block.body.indexOf("docs-generate.yml");
        expect(idxHash).toBeGreaterThanOrEqual(0);
        expect(idxOverview).toBeGreaterThan(idxHash);
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

    it("preserves an existing Overview verbatim across regen", () => {
        const existingBlock = [
            "<!-- AUTOGEN:DOCS:HASH:sha256=" + "0".repeat(64) + " -->",
            "",
            "## Overview",
            "",
            "Hand-written overview that must survive.",
            "",
            "## Reference",
            "",
            "old reference body",
            "",
        ].join("\n");
        const block = assembleAutogenBlock(makeInputs({ existingBlock }), {
            headSha: "sha",
            isoDate: "date",
        });
        expect(block.body).toContain(
            "Hand-written overview that must survive.",
        );
        // Reference is rebuilt deterministically:
        expect(block.body).toContain("Generated deterministically");
        expect(block.body).not.toContain("old reference body");
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

    it("composes a body that round-trips through findAutogenRegion", async () => {
        const block = assembleAutogenBlock(makeInputs(), {
            headSha: "sha",
            isoDate: "date",
        });
        const wrapped = `# foo\n\n<!-- AUTOGEN:DOCS:START -->\n${block.body}\n<!-- AUTOGEN:DOCS:END -->\n`;
        const { findAutogenRegion } = await import("../src/autogenRegion.js");
        const region = findAutogenRegion(wrapped);
        expect(region).not.toBeNull();
        expect(region!.body).toContain("## Overview");
        expect(region!.body).toContain("## Reference");
    });
});

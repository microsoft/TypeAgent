// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { assembleOverviewPrompt } from "../src/promptAssembly.js";
import type { PackageInputs } from "../src/packageInputs.js";
import type { WorkspacePackage } from "../src/workspaceGraph.js";

async function makePackage(): Promise<{
    pkg: WorkspacePackage;
    cleanup: () => Promise<void>;
}> {
    const root = await fs.mkdtemp(
        path.join(os.tmpdir(), "docsautogen-prompt-"),
    );
    const dir = path.join(root, "pkg");
    await fs.mkdir(path.join(dir, "src"), { recursive: true });
    await fs.writeFile(
        path.join(dir, "src", "index.ts"),
        "export const x = 1;\n".repeat(20),
    );
    return {
        pkg: {
            name: "@x/example",
            relDir: "packages/example",
            dir,
            isPrivate: true,
            packageJson: {
                name: "@x/example",
                description: "An example package.",
                exports: { ".": "./dist/index.js" },
            },
        },
        cleanup: () => fs.rm(root, { recursive: true, force: true }),
    };
}

function inputsFrom(pkg: WorkspacePackage): PackageInputs {
    return {
        pkg,
        description: "An example package.",
        workspaceDeps: [],
        externalDeps: [],
        reverseDeps: [],
        sourceFiles: [
            {
                relPath: "./src/index.ts",
                absPath: path.join(pkg.dir, "src", "index.ts"),
                sizeBytes: 100,
                lineCount: 20,
            },
        ],
        totalSourceLines: 20,
        entryPoints: [
            { subpath: ".", resolved: "./dist/index.js", exists: true },
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
}

describe("assembleOverviewPrompt", () => {
    it("includes package metadata and reference, asks model to emit only Overview prose", async () => {
        const { pkg, cleanup } = await makePackage();
        try {
            const prompt = await assembleOverviewPrompt(
                inputsFrom(pkg),
                "## Reference\n\n### Entry points\n- `.` → `./dist/index.js`",
            );
            expect(prompt.system).toMatch(/Overview section/iu);
            expect(prompt.system).toMatch(/Output ONLY/u);
            expect(prompt.user).toContain("@x/example");
            expect(prompt.user).toContain("An example package.");
            expect(prompt.user).toContain("packages/example");
            expect(prompt.user).toContain("Reference (already generated");
            expect(prompt.user).toContain("./dist/index.js");
        } finally {
            await cleanup();
        }
    });

    it("preserves an existing Overview section in the user message", async () => {
        const { pkg, cleanup } = await makePackage();
        try {
            const inputs: PackageInputs = {
                ...inputsFrom(pkg),
                existingBlock:
                    "## Overview\n\nHand-written overview that must be refined.\n\n## Reference\n\n…",
            };
            const prompt = await assembleOverviewPrompt(inputs, "## Reference");
            expect(prompt.user).toContain(
                "Existing Overview (refine if needed)",
            );
            expect(prompt.user).toContain(
                "Hand-written overview that must be refined.",
            );
            // The "## Reference" line that follows in the existing block must NOT
            // bleed into the existing-overview slice.
            const ovrIdx = prompt.user.indexOf("Hand-written overview");
            // The deterministic reference comes BEFORE the existing-overview block.
            // So no "## Reference" header should appear right after the existing overview.
            expect(prompt.user.slice(ovrIdx, ovrIdx + 200)).not.toMatch(
                /## Reference/u,
            );
        } finally {
            await cleanup();
        }
    });

    it("samples up to maxSampleFiles entry-point sources with language tags", async () => {
        const { pkg, cleanup } = await makePackage();
        try {
            const prompt = await assembleOverviewPrompt(
                inputsFrom(pkg),
                "## Reference",
                { maxSampleFiles: 2 },
            );
            expect(prompt.user).toContain("```ts");
            expect(prompt.user).toContain("export const x = 1;");
        } finally {
            await cleanup();
        }
    });

    it("drops source samples when over the user-char budget", async () => {
        const { pkg, cleanup } = await makePackage();
        try {
            const prompt = await assembleOverviewPrompt(
                inputsFrom(pkg),
                "## Reference",
                { maxUserChars: 200 },
            );
            expect(prompt.user.length).toBeLessThanOrEqual(400);
            expect(prompt.user).toMatch(/omitted|@x\/example/u);
        } finally {
            await cleanup();
        }
    });
});

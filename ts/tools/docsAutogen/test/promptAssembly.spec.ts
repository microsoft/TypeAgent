// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { assembleDocumentationPrompt } from "../src/promptAssembly.js";
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
}

describe("assembleDocumentationPrompt", () => {
    it("includes package metadata and reference, asks model for multi-section markdown", async () => {
        const { pkg, cleanup } = await makePackage();
        try {
            const prompt = await assembleDocumentationPrompt(
                inputsFrom(pkg),
                "## Reference\n\n### Entry points\n- `.` → `./dist/index.js`",
            );
            expect(prompt.system).toMatch(/multi-section/iu);
            expect(prompt.system).toMatch(/Output ONLY/u);
            expect(prompt.system).toMatch(/## Overview/u);
            expect(prompt.user).toContain("@x/example");
            expect(prompt.user).toContain("An example package.");
            expect(prompt.user).toContain("packages/example");
            expect(prompt.user).toContain("Reference (already generated");
            expect(prompt.user).toContain("./dist/index.js");
        } finally {
            await cleanup();
        }
    });

    it("forwards hand-written README content when present", async () => {
        const { pkg, cleanup } = await makePackage();
        try {
            const inputs: PackageInputs = {
                ...inputsFrom(pkg),
                readmeContext: {
                    exists: true,
                    raw: "# pkg\n\nA hand-written introduction.\n",
                    handAuthored: "# pkg\n\nA hand-written introduction.",
                    wordCount: 5,
                },
            };
            const prompt = await assembleDocumentationPrompt(
                inputs,
                "## Reference",
            );
            expect(prompt.user).toContain("Hand-written README.md");
            expect(prompt.user).toContain("A hand-written introduction.");
        } finally {
            await cleanup();
        }
    });

    it("includes the action list for agent packages", async () => {
        const { pkg, cleanup } = await makePackage();
        try {
            const inputs: PackageInputs = {
                ...inputsFrom(pkg),
                isAgentPackage: true,
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
                                description: "",
                            },
                        ],
                        implemented: true,
                    },
                ],
            };
            const prompt = await assembleDocumentationPrompt(
                inputs,
                "## Reference",
            );
            expect(prompt.user).toContain("Action list");
            expect(prompt.user).toContain("`takePhoto`");
            expect(prompt.user).toContain("Capture a photograph.");
            expect(prompt.user).toContain('sample: "take a photo"');
        } finally {
            await cleanup();
        }
    });

    it("excludes schema-only stubs from the action list and notes the omission", async () => {
        const { pkg, cleanup } = await makePackage();
        try {
            const inputs: PackageInputs = {
                ...inputsFrom(pkg),
                isAgentPackage: true,
                actions: [
                    {
                        typeName: "CreateMessageAction",
                        actionName: "createMessage",
                        description: "Send a message.",
                        samplePhrases: ["send a message"],
                        parameters: [],
                        implemented: true,
                    },
                    {
                        typeName: "CreateGuildAction",
                        actionName: "createGuild",
                        description: "Create a guild.",
                        samplePhrases: ["create a guild"],
                        parameters: [],
                        implemented: false,
                    },
                ],
            };
            const prompt = await assembleDocumentationPrompt(
                inputs,
                "## Reference",
            );
            expect(prompt.user).toContain("`createMessage`");
            expect(prompt.user).not.toContain("`createGuild`");
            expect(prompt.user).toMatch(
                /1 additional schema-only stub is omitted/u,
            );
        } finally {
            await cleanup();
        }
    });

    it("preserves an existing AUTOGEN body in the user message", async () => {
        const { pkg, cleanup } = await makePackage();
        try {
            const inputs: PackageInputs = {
                ...inputsFrom(pkg),
                existingBlock:
                    "<!-- AUTOGEN:DOCS:HASH:sha256=" +
                    "0".repeat(64) +
                    " -->\n\n## Overview\n\nPrior body to refine.\n",
            };
            const prompt = await assembleDocumentationPrompt(
                inputs,
                "## Reference",
            );
            expect(prompt.user).toContain("Previously generated documentation");
            expect(prompt.user).toContain("Prior body to refine.");
        } finally {
            await cleanup();
        }
    });

    it("forwards detected env vars and instructs the model to ground its Setup section in them", async () => {
        const { pkg, cleanup } = await makePackage();
        try {
            const inputs: PackageInputs = {
                ...inputsFrom(pkg),
                envVars: ["DISCORD_BOT_TOKEN", "OPENAI_API_KEY"],
            };
            const prompt = await assembleDocumentationPrompt(
                inputs,
                "## Reference",
            );
            expect(prompt.user).toContain("## Environment variables");
            expect(prompt.user).toContain("`DISCORD_BOT_TOKEN`");
            expect(prompt.user).toContain("`OPENAI_API_KEY`");
            expect(prompt.user).toMatch(/Mention every one of them/u);
            expect(prompt.system).toMatch(/## Setup/u);
        } finally {
            await cleanup();
        }
    });

    it("does not emit the env-vars block when no env vars are detected", async () => {
        const { pkg, cleanup } = await makePackage();
        try {
            const prompt = await assembleDocumentationPrompt(
                inputsFrom(pkg),
                "## Reference",
            );
            expect(prompt.user).not.toContain("## Environment variables");
        } finally {
            await cleanup();
        }
    });

    it("samples up to maxSampleFiles entry-point sources with language tags", async () => {
        const { pkg, cleanup } = await makePackage();
        try {
            const prompt = await assembleDocumentationPrompt(
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
            const prompt = await assembleDocumentationPrompt(
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

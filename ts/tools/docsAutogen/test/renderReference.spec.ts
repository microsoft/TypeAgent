// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { decideCompact } from "../src/compactMode.js";
import {
    EXTERNAL_DEPS_MAX,
    FILES_OF_INTEREST_MAX,
    USED_BY_MAX,
} from "../src/lengthCaps.js";
import type { PackageInputs, SourceFile } from "../src/packageInputs.js";
import { renderReferenceSection } from "../src/renderReference.js";
import type { WorkspacePackage } from "../src/workspaceGraph.js";

function pkg(name: string, relDir: string): WorkspacePackage {
    return {
        name,
        dir: `/repo/ts/${relDir}`,
        relDir,
        packageJson: { name },
        isPrivate: false,
    };
}

function file(rel: string, lines = 50, bytes = 1000): SourceFile {
    return {
        relPath: rel,
        absPath: `/abs${rel}`,
        sizeBytes: bytes,
        lineCount: lines,
    };
}

function makeInputs(overrides: Partial<PackageInputs> = {}): PackageInputs {
    const base: PackageInputs = {
        pkg: pkg("@scope/foo", "packages/foo"),
        description: "",
        workspaceDeps: [],
        externalDeps: [],
        reverseDeps: [],
        sourceFiles: [],
        totalSourceLines: 1000,
        entryPoints: [],
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

describe("renderReferenceSection", () => {
    it("emits the deterministic-only-disclaimer", () => {
        const out = renderReferenceSection(makeInputs(), {
            compact: false,
            reasons: [],
        });
        expect(out).toMatch(/Auto-generated, no AI involvement/u);
        expect(out).toMatch(/^## Reference$/mu);
    });

    it("renders entry points with link when file exists, plain code when not", () => {
        const out = renderReferenceSection(
            makeInputs({
                entryPoints: [
                    { subpath: ".", resolved: "./dist/index.js", exists: true },
                    {
                        subpath: "./agent/handlers",
                        resolved: "./dist/handlers.js",
                        exists: false,
                    },
                ],
            }),
            { compact: false, reasons: [] },
        );
        expect(out).toContain("[./dist/index.js](./dist/index.js)");
        expect(out).toContain("`./dist/handlers.js`");
        expect(out).toContain("_(not found on disk)_");
    });

    it("caps Files of interest at FILES_OF_INTEREST_MAX with overflow note", () => {
        const sourceFiles = Array.from(
            { length: FILES_OF_INTEREST_MAX + 5 },
            (_, i) => file(`./src/file${String(i).padStart(2, "0")}.ts`),
        );
        const out = renderReferenceSection(makeInputs({ sourceFiles }), {
            compact: false,
            reasons: [],
        });
        const links = out.match(/\[\.\/src\/file\d+\.ts\]/gu) ?? [];
        expect(links.length).toBe(FILES_OF_INTEREST_MAX);
        expect(out).toMatch(/and 5 more under `\.\/src\/`/u);
    });

    it("caps Used by at USED_BY_MAX with overflow note", () => {
        const reverseDeps = Array.from({ length: USED_BY_MAX + 3 }, (_, i) =>
            pkg(`@x/p${i}`, `packages/p${i}`),
        );
        const out = renderReferenceSection(makeInputs({ reverseDeps }), {
            compact: false,
            reasons: [],
        });
        const usedSection = out.split("### Used by")[1] ?? "";
        const lines = usedSection.split("\n").filter((l) => l.startsWith("- "));
        expect(lines.length).toBe(USED_BY_MAX + 1);
        expect(out).toMatch(/and 3 more workspace consumers/u);
    });

    it("caps external deps at EXTERNAL_DEPS_MAX with overflow note", () => {
        const externalDeps = Array.from(
            { length: EXTERNAL_DEPS_MAX + 4 },
            (_, i) => `dep${i}`,
        );
        const out = renderReferenceSection(makeInputs({ externalDeps }), {
            compact: false,
            reasons: [],
        });
        const externalLine =
            out.split("\n").find((l) => l.startsWith("External: ")) ?? "";
        const codeMatches = externalLine.match(/`[^`]+`/gu) ?? [];
        expect(codeMatches.length).toBe(EXTERNAL_DEPS_MAX);
        expect(out).toMatch(/and 4 more not shown/u);
    });

    it("renders Used by as `_None._` when reverse-deps are empty", () => {
        const out = renderReferenceSection(makeInputs(), {
            compact: false,
            reasons: [],
        });
        expect(out).toMatch(/### Used by\s*\n\s*\n_None\._/u);
    });

    it("includes Agent surface only for agent packages with detected files", () => {
        const out = renderReferenceSection(
            makeInputs({
                isAgentPackage: true,
                agentSurface: {
                    manifestPath: "./src/listManifest.json",
                    schemaPath: "./src/listSchema.ts",
                    grammarPath: null,
                    handlerPath: "./src/listActionHandler.ts",
                },
            }),
            { compact: false, reasons: [] },
        );
        expect(out).toContain("### Agent surface");
        expect(out).toContain(
            "Manifest: [./src/listManifest.json](./src/listManifest.json)",
        );
        expect(out).toContain(
            "Schema: [./src/listSchema.ts](./src/listSchema.ts)",
        );
        expect(out).toContain(
            "Handler: [./src/listActionHandler.ts](./src/listActionHandler.ts)",
        );
        expect(out).not.toContain("Grammar:");
    });

    it("omits Agent surface for non-agent packages even when files match", () => {
        const out = renderReferenceSection(
            makeInputs({
                isAgentPackage: false,
                agentSurface: {
                    manifestPath: "./src/manifest.json",
                    schemaPath: null,
                    grammarPath: null,
                    handlerPath: null,
                },
            }),
            { compact: false, reasons: [] },
        );
        expect(out).not.toContain("### Agent surface");
    });

    it("renders the Actions reference as a compact two-column table for agent packages with parsed actions", () => {
        const out = renderReferenceSection(
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
                            {
                                name: "cameraId",
                                optional: false,
                                type: "string",
                                description: "Camera id.",
                            },
                        ],
                        implemented: true,
                    },
                ],
            }),
            { compact: false, reasons: [] },
        );
        expect(out).toContain("### Actions");
        expect(out).toContain("| User says | Action |");
        // Required parameter `cameraId` becomes the only entry in the
        // sample JSON; optional `caption` is intentionally elided.
        expect(out).toContain(
            '| "take a photo" | `takePhoto` → `{ "cameraId": "…" }` |',
        );
        // No more per-action sub-headings or parameter tables.
        expect(out).not.toContain("#### `takePhoto`");
        expect(out).not.toContain("| Name | Type | Required | Notes |");
    });

    it("omits stub actions and notes how many were hidden", () => {
        const out = renderReferenceSection(
            makeInputs({
                isAgentPackage: true,
                agentSurface: {
                    manifestPath: "./src/discordManifest.json",
                    schemaPath: "./src/discordSchema.ts",
                    grammarPath: null,
                    handlerPath: "./src/discordActionHandler.ts",
                },
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
            }),
            { compact: false, reasons: [] },
        );
        expect(out).toContain("### Actions");
        expect(out).toContain('| "send a message" | `createMessage` |');
        expect(out).not.toContain('"create a guild"');
        expect(out).not.toContain("`createGuild`");
        expect(out).toMatch(
            /1 additional action is declared in the schema but not yet implemented/u,
        );
    });

    it("emits a 'none implemented' note when every declared action is a stub", () => {
        const out = renderReferenceSection(
            makeInputs({
                isAgentPackage: true,
                agentSurface: {
                    manifestPath: "./src/m.json",
                    schemaPath: "./src/s.ts",
                    grammarPath: null,
                    handlerPath: "./src/h.ts",
                },
                actions: [
                    {
                        typeName: "FooAction",
                        actionName: "foo",
                        description: "",
                        samplePhrases: [],
                        parameters: [],
                        implemented: false,
                    },
                ],
            }),
            { compact: false, reasons: [] },
        );
        expect(out).toContain("### Actions");
        expect(out).toMatch(
            /1 action declared in the schema, none yet implemented/u,
        );
        expect(out).not.toContain("| User says | Action |");
    });

    it("omits the Actions reference for non-agent packages", () => {
        const out = renderReferenceSection(
            makeInputs({
                isAgentPackage: false,
                actions: [
                    {
                        typeName: "FooAction",
                        actionName: "foo",
                        description: "",
                        samplePhrases: [],
                        parameters: [],
                        implemented: true,
                    },
                ],
            }),
            { compact: false, reasons: [] },
        );
        expect(out).not.toContain("### Actions");
    });

    it("compact mode collapses Files of interest and omits Used by when empty", () => {
        const sourceFiles = Array.from({ length: 6 }, (_, i) =>
            file(`./src/x${i}.ts`, 5, 100),
        );
        const out = renderReferenceSection(
            makeInputs({
                sourceFiles,
                reverseDeps: [],
            }),
            { compact: true, reasons: ["small"] },
        );
        expect(out).not.toContain("### Used by");
        expect(out).toContain("…and 3 more under `./src/`");
    });

    it("compact mode KEEPS Used by when non-empty", () => {
        const sourceFiles = Array.from({ length: 6 }, (_, i) =>
            file(`./src/x${i}.ts`, 5, 100),
        );
        const out = renderReferenceSection(
            makeInputs({
                sourceFiles,
                reverseDeps: [pkg("@x/consumer", "packages/consumer")],
            }),
            { compact: true, reasons: ["small"] },
        );
        expect(out).toContain("### Used by");
        expect(out).toContain("@x/consumer");
    });

    it("renders package-to-package README links with the right number of ../", () => {
        const inputs = makeInputs({
            pkg: pkg("@a/list", "packages/agents/list"),
            workspaceDeps: [pkg("@a/sdk", "packages/agentSdk")],
        });
        const out = renderReferenceSection(inputs, {
            compact: false,
            reasons: [],
        });
        // packages/agents/list → packages/agentSdk = 3 ../
        expect(out).toContain("[@a/sdk](../../../packages/agentSdk/README.md)");
    });

    it("emits the Environment variables subsection when env vars are present", () => {
        const out = renderReferenceSection(
            makeInputs({
                envVars: ["AZURE_OPENAI_API_KEY", "DISCORD_BOT_TOKEN"],
            }),
            { compact: false, reasons: [] },
        );
        expect(out).toContain("### Environment variables");
        expect(out).toContain("`AZURE_OPENAI_API_KEY`");
        expect(out).toContain("`DISCORD_BOT_TOKEN`");
        expect(out).toMatch(/2 environment variables referenced/u);
        expect(out).toMatch(/`## Setup` section above/u);
    });

    it("omits the Environment variables subsection when none are detected", () => {
        const out = renderReferenceSection(makeInputs({ envVars: [] }), {
            compact: false,
            reasons: [],
        });
        expect(out).not.toContain("### Environment variables");
    });
});

describe("decideCompact", () => {
    it("triggers when totalSourceLines is below threshold", () => {
        const inputs = makeInputs({
            totalSourceLines: 50,
            entryPoints: [
                { subpath: ".", resolved: "./a.js", exists: true },
                { subpath: "./b", resolved: "./b.js", exists: true },
                { subpath: "./c", resolved: "./c.js", exists: true },
            ],
        });
        const d = decideCompact(inputs);
        expect(d.compact).toBe(true);
        expect(d.reasons.some((r) => r.includes("lines"))).toBe(true);
    });
    it("triggers when there are fewer than 3 public exports", () => {
        const inputs = makeInputs({
            totalSourceLines: 10000,
            entryPoints: [{ subpath: ".", resolved: "./a.js", exists: true }],
        });
        const d = decideCompact(inputs);
        expect(d.compact).toBe(true);
        expect(d.reasons.some((r) => r.includes("public exports"))).toBe(true);
    });
    it("does NOT trigger for medium packages with several exports", () => {
        const inputs = makeInputs({
            totalSourceLines: 10000,
            entryPoints: [
                { subpath: ".", resolved: "./a.js", exists: true },
                { subpath: "./b", resolved: "./b.js", exists: true },
                { subpath: "./c", resolved: "./c.js", exists: true },
            ],
        });
        const d = decideCompact(inputs);
        expect(d.compact).toBe(false);
    });
});

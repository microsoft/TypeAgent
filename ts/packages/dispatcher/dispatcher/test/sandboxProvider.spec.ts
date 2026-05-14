// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import type { SchemaContent } from "@typeagent/agent-sdk";
import { loadSandboxProvider } from "../src/neighborhoods/optimize/sandboxProvider.js";

function tmpdir(): string {
    return fs.mkdtempSync(path.join(os.tmpdir(), "typeagent-sandbox-provider-"));
}

function writeSandboxAgent(
    sandboxDir: string,
    schemaName: string,
    files: Record<string, string>,
): void {
    const dir = path.join(sandboxDir, "agents", schemaName);
    fs.mkdirSync(dir, { recursive: true });
    for (const [name, content] of Object.entries(files)) {
        fs.writeFileSync(path.join(dir, name), content);
    }
}

describe("loadSandboxProvider", () => {
    let sandbox: string;

    beforeEach(() => {
        sandbox = tmpdir();
    });

    afterEach(() => {
        fs.rmSync(sandbox, { recursive: true, force: true });
    });

    it("loads a .ts-source agent and inlines schema content", () => {
        const schemaTs =
            'export type AlphaAction = {\n    actionName: "doAlpha";\n};';
        const manifest = {
            emojiChar: "⭐",
            description: "Alpha agent",
            schema: {
                description: "Alpha schema",
                schemaType: "AlphaAction",
                schemaFile: "./schema.ts",
            },
        };
        writeSandboxAgent(sandbox, "alpha", {
            "manifest.json": JSON.stringify(manifest),
            "schema.ts": schemaTs,
        });

        const { provider, schemaNames } = loadSandboxProvider(sandbox);

        expect(schemaNames).toEqual(["alpha"]);

        const config = provider.getActionConfig("alpha");
        expect(config.schemaName).toBe("alpha");
        // schemaFile should be inlined as a SchemaContent object (not a path
        // string and not a function — those would route through
        // getPackageFilePath and miss the sandbox).
        const schemaFile = config.schemaFile as SchemaContent;
        expect(typeof schemaFile).toBe("object");
        expect(schemaFile.format).toBe("ts");
        expect(schemaFile.content).toBe(schemaTs);
    });

    it("reads the sidecar .json config for .ts schemas", () => {
        const schemaTs = "export type AlphaAction = { actionName: 'a' };";
        const sidecarConfig = '{"some":"config"}';
        const manifest = {
            emojiChar: "⭐",
            description: "Alpha",
            schema: {
                description: "Alpha schema",
                schemaType: "AlphaAction",
                schemaFile: "./schema.ts",
            },
        };
        writeSandboxAgent(sandbox, "alpha", {
            "manifest.json": JSON.stringify(manifest),
            "schema.ts": schemaTs,
            "schema.json": sidecarConfig,
        });

        const { provider } = loadSandboxProvider(sandbox);
        const config = provider.getActionConfig("alpha");
        const schemaFile = config.schemaFile as SchemaContent;
        expect(schemaFile.config).toBe(sidecarConfig);
    });

    it("loads a PAS-only agent and inlines schema content", () => {
        // Minimal-but-shaped PAS content. We don't exercise the parser here
        // — just verify the loader reads the bytes and tags the format.
        const schemaPas = JSON.stringify({
            version: 1,
            entry: {},
            types: {},
        });
        const manifest = {
            emojiChar: "🅱️",
            description: "Beta agent",
            schema: {
                description: "Beta schema",
                schemaType: "BetaAction",
                schemaFile: "./schema.pas.json",
            },
        };
        writeSandboxAgent(sandbox, "beta", {
            "manifest.json": JSON.stringify(manifest),
            "schema.pas.json": schemaPas,
        });

        const { provider, schemaNames } = loadSandboxProvider(sandbox);

        expect(schemaNames).toEqual(["beta"]);
        const config = provider.getActionConfig("beta");
        const schemaFile = config.schemaFile as SchemaContent;
        expect(schemaFile.format).toBe("pas");
        expect(schemaFile.content).toBe(schemaPas);
        // PAS files don't get a sidecar config (the format embeds it).
        expect(schemaFile.config).toBeUndefined();
    });

    it("loads a grammar file when present", () => {
        const grammar = JSON.stringify({ version: 1, rules: [] });
        const manifest = {
            emojiChar: "⭐",
            description: "Alpha",
            schema: {
                description: "Alpha schema",
                schemaType: "AlphaAction",
                schemaFile: "./schema.ts",
                grammarFile: "./grammar.ag.json",
            },
        };
        writeSandboxAgent(sandbox, "alpha", {
            "manifest.json": JSON.stringify(manifest),
            "schema.ts": "export type AlphaAction = { actionName: 'a' };",
            "grammar.ag.json": grammar,
        });

        const { provider } = loadSandboxProvider(sandbox);
        const config = provider.getActionConfig("alpha");
        // grammarFile in ActionConfig is inlined to GrammarContent | () => GrammarContent
        const grammarFile = config.grammarFile;
        expect(typeof grammarFile).toBe("object");
        if (typeof grammarFile === "object" && grammarFile !== null) {
            expect((grammarFile as any).format).toBe("ag");
            expect((grammarFile as any).content).toBe(grammar);
        }
    });

    it("skips grammar quietly when the referenced file is missing", () => {
        const manifest = {
            emojiChar: "⭐",
            description: "Alpha",
            schema: {
                description: "Alpha schema",
                schemaType: "AlphaAction",
                schemaFile: "./schema.ts",
                grammarFile: "./grammar.ag.json",
            },
        };
        writeSandboxAgent(sandbox, "alpha", {
            "manifest.json": JSON.stringify(manifest),
            "schema.ts": "export type AlphaAction = { actionName: 'a' };",
            // No grammar.ag.json
        });

        const { provider } = loadSandboxProvider(sandbox);
        const config = provider.getActionConfig("alpha");
        expect(config.grammarFile).toBeUndefined();
    });

    it("loads multiple agents in one call", () => {
        writeSandboxAgent(sandbox, "alpha", {
            "manifest.json": JSON.stringify({
                emojiChar: "⭐",
                description: "Alpha",
                schema: {
                    description: "Alpha schema",
                    schemaType: "AlphaAction",
                    schemaFile: "./schema.ts",
                },
            }),
            "schema.ts": "export type AlphaAction = { actionName: 'a' };",
        });
        writeSandboxAgent(sandbox, "beta", {
            "manifest.json": JSON.stringify({
                emojiChar: "🅱️",
                description: "Beta",
                schema: {
                    description: "Beta schema",
                    schemaType: "BetaAction",
                    schemaFile: "./schema.pas.json",
                },
            }),
            "schema.pas.json": JSON.stringify({
                version: 1,
                entry: {},
                types: {},
            }),
        });

        const { provider, schemaNames } = loadSandboxProvider(sandbox);
        expect(schemaNames.sort()).toEqual(["alpha", "beta"]);
        expect(provider.getActionConfigs().map((c) => c.schemaName).sort()).toEqual([
            "alpha",
            "beta",
        ]);
    });

    it("throws when sandbox/agents/ is missing", () => {
        // sandbox exists but agents/ does not.
        expect(() => loadSandboxProvider(sandbox)).toThrow(/does not exist/);
    });

    it("throws when manifest references a missing schema file", () => {
        const manifest = {
            emojiChar: "⭐",
            description: "Alpha",
            schema: {
                description: "Alpha schema",
                schemaType: "AlphaAction",
                schemaFile: "./missing.ts",
            },
        };
        writeSandboxAgent(sandbox, "alpha", {
            "manifest.json": JSON.stringify(manifest),
            // No missing.ts
        });

        expect(() => loadSandboxProvider(sandbox)).toThrow(
            /missing schema file/i,
        );
    });

    it("silently skips directories under agents/ without a manifest.json", () => {
        // Directory present but no manifest — should be skipped.
        fs.mkdirSync(path.join(sandbox, "agents", "scratch"), {
            recursive: true,
        });
        // Plus a valid agent.
        writeSandboxAgent(sandbox, "alpha", {
            "manifest.json": JSON.stringify({
                emojiChar: "⭐",
                description: "Alpha",
                schema: {
                    description: "Alpha schema",
                    schemaType: "AlphaAction",
                    schemaFile: "./schema.ts",
                },
            }),
            "schema.ts": "x",
        });

        const { schemaNames } = loadSandboxProvider(sandbox);
        expect(schemaNames).toEqual(["alpha"]);
    });
});

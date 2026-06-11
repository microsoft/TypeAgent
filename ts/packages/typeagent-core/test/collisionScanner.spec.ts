// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import os from "node:os";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import {
    createRepoGrammarScanner,
    schemaNameFromGrammarFile,
} from "../src/collisions/scanner.js";

describe("schemaNameFromGrammarFile", () => {
    it("strips the .ag.json extension", () => {
        expect(schemaNameFromGrammarFile("/a/b/player.ag.json")).toBe("player");
    });

    it("strips a trailing Schema suffix", () => {
        expect(schemaNameFromGrammarFile("/a/b/playerSchema.ag.json")).toBe(
            "player",
        );
    });

    it("leaves names without the Schema suffix intact", () => {
        expect(schemaNameFromGrammarFile("calendar.ag.json")).toBe("calendar");
    });
});

describe("createRepoGrammarScanner", () => {
    it("skips agents with no compiled grammar on disk", async () => {
        const scanner = createRepoGrammarScanner({ repoRoot: os.tmpdir() });
        const report = await scanner({ agents: ["definitely-not-an-agent"] });

        expect(report.scanned).toEqual([]);
        expect(report.collisions).toEqual([]);
        expect(report.skipped).toEqual([
            {
                schemaName: "definitely-not-an-agent",
                agentName: "definitely-not-an-agent",
                reason: "no-grammar",
            },
        ]);
    });

    it("distinguishes grammar-not-built (has .agr source, no compiled output) from no-grammar, and reports compilability", async () => {
        const repoRoot = await fs.mkdtemp(
            path.join(os.tmpdir(), "collision-scan-"),
        );
        try {
            const agentsDir = path.join(repoRoot, "packages", "agents");

            // Agent with .agr source AND a grammar-compile script → buildable.
            const buildable = path.join(agentsDir, "buildable");
            await fs.mkdir(path.join(buildable, "src"), { recursive: true });
            await fs.writeFile(
                path.join(buildable, "src", "buildableSchema.agr"),
                "// grammar source",
            );
            await fs.writeFile(
                path.join(buildable, "package.json"),
                JSON.stringify({
                    name: "buildable-agent",
                    scripts: { "agc:all": "agc ..." },
                }),
            );

            // Agent with .agr source but NO compile script → not buildable.
            const sourceOnly = path.join(agentsDir, "sourceonly");
            await fs.mkdir(path.join(sourceOnly, "src"), { recursive: true });
            await fs.writeFile(
                path.join(sourceOnly, "src", "sourceonlySchema.agr"),
                "// grammar source",
            );
            await fs.writeFile(
                path.join(sourceOnly, "package.json"),
                JSON.stringify({
                    name: "sourceonly-agent",
                    scripts: { build: "tsc -b" },
                }),
            );

            // Agent with neither source nor compiled grammar (chat-style).
            await fs.mkdir(path.join(agentsDir, "chatlike", "src"), {
                recursive: true,
            });

            const scanner = createRepoGrammarScanner({ repoRoot });
            const report = await scanner({
                agents: ["buildable", "sourceonly", "chatlike"],
            });

            expect(report.skipped).toEqual([
                {
                    schemaName: "buildable",
                    agentName: "buildable",
                    reason: "grammar-not-built",
                    compilable: true,
                },
                {
                    schemaName: "sourceonly",
                    agentName: "sourceonly",
                    reason: "grammar-not-built",
                    compilable: false,
                },
                {
                    schemaName: "chatlike",
                    agentName: "chatlike",
                    reason: "no-grammar",
                },
            ]);
        } finally {
            await fs.rm(repoRoot, { recursive: true, force: true });
        }
    });

    it("resolves agents from additional agentRoots (e.g. a sibling agents dir)", async () => {
        const repoRoot = await fs.mkdtemp(
            path.join(os.tmpdir(), "collision-scan-"),
        );
        try {
            // An agent that lives OUTSIDE packages/agents — in a second root.
            const extraRoot = path.join(repoRoot, "external", "agents");
            const ext = path.join(extraRoot, "extagent", "src");
            await fs.mkdir(ext, { recursive: true });
            await fs.writeFile(
                path.join(ext, "extagentSchema.agr"),
                "// grammar source",
            );
            await fs.writeFile(
                path.join(extraRoot, "extagent", "package.json"),
                JSON.stringify({
                    name: "extagent",
                    scripts: { "agc:all": "agc ..." },
                }),
            );

            const scanner = createRepoGrammarScanner({
                repoRoot,
                agentRoots: [
                    path.join(repoRoot, "packages", "agents"),
                    extraRoot,
                ],
            });
            const report = await scanner({ agents: ["extagent"] });

            // Found via the second root → reported (not "no-grammar" absent).
            expect(report.skipped).toEqual([
                {
                    schemaName: "extagent",
                    agentName: "extagent",
                    reason: "grammar-not-built",
                    compilable: true,
                },
            ]);
        } finally {
            await fs.rm(repoRoot, { recursive: true, force: true });
        }
    });
});

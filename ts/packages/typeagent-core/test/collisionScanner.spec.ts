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

    it("distinguishes grammar-not-built (has .agr source, no compiled output) from no-grammar", async () => {
        const repoRoot = await fs.mkdtemp(
            path.join(os.tmpdir(), "collision-scan-"),
        );
        try {
            // Agent with an authored .agr source but no compiled .ag.json.
            const unbuilt = path.join(
                repoRoot,
                "packages",
                "agents",
                "unbuilt",
                "src",
            );
            await fs.mkdir(unbuilt, { recursive: true });
            await fs.writeFile(
                path.join(unbuilt, "unbuiltSchema.agr"),
                "// grammar source",
            );
            // Agent with neither source nor compiled grammar (chat-style).
            await fs.mkdir(
                path.join(repoRoot, "packages", "agents", "chatlike", "src"),
                { recursive: true },
            );

            const scanner = createRepoGrammarScanner({ repoRoot });
            const report = await scanner({
                agents: ["unbuilt", "chatlike"],
            });

            expect(report.skipped).toEqual([
                {
                    schemaName: "unbuilt",
                    agentName: "unbuilt",
                    reason: "grammar-not-built",
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
});

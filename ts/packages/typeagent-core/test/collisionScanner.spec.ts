// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import os from "node:os";
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
            { schemaName: "definitely-not-an-agent", reason: "no-grammar" },
        ]);
    });
});

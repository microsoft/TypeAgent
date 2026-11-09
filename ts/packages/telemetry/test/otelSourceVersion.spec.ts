// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import {
    resolveTypeAgentSourceVersion,
    type GitVersionReader,
} from "../src/otel/sourceVersion.js";

describe("resolveTypeAgentSourceVersion", () => {
    it("records the local commit and official merge-base", async () => {
        const calls: string[][] = [];
        const readVersion: GitVersionReader = async (args) => {
            calls.push([...args]);
            return args[0] === "rev-parse" ? "local-commit" : "official-commit";
        };

        await expect(
            resolveTypeAgentSourceVersion(readVersion),
        ).resolves.toEqual({
            headRevision: "local-commit",
            baseRevision: "official-commit",
        });
        expect(calls).toEqual([
            ["rev-parse", "HEAD"],
            ["merge-base", "HEAD", "origin/main"],
        ]);
    });

    it("omits source versions that are unavailable", async () => {
        const readVersion: GitVersionReader = async (args) =>
            args[0] === "rev-parse" ? "local-commit" : undefined;

        await expect(
            resolveTypeAgentSourceVersion(readVersion),
        ).resolves.toEqual({
            headRevision: "local-commit",
        });
    });
});

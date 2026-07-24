// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { afterEach, beforeEach, describe, expect, it } from "@jest/globals";
import { mkdir, mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { validateAndFormatLocations } from "../src/citationFormatter.js";
import type { RepositoryObservation } from "../src/script/repositoryApi.js";

describe("citation formatter", () => {
    let fixtureRoot: string;
    let repoRoot: string;

    beforeEach(async () => {
        fixtureRoot = await mkdtemp(
            path.join(os.tmpdir(), "typeagent-citation-formatter-"),
        );
        repoRoot = path.join(fixtureRoot, "repo");
        await mkdir(path.join(repoRoot, "src"), { recursive: true });
        repoRoot = await realpath(repoRoot);
        const content = Array.from(
            { length: 20 },
            (_, index) => `line ${index + 1}`,
        ).join("\n");
        await Promise.all([
            writeFile(path.join(repoRoot, "src", "target.ts"), content),
            writeFile(path.join(repoRoot, "src", "other.ts"), content),
        ]);
    });

    afterEach(async () => {
        await rm(fixtureRoot, { recursive: true, force: true });
    });

    it("rejects a grep-only citation despite an unrelated read", async () => {
        await expect(
            format(
                [{ path: "src/target.ts", startLine: 3, endLine: 5 }],
                [
                    observation("read", "src/other.ts", 1, 10),
                    observation("grep", "src/target.ts", 3, 5),
                ],
            ),
        ).rejects.toThrow("no matching observed range from read");
    });

    it("rejects two citations when only one was read", async () => {
        await expect(
            format(
                [
                    { path: "src/target.ts", startLine: 1, endLine: 2 },
                    { path: "src/other.ts", startLine: 7, endLine: 8 },
                ],
                [observation("read", "src/target.ts", 1, 2)],
            ),
        ).rejects.toThrow("src/other.ts:7-8");
    });

    it("accepts multiple citations when every range was read", async () => {
        await expect(
            format(
                [
                    { path: "src/target.ts", startLine: 1, endLine: 2 },
                    { path: "src/other.ts", startLine: 7, endLine: 8 },
                ],
                [
                    observation("read", "src/target.ts", 1, 2),
                    observation("read", "src/other.ts", 7, 8),
                ],
            ),
        ).resolves.toEqual({
            text: "src/target.ts:1-2\nsrc/other.ts:7-8",
            citationCount: 2,
            truncated: false,
        });
    });

    it("accepts a citation covered by adjacent read ranges", async () => {
        await expect(
            format(
                [{ path: "src/target.ts", startLine: 2, endLine: 6 }],
                [
                    observation("read", "src/target.ts", 4, 6),
                    observation("read", "src/target.ts", 2, 3),
                ],
            ),
        ).resolves.toMatchObject({ text: "src/target.ts:2-6" });
    });

    it("rejects a gap between read ranges even when grep covers it", async () => {
        await expect(
            format(
                [{ path: "src/target.ts", startLine: 2, endLine: 6 }],
                [
                    observation("read", "src/target.ts", 2, 3),
                    observation("grep", "src/target.ts", 4, 4),
                    observation("read", "src/target.ts", 5, 6),
                ],
            ),
        ).rejects.toThrow("Invalid grounded location");
    });

    function format(locations: unknown, observations: RepositoryObservation[]) {
        return validateAndFormatLocations(
            locations,
            repoRoot,
            10,
            10_000,
            observations,
        );
    }
});

function observation(
    source: RepositoryObservation["source"],
    relativePath: string,
    startLine: number,
    endLine: number,
): RepositoryObservation {
    return {
        source,
        callIndex: 0,
        path: relativePath,
        startLine,
        endLine,
        lines: Array.from(
            { length: endLine - startLine + 1 },
            (_, index) => `line ${startLine + index}`,
        ),
    };
}

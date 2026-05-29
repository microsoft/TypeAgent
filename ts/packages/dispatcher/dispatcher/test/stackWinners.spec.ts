// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import {
    _clearRegistryForTest,
    registerLever,
    type LeverPlugin,
} from "../src/neighborhoods/optimize/registry.js";
import { stackWinners } from "../src/neighborhoods/optimize/stackWinners.js";
import { snapshotSandboxOriginal } from "../src/neighborhoods/optimize/sandboxRevert.js";
import type {
    AttemptRecord,
    CaseResult,
    Hypothesis,
} from "../src/neighborhoods/optimize/types.js";

function tmpdir(): string {
    return fs.mkdtempSync(path.join(os.tmpdir(), "typeagent-stack-"));
}

function writeAgent(
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

function hypothesis(id: string, lever: string): Hypothesis {
    return {
        id,
        lever,
        depth: 0,
        rationale: { free: "" },
        mechanism: "widen-identity",
        guidelineHook: null,
        diffSummary: {
            addedLines: 0,
            removedLines: 0,
            touchesIdentityLine: false,
            addsAntiExample: false,
        },
        payload: { tag: id },
    };
}

function caseResultWith(
    attemptId: string,
    lever: string,
    neighborhoodId: string,
    schemas: string[],
): CaseResult {
    const winner: AttemptRecord = {
        hypothesis: hypothesis(attemptId, lever),
        evaluation: {
            schemaVersion: 1,
            probeType: "translator",
            rescues: 0,
            regressions: 0,
            netDelta: 0,
            score: 1,
            regressionPhrases: [],
        },
        artifactPath: `/${attemptId}`,
    };
    return {
        case: {
            schemaVersion: 1,
            neighborhoodId,
            members: schemas.map((s) => ({
                schemaName: s,
                actionName: "act",
            })),
            severityTier: "leaky",
            failurePattern: "similar-verb",
            failurePatternHeuristic: "similar-verb",
            misroutePhrases: [],
            cleanPhrases: [],
            reverseDirectionPhrases: [],
            currentJSDoc: {},
            currentManifestDescriptions: {},
            currentPasDescriptions: {},
            originalChecksum: { "player:schema": "abc" },
        },
        attempts: [winner],
        winner,
    };
}

function caseResultWithout(neighborhoodId: string): CaseResult {
    return {
        case: {
            schemaVersion: 1,
            neighborhoodId,
            members: [],
            severityTier: "leaky",
            failurePattern: "unclassified",
            failurePatternHeuristic: "unclassified",
            misroutePhrases: [],
            cleanPhrases: [],
            reverseDirectionPhrases: [],
            currentJSDoc: {},
            currentManifestDescriptions: {},
            currentPasDescriptions: {},
            originalChecksum: {},
        },
        attempts: [],
        winner: null,
    };
}

describe("stackWinners", () => {
    let sandbox: string;

    beforeEach(() => {
        sandbox = tmpdir();
        _clearRegistryForTest();
        writeAgent(sandbox, "player", {
            "manifest.json": "{}",
            "schema.ts": "x",
        });
        snapshotSandboxOriginal(sandbox);
    });

    afterEach(() => {
        fs.rmSync(sandbox, { recursive: true, force: true });
        _clearRegistryForTest();
    });

    it("writes proposalsApplied.json with applied + skipped entries", async () => {
        const trackingLever: LeverPlugin = {
            name: "tracking",
            description: "stub",
            consumes: ["neighborhoods"],
            probeType: "translator",
            async proposeHypotheses() {
                return [];
            },
            async applyToSandbox(h) {
                // Touch a file to verify apply ran.
                fs.writeFileSync(
                    path.join(sandbox, "agents", "player", "applied.txt"),
                    h.id,
                );
                return {
                    filesWritten: [
                        path.join(sandbox, "agents", "player", "applied.txt"),
                    ],
                };
            },
        };
        registerLever(trackingLever);

        const cases = [
            caseResultWith("h01-tracking", "tracking", "nbh-b", ["player"]),
            caseResultWithout("nbh-empty"),
            caseResultWith("h02-tracking", "tracking", "nbh-a", ["player"]),
        ];
        const journal = await stackWinners({
            sandboxDir: sandbox,
            runId: "test-run",
            caseResults: cases,
            sourceProvider: {} as any,
        });
        expect(journal.applied).toHaveLength(2);
        expect(journal.skipped).toHaveLength(1);
        expect(journal.skipped[0]!.caseId).toBe("nbh-empty");

        const file = path.join(sandbox, "proposalsApplied.json");
        expect(fs.existsSync(file)).toBe(true);
        const parsed = JSON.parse(fs.readFileSync(file, "utf-8"));
        expect(parsed.schemaVersion).toBe(1);
        expect(parsed.runId).toBe("test-run");
        expect(parsed.applied).toHaveLength(2);
    });

    it("applies winners in deterministic order (caseId then attemptId)", async () => {
        const order: string[] = [];
        registerLever({
            name: "tracking",
            description: "stub",
            consumes: ["neighborhoods"],
            probeType: "translator",
            async proposeHypotheses() {
                return [];
            },
            async applyToSandbox(h) {
                order.push(h.id);
                return { filesWritten: [] };
            },
        });
        const cases = [
            // caseId "nbh-z" + attemptId "h02-tracking"
            caseResultWith("h02-tracking", "tracking", "nbh-z", ["player"]),
            // caseId "nbh-a" + attemptId "h05-tracking"
            caseResultWith("h05-tracking", "tracking", "nbh-a", ["player"]),
            // caseId "nbh-a" + attemptId "h01-tracking" — same case as
            // above, sorts before h05.
            caseResultWith("h01-tracking", "tracking", "nbh-a", ["player"]),
        ];
        await stackWinners({
            sandboxDir: sandbox,
            runId: "x",
            caseResults: cases,
            sourceProvider: {} as any,
        });
        // Sorted by neighborhoodId then attemptId.
        expect(order).toEqual(["h01-tracking", "h05-tracking", "h02-tracking"]);
    });

    it("throws when an unregistered lever is referenced", async () => {
        const cases = [
            caseResultWith("h01-nonexistent", "nonexistent", "nbh-a", [
                "player",
            ]),
        ];
        await expect(
            stackWinners({
                sandboxDir: sandbox,
                runId: "x",
                caseResults: cases,
                sourceProvider: {} as any,
            }),
        ).rejects.toThrow(/not registered/);
    });

    it("reverts sandbox to .original before applying", async () => {
        // Mutate a sandbox file BEFORE stack runs — stack should revert
        // it back to the original "x" content (per the snapshot above).
        const schemaPath = path.join(sandbox, "agents", "player", "schema.ts");
        fs.writeFileSync(schemaPath, "mutated content");

        registerLever({
            name: "checkstate",
            description: "stub",
            consumes: ["neighborhoods"],
            probeType: "translator",
            async proposeHypotheses() {
                return [];
            },
            async applyToSandbox() {
                // Apply is called after the revert; the file should be
                // back to "x" at this point.
                const current = fs.readFileSync(schemaPath, "utf-8");
                expect(current).toBe("x");
                return { filesWritten: [] };
            },
        });

        const cases = [
            caseResultWith("h01-checkstate", "checkstate", "nbh-a", ["player"]),
        ];
        await stackWinners({
            sandboxDir: sandbox,
            runId: "x",
            caseResults: cases,
            sourceProvider: {} as any,
        });
    });

    it("propagates apply errors with context", async () => {
        registerLever({
            name: "boom",
            description: "stub",
            consumes: ["neighborhoods"],
            probeType: "translator",
            async proposeHypotheses() {
                return [];
            },
            async applyToSandbox() {
                throw new Error("synthetic apply failure");
            },
        });
        const cases = [caseResultWith("h01-boom", "boom", "nbh-x", ["player"])];
        await expect(
            stackWinners({
                sandboxDir: sandbox,
                runId: "x",
                caseResults: cases,
                sourceProvider: {} as any,
            }),
        ).rejects.toThrow(/synthetic apply failure/);
    });
});

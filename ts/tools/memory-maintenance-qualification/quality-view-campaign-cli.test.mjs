// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import test from "node:test";
import assert from "node:assert/strict";
import { mkdir, writeFile, readFile, rm, symlink } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { identity, sha256 } from "./quality-contract.mjs";
import {
    campaignContract,
    campaignSchedule,
} from "./quality-view-campaign.mjs";
import { main, ownershipMarker } from "./quality-view-campaign-cli.mjs";

function capture() {
    const output = { stdout: "", stderr: "" };
    return {
        output,
        stdout: {
            write: (s) => {
                output.stdout += s;
            },
        },
        stderr: {
            write: (s) => {
                output.stderr += s;
            },
        },
    };
}

async function localFiles(t) {
    const name = `.quality-campaign-test-${randomUUID()}`;
    const root = path.join(process.cwd(), name);
    await mkdir(root);
    t.after(() => rm(root, { recursive: true, force: true }));
    const h = sha256("");
    const construction = {
        schemaVersion: 1,
        purpose: "construction-only",
        dataset: "original",
        release: {
            repository: "original",
            revision: "v1",
            files: [{ path: "authored.json", sha256: h }],
            license: "MIT",
        },
        bundles: [
            {
                id: "case",
                kind: "wiki",
                query: "Scope",
                aliases: [],
                sources: [],
            },
        ],
    };
    const campaign = {
        schemaVersion: 1,
        contract: campaignContract,
        id: "campaign",
        constructionHash: identity(construction),
        dataset: "original",
        phase: "development",
        seed: "seed",
        exclusions: [],
        inventory: [
            {
                id: "case",
                clusters: {
                    source: [],
                    topic: ["topic"],
                    project: [],
                    meeting: [],
                },
            },
        ],
        thresholds: null,
    };
    const run = {
        schemaVersion: 1,
        campaignHash: identity(campaign),
        id: "run",
        startedAt: "2026-11-07T12:00:00Z",
        permissionRecordHash: h,
        caseIds: ["case"],
        generations: 1,
        arms: [
            {
                id: "arm",
                execution: "live",
                sourceCommit: "a".repeat(40),
                patchHash: h,
                configurationHash: h,
                providerSettingsHash: h,
                promptHash: h,
                schemaHash: h,
                indexHash: h,
                eligibleSourcesHash: h,
                nodeVersion: "24",
                provider: "test-provider",
                model: "test-model",
                indexGeneration: "1",
                configurationIdentity: "test",
            },
        ],
        budget: { calls: 0, tokens: 0, cost: 0 },
    };
    const mapping = {
        schemaVersion: 1,
        constructionHash: identity(construction),
        records: [],
    };
    const outputs = {
        schemaVersion: 1,
        runHash: identity(run),
        mappingHash: identity(mapping),
        records: [
            {
                ...campaignSchedule(run)[0],
                status: "missing",
                stage: "capture",
                component: "runner",
                reason: "Not executed",
                targetDisposition: "unknown",
                targetViewId: "page",
                saved: null,
                rendered: null,
                serializedRequest: null,
                hashes: {
                    savedHash: null,
                    renderedHash: null,
                    serializedRequestHash: null,
                },
                selectedEvidence: [],
                citationResolutions: [],
                telemetry: {
                    calls: null,
                    tokens: null,
                    reservations: null,
                    latencyMs: null,
                    cost: null,
                },
            },
        ],
    };
    const gold = {
        schemaVersion: 1,
        constructionHash: identity(construction),
        cases: [{ id: "case", expectations: [] }],
    };
    const review = {
        status: "approved-independent-human-review",
        constructionHash: identity(construction),
        goldHash: identity(gold),
        author: "author",
        reviewer: "human",
        reviewedAt: "2026-11-07T11:00:00Z",
    };
    const annotations = {
        schemaVersion: 1,
        runHash: identity(run),
        goldHash: identity(gold),
        records: [],
    };
    const inputs = {
        construction,
        campaign,
        run,
        outputs,
        mapping,
        gold,
        review,
        annotations,
    };
    await Promise.all(
        Object.entries(inputs).map(([key, value]) =>
            writeFile(path.join(root, `${key}.json`), JSON.stringify(value)),
        ),
    );
    await writeFile(
        path.join(root, ownershipMarker),
        JSON.stringify({
            schemaVersion: 1,
            purpose: "quality-view-campaign",
            ownerId: "test",
        }),
    );
    const args = (command, out = "report.json") => [
        command,
        "--root",
        name,
        ...[
            "construction",
            "campaign",
            "run",
            "outputs",
            "mapping",
            ...(command === "score" ? ["gold", "review", "annotations"] : []),
        ].flatMap((key) => [`--${key}`, `${key}.json`]),
        "--out",
        out,
    ];
    return { root, name, args };
}

test("help works offline without filesystem access", async () => {
    const io = capture();
    assert.equal(
        await main(["--help"], { cwd: "nonexistent-project", ...io }),
        0,
    );
    assert.match(io.output.stdout, /no network, models or credentials/);
    assert.equal(io.output.stderr, "");
});

test("validate and score only explicit project-local inputs; no overwrite", async (t) => {
    const f = await localFiles(t);
    const io = capture();
    assert.equal(await main(f.args("validate"), io), 0);
    const validation = JSON.parse(
        await readFile(path.join(f.root, "report.json"), "utf8"),
    );
    assert.equal(validation.semanticQualityEvaluated, false);
    const original = await readFile(path.join(f.root, "report.json"), "utf8");
    assert.equal(await main(f.args("validate"), io), 1);
    assert.match(io.output.stderr, /refusing overwrite/);
    assert.equal(
        await readFile(path.join(f.root, "report.json"), "utf8"),
        original,
    );
    assert.equal(await main(f.args("score", "score.json"), io), 0);
    const score = JSON.parse(
        await readFile(path.join(f.root, "score.json"), "utf8"),
    );
    assert.equal(score.arms.arm.gate.status, "failed");
    assert.equal(score.arms.arm.telemetry.cost.knownTotal, null);
});

test("requires ownership, relative paths and explicit evaluator arguments", async (t) => {
    const f = await localFiles(t);
    const cases = [
        {
            args: f
                .args("validate")
                .map((s) => (s === f.name ? path.resolve(f.name) : s)),
            error: /Project-relative/,
        },
        {
            args: f
                .args("validate")
                .map((s) =>
                    s === "construction.json" ? "..\\construction.json" : s,
                ),
            error: /Unsafe/,
        },
        {
            args: f
                .args("validate")
                .map((s) =>
                    s === "construction.json"
                        ? "quality-fixtures\\construction.json"
                        : s,
                ),
            error: /Unsafe/,
        },
        {
            args: f
                .args("validate")
                .map((s) =>
                    s === "construction.json"
                        ? "holdout\\construction.json"
                        : s,
                ),
            error: /Unsafe/,
        },
        {
            args: f
                .args("validate")
                .map((s) => (s === "construction.json" ? ".npmrc" : s)),
            error: /Unsafe/,
        },
        {
            args: f
                .args("validate")
                .map((s) => (s === "construction.json" ? ".npmrc " : s)),
            error: /Unsafe/,
        },
        {
            args: f
                .args("validate")
                .map((s) => (s === "construction.json" ? "NUL.json" : s)),
            error: /Unsafe/,
        },
        {
            args: [...f.args("validate"), "--gold", "gold.json"],
            error: /Unknown CLI flag/,
        },
        { args: ["score", "--root", f.name], error: /Missing --construction/ },
        {
            args: [...f.args("validate"), "--out", "duplicate.json"],
            error: /Duplicate flag/,
        },
    ];
    for (const row of cases) {
        const io = capture();
        assert.equal(await main(row.args, io), 1);
        assert.match(io.output.stderr, row.error);
    }
    await rm(path.join(f.root, ownershipMarker));
    assert.equal(await main(f.args("validate"), capture()), 1);
});

test("validate and score reject offline evaluation arms", async (t) => {
    const f = await localFiles(t);
    const runPath = path.join(f.root, "run.json");
    const run = JSON.parse(await readFile(runPath, "utf8"));
    run.arms[0].execution = "offline-injected";
    await writeFile(runPath, JSON.stringify(run));
    for (const command of ["validate", "score"]) {
        const io = capture();
        assert.equal(await main(f.args(command), io), 1);
        assert.match(
            io.output.stderr,
            /Quality evaluation requires live execution/,
        );
    }
});

test("symlink and junction traversal is refused", async (t) => {
    const f = await localFiles(t);
    const link = path.join(f.root, "linked");
    await symlink(
        f.root,
        link,
        process.platform === "win32" ? "junction" : "dir",
    );
    const io = capture();
    assert.equal(
        await main(
            f
                .args("validate")
                .map((s) =>
                    s === "construction.json" ? "linked\\construction.json" : s,
                ),
            io,
        ),
        1,
    );
    assert.match(io.output.stderr, /Symlink\/junction/);
});

test("validate-example reads exact runner files under its existing ownership marker", async (t) => {
    const f = await localFiles(t);
    const construction = JSON.parse(
        await readFile(path.join(f.root, "construction.json"), "utf8"),
    );
    const sourceText = "Grounded scope.";
    construction.bundles[0].sources = [
        {
            id: "dataset-source",
            version: "v1",
            title: "Scope note",
            text: sourceText,
            sha256: sha256(sourceText),
        },
    ];
    const citation = {
        sourceId: "actual-source",
        revisionId: "actual-revision",
        locator: `indexed:0:${sha256(sourceText)}:0-${sourceText.length}`,
        excerpt: sourceText,
    };
    const content = {
        kind: "wiki",
        construction: "informational-wiki-v1",
        title: "Scope",
        summary: sourceText,
        citations: [citation],
        index: [{ pageId: "page", title: "Scope", taxonomy: "concept" }],
        sections: [
            {
                id: "page",
                role: "page",
                heading: "Scope",
                body: sourceText,
                details: {
                    kind: "page",
                    construction: "informational-wiki-v1",
                    taxonomy: "concept",
                    note: "",
                    mergedPageIds: [],
                },
            },
        ],
    };
    const saved = JSON.stringify({
        corpusId: "corpus",
        viewId: "page",
        revisionId: "view-revision",
        version: 1,
        content,
    });
    const requests = JSON.stringify([
        {
            corpusId: "corpus",
            pipeline: "informational-wiki-v1",
            definition: { viewId: "page", kind: "wiki" },
            inputs: [
                {
                    sourceId: citation.sourceId,
                    revisionId: citation.revisionId,
                    contentHash: sha256("source-descriptor"),
                    passages: [citation],
                },
            ],
        },
    ]);
    const mapping = [
        {
            caseId: "case",
            dataset: "original",
            datasetSourceId: "dataset-source",
            sourceVersion: "v1",
            retainedSha256: sha256(sourceText),
            corpusId: "corpus",
            sourceId: citation.sourceId,
            revisionId: citation.revisionId,
            contentHash: sha256(sourceText),
            receipt: { state: "complete" },
        },
    ];
    const receipt = {
        schemaVersion: 1,
        mode: "offline",
        status: "ok",
        qualityBaseline: false,
        requestEvidenceKind: "indexed-build-snapshot",
        caseId: "case",
        inputHash: identity(construction.bundles[0]),
        corpusId: "corpus",
        revisionId: "view-revision",
        savedHash: sha256(`${saved}\n`),
        renderedHash: sha256(`Scope\n${sourceText}\n`),
        requestHash: sha256(`${requests}\n`),
    };
    const files = {
        "construction.json": JSON.stringify(construction),
        "saved.json": `${saved}\n`,
        "rendered.txt": `Scope\n${sourceText}\n`,
        "request-evidence.json": `${requests}\n`,
        "source-mapping.json": JSON.stringify(mapping),
        "receipt.json": JSON.stringify(receipt),
        ".wiki-views-owned.json": JSON.stringify({
            schemaVersion: 1,
            owner: "wiki-views",
        }),
    };
    await Promise.all(
        Object.entries(files).map(([name, value]) =>
            writeFile(path.join(f.root, name), value),
        ),
    );
    const args = [
        "validate-example",
        "--root",
        f.name,
        "--construction",
        `${f.name}\\construction.json`,
        "--receipt",
        "receipt.json",
        "--saved",
        "saved.json",
        "--rendered",
        "rendered.txt",
        "--source-mapping",
        "source-mapping.json",
        "--request-evidence",
        "request-evidence.json",
        "--out",
        "diagnostics.json",
    ];
    const io = capture();
    assert.equal(await main(args, io), 0, io.output.stderr);
    const result = JSON.parse(
        await readFile(path.join(f.root, "diagnostics.json"), "utf8"),
    );
    assert.equal(result.productionQualityEligible, false);
    assert.equal(result.serializedRequest, null);
    assert.equal(result.telemetry.tokens, null);
    assert.equal(await main(args, io), 1);
    assert.match(io.output.stderr, /refusing overwrite/);
});

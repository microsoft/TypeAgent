// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";

export const fixtureRoot = new URL("./quality-fixtures/", import.meta.url);
export const frozenManifestHash =
    "5cc1a0c51a8feadf26028c8e4bb4207b5bbfee0cb604242c2ed1658a8ca63f77";

export const sha256 = (value) =>
    createHash("sha256").update(value).digest("hex");
export const identity = (value) => sha256(JSON.stringify(value));
export const clone = (value) => structuredClone(value);
export const check = (condition, message) => assert.ok(condition, message);
export function text(value, name) {
    check(
        typeof value === "string" && value.trim().length > 0,
        `${name}: required text`,
    );
    return value;
}
export function hash(value, name) {
    check(
        typeof value === "string" && /^[a-f0-9]{64}$/.test(value),
        `${name}: SHA-256 required`,
    );
    return value;
}
export function unique(rows, key, name) {
    check(Array.isArray(rows), `${name}: array required`);
    const result = new Map();
    for (const row of rows) {
        const id = text(row[key], `${name}.${key}`);
        check(!result.has(id), `${name}: duplicate ${id}`);
        result.set(id, row);
    }
    return result;
}
export const ratio = (numerator, denominator) => ({
    numerator,
    denominator,
    value: denominator === 0 ? null : numerator / denominator,
});

export async function readJson(filename) {
    return JSON.parse(
        (await readFile(filename, "utf8")).replace(/^\uFEFF/, ""),
    );
}

export async function loadFrozenFixtures() {
    const bytes = await readFile(new URL("manifest.json", fixtureRoot));
    check(sha256(bytes) === frozenManifestHash, "Frozen manifest changed");
    const manifest = JSON.parse(bytes);
    const files = {};
    for (const [name, expected] of Object.entries(manifest.files)) {
        const content = await readFile(new URL(name, fixtureRoot));
        check(sha256(content) === expected, `Frozen fixture changed: ${name}`);
        files[name] = JSON.parse(content);
    }
    const contract = files["contract.json"];
    const bundles = files["construction.json"].bundles;
    const gold = files["evaluator-only.json"];
    const bundleMap = unique(bundles, "id", "bundles");
    const goldMap = unique(gold.cases, "id", "gold");
    check(
        bundleMap.size === 24 && goldMap.size === 24,
        "Expected 24 bundles/gold cases",
    );
    const splitIds = Object.values(manifest.splits).flat();
    check(new Set(splitIds).size === 24, "Duplicate split membership");
    for (const kind of ["wiki", "brief"]) {
        for (const split of ["development", "holdout"]) {
            const members = bundles.filter(
                (b) => b.kind === kind && b.split === split,
            );
            check(members.length === 6, `Expected six ${kind}/${split}`);
            const key = `${kind}${split === "development" ? "Development" : "Holdout"}`;
            assert.deepEqual(
                members.map((b) => b.id),
                manifest.splits[key],
            );
        }
    }
    const sourceIds = new Set();
    for (const bundle of bundles) {
        text(bundle.topic, "topic");
        const sources = unique(bundle.sources, "id", "sources");
        for (const source of sources.values()) {
            check(!sourceIds.has(source.id), "Source reused across bundles");
            sourceIds.add(source.id);
            text(source.revision, "revision");
            text(source.date, "date");
            text(source.text, "source text");
        }
        const entry = goldMap.get(bundle.id);
        check(entry, "Unknown/missing gold case");
        check(entry.expectations.length > 0, "No expectations");
        unique(entry.expectations, "id", "expectations");
        for (const expectation of entry.expectations) {
            validateWitness(expectation, bundle);
            text(expectation.requirement, "requirement");
        }
    }
    return {
        manifest,
        manifestHash: frozenManifestHash,
        contract,
        bundles,
        gold,
    };
}

export function validateWitness(witness, bundle) {
    const source = bundle.sources.find((s) => s.id === witness.sourceId);
    check(
        source && source.revision === witness.revision,
        "Unknown source/revision witness",
    );
    text(witness.quote, "witness quote");
    check(
        source.text.includes(witness.quote),
        "Witness quote absent from source",
    );
}

export function developmentPacket(frozen) {
    return {
        schemaVersion: 1,
        manifestHash: frozen.manifestHash,
        purpose:
            "Development construction only; no evaluator expectations or heldout sources",
        bundles: clone(frozen.bundles.filter((b) => b.split === "development")),
    };
}

export function validateRun(run, frozen) {
    check(
        run.schemaVersion === 1 && run.manifestHash === frozen.manifestHash,
        "Run freeze mismatch",
    );
    text(run.id, "run.id");
    check(["development", "holdout"].includes(run.split), "Invalid run split");
    const arms = unique(run.arms, "id", "arms");
    check(arms.size > 0, "No arms");
    for (const arm of arms.values()) {
        if (arm.id === "B0") {
            check(
                arm.sourceCommit === frozen.manifest.baselineCommit &&
                    arm.patchHash === sha256(""),
                "B0 must be the preserved unmodified baseline",
            );
        }
        check(
            /^[a-f0-9]{40}$/.test(arm.sourceCommit),
            "Arm source commit required",
        );
        for (const key of [
            "patchHash",
            "configurationHash",
            "providerSettingsHash",
            "promptHash",
            "schemaHash",
            "indexHash",
            "eligibleSourcesHash",
        ]) {
            hash(arm[key], `arm.${key}`);
        }
        for (const key of [
            "nodeVersion",
            "provider",
            "model",
            "indexGeneration",
            "configurationIdentity",
        ]) {
            text(arm[key], `arm.${key}`);
        }
    }
    const selected = unique(
        run.caseIds.map((id) => ({ id })),
        "id",
        "run cases",
    );
    check(selected.size > 0, "No scheduled cases");
    for (const id of selected.keys()) {
        check(
            frozen.bundles.some((b) => b.id === id && b.split === run.split),
            "Unknown case or wrong split",
        );
    }
    if (run.split === "holdout") {
        check(run.generations === 3, "Holdout requires three generations");
        assert.deepEqual(
            [...selected.keys()].sort(),
            frozen.bundles
                .filter((b) => b.split === "holdout")
                .map((b) => b.id)
                .sort(),
            "Holdout must schedule all 12 source bundles",
        );
    } else {
        check(
            Number.isSafeInteger(run.generations) && run.generations > 0,
            "Invalid generation count",
        );
    }
    hash(run.permissionRecordHash, "permissionRecordHash");
    return identity(run);
}

export function scheduled(run) {
    return run.arms.flatMap((arm) =>
        run.caseIds.flatMap((caseId) =>
            Array.from({ length: run.generations }, (_, index) => ({
                id: `${arm.id}:${caseId}:${index + 1}`,
                arm: arm.id,
                caseId,
                generation: index + 1,
            })),
        ),
    );
}

export function reviewedGold(review, frozen) {
    check(
        review?.status === "approved-independent-human-review",
        "Gold pending independent human review",
    );
    check(
        review.manifestHash === frozen.manifestHash,
        "Review freeze mismatch",
    );
    check(
        review.expectationsHash ===
            frozen.manifest.files["evaluator-only.json"],
        "Review expectation mismatch",
    );
    text(review.reviewer, "reviewer");
    check(
        review.reviewer !== review.author,
        "Gold review must be independent of author",
    );
    text(review.author, "author");
    text(review.reviewedAt, "reviewedAt");
    text(review.evidence, "review evidence");
}

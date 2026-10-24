// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import {
    assertCheckpoint,
    snapshotCompiledCheckpoint,
} from "../shared/checkpoint.mjs";
import { prepareLongMemEval } from "./adapter.js";
import {
    publicPins,
    datasetPins,
    datasetRepository,
    datasetRevision,
} from "./pins.js";
import { digest } from "./protocol.js";

const workAllowanceMs = 35 * 60 * 1000;

export const cleanupReserveMs = 5 * 60 * 1000;

const seed = "typeagent-longmemeval-full-2026-10-20";

const productFactory =
    "packages\\agentServer\\server\\dist\\durableMemoryService.js";

export async function createBenchmarkMemoryService(load, rootDirectory) {
    const { createDurableMemoryService } = await load(productFactory);
    return createDurableMemoryService(rootDirectory);
}

export function recordBenchmarkArm(state, capabilities, resume) {
    const arm = {
        name: "TypeAgent production document-backed conversation memory",
        productFactory,
        ...(capabilities.accessAdmissionPolicy
            ? { accessAdmissionPolicy: capabilities.accessAdmissionPolicy }
            : {}),
        viewModelEndpointHash: digest(
            process.env.TYPEAGENT_MEMORY_VIEW_MODEL_ENDPOINT?.trim() ?? "",
        ),
        ingestion:
            "One Markdown source per original session position; dates, roles and turn text preserved",
        answerMode: "default",
        readerProvenance:
            "Opt-in public diagnostics identify actual indexed reader fragments and selection; citations identify supplied evidence, not independent entailment.",
        answerLimit: "product-default",
        preliminarySearch: false,
        readerDate:
            "Original question date supplied to retrieval and reader as temporal metadata",
        judge: "Pinned official prompts; normal configured model and default generation settings, not official GPT-4o evaluator",
        humanGold:
            "Official LongMemEval references; no assertion of independent review of local artifact gold",
        sourceSynopses: capabilities.features.sourceSynopses,
        informationalViews:
            capabilities.derivedViews?.informationalWiki === true,
        viewDrafts: capabilities.derivedViews?.drafts === true,
    };
    if (resume)
        assert.deepEqual(
            state.arm,
            arm,
            "Product memory configuration changed",
        );
    state.arm = arm;
}

export async function benchmarkCheckpoint(productRoot) {
    const hashes = await snapshotCompiledCheckpoint(productRoot);
    for (const file of [
        productFactory,
        "packages\\agentServer\\server\\dist\\viewModelOptions.js",
    ])
        hashes[file] = digest(await readFile(path.join(productRoot, file)));
    return hashes;
}

export function validateBenchmarkSpec(spec) {
    assert.equal(
        spec.authorizedLiveBenchmark,
        true,
        "Explicit benchmark inference authorization is required",
    );
    assert.equal(spec.mode, "longmemeval-full500");
    assert.ok(
        Object.hasOwn(datasetPins, spec.variant),
        "Unknown LongMemEval variant",
    );
    assert.ok(
        Number.isSafeInteger(spec.startupAllowanceMs) &&
            spec.startupAllowanceMs >= 60000 &&
            spec.startupAllowanceMs <= 600000 &&
            spec.startupAllowanceMs % 60000 === 0,
        "Startup allowance must be an integer from 1 to 10 minutes",
    );
    assert.ok(
        spec.workAllowanceMs === null ||
            (Number.isSafeInteger(spec.workAllowanceMs) &&
                spec.workAllowanceMs > cleanupReserveMs &&
                spec.workAllowanceMs <= workAllowanceMs),
    );
    assert.equal(spec.totalAllowanceMs, spec.workAllowanceMs);
    assert.equal(typeof spec.resume, "boolean");
    assert.ok(
        spec.continueAfterImportFailure === undefined ||
            typeof spec.continueAfterImportFailure === "boolean",
    );
    if (spec.previousEngineHash !== undefined)
        assert.ok(
            spec.resume &&
                spec.continueAfterImportFailure &&
                /^[a-f0-9]{64}$/.test(spec.previousEngineHash),
        );
    assert.ok(
        Number.isSafeInteger(spec.maximumCompletedQuestions) &&
            spec.maximumCompletedQuestions > 0 &&
            spec.maximumCompletedQuestions <= 500,
        "Batch question limit must be between 1 and 500",
    );
    for (const key of [
        "productRoot",
        "datasetPath",
        "judgeSourcePath",
        "runDirectory",
    ])
        assert.ok(path.isAbsolute(spec[key]));
    assertCheckpoint(spec.expectedCheckpoint.hashes, spec.expectedCheckpoint);
}

export function benchmarkInvocationAllowance(value) {
    if (value === "unlimited") return null;
    const minutes = Number(value);
    assert.ok(
        Number.isSafeInteger(minutes) && minutes >= 1 && minutes <= 30,
        "Invocation work minutes must be an integer from 1 to 30, or unlimited",
    );
    return minutes * 60000 + cleanupReserveMs;
}

export function benchmarkStartupAllowance(value) {
    const minutes = Number(value);
    assert.ok(
        Number.isSafeInteger(minutes) && minutes >= 1 && minutes <= 10,
        "Startup minutes must be an integer from 1 to 10",
    );
    return minutes * 60000;
}

export async function engineIdentity() {
    const hashes = [];
    const visit = async (directory) => {
        for (const entry of (
            await readdir(directory, { withFileTypes: true })
        ).sort((a, b) => a.name.localeCompare(b.name, "en"))) {
            const url = new URL(
                entry.name + (entry.isDirectory() ? "/" : ""),
                directory,
            );
            if (entry.isDirectory()) await visit(url);
            else if (/\.(?:js|mjs)$/.test(entry.name))
                hashes.push([
                    url.pathname.split("/memoryBench/")[1],
                    digest(await readFile(url)),
                ]);
        }
    };
    await visit(new URL("./", import.meta.url));
    await visit(new URL("../shared/", import.meta.url));
    hashes.push([
        "cli.js",
        digest(await readFile(new URL("../cli.js", import.meta.url))),
    ]);
    hashes.push([
        "storage.js",
        digest(await readFile(new URL("../storage.js", import.meta.url))),
    ]);
    return digest(JSON.stringify(hashes));
}

export async function loadPrepared(spec) {
    const pin = datasetPins[spec.variant];
    assert.ok(pin, "Unknown LongMemEval variant");
    const bytes = await readFile(spec.datasetPath);
    assert.equal(
        digest(bytes),
        pin.sha256,
        "Pinned official dataset bytes changed",
    );
    return prepareLongMemEval(JSON.parse(bytes.toString("utf8")), {
        scope: "full500",
        historyPolicy: "official-supplied",
        seed,
        provenance: {
            ...publicPins.longMemEval,
            path: pin.filename,
            sha256: pin.sha256,
            datasetRepository,
            datasetRevision,
        },
    });
}

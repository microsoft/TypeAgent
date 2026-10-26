// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import test from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import path from "node:path";
import {
    configuredLiveOptions,
    safeFailure,
    validateLiveSpec,
    captureSynopsisAttempt,
} from "./live-qualification.mjs";
import { snapshotCompiledCheckpoint } from "./harness.mjs";

test("baseline19 synopsis capture preserves returned output before parser rejection without logging its contents", async (t) => {
    const directory = await mkdtemp(
        path.join(process.cwd(), "qualification-synopsis-capture-"),
    );
    t.after(() => rm(directory, { recursive: true, force: true }));
    const prompt = "Synthetic source prompt, retained only in owned artifacts";
    const output = '{"preview":"controlled incomplete schema"}';
    let calls = 0;
    assert.equal(
        await captureSynopsisAttempt(directory, prompt, async () => {
            calls++;
            return output;
        }),
        output,
    );
    assert.equal(calls, 1);
    assert.deepEqual(
        JSON.parse(
            await readFile(
                path.join(directory, "baseline19-synopsis-input.json"),
                "utf8",
            ),
        ),
        { prompt },
    );
    assert.deepEqual(
        JSON.parse(
            await readFile(
                path.join(directory, "baseline19-synopsis-output.json"),
                "utf8",
            ),
        ),
        { output },
    );
    const known = safeFailure(
        new Error("Invalid synopsis output fields or bounds"),
    );
    assert.equal(known.category, "Invalid synopsis output fields or bounds");
    assert.ok(!JSON.stringify(known).includes(prompt));
    assert.equal(
        safeFailure(new Error(`Private unexpected detail ${output}`)).category,
        "UNEXPECTED_FAILURE",
    );
});

test("baseline19 synopsis capture propagates provider failure without manufacturing output", async (t) => {
    const directory = await mkdtemp(
        path.join(process.cwd(), "qualification-synopsis-capture-"),
    );
    t.after(() => rm(directory, { recursive: true, force: true }));
    const failure = new Error("Controlled provider failure");
    await assert.rejects(
        captureSynopsisAttempt(directory, "Synthetic input", async () => {
            throw failure;
        }),
        (error) => error === failure,
    );
    await assert.rejects(
        readFile(path.join(directory, "baseline19-synopsis-output.json")),
        { code: "ENOENT" },
    );
});

test("live configured loader keeps the existing authorization gate before role creation", async () => {
    const seen = [];
    await assert.rejects(
        configuredLiveOptions(async (file) => {
            seen.push(file);
            if (file.includes("config")) return { loadConfigSync() {} };
            if (file.includes("aiclient"))
                return { initRuntimeConfigFromProcessEnv() {} };
            throw new Error("Must not create model");
        }, {}),
        /separate verified coordinator handoff/,
    );
    assert.equal(seen.length, 0);
});

test("live configured loader uses production defaults without offline adapter synthesis or validation", async () => {
    let loaded = 0;
    const adapter = {
        synthesize() {},
        validate() {},
        assessWikiConsolidation() {},
        checkWikiConsolidation() {},
    };
    const modules = {
        "packages\\config\\dist\\index.js": {
            loadConfigSync() {
                loaded++;
            },
        },
        "packages\\aiclient\\dist\\index.js": {
            initRuntimeConfigFromProcessEnv() {
                loaded++;
            },
            openai: {
                getChatModelSettings: () => ({
                    provider: "test",
                    modelName: "normal-default",
                    requestConstraints: {},
                }),
            },
        },
        "packages\\memory\\service\\dist\\knowProCorpusIndex.js": {
            createKnowProCorpusIndex() {},
        },
        "packages\\memory\\service\\dist\\viewHostOptions.js": {
            getConfiguredMemoryViewOptions: () => ({
                viewDrafts: true,
                informationalViews: true,
            }),
        },
        "packages\\memory\\service\\dist\\viewSynthesis.js": {
            createConfiguredViewSynthesisAdapter: (...args) => {
                assert.equal(args.length, 0);
                return adapter;
            },
        },
        "packages\\memory\\service\\dist\\sourceSynopsis.js": {
            configuredSourceSynopsisModel: (...args) => {
                assert.equal(args.length, 0);
                return { fits() {}, complete() {} };
            },
        },
        "packages\\memory\\service\\dist\\topicGeneration.js": {
            createConfiguredTopicGenerator: (...args) => {
                assert.equal(args.length, 0);
                return {};
            },
        },
        "packages\\memory\\conversation\\dist\\memory.js": {
            createMemorySettings: () => ({
                conversationSettings: {
                    semanticRefIndexSettings: { knowledgeExtractor: {} },
                },
                queryTranslator: {},
            }),
        },
    };
    const result = await configuredLiveOptions(
        async (file) => {
            assert.ok(modules[file], `Unknown production load ${file}`);
            return modules[file];
        },
        {
            verifiedP6: true,
            verifiedOfflinePreflight: true,
            coordinatorHandoff: true,
        },
    );
    assert.equal(loaded, 2);
    assert.equal(result.options.viewSynthesisAdapter, undefined);
    assert.equal(result.options.viewModelEndpoint, undefined);
    assert.equal(result.options.sourceSynopsisModel, undefined);
    assert.deepEqual(
        result.roleCapabilities.articlePurposeEditorialCheck,
        Object.keys(adapter),
    );
});

test("live supervisor validates a separately authorized fixed bound and cannot relabel offline specs", async () => {
    const productRoot = fileURLToPath(new URL("../../", import.meta.url));
    const expectedCheckpoint = {
        name: "actual-compiled-live-control",
        hashes: await snapshotCompiledCheckpoint(productRoot),
    };
    const spec = {
        mode: "live-configured-preflight",
        startupAllowanceMs: 120000,
        workAllowanceMs: 1200000,
        nativeProfile: false,
        resume: false,
        receiptId: "control",
        productRoot,
        fixtureRoot: fileURLToPath(
            new URL(
                "../../packages/memory/service/test/fixtures/memoryDemo/",
                import.meta.url,
            ),
        ),
        runDirectory: process.cwd(),
        authorization: {
            verifiedP6: true,
            verifiedOfflinePreflight: true,
            coordinatorHandoff: true,
        },
        expectedCheckpoint,
    };
    validateLiveSpec(spec);
    const baseline19 = {
        ...spec,
        mode: "live-configured-timeline",
        sourceScope: "baseline19",
        workAllowanceMs: 2100000,
    };
    validateLiveSpec(baseline19);
    validateLiveSpec({
        ...baseline19,
        resume: true,
        previousReceiptPath: path.join(
            baseline19.runDirectory,
            "attempt-before-resume-test",
            "live-preflight.json",
        ),
    });
    assert.throws(() =>
        validateLiveSpec({
            ...baseline19,
            resume: true,
            previousReceiptPath: path.resolve(
                baseline19.runDirectory,
                "..",
                "foreign.json",
            ),
        }),
    );
    assert.throws(() =>
        validateLiveSpec({ ...baseline19, workAllowanceMs: 1200000 }),
    );
    assert.throws(() =>
        validateLiveSpec({ ...baseline19, workAllowanceMs: 2100001 }),
    );
    for (const change of [
        { mode: "offline" },
        { workAllowanceMs: 1200001 },
        { startupAllowanceMs: 120001 },
        { resume: true },
        { nativeProfile: true },
        { authorization: {} },
    ])
        assert.throws(() => validateLiveSpec({ ...spec, ...change }));
});

test("unknown live failures remain failures and provider secrets never enter diagnostic messages", () => {
    const value = safeFailure(new Error("private-token-and-response"));
    assert.equal(value.category, "UNEXPECTED_FAILURE");
    assert.ok(!JSON.stringify(value).includes("private-token-and-response"));
    assert.equal(
        safeFailure(new Error("HTTP 429")).category,
        "CONFIGURED_PROVIDER_THROTTLE",
    );
});

test("normal synopsis admission constraints remain mandatory with no synthetic successful fallback", async () => {
    const seen = [];
    await assert.rejects(
        configuredLiveOptions(
            async (file) => {
                seen.push(file);
                if (file.includes("knowProCorpusIndex"))
                    return { createKnowProCorpusIndex() {} };
                if (file.includes("\\config\\")) return { loadConfigSync() {} };
                if (file.includes("aiclient"))
                    return {
                        initRuntimeConfigFromProcessEnv() {},
                        openai: {
                            getChatModelSettings: () => ({
                                provider: "azure",
                            }),
                        },
                    };
                if (file.includes("viewHostOptions"))
                    return { getConfiguredMemoryViewOptions: () => ({}) };
                if (file.includes("viewSynthesis"))
                    return { createConfiguredViewSynthesisAdapter: () => ({}) };
                if (file.includes("topicGeneration"))
                    return { createConfiguredTopicGenerator: () => ({}) };
                if (file.includes("conversation"))
                    return {
                        createMemorySettings: () => ({
                            conversationSettings: {
                                semanticRefIndexSettings: {
                                    knowledgeExtractor: {},
                                },
                            },
                            queryTranslator: {},
                        }),
                    };
                if (file.includes("sourceSynopsis"))
                    return {
                        configuredSourceSynopsisModel() {
                            throw new Error(
                                "Source synopsis requires configured model request constraints",
                            );
                        },
                    };
                throw new Error("Unknown loader");
            },
            {
                verifiedP6: true,
                verifiedOfflinePreflight: true,
                coordinatorHandoff: true,
            },
        ),
        /Source synopsis requires configured model request constraints/,
    );
    assert.ok(!seen.some((file) => file.includes("offline-models")));
});

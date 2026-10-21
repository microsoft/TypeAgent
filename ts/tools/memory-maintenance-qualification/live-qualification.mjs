// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { mkdtemp, readFile, realpath } from "node:fs/promises";
import { Console } from "node:console";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { parseArgs } from "node:util";
import {
    assertCheckpoint,
    loadPlan,
    snapshotCompiledCheckpoint,
    writeJson,
} from "./harness.mjs";
import { configuredRoleOptions } from "./offline-models.mjs";
import { supervise } from "./watchdog.mjs";
import {
    liveDependencyCheckpoint,
    loadLiveContract,
    observeProvider,
    runLiveStages,
    livePhases,
    liveAllowances,
} from "./live-stages.mjs";
import { reviewPacket } from "./evaluate.mjs";

const sha = (value) => createHash("sha256").update(value).digest("hex");

export function validateLiveSpec(spec) {
    assert.ok(
        ["live-configured-preflight", "live-configured-timeline"].includes(
            spec.mode,
        ),
    );
    assert.equal(spec.startupAllowanceMs, 120000);
    assert.equal(spec.workAllowanceMs, liveAllowances(spec).workAllowanceMs);
    assert.equal(spec.nativeProfile, false);
    assert.equal(spec.resume, false);
    assert.ok(
        spec.captureSynopsis === undefined ||
            typeof spec.captureSynopsis === "boolean",
        "Synopsis capture must be explicitly boolean",
    );
    livePhases(spec);
    if (spec.sourceScope !== undefined)
        assert.equal(
            spec.mode,
            "live-configured-timeline",
            "A source scope requires actual maintenance qualification",
        );
    assert.equal(spec.authorization?.verifiedP6, true);
    assert.equal(spec.authorization?.verifiedOfflinePreflight, true);
    assert.equal(spec.authorization?.coordinatorHandoff, true);
    for (const key of ["productRoot", "fixtureRoot", "runDirectory"])
        assert.ok(path.isAbsolute(spec[key]));
    assertCheckpoint(spec.expectedCheckpoint.hashes, spec.expectedCheckpoint);
    assert.ok(spec.receiptId);
}

export async function configuredLiveOptions(load, authorization) {
    const options = await configuredRoleOptions(load, authorization);
    const config = await load("packages\\config\\dist\\index.js");
    const client = await load("packages\\aiclient\\dist\\index.js");
    config.loadConfigSync();
    client.initRuntimeConfigFromProcessEnv();
    const host = await load(
        "packages\\memory\\service\\dist\\viewHostOptions.js",
    );
    Object.assign(options, host.getConfiguredMemoryViewOptions());
    assert.ok(
        options.viewDrafts !== false && options.informationalViews !== false,
        "Configured informational view capability is disabled",
    );
    const synthesis = await load(
        "packages\\memory\\service\\dist\\viewSynthesis.js",
    );
    const synopsis = await load(
        "packages\\memory\\service\\dist\\sourceSynopsis.js",
    );
    const topics = await load(
        "packages\\memory\\service\\dist\\topicGeneration.js",
    );
    const memory = await load(
        "packages\\memory\\conversation\\dist\\memory.js",
    );
    const memorySettings = memory.createMemorySettings();
    const settings = client.openai.getChatModelSettings();
    const adapter = synthesis.createConfiguredViewSynthesisAdapter();
    const roleCapabilities = {
        extraction: {
            instantiated:
                !!memorySettings.conversationSettings.semanticRefIndexSettings
                    .knowledgeExtractor,
            factory:
                "production createMemorySettings/KnowPro knowledge extractor",
        },
        query: {
            instantiated: !!memorySettings.queryTranslator,
            factory: "production createMemorySettings/KnowPro query translator",
        },
        articlePurposeEditorialCheck: Object.keys(adapter),
        topic: typeof topics.createConfiguredTopicGenerator(),
        synopsis: synopsis.configuredSourceSynopsisModel(),
    };
    return {
        options,
        client,
        adapter,
        synopsis,
        roleCapabilities,
        identity: {
            provider: settings.provider,
            model: settings.modelName,
            constraintsConfigured: !!settings.requestConstraints,
            endpointAliasesOverridden: false,
            independentRoleSchemas: true,
            roleEndpointTopology:
                "Existing production default endpoint; independent role prompts/schemas, not invented distinct deployments",
        },
    };
}

export function safeFailure(error) {
    const message = error?.message ?? "";
    const allowed = [
        "Source synopsis requires configured model request constraints",
        "Configured informational view capability is disabled",
        "Configured roles require a separate verified coordinator handoff",
        "Invalid synopsis output object",
        "Invalid synopsis output fields or bounds",
        "Invalid synopsis evidence",
        "Synopsis evidence is not an exact supplied retained UTF-16 range",
        "Synopsis evidence is ambiguous without an exact supplied range",
        "Synopsis requires original retained evidence",
        "Synopsis composition dropped a supplied governing qualification or contrast",
        "Source synopsis requires configured provider output capacity for uncapped requests",
        "Configured synopsis request capacity cannot fit bounded structural input",
        "Configured synopsis capacity cannot compose adjacent summaries without truncation",
    ];
    return {
        name: error?.name ?? "Error",
        category: allowed.includes(message)
            ? message
            : /401|403|credential|authentication/i.test(message)
              ? "CONFIGURED_AUTHENTICATION_FAILURE"
              : /429|throttl/i.test(message)
                ? "CONFIGURED_PROVIDER_THROTTLE"
                : /endpoint|deployment|settings|configuration|config|provider/i.test(
                        message,
                    )
                  ? "CONFIGURED_ROLE_OR_TRANSPORT_UNAVAILABLE"
                  : /timeout|abort/i.test(message)
                    ? "BOUNDED_OPERATION_CANCELLED"
                    : "UNEXPECTED_FAILURE",
        rawProviderMessageSuppressed: true,
        ownedHarnessFrames: [
            ...(error?.stack ?? "").matchAll(
                /(live-(?:stages|qualification)\.mjs:\d+:\d+)/g,
            ),
        ].map((match) => match[1]),
    };
}

export async function captureSynopsisAttempt(runDirectory, prompt, complete) {
    await writeJson(path.join(runDirectory, "baseline19-synopsis-input.json"), {
        prompt,
    });
    const output = await complete();
    await writeJson(
        path.join(runDirectory, "baseline19-synopsis-output.json"),
        { output },
    );
    return output;
}

export async function preflight(spec) {
    const receipt = {
        mode: "LIVE_CONFIGURED_PREFLIGHT",
        startedEpochMs: Date.now(),
        outcome: "IN_PROGRESS",
        productFrozen: true,
        roleCalls: [],
        schemaOutputs:
            "Actual production source-synopsis parser, never fabricated",
        secretsRecorded: false,
        providerRequests: [],
    };
    receipt.pid = process.pid;
    receipt.receiptId = spec.receiptId;
    const persist = () =>
        writeJson(path.join(spec.runDirectory, "live-preflight.json"), receipt);
    let providerStarted = false;
    let role = "startup-sourceSynopsis";
    const restoreFetch = observeProvider(receipt.providerRequests, () => role);
    let configured;
    let load;
    try {
        const hashes = await snapshotCompiledCheckpoint(spec.productRoot);
        assertCheckpoint(hashes, spec.expectedCheckpoint);
        assert.deepEqual(hashes, spec.expectedCheckpoint.hashes);
        receipt.checkpoint = {
            files: Object.keys(hashes).length,
            digest: sha(JSON.stringify(hashes)),
        };
        receipt.helperHashes = {};
        receipt.dependencyCheckpoint = await liveDependencyCheckpoint(
            spec.productRoot,
        );
        if (spec.dependencyCheckpoint)
            assert.deepEqual(
                receipt.dependencyCheckpoint,
                spec.dependencyCheckpoint,
                "Live dependency checkpoint changed",
            );
        load = async (relative) => {
            const file = path.join(spec.productRoot, relative);
            receipt.helperHashes[relative] = sha(await readFile(file));
            return import(pathToFileURL(file).href);
        };
        await loadLiveContract(load);
        receipt.compiledLiveContract =
            "All concrete imports/exports/public APIs verified before expensive role calls";
        configured = await configuredLiveOptions(load, spec.authorization);
        receipt.providerIdentity = configured.identity;
        assert.equal(
            configured.identity.provider,
            "azure",
            "Authorized actual Luna qualification requires normal Azure provider",
        );
        const normalSettings = configured.client.openai.getChatModelSettings();
        const deployment = new URL(normalSettings.endpoint).pathname.match(
            /\/deployments\/([^/]+)\//,
        )?.[1];
        assert.equal(
            deployment,
            "gpt-6-luna",
            "Normal configured deployment must be actual GPT-6 Luna, not GPT-4o",
        );
        receipt.providerIdentity.deployment = deployment;
        receipt.providerIdentity.requestConstraints =
            normalSettings.requestConstraints;
        receipt.roles = {
            ...configured.roleCapabilities,
            synopsis: "production configuredSourceSynopsisModel complete/fits",
        };
        const plan = await loadPlan(spec.fixtureRoot);
        receipt.planHash = sha(JSON.stringify(plan));
        const entry = plan[0];
        const original = await readFile(entry.file, "utf8");
        assert.equal(sha(original), entry.sha256);
        const content = original.slice(0, 1024);
        receipt.original = {
            sourceKey: entry.sourceKey,
            fixtureSha256: entry.sha256,
            retainedCharacters: content.length,
        };
        await persist();
        const model = configured.roleCapabilities.synopsis;
        let calls = 0;
        const measured = {
            ...model,
            async complete(prompt, signal) {
                assert.equal(
                    ++calls,
                    1,
                    "Startup preflight permits exactly one actual provider call",
                );
                providerStarted = true;
                const started = performance.now();
                try {
                    const value =
                        spec.captureSynopsis ||
                        spec.sourceScope === "baseline19"
                            ? await captureSynopsisAttempt(
                                  spec.runDirectory,
                                  prompt,
                                  () => model.complete(prompt, signal),
                              )
                            : await model.complete(prompt, signal);
                    receipt.roleCalls.push({
                        role: "sourceSynopsis",
                        milliseconds: performance.now() - started,
                        outcome: "RETURNED",
                    });
                    return value;
                } catch (error) {
                    receipt.roleCalls.push({
                        role: "sourceSynopsis",
                        milliseconds: performance.now() - started,
                        outcome: "FAILED",
                        error: safeFailure(error),
                    });
                    throw error;
                }
            },
        };
        const value = await configured.synopsis.generateSourceSynopsis(
            {
                title: path.basename(entry.file, ".md"),
                sourceType: "markdown",
                canonicalUri: entry.canonicalUri,
                tags: entry.tags,
            },
            { mimeType: entry.mimeType ?? "text/markdown" },
            content,
            measured,
            AbortSignal.timeout(90000),
        );
        receipt.synopsis = {
            coverage: value.coverage,
            evidenceItems: value.evidence.length,
            limitations: value.limitations,
        };
        const actualModels = [
            ...new Set(
                receipt.providerRequests
                    .filter(
                        (entry) =>
                            entry.type === "chat" && entry.status === 200,
                    )
                    .map((entry) => entry.model),
            ),
        ];
        assert.ok(
            actualModels.length &&
                actualModels.every((model) =>
                    /^gpt-6-luna(?:-|$)/i.test(model ?? ""),
                ),
            "Actual provider response.model must confirm Luna",
        );
        receipt.providerIdentity.actualResponseModels = actualModels;
        receipt.tokenUsage =
            configured.client.TokenCounter.getInstance().toJSON();
        receipt.outcome =
            "PASS_REAL_CONFIGURED_ROLE_PREFLIGHT_NOT_SEMANTIC_QUALIFICATION";
    } catch (error) {
        receipt.outcome = providerStarted
            ? "FAILED_REAL_ROLE_PREFLIGHT"
            : "BLOCKED_CONFIGURED_ROLE_PREFLIGHT";
        receipt.error = safeFailure(error);
    } finally {
        if (
            spec.mode === "live-configured-timeline" &&
            receipt.outcome.startsWith("PASS_")
        ) {
            role = "normal-configured-service";
            await runLiveStages(
                spec,
                configured,
                receipt,
                load,
                persist,
                safeFailure,
            );
        }
        restoreFetch();
        if (configured)
            receipt.tokenUsage =
                configured.client.TokenCounter.getInstance().toJSON();
        receipt.finishedEpochMs = Date.now();
        receipt.elapsedMs = receipt.finishedEpochMs - receipt.startedEpochMs;
        receipt.checkpointAfter = await snapshotCompiledCheckpoint(
            spec.productRoot,
        );
        receipt.dependencyCheckpointAfter = await liveDependencyCheckpoint(
            spec.productRoot,
        );
        receipt.checkpointUnchanged =
            JSON.stringify(receipt.checkpointAfter) ===
            JSON.stringify(spec.expectedCheckpoint.hashes);
        receipt.dependenciesUnchanged =
            JSON.stringify(receipt.dependencyCheckpointAfter) ===
            JSON.stringify(receipt.dependencyCheckpoint);
        receipt.pending ??= ["Live stages not exercised"];
        receipt.checks ??= [];
        const packet = await reviewPacket(spec.fixtureRoot, receipt);
        for (const entry of packet.cases)
            entry.semanticVerdict = receipt.stages?.initial
                ? "PENDING_INDEPENDENT_REVIEW_OF_ACTUAL_LIVE_EVIDENCE"
                : "NOT_EXERCISED_INITIAL_LIVE_CORPUS_NOT_READY";
        await writeJson(
            path.join(spec.runDirectory, "independent-evaluator-packet.json"),
            packet,
        );
        await persist();
    }
    return receipt;
}

if (
    process.argv[1] &&
    import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href
) {
    const { values } = parseArgs({
        options: {
            product: { type: "string" },
            fixtures: { type: "string" },
            output: { type: "string" },
            checkpoint: { type: "string" },
            "authorized-live-preflight": { type: "boolean" },
            "authorized-live-timeline": { type: "boolean" },
            baseline19: { type: "boolean" },
            "capture-synopsis": { type: "boolean" },
            spec: { type: "string" },
        },
    });
    if (values.spec) {
        const spec = JSON.parse(await readFile(values.spec, "utf8"));
        validateLiveSpec(spec);
        const diagnostics = new Console({
            stdout: process.stderr,
            stderr: process.stderr,
        });
        Object.assign(console, {
            log: diagnostics.log,
            error: diagnostics.error,
            warn: diagnostics.warn,
            info: diagnostics.info,
            debug: diagnostics.debug,
        });
        const result = await preflight(spec);
        process.stdout.write(
            JSON.stringify({
                outcome: result.outcome,
                error: result.error,
                providerIdentity: result.providerIdentity,
                elapsedMs: result.elapsedMs,
            }) + "\n",
        );
        process.exitCode =
            result.outcome.startsWith("PASS_") ||
            result.outcome.startsWith("LIVE_TIMELINE_") ||
            result.outcome.startsWith("LIVE_BASELINE19_")
                ? 0
                : 1;
    } else {
        assert.equal(
            values["authorized-live-preflight"] ||
                values["authorized-live-timeline"],
            true,
            "Explicit live authorization is required",
        );
        for (const key of ["product", "fixtures", "output", "checkpoint"])
            assert.ok(values[key] && path.isAbsolute(values[key]));
        const runDirectory = await mkdtemp(
            path.join(await realpath(values.output), "memory-live-luna-"),
        );
        const receiptId = randomUUID();
        await writeJson(path.join(runDirectory, "ownership.json"), {
            receiptId,
            runDirectory,
        });
        const spec = {
            receiptId,
            mode: values["authorized-live-timeline"]
                ? "live-configured-timeline"
                : "live-configured-preflight",
            ...(values.baseline19 ? { sourceScope: "baseline19" } : {}),
            ...(values["capture-synopsis"] ? { captureSynopsis: true } : {}),
            productRoot: values.product,
            fixtureRoot: values.fixtures,
            runDirectory,
            expectedCheckpoint: JSON.parse(
                await readFile(values.checkpoint, "utf8"),
            ),
            dependencyCheckpoint: await liveDependencyCheckpoint(
                values.product,
            ),
            authorization: {
                verifiedP6: true,
                verifiedOfflinePreflight: true,
                coordinatorHandoff: true,
            },
            startupAllowanceMs: 120000,
            workAllowanceMs: liveAllowances({
                sourceScope: values.baseline19 ? "baseline19" : undefined,
            }).workAllowanceMs,
            nativeProfile: false,
            resume: false,
        };
        const termination = await supervise(
            spec,
            path.join(import.meta.dirname, "live-qualification.mjs"),
            validateLiveSpec,
        );
        process.stdout.write(
            JSON.stringify({ runDirectory, ...termination }) + "\n",
        );
        process.exitCode = termination.exit?.code === 0 ? 0 : 1;
    }
}

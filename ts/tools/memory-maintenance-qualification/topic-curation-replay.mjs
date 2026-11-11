// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { parseArgs } from "node:util";
import {
    openai,
    checkSerializedRequestConstraints,
    initRuntimeConfigFromProcessEnv,
} from "../../packages/aiclient/dist/index.js";
import {
    isSearchTimingEnabled,
    runWithSearchTiming,
} from "../../packages/knowPro/dist/searchTiming.js";
import { ChatCompletionsWireApiProvider } from "../../packages/aiclient/dist/wireApiProvider/chatCompletionsWireApiProvider.js";
import {
    createConfiguredTopicGenerator,
    createTopicSnapshot,
} from "../../packages/memory/service/dist/topicGeneration.js";
import {
    curateTopics,
    orderedTopicNodes,
    validateTopicCuration,
    validateTopicCurationProgress,
    validateTopicCurationSettings,
} from "../../packages/memory/service/dist/topicCuration.js";
import {
    TopicEvidenceIndex,
    TopicNominationIndex,
} from "../../packages/memory/service/dist/topicLookup.js";
import { validateTopicSnapshot } from "../../packages/memory/service/dist/topicSnapshot.js";
import {
    createReplayOutput,
    hashBytes as hash,
    hashWorkingTreePatch,
    loadCapturedTopicInput,
    positiveInteger as integer,
    compiledFileHashes,
    readReplayProgress,
    writeReplayProgress,
} from "./replay-artifacts.mjs";
import { replayIndexStorage, replayViewStorage } from "./replay-storage.mjs";

const productRoot = fileURLToPath(new URL("../../", import.meta.url));
const requireClient = createRequire(
    new URL("../../packages/aiclient/package.json", import.meta.url),
);
const { countTokens } = requireClient("gpt-tokenizer/encoding/o200k_base");
const wire = new ChatCompletionsWireApiProvider();
const diagnosticConstraints = {
    contextTokens: 1050000,
    inputTokens: 922000,
    outputTokens: 128000,
};
class CaptureComplete extends Error {}
class CallLimit extends Error {}
const replayModelSettings = new WeakMap();

export function inspectTopicReplayModelBinding(
    model,
    endpoint,
    settings = replayModelSettings.get(model) ?? {},
) {
    const completionSettings = {};
    for (const field of ["n", "temperature", "seed", "top_p"]) {
        const value = model.completionSettings?.[field];
        if (value !== undefined) {
            assert.ok(
                typeof value === "number" && Number.isFinite(value),
                `Invalid model binding ${field}`,
            );
            completionSettings[field] = value;
        }
    }
    for (const field of ["reasoning_effort", "verbosity"]) {
        const value = model.completionSettings?.[field];
        if (value !== undefined) {
            assert.ok(
                typeof value === "string",
                `Invalid model binding ${field}`,
            );
            completionSettings[field] = value;
        }
    }
    const format = model.completionSettings?.response_format?.type;
    if (format !== undefined) {
        assert.ok(
            typeof format === "string",
            "Invalid model binding response format",
        );
        completionSettings.response_format = { type: format };
    }
    const requestLimits = {};
    for (const field of ["contextTokens", "inputTokens", "outputTokens"]) {
        const value = settings.requestConstraints?.[field];
        if (value !== undefined) {
            assert.ok(
                Number.isSafeInteger(value) && value > 0,
                `Invalid model binding ${field}`,
            );
            requestLimits[field] = value;
        }
    }
    let deployment;
    if (typeof settings.endpoint === "string") {
        deployment = /\/deployments\/([^/]+)(?:\/|$)/i.exec(
            new URL(settings.endpoint).pathname,
        )?.[1];
    }
    const binding = {
        provider:
            typeof settings.provider === "string" ? settings.provider : null,
        endpointAlias: endpoint ?? null,
        ...(deployment ? { deployment } : {}),
        ...(typeof settings.modelName === "string"
            ? { modelName: settings.modelName }
            : {}),
        completionSettings,
        requestLimits,
    };
    assert.ok(
        binding.endpointAlias === null ||
            typeof binding.endpointAlias === "string",
        "Invalid model binding endpoint alias",
    );
    return { binding, hash: hash(JSON.stringify(binding)) };
}

export async function inspectConfiguredTopicReplayModelBinding(endpoint) {
    const model = await initializeReplayModel({ endpoint });
    return inspectTopicReplayModelBinding(model, endpoint);
}

export function topicReplaySettings(values) {
    const settings = {
        ...(values["input-tokens"] !== undefined
            ? {
                  inputTokenTarget: integer(
                      values["input-tokens"],
                      undefined,
                      "input-tokens",
                  ),
              }
            : {}),
        concurrency: integer(values.concurrency, 1, "concurrency"),
        ...(values["prior-fraction"] !== undefined
            ? { priorContextFraction: Number(values["prior-fraction"]) }
            : {}),
    };
    for (const [option, field] of [
        ["prior-deltas", "priorDeltas"],
        ["compact-ids", "compactIds"],
        ["frozen-preparation", "frozenPreparation"],
    ]) {
        if (values[option] !== undefined) {
            assert.ok(typeof values[option] === "boolean", `Invalid ${option}`);
            settings[field] = values[option];
        }
    }
    validateTopicCurationSettings(settings);
    return settings;
}

export function topicReplayDeadline(values, now = Date.now) {
    const started = now();
    const timeout = integer(values["timeout-ms"], 180000, "timeout-ms");
    assert.ok(
        timeout <= 2147483647,
        "Replay timeout exceeds supported timer range",
    );
    let absolute = Infinity;
    if (values.deadline !== undefined) {
        assert.match(
            values.deadline,
            /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d+)?(?:Z|[+-]\d\d:\d\d)$/,
            "Invalid --deadline ISO timestamp",
        );
        absolute = Date.parse(values.deadline);
        assert.ok(
            Number.isFinite(absolute),
            "Invalid --deadline ISO timestamp",
        );
    }
    const deadline = Math.min(absolute, started + timeout);
    const controller = new AbortController();
    const check = () => {
        if (now() >= deadline && !controller.signal.aborted)
            controller.abort(new Error("Replay deadline exceeded"));
        controller.signal.throwIfAborted();
    };
    check();
    return {
        deadline,
        controller,
        check,
        remaining: () => Math.max(0, deadline - now()),
    };
}

export async function initializeReplayModel(values) {
    const config = await import("../../packages/config/dist/index.js");
    config.loadConfigSync();
    initRuntimeConfigFromProcessEnv();
    const model = openai.createChatModel(values.endpoint, {
        temperature: 0,
        response_format: { type: "json_object" },
    });
    replayModelSettings.set(
        model,
        openai.getChatModelSettings(values.endpoint),
    );
    return model;
}

async function abortable(work, signal) {
    signal.throwIfAborted();
    let onAbort;
    const aborted = new Promise((_, reject) => {
        onAbort = () => reject(signal.reason);
        signal.addEventListener("abort", onAbort, { once: true });
    });
    try {
        return await Promise.race([work(), aborted]);
    } finally {
        signal.removeEventListener("abort", onAbort);
    }
}

export function finalTopicCoverage(snapshot) {
    const curation = snapshot.curation ?? snapshot.curationProgress;
    const selected = new Set(snapshot.nodes.map((node) => node.id));
    const admitted =
        curation?.concepts.flatMap((concept) => concept.memberIds) ?? [];
    const deferred = curation?.deferred.map((entry) => entry.nodeId) ?? [];
    const pending = curation?.pending?.map((entry) => entry.nodeId) ?? [];
    const accounted = [...admitted, ...deferred, ...pending];
    const distinct = new Set(accounted);
    const admittedSet = new Set(admitted);
    return {
        selectedNodes: selected.size,
        admittedNodes: admittedSet.size,
        deferredNodes: new Set(deferred).size,
        pendingNodes: new Set(pending).size,
        unaccountedNodes: [...selected].filter((id) => !distinct.has(id))
            .length,
        duplicateAssignments: accounted.length - distinct.size,
        unknownNodes: [...distinct].filter((id) => !selected.has(id)).length,
        representedOccurrences: new Set(
            snapshot.nodes
                .filter((node) => admittedSet.has(node.id))
                .flatMap((node) => node.occurrenceIds),
        ).size,
        selectedOccurrences: new Set(
            snapshot.nodes.flatMap((node) => node.occurrenceIds),
        ).size,
        concepts: curation?.concepts.length ?? 0,
        semanticQualityAssessed: false,
    };
}

export async function loadTopicReplay(values) {
    const { input, state, inputHash, retainedCurationHash } =
        await loadCapturedTopicInput(values);
    const snapshot = createTopicSnapshot(input, input.model);
    validateTopicSnapshot(snapshot);
    if (values.nodes) {
        assert.ok(!values.resume, "--nodes and --resume cannot be combined");
        snapshot.nodes = orderedTopicNodes(snapshot.nodes).slice(
            0,
            integer(values.nodes, undefined, "nodes"),
        );
    }
    return { input, snapshot, state, inputHash, retainedCurationHash };
}

function offlineInspection(rules, payload, schema) {
    const serializedRequest = JSON.stringify(
        wire.buildRequestBody({
            messages: [
                { role: "system", content: rules },
                { role: "user", content: JSON.stringify(payload) },
            ],
            jsonSchema: schema,
            completionSettings: {
                temperature: 0,
                response_format: { type: "json_object" },
            },
            providerOutputTokens: diagnosticConstraints.outputTokens,
            defaultParams: {},
            disableResponseFormat: false,
            modelName: "gpt-6-luna",
            stream: false,
        }),
    );
    return {
        serializedRequest,
        estimatedInputTokens: countTokens(serializedRequest),
        tokenizer: "o200k_base",
        constraints: checkSerializedRequestConstraints(
            serializedRequest,
            diagnosticConstraints,
        ),
    };
}

function referenceEvidence(snapshot, node) {
    const members = new Set(node.occurrenceIds);
    const sources = new Set(
        snapshot.occurrences
            .filter((entry) => members.has(entry.id))
            .map((entry) => `${entry.sourceId}\n${entry.revisionId}`),
    );
    const context = [
        ...new Map(
            snapshot.occurrences
                .filter((entry) =>
                    sources.has(`${entry.sourceId}\n${entry.revisionId}`),
                )
                .flatMap((entry) => entry.citations)
                .map((citation) => [JSON.stringify(citation), citation]),
        ).values(),
    ];
    const priority = (text) =>
        /Governing tail exception:/i.test(text)
            ? 3
            : /governing|withdraw|invalid|correct|supersed|retract/i.test(text)
              ? 2
              : /qualification|caveat|only|cohort|not applicable|held lease/i.test(
                      text,
                  )
                ? 1
                : 0;
    return [
        ...new Map(
            [
                ...node.citations.slice(0, 2),
                ...[...context].sort(
                    (a, b) => priority(b.excerpt) - priority(a.excerpt),
                ),
                ...context.slice(-2),
            ].map((citation) => [JSON.stringify(citation), citation]),
        ).values(),
    ].slice(0, 8);
}

function referenceNomination(concepts, nodes) {
    const terms = (text) =>
        new Set(text.toLowerCase().match(/[\p{L}\p{N}]{3,}/gu) ?? []);
    const incoming = terms(nodes.map((node) => node.label).join(" "));
    const labels = new Set(
        nodes.map((node) => node.label.trim().toLowerCase()),
    );
    return concepts
        .map((concept) => ({
            concept,
            exact: labels.has(concept.label.trim().toLowerCase()),
            score: [...terms(`${concept.label} ${concept.purpose}`)].filter(
                (term) => incoming.has(term),
            ).length,
        }))
        .filter((entry) => entry.exact || entry.score > 0)
        .sort(
            (a, b) =>
                Number(b.exact) - Number(a.exact) ||
                b.score - a.score ||
                a.concept.id.localeCompare(b.concept.id),
        )
        .slice(0, 24)
        .map(({ concept }) => concept);
}

function summary(samples) {
    const sorted = [...samples].sort((a, b) => a - b);
    return {
        samples,
        p50: sorted[Math.ceil(sorted.length * 0.5) - 1],
        p95: sorted[Math.ceil(sorted.length * 0.95) - 1],
    };
}

function measure(samples, warmups, work) {
    for (let i = 0; i < warmups; i++) work();
    const times = [];
    for (let i = 0; i < samples; i++) {
        const started = performance.now();
        work();
        times.push(performance.now() - started);
    }
    return summary(times);
}

function referenceOwnership(snapshot, node, occurrences) {
    const sources = new Set(
        node.occurrenceIds.map((id) => {
            const occurrence = occurrences.get(id);
            return `${occurrence.sourceId}\n${occurrence.revisionId}`;
        }),
    );
    const evidence = new Set(
        snapshot.occurrences
            .filter((entry) =>
                sources.has(`${entry.sourceId}\n${entry.revisionId}`),
            )
            .flatMap((entry) =>
                entry.citations.map((citation) => JSON.stringify(citation)),
            ),
    );
    return node.citations.every((citation) =>
        evidence.has(JSON.stringify(citation)),
    );
}

function cpuReplay(snapshot, state, samples, warmups) {
    let index;
    const construction = measure(samples, warmups, () => {
        index = new TopicEvidenceIndex(snapshot);
    });
    const expected = snapshot.nodes.map((node) =>
        referenceEvidence(snapshot, node),
    );
    assert.deepEqual(
        snapshot.nodes.map((node) => index.evidence(node)),
        expected,
    );
    const referenceSelection = measure(samples, warmups, () => {
        snapshot.nodes.forEach((node) => referenceEvidence(snapshot, node));
    });
    const warmIndexedSelection = measure(samples, warmups, () => {
        snapshot.nodes.forEach((node) => index.evidence(node));
    });
    const coldIndexedSelection = measure(samples, warmups, () => {
        const cold = new TopicEvidenceIndex(snapshot);
        snapshot.nodes.forEach((node) => cold.evidence(node));
    });
    const occurrences = new Map(
        snapshot.occurrences.map((entry) => [entry.id, entry]),
    );
    assert.deepEqual(
        snapshot.nodes.map((node) =>
            index.ownsExactEvidence([node.id], node.citations),
        ),
        snapshot.nodes.map((node) =>
            referenceOwnership(snapshot, node, occurrences),
        ),
    );
    const referenceValidation = measure(samples, warmups, () => {
        snapshot.nodes.forEach((node) =>
            referenceOwnership(snapshot, node, occurrences),
        );
    });
    const coldIndexedValidation = measure(samples, warmups, () => {
        const cold = new TopicEvidenceIndex(snapshot);
        snapshot.nodes.forEach((node) =>
            cold.ownsExactEvidence([node.id], node.citations),
        );
    });
    const concepts = state?.topics?.curationProgress?.concepts ?? [];
    const nomination = new TopicNominationIndex(concepts);
    const groups = [];
    const ordered = orderedTopicNodes(snapshot.nodes);
    for (let offset = 0; offset < ordered.length; offset += 24)
        groups.push(ordered.slice(offset, offset + 24));
    groups.forEach((nodes) =>
        assert.deepEqual(
            nomination.related(nodes),
            referenceNomination(concepts, nodes),
        ),
    );
    const completeMembership =
        snapshot.nodes.reduce(
            (sum, node) => sum + node.occurrenceIds.length,
            0,
        ) === snapshot.occurrences.length;
    return {
        evidenceParity: true,
        nominationParity: true,
        validationParity: true,
        concepts: concepts.length,
        batches: groups.length,
        construction,
        referenceSelection,
        warmIndexedSelection,
        coldIndexedSelection,
        referenceValidation,
        coldIndexedValidation,
        fullSnapshotValidation: completeMembership
            ? measure(samples, warmups, () => validateTopicSnapshot(snapshot))
            : {
                  status: "not-run",
                  reason: "Selected node subset excludes maintained incidence",
              },
        referenceNomination: measure(samples, warmups, () =>
            groups.forEach((nodes) => referenceNomination(concepts, nodes)),
        ),
        indexedNomination: measure(samples, warmups, () =>
            groups.forEach((nodes) => nomination.related(nodes)),
        ),
        processPeakRssBytes: process.resourceUsage().maxRSS * 1024,
    };
}

async function storageReplay(state, samples, output) {
    const clone = measure(samples, 0, () => structuredClone(state));
    const serialize = measure(samples, 0, () => JSON.stringify(state));
    const stored = await replayViewStorage(state, samples, output);
    return {
        ...stored,
        clone,
        serialize,
        disposableColdHistoryCommit: summary(stored.commits),
        limitation:
            "View-state persistence only; not DocMemory index persistence or live checkpoint eligibility.",
    };
}

async function indexStorageReplay(file, samples, output) {
    assert.ok(file, "Index storage mode requires --index-file");
    const stored = await replayIndexStorage(
        path.resolve(file),
        samples,
        output,
    );
    return {
        ...stored,
        coldWrite: summary(
            stored.writes.map((sample) => sample.cold.elapsedMs),
        ),
        unchangedWrite: summary(
            stored.writes.map((sample) => sample.unchanged.elapsedMs),
        ),
        payloadParity: true,
        limitation:
            "Actual segmented index persistence backend, not extraction, DocMemory object serialization, OS-cold I/O or complete ingestion. Unchanged writes still traverse/hash the payload. Trace logs contain instrumented API requests, not physical disk traffic.",
    };
}

async function callReplay(
    values,
    snapshot,
    settings,
    output,
    identity,
    input,
    budget,
    initializeModel,
) {
    const live = values.mode === "live";
    const recorded = values.mode === "recorded";
    assert.ok(!live || values.live, "Live inference requires --live");
    assert.ok(live || !values.live, "--live is only valid in live mode");
    assert.ok(
        !recorded || values.responses,
        "Recorded mode requires --responses",
    );
    assert.ok(
        values.mode !== "capture" ||
            settings.concurrency === 1 ||
            settings.frozenPreparation,
        "Capture mode requires concurrency 1 unless frozen preparation is enabled",
    );
    const maxCalls = integer(values["max-calls"], 1, "max-calls");
    const { controller } = budget;
    let model;
    let modelBinding;
    const timer = setTimeout(
        () => controller.abort(new Error("Replay deadline exceeded")),
        budget.remaining(),
    );
    const inspect = (rules, payload, schema) =>
        model
            ? model.inspectRequest(
                  [
                      { role: "system", content: rules },
                      { role: "user", content: JSON.stringify(payload) },
                  ],
                  schema,
              )
            : offlineInspection(rules, payload, schema);
    const index = new TopicEvidenceIndex(snapshot);
    const calls = [];
    let disposition = "complete";
    let organization;
    let providerCalls = 0;
    let cancellation;
    let persistenceError;
    const started = performance.now();
    const complete = async (rules, payload, schema, context) => {
        budget.check();
        context.signal.throwIfAborted();
        if (calls.length >= maxCalls)
            throw new CallLimit("Replay call limit reached");
        const request = inspect(rules, payload, schema);
        const receipt = {
            ordinal: calls.length + 1,
            batchOrdinal: context.ordinal,
            kind: context.kind,
            ...(context.phase ? { phase: context.phase } : {}),
            requestHash: hash(request.serializedRequest),
            inputTokens: request.estimatedInputTokens,
            serializedBytes: Buffer.byteLength(request.serializedRequest),
            outputReservation: request.constraints.outputTokens,
            rawNodes:
                context.rawNodes ??
                (payload.nodes ?? []).filter(
                    (node) => !Object.hasOwn(node, "purpose"),
                ).length,
            priorConcepts:
                context.priorConcepts ??
                (payload.nodes ?? []).filter((node) =>
                    Object.hasOwn(node, "purpose"),
                ).length,
            ...(context.proposalConcepts === undefined
                ? {}
                : { proposalConcepts: context.proposalConcepts }),
        };
        calls.push(receipt);
        await writeFile(
            path.join(output, `request-${receipt.ordinal}.json`),
            request.serializedRequest,
            { flag: "wx" },
        );
        const binding = { rules, payload, schema };
        await writeFile(
            path.join(output, `binding-${receipt.ordinal}.json`),
            JSON.stringify(binding),
            { flag: "wx" },
        );
        if (recorded) {
            assert.deepEqual(
                binding,
                JSON.parse(
                    await readFile(
                        path.join(
                            values.responses,
                            `binding-${receipt.ordinal}.json`,
                        ),
                        "utf8",
                    ),
                ),
                "Recorded response does not match current packet/evidence/schema",
            );
            return JSON.parse(
                await readFile(
                    path.join(
                        values.responses,
                        `response-${receipt.ordinal}.json`,
                    ),
                    "utf8",
                ),
            );
        }
        if (!live)
            throw new CaptureComplete(
                "Packet captured without provider initialization",
            );
        const callStarted = performance.now();
        let result;
        try {
            budget.check();
            const signal = AbortSignal.any([controller.signal, context.signal]);
            signal.throwIfAborted();
            const currentBinding = inspectTopicReplayModelBinding(
                model,
                values.endpoint,
            );
            receipt.modelBindingHash = currentBinding.hash;
            if (values["expected-model-binding"])
                assert.equal(
                    currentBinding.hash,
                    values["expected-model-binding"].toLowerCase(),
                    "Replay model binding does not match --expected-model-binding",
                );
            providerCalls++;
            result = await abortable(
                () =>
                    model.complete(
                        [
                            { role: "system", content: rules },
                            { role: "user", content: JSON.stringify(payload) },
                        ],
                        (value) => {
                            receipt.usage = value;
                        },
                        schema,
                        undefined,
                        signal,
                    ),
                signal,
            );
            budget.check();
            signal.throwIfAborted();
            receipt.status = result.success ? "complete" : "failed";
        } catch (error) {
            receipt.error = { name: error.name, message: error.message };
            throw error;
        } finally {
            receipt.elapsedMs = performance.now() - callStarted;
            receipt.status ??= context.signal.aborted ? "aborted" : "failed";
        }
        assert.ok(result.success, result.success ? undefined : result.message);
        receipt.outputBytes = Buffer.byteLength(result.data);
        await writeFile(
            path.join(output, `response-${receipt.ordinal}.json`),
            result.data,
            { flag: "wx" },
        );
        return JSON.parse(result.data);
    };
    try {
        budget.check();
        if (live) {
            model = await abortable(
                () => initializeModel(values),
                controller.signal,
            );
            budget.check();
            assert.ok(
                model.inspectRequest,
                "Selected model must expose exact request inspection",
            );
            modelBinding = inspectTopicReplayModelBinding(
                model,
                values.endpoint,
            );
            await writeFile(
                path.join(output, "model-binding.json"),
                JSON.stringify(modelBinding, null, 2),
                { flag: "wx" },
            );
            if (values["expected-model-binding"])
                assert.equal(
                    modelBinding.hash,
                    values["expected-model-binding"].toLowerCase(),
                    "Replay model binding does not match --expected-model-binding",
                );
        }
        snapshot.curation = await curateTopics(
            snapshot,
            (node) => index.evidence(node),
            complete,
            controller.signal,
            true,
            async (curation) => {
                const file = path.join(output, "progress.json");
                try {
                    await writeReplayProgress(file, identity, curation);
                    snapshot.curationProgress = structuredClone(curation);
                } catch (error) {
                    persistenceError = error;
                    throw error;
                }
            },
            snapshot.curationProgress,
            { ...settings, inspectRequest: inspect },
        );
        delete snapshot.curationProgress;
        validateTopicCuration(snapshot);
        await writeFile(
            path.join(output, "curation.json"),
            JSON.stringify(snapshot.curation),
            { flag: "wx" },
        );
        if (values.organize) {
            const organizationInput = structuredClone(input);
            organizationInput.topicInput.reusableCuration = snapshot.curation;
            // This diagnostic handoff has validated curation, not native watermark receipts.
            delete organizationInput.topicInput.packetReplay;
            delete organizationInput.topicInput.reusableCurationPackets;
            const parts = (prompt) => {
                assert.ok(
                    Array.isArray(prompt) &&
                        prompt.length === 2 &&
                        prompt[0].role === "system" &&
                        prompt[1].role === "user",
                    "Unexpected organization prompt structure",
                );
                return [prompt[0].content, JSON.parse(prompt[1].content)];
            };
            const organizationModel = {
                completionSettings: model
                    ? model.completionSettings
                    : { response_format: { type: "json_object" } },
                inspectRequest: (prompt, schema) =>
                    inspect(...parts(prompt), schema),
                complete: async (prompt, _usage, schema, _log, signal) => {
                    const [rules, payload] = parts(prompt);
                    const response = await complete(rules, payload, schema, {
                        ordinal: calls.length + 1,
                        kind: rules.includes("Repair the rejected organization")
                            ? "organization-repair"
                            : "organization",
                        signal: signal ?? controller.signal,
                    });
                    return { success: true, data: JSON.stringify(response) };
                },
            };
            const organized = await createConfiguredTopicGenerator({
                endpoint: values.endpoint,
                model: organizationModel,
                mode: { kind: "generative", settings: settings },
            })(organizationInput, controller.signal);
            await writeFile(
                path.join(output, "snapshot.json"),
                JSON.stringify(organized),
                { flag: "wx" },
            );
            organization = {
                concepts: organized.curation.concepts.length,
                parents: organized.parents.length,
                related: organized.related.length,
            };
        }
    } catch (error) {
        if (error instanceof CaptureComplete) disposition = "capture-only";
        else if (error instanceof CallLimit)
            disposition = "call-limit-incomplete";
        else if (
            controller.signal.aborted &&
            error === controller.signal.reason &&
            !persistenceError
        ) {
            disposition = "deadline-incomplete";
            cancellation = { name: error.name, message: error.message };
            await writeFile(
                path.join(output, "failure.json"),
                JSON.stringify({
                    status: "cancelled",
                    ...cancellation,
                }),
                { flag: "wx" },
            );
            await writeFile(
                path.join(output, "partial-curation.json"),
                JSON.stringify(
                    snapshot.curation ??
                        snapshot.curationProgress ?? {
                            concepts: [],
                            deferred: [],
                        },
                ),
                { flag: "wx" },
            );
        } else {
            await writeFile(
                path.join(output, "failure.json"),
                JSON.stringify({
                    status: "failed",
                    name: error.name,
                    message: error.message,
                    ...(modelBinding
                        ? { modelBindingHash: modelBinding.hash }
                        : {}),
                }),
                { flag: "wx" },
            );
            throw error;
        }
    } finally {
        controller.abort(new Error("Replay finished"));
        clearTimeout(timer);
        await writeFile(
            path.join(output, "calls.json"),
            JSON.stringify(calls, null, 2),
            { flag: "wx" },
        );
    }
    return {
        disposition,
        completed: disposition === "complete",
        providerCalls,
        ...(modelBinding
            ? {
                  modelBinding: modelBinding.binding,
                  modelBindingHash: modelBinding.hash,
              }
            : {}),
        deadline: new Date(budget.deadline).toISOString(),
        ...(cancellation ? { error: cancellation } : {}),
        elapsedMs: performance.now() - started,
        calls,
        accountedNodes: snapshot.curation
            ? snapshot.curation.concepts.reduce(
                  (sum, concept) => sum + concept.memberIds.length,
                  0,
              ) + snapshot.curation.deferred.length
            : null,
        concepts: snapshot.curation?.concepts.length ?? null,
        coverage: finalTopicCoverage(snapshot),
        ...(organization ? { organization } : {}),
        limitation: live
            ? `Frozen curation${values.organize ? " and organization" : " only"}; no native readiness, answer scores or human quality qualification.`
            : "Diagnostic chat-completions body with explicit nominal constraints; not actual deployment settings or native billed tokens.",
    };
}

export async function implementationIdentity() {
    const identity = {
        commit: execFileSync("git", ["--no-pager", "rev-parse", "HEAD"], {
            cwd: productRoot,
            encoding: "utf8",
        }).trim(),
        patchHash: await hashWorkingTreePatch(productRoot),
        compiled: {},
    };
    identity.compiled = await compiledFileHashes(productRoot, [
        ...[
            "topicCuration",
            "topicLookup",
            "topicCurationScheduler",
            "topicGeneration",
            "topicCurationTransport",
            "topicFrozenPreparation",
        ].map((file) => `packages/memory/service/dist/${file}.js`),
        ...["openai", "requestConstraints"].map(
            (file) => `packages/aiclient/dist/${file}.js`,
        ),
        ...["segmentedJson", "searchTiming"].map(
            (file) => `packages/knowPro/dist/${file}.js`,
        ),
    ]);
    const untracked = execFileSync(
        "git",
        ["ls-files", "--others", "--exclude-standard", "-z"],
        { cwd: productRoot, encoding: "utf8" },
    );
    identity.untracked = {};
    const sourceFiles = untracked
        .split("\0")
        .filter(
            (file) =>
                /\.[cm]?[jt]sx?$/.test(file) &&
                (file.startsWith("packages/") ||
                    /^tools\/memory-maintenance-qualification\/[^/]+$/.test(
                        file,
                    )),
        );
    for (const file of sourceFiles)
        identity.untracked[file] = hash(
            await readFile(path.resolve(productRoot, file)),
        );
    return identity;
}

export async function runTopicReplay(
    values,
    { initializeModel = initializeReplayModel, now = Date.now } = {},
) {
    const budget = topicReplayDeadline(values, now);
    if (values["expected-model-binding"] !== undefined)
        assert.match(
            values["expected-model-binding"],
            /^[a-f0-9]{64}$/i,
            "Invalid --expected-model-binding SHA256",
        );
    const mode = values.mode ?? "capture";
    assert.ok(
        [
            "capture",
            "cpu",
            "storage",
            "index-storage",
            "live",
            "recorded",
        ].includes(mode),
        "Invalid replay mode",
    );
    assert.ok(!values.live || mode === "live", "Use --mode live with --live");
    assert.ok(
        !values.organize ||
            (["live", "recorded"].includes(mode) && !values.nodes),
        "--organize requires complete input in live or recorded mode, not --nodes",
    );
    const settings = topicReplaySettings(values);
    assert.ok(
        values.output,
        "--output must name a new private artifact directory",
    );
    const output = await createReplayOutput(
        values.output,
        values.history
            ? path.dirname(path.dirname(path.resolve(values.history)))
            : values["index-file"]
              ? path.dirname(path.dirname(path.resolve(values["index-file"])))
              : undefined,
    );
    const { input, snapshot, state, inputHash, retainedCurationHash } =
        await loadTopicReplay(values);
    const implementation = await implementationIdentity();
    const identity = {
        ...implementation,
        inputHash,
        retainedCurationHash,
        selectedNodeIdsHash: hash(
            JSON.stringify(snapshot.nodes.map((node) => node.id)),
        ),
        settings,
        endpoint: values.endpoint ?? null,
        expectedModelBinding:
            values["expected-model-binding"]?.toLowerCase() ?? null,
    };
    if (values.progress) {
        assert.ok(!values.resume, "--progress and --resume cannot be combined");
        const progress = await readReplayProgress(
            values.progress,
            identity,
            (curation) =>
                validateTopicCurationProgress({
                    ...snapshot,
                    curationProgress: curation,
                }),
        );
        snapshot.curationProgress = progress.curation;
    }
    const samples = integer(values.samples, 3, "samples");
    const warmups =
        values.warmups === "0" ? 0 : integer(values.warmups, 1, "warmups");
    const result = {
        schemaVersion: 1,
        mode,
        identity,
        identityVerified: true,
        traceEnabled: isSearchTimingEnabled(),
        settings,
        nodes: snapshot.nodes.length,
        occurrences: snapshot.occurrences.length,
        observations:
            mode === "cpu"
                ? cpuReplay(snapshot, state, samples, warmups)
                : mode === "storage"
                  ? await storageReplay(state, samples, output)
                  : mode === "index-storage"
                    ? await runWithSearchTiming(
                          undefined,
                          "topic-index-storage",
                          () =>
                              indexStorageReplay(
                                  values["index-file"],
                                  samples,
                                  output,
                              ),
                      )
                    : await runWithSearchTiming(
                          undefined,
                          "topic-curation-replay",
                          () =>
                              callReplay(
                                  { ...values, mode },
                                  snapshot,
                                  settings,
                                  output,
                                  identity,
                                  input,
                                  budget,
                                  initializeModel,
                              ),
                      ),
    };
    try {
        assert.deepEqual(
            await implementationIdentity(),
            implementation,
            "Implementation changed during replay; results are not qualified",
        );
    } catch (error) {
        await writeFile(
            path.join(output, "failure.json"),
            JSON.stringify({ status: "failed", message: error.message }),
            { flag: "wx" },
        );
        throw error;
    }
    await writeFile(
        path.join(output, "result.json"),
        JSON.stringify(result, null, 2),
        { flag: "wx" },
    );
    return result;
}

if (
    process.argv[1] &&
    import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href
) {
    const { values } = parseArgs({
        allowNegative: true,
        options: {
            input: { type: "string" },
            history: { type: "string" },
            commit: { type: "string" },
            job: { type: "string" },
            output: { type: "string" },
            mode: { type: "string" },
            live: { type: "boolean" },
            resume: { type: "boolean" },
            nodes: { type: "string" },
            samples: { type: "string" },
            warmups: { type: "string" },
            "input-tokens": { type: "string" },
            concurrency: { type: "string" },
            "prior-fraction": { type: "string" },
            "prior-deltas": { type: "boolean" },
            "compact-ids": { type: "boolean" },
            "frozen-preparation": { type: "boolean" },
            "max-calls": { type: "string" },
            "timeout-ms": { type: "string" },
            deadline: { type: "string" },
            endpoint: { type: "string" },
            "expected-model-binding": { type: "string" },
            responses: { type: "string" },
            progress: { type: "string" },
            "index-file": { type: "string" },
            organize: { type: "boolean" },
        },
    });
    runTopicReplay(values).then(
        (result) => {
            process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
            if (
                ["live", "recorded"].includes(result.mode) &&
                !result.observations.completed
            )
                process.exitCode = 2;
        },
        (error) => {
            console.error(error.message);
            process.exitCode = 1;
        },
    );
}

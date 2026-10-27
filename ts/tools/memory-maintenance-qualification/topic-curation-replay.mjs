// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
    mkdir,
    mkdtemp,
    readFile,
    rename,
    rm,
    writeFile,
} from "node:fs/promises";
import { createRequire } from "node:module";
import os from "node:os";
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
import {
    clearJsonSegmentCache,
    isSegmentedJson,
    readSegmentedJson,
    writeSegmentedJson,
} from "../../packages/knowPro/dist/segmentedJson.js";
import { ChatCompletionsWireApiProvider } from "../../packages/aiclient/dist/wireApiProvider/chatCompletionsWireApiProvider.js";
import {
    createConfiguredTopicGenerator,
    createTopicSnapshot,
} from "../../packages/memory/service/dist/topicGeneration.js";
import {
    curateTopics,
    orderedTopicNodes,
    validateTopicCuration,
    validateTopicCurationSettings,
} from "../../packages/memory/service/dist/topicCuration.js";
import {
    TopicEvidenceIndex,
    TopicNominationIndex,
} from "../../packages/memory/service/dist/topicLookup.js";
import { ViewHistory } from "../../packages/memory/service/dist/viewHistory.js";
import { validateTopicSnapshot } from "../../packages/memory/service/dist/topicSnapshot.js";

const productRoot = fileURLToPath(new URL("../../", import.meta.url));
const requireClient = createRequire(
    new URL("../../packages/aiclient/package.json", import.meta.url),
);
const { countTokens } = requireClient("gpt-tokenizer/encoding/o200k_base");
const hash = (value) => createHash("sha256").update(value).digest("hex");
const wire = new ChatCompletionsWireApiProvider();
const diagnosticConstraints = {
    contextTokens: 1050000,
    inputTokens: 922000,
    outputTokens: 128000,
};
class CaptureComplete extends Error {}
class CallLimit extends Error {}

function integer(value, fallback, name) {
    if (value === undefined) return fallback;
    const number = Number(value);
    assert.ok(Number.isSafeInteger(number) && number > 0, `Invalid ${name}`);
    return number;
}

export async function loadTopicReplay(values) {
    assert.ok(
        Boolean(values.input) !== Boolean(values.history),
        "Choose --input or --history",
    );
    let state, input;
    if (values.input) input = JSON.parse(await readFile(values.input, "utf8"));
    else {
        const revision = values.commit ?? "refs/heads/typeagent-history";
        assert.ok(
            revision === "refs/heads/typeagent-history" ||
                /^[a-f0-9]{8,40}$/i.test(revision),
            "Use a commit hash or the history head",
        );
        state = JSON.parse(
            execFileSync(
                "git",
                [
                    "--no-pager",
                    `--git-dir=${path.resolve(values.history)}`,
                    "show",
                    `${revision}:state.json`,
                ],
                { maxBuffer: 256 * 1024 * 1024 },
            ),
        );
        const targets = Object.entries(state.builds ?? {})
            .filter(([id]) => !values.job || id === values.job)
            .flatMap(([, job]) =>
                job.results.filter(
                    (result) => result.snapshot.pipeline === "topics-v1",
                ),
            );
        assert.equal(
            targets.length,
            1,
            "Select exactly one captured topics target with --job",
        );
        input = structuredClone(targets[0].snapshot);
    }
    assert.equal(
        input.pipeline,
        "topics-v1",
        "Expected a captured topics build input",
    );
    if (values.resume) {
        assert.ok(
            state?.topics?.curationProgress,
            "--resume requires a durable partial state",
        );
        assert.equal(state.topics.inputFingerprint, input.fingerprint);
        input.topicInput.reusableCuration = structuredClone(
            state.topics.curationProgress,
        );
    } else delete input.topicInput.reusableCuration;
    const snapshot = createTopicSnapshot(input, input.model);
    if (values.nodes) {
        assert.ok(!values.resume, "--nodes and --resume cannot be combined");
        snapshot.nodes = orderedTopicNodes(snapshot.nodes).slice(
            0,
            integer(values.nodes, undefined, "nodes"),
        );
    }
    return { input, snapshot, state };
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

async function storageReplay(state, samples) {
    assert.ok(state, "Storage mode requires a retained --history state");
    const clone = measure(samples, 0, () => structuredClone(state));
    const serialize = measure(samples, 0, () => JSON.stringify(state));
    const commits = [];
    for (let i = 0; i < samples; i++) {
        const scratch = await mkdtemp(
            path.join(os.tmpdir(), "typeagent-topic-replay-"),
        );
        try {
            const history = new ViewHistory(
                path.join(scratch, "views"),
                () => ({ views: {} }),
            );
            const started = performance.now();
            await history.commit(
                null,
                structuredClone(state),
                {},
                "offline-replay",
                "Frozen topic persistence replay",
            );
            commits.push(performance.now() - started);
        } finally {
            await rm(scratch, { recursive: true, force: true });
        }
    }
    return {
        clone,
        serialize,
        disposableColdHistoryCommit: summary(commits),
        stateBytes: Buffer.byteLength(JSON.stringify(state)),
        limitation:
            "View-state persistence only; not DocMemory index persistence or live checkpoint eligibility.",
    };
}

async function indexStorageReplay(file, samples) {
    assert.ok(file, "Index storage mode requires --index-file");
    const source = path.resolve(file);
    const descriptor = JSON.parse(await readFile(source, "utf8"));
    assert.ok(
        isSegmentedJson(descriptor),
        "Expected a segmented index manifest",
    );
    clearJsonSegmentCache(path.dirname(path.dirname(source)));
    const loadStarted = performance.now();
    const value = await readSegmentedJson(source, descriptor);
    const loadMs = performance.now() - loadStarted;
    const writes = [];
    async function timedWrite(file, checkpoint) {
        const cpu = process.cpuUsage();
        const started = performance.now();
        await writeSegmentedJson(file, value, descriptor.metadata, checkpoint);
        const used = process.cpuUsage(cpu);
        return {
            elapsedMs: performance.now() - started,
            cpuMs: (used.user + used.system) / 1000,
        };
    }
    for (let sample = 0; sample < samples; sample++) {
        const scratch = await mkdtemp(
            path.join(os.tmpdir(), "topic-index-io-"),
        );
        try {
            const generation = path.join(scratch, "generation");
            await mkdir(generation);
            const target = path.join(generation, "corpus_data.json");
            let newArtifacts = 0;
            const checkpoint = async (point) => {
                if (point === "segment-written") newArtifacts++;
            };
            const cold = await timedWrite(target, checkpoint);
            cold.newArtifacts = newArtifacts;
            newArtifacts = 0;
            const unchanged = await timedWrite(target, checkpoint);
            unchanged.newArtifacts = newArtifacts;
            const saved = JSON.parse(await readFile(target, "utf8"));
            assert.deepEqual(
                await readSegmentedJson(target, saved),
                value,
                "Index persistence changed the retained payload",
            );
            assert.equal(unchanged.newArtifacts, 0);
            writes.push({ cold, unchanged });
        } finally {
            clearJsonSegmentCache(scratch);
            await rm(scratch, { recursive: true, force: true });
        }
    }
    return {
        sourceManifestHash: hash(JSON.stringify(descriptor)),
        metadata: descriptor.metadata,
        loadMs,
        writes,
        coldWrite: summary(writes.map((sample) => sample.cold.elapsedMs)),
        unchangedWrite: summary(
            writes.map((sample) => sample.unchanged.elapsedMs),
        ),
        payloadParity: true,
        limitation:
            "Actual segmented index persistence backend, not extraction, DocMemory object serialization, OS-cold I/O or complete ingestion. Unchanged writes still traverse/hash the payload. Trace logs contain instrumented API requests, not physical disk traffic.",
    };
}

async function callReplay(values, snapshot, settings, output, identity, input) {
    const live = values.mode === "live";
    const recorded = values.mode === "recorded";
    assert.ok(!live || values.live, "Live inference requires --live");
    assert.ok(live || !values.live, "--live is only valid in live mode");
    assert.ok(
        !recorded || values.responses,
        "Recorded mode requires --responses",
    );
    assert.ok(
        values.mode !== "capture" || settings.concurrency === 1,
        "Capture mode inspects one boundary; use concurrency 1",
    );
    const maxCalls = integer(values["max-calls"], 1, "max-calls");
    const timeout = integer(values["timeout-ms"], 180000, "timeout-ms");
    const controller = new AbortController();
    let model;
    if (live) {
        const config = await import("../../packages/config/dist/index.js");
        config.loadConfigSync();
        initRuntimeConfigFromProcessEnv();
        model = openai.createChatModel(values.endpoint, {
            temperature: 0,
            response_format: { type: "json_object" },
        });
        assert.ok(
            model.inspectRequest,
            "Selected model must expose exact request inspection",
        );
    }
    const timer = setTimeout(
        () => controller.abort(new Error("Replay deadline exceeded")),
        timeout,
    );
    const inspect = model
        ? (rules, payload, schema) =>
              model.inspectRequest(
                  [
                      { role: "system", content: rules },
                      { role: "user", content: JSON.stringify(payload) },
                  ],
                  schema,
              )
        : offlineInspection;
    const index = new TopicEvidenceIndex(snapshot);
    const calls = [];
    let disposition = "complete";
    let organization;
    const started = performance.now();
    const complete = async (rules, payload, schema, context) => {
        if (calls.length >= maxCalls)
            throw new CallLimit("Replay call limit reached");
        const request = inspect(rules, payload, schema);
        const receipt = {
            ordinal: calls.length + 1,
            batchOrdinal: context.ordinal,
            kind: context.kind,
            requestHash: hash(request.serializedRequest),
            inputTokens: request.estimatedInputTokens,
            serializedBytes: Buffer.byteLength(request.serializedRequest),
            outputReservation: request.constraints.outputTokens,
            rawNodes: (payload.nodes ?? []).filter((node) =>
                node.id.startsWith("topic:"),
            ).length,
            priorConcepts: (payload.nodes ?? []).filter((node) =>
                node.id.startsWith("concept:"),
            ).length,
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
        let usage;
        const callStarted = performance.now();
        let result;
        try {
            result = await model.complete(
                [
                    { role: "system", content: rules },
                    { role: "user", content: JSON.stringify(payload) },
                ],
                (value) => {
                    usage = value;
                },
                schema,
                undefined,
                context.signal,
            );
            receipt.status = result.success ? "complete" : "failed";
        } finally {
            receipt.elapsedMs = performance.now() - callStarted;
            receipt.status ??= context.signal.aborted ? "aborted" : "failed";
        }
        assert.ok(result.success, result.success ? undefined : result.message);
        receipt.outputBytes = Buffer.byteLength(result.data);
        receipt.usage = usage;
        await writeFile(
            path.join(output, `response-${receipt.ordinal}.json`),
            result.data,
            { flag: "wx" },
        );
        return JSON.parse(result.data);
    };
    try {
        snapshot.curation = await curateTopics(
            snapshot,
            (node) => index.evidence(node),
            complete,
            controller.signal,
            true,
            async (curation) => {
                const file = path.join(output, "progress.json");
                await writeFile(
                    `${file}.tmp`,
                    JSON.stringify({
                        schemaVersion: 1,
                        inputHash: identity.inputHash,
                        selectedNodeIdsHash: identity.selectedNodeIdsHash,
                        settings,
                        curation,
                    }),
                );
                await rename(`${file}.tmp`, file);
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
            const organized = await createConfiguredTopicGenerator(
                values.endpoint,
                organizationModel,
                true,
                settings,
            )(organizationInput, controller.signal);
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
        else {
            await writeFile(
                path.join(output, "failure.json"),
                JSON.stringify({
                    status: "failed",
                    name: error.name,
                    message: error.message,
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
        providerCalls: live ? calls.length : 0,
        elapsedMs: performance.now() - started,
        calls,
        accountedNodes: snapshot.curation
            ? snapshot.curation.concepts.reduce(
                  (sum, concept) => sum + concept.memberIds.length,
                  0,
              ) + snapshot.curation.deferred.length
            : null,
        concepts: snapshot.curation?.concepts.length ?? null,
        ...(organization ? { organization } : {}),
        limitation: live
            ? `Frozen curation${values.organize ? " and organization" : " only"}; no native readiness, answer scores or human quality qualification.`
            : "Diagnostic chat-completions body with explicit nominal constraints; not actual deployment settings or native billed tokens.",
    };
}

async function implementationIdentity() {
    const identity = {
        commit: execFileSync("git", ["--no-pager", "rev-parse", "HEAD"], {
            cwd: productRoot,
            encoding: "utf8",
        }).trim(),
        patchHash: hash(
            execFileSync("git", ["--no-pager", "diff", "--binary", "HEAD"], {
                cwd: productRoot,
            }),
        ),
        compiled: {},
    };
    for (const file of [
        "topicCuration",
        "topicLookup",
        "topicCurationScheduler",
        "topicGeneration",
    ])
        identity.compiled[file] = hash(
            await readFile(
                new URL(
                    `../../packages/memory/service/dist/${file}.js`,
                    import.meta.url,
                ),
            ),
        );
    for (const file of ["openai", "requestConstraints"])
        identity.compiled[`aiclient/${file}`] = hash(
            await readFile(
                new URL(
                    `../../packages/aiclient/dist/${file}.js`,
                    import.meta.url,
                ),
            ),
        );
    for (const file of ["segmentedJson", "searchTiming"])
        identity.compiled[`knowPro/${file}`] = hash(
            await readFile(
                new URL(
                    `../../packages/knowPro/dist/${file}.js`,
                    import.meta.url,
                ),
            ),
        );
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

export async function runTopicReplay(values) {
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
    const settings = {
        ...(values["input-tokens"]
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
    validateTopicCurationSettings(settings);
    assert.ok(
        values.output,
        "--output must name a new private artifact directory",
    );
    const output = path.resolve(values.output);
    if (values.history) {
        const relative = path.relative(
            path.dirname(path.dirname(path.resolve(values.history))),
            output,
        );
        assert.ok(
            relative === ".." ||
                relative.startsWith(`..${path.sep}`) ||
                path.isAbsolute(relative),
            "Output must be outside the original view-store directory",
        );
    }
    await mkdir(output);
    const { input, snapshot, state } = await loadTopicReplay(values);
    const implementation = await implementationIdentity();
    const identity = {
        ...implementation,
        inputHash: hash(JSON.stringify(input)),
        selectedNodeIdsHash: hash(
            JSON.stringify(snapshot.nodes.map((node) => node.id)),
        ),
    };
    if (values.progress) {
        assert.ok(!values.resume, "--progress and --resume cannot be combined");
        const progress = JSON.parse(await readFile(values.progress, "utf8"));
        assert.deepEqual(
            {
                schemaVersion: progress.schemaVersion,
                inputHash: progress.inputHash,
                selectedNodeIdsHash: progress.selectedNodeIdsHash,
                settings: progress.settings,
            },
            {
                schemaVersion: 1,
                inputHash: identity.inputHash,
                selectedNodeIdsHash: identity.selectedNodeIdsHash,
                settings,
            },
            "Replay progress does not match the frozen input, selected nodes or policy",
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
                  ? await storageReplay(state, samples)
                  : mode === "index-storage"
                    ? await runWithSearchTiming(
                          undefined,
                          "topic-index-storage",
                          () =>
                              indexStorageReplay(values["index-file"], samples),
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
            "max-calls": { type: "string" },
            "timeout-ms": { type: "string" },
            endpoint: { type: "string" },
            responses: { type: "string" },
            progress: { type: "string" },
            "index-file": { type: "string" },
            organize: { type: "boolean" },
        },
    });
    runTopicReplay(values).then(
        (result) => {
            process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
            if (result.mode === "live" && !result.observations.completed)
                process.exitCode = 2;
        },
        (error) => {
            console.error(error.message);
            process.exitCode = 1;
        },
    );
}

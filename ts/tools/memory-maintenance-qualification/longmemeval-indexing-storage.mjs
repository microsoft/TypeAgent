// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";
import { copyFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import {
    decode,
    digest,
    encode,
    readJson,
    writeNew,
} from "./longmemeval-indexing-contract.mjs";

export async function productModules(root) {
    const load = (file) =>
        import(pathToFileURL(path.join(root, ...file.split("/"))).href);
    const [kp, storage, client, config] = await Promise.all([
        load("packages/knowPro/dist/index.js"),
        load("packages/memory/storage/dist/index.js"),
        load("packages/aiclient/dist/index.js"),
        load("packages/config/dist/index.js"),
    ]);
    return { kp, storage, client, config };
}

export function sourceMessages(construction) {
    return construction.sessions.flatMap((session) =>
        session.turns.map((turn, index) => {
            const raw = session.date
                .replace(/\s*\([A-Za-z]{3}\)/, "")
                .replaceAll("/", "-")
                .replace(" ", "T");
            const timestamp = /[Zz]$|[+-]\d\d:\d\d$/.test(raw)
                ? raw
                : `${raw}Z`;
            assert.ok(
                Number.isFinite(Date.parse(timestamp)),
                "Invalid official date",
            );
            return {
                benchmarkMessageVersion: 1,
                textChunks: turn.content ? [turn.content] : [],
                timestamp,
                tags: [`role:${turn.role}`],
                source: {
                    caseId: construction.id,
                    sessionId: session.id,
                    position: session.position,
                    turn: index,
                    date: session.date,
                },
                getKnowledge: () => undefined,
            };
        }),
    );
}

function providerModel(model, lane, tape, active, selectRole) {
    const identity = model.embeddingIdentity;
    assert.ok(
        identity,
        "Persistent vectors require an identified embedding model",
    );
    const wrap = {
        ...model,
        maxBatchSize: model.maxBatchSize,
        embeddingIdentity: identity,
        resolve: async () => wrap,
        forRole: (role) =>
            providerModel(
                selectRole(model, role),
                lane,
                tape,
                active,
                selectRole,
            ),
        generateEmbedding: (...args) => invoke("generateEmbedding", args),
        ...(model.generateEmbeddingBatch
            ? {
                  generateEmbeddingBatch: (...args) =>
                      invoke("generateEmbeddingBatch", args),
              }
            : {}),
    };
    const invoke = (method, args) => {
        assert.equal(
            active.commit,
            false,
            "Provider call during prepared commit",
        );
        return tape.invoke(`${lane}.${method}`, identity, args, () =>
            model[method](...args),
        );
    };
    return wrap;
}

export function instrumentSettings(
    settings,
    tape,
    active,
    selectRole = (model, role) => model.forRole(role),
) {
    const lanes = {
        related: settings.relatedTermIndexSettings.embeddingIndexSettings,
        message: settings.messageTextIndexSettings.embeddingIndexSettings,
        thread: settings.threadSettings,
    };
    for (const [lane, configured] of Object.entries(lanes))
        if (configured?.embeddingModel)
            configured.embeddingModel = providerModel(
                configured.embeddingModel,
                lane,
                tape,
                active,
                selectRole,
            );
    const extractor = settings.semanticRefIndexSettings.knowledgeExtractor;
    assert.ok(extractor, "Explicit knowledge extractor required");
    const invoke = (method, args) => {
        assert.equal(active.commit, false, "Extraction during prepared commit");
        return tape.invoke(`knowledge.${method}`, null, args, () =>
            extractor[method](...args),
        );
    };
    settings.semanticRefIndexSettings.knowledgeExtractor = {
        settings: extractor.settings,
        extract: (...args) => invoke("extract", args),
        extractWithRetry: (...args) => invoke("extractWithRetry", args),
    };
    return settings;
}

export function settingsArtifact(
    settings,
    selectRole = (model, role) => model.forRole(role),
) {
    const settingsData = JSON.parse(
        JSON.stringify(settings, (key, value) =>
            ["embeddingModel", "knowledgeExtractor", "signal"].includes(key)
                ? undefined
                : value,
        ),
    );
    const roles = (lane, get) =>
        Object.fromEntries(
            ["document", "query"].map((role) => {
                const model = selectRole(lane.embeddingModel, role);
                assert.ok(model.embeddingIdentity);
                return [role, get(model)];
            }),
        );
    const identity = (lane) => roles(lane, (model) => model.embeddingIdentity);
    const batches = (lane) => roles(lane, (model) => model.maxBatchSize);
    return {
        settingsData,
        extractorSettings:
            settings.semanticRefIndexSettings.knowledgeExtractor.settings,
        identities: {
            related: identity(
                settings.relatedTermIndexSettings.embeddingIndexSettings,
            ),
            message: identity(
                settings.messageTextIndexSettings.embeddingIndexSettings,
            ),
            thread: identity(settings.threadSettings),
        },
        maxBatchSizes: {
            related: batches(
                settings.relatedTermIndexSettings.embeddingIndexSettings,
            ),
            message: batches(
                settings.messageTextIndexSettings.embeddingIndexSettings,
            ),
            thread: batches(settings.threadSettings),
        },
        batchMethods: Object.fromEntries(
            Object.entries({
                related:
                    settings.relatedTermIndexSettings.embeddingIndexSettings,
                message:
                    settings.messageTextIndexSettings.embeddingIndexSettings,
                thread: settings.threadSettings,
            }).map(([lane, value]) => [
                lane,
                roles(value, (model) => Boolean(model.generateEmbeddingBatch)),
            ]),
        ),
    };
}

export function replaySettings(
    artifact,
    tape,
    active,
    limits = { workers: 3, window: 3 },
) {
    const settings = structuredClone(artifact.settingsData);
    const model = (lane, role = "document") => ({
        maxBatchSize: artifact.maxBatchSizes[lane][role],
        embeddingIdentity: artifact.identities[lane][role],
        forRole: (next) => model(lane, next),
        generateEmbedding: () => {
            throw new Error("Uncaptured replay embedding");
        },
        ...(artifact.batchMethods[lane][role]
            ? {
                  generateEmbeddingBatch: () => {
                      throw new Error("Uncaptured replay embeddings");
                  },
              }
            : {}),
    });
    settings.relatedTermIndexSettings.embeddingIndexSettings.embeddingModel =
        model("related");
    settings.messageTextIndexSettings.embeddingIndexSettings.embeddingModel =
        model("message");
    settings.threadSettings.embeddingModel = model("thread");
    settings.semanticRefIndexSettings.knowledgeExtractor = {
        settings: artifact.extractorSettings,
        extract: () => {
            throw new Error("Uncaptured replay extraction");
        },
        extractWithRetry: () => {
            throw new Error("Uncaptured replay extraction");
        },
    };
    settings.preparedIndexing = limits;
    return instrumentSettings(settings, tape, active);
}

export function openStorage(modules, filename, settings, options = {}) {
    const { kp, storage } = modules;
    const active = options.active ?? { commit: false };
    const provider = new storage.sqlite.SqliteStorageProvider(
        filename,
        false,
        options.checkpoint,
    );
    const codec = {
        serialize: JSON.stringify,
        deserialize: (text) => {
            const value = JSON.parse(text);
            assert.equal(
                value.benchmarkMessageVersion,
                1,
                "Unknown benchmark message format",
            );
            return { ...value, getKnowledge: () => undefined };
        },
    };
    const messages = provider.createMessageCollection(codec);
    const semanticRefs = provider.createSemanticRefCollection();
    const capability = provider.createPreparedIndexStorage(
        messages,
        semanticRefs,
    );
    const facade = {
        createPreparedIndexStorage: () => ({
            capture: (include) => capability.capture(include),
            commit: (stamp, batch) => {
                options.capture?.({ stamp, batch });
                active.commit = true;
                try {
                    capability.commit(stamp, batch);
                } finally {
                    active.commit = false;
                }
                options.accepted?.();
            },
        }),
    };
    const conversation = {
        nameTag: "LongMemEval indexing companion",
        tags: [],
        messages,
        semanticRefs,
        storageProvider: facade,
        semanticRefIndex: new kp.TermToSemanticRefIndex(),
        secondaryIndexes: new kp.ConversationSecondaryIndexes(settings),
    };
    return { conversation, capability, close: () => provider.close() };
}

export function logicalState(opened) {
    const refs = opened.conversation.semanticRefs.getAll();
    const metadata = opened.conversation.semanticRefs.getMetadataMultiple(
        refs.map((ref) => ref.semanticRefOrdinal),
    );
    assert.deepEqual(
        metadata,
        refs.map(({ semanticRefOrdinal, range, knowledgeType }) => ({
            semanticRefOrdinal,
            range,
            knowledgeType,
        })),
    );
    assert.throws(
        () =>
            opened.conversation.semanticRefs.getMetadataMultiple([refs.length]),
        /not found/,
        "Ghost metadata beyond accepted references",
    );
    return {
        messages: opened.conversation.messages.getAll(),
        refs,
        metadata,
        index: opened.capability.capture().data,
    };
}

export async function capturePreparation(
    modules,
    directory,
    construction,
    settings,
    tape,
) {
    await mkdir(directory);
    const filename = path.join(directory, "live.db");
    const active = { commit: false };
    instrumentSettings(
        settings,
        tape,
        active,
        modules.client.embeddingModelForRole,
    );
    settings.preparedIndexing = {
        ...settings.preparedIndexing,
        workers: 3,
        window: 3,
    };
    const artifact = settingsArtifact(settings);
    const messages = sourceMessages(construction);
    assert.ok(messages.length > 1, "Companion requires a prefix and tail");
    let opened = openStorage(modules, filename, settings, { active });
    try {
        opened.conversation.messages.append(messages[0]);
        await modules.kp.buildConversationIndex(opened.conversation, settings);
        opened.conversation.messages.append(...messages.slice(1));
        assert.equal(
            encode(opened.conversation.messages.getAll()),
            encode(messages),
            "Source message round trip changed history",
        );
    } finally {
        opened.close();
    }
    await copyFile(filename, path.join(directory, "baseline.db"));
    let bundle;
    opened = openStorage(modules, filename, settings, {
        active,
        capture: (value) => {
            assert.equal(bundle, undefined, "Duplicate prepared publication");
            bundle = decode(encode(value));
        },
    });
    try {
        await modules.kp.addToConversationIndex(
            opened.conversation,
            settings,
            1,
            opened.conversation.semanticRefs.length,
        );
        assert.ok(bundle, "No prepared batch accepted");
        const state = logicalState(opened);
        const result = {
            schemaVersion: 1,
            sourceHash: digest(encode(construction)),
            bundle,
            artifact,
            tape: tape.entries(),
            acceptedHash: digest(encode(state)),
            liveCalls: tape.calls,
        };
        await writeNew(path.join(directory, "prepared.json"), result);
        return result;
    } finally {
        opened.close();
    }
}

export function pauseAt(directory, point) {
    writeFileSync(
        path.join(directory, "checkpoint.json"),
        encode({ point, pid: process.pid }),
        { flag: "wx" },
    );
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 60000);
    throw new Error(
        "Recovery supervisor failed to terminate the paused worker",
    );
}

export async function verifyReplay(modules, directory, prepared, tapeFactory) {
    const states = [];
    for (const workers of [1, 3]) {
        const filename = path.join(directory, `replay-${workers}.db`);
        await copyFile(path.join(directory, "baseline.db"), filename);
        const tape = tapeFactory(prepared.tape);
        const active = { commit: false };
        const settings = replaySettings(prepared.artifact, tape, active, {
            workers,
            window: workers,
        });
        const opened = openStorage(modules, filename, settings, { active });
        const start = performance.now();
        try {
            await modules.kp.addToConversationIndex(
                opened.conversation,
                settings,
                1,
                opened.conversation.semanticRefs.length,
            );
            const state = logicalState(opened);
            assert.equal(
                digest(encode(state)),
                prepared.acceptedHash,
                "Replay differs from live acceptance",
            );
            assert.equal(tape.calls, 0);
            states.push({
                workers,
                elapsedMs: performance.now() - start,
                acceptedHash: digest(encode(state)),
            });
        } finally {
            opened.close();
        }
    }
    return states;
}

export async function runRecoveryWorker(modules, directory, point) {
    const prepared = await readJson(path.join(directory, "prepared.json"));
    const settings = prepared.artifact.settingsData;
    const opened = openStorage(
        modules,
        path.join(directory, "worker.db"),
        settings,
        {
            checkpoint: (stage) => {
                if (stage === point) pauseAt(directory, point);
            },
            accepted: () => {
                if (point === "accepted") pauseAt(directory, point);
            },
        },
    );
    try {
        assert.equal(
            opened.capability.capture(false).stamp,
            prepared.bundle.stamp,
        );
        if (point === "before") pauseAt(directory, point);
        opened.capability.commit(prepared.bundle.stamp, prepared.bundle.batch);
        if (point === "accepted") pauseAt(directory, point);
        throw new Error("Recovery checkpoint was not exercised");
    } finally {
        opened.close();
    }
}

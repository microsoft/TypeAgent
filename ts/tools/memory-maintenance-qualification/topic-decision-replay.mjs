// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { parseArgs } from "node:util";
import {
    atomicWriteJson,
    compiledFileHashes,
    createReplayOutput,
    curationAccounting,
    loadCapturedTopicInput,
    positiveInteger,
    readReplayProgress,
    writeReplayProgress,
} from "./replay-artifacts.mjs";
import { replayIndexStorage, replayViewStorage } from "./replay-storage.mjs";
import {
    createReplayTape,
    nativeReplayModel,
    ReplayBudgetExceeded,
    ReplayCaptureComplete,
} from "./replay-tape.mjs";

const root = fileURLToPath(new URL("../../", import.meta.url));

export async function decisionReplayImplementation() {
    const files = [
        ...[
            "replay-artifacts.mjs",
            "replay-storage.mjs",
            "replay-tape.mjs",
            "topic-decision-replay.mjs",
        ].map((name) => `tools/memory-maintenance-qualification/${name}`),
    ];
    for (const directory of [
        "packages/memory/service/dist",
        "packages/aiclient/dist",
        "packages/config/dist",
    ]) {
        const absolute = path.join(root, ...directory.split("/"));
        for (const entry of await readdir(absolute, {
            withFileTypes: true,
            recursive: true,
        })) {
            const relative = path.relative(
                absolute,
                path.join(entry.parentPath, entry.name),
            );
            if (
                entry.isFile() &&
                entry.name.endsWith(".js") &&
                !relative.split(path.sep).includes("test")
            )
                files.push(
                    `${directory}/${relative.split(path.sep).join("/")}`,
                );
        }
    }
    files.push(
        "packages/knowPro/dist/segmentedJson.js",
        "packages/knowPro/dist/searchTiming.js",
    );
    files.sort();
    return compiledFileHashes(root, files);
}

function replayChatModel(tape, identity, factory, reviveError) {
    let model;
    const getModel = () => {
        model ??= factory();
        assert.deepEqual(
            model.completionSettings,
            identity.completionSettings,
            "Generative configuration changed",
        );
        assert.equal(
            Boolean(model.inspectRequest),
            identity.inspection !== false,
            "Generative wire inspection capability changed",
        );
        return model;
    };
    return {
        completionSettings: identity.completionSettings,
        ...(identity.inspection !== false
            ? {
                  inspectRequest(prompt, schema) {
                      return tape.inspectRequest(
                          { model: identity, prompt, schema },
                          () => getModel().inspectRequest(prompt, schema),
                          reviveError,
                      );
                  },
              }
            : {}),
        complete(prompt, onUsage, schema, _log, signal) {
            const frozenPrompt = structuredClone(prompt),
                frozenSchema = structuredClone(schema);
            return tape.invoke(
                "generative",
                {
                    model: identity,
                    prompt: frozenPrompt,
                    schema: frozenSchema,
                    completionSettings: identity.completionSettings,
                },
                async (effectiveSignal) => {
                    return getModel().complete(
                        frozenPrompt,
                        onUsage,
                        frozenSchema,
                        undefined,
                        effectiveSignal,
                    );
                },
                signal,
            );
        },
    };
}

async function loadDecisionReplayBinding(values, mode) {
    assert.ok(
        ["capture", "record", "playback", "storage", "index-storage"].includes(
            mode,
        ),
        "Invalid Decision replay mode",
    );
    assert.ok(
        !values.live || mode === "record",
        "--live is only valid for record mode",
    );
    assert.ok(
        mode !== "record" || values.live === true,
        "Recording requires explicit live authorization",
    );
    const binding = structuredClone(
        values.binding ??
            JSON.parse(await readFile(values["identity-file"], "utf8")),
    );
    assert.ok(
        binding.policyIdentity &&
            binding.native?.model &&
            binding.generative?.model,
        "Explicit policy, native and generative identities are required",
    );
    assert.ok(
        Number.isSafeInteger(binding.native.configGeneration),
        "Native config generation is required",
    );
    assert.ok(
        binding.generative.completionSettings &&
            binding.generative.wireIdentity,
        "Generative settings and wire identity are required",
    );
    assert.ok(
        Object.keys(binding).every((key) =>
            [
                "policyIdentity",
                "packetPolicy",
                "execution",
                "native",
                "generative",
            ].includes(key),
        ),
        "Unexpected Decision binding field",
    );
    assert.ok(
        ["v2", "factored-best-fit"].includes(binding.packetPolicy ?? "v2"),
        "Unknown Decision packet policy",
    );
    return binding;
}

function assertDecisionConfiguration(client, product, binding, endpoint, mode) {
    assert.equal(
        client.getRuntimeConfigGeneration(),
        binding.native.configGeneration,
        "Decision runtime configuration generation does not match the recorded binding",
    );
    if (mode === "record")
        assert.equal(
            product.configuredTopicDecisionIdentity(
                endpoint,
                binding.packetPolicy ?? "v2",
                binding.execution ?? {},
            ),
            binding.policyIdentity,
            "Decision provider or policy does not match the recorded binding",
        );
}

export async function runDecisionReplay(values, dependencies = {}) {
    const mode = values.mode ?? "capture";
    const binding = await loadDecisionReplayBinding(values, mode);
    const {
        input,
        state,
        inputHash: sourceHash,
        retainedCurationHash,
    } = await loadCapturedTopicInput(values);
    assert.equal(
        input.model,
        binding.policyIdentity,
        "Captured input model/policy does not match the Decision binding",
    );
    const product =
        dependencies.product ??
        (await import("../../packages/memory/service/dist/index.js"));
    const client =
        dependencies.client ??
        (await import("../../packages/aiclient/dist/index.js"));
    const implementation = await (
        dependencies.implementation ?? decisionReplayImplementation
    )();
    const identity = {
        ...binding,
        engine: "Decision",
        inputHash: sourceHash,
        retainedCurationHash,
        implementation,
        maintainClusters: input.topicInput.maintainClusters ?? false,
        endpoint: values.endpoint ?? null,
    };
    const snapshot = product.createTopicSnapshot(input, input.model);
    product.validateTopicSnapshot(snapshot);
    const validateCuration = (curation) => {
        product.validateTopicSnapshot({
            ...snapshot,
            curationProgress: curation,
        });
        curationAccounting(
            curation,
            snapshot.nodes.map((node) => node.id),
        );
    };
    let progress;
    if (values.progress) {
        assert.ok(!values.resume, "--progress and --resume cannot be combined");
        progress = await readReplayProgress(
            values.progress,
            identity,
            validateCuration,
        );
        input.topicInput.reusableCuration = structuredClone(progress.curation);
    }
    const output = await createReplayOutput(
        values.output,
        values.history
            ? path.dirname(path.dirname(path.resolve(values.history)))
            : values["index-file"]
              ? path.dirname(path.dirname(path.resolve(values["index-file"])))
              : undefined,
    );
    if (mode === "storage" || mode === "index-storage") {
        const samples = positiveInteger(values.samples, 1, "samples");
        const observations =
            mode === "storage"
                ? await replayViewStorage(state, samples, output)
                : await replayIndexStorage(
                      path.resolve(values["index-file"]),
                      samples,
                      output,
                  );
        const result = { mode, identity, observations, providerCalls: 0 };
        await atomicWriteJson(path.join(output, "result.json"), result);
        return result;
    }
    assertDecisionConfiguration(
        client,
        product,
        binding,
        values.endpoint,
        mode,
    );
    const execution = binding.execution ?? {};
    const tape = await createReplayTape({
        mode,
        file: path.join(output, "tape.json"),
        responses: values.responses,
        identity,
        authorizedLive: values.live,
        maxCalls: values["max-calls"],
        timeoutMs: values["timeout-ms"],
        signal: values.signal,
        occurrences: progress?.occurrences,
    });
    const receipts = [];
    let initialized = false;
    const initialize = () => {
        if (initialized) return;
        dependencies.initialize?.();
        initialized = true;
    };
    const reviveError = (error) =>
        Object.assign(
            error.name === "RequestAdmissionError"
                ? new client.RequestAdmissionError(error.message)
                : new Error(error.message),
            error,
        );
    const model = nativeReplayModel(
        tape,
        binding.native,
        () => {
            initialize();
            return (
                dependencies.nativeFactory?.() ??
                product.configuredTopicDecisionModel()
            );
        },
        reviveError,
    );
    const chat = replayChatModel(
        tape,
        binding.generative,
        () => {
            initialize();
            return (
                dependencies.generativeFactory?.() ??
                client.openai.createChatModel(
                    values.endpoint,
                    binding.generative.completionSettings,
                )
            );
        },
        reviveError,
    );
    const generate = product.createConfiguredTopicGenerator(
        values.endpoint,
        chat,
        true,
        () => ({
            ...execution,
            model,
            packetPolicy: binding.packetPolicy ?? "v2",
            onReceipt: (receipt) => receipts.push(receipt),
        }),
    );
    let lastCuration = progress?.curation ?? input.topicInput.reusableCuration;
    const save = async (working) => {
        tape.signal.throwIfAborted();
        product.validateTopicSnapshot(working);
        const curation = working.curationProgress ?? working.curation;
        if (!curation) return;
        validateCuration(curation);
        await writeReplayProgress(
            path.join(output, "progress.json"),
            identity,
            curation,
            { occurrences: tape.occurrences() },
            tape.signal,
        );
        lastCuration = structuredClone(curation);
    };
    let disposition = "complete",
        resultSnapshot;
    try {
        resultSnapshot = await generate(
            structuredClone(input),
            tape.signal,
            save,
        );
        tape.signal.throwIfAborted();
        product.validateTopicSnapshot(resultSnapshot);
        assert.deepEqual(
            await (
                dependencies.implementation ?? decisionReplayImplementation
            )(),
            implementation,
            "Implementation changed during replay",
        );
        assertDecisionConfiguration(
            client,
            product,
            binding,
            values.endpoint,
            mode,
        );
        await save(resultSnapshot);
        await atomicWriteJson(
            path.join(output, "snapshot.json"),
            resultSnapshot,
            tape.signal,
        );
    } catch (error) {
        if (error instanceof ReplayCaptureComplete)
            disposition = "capture-only";
        else if (error instanceof ReplayBudgetExceeded)
            disposition = "call-limit-incomplete";
        else {
            await atomicWriteJson(path.join(output, "failure.json"), {
                status: tape.signal.aborted ? "aborted" : "failed",
                name: error.name,
                message: error.message,
            });
            throw error;
        }
    } finally {
        await tape.close();
    }
    const accounting = curationAccounting(
        lastCuration,
        snapshot.nodes.map((node) => node.id),
    );
    const result = {
        schemaVersion: 1,
        mode,
        identity,
        disposition,
        providerCalls: tape.providerCalls,
        budget: tape.budget,
        returned: disposition === "complete",
        accounting,
        receipts,
        maintenanceRequested: identity.maintainClusters,
        nativeReadinessQualified: false,
        semanticQualityQualified: false,
        limitation:
            "Offline exact contract reproduction does not reproduce provider latency, live completion order, semantic quality or memory-view readiness.",
    };
    await atomicWriteJson(path.join(output, "result.json"), result);
    return result;
}

export async function main(args = process.argv.slice(2)) {
    const { values } = parseArgs({
        args,
        options: {
            input: { type: "string" },
            history: { type: "string" },
            commit: { type: "string" },
            job: { type: "string" },
            output: { type: "string" },
            mode: { type: "string" },
            "identity-file": { type: "string" },
            responses: { type: "string" },
            progress: { type: "string" },
            resume: { type: "boolean" },
            live: { type: "boolean" },
            endpoint: { type: "string" },
            "max-calls": { type: "string" },
            "timeout-ms": { type: "string" },
            "index-file": { type: "string" },
            samples: { type: "string" },
        },
    });
    const client = await import("../../packages/aiclient/dist/index.js");
    if (values.mode === "record" && values.live) {
        const config = await import("../../packages/config/dist/index.js");
        config.loadConfigSync();
    }
    client.initRuntimeConfigFromProcessEnv();
    const dependencies = { client };
    return runDecisionReplay(values, dependencies);
}

if (
    process.argv[1] &&
    import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href
)
    main().then(
        (result) => {
            process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
            if (
                ["record", "playback"].includes(result.mode) &&
                (result.disposition !== "complete" ||
                    !result.accounting.assignmentsResolved ||
                    !result.accounting.maintenanceComplete)
            )
                process.exitCode = 2;
        },
        (error) => {
            process.stderr.write(`${error.message}\n`);
            process.exitCode = 1;
        },
    );

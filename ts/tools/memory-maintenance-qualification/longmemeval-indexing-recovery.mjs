// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { copyFile, mkdir, readFile, realpath } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
    decode,
    digest,
    encode,
    readJson,
    replayTape,
    writeNew,
} from "./longmemeval-indexing-contract.mjs";
import {
    logicalState,
    openStorage,
    productModules,
    replaySettings,
    runRecoveryWorker,
} from "./longmemeval-indexing-storage.mjs";

const points = ["before", "rows", "postings", "receipt", "accepted"];
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function waitCheckpoint(directory, child, exited, timeoutMs) {
    const until = Date.now() + timeoutMs;
    while (Date.now() < until) {
        assert.equal(
            exited.done,
            false,
            `Worker exited before checkpoint: ${exited.code}`,
        );
        try {
            const checkpoint = decode(
                await readFile(path.join(directory, "checkpoint.json"), "utf8"),
            );
            assert.equal(checkpoint.pid, child.pid, "Checkpoint PID mismatch");
            return checkpoint;
        } catch (error) {
            if (error.code !== "ENOENT") throw error;
        }
        await delay(20);
    }
    throw new Error("Recovery checkpoint timeout");
}

export async function terminateAt(
    product,
    directory,
    point,
    timeoutMs = 30000,
) {
    assert.ok(points.includes(point));
    const token = randomUUID();
    await writeNew(path.join(directory, "worker-owner.json"), {
        token,
        directory: await realpath(directory),
        point,
    });
    const child = spawn(
        process.execPath,
        [fileURLToPath(import.meta.url), product, directory, point, token],
        { stdio: ["ignore", "pipe", "pipe"] },
    );
    let output = "";
    child.stdout.on("data", (chunk) => {
        output = (output + chunk).slice(-4096);
    });
    child.stderr.on("data", (chunk) => {
        output = (output + chunk).slice(-4096);
    });
    const exited = { done: false };
    const closed = new Promise((resolve) => {
        child.once("error", (error) => {
            Object.assign(exited, { done: true, error });
            resolve({ error });
        });
        child.once("close", (code, signal) => {
            Object.assign(exited, { done: true, code, signal });
            resolve({ code, signal });
        });
    });
    try {
        const checkpoint = await waitCheckpoint(
            directory,
            child,
            exited,
            timeoutMs,
        );
        assert.equal(checkpoint.point, point);
        assert.equal(
            child.kill("SIGKILL"),
            true,
            "Owned worker termination failed",
        );
        const outcome = await waitExit(closed);
        assert.ok(
            outcome.signal || outcome.code !== 0,
            "Worker was not hard-terminated",
        );
        return { point, pid: child.pid, outcome };
    } catch (error) {
        throw new Error(`Recovery worker failed; output: ${output}`, {
            cause: error,
        });
    } finally {
        if (!exited.done) {
            child.kill("SIGKILL");
            await waitExit(closed);
        }
    }
}

async function waitExit(closed) {
    let timer;
    try {
        return await Promise.race([
            closed,
            new Promise((_resolve, reject) => {
                timer = setTimeout(
                    () =>
                        reject(
                            new Error(
                                "Owned recovery worker did not exit after termination",
                            ),
                        ),
                    5000,
                );
            }),
        ]);
    } finally {
        clearTimeout(timer);
    }
}

export async function recoveryMatrix(modules, product, directory, prepared) {
    const checks = [];
    for (const point of points) {
        const scenario = path.join(directory, `crash-${point}`);
        await mkdir(scenario);
        await copyFile(
            path.join(directory, "baseline.db"),
            path.join(scenario, "worker.db"),
        );
        await writeNew(path.join(scenario, "prepared.json"), prepared);
        const outcome = await terminateAt(product, scenario, point);
        const tape = replayTape(prepared.tape);
        const active = { commit: false };
        const settings = replaySettings(prepared.artifact, tape, active);
        const opened = openStorage(
            modules,
            path.join(scenario, "worker.db"),
            settings,
            { active },
        );
        try {
            const count = await modules.kp.restorePreparedConversationIndex(
                opened.conversation,
                settings,
            );
            assert.equal(
                count,
                point === "accepted"
                    ? prepared.bundle.batch.messages.length
                    : 1,
            );
            if (point !== "accepted")
                opened.capability.commit(
                    prepared.bundle.stamp,
                    prepared.bundle.batch,
                );
            assert.equal(
                digest(encode(logicalState(opened))),
                prepared.acceptedHash,
                "Recovery differs from accepted control",
            );
            assert.equal(tape.calls, 0);
            checks.push({
                ...outcome,
                status: "passed",
                restoredMessages: count,
                newProviderCalls: tape.calls,
            });
        } finally {
            opened.close();
        }
        checks.at(-1).acceptedRestore = await verifyAcceptedRestore(
            modules,
            path.join(scenario, "worker.db"),
            prepared,
        );
    }
    return checks;
}

async function verifyAcceptedRestore(modules, filename, prepared) {
    const tape = replayTape(prepared.tape);
    const settings = replaySettings(prepared.artifact, tape, { commit: false });
    const opened = openStorage(modules, filename, settings);
    try {
        const count = await modules.kp.restorePreparedConversationIndex(
            opened.conversation,
            settings,
        );
        assert.equal(count, prepared.bundle.batch.messages.length);
        assert.deepEqual(
            opened.conversation.semanticRefIndex.serialize(),
            prepared.bundle.batch.data.semanticIndexData,
        );
        assert.deepEqual(
            opened.conversation.secondaryIndexes.termToRelatedTermsIndex.serialize(),
            prepared.bundle.batch.data.relatedTermsIndexData,
        );
        assert.deepEqual(
            opened.conversation.secondaryIndexes.messageIndex.serialize(),
            prepared.bundle.batch.data.messageIndexData,
        );
        assert.equal(tape.calls, 0);
        const [term] = prepared.bundle.batch.data.semanticIndexData.items;
        if (term)
            assert.deepEqual(
                opened.conversation.semanticRefIndex.lookupTerm(term.term),
                term.semanticRefOrdinals,
            );
        return {
            count,
            lookup: term ? "passed" : "not-exercised-no-postings",
            newProviderCalls: tape.calls,
        };
    } finally {
        opened.close();
    }
}

export async function preparationFaults(modules, directory, prepared) {
    const results = [];
    for (const fault of ["cancel", "append", "replace"]) {
        const file = path.join(directory, `${fault}.db`);
        await copyFile(path.join(directory, "baseline.db"), file);
        const ready = Promise.withResolvers();
        const release = Promise.withResolvers();
        const tape = replayTape(prepared.tape);
        let held = false;
        const delayed = {
            invoke: async (...args) => {
                if (!held) {
                    held = true;
                    ready.resolve();
                    await release.promise;
                }
                return tape.invoke(...args);
            },
        };
        const active = { commit: false };
        const controller = new AbortController();
        const settings = replaySettings(prepared.artifact, delayed, active, {
            workers: 3,
            window: 3,
            signal: controller.signal,
        });
        const opened = openStorage(modules, file, settings, { active });
        let observed;
        try {
            assert.equal(
                await modules.kp.restorePreparedConversationIndex(
                    opened.conversation,
                    settings,
                ),
                1,
            );
            const mirror = encode(
                opened.conversation.semanticRefIndex.serialize(),
            );
            const original = encode(logicalState(opened));
            const work = modules.kp.addToConversationIndex(
                opened.conversation,
                settings,
                1,
                opened.conversation.semanticRefs.length,
            );
            let settled = false;
            observed = work
                .then(
                    () => ({ success: true }),
                    (error) => ({ success: false, error }),
                )
                .finally(() => {
                    settled = true;
                });
            await Promise.race([
                ready.promise,
                observed.then((result) => {
                    throw result.error ?? new Error("Preparation never paused");
                }),
            ]);
            if (fault === "cancel")
                controller.abort(new Error("Pilot cancellation"));
            if (fault === "append")
                opened.conversation.messages.append({
                    ...prepared.bundle.batch.messages[0],
                    textChunks: ["new accepted input"],
                    getKnowledge: () => undefined,
                });
            if (fault === "replace") {
                const capability = opened.capability;
                const source = prepared.bundle.batch.messages[0];
                // Replacing an accepted row uses the real collection, not a source-forget API.
                opened.conversation.messages.replaceAll([
                    { ...source, textChunks: ["changed accepted input"] },
                    ...prepared.bundle.batch.messages.slice(1),
                ]);
                assert.throws(
                    () => capability.capture(),
                    /source revision changed/,
                );
            }
            await Promise.resolve();
            if (fault === "cancel")
                assert.equal(
                    settled,
                    false,
                    "Provider ignoring abort was not drained",
                );
            release.resolve();
            const result = await observed;
            assert.equal(result.success, false);
            if (fault === "cancel") {
                assert.equal(result.error, controller.signal.reason);
                assert.equal(encode(logicalState(opened)), original);
                assert.equal(
                    encode(opened.conversation.semanticRefIndex.serialize()),
                    mirror,
                    "Cancelled mirrors changed",
                );
            } else assert.match(result.error.message, /stale/);
            assert.equal(tape.calls, 0);
            results.push({
                fault,
                status: "passed",
                providerMode: "provider-replay",
                newProviderCalls: 0,
            });
        } finally {
            release.resolve();
            await observed;
            opened.close();
        }
    }
    return results;
}

export async function restoreFaults(modules, directory, prepared) {
    const results = [];
    for (const fault of ["append", "replace"]) {
        const filename = path.join(directory, `restore-${fault}.db`);
        await copyFile(path.join(directory, "live.db"), filename);
        const ready = Promise.withResolvers();
        const release = Promise.withResolvers();
        const tape = replayTape(prepared.tape);
        const settings = replaySettings(prepared.artifact, tape, {
            commit: false,
        });
        const model =
            settings.relatedTermIndexSettings.embeddingIndexSettings
                .embeddingModel;
        model.resolve = async () => {
            ready.resolve();
            await release.promise;
            return model;
        };
        const opened = openStorage(modules, filename, settings);
        let observed;
        try {
            const before = encode(
                opened.conversation.semanticRefIndex.serialize(),
            );
            observed = modules.kp
                .restorePreparedConversationIndex(opened.conversation, settings)
                .then(
                    () => ({ success: true }),
                    (error) => ({ success: false, error }),
                );
            await Promise.race([
                ready.promise,
                observed.then(() => {
                    throw new Error("Restore did not await model");
                }),
            ]);
            const message = {
                ...prepared.bundle.batch.messages[0],
                textChunks: ["changed input"],
                getKnowledge: () => undefined,
            };
            if (fault === "append")
                opened.conversation.messages.append(message);
            else
                opened.conversation.messages.replaceAll([
                    message,
                    ...prepared.bundle.batch.messages.slice(1),
                ]);
            release.resolve();
            const result = await observed;
            assert.equal(result.success, false);
            assert.match(result.error.message, /changed during restore/);
            assert.equal(
                encode(opened.conversation.semanticRefIndex.serialize()),
                before,
                "Stale mirrors published",
            );
            assert.equal(tape.calls, 0);
            results.push({ fault, status: "passed", newProviderCalls: 0 });
        } finally {
            release.resolve();
            await observed;
            opened.close();
        }
    }
    return results;
}

async function main() {
    const [product, directory, point, token] = process.argv.slice(2);
    assert.ok(points.includes(point), "Unknown recovery checkpoint");
    const owner = await readJson(path.join(directory, "worker-owner.json"));
    assert.equal(owner.token, token, "Unowned worker");
    assert.equal(owner.directory, await realpath(directory));
    assert.equal(owner.point, point);
    await runRecoveryWorker(await productModules(product), directory, point);
}
if (
    process.argv[1] &&
    import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href
)
    await main();

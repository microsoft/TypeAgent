// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import {
    mkdir,
    readFile,
    realpath,
    rename,
    rm,
    writeFile,
} from "node:fs/promises";
import path from "node:path";

export const hashBytes = (value) =>
    createHash("sha256").update(value).digest("hex");
export const hashValue = (value) => hashBytes(JSON.stringify(value));

export function hashWorkingTreePatch(root) {
    return new Promise((resolve, reject) => {
        const digest = createHash("sha256");
        const child = spawn("git", ["--no-pager", "diff", "--binary", "HEAD"], {
            cwd: root,
            windowsHide: true,
            stdio: ["ignore", "pipe", "pipe"],
        });
        let diagnostic = "";
        child.stdout.on("data", (chunk) => digest.update(chunk));
        child.stderr.on("data", (chunk) => {
            diagnostic = (diagnostic + chunk.toString()).slice(0, 8192);
        });
        child.once("error", reject);
        child.once("close", (code, signal) => {
            if (code === 0) resolve(digest.digest("hex"));
            else
                reject(
                    new Error(
                        `Git patch identity failed (${code ?? signal}): ${diagnostic}`,
                    ),
                );
        });
    });
}

export function positiveInteger(value, fallback, name) {
    if (value === undefined) return fallback;
    const number = Number(value);
    assert.ok(Number.isSafeInteger(number) && number > 0, `Invalid ${name}`);
    return number;
}

export async function loadCapturedTopicInput(values) {
    assert.ok(
        Boolean(values.input) !== Boolean(values.history),
        "Choose --input or --history",
    );
    let input, state;
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
    assert.ok(
        Array.isArray(input.topicInput?.occurrences),
        "Complete captured topic incidence is required",
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
    const frozenInput = structuredClone(input);
    delete frozenInput.topicInput.reusableCuration;
    return {
        input,
        state,
        inputHash: hashValue(frozenInput),
        retainedCurationHash: state?.topics?.curationProgress
            ? hashValue(state.topics.curationProgress)
            : null,
    };
}

function within(parent, child) {
    const relative = path.relative(parent, child);
    return (
        relative === "" ||
        (!relative.startsWith(`..${path.sep}`) &&
            relative !== ".." &&
            !path.isAbsolute(relative))
    );
}

export async function createReplayOutput(output, sourceStore) {
    assert.ok(output, "--output must name a new private artifact directory");
    const target = path.join(
        await realpath(path.dirname(path.resolve(output))),
        path.basename(output),
    );
    if (sourceStore)
        assert.ok(
            !within(await realpath(sourceStore), target),
            "Output must be outside the original view-store directory",
        );
    await mkdir(target);
    return target;
}

export async function atomicWriteJson(file, value, signal) {
    const staging = `${file}.${randomUUID()}.partial`;
    try {
        signal?.throwIfAborted();
        await writeFile(staging, JSON.stringify(value, null, 2), {
            flag: "wx",
        });
        signal?.throwIfAborted();
        await rename(staging, file);
    } finally {
        await rm(staging, { force: true });
    }
}

export function assertReplayIdentity(actual, expected) {
    assert.deepEqual(
        JSON.parse(JSON.stringify(actual)),
        JSON.parse(JSON.stringify(expected)),
        "Replay identity does not match frozen input, implementation, model or policy",
    );
}

export async function readReplayProgress(file, identity, validate) {
    const progress = JSON.parse(await readFile(file, "utf8"));
    assert.equal(progress.schemaVersion, 1);
    assertReplayIdentity(progress.identity, identity);
    validate(progress.curation);
    assert.equal(
        progress.curationHash,
        hashValue(progress.curation),
        "Replay progress curation changed",
    );
    assert.equal(
        progress.stateHash,
        hashValue({
            curation: progress.curation,
            occurrences: progress.occurrences,
        }),
        "Replay progress state or occurrence cursor changed",
    );
    assert.ok(
        Object.values(progress.occurrences ?? {}).every(
            (value) => Number.isSafeInteger(value) && value >= 0,
        ),
        "Invalid replay progress occurrence cursor",
    );
    return progress;
}

export async function writeReplayProgress(
    file,
    identity,
    curation,
    extra = {},
    signal,
) {
    await atomicWriteJson(
        file,
        {
            ...extra,
            schemaVersion: 1,
            identity,
            curation,
            curationHash: hashValue(curation),
            stateHash: hashValue({ curation, occurrences: extra.occurrences }),
        },
        signal,
    );
}

export function curationAccounting(curation, nodeIds) {
    const admitted =
        curation?.concepts.flatMap((concept) => concept.memberIds) ?? [];
    const deferred = curation?.deferred.map((entry) => entry.nodeId) ?? [];
    const pending = curation?.pending?.map((entry) => entry.nodeId) ?? [];
    const accounted = [...admitted, ...deferred, ...pending];
    assert.equal(
        new Set(accounted).size,
        accounted.length,
        "Duplicate curation accounting",
    );
    const expected = new Set(nodeIds);
    assert.ok(
        accounted.every((id) => expected.has(id)),
        "Unknown accounted node",
    );
    const maintenance =
        curation?.concepts
            .filter((concept) => concept.maintenance)
            .map((concept) => ({
                conceptId: concept.id,
                ...concept.maintenance,
            })) ?? [];
    return {
        admitted: admitted.length,
        deferred: deferred.length,
        pending: pending.length,
        unassigned: nodeIds.length - accounted.length,
        assignmentsResolved:
            pending.length === 0 && accounted.length === nodeIds.length,
        maintenance,
        maintenanceComplete:
            maintenance.length === 0 &&
            pending.length === 0 &&
            accounted.length === nodeIds.length,
    };
}

export async function compiledFileHashes(root, files) {
    return Object.fromEntries(
        await Promise.all(
            files.map(async (file) => [
                file,
                hashBytes(await readFile(path.join(root, ...file.split("/")))),
            ]),
        ),
    );
}

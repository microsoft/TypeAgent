// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

// Synthetic CLI evidence only: the allow-list filter and in-memory destination
// below are fixture adapters, not a production privacy policy or durable queue.
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { format } from "node:util";
import { SessionWatcher } from "../dist/sessionWatcher.js";

const directory = await fs.mkdtemp(path.join(os.tmpdir(), "git-story-demo-"));
const request = {
    projectPath: directory,
    sessionId: "synthetic-cli-session",
    transcriptPath: path.join(directory, "events.jsonl"),
    metadata: { clientName: "copilot-cli", models: ["seed"] },
};
const delivered = [];
const instances = [];
const secret = "fixture-private-evidence";

function report(...values) {
    process.stdout.write(format(...values) + "\n");
}

function fixtureAllowList(update) {
    return {
        projectPath: "[fixture-project]",
        sessionId: "synthetic-cli-session",
        events: update.events.map((event) => ({
            id: event.id,
            ...(event.sourceEventId !== undefined
                ? { sourceEventId: event.sourceEventId }
                : {}),
            type: "message",
            role: "system",
            text: "[redacted]",
        })),
        metadata: {
            clientName: "fixture-approved",
            models: update.metadata.models.includes("history-model")
                ? ["history-observed"]
                : [],
        },
    };
}

function create(destination = (update) => delivered.push(update)) {
    const watcher = new SessionWatcher({
        privacyFilter: fixtureAllowList,
        approvedUpdateDestination: destination,
        capture: {
            stateDirectory: path.join(directory, "capture"),
            maxRecords: 2,
        },
        reconcileIntervalMs: 25,
    });
    instances.push(watcher);
    return watcher;
}

async function append(...records) {
    await fs.appendFile(
        request.transcriptPath,
        records.map((record) => JSON.stringify(record) + "\n").join(""),
    );
}

function message(id) {
    return {
        ...(id === undefined ? {} : { id }),
        type: "user.message",
        data: { content: secret },
    };
}

async function until(predicate) {
    const deadline = Date.now() + 5000;
    while (!predicate()) {
        assert(Date.now() < deadline, "Timed out waiting for fixture append");
        await delay(10);
    }
}

function events() {
    return delivered.flatMap((update) => update.events);
}

try {
    const first = create();
    await first.watch(request);
    assert.equal(first.getStatus(request).phase, "waiting");
    assert.equal(first.getStatus(request).monitoring, true);
    report(
        "START: monitoring established; absent transcript explicitly waiting",
    );

    await append(
        {
            type: "session.start",
            data: { selectedModel: "history-model", parentSessionId: secret },
        },
        message("native-fixture-id"),
        message(),
        message(),
        message(),
    );
    await until(() => events().length === 5);
    assert(delivered.every((update) => update.events.length <= 2));
    assert.equal(events()[1].id, "native-fixture-id");
    assert.equal(events()[1].sourceEventId, "native-fixture-id");
    report("APPEND: five real JSONL records drained in batches of at most two");
    assert(!JSON.stringify(delivered).includes(secret));
    report("REDACTED OUTPUT:", JSON.stringify(delivered[0]));

    const firstIds = new Set(events().map((event) => event.id));
    await first.stop();
    const stoppedCount = events().length;
    await append(message("resume-id"));
    await delay(75);
    assert.equal(events().length, stoppedCount);
    report("STOP: notifications closed; post-stop append not processed");

    const resumed = create();
    await resumed.watch(request);
    assert.equal(events().length, 6);
    assert.equal(events()[5].id, "resume-id");
    assert(!firstIds.has(events()[5].id));
    assert.deepEqual(delivered.at(-1).metadata.models, ["history-observed"]);
    await resumed.processUpdates(request);
    await resumed.stop();
    report(
        "RESUME: only new event delivered; prior metadata restored without old-event publication",
    );

    await append(message(), message(), message("after-failure"));
    const failing = create(() => {
        throw new Error(secret);
    });
    await assert.rejects(failing.processUpdates(request), /delivery failed/);
    const failure = failing.getStatus(request).failure;
    assert.equal(failure.stage, "delivery");
    assert.equal(failure.captureMayHaveAdvanced, true);
    const failedCheckpoint = failing.getStatus(request).readCheckpoint;
    await assert.rejects(failing.processUpdates(request), /delivery failed/);
    assert.deepEqual(
        failing.getStatus(request).readCheckpoint,
        failedCheckpoint,
    );
    await failing.stop();
    assert.deepEqual(failing.getStatus(request).failure, failure);
    report(
        "FAILURE: source halted after capture; later processing blocked; explicit delivery failure retained after stop",
    );

    assert(!JSON.stringify(delivered).includes(secret));
    await failing.stop();
    report(
        "PASS: start / append / whole-update redaction / stop / ordinary resume / explicit failure assertions",
    );
} finally {
    await Promise.all(instances.map((watcher) => watcher.stop()));
    await fs.rm(directory, { recursive: true, force: true });
}

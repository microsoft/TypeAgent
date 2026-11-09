// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

// Synthetic-only smoke: never reads a real Copilot transcript.
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { spawn, execFile } from "node:child_process";
import { promisify } from "node:util";
import { setTimeout as delay } from "node:timers/promises";

const script = fileURLToPath(
    new URL("./liveSessionWatcherDemo.mjs", import.meta.url),
);
const root = await fs.mkdtemp(path.join(os.tmpdir(), "git-story-live-smoke-"));
const transcript = path.join(root, "synthetic.jsonl");
const output = path.join(root, "evidence");
const secret = "DO-NOT-PUBLISH-private-tool-and-message";
const record = (id, content) =>
    JSON.stringify({
        id,
        type: "user.message",
        timestamp: "2026-10-06T00:00:00.000Z",
        data: { content },
    }) + "\n";
let child;
let completed;
const logs = [];
let stderr = "";
async function until(check) {
    const deadline = Date.now() + 20000;
    while (!(await check())) {
        assert(
            Date.now() < deadline,
            "Timed out waiting for live proof evidence",
        );
        await delay(40);
    }
}
async function shutdownFailure(mode) {
    const evidence = path.join(root, mode);
    const audit = path.join(root, `${mode}-audit.json`);
    const preload = path.join(root, `${mode}-preload.mjs`);
    // Inject only in the harness process, never the real daemon child. All HTTP
    // calls still execute; the audit records no URLs, headers or payloads.
    await fs.writeFile(
        preload,
        `
    import fs from "node:fs";
    import promises from "node:fs/promises";
    const append = promises.appendFile;
    const fetch = globalThis.fetch;
    const baseline = [process.listenerCount("SIGINT"), process.listenerCount("SIGTERM")];
    let stopping = false, injected = false, stopCalls = 0;
    promises.appendFile = async (file, data, ...args) => {
        if (String(file).endsWith("proof.jsonl") && String(data).includes('"kind":"STOPPING"')) stopping = true;
        const target = ${JSON.stringify(mode)} === "stopping"
            ? String(file).endsWith("proof.jsonl") && String(data).includes('"kind":"STOPPING"')
            : stopping && String(file).endsWith("receipts.jsonl");
        if (target && !injected) {
            injected = true;
            throw Object.assign(new Error("PRIVATE-ENOSPC-DETAILS"), {code: "ENOSPC"});
        }
        return append(file, data, ...args);
    };
    globalThis.fetch = (...args) => {
        if (String(args[0]).endsWith("/api/daemon/stop")) stopCalls++;
        return fetch(...args);
    };
    process.on("exit", () => fs.writeFileSync(${JSON.stringify(audit)}, JSON.stringify({
        injected, stopCalls,
        listenersRemoved: process.listenerCount("SIGINT") === baseline[0] &&
            process.listenerCount("SIGTERM") === baseline[1],
    })));
    `,
    );
    let result;
    try {
        await promisify(execFile)(
            process.execPath,
            [
                "--import",
                pathToFileURL(preload).href,
                script,
                "--session",
                "synthetic",
                "--transcript",
                transcript,
                "--output-dir",
                evidence,
                "--duration",
                "1",
                "--batch-size",
                "2",
            ],
            { timeout: 25000, encoding: "utf8" },
        );
        assert.fail("Injected evidence failure must exit nonzero");
    } catch (error) {
        result = error;
    }
    assert.equal(result.code, 1, result.stderr);
    assert.match(
        result.stderr,
        /Shutdown evidence write failed; daemon cleanup continues/,
    );
    assert(!result.stderr.includes("PRIVATE-ENOSPC-DETAILS"));
    const check = JSON.parse(await fs.readFile(audit, "utf8"));
    assert.deepEqual(check, {
        injected: true,
        stopCalls: 1,
        listenersRemoved: true,
    });
    const proof = (
        await fs.readFile(path.join(evidence, "proof.jsonl"), "utf8")
    )
        .trim()
        .split("\n")
        .map(JSON.parse);
    assert(
        proof.some(
            (row) =>
                row.kind === "STOPPED" &&
                row.exitCode === 0 &&
                row.events === 6,
        ),
    );
    await assert.rejects(
        fs.stat(proof.find((row) => row.kind === "CONFIG").state),
        { code: "ENOENT" },
    );
    process.stdout.write(
        `PASS: injected ${mode} evidence failure exits1, authenticated stop called, daemon drained/exited0, signal listeners removed, operational state cleaned.\n`,
    );
}
try {
    const exec = promisify(execFile);
    assert.match(
        (await exec(process.execPath, [script, "--help"])).stdout,
        /--session/,
    );
    await assert.rejects(exec(process.execPath, [script]), (error) =>
        error.stderr.includes("Supply --session"),
    );
    await fs.writeFile(
        transcript,
        record("history-id", secret) +
            JSON.stringify({
                id: "assistant-id",
                type: "assistant.message",
                data: { content: secret },
            }) +
            "\n" +
            JSON.stringify({
                id: "tool-id",
                type: "tool.execution_start",
                data: {
                    toolCallId: "tool-call",
                    toolName: "private-tool-name",
                    arguments: { token: secret },
                },
            }) +
            "\n",
    );
    await assert.rejects(
        exec(process.execPath, [
            script,
            "--session",
            "synthetic",
            "--transcript",
            transcript,
            "--max-history-bytes",
            "1",
        ]),
        (error) => error.stderr.includes("exceeds --max-history-bytes"),
    );
    child = spawn(
        process.execPath,
        [
            script,
            "--session",
            "synthetic",
            "--transcript",
            transcript,
            "--output-dir",
            output,
            "--duration",
            "8",
            "--batch-size",
            "2",
        ],
        { stdio: ["ignore", "pipe", "pipe"], windowsHide: true },
    );
    let tail = "";
    child.stdout.on("data", (chunk) => {
        tail += chunk;
        let end;
        while ((end = tail.indexOf("\n")) >= 0) {
            logs.push(JSON.parse(tail.slice(0, end)));
            tail = tail.slice(end + 1);
        }
    });
    child.stderr.on("data", (chunk) => {
        stderr += chunk;
    });
    completed = new Promise((resolve, reject) => {
        child.once("error", reject);
        child.once("exit", resolve);
    });
    await until(() => logs.some((row) => row.kind === "LIVE"));
    await fs.appendFile(
        transcript,
        record("marker-one", "LIVE-WATCHER-CHECK-first"),
    );
    await until(() =>
        logs.some(
            (row) => row.kind === "MARKER" && row.nativeId === "marker-one",
        ),
    );
    // A marker must not end the run. A second later marker also gets its exact native ID.
    const partial = record("marker-two", "LIVE-WATCHER-CHECK-second");
    await fs.appendFile(transcript, partial.slice(0, -1));
    await delay(500);
    assert(!logs.some((row) => row.nativeId === "marker-two"));
    await fs.appendFile(transcript, "\n" + record("sensitive", secret));
    await until(() =>
        logs.some(
            (row) => row.kind === "MARKER" && row.nativeId === "marker-two",
        ),
    );
    assert.equal(await completed, 0, stderr);
    const proof = await fs.readFile(path.join(output, "proof.jsonl"), "utf8");
    const text = await fs.readFile(path.join(output, "batches.jsonl"), "utf8");
    assert(!text.includes(secret));
    assert(!proof.includes(secret));
    assert(!stderr.includes(secret));
    const rows = text.trim().split("\n").map(JSON.parse);
    assert.deepEqual(
        rows.map((row) => row.batch),
        rows.map((_, i) => i + 1),
    );
    assert(rows.every((row) => row.eventCount <= 2));
    assert.deepEqual(
        rows.flatMap((row) => row.events).map((event) => event.id),
        [
            "history-id",
            "assistant-id",
            "tool-id",
            "marker-one",
            "marker-two",
            "sensitive",
        ],
    );
    const markers = logs.filter((row) => row.kind === "MARKER");
    assert.deepEqual(
        markers.map((row) => [row.nativeId, row.marker]),
        [
            ["marker-one", "LIVE-WATCHER-CHECK-first"],
            ["marker-two", "LIVE-WATCHER-CHECK-second"],
        ],
    );
    for (const marker of markers)
        assert(
            rows
                .find((row) => row.batch === marker.batch)
                .events.some(
                    (event) =>
                        event.nativeId === marker.nativeId &&
                        event.marker === marker.marker,
                ),
        );
    assert(
        logs.some(
            (row) =>
                row.kind === "STOPPED" && row.events === 6 && row.markers === 2,
        ),
    );
    await assert.rejects(
        fs.stat(logs.find((row) => row.kind === "CONFIG").state),
        { code: "ENOENT" },
    );
    assert(
        (
            await fs.readFile(path.join(output, "receipts.jsonl"), "utf8")
        ).includes('"monitoring":true'),
    );
    for (const row of logs.filter((row) =>
        ["REGISTERED", "LIVE", "MARKER", "STOPPED"].includes(row.kind),
    ))
        process.stdout.write(JSON.stringify(row) + "\n");
    process.stdout.write(JSON.stringify({ approvedBatches: rows }) + "\n");
    process.stdout.write(
        "PASS: synthetic actual daemon/HTTP/privacy/log; initial history, two post-ready markers with native IDs, withheld partial line, all batches retained, bounded counts, finite graceful shutdown, no raw private content.\n",
    );
    await shutdownFailure("stopping");
    await shutdownFailure("receipt");
} finally {
    if (completed) await completed;
    await fs.rm(root, { recursive: true, force: true });
}

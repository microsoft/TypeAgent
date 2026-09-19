// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import assert from "node:assert/strict";
import test from "node:test";
import {
    MAX_COMMAND_BYTES,
    WorkspaceCommandRunner,
} from "../workspaceCommandRunner.js";

test("runs a requested command and returns separate structured streams", async () => {
    const runner = new WorkspaceCommandRunner();
    const result = await runner.run({
        command: `node -e "console.log('out'); console.error('err')"`,
        cwd: process.cwd(),
        executionId: "streams",
    });
    assert.ok(!("error" in result));
    assert.ok(!("error" in result));
    assert.equal(result.success, true);
    assert.equal(result.exitCode, 0);
    assert.equal(result.timedOut, false);
    assert.equal(result.cancelled, false);
    assert.match(result.stdout.text, /out/);
    assert.match(result.stderr.text, /err/);
});

test("reports a timed-out process", async () => {
    const runner = new WorkspaceCommandRunner();
    const result = await runner.run({
        command: `node -e "setTimeout(() => {}, 10000)"`,
        cwd: process.cwd(),
        timeoutMs: 50,
    });

    assert.ok(!("error" in result));
    assert.equal(result.success, false);
    assert.equal(result.timedOut, true);
    assert.equal(result.cancelled, false);
});

test("rejects an oversized command before spawning", async () => {
    const runner = new WorkspaceCommandRunner();
    const result = await runner.run({
        command: "x".repeat(MAX_COMMAND_BYTES + 1),
        cwd: process.cwd(),
    });

    assert.deepEqual(result, {
        error: `Command exceeds the ${MAX_COMMAND_BYTES}-byte limit.`,
    });
});

test("tracks concurrent commands separately by execution ID", async () => {
    const runner = new WorkspaceCommandRunner();
    const [first, second] = await Promise.all([
        runner.run({
            command: `node -e "console.log('first')"`,
            cwd: process.cwd(),
            executionId: "first",
        }),
        runner.run({
            command: `node -e "console.log('second')"`,
            cwd: process.cwd(),
            executionId: "second",
        }),
    ]);

    assert.ok(!("error" in first));
    assert.ok(!("error" in second));
    assert.match(first.stdout.text, /first/);
    assert.match(second.stdout.text, /second/);
});

test("preserves a quoted Windows executable path", async () => {
    if (process.platform !== "win32") {
        return;
    }
    const runner = new WorkspaceCommandRunner();
    const result = await runner.run({
        command: `"${process.execPath}" -e "console.log('quoted-exe')"`,
        cwd: process.cwd(),
    });

    assert.ok(!("error" in result));
    assert.equal(result.success, true);
    assert.match(result.stdout.text, /quoted-exe/);
});

test("cancels an active command by execution ID", async () => {
    const runner = new WorkspaceCommandRunner();
    const pending = runner.run({
        command: `node -e "setTimeout(() => {}, 10000)"`,
        cwd: process.cwd(),
        executionId: "cancel-me",
    });
    await new Promise((resolve) => setTimeout(resolve, 100));

    assert.equal(runner.cancel("cancel-me"), "cancelled");
    const result = await pending;
    assert.ok(!("error" in result));
    assert.equal(result.success, false);
    assert.equal(result.cancelled, true);
    assert.equal(result.timedOut, false);
});

test("honors cancellation received before command registration", async () => {
    const runner = new WorkspaceCommandRunner();
    assert.equal(runner.cancel("cancel-before-run", true), "pending");
    const result = await runner.run({
        command: `node -e "console.log('must not run')"`,
        cwd: process.cwd(),
        executionId: "cancel-before-run",
    });

    assert.ok(!("error" in result));
    assert.equal(result.success, false);
    assert.equal(result.cancelled, true);
    assert.equal(result.stdout.text, "");
});

test("does not arm an unknown ordinary cancellation request", () => {
    const runner = new WorkspaceCommandRunner();
    assert.equal(runner.cancel("unknown"), "notFound");
});

test("consumes a pending cancellation before command validation", async () => {
    const runner = new WorkspaceCommandRunner();
    assert.equal(runner.cancel("cancel-invalid", true), "pending");
    const result = await runner.run({
        command: "",
        cwd: process.cwd(),
        executionId: "cancel-invalid",
    });

    assert.ok(!("error" in result));
    assert.equal(result.cancelled, true);
});

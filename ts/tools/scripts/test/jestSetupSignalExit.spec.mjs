// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";
import { runInNewContext } from "node:vm";

const setupSource = readFileSync(
    new URL("../jestSetupSignalExit.cjs", import.meta.url),
    "utf8",
);
const dispatcherRequire = createRequire(
    new URL(
        "../../../packages/dispatcher/dispatcher/package.json",
        import.meta.url,
    ),
);
const lockfileRequire = createRequire(
    dispatcherRequire.resolve("proper-lockfile"),
);
const signalExitPath = lockfileRequire.resolve("signal-exit");
const signalExitSource = readFileSync(signalExitPath, "utf8");
const signalExitRequire = createRequire(signalExitPath);

for (const ownEmit of [false, true]) {
    test(`keeps process exports stable with ${ownEmit ? "own" : "inherited"} emit`, () => {
        // Never install signal handlers on the host process or invoke real exit.
        const fakeProcess = Object.assign(new EventEmitter(), {
            platform: process.platform,
            pid: 1,
            kill() {
                assert.fail("Unexpected signal");
            },
            reallyExit() {
                assert.fail("Unexpected exit");
            },
        });
        if (ownEmit) {
            fakeProcess.emit = fakeProcess.emit;
        }
        const originalEmit = fakeProcess.emit;
        const originalReallyExit = fakeProcess.reallyExit;
        const sandbox = {
            process: fakeProcess,
            require: signalExitRequire,
            module: { exports: {} },
        };
        sandbox.global = sandbox;
        const setup = () =>
            runInNewContext(`(function () {\n${setupSource}\n})();`, sandbox);
        setup();
        const emitter = fakeProcess.__signal_exit_emitter__;
        const exportNames = Object.keys(fakeProcess);
        const assertStableExports = () =>
            assert.deepEqual(Object.keys(fakeProcess), exportNames);

        runInNewContext(signalExitSource, sandbox);
        let exitCalls = 0;
        const remove = sandbox.module.exports(() => exitCalls++);
        assert.notEqual(fakeProcess.emit, originalEmit);
        assertStableExports();

        // Loading setup again must preserve installed wrappers and the emitter.
        const wrappedEmit = fakeProcess.emit;
        setup();
        assert.equal(fakeProcess.emit, wrappedEmit);
        assert.equal(fakeProcess.__signal_exit_emitter__, emitter);
        assertStableExports();

        let forwarded;
        fakeProcess.on("fixture", (value) => (forwarded = value));
        fakeProcess.emit("fixture", 42);
        assert.equal(forwarded, 42);
        assert.equal(exitCalls, 0);
        fakeProcess.emit("exit");
        assert.equal(exitCalls, 1);
        remove();
        assert.equal(fakeProcess.emit, originalEmit);
        assert.equal(fakeProcess.reallyExit, originalReallyExit);
        assert.equal(emitter.count, 0);
        assertStableExports();
    });
}

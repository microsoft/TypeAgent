// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import assert from "node:assert/strict";
import fileSystem from "node:fs/promises";
import { syncBuiltinESMExports } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { writeJson } from "./harness.mjs";

async function fixture(t, failures) {
    const directory = await fileSystem.mkdtemp(
        path.join(tmpdir(), "memory-state-"),
    );
    const file = path.join(directory, "state.json");
    await fileSystem.writeFile(file, JSON.stringify({ previous: true }));
    const rename = fileSystem.rename;
    let attempts = 0;
    t.mock.method(fileSystem, "rename", async (...args) => {
        attempts++;
        if (attempts <= failures.length) throw failures[attempts - 1];
        return rename(...args);
    });
    syncBuiltinESMExports();
    t.after(async () => {
        t.mock.restoreAll();
        syncBuiltinESMExports();
        await fileSystem.rm(directory, { recursive: true, force: true });
    });
    return { file, attempts: () => attempts };
}

function failure(code) {
    return Object.assign(new Error(`Injected ${code} publication failure`), {
        code,
        syscall: "rename",
    });
}

test("JSON state publication retries Windows sharing failures without losing old state", async (t) => {
    const errors = [failure("EPERM"), failure("EBUSY")];
    const { file, attempts } = await fixture(t, errors);
    if (process.platform === "win32") {
        await writeJson(file, { current: true });
        assert.equal(attempts(), 3);
        assert.deepEqual(JSON.parse(await fileSystem.readFile(file, "utf8")), {
            current: true,
        });
    } else {
        await assert.rejects(
            writeJson(file, { current: true }),
            (error) => error === errors[0],
        );
        assert.equal(attempts(), 1);
        assert.deepEqual(JSON.parse(await fileSystem.readFile(file, "utf8")), {
            previous: true,
        });
    }
});

test("Persistent publication failure remains explicit and preserves the last good state", async (t) => {
    const error = failure("EACCES");
    const { file, attempts } = await fixture(t, Array(5).fill(error));
    await assert.rejects(
        writeJson(file, { current: true }),
        (actual) => actual === error,
    );
    assert.equal(attempts(), process.platform === "win32" ? 5 : 1);
    assert.deepEqual(JSON.parse(await fileSystem.readFile(file, "utf8")), {
        previous: true,
    });
});

test("Non-sharing publication errors are never retried or hidden", async (t) => {
    const error = failure("ENOSPC");
    const { file, attempts } = await fixture(t, [error]);
    await assert.rejects(
        writeJson(file, { current: true }),
        (actual) => actual === error,
    );
    assert.equal(attempts(), 1);
    assert.deepEqual(JSON.parse(await fileSystem.readFile(file, "utf8")), {
        previous: true,
    });
});

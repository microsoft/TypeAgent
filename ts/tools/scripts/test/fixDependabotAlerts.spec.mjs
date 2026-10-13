// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { readAlertsSnapshot } from "../fix-dependabot-alerts.mjs";

test("readAlertsSnapshot reads an alert array", () => {
    const directory = mkdtempSync(join(tmpdir(), "dependabot-alerts-"));
    const file = join(directory, "alerts.json");
    const expected = [{ number: 1 }, { number: 2 }];

    try {
        writeFileSync(file, JSON.stringify(expected));
        assert.deepEqual(readAlertsSnapshot(file), expected);
    } finally {
        rmSync(directory, { recursive: true, force: true });
    }
});

test("readAlertsSnapshot rejects non-array JSON", () => {
    const directory = mkdtempSync(join(tmpdir(), "dependabot-alerts-"));
    const file = join(directory, "alerts.json");

    try {
        writeFileSync(file, JSON.stringify({ number: 1 }));
        assert.throws(
            () => readAlertsSnapshot(file),
            /must contain a JSON array/,
        );
    } finally {
        rmSync(directory, { recursive: true, force: true });
    }
});

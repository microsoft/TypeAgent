// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

test("relocated live entry points reject historical models before creating run state", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "eval-entrypoints-"));
    try {
        const ledger = path.join(root, "ledger.json");
        fs.writeFileSync(
            ledger,
            JSON.stringify({
                version: 1,
                model: "gpt-5.6-sol",
                capNanoAiu: 50000,
                openingNanoAiu: 0,
                headroomNanoAiu: 0,
                requestMaximumNanoAiu: 1,
                reservations: [],
            }),
        );
        const output = path.join(root, "must-not-exist");
        for (const [script, args] of [
            ["ghcp-eval.mjs", ["unused-cli", root, output, root, ledger]],
            ["ghcp-eval-preflight.mjs", [output, root, ledger]],
            ["ghcp-credit-probe.mjs", ["unused-cli", ledger, output]],
        ]) {
            const result = spawnSync(
                process.execPath,
                [
                    fileURLToPath(new URL(`../${script}`, import.meta.url)),
                    ...args,
                ],
                { encoding: "utf8", timeout: 30000 },
            );
            assert.ifError(result.error);
            assert.equal(result.status, 1, result.stderr);
            assert.match(
                result.stderr,
                /Evaluation requires a ledger for gpt-5.6-luna/,
            );
            assert.equal(fs.existsSync(output), false);
        }
    } finally {
        fs.rmSync(root, { recursive: true, force: true });
    }
});

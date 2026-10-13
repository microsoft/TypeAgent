// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";
import {
    parsePackageSelection,
    readAlertsSnapshot,
    selectPackages,
} from "../fix-dependabot-alerts.mjs";

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

test("package selection isolates one fixable package from another failure", () => {
    const succeeds = {
        package: "package-succeeds",
        expectedOutcome: "resolved",
    };
    const fails = {
        package: "package-fails",
        expectedOutcome: "blocked",
    };
    const packages = new Map([
        [succeeds.package, succeeds],
        [fails.package, fails],
    ]);
    assert.equal(
        parsePackageSelection({ argv: ["--auto-fix=package-succeeds"] }),
        null,
        "--auto-fix permissions must not implicitly select a package",
    );
    const selection = parsePackageSelection({
        argv: ["--auto-fix=package-succeeds", "--package=package-succeeds"],
    });

    assert.equal(selectPackages(packages, null), packages);
    assert.deepEqual(
        [...selectPackages(packages, selection).values()],
        [succeeds],
    );
});

test("workflow rolls back dirty nonzero package attempts before verification", () => {
    const workflow = readFileSync(
        resolve(
            import.meta.dirname,
            "../../../../.github/workflows/fix-dependabot-alerts.yml",
        ),
        "utf-8",
    );
    const failureStart = workflow.indexOf('if [ "$fix_exit" -ne 0 ]; then');
    const verificationStart = workflow.indexOf(
        "if attempt_has_changes; then",
        failureStart,
    );

    assert.notEqual(failureStart, -1);
    assert.ok(verificationStart > failureStart);
    const failureBlock = workflow.slice(failureStart, verificationStart);
    assert.match(failureBlock, /rollback_attempt/);
    assert.match(failureBlock, /restore_dependencies/);
    assert.match(failureBlock, /continue/);
    assert.doesNotMatch(failureBlock, /if attempt_has_changes/);
    assert.match(workflow, /filtered_args\+=\("--package=\$PKG"\)/);
});

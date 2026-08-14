// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

const failureDirectory = fs.mkdtempSync(
    path.join(os.tmpdir(), "typeagent-test-failures-"),
);
const [testCommand, testArguments] =
    process.platform === "win32"
        ? [
              process.env.ComSpec ?? "cmd.exe",
              ["/d", "/s", "/c", "pnpm run test:local"],
          ]
        : ["pnpm", ["run", "test:local"]];

const result = spawnSync(testCommand, testArguments, {
    env: {
        ...process.env,
        TYPEAGENT_TEST_FAILURES_DIR: failureDirectory,
    },
    stdio: "inherit",
});

try {
    printFailureSummary(failureDirectory, result.status);
} finally {
    fs.rmSync(failureDirectory, { recursive: true, force: true });
}

if (result.error !== undefined) {
    throw result.error;
}
if (result.signal !== null) {
    process.kill(process.pid, result.signal);
}
process.exitCode = result.status ?? 1;

function printFailureSummary(directory, exitCode) {
    const failures = fs
        .readdirSync(directory)
        .filter((fileName) => fileName.endsWith(".json"))
        .flatMap((fileName) =>
            JSON.parse(fs.readFileSync(path.join(directory, fileName), "utf8")),
        );
    const uniqueFailures = [
        ...new Map(
            failures.map((failure) => [JSON.stringify(failure), failure]),
        ).values(),
    ];

    if (uniqueFailures.length === 0) {
        if (exitCode !== 0) {
            console.error(
                "\nFAILED TEST SUMMARY\nNo individual test failures were captured. See the test output above.",
            );
        }
        return;
    }

    console.error(
        `\n${"=".repeat(80)}\nFAILED TEST SUMMARY (${uniqueFailures.length})\n${"=".repeat(80)}`,
    );
    for (const failure of uniqueFailures) {
        console.error(`\nFAIL ${normalizePath(failure.testFilePath)}`);
        console.error(`  ${failure.fullName}`);
        for (const message of failure.failureMessages) {
            console.error(indent(stripAnsi(message), 4));
        }
    }
    console.error(`\n${"=".repeat(80)}`);
}

function normalizePath(filePath) {
    return path.relative(process.cwd(), filePath).replaceAll("\\", "/");
}

function stripAnsi(value) {
    return value.replace(
        /[\u001B\u009B][[\]()#;?]*(?:(?:(?:[a-zA-Z\d]*(?:;[-a-zA-Z\d/#&.:=?%@~_]+)*)?\u0007)|(?:(?:\d{1,4}(?:[;:]\d{0,4})*)?[\dA-PR-TZcf-nq-uy=><~]))/g,
        "",
    );
}

function indent(value, spaces) {
    const prefix = " ".repeat(spaces);
    return value
        .trimEnd()
        .split(/\r?\n/u)
        .map((line) => `${prefix}${line}`)
        .join("\n");
}

// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

// Pure helpers for the flaky-test retry harness (runTestLocalWithSummary.mjs).
// Kept side-effect free so they can be unit tested with node:test.

import path from "node:path";

// Convert a possibly-file:// path into a plain filesystem path. Done manually
// (rather than url.fileURLToPath) because on Windows fileURLToPath throws for a
// driveless URL like file:///repo/..., and reporters run on all three OSes.
export function toFsPath(filePath) {
    if (typeof filePath !== "string" || !filePath.startsWith("file://")) {
        return filePath;
    }
    let decoded;
    try {
        decoded = decodeURIComponent(filePath.slice("file://".length));
    } catch {
        decoded = filePath.slice("file://".length);
    }
    // Strip the leading slash before a Windows drive letter (/C:/x -> C:/x).
    return /^\/[A-Za-z]:/.test(decoded) ? decoded.slice(1) : decoded;
}

// Turn a reporter-provided test file path into a stable, comparable string.
// Reporters emit absolute paths (jest) or file:// URLs / source paths (node
// --test). We normalize to a forward-slash path relative to the workspace so
// the same test produces the same key across both retry rounds.
export function normalizeTestFilePath(filePath, cwd = process.cwd()) {
    if (typeof filePath !== "string" || filePath.length === 0) {
        return String(filePath);
    }
    const resolved = toFsPath(filePath);
    const absolute = path.isAbsolute(resolved)
        ? resolved
        : path.resolve(cwd, resolved);
    const relative = path.relative(cwd, absolute);
    const chosen =
        relative.startsWith("..") || path.isAbsolute(relative)
            ? absolute
            : relative;
    return chosen.replaceAll("\\", "/");
}

// Identity of a failing test: file + full test name. Ignores the failure
// message so the same test matches across rounds even if the message differs.
export function failureKey(failure, cwd = process.cwd()) {
    return `${normalizeTestFilePath(failure.testFilePath, cwd)}\n${failure.fullName}`;
}

// Collapse duplicate reports of the same test (a reporter can emit the same
// failure more than once) to one entry, keeping the first message seen and
// attaching the computed key.
export function dedupeFailures(failures, cwd = process.cwd()) {
    const byKey = new Map();
    for (const failure of failures) {
        const key = failureKey(failure, cwd);
        if (!byKey.has(key)) {
            byKey.set(key, { ...failure, key });
        }
    }
    return [...byKey.values()];
}

// Walk up from a test file to the nearest package directory, without escaping
// the workspace root. isPackageDir(dir) reports whether dir holds a
// package.json; injecting it keeps this testable without touching the fs.
export function findPackageDir(testFilePath, workspaceRoot, isPackageDir) {
    const root = path.resolve(workspaceRoot);
    let dir = path.dirname(path.resolve(testFilePath));
    const relativeToRoot = path.relative(root, dir);
    if (relativeToRoot.startsWith("..") || path.isAbsolute(relativeToRoot)) {
        return undefined;
    }
    while (true) {
        // Stop before the workspace root so we never treat the root package as
        // the owner of a test (its script reruns the whole suite).
        if (path.resolve(dir) === root) {
            return undefined;
        }
        if (isPackageDir(dir)) {
            return dir;
        }
        const parent = path.dirname(dir);
        if (parent === dir) {
            return undefined;
        }
        dir = parent;
    }
}

// Compare the two rounds and bucket every failure.
//   confirmed      - failed round 1 and again on the isolated retry (real bug)
//   flakyRecovered - failed round 1, passed on retry (flaky, not fatal)
//   newOnRetry     - passed round 1, failed on retry (unstable, not fatal)
//   unretriable    - round 1 failure with no owning package to rerun (fatal)
// first entries carry a `package` field (string) or undefined when unretriable.
// retryTrusted is false when the retry process itself crashed without emitting
// results; in that case round 1 failures cannot be cleared as flaky.
export function classifyRetryResults({ first, second, retryTrusted = true }) {
    const secondKeys = new Set(second.map((failure) => failure.key));
    const firstKeys = new Set(first.map((failure) => failure.key));

    const unretriable = first.filter(
        (failure) => failure.package === undefined,
    );
    const retriable = first.filter(
        (failure) => failure.package !== undefined,
    );

    let confirmed;
    let flakyRecovered;
    if (retryTrusted) {
        confirmed = retriable.filter((failure) => secondKeys.has(failure.key));
        flakyRecovered = retriable.filter(
            (failure) => !secondKeys.has(failure.key),
        );
    } else {
        // The retry gave us nothing to trust, so keep the original failures.
        confirmed = retriable;
        flakyRecovered = [];
    }

    const newOnRetry = second.filter((failure) => !firstKeys.has(failure.key));

    return { confirmed, flakyRecovered, newOnRetry, unretriable };
}

export function hasHardFailures(classification) {
    return (
        classification.confirmed.length > 0 ||
        classification.unretriable.length > 0
    );
}

export function hasFlakyResults(classification) {
    return (
        classification.flakyRecovered.length > 0 ||
        classification.newOnRetry.length > 0
    );
}

const RULE = "=".repeat(80);

export function stripAnsi(value) {
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

function formatFailure(failure, { includeMessages = true } = {}) {
    const lines = [
        `\nFAIL ${normalizeTestFilePath(failure.testFilePath)}`,
        `  ${failure.fullName}`,
    ];
    if (includeMessages) {
        for (const message of failure.failureMessages ?? []) {
            lines.push(indent(stripAnsi(String(message)), 4));
        }
    }
    return lines;
}

// Build the human-readable summary printed at the end of the test step.
export function buildSummaryLines(classification) {
    const { confirmed, flakyRecovered, newOnRetry, unretriable } =
        classification;
    const lines = [];

    if (flakyRecovered.length > 0 || newOnRetry.length > 0) {
        const flakyCount = flakyRecovered.length + newOnRetry.length;
        lines.push(
            `\n${RULE}\nFLAKY TESTS (${flakyCount}) - passed on retry, not failing the build\n${RULE}`,
        );
        for (const failure of flakyRecovered) {
            lines.push(...formatFailure(failure));
        }
        for (const failure of newOnRetry) {
            lines.push(
                `\nFLAKY ${normalizeTestFilePath(failure.testFilePath)}`,
                `  ${failure.fullName}`,
                indent(
                    "Passed on the first run but failed when the package was retried.",
                    4,
                ),
            );
        }
        lines.push(`\n${RULE}`);
    }

    if (confirmed.length > 0 || unretriable.length > 0) {
        const failCount = confirmed.length + unretriable.length;
        lines.push(
            `\n${RULE}\nFAILED TESTS (${failCount}) - failed on retry\n${RULE}`,
        );
        for (const failure of confirmed) {
            lines.push(...formatFailure(failure));
        }
        for (const failure of unretriable) {
            lines.push(...formatFailure(failure));
            lines.push(
                indent(
                    "(could not be isolated to a package for retry; treated as a failure)",
                    2,
                ),
            );
        }
        lines.push(`\n${RULE}`);
    }

    return lines;
}

function githubEscape(value) {
    return String(value)
        .replaceAll("%", "%25")
        .replaceAll("\r", "%0D")
        .replaceAll("\n", "%0A");
}

// GitHub Actions workflow commands so flaky/failed tests surface as
// annotations in the PR checks UI (tracked, not silently masked).
export function buildGithubAnnotations(classification) {
    const annotations = [];
    for (const failure of [
        ...classification.flakyRecovered,
        ...classification.newOnRetry,
    ]) {
        annotations.push(
            `::warning title=Flaky test::${githubEscape(
                `${failure.fullName} (${normalizeTestFilePath(failure.testFilePath)}) passed only after a retry`,
            )}`,
        );
    }
    for (const failure of [
        ...classification.confirmed,
        ...classification.unretriable,
    ]) {
        annotations.push(
            `::error title=Test failed::${githubEscape(
                `${failure.fullName} (${normalizeTestFilePath(failure.testFilePath)})`,
            )}`,
        );
    }
    return annotations;
}

// Markdown appended to $GITHUB_STEP_SUMMARY for an at-a-glance flaky report.
export function buildStepSummaryMarkdown(classification) {
    const { confirmed, flakyRecovered, newOnRetry, unretriable } =
        classification;
    if (
        confirmed.length === 0 &&
        unretriable.length === 0 &&
        flakyRecovered.length === 0 &&
        newOnRetry.length === 0
    ) {
        return "";
    }

    const rows = [];
    const addRows = (failures, status) => {
        for (const failure of failures) {
            const file = normalizeTestFilePath(failure.testFilePath);
            const name = String(failure.fullName).replaceAll("|", "\\|");
            rows.push(`| ${status} | \`${file}\` | ${name} |`);
        }
    };
    addRows(confirmed, "❌ Failed on retry");
    addRows(unretriable, "❌ Failed (no retry)");
    addRows(flakyRecovered, "⚠️ Flaky (recovered)");
    addRows(newOnRetry, "⚠️ Flaky (new on retry)");

    return [
        "### Test retry summary",
        "",
        "| Result | File | Test |",
        "| --- | --- | --- |",
        ...rows,
        "",
    ].join("\n");
}

// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import assert from "node:assert/strict";
import test from "node:test";
import path from "node:path";

import {
    normalizeTestFilePath,
    failureKey,
    dedupeFailures,
    findPackageDir,
    classifyRetryResults,
    hasHardFailures,
    hasFlakyResults,
    buildSummaryLines,
    buildGithubAnnotations,
    buildStepSummaryMarkdown,
    MAX_TEST_RETRIES,
    runLocalTestPhases,
    planPackageRetry,
    windowsPnpmCommand,
} from "../lib/testRetry.mjs";

const cwd = "/repo/ts";

const jestEsm =
    "node --no-warnings --experimental-vm-modules ./node_modules/jest/bin/jest.js";

for (const script of [
    "pnpm run jest-esm",
    'pnpm run jest-esm --testPathPattern=".*[.]spec[.]js"',
    'pnpm run jest-esm --testMatch="**/dist/test/**/*.spec.js"',
    "pnpm run jest-esm --testMatch='**/dist/test/**/*.spec.js'",
]) {
    test(`narrows single Jest invocation: ${script}`, () => {
        const dir = path.resolve("packages", "a space");
        const file = path.join(dir, "test", "a file.spec.js");
        const plan = planPackageRetry(
            {
                scripts: { "test:local": script, "jest-esm": jestEsm },
            },
            [file, file],
            dir,
        );
        assert.equal(plan.narrowed, true);
        assert.equal(plan.cwd, dir);
        assert.deepEqual(plan.args, [
            "run",
            "jest-esm",
            "--runInBand",
            "--no-cache",
            "--passWithNoTests=false",
            "--runTestsByPath",
            file,
        ]);
    });
}

for (const manager of ["npm", "pnpm"]) {
    test(`recognizes exact ${manager} Jest script alias`, () => {
        const plan = planPackageRetry(
            {
                scripts: {
                    "test:local": `${manager} run jest`,
                    jest: "pnpm run jest-esm",
                    "jest-esm": jestEsm,
                },
            },
            ["test/a.spec.js"],
            path.resolve("package"),
        );
        assert.equal(plan.narrowed, true);
    });
}

for (const script of [
    undefined,
    "jest",
    "node --test test/*.spec.mjs",
    "jest && npm run test:views:gateway && npm run test:views:client",
    "pnpm run build && pnpm run jest-esm",
    "pnpm run jest-esm && node check.mjs",
    "pnpm run jest-esm --config custom.js",
    "pnpm run jest-esm --passWithNoTests",
    'pnpm run jest-esm --testMatch="$PATTERN"',
    "pnpm run jest-esm\nnode check.mjs",
]) {
    test(`whole-package fallback for unsupported script: ${script}`, () => {
        const plan = planPackageRetry(
            {
                scripts: {
                    "test:local": script,
                    "jest-esm": jestEsm,
                },
            },
            ["test/a.spec.js"],
            cwd,
        );
        assert.equal(plan.narrowed, false);
        assert.match(plan.reason, /not a recognized single/);
        assert.deepEqual(plan.args, ["run", "test:local"]);
    });
}

test("does not bypass modified wrappers or package lifecycle hooks", () => {
    for (const overrides of [
        { "jest-esm": `${jestEsm} && node check.mjs` },
        { "pretest:local": "node setup.mjs" },
        { "posttest:local": "node check.mjs" },
        { "prejest-esm": "node setup.mjs" },
        { postjest: "node check.mjs" },
    ]) {
        assert.equal(
            planPackageRetry(
                {
                    scripts: {
                        "test:local": "pnpm run jest-esm",
                        "jest-esm": jestEsm,
                        ...overrides,
                    },
                },
                ["test/a.spec.js"],
                cwd,
            ).narrowed,
            false,
        );
    }
});

test("does not narrow files outside the owning package", () => {
    const packageDir = path.resolve("packages", "a");
    const plan = planPackageRetry(
        {
            scripts: {
                "test:local": "pnpm run jest-esm",
                "jest-esm": jestEsm,
            },
        },
        [path.resolve("packages", "b", "test.spec.js")],
        packageDir,
    );
    assert.equal(plan.narrowed, false);
    assert.match(plan.reason, /outside the owning package/);
});

test("quotes Windows argument boundaries, spaces and shell metacharacters", () => {
    assert.equal(
        windowsPnpmCommand([
            "run",
            "jest-esm",
            "--runTestsByPath",
            "D:\\repo space & files\\test\\a file.spec.js",
        ]),
        '"pnpm "run" "jest-esm" "--runTestsByPath" "D:\\repo space & files\\test\\a file.spec.js""',
    );
    for (const value of ['a"b', "%PATH%", "a\nb", "a\0b"]) {
        assert.throws(() => windowsPnpmCommand([value]), /Unsafe argument/);
    }
});

for (const workspaceStatus of [0, 1]) {
    for (const scriptStatus of [0, 1]) {
        test(`both phases run: workspace=${workspaceStatus}, scripts=${scriptStatus}`, () => {
            const calls = [];
            const status = runLocalTestPhases(
                () => {
                    calls.push("workspace including retries");
                    return workspaceStatus;
                },
                () => {
                    calls.push("scripts");
                    return scriptStatus;
                },
            );
            assert.deepEqual(calls, ["workspace including retries", "scripts"]);
            assert.equal(status, workspaceStatus || scriptStatus);
        });
    }
}

test("allows two retries for three total attempts", () => {
    assert.equal(MAX_TEST_RETRIES, 2);
});

function failure(file, name, message = "boom") {
    return {
        testFilePath: file,
        fullName: name,
        failureMessages: [message],
    };
}

// Attach a `key` (as dedupeFailures would) plus an owning package.
function withKey(file, name, pkg) {
    return {
        ...failure(file, name),
        key: failureKey(failure(file, name), cwd),
        package: pkg,
    };
}

test("normalizeTestFilePath makes paths workspace-relative with forward slashes", () => {
    assert.equal(
        normalizeTestFilePath("/repo/ts/packages/a/dist/test/x.spec.js", cwd),
        "packages/a/dist/test/x.spec.js",
    );
    // file:// URLs are decoded.
    assert.equal(
        normalizeTestFilePath("file:///repo/ts/packages/a/test/y.spec.ts", cwd),
        "packages/a/test/y.spec.ts",
    );
});

test("failureKey is identical across rounds and ignores the message", () => {
    const first = failure("/repo/ts/packages/a/dist/test/x.spec.js", "does X");
    const second = failure(
        "/repo/ts/packages/a/dist/test/x.spec.js",
        "does X",
        "a different message",
    );
    assert.equal(failureKey(first, cwd), failureKey(second, cwd));
});

test("dedupeFailures collapses repeated reports and attaches a key", () => {
    const deduped = dedupeFailures(
        [
            failure("/repo/ts/packages/a/dist/test/x.spec.js", "does X"),
            failure("/repo/ts/packages/a/dist/test/x.spec.js", "does X"),
            failure("/repo/ts/packages/a/dist/test/x.spec.js", "does Y"),
        ],
        cwd,
    );
    assert.equal(deduped.length, 2);
    assert.ok(deduped.every((entry) => typeof entry.key === "string"));
});

test("findPackageDir walks up to the nearest package, not the workspace root", () => {
    const root = path.resolve("/repo/ts");
    const packageA = path.join(root, "packages", "a");
    const testFile = path.join(packageA, "dist", "test", "x.spec.js");
    const isPackageDir = (dir) => {
        const resolved = path.resolve(dir);
        return resolved === packageA || resolved === root;
    };
    const found = findPackageDir(testFile, root, isPackageDir);
    assert.equal(path.resolve(found), packageA);
});

test("findPackageDir returns undefined for files outside the workspace", () => {
    assert.equal(
        findPackageDir("/somewhere/else/x.spec.js", "/repo/ts", () => true),
        undefined,
    );
});

test("findPackageDir returns undefined when only the root owns the file", () => {
    const isPackageDir = (dir) => dir.replaceAll("\\", "/") === "/repo/ts";
    assert.equal(
        findPackageDir("/repo/ts/scripts/x.spec.js", "/repo/ts", isPackageDir),
        undefined,
    );
});

test("classify: a failure that passes on retry is flaky, not fatal", () => {
    const first = [withKey("/repo/ts/packages/a/test/x.spec.js", "flaky", "a")];
    const classification = classifyRetryResults({ first, second: [] });
    assert.equal(classification.flakyRecovered.length, 1);
    assert.equal(classification.confirmed.length, 0);
    assert.equal(hasHardFailures(classification), false);
    assert.equal(hasFlakyResults(classification), true);
});

test("classify: a failure that fails again on retry is confirmed and fatal", () => {
    const first = [
        withKey("/repo/ts/packages/a/test/x.spec.js", "broken", "a"),
    ];
    const second = [
        {
            ...failure(
                "/repo/ts/packages/a/test/x.spec.js",
                "broken",
                "retry failure",
            ),
        },
    ].map((f) => ({ ...f, key: failureKey(f, cwd) }));
    const classification = classifyRetryResults({ first, second });
    assert.equal(classification.confirmed.length, 1);
    assert.deepEqual(classification.confirmed[0].failureMessages, [
        "retry failure",
    ]);
    assert.equal(classification.flakyRecovered.length, 0);
    assert.equal(hasHardFailures(classification), true);
});

test("classify: a failure with no owning package is unretriable and fatal", () => {
    const first = [withKey("<Jest run>", "jest crashed", undefined)];
    const classification = classifyRetryResults({ first, second: [] });
    assert.equal(classification.unretriable.length, 1);
    assert.equal(hasHardFailures(classification), true);
});

test("classify: a test that only fails on retry is fatal", () => {
    const first = [
        withKey("/repo/ts/packages/a/test/x.spec.js", "broken", "a"),
    ];
    const newFail = failure(
        "/repo/ts/packages/a/test/x.spec.js",
        "was passing",
    );
    const second = [
        { ...failure("/repo/ts/packages/a/test/x.spec.js", "broken") },
        newFail,
    ].map((f) => ({ ...f, key: failureKey(f, cwd) }));
    const classification = classifyRetryResults({ first, second });
    assert.equal(classification.confirmed.length, 1);
    assert.equal(classification.newOnRetry.length, 1);
    assert.equal(classification.newOnRetry[0].fullName, "was passing");
    assert.equal(hasHardFailures(classification), true);
});

test("classify: an untrusted (crashed) retry keeps round-1 failures as confirmed", () => {
    const first = [
        withKey("/repo/ts/packages/a/test/x.spec.js", "broken", "a"),
    ];
    const classification = classifyRetryResults({
        first,
        second: [],
        retryTrusted: false,
    });
    assert.equal(classification.confirmed.length, 1);
    assert.equal(classification.flakyRecovered.length, 0);
    assert.equal(hasHardFailures(classification), true);
});

test("classify: a nonzero retry remains fatal even when failures were captured", () => {
    const first = [withKey("/repo/ts/packages/a/test/x.spec.js", "flaky", "a")];
    const classification = classifyRetryResults({
        first,
        second: [],
        retryFailed: true,
    });
    assert.equal(classification.flakyRecovered.length, 1);
    assert.equal(hasHardFailures(classification), true);
});

test("buildSummaryLines separates flaky from failed sections", () => {
    const classification = {
        confirmed: [
            withKey("/repo/ts/packages/a/test/x.spec.js", "broken", "a"),
        ],
        flakyRecovered: [
            withKey("/repo/ts/packages/b/test/y.spec.js", "flaky", "b"),
        ],
        newOnRetry: [],
        unretriable: [],
    };
    const text = buildSummaryLines(classification).join("\n");
    assert.match(text, /FLAKY TESTS \(1\)/);
    assert.match(text, /BUILD-BLOCKING TEST FAILURES \(1\)/);
    assert.match(text, /broken/);
    assert.match(text, /flaky/);
});

test("buildSummaryLines lists each flaky and confirmed test by name", () => {
    const classification = {
        confirmed: [
            withKey(
                "/repo/ts/packages/a/test/x.spec.js",
                "confirmed failure",
                "a",
            ),
        ],
        flakyRecovered: [
            withKey(
                "/repo/ts/packages/b/test/y.spec.js",
                "recovered flaky test",
                "b",
            ),
        ],
        newOnRetry: [],
        unretriable: [],
        retryFailed: true,
    };
    const text = buildSummaryLines(classification).join("\n");
    assert.match(
        text,
        /FLAKY TESTS[\s\S]*recovered flaky test[\s\S]*BUILD-BLOCKING TEST FAILURES[\s\S]*confirmed failure/,
    );
});

test("buildGithubAnnotations emits warnings for flaky and errors for failed", () => {
    const classification = {
        confirmed: [
            withKey("/repo/ts/packages/a/test/x.spec.js", "broken", "a"),
        ],
        flakyRecovered: [
            withKey("/repo/ts/packages/b/test/y.spec.js", "flaky", "b"),
        ],
        newOnRetry: [],
        unretriable: [],
    };
    const annotations = buildGithubAnnotations(classification);
    assert.ok(annotations.some((line) => line.startsWith("::warning ")));
    assert.ok(annotations.some((line) => line.startsWith("::error ")));
});

test("buildGithubAnnotations reports new-on-retry failures as errors", () => {
    const classification = {
        confirmed: [],
        flakyRecovered: [],
        newOnRetry: [
            withKey("/repo/ts/packages/a/test/x.spec.js", "new failure", "a"),
        ],
        unretriable: [],
        retryFailed: true,
    };
    const annotations = buildGithubAnnotations(classification);
    assert.ok(
        annotations.some(
            (line) =>
                line.startsWith("::error title=Test failed::") &&
                line.includes("new failure"),
        ),
    );
    assert.ok(annotations.every((line) => !line.includes("passed only after")));
});

test("buildStepSummaryMarkdown is empty when there is nothing to report", () => {
    assert.equal(
        buildStepSummaryMarkdown({
            confirmed: [],
            flakyRecovered: [],
            newOnRetry: [],
            unretriable: [],
        }),
        "",
    );
});

test("buildStepSummaryMarkdown renders a table when there are results", () => {
    const markdown = buildStepSummaryMarkdown({
        confirmed: [
            withKey("/repo/ts/packages/a/test/x.spec.js", "broken", "a"),
        ],
        flakyRecovered: [],
        newOnRetry: [],
        unretriable: [],
    });
    assert.match(markdown, /### Test retry summary/);
    assert.match(markdown, /Failed on retry/);
    assert.match(markdown, /packages\/a\/test\/x\.spec\.js/);
});

// Guard against a regression in the path math the resolver relies on.
test("path.relative stays inside the workspace for a real sub-package layout", () => {
    const rel = path.relative(cwd, "/repo/ts/packages/a/dist/test/x.spec.js");
    assert.ok(!rel.startsWith(".."));
});

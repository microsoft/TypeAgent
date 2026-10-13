// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
    mkdirSync,
    mkdtempSync,
    readFileSync,
    rmSync,
    writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import test from "node:test";
import {
    parsePackageSelection,
    readAlertsSnapshot,
    selectPackages,
} from "../fix-dependabot-alerts.mjs";

const WORKFLOW_PATH = resolve(
    import.meta.dirname,
    "../../../../.github/workflows/fix-dependabot-alerts.yml",
);

function readWorkflow() {
    return readFileSync(WORKFLOW_PATH, "utf-8");
}

function run(command, args, options = {}) {
    const result = spawnSync(command, args, {
        encoding: "utf-8",
        ...options,
    });
    assert.equal(
        result.status,
        0,
        `${command} ${args.join(" ")} failed:\n${result.stdout}\n${result.stderr}`,
    );
    return result.stdout.trim();
}

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
    const workflow = readWorkflow();
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
    assert.match(workflow, /ATTEMPT_CHECKPOINT=.*write-tree/);
    assert.match(workflow, /read-tree --reset -u "\$ATTEMPT_CHECKPOINT"/);
    assert.match(workflow, /pnpm install --frozen-lockfile --lockfile-only/);
    const consistencyCheck = workflow.indexOf(
        "verify_checkpoint_consistency 2>&1",
    );
    const acceptedStage = workflow.indexOf(
        'git -C "$GITHUB_WORKSPACE" add -A',
        consistencyCheck,
    );
    assert.notEqual(consistencyCheck, -1);
    assert.ok(acceptedStage > consistencyCheck);
    assert.match(workflow, /filtered_args\+=\("--package=\$PKG"\)/);
});

test("selected failed packages exit nonzero in text and JSON modes", () => {
    const directory = mkdtempSync(join(tmpdir(), "dependabot-no-patch-"));
    const alertsFile = join(directory, "alerts.json");
    const packageName = "@typeagent/dependabot-no-patch-regression";
    const script = resolve(import.meta.dirname, "../fix-dependabot-alerts.mjs");
    const workspace = resolve(import.meta.dirname, "../../..");
    const alerts = [
        {
            number: 1,
            dependency: {
                package: { ecosystem: "npm", name: packageName },
                manifest_path: "ts/package.json",
            },
            security_vulnerability: {
                first_patched_version: null,
            },
            security_advisory: {
                severity: "high",
                ghsa_id: "GHSA-no-patch",
            },
        },
    ];

    try {
        writeFileSync(alertsFile, JSON.stringify(alerts));
        for (const jsonOutput of [false, true]) {
            const result = spawnSync(
                process.execPath,
                [
                    script,
                    "--skip-install",
                    `--alerts-file=${alertsFile}`,
                    `--package=${packageName}`,
                    ...(jsonOutput ? ["--json"] : []),
                ],
                {
                    cwd: workspace,
                    encoding: "utf-8",
                    env: { ...process.env, NO_COLOR: "1" },
                },
            );

            assert.equal(
                result.status,
                1,
                `${jsonOutput ? "JSON" : "text"} mode unexpectedly succeeded:\n${result.stdout}\n${result.stderr}`,
            );
            if (jsonOutput) {
                const output = JSON.parse(result.stdout);
                assert.equal(output.summary.noPatch, 1);
            } else {
                assert.match(result.stdout, /no fix available/);
            }
        }
    } finally {
        rmSync(directory, { recursive: true, force: true });
    }
});

test("workflow replaces caller package selectors with the attempt target", () => {
    const workflow = readWorkflow();
    const filterStart = workflow.indexOf('case "$arg" in');
    const appendStart = workflow.indexOf(
        'filtered_args+=("--auto-fix=$PKG")',
        filterStart,
    );

    assert.notEqual(filterStart, -1);
    assert.ok(appendStart > filterStart);
    const filterBlock = workflow.slice(filterStart, appendStart);
    assert.match(filterBlock, /--package\|--package=\*\)/);
    assert.equal(
        workflow.match(/filtered_args\+=\("--package=\$PKG"\)/g)?.length,
        1,
    );
});

test("checkpoint rollback restores a staged manifest and lockfile pair", () => {
    const directory = mkdtempSync(join(tmpdir(), "dependabot-checkpoint-"));
    const appDir = join(directory, "packages", "app");
    const libraryDir = join(directory, "packages", "checkpoint-library");
    const packageManager = JSON.parse(
        readFileSync(resolve(import.meta.dirname, "../../../package.json")),
    ).packageManager;
    const pnpmCommand =
        process.platform === "win32" ? process.execPath : "pnpm";
    const pnpmPrefix =
        process.platform === "win32"
            ? [
                  resolve(
                      dirname(process.execPath),
                      "node_modules/corepack/dist/pnpm.js",
                  ),
              ]
            : [];
    const pnpmInstall = (...args) =>
        run(pnpmCommand, [
            ...pnpmPrefix,
            "--dir",
            directory,
            "install",
            ...args,
        ]);
    const git = (...args) => run("git", ["-C", directory, ...args]);

    try {
        writeFileSync(
            join(directory, "package.json"),
            JSON.stringify(
                {
                    name: "checkpoint-root",
                    private: true,
                    packageManager,
                },
                null,
                2,
            ),
        );
        writeFileSync(
            join(directory, "pnpm-workspace.yaml"),
            "packages:\n  - packages/*\n",
        );
        writeFileSync(
            join(directory, ".gitignore"),
            "node_modules/\npackages/*/node_modules/\n",
        );
        mkdirSync(appDir, { recursive: true });
        mkdirSync(libraryDir, { recursive: true });
        writeFileSync(
            join(libraryDir, "package.json"),
            JSON.stringify(
                { name: "checkpoint-library", version: "1.0.0" },
                null,
                2,
            ),
        );
        writeFileSync(
            join(appDir, "package.json"),
            JSON.stringify(
                {
                    name: "checkpoint-app",
                    version: "1.0.0",
                    dependencies: {
                        "checkpoint-library": "workspace:^1.0.0",
                    },
                },
                null,
                2,
            ),
        );

        pnpmInstall("--lockfile-only");
        git("init", "--quiet");
        git("config", "user.name", "checkpoint-test");
        git("config", "user.email", "checkpoint@example.com");
        git("add", "-A");
        git("commit", "--quiet", "-m", "initial");

        writeFileSync(
            join(libraryDir, "package.json"),
            JSON.stringify(
                { name: "checkpoint-library", version: "1.1.0" },
                null,
                2,
            ),
        );
        writeFileSync(
            join(appDir, "package.json"),
            JSON.stringify(
                {
                    name: "checkpoint-app",
                    version: "1.0.0",
                    dependencies: {
                        "checkpoint-library": "workspace:^1.1.0",
                    },
                },
                null,
                2,
            ),
        );
        pnpmInstall("--lockfile-only");
        pnpmInstall("--frozen-lockfile", "--lockfile-only");
        git("add", "-A");
        const checkpoint = git("write-tree");

        writeFileSync(
            join(appDir, "package.json"),
            JSON.stringify(
                {
                    name: "checkpoint-app",
                    version: "1.0.0",
                    dependencies: {
                        "checkpoint-library": "workspace:^2.0.0",
                    },
                },
                null,
                2,
            ),
        );
        writeFileSync(join(directory, "failed-attempt.tmp"), "dirty");

        rmSync(join(directory, "failed-attempt.tmp"));
        git("read-tree", "--reset", "-u", checkpoint);
        pnpmInstall("--frozen-lockfile", "--lockfile-only");

        const restoredApp = JSON.parse(
            readFileSync(join(appDir, "package.json"), "utf-8"),
        );
        assert.equal(
            restoredApp.dependencies["checkpoint-library"],
            "workspace:^1.1.0",
        );
        assert.equal(git("diff", "--name-only"), "");
        assert.match(git("diff", "--cached", "--name-only"), /pnpm-lock\.yaml/);
    } finally {
        rmSync(directory, { recursive: true, force: true });
    }
});

// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import test from "node:test";
import yaml from "js-yaml";
import { parseRemediationWorkflowArgs } from "../remediationWorkflowArgs.mjs";

const helper = fileURLToPath(
    new URL("../remediationWorkflowArgs.mjs", import.meta.url),
);
const workflow = readFileSync(
    new URL(
        "../../../../.github/workflows/fix-dependabot-alerts.yml",
        import.meta.url,
    ),
    "utf8",
);

test("keeps supported non-selector arguments as individual data values", () => {
    assert.deepEqual(
        parseRemediationWorkflowArgs(
            "--verbose --show-chains=full --skip-shell-check --min-release-age-days=14",
            7,
        ),
        [
            "--verbose",
            "--show-chains=full",
            "--skip-shell-check",
            "--min-release-age-days=14",
        ],
    );
});

test("leaves package selection to the workflow", () => {
    assert.deepEqual(
        parseRemediationWorkflowArgs(
            "--auto-fix --apply-overrides=@scope/example,other --update-parents=another --verbose",
        ),
        ["--verbose"],
    );
    assert.deepEqual(parseRemediationWorkflowArgs(""), []);
    assert.deepEqual(parseRemediationWorkflowArgs(" \n --auto-fix \t "), []);
});

for (const input of [
    '--auto-fix"; echo marker',
    "--auto-fix=$(echo marker)",
    "--auto-fix=`echo marker`",
    "--auto-fix=example;echo",
    "--apply-overrides=example,,other",
    "--update-parents=",
    "--package=another",
    "--alerts-file=alternate.json",
    "--prune-overrides",
    "--unknown",
    "--verbose=true",
    "--show-chains=unexpected",
    "--min-release-age-days=-1",
    "--min-release-age-days=7.5",
    "--min-release-age-days=9007199254740992",
    "--verbose\u0000",
]) {
    test(`rejects unsupported or malformed input ${JSON.stringify(input)}`, () => {
        assert.throws(
            () => parseRemediationWorkflowArgs(input, 7),
            /Invalid package filter|Unsupported remediation/,
        );
    });
}

test("cannot lower the workflow's minimum release age", () => {
    assert.throws(
        () => parseRemediationWorkflowArgs("--min-release-age-days=6", 7),
        /Unsupported remediation/,
    );
    assert.deepEqual(
        parseRemediationWorkflowArgs("--min-release-age-days=7", 7),
        ["--min-release-age-days=7"],
    );
    assert.throws(
        () => parseRemediationWorkflowArgs("--verbose", Number.NaN),
        /release-age policy/,
    );
});

test("CLI reads environment data and reports rejected input before execution", () => {
    const accepted = spawnSync(process.execPath, [helper], {
        encoding: "utf8",
        env: {
            ...process.env,
            REMEDIATION_EXTRA_ARGS: "--auto-fix --verbose --show-chains=full",
            DEPENDABOT_MIN_RELEASE_AGE_DAYS: "7",
        },
    });
    assert.equal(accepted.status, 0, accepted.stderr);
    assert.equal(accepted.stdout, "--verbose --show-chains=full");
    const rejected = spawnSync(process.execPath, [helper], {
        encoding: "utf8",
        env: {
            ...process.env,
            REMEDIATION_EXTRA_ARGS: '"; echo marker',
            DEPENDABOT_MIN_RELEASE_AGE_DAYS: "7",
        },
    });
    assert.equal(rejected.status, 1);
    assert.equal(rejected.stdout, "");
    assert.match(rejected.stderr, /::error::Unsupported remediation/);
});

test("workflow passes the dispatch value as environment data and validates it", () => {
    const parsed = yaml.load(workflow);
    const fix = parsed.jobs["fix-alerts"].steps.find(
        (step) => step.id === "fix",
    );
    assert.equal(
        fix.env.REMEDIATION_EXTRA_ARGS,
        "${{ inputs.auto-fix-args || '--auto-fix' }}",
    );
    assert.match(
        workflow,
        /REMEDIATION_EXTRA_ARGS: \$\{\{ inputs\.auto-fix-args \|\| '--auto-fix' \}\}/,
    );
    assert.doesNotMatch(workflow, /FLAGS="\$\{\{/);
    assert.match(
        workflow,
        /FLAGS=\$\(node "[^"]*remediationWorkflowArgs\.mjs"\)/,
    );
    const validation = fix.run.indexOf("remediationWorkflowArgs.mjs");
    for (const operation of [
        "WORKSPACES=$(",
        'node "$SCRIPT" "${filtered_args[@]}"',
    ]) {
        const offset = fix.run.indexOf(operation);
        assert.ok(offset > validation && validation >= 0, operation);
    }
    assert.match(workflow, /read -r -a filtered_args <<< "\$FLAGS"/);
    assert.match(workflow, /filtered_args\+=\("--auto-fix=\$PKG"\)/);
});

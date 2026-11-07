// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import {
    existsSync,
    mkdirSync,
    mkdtempSync,
    readFileSync,
    rmSync,
    writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import yaml from "js-yaml";

function pipeline(name) {
    return yaml.load(
        readFileSync(
            new URL(`../../../../pipelines/${name}.yml`, import.meta.url),
            "utf8",
        ),
    );
}

const smoke = pipeline("azure-smoke-tests");
const integration = pipeline("azure-live-tests");
const smokeJob = smoke.jobs.find((job) => job.job === "shell_and_cli");
const liveJob = integration.jobs.find((job) => job.job === "live_tests");
const liveStep = liveJob.steps.find(
    (step) => step.displayName === "Live Tests (Linux)",
);
const cleanup = liveJob.steps.find(
    (step) => step.displayName === "Clean up Keys",
);

test("required smoke preserves CLI and shell coverage without broad live integration", () => {
    assert.deepEqual(smoke.trigger.branches.include, [
        "main",
        "gh-readonly-queue/main/*",
    ]);
    assert.deepEqual(smoke.pr.branches.include, ["main"]);
    assert.equal(smoke.trigger.paths, undefined);
    assert.equal(smoke.pr.paths, undefined);
    assert.ok(smoke.jobs.some((job) => job.job === "detect_changes"));
    for (const name of [
        "Test CLI - smoke",
        "Shell Tests - full (Windows)",
        "Shell Tests - smoke (Linux)",
    ]) {
        assert.ok(smokeJob.steps.some((step) => step.displayName === name));
    }
    for (const job of smoke.jobs) {
        for (const step of job.steps) {
            assert.notEqual(step.displayName, "Live Tests (Linux)");
            const command = [
                step.inputs?.inlineScript,
                step.inputs?.script,
                step.script,
                step.pwsh,
                step.bash,
            ].join("\n");
            assert.doesNotMatch(
                command,
                /\b(?:npm|pnpm)\s+(?:run\s+)?test:live\b/,
            );
        }
    }
});

test("automatic live integration selects only main and never PRs", () => {
    assert.deepEqual(integration.trigger.branches.include, ["main"]);
    assert.equal(integration.trigger.batch, true);
    assert.equal(integration.pr, "none");
    for (const file of [
        "ts",
        "pipelines/azure-live-tests.yml",
        "pipelines/include-prepare-repo.yml",
        "pipelines/include-install-pnpm.yml",
    ]) {
        assert.ok(integration.trigger.paths.include.includes(file));
    }
    assert.equal(integration.schedules.length, 1);
    assert.deepEqual(integration.schedules[0].branches.include, ["main"]);
    assert.equal(integration.schedules[0].always, true);
    assert.equal(liveJob.dependsOn, undefined);
    assert.equal(integration.resources, undefined);
});

test("candidate validation requires both explicit opt-in and a manual branch run", () => {
    const parameter = integration.parameters.find(
        (parameter) => parameter.name === "validateCandidate",
    );
    assert.equal(parameter.type, "boolean");
    assert.equal(parameter.default, false);
    assert.equal(
        liveJob.condition,
        "and(succeeded(), or(eq(variables['Build.SourceBranch'], 'refs/heads/main'), and(eq(variables['Build.Reason'], 'Manual'), eq(${{ parameters.validateCandidate }}, true), startsWith(variables['Build.SourceBranch'], 'refs/heads/'))))",
    );
});

test("live integration preserves native setup and builds before testing", () => {
    const preparation = liveJob.steps.findIndex(
        (step) => step.template === "include-prepare-repo.yml",
    );
    const nativeSetup = liveJob.steps.findIndex(
        (step) => step.displayName === "Install libsecret-1-0",
    );
    const browsers = liveJob.steps.findIndex(
        (step) => step.displayName === "Install Playwright Browsers",
    );
    const build = liveJob.steps.findIndex(
        (step) => step.displayName === "Build",
    );
    assert.equal(liveJob.pool.vmImage, "ubuntu-24.04");
    assert.equal(preparation, 0);
    assert.equal(liveJob.steps[preparation].parameters.registry, "$(REGISTRY)");
    assert.ok(nativeSetup > preparation);
    assert.ok(browsers > nativeSetup);
    assert.ok(build > browsers);
    assert.ok(liveJob.steps.indexOf(liveStep) > build);
    assert.equal(liveStep.inputs.workingDirectory, "$(buildDirectory)");
});

test("live failures and timeouts fail their independent pipeline", () => {
    assert.equal(liveStep.timeoutInMinutes, 60);
    assert.ok(liveJob.timeoutInMinutes > liveStep.timeoutInMinutes);
    assert.ok(liveJob.cancelTimeoutInMinutes >= 5);
    for (const item of [liveJob, ...liveJob.steps]) {
        assert.ok(!item.continueOnError);
    }
    assert.match(liveStep.inputs.inlineScript, /^set -euo pipefail\n/);
    assert.match(liveStep.inputs.inlineScript, /\nnpm run test:live\s*$/);
});

test("live tests use their own federated login and provision keys before testing", () => {
    assert.equal(liveStep.task, "AzureCLI@2");
    assert.equal(liveStep.inputs.azureSubscription, "$(azureSubscription)");
    assert.equal(liveStep.inputs.scriptType, "bash");
    assert.match(
        liveStep.inputs.inlineScript,
        /unset AZURE_CLIENT_ID AZURE_TENANT_ID AZURE_FEDERATED_TOKEN_FILE/,
    );
    const provision = liveStep.inputs.inlineScript.indexOf(
        "node tools/scripts/getKeys.mjs --vault build-pipeline-kv --commit",
    );
    assert.ok(provision >= 0);
    assert.ok(
        liveStep.inputs.inlineScript.indexOf("npm run test:live") > provision,
    );
});

function withCleanupFixture(run) {
    const directory = mkdtempSync(path.join(os.tmpdir(), "typeagent-live-ci-"));
    try {
        const command = cleanup.pwsh.match(/^node -e "([^"]+)"\s*$/);
        assert.ok(command);
        run(directory, () =>
            execFileSync(process.execPath, ["-e", command[1]], {
                cwd: directory,
                stdio: "pipe",
            }),
        );
    } finally {
        rmSync(directory, { recursive: true, force: true });
    }
}

test("credential cleanup always runs, is retry-safe, and preserves unrelated files", () => {
    assert.equal(cleanup.condition, "always()");
    assert.equal(cleanup.workingDirectory, "$(buildDirectory)");
    assert.ok(liveJob.steps.indexOf(cleanup) > liveJob.steps.indexOf(liveStep));
    withCleanupFixture((directory, run) => {
        for (const file of [".env", "config.local.yaml", "unrelated.txt"]) {
            writeFileSync(path.join(directory, file), "synthetic fixture");
        }
        run();
        run();
        assert.equal(existsSync(path.join(directory, ".env")), false);
        assert.equal(
            existsSync(path.join(directory, "config.local.yaml")),
            false,
        );
        assert.equal(
            readFileSync(path.join(directory, "unrelated.txt"), "utf8"),
            "synthetic fixture",
        );
    });
});

test("credential cleanup does not hide unexpected filesystem errors", () => {
    withCleanupFixture((directory, run) => {
        mkdirSync(path.join(directory, ".env"));
        assert.throws(run);
    });
});

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
const provisionStep = liveJob.steps.find(
    (step) => step.displayName === "Azure login + Get Keys",
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

test("smoke build scope defaults to full and only changes build coverage, not tests or authentication", () => {
    const parameter = smoke.parameters.find(
        (item) => item.name === "smokeBuildScope",
    );
    assert.equal(parameter.type, "string");
    assert.equal(parameter.default, "full");
    assert.deepEqual(parameter.values, ["full", "smoke-closure"]);
    const build = smokeJob.steps.find((step) => step.displayName === "Build");
    assert.match(
        build.pwsh,
        /if \('\$\{\{ parameters.smokeBuildScope \}\}' -eq 'full'\)/,
    );
    assert.match(build.pwsh, /pnpm run build --timer --logtime/);
    assert.match(
        build.pwsh,
        /pnpm exec fluid-build '\^\(agent-cli\|agent-shell\)\$' -t build --dep --timer --logtime/,
    );
    assert.match(build.pwsh, /exit \$status/);
    assert.ok(!build.continueOnError);
    assert.deepEqual(Object.keys(smokeJob.strategy.matrix).sort(), [
        "linux",
        "windows",
    ]);
    const usages = JSON.stringify(smoke).match(/parameters\.smokeBuildScope/g);
    assert.equal(
        usages.length,
        2,
        "Build scope must not affect test or credential gates",
    );
    for (const step of smokeJob.steps.filter(
        (step) => step.task === "AzureCLI@2",
    )) {
        assert.equal(step.inputs.azureSubscription, "$(azureSubscription)");
        assert.ok(!step.continueOnError);
    }
});

test("shared pnpm bootstrap uses the pinned standalone version without enabling Corepack", () => {
    const setup = pipeline("include-install-pnpm");
    const install = setup.steps.find(
        (step) => step.displayName === "Install and configure pnpm",
    );
    assert.match(install.bash, /^set -euo pipefail/);
    assert.match(
        install.bash,
        /require\('\.\/package\.json'\)\.packageManager/,
    );
    assert.match(
        install.bash,
        /npm install --global --force --userconfig "\$PWD\/\.npmrc" "pnpm@\$\{BASH_REMATCH\[1\]\}"/,
    );
    assert.doesNotMatch(install.bash, /\bcorepack\b/);
    assert.match(
        install.bash,
        /pnpm config set store-dir "\$storePath" --location project/,
    );
    assert.match(
        install.bash,
        /pnpm config set workspace-concurrency 0 --location project/,
    );
    assert.doesNotMatch(install.bash, /pnpm config set -g/);
});

test("project-scoped pnpm settings work without a configured global bin path and preserve user config", () => {
    assert.ok(process.env.npm_execpath, "Run through pnpm run ci:node");
    const directory = mkdtempSync(
        path.join(os.tmpdir(), "typeagent-pnpm-config-"),
    );
    try {
        const userConfig = path.join(directory, "user.npmrc");
        const store = path.join(directory, "store");
        writeFileSync(userConfig, "audit=false\n");
        writeFileSync(
            path.join(directory, "package.json"),
            JSON.stringify({ name: "bootstrap-fixture", private: true }),
        );
        const inherited = Object.fromEntries(
            Object.entries(process.env).filter(
                ([name]) => !name.toLowerCase().startsWith("npm_config_"),
            ),
        );
        const options = {
            cwd: directory,
            encoding: "utf8",
            env: {
                ...inherited,
                CI: "true",
                PNPM_HOME: path.join(directory, "pnpm"),
                HOME: directory,
                USERPROFILE: directory,
                APPDATA: path.join(directory, "roaming"),
                LOCALAPPDATA: path.join(directory, "local"),
                XDG_CONFIG_HOME: path.join(directory, "config"),
                XDG_DATA_HOME: path.join(directory, "data"),
                npm_config_userconfig: userConfig,
                npm_config_global_bin_dir: path.join(directory, "missing-bin"),
            },
        };
        const run = (...args) =>
            execFileSync(
                process.execPath,
                [process.env.npm_execpath, "config", ...args],
                options,
            ).trim();
        run("set", "store-dir", store, "--location", "project");
        run("set", "workspace-concurrency", "0", "--location", "project");
        assert.equal(
            path.normalize(run("get", "store-dir")),
            path.normalize(store),
        );
        const settings = yaml.load(
            readFileSync(path.join(directory, "pnpm-workspace.yaml"), "utf8"),
        );
        assert.equal(settings.workspaceConcurrency, 0);
        assert.equal(
            Number(run("get", "workspace-concurrency")),
            os.availableParallelism(),
        );
        assert.equal(readFileSync(userConfig, "utf8"), "audit=false\n");
    } finally {
        rmSync(directory, { recursive: true, force: true });
    }
});

test("smoke installs only Chromium and provisions OS dependencies only on Linux", () => {
    for (const [platform, agentOS, command] of [
        ["Windows", "Windows_NT", "pnpm exec playwright install chromium"],
        ["Linux", "Linux", "pnpm exec playwright install --with-deps chromium"],
    ]) {
        const step = smokeJob.steps.find(
            (step) =>
                step.displayName ===
                `Install Playwright Browsers (${platform})`,
        );
        assert.ok(step, `Missing browser installation for ${platform}`);
        assert.equal(
            step.condition,
            `and(succeeded(), eq(variables['Agent.OS'], '${agentOS}'))`,
        );
        assert.equal(step.script.trim(), command);
        assert.equal(step.workingDirectory, "$(buildDirectory)/packages/shell");
        assert.ok(!step.continueOnError);
        assert.ok(
            smokeJob.steps.indexOf(step) <
                smokeJob.steps.findIndex(
                    (item) => item.displayName === "Build",
                ),
        );
    }
    assert.equal(
        smokeJob.steps.filter((step) =>
            step.displayName?.startsWith("Install Playwright Browsers"),
        ).length,
        2,
    );
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

test("only the moved live-test task retains advisory failure handling", () => {
    assert.equal(liveStep.timeoutInMinutes, 60);
    assert.ok(liveJob.timeoutInMinutes > liveStep.timeoutInMinutes);
    assert.ok(liveJob.cancelTimeoutInMinutes >= 5);
    assert.equal(liveStep.continueOnError, true);
    for (const item of [liveJob, ...liveJob.steps]) {
        if (item !== liveStep) assert.ok(!item.continueOnError);
    }
    assert.match(liveStep.inputs.inlineScript, /^set -euo pipefail\n/);
    assert.match(liveStep.inputs.inlineScript, /\nnpm run test:live\s*$/);
});

test("key provisioning remains blocking before the advisory live task's fresh login", () => {
    assert.ok(provisionStep);
    for (const step of [provisionStep, liveStep]) {
        assert.equal(step.task, "AzureCLI@2");
        assert.equal(step.inputs.azureSubscription, "$(azureSubscription)");
        assert.equal(step.inputs.scriptType, "bash");
        assert.equal(step.inputs.workingDirectory, "$(buildDirectory)");
        assert.match(step.inputs.inlineScript, /^set -euo pipefail\n/);
        assert.match(
            step.inputs.inlineScript,
            /unset AZURE_CLIENT_ID AZURE_TENANT_ID AZURE_FEDERATED_TOKEN_FILE/,
        );
    }
    assert.match(
        provisionStep.inputs.inlineScript,
        /\nnode tools\/scripts\/getKeys.mjs --vault build-pipeline-kv --commit\s*$/,
    );
    assert.doesNotMatch(liveStep.inputs.inlineScript, /getKeys/);
    assert.ok(
        liveJob.steps.indexOf(provisionStep) >
            liveJob.steps.findIndex((step) => step.displayName === "Build"),
    );
    assert.ok(
        liveJob.steps.indexOf(provisionStep) < liveJob.steps.indexOf(liveStep),
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

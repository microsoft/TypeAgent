// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import test from "node:test";
import yaml from "js-yaml";
import {
    appendRemediationOutputs,
    renderRemediationReport,
} from "../remediationReport.mjs";

const helper = fileURLToPath(
    new URL("../remediationReport.mjs", import.meta.url),
);
const fixture = {
    resolved: "2",
    blocked: "1",
    no_patch: "3",
    deferred: "1",
    min_release_age_days: "7",
    failed: "1",
    skipped: "1",
    changes: "true",
    applied_packages: " @scope/example other",
    blocked_packages: " blocked",
    deferred_packages: " waiting",
    rolled_back_packages: " rolled",
    failed_workspaces: " docs",
};

test("formats accounting, commit trailers, deferred age and dependency chains", () => {
    const reports = renderRemediationReport(fixture, {
        shellOk: true,
        prCreated: true,
        chains: "example -> dependency",
    });
    assert.match(reports.commitMessage, /Applied: @scope\/example other/);
    assert.match(
        reports.commitMessage,
        /Co-authored-by: github-actions\[bot\]/,
    );
    assert.match(reports.prBody, /Applied \(2\)/);
    assert.match(reports.prBody, /No patch available \(3\)/);
    assert.match(reports.prBody, /at least 7 days/);
    assert.match(reports.prBody, /example -> dependency/);
    assert.match(reports.summary, /Changes applied and PR created/);
});

test("metadata stays literal in every report without shell interpretation", () => {
    const value = ' "; $(printf marker) `printf marker`\nnext line';
    const reports = renderRemediationReport({
        ...fixture,
        applied_packages: value,
        failed_workspaces: value,
    });
    for (const report of Object.values(reports)) {
        assert.ok(report.includes(value));
    }
});

test("embedded dependency fences cannot end the enclosing code block", () => {
    const reports = renderRemediationReport(fixture, {
        chains: "first\n```\nsecond\n````\nlast",
    });
    assert.match(
        reports.prBody,
        /`````\nfirst\n```\nsecond\n````\nlast\n`````/,
    );
});

test("summary does not report a successful PR when creation or analysis failed", () => {
    assert.match(
        renderRemediationReport(fixture, { prCreated: false }).summary,
        /Changes prepared, but no PR was created/,
    );
    assert.match(
        renderRemediationReport({}, { fixOutcome: "failure" }).summary,
        /Analysis did not complete successfully/,
    );
    assert.match(
        renderRemediationReport({}, { dryRun: true }).summary,
        /Dry run: no changes applied/,
    );
    assert.match(
        renderRemediationReport({}).summary,
        /No fixable alerts found/,
    );
});

for (const invalid of [
    [],
    null,
    { resolved: "-1" },
    { resolved: "1.5" },
    { blocked: "$(printf marker)" },
    { failed: "9007199254740992" },
    { applied_packages: ["example"] },
    { changes: "unexpected" },
]) {
    test(`rejects malformed structured output ${JSON.stringify(invalid)}`, () => {
        assert.throws(
            () => renderRemediationReport(invalid),
            /must be|must be an object/,
        );
    });
}

test("output records preserve quotes and newlines without injecting new keys", () => {
    const directory = mkdtempSync(join(tmpdir(), "remediation-output-"));
    try {
        const path = join(directory, "outputs");
        const value = ' one\nchanges=true\n"; $(printf marker)\nlast';
        appendRemediationOutputs(path, {
            ...fixture,
            applied_packages: value,
        });
        const lines = readFileSync(path, "utf8").split("\n");
        const parsed = {};
        for (let index = 0; index < lines.length && lines[index]; ) {
            const [key, delimiter] = lines[index++].split("<<");
            assert.ok(delimiter);
            const body = [];
            while (lines[index] !== delimiter) {
                assert.ok(index < lines.length);
                body.push(lines[index++]);
            }
            index++;
            parsed[key] = body.join("\n");
        }
        assert.equal(parsed.applied_packages, value);
        assert.equal(parsed.resolved, "2");
        assert.equal(parsed.changes, undefined);
    } finally {
        rmSync(directory, { recursive: true, force: true });
    }
});

test("CLI writes literal message/body files and appends a summary", () => {
    const directory = mkdtempSync(join(tmpdir(), "remediation-report-"));
    try {
        const env = {
            ...process.env,
            RUNNER_TEMP: directory,
            REMEDIATION_OUTPUTS: JSON.stringify(fixture),
            REMEDIATION_PR_CREATED: "true",
            REMEDIATION_FIX_OUTCOME: "success",
            GITHUB_STEP_SUMMARY: join(directory, "summary"),
        };
        for (const mode of ["files", "summary"]) {
            const result = spawnSync(process.execPath, [helper, mode], {
                encoding: "utf8",
                env,
            });
            assert.equal(result.status, 0, result.stderr);
        }
        assert.match(
            readFileSync(join(directory, "remediation-commit.txt"), "utf8"),
            /Applied: @scope\/example other/,
        );
        assert.match(
            readFileSync(join(directory, "remediation-pr.md"), "utf8"),
            /Applied \(2\)/,
        );
        assert.match(
            readFileSync(env.GITHUB_STEP_SUMMARY, "utf8"),
            /Changes applied and PR created/,
        );
    } finally {
        rmSync(directory, { recursive: true, force: true });
    }
});

test("workflow transports outputs as JSON data and consumes report files", () => {
    const workflow = yaml.load(
        readFileSync(
            new URL(
                "../../../../.github/workflows/fix-dependabot-alerts.yml",
                import.meta.url,
            ),
            "utf8",
        ),
    );
    const steps = workflow.jobs["fix-alerts"].steps;
    for (const step of steps.filter((step) => step.run)) {
        assert.doesNotMatch(step.run, /\$\{\{\s*steps\.fix\.outputs/);
    }
    const create = steps.find((step) => step.id === "pr");
    assert.equal(
        create.env.REMEDIATION_OUTPUTS,
        "${{ toJSON(steps.fix.outputs) }}",
    );
    assert.match(
        create.run,
        /git commit -F "\$RUNNER_TEMP\/remediation-commit\.txt"/,
    );
    assert.match(create.run, /--body-file "\$RUNNER_TEMP\/remediation-pr\.md"/);
    const summary = steps.find((step) => step.name === "Job summary");
    assert.equal(
        summary.env.REMEDIATION_PR_CREATED,
        "${{ steps.pr.outcome == 'success' }}",
    );
    assert.match(summary.run, /remediationReport\.mjs" summary/);
    const fix = steps.find((step) => step.id === "fix");
    assert.match(fix.run, /remediationReport\.mjs" outputs/);
    assert.doesNotMatch(fix.run, /echo "applied_packages=/);
});

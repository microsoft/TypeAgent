// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { parseArgs } from "node:util";
import { ciRunTiming, ciTimingSummary } from "./lib/ciDuration.mjs";

const { values } = parseArgs({
    options: {
        repo: { type: "string" },
        run: { type: "string", multiple: true },
    },
});
assert.match(
    values.repo ?? "",
    /^[\w.-]+\/[\w.-]+$/,
    "--repo owner/repo is required",
);
assert.ok(values.run?.length > 0, "At least one --run ID is required");
assert.ok(
    values.run.every((id) => /^\d+$/.test(id)),
    "Invalid run ID",
);
assert.equal(new Set(values.run).size, values.run.length, "Duplicate run ID");

function api(endpoint, paginated = false) {
    return JSON.parse(
        execFileSync(
            "gh",
            ["api", ...(paginated ? ["--paginate", "--slurp"] : []), endpoint],
            { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 },
        ),
    );
}

const repository = `repos/${values.repo}`;
const branch = api(repository).default_branch;
const rules = api(
    `${repository}/rules/branches/${encodeURIComponent(branch)}?per_page=100`,
    true,
).flat();
const required = rules
    .filter((rule) => rule.type === "required_status_checks")
    .flatMap((rule) =>
        rule.parameters.required_status_checks.map((check) => check.context),
    );
assert.ok(required.length > 0, "No active required-check rules were returned");

const runs = values.run.map((id) => {
    const run = api(`${repository}/actions/runs/${id}`);
    const jobs = Array.from({ length: run.run_attempt }, (_, index) => {
        const attempt = index + 1;
        return api(
            `${repository}/actions/runs/${id}/attempts/${attempt}/jobs?per_page=100`,
            true,
        ).flatMap((page) =>
            page.jobs.map((job) => ({ ...job, run_attempt: attempt })),
        );
    }).flat();
    const commit = `${repository}/commits/${run.head_sha}`;
    const checks = api(`${commit}/check-runs?per_page=100`, true).flatMap(
        (page) => page.check_runs.map((check) => ({ ...check, kind: "check" })),
    );
    const statuses = api(`${commit}/statuses?per_page=100`, true).flat();
    for (const status of statuses) {
        checks.push({
            id: status.id,
            kind: "status",
            name: status.context,
            created_at: status.created_at,
            started_at: status.created_at,
            status: status.state === "pending" ? "in_progress" : "completed",
            conclusion: status.state === "pending" ? null : status.state,
            completed_at: status.state === "pending" ? null : status.updated_at,
            html_url: status.target_url,
        });
    }
    return ciRunTiming(run, jobs, checks, required);
});
console.log(
    JSON.stringify(
        {
            repository: values.repo,
            rulesBranch: branch,
            sampledAt: new Date().toISOString(),
            limitations: [
                "Required-check rules and latest check results are sampled now, not reconstructed historically.",
                "All-required duration spans the earliest observed required check or first workflow creation to the latest required completion.",
                "Runner time covers only the selected GitHub workflow, including previous attempts; Azure runner cost is not included.",
                "Queue delay and test-retry time are not inferred from job or step durations.",
                "Successful-duration distributions exclude unsuccessful runs; outcome counts and individual runs retain them.",
                "Compare matching workflow events and coverage; this report does not establish functional equivalence.",
            ],
            summary: ciTimingSummary(runs),
            runs,
        },
        null,
        2,
    ),
);

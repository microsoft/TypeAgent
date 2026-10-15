// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import assert from "node:assert/strict";
import {
    mkdtempSync,
    mkdirSync,
    readFileSync,
    rmSync,
    symlinkSync,
    writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import yaml from "js-yaml";
import { prepareSarifFile, verifyForkAnalysis } from "../codeqlForkUpload.mjs";

const headSha = "a".repeat(40);
const baseSha = "b".repeat(40);
const ancestorSha = "c".repeat(40);
const workflowSha = "d".repeat(40);
const languages = [
    "actions",
    "csharp",
    "java-kotlin",
    "javascript-typescript",
    "python",
];

function fixture() {
    const context = {
        repo: { owner: "example", repo: "project" },
        payload: {
            repository: { default_branch: "main" },
            workflow_run: {
                id: 101,
                workflow_id: 404,
                event: "pull_request",
                conclusion: "success",
                head_sha: headSha,
                head_repository: { id: 202, fork: true },
            },
        },
    };
    const pr = {
        number: 303,
        head: {
            sha: headSha,
            repo: { id: 202, name: "fork", owner: { login: "contributor" } },
        },
        base: {
            sha: baseSha,
            ref: "main",
            repo: { full_name: "example/project" },
        },
    };
    const state = {
        context,
        prs: [pr],
        proposedWorkflow: workflowSha,
        workflowPath: ".github/workflows/codeql.yml",
        jobs: languages.map((language) => ({
            name: `Analyze (${language})`,
            status: "completed",
            conclusion: "success",
            steps: [
                "Initialize CodeQL",
                "Perform CodeQL Analysis",
                "Stage SARIF for fork PR upload",
            ].map((name) => ({ name, conclusion: "success" })),
        })),
        artifacts: languages.map((language) => ({
            name: `codeql-sarif-${language}`,
            expired: false,
        })),
        calls: [],
    };
    const pulls = () => {};
    const jobs = () => {};
    const artifacts = () => {};
    state.github = {
        rest: {
            pulls: { list: pulls },
            actions: {
                getWorkflow: async (parameters) => {
                    state.calls.push(parameters);
                    return { data: { path: state.workflowPath } };
                },
                listJobsForWorkflowRun: jobs,
                listWorkflowRunArtifacts: artifacts,
            },
            repos: {
                compareCommitsWithBasehead: async (parameters) => {
                    state.calls.push(parameters);
                    return {
                        data: { merge_base_commit: { sha: ancestorSha } },
                    };
                },
                getContent: async (parameters) => {
                    state.calls.push(parameters);
                    return {
                        data: {
                            type: "file",
                            sha:
                                parameters.ref === ancestorSha
                                    ? workflowSha
                                    : state.proposedWorkflow,
                        },
                    };
                },
            },
        },
        paginate: async (method, parameters) => {
            state.calls.push(parameters);
            if (method === pulls) return state.prs;
            if (method === jobs) return state.jobs;
            if (method === artifacts) return state.artifacts;
            throw new Error("Unexpected API method.");
        },
    };
    return state;
}

test("resolves the trusted PR/SHA and all analysis languages", async () => {
    const state = fixture();
    assert.deepEqual(await verifyForkAnalysis(state.github, state.context), {
        number: 303,
        sha: headSha,
        languages: [...languages].sort(),
    });
    assert.ok(
        state.calls.some((call) => call.basehead === `${baseSha}...${headSha}`),
    );
    assert.ok(state.calls.some((call) => call.ref === ancestorSha));
    assert.ok(
        state.calls.some(
            (call) => call.owner === "contributor" && call.ref === headSha,
        ),
    );
    assert.ok(
        state.calls
            .filter((call) => call.run_id)
            .every((call) => call.run_id === 101),
    );
});

test("rejects changed producers before downloading or accepting reports", async () => {
    const state = fixture();
    state.proposedWorkflow = "e".repeat(40);
    await assert.rejects(
        verifyForkAnalysis(state.github, state.context),
        /maintainer review and land the workflow change/,
    );
    assert.equal(
        state.calls.some((call) => call.run_id),
        false,
    );
});

for (const modify of [
    (state) => {
        state.prs = [];
    },
    (state) => {
        state.prs.push(structuredClone(state.prs[0]));
    },
    (state) => {
        state.prs[0].head.repo.id = 999;
    },
    (state) => {
        state.prs[0].base.ref = "other";
    },
    (state) => {
        state.context.payload.workflow_run.event = "push";
    },
    (state) => {
        state.context.payload.workflow_run.conclusion = "failure";
    },
    (state) => {
        state.context.payload.workflow_run.head_sha = "invalid";
    },
    (state) => {
        state.context.payload.workflow_run.workflow_id = 0;
    },
    (state) => {
        state.workflowPath = ".github/workflows/another.yml";
    },
    (state) => {
        state.jobs[0].conclusion = "skipped";
    },
    (state) => {
        state.jobs[0].steps[1].conclusion = "skipped";
    },
    (state) => {
        state.jobs.push(structuredClone(state.jobs[0]));
    },
    (state) => {
        state.jobs = [];
    },
    (state) => {
        state.artifacts.pop();
    },
    (state) => {
        state.artifacts[0].expired = true;
    },
    (state) => {
        state.artifacts[0].name = "codeql-sarif-unexpected";
    },
    (state) => {
        state.artifacts[1].name = state.artifacts[0].name;
    },
]) {
    test(`rejects inconsistent run metadata: ${modify.toString()}`, async () => {
        const state = fixture();
        modify(state);
        await assert.rejects(verifyForkAnalysis(state.github, state.context));
    });
}

function withReport(callback) {
    const directory = mkdtempSync(join(tmpdir(), "codeql-report-"));
    const artifact = join(directory, "artifact");
    mkdirSync(artifact);
    const input = join(artifact, "python.sarif");
    const output = join(directory, "validated.sarif");
    const sarif = {
        version: "2.1.0",
        runs: [{ tool: { driver: { name: "CodeQL" } }, results: [] }],
    };
    try {
        callback({ artifact, input, output, sarif });
    } finally {
        rmSync(directory, { recursive: true, force: true });
    }
}

test("accepts authentic clean reports and assigns a trusted language category", () => {
    withReport(({ artifact, input, output, sarif }) => {
        writeFileSync(input, JSON.stringify(sarif));
        assert.equal(prepareSarifFile(artifact, "python", output), output);
        const saved = JSON.parse(readFileSync(output, "utf8"));
        assert.deepEqual(saved.runs[0].results, []);
        assert.equal(saved.runs[0].automationDetails.id, "/language:python/");
    });
});

test("preserves findings and canonicalizes the expected category", () => {
    withReport(({ artifact, input, output, sarif }) => {
        sarif.runs[0].automationDetails = { id: "/language:python/" };
        sarif.runs[0].results = [
            { ruleId: "example", message: { text: "sample" } },
        ];
        writeFileSync(input, JSON.stringify(sarif));
        prepareSarifFile(artifact, "python", output);
        const saved = JSON.parse(readFileSync(output, "utf8"));
        assert.equal(saved.runs[0].results[0].ruleId, "example");
        assert.equal(saved.runs[0].automationDetails.id, "/language:python/");
    });
});

for (const modify of [
    (sarif) => {
        sarif.version = "1.0.0";
    },
    (sarif) => {
        sarif.runs = [];
    },
    (sarif) => {
        sarif.runs.push(structuredClone(sarif.runs[0]));
    },
    (sarif) => {
        sarif.runs[0].tool.driver.name = "Other";
    },
    (sarif) => {
        sarif.runs[0].results = {};
    },
    (sarif) => {
        sarif.runs[0].automationDetails = [];
    },
    (sarif) => {
        sarif.runs[0].automationDetails = { id: "/language:csharp" };
    },
]) {
    test(`rejects invalid report data: ${modify.toString()}`, () => {
        withReport(({ artifact, input, output, sarif }) => {
            modify(sarif);
            writeFileSync(input, JSON.stringify(sarif));
            assert.throws(() => prepareSarifFile(artifact, "python", output));
        });
    });
}

test("rejects unexpected, missing, duplicate, malformed and unsafe report paths", () => {
    withReport(({ artifact, input, output, sarif }) => {
        assert.throws(
            () => prepareSarifFile(artifact, "python", output),
            /exactly one/,
        );
        writeFileSync(input, "not JSON");
        assert.throws(
            () => prepareSarifFile(artifact, "python", output),
            SyntaxError,
        );
        writeFileSync(input, JSON.stringify(sarif));
        assert.throws(
            () => prepareSarifFile(artifact, "../python", output),
            /language/,
        );
        writeFileSync(join(artifact, "unexpected.txt"), "data");
        assert.throws(
            () => prepareSarifFile(artifact, "python", output),
            /unexpected file/,
        );
    });
    withReport(({ artifact, input, output, sarif }) => {
        writeFileSync(input, JSON.stringify(sarif));
        writeFileSync(join(artifact, "other.sarif"), JSON.stringify(sarif));
        assert.throws(
            () => prepareSarifFile(artifact, "python", output),
            /exactly one/,
        );
    });
});

test("does not follow symbolic links or Windows directory junctions", () => {
    withReport(({ artifact, output, sarif }) => {
        const other = join(artifact, "..", "other");
        mkdirSync(other);
        writeFileSync(join(other, "python.sarif"), JSON.stringify(sarif));
        symlinkSync(other, join(artifact, "linked"), "junction");
        assert.throws(
            () => prepareSarifFile(artifact, "python", output),
            /symbolic links/,
        );
    });
});

test("workflow verifies first, checks out trusted helpers, and isolates categories", () => {
    const workflow = yaml.load(
        readFileSync(
            new URL(
                "../../../../.github/workflows/codeql-fork-upload.yml",
                import.meta.url,
            ),
            "utf8",
        ),
    );
    assert.equal(
        workflow.jobs.verify.permissions["security-events"],
        undefined,
    );
    assert.equal(workflow.jobs.upload.needs, "verify");
    assert.equal(
        workflow.jobs.upload.strategy.matrix.language,
        "${{ fromJSON(needs.verify.outputs.languages) }}",
    );
    for (const job of Object.values(workflow.jobs)) {
        const checkout = job.steps.find((step) =>
            step.uses?.startsWith("actions/checkout@"),
        );
        assert.equal(checkout.with.ref, "${{ github.workflow_sha }}");
        assert.equal(checkout.with["persist-credentials"], false);
        assert.equal(
            checkout.with["sparse-checkout"],
            "ts/tools/scripts/codeqlForkUpload.mjs",
        );
    }
    const download = workflow.jobs.upload.steps.find((step) =>
        step.uses?.startsWith("actions/download-artifact@"),
    );
    assert.equal(download.with.name, "codeql-sarif-${{ matrix.language }}");
    assert.equal(download.with.pattern, undefined);
    assert.equal(download.with["merge-multiple"], undefined);
    const upload = workflow.jobs.upload.steps.find((step) =>
        step.uses?.startsWith("github/codeql-action/upload-sarif@"),
    );
    assert.equal(upload.with.category, "/language:${{ matrix.language }}");
    assert.equal(
        upload.with.ref,
        "refs/pull/${{ needs.verify.outputs.number }}/head",
    );
    assert.equal(upload.with.sha, "${{ needs.verify.outputs.sha }}");
    assert.equal(upload.with.sarif_file, "${{ steps.report.outputs.sarif }}");
});

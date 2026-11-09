// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import {
    appendFileSync,
    readFileSync,
    readdirSync,
    writeFileSync,
} from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const workflowPath = ".github/workflows/codeql.yml";
const shaPattern = /^[a-f0-9]{40}$/i;
const languagePattern = /^[a-z]+(?:-[a-z]+)*$/;

function requireValue(condition, message) {
    if (!condition) throw new Error(message);
}

async function workflowBlob(github, owner, repo, ref) {
    const { data } = await github.rest.repos.getContent({
        owner,
        repo,
        ref,
        path: workflowPath,
    });
    requireValue(
        !Array.isArray(data) &&
            data.type === "file" &&
            shaPattern.test(data.sha),
        "Could not establish the analysis workflow revision.",
    );
    return data.sha;
}

function analysisLanguages(jobs) {
    const languages = [];
    for (const job of jobs) {
        const match = /^Analyze \(([^)]+)\)$/.exec(job.name);
        if (!match) continue;
        const language = match[1];
        requireValue(
            languagePattern.test(language) &&
                !languages.includes(language) &&
                job.status === "completed" &&
                job.conclusion === "success",
            "The analysis job matrix is incomplete or invalid.",
        );
        for (const stepName of [
            "Initialize CodeQL",
            "Perform CodeQL Analysis",
            "Stage SARIF for fork PR upload",
        ]) {
            requireValue(
                job.steps?.some(
                    (step) =>
                        step.name === stepName && step.conclusion === "success",
                ),
                `Analysis did not complete the required step: ${stepName}.`,
            );
        }
        languages.push(language);
    }
    requireValue(
        languages.length > 0,
        "No completed analysis jobs were found.",
    );
    return languages.sort();
}

function validateArtifacts(artifacts, languages) {
    const expected = new Set(
        languages.map((language) => `codeql-sarif-${language}`),
    );
    const reports = artifacts.filter((artifact) =>
        artifact.name.startsWith("codeql-sarif-"),
    );
    requireValue(
        reports.length === expected.size,
        "The analysis artifact set is incomplete or unexpected.",
    );
    for (const artifact of reports) {
        requireValue(
            expected.delete(artifact.name) && artifact.expired === false,
            "An analysis artifact is duplicated, expired, or unexpected.",
        );
    }
}

export async function verifyForkAnalysis(github, context) {
    const run = context.payload.workflow_run;
    const repository = context.payload.repository;
    requireValue(
        run?.event === "pull_request" &&
            run.conclusion === "success" &&
            run.head_repository?.fork === true &&
            Number.isSafeInteger(run.id) &&
            run.id > 0 &&
            Number.isSafeInteger(run.workflow_id) &&
            run.workflow_id > 0 &&
            shaPattern.test(run.head_sha),
        "Expected a successful fork pull-request analysis run.",
    );
    const repo = context.repo;
    const { data: workflow } = await github.rest.actions.getWorkflow({
        ...repo,
        workflow_id: run.workflow_id,
    });
    requireValue(
        workflow.path === workflowPath,
        "The triggering run is not the configured analysis workflow.",
    );
    const pullRequests = await github.paginate(github.rest.pulls.list, {
        ...repo,
        state: "open",
        per_page: 100,
    });
    const matches = pullRequests.filter(
        (pr) =>
            pr.head.sha === run.head_sha &&
            pr.head.repo?.id === run.head_repository.id &&
            pr.base.repo?.full_name === `${repo.owner}/${repo.repo}` &&
            pr.base.ref === repository.default_branch,
    );
    requireValue(
        matches.length === 1,
        "Expected exactly one open pull request for the analysis head.",
    );
    const pr = matches[0];
    const { data: comparison } =
        await github.rest.repos.compareCommitsWithBasehead({
            ...repo,
            basehead: `${pr.base.sha}...${run.head_sha}`,
        });
    const ancestor = comparison.merge_base_commit?.sha;
    requireValue(
        shaPattern.test(ancestor),
        "Could not establish the pull request's trusted merge base.",
    );
    const [trustedWorkflow, proposedWorkflow] = await Promise.all([
        workflowBlob(github, repo.owner, repo.repo, ancestor),
        workflowBlob(
            github,
            pr.head.repo.owner.login,
            pr.head.repo.name,
            run.head_sha,
        ),
    ]);
    requireValue(
        trustedWorkflow === proposedWorkflow,
        "This pull request changes its analysis workflow. Have a maintainer review and land the workflow change on the base branch, then update the pull request and rerun analysis.",
    );
    const jobs = await github.paginate(
        github.rest.actions.listJobsForWorkflowRun,
        { ...repo, run_id: run.id, filter: "latest", per_page: 100 },
    );
    const languages = analysisLanguages(jobs);
    const artifacts = await github.paginate(
        github.rest.actions.listWorkflowRunArtifacts,
        { ...repo, run_id: run.id, per_page: 100 },
    );
    validateArtifacts(artifacts, languages);
    return { number: pr.number, sha: run.head_sha, languages };
}

function sarifFiles(directory) {
    const files = [];
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
        requireValue(
            !entry.isSymbolicLink(),
            "Analysis artifacts must not contain symbolic links.",
        );
        const path = join(directory, entry.name);
        if (entry.isDirectory()) {
            files.push(...sarifFiles(path));
        } else {
            requireValue(
                entry.isFile() && entry.name.endsWith(".sarif"),
                "Analysis artifact contains an unexpected file.",
            );
            files.push(path);
        }
    }
    return files;
}

export function prepareSarifFile(directory, language, destination) {
    requireValue(
        languagePattern.test(language),
        "The analysis language is invalid.",
    );
    const files = sarifFiles(directory);
    requireValue(
        files.length === 1,
        "Expected exactly one SARIF file for the analysis language.",
    );
    const sarif = JSON.parse(readFileSync(files[0], "utf8"));
    requireValue(
        sarif?.version === "2.1.0" &&
            Array.isArray(sarif.runs) &&
            sarif.runs.length === 1,
        "Expected a SARIF 2.1.0 report with one analysis run.",
    );
    const run = sarif.runs[0];
    requireValue(
        run?.tool?.driver?.name === "CodeQL" &&
            (run.results === undefined || Array.isArray(run.results)),
        "Expected CodeQL analysis results.",
    );
    const category = `/language:${language}`;
    const automation = run.automationDetails;
    requireValue(
        automation === undefined ||
            (automation !== null &&
                typeof automation === "object" &&
                !Array.isArray(automation)),
        "Analysis automation details are invalid.",
    );
    requireValue(
        automation?.id === undefined ||
            automation.id === category ||
            automation.id === `${category}/`,
        "The report requests an unexpected analysis category.",
    );
    run.automationDetails = { ...automation, id: `${category}/` };
    writeFileSync(destination, JSON.stringify(sarif), "utf8");
    return destination;
}

const script = fileURLToPath(import.meta.url);
const invoked = process.argv[1] && resolve(process.argv[1]);
const isMain =
    invoked &&
    (process.platform === "win32"
        ? invoked.toLowerCase() === script.toLowerCase()
        : invoked === script);
if (isMain) {
    try {
        const language = process.env.CODEQL_LANGUAGE;
        requireValue(
            process.env.RUNNER_TEMP &&
                process.env.CODEQL_SARIF_DIRECTORY &&
                process.env.GITHUB_OUTPUT,
            "Analysis preparation paths are required.",
        );
        const destination = prepareSarifFile(
            process.env.CODEQL_SARIF_DIRECTORY,
            language,
            join(process.env.RUNNER_TEMP, `codeql-upload-${language}.sarif`),
        );
        appendFileSync(
            process.env.GITHUB_OUTPUT,
            `sarif=${destination}\n`,
            "utf8",
        );
    } catch (error) {
        console.error(`::error::${error.message}`);
        process.exitCode = 1;
    }
}

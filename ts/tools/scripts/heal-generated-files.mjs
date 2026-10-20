// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

// This CLI is always loaded from a full, API-resolved default-branch commit.
// Candidate preparation has no write credentials. The privileged command only
// verifies trusted objects, revalidates the pull request, and performs one
// exact-head leased push.

import {
    createGitHubApi,
    loadJsonFile,
    prepareCandidateArtifact,
    pushVerifiedPlan,
    verifyCandidateArtifact,
} from "./lib/generatedFileHealing.mjs";

function parseArguments(argv) {
    const [command, ...rest] = argv;
    const values = new Map();
    for (let index = 0; index < rest.length; index++) {
        const argument = rest[index];
        if (!argument.startsWith("--")) {
            throw new Error(`Unexpected argument: ${argument}`);
        }
        const equal = argument.indexOf("=");
        if (equal !== -1) {
            values.set(argument.slice(2, equal), argument.slice(equal + 1));
            continue;
        }
        const value = rest[index + 1];
        if (value === undefined || value.startsWith("--")) {
            throw new Error(`Missing value for ${argument}`);
        }
        values.set(argument.slice(2), value);
        index++;
    }
    const required = (name) => {
        const value = values.get(name);
        if (!value) {
            throw new Error(`Missing --${name}`);
        }
        return value;
    };
    return { command, required };
}

async function main() {
    const { command, required } = parseArguments(process.argv.slice(2));
    if (command === "prepare") {
        const summary = prepareCandidateArtifact({
            metadata: loadJsonFile(required("metadata")),
            outputDirectory: required("output"),
            repositoryUrl: required("repository-url"),
            pnpmCommand: required("pnpm"),
        });
        console.log(
            `[heal] prepared ${summary.candidates.length} candidate(s); skipped ${summary.skipped.length}`,
        );
        return;
    }
    if (command === "verify") {
        const plan = verifyCandidateArtifact({
            artifactDirectory: required("artifact"),
            liveMetadata: loadJsonFile(required("live-metadata")),
            expectedRunId: required("run-id"),
            repositoryUrl: required("repository-url"),
            pnpmCommand: required("pnpm"),
            planPath: required("plan"),
        });
        console.log(`[heal] verified ${plan.candidates.length} candidate(s)`);
        return;
    }
    if (command === "push") {
        const plan = loadJsonFile(required("plan"));
        const token = process.env.HEAL_PUSH_TOKEN;
        if (!token) {
            throw new Error("HEAL_PUSH_TOKEN is required");
        }
        delete process.env.HEAL_PUSH_TOKEN;
        const api = createGitHubApi({
            repository: plan.repository,
            token,
            apiUrl: process.env.GITHUB_API_URL,
        });
        await pushVerifiedPlan({ plan, api, token });
        console.log(`[heal] pushed ${plan.candidates.length} candidate(s)`);
        return;
    }
    throw new Error(`Unknown command: ${command ?? "(missing)"}`);
}

main().catch((error) => {
    console.error(`[heal] ${error.stack ?? error.message}`);
    process.exitCode = 1;
});

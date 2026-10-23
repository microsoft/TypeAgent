// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import {
    prepareRecipeAuthorRequest,
    type RecipeAuthorRequest,
    type RecipeAuthoringContextStore,
} from "./recipeAuthoring.js";
import { parseRecipeAuthorCandidate } from "./recipeAuthoringCandidate.js";
import {
    checkRecipeCapability,
    recipePublicationState,
    sealRecipeArtifact,
    validateRecipeArtifact,
    type JsonValue,
    type RecipeArtifact,
    type RecipeCallContext,
    type RecipeCapability,
    type RecipeCatalog,
    type RecipeHost,
    type RecipeJob,
    type RecipeSpecification,
} from "./recipeCore.js";
import { FakeRecipeHost, runRecipeFixture } from "./recipeTesting.js";

export type RecipeAuthoringAttempt =
    | { status: "authoring"; job: RecipeJob; request: RecipeAuthorRequest }
    | { status: "unclaimed" | "conflict"; message: string }
    | { status: "blocked"; job: RecipeJob; message: string };

async function updateJob(
    catalog: RecipeCatalog,
    job: RecipeJob,
): Promise<void> {
    if (!job.claim) throw new Error("Job has no authoring claim.");
    const claimToken = job.claim.token;
    const snapshot = await catalog.snapshot(job.scope);
    const result = await catalog.transact(
        job.scope,
        snapshot.catalogRevision,
        (transaction) => transaction.updateJob(job, claimToken),
    );
    if (result.status !== "committed")
        throw new Error("Catalog conflict; job update was not committed.");
}

export async function claimRecipeAuthoring(
    catalog: RecipeCatalog,
    store: RecipeAuthoringContextStore,
    selection: {
        job: RecipeJob;
        ownerId: string;
        now: string;
        expiresAt: string;
    },
): Promise<RecipeAuthoringAttempt> {
    const snapshot = await catalog.snapshot(selection.job.scope);
    let claimed: RecipeJob | undefined;
    const commit = await catalog.transact(
        selection.job.scope,
        snapshot.catalogRevision,
        (transaction) => {
            claimed = transaction.claimJob(
                selection.job.jobId,
                selection.ownerId,
                selection.now,
                selection.expiresAt,
            );
            if (claimed) {
                claimed.state = "authoring";
                transaction.updateJob(claimed, claimed.claim!.token);
            }
        },
    );
    if (commit.status !== "committed")
        return {
            status: "conflict",
            message: "Authoring claim was not committed.",
        };
    if (!claimed)
        return {
            status: "unclaimed",
            message: "Job is not available to claim.",
        };
    const job: RecipeJob = claimed;
    try {
        const request = await prepareRecipeAuthorRequest(job, store);
        return { status: "authoring", job, request };
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        job.state = "blocked";
        job.message = message;
        await updateJob(catalog, job);
        return { status: "blocked", job, message };
    }
}

export interface RecipeAuthoringFixture {
    id: string;
    origin: "observed" | "synthetic" | "independent";
    input: JsonValue;
    expected: { status: "passed"; output: JsonValue } | { status: "failed" };
    createHost(): FakeRecipeHost;
    context: RecipeCallContext;
    execute(
        host: RecipeHost,
        input: JsonValue,
        context: RecipeCallContext,
        artifact: RecipeArtifact,
    ): Promise<JsonValue>;
}

// Supplied by the reviewer/harness, not by the candidate. Callback executors
// are trusted offline fixtures, not containment for generated source.
export interface RecipeAuthoringValidationPlan {
    implementationRevision: string;
    specification: RecipeSpecification;
    inspectedCapabilities?: RecipeCapability[];
    fixtures: RecipeAuthoringFixture[];
}

function candidateError(
    candidate: RecipeArtifact,
    request: RecipeAuthorRequest,
    plan: RecipeAuthoringValidationPlan,
): string | undefined {
    const invalid = validateRecipeArtifact(candidate);
    if (invalid.length) return invalid[0].message;
    if (candidate.revision !== plan.implementationRevision)
        return "Fixture executor is not bound to the submitted implementation revision.";
    const capture = request.envelope.context.capture;
    const context = request.envelope.context;
    const knownEvidence = new Set([
        ...capture.outputEvidenceIds,
        ...context.messages.map((message) => message.eventId),
        ...context.workingCode.map((code) => code.id),
        ...context.capabilities.map((capability) => capability.id),
        ...plan.fixtures.map((fixture) => fixture.id),
    ]);
    if (
        candidate.provenance.captureId !== capture.captureId ||
        candidate.provenance.taskId !== capture.taskId ||
        candidate.provenance.tokenId !== capture.tokenId ||
        candidate.provenance.evidenceIds.some((id) => !knownEvidence.has(id)) ||
        capture.outputEvidenceIds.some(
            (id) => !candidate.provenance.evidenceIds.includes(id),
        )
    )
        return "Candidate provenance does not correlate with captured output evidence.";
    if (
        candidate.capabilities.some((requirement) => {
            const available = [
                ...context.capabilities,
                ...(plan.inspectedCapabilities ?? []),
            ].find((capability) => capability.id === requirement.id);
            return (
                !available ||
                checkRecipeCapability(requirement, available).length > 0
            );
        })
    )
        return "Candidate invented or changed a captured capability contract.";
    if (
        JSON.stringify(candidate.specification) !==
        JSON.stringify(plan.specification)
    )
        return "Candidate changed the independently retained specification.";
    if (
        !plan.fixtures.length ||
        new Set(plan.fixtures.map((fixture) => fixture.id)).size !==
            plan.fixtures.length ||
        !plan.fixtures.some((fixture) => fixture.origin === "observed") ||
        !plan.fixtures.some((fixture) => fixture.origin === "independent")
    )
        return "Unique observed and independent counterexample fixtures are required.";
    const positiveInputs = new Set(
        plan.fixtures
            .filter((fixture) => fixture.expected.status === "passed")
            .map((fixture) => JSON.stringify(fixture.input)),
    );
    if (positiveInputs.size < 2)
        return "Passing fixtures must exercise different grounded input values.";
    if (
        plan.fixtures.some(
            ({ context }) =>
                context.binding.workspaceId !== capture.scope.workspaceId ||
                context.binding.profileId !== capture.scope.profileId,
        )
    )
        return "Fixture scope does not match capture scope.";
    return undefined;
}

async function validateFixtures(
    candidate: RecipeArtifact,
    plan: RecipeAuthoringValidationPlan,
): Promise<RecipeArtifact> {
    const fixtures: RecipeArtifact["fixtures"] = [];
    for (const fixture of plan.fixtures) {
        const host = fixture.createHost();
        if (!(host instanceof FakeRecipeHost))
            throw new Error("Validation requires a fixture-only host.");
        const result = await runRecipeFixture(
            candidate,
            fixture.input,
            host,
            fixture.context,
            (fixtureHost, input, context) =>
                fixture.execute(fixtureHost, input, context, candidate),
        );
        const passed =
            result.status === fixture.expected.status &&
            (result.status !== "passed" ||
                (fixture.expected.status === "passed" &&
                    JSON.stringify(result.output) ===
                        JSON.stringify(fixture.expected.output)));
        if (!passed)
            throw new Error(
                `Fixture ${fixture.id} did not meet its expected outcome.`,
            );
        fixtures.push({
            id: fixture.id,
            origin: fixture.origin,
            result: "passed",
            specificationRevision: plan.specification.revision,
            noLiveEffects: true,
        });
    }
    const { revision: _revision, ...draft } = candidate;
    return sealRecipeArtifact({ ...draft, fixtures });
}

export type RecipeCandidateSubmission =
    | {
          status: "published";
          state: "prepared" | "ready";
          artifact: RecipeArtifact;
      }
    | {
          status: "failed" | "blocked";
          message: string;
          recoveryPersisted: boolean;
      };

export async function failRecipeAuthoring(
    catalog: RecipeCatalog,
    job: RecipeJob,
    status: "failed" | "blocked",
    message: string,
): Promise<RecipeCandidateSubmission> {
    try {
        await updateJob(catalog, { ...job, state: status, message });
        return { status, message, recoveryPersisted: true };
    } catch (error) {
        return {
            status,
            message: `${message} Recovery update failed: ${
                error instanceof Error ? error.message : String(error)
            }`,
            recoveryPersisted: false,
        };
    }
}

export async function submitRecipeCandidate(
    catalog: RecipeCatalog,
    store: RecipeAuthoringContextStore,
    job: RecipeJob,
    candidatePayload: unknown,
    plan: RecipeAuthoringValidationPlan,
): Promise<RecipeCandidateSubmission> {
    try {
        const candidate = parseRecipeAuthorCandidate(
            typeof candidatePayload === "string"
                ? candidatePayload
                : JSON.stringify(candidatePayload),
        );
        if (job.state !== "authoring" || !job.claim)
            throw new Error(
                "Candidate requires an actively claimed authoring job.",
            );
        const request = await prepareRecipeAuthorRequest(job, store);
        const error = candidateError(candidate, request, plan);
        if (error) throw new Error(error);
        await updateJob(catalog, { ...job, state: "validating" });
        const artifact = await validateFixtures(candidate, plan);
        const capture = request.envelope.context.capture;
        const state = recipePublicationState(artifact, capture.mode);
        if (state !== "prepared" && state !== "ready")
            throw new Error("Learning is off; candidate cannot be published.");
        const snapshot = await catalog.snapshot(job.scope);
        const commit = await catalog.transact(
            job.scope,
            snapshot.catalogRevision,
            (transaction) => {
                transaction.putImmutable(artifact);
                transaction.publish(artifact, capture.captureId, state);
                transaction.updateJob(
                    {
                        ...job,
                        state,
                        result: {
                            recipeId: artifact.recipeId,
                            revision: artifact.revision,
                        },
                    },
                    job.claim!.token,
                );
            },
        );
        if (commit.status !== "committed")
            throw new Error(
                "Catalog conflict; candidate publication was not committed.",
            );
        return { status: "published", state, artifact };
    } catch (error) {
        return failRecipeAuthoring(
            catalog,
            job,
            "failed",
            error instanceof Error ? error.message : String(error),
        );
    }
}

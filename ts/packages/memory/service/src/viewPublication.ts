// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { validateInventoryAudit } from "./viewInventory.js";
import { inventoryEvidence } from "./viewInventoryCoverage.js";
import { viewHash } from "./viewMerge.js";
import { authoredRelationships } from "./viewRelationships.js";
import { validateConstructedGuide, validateSupport } from "./viewSynthesis.js";
import type {
    ViewEffectivePublicationPolicy,
    ViewPublicationPolicy,
    ViewPublicationProof,
    ViewSupportReport,
    ViewSynthesisOutput,
    ViewVersion,
} from "./viewTypes.js";

export function effectiveViewPublicationPolicy(
    policy: ViewPublicationPolicy,
    viewId: string,
    buildOverride?: boolean,
): ViewEffectivePublicationPolicy {
    const view = policy.views[viewId];
    return {
        autoPublish: buildOverride ?? view?.autoPublish ?? policy.autoPublish,
        origin:
            buildOverride !== undefined
                ? "build"
                : view?.autoPublish != null
                  ? "view"
                  : "corpus",
        corpusRevision: policy.revision,
        viewRevision: view?.revision ?? 0,
        ...(buildOverride === undefined ? {} : { buildOverride }),
    };
}

export function publicationArtifact(version: ViewVersion): ViewSynthesisOutput {
    if (
        !version.generation?.input ||
        !version.generation.outcome ||
        !version.generation.missingEvidence
    )
        throw new Error(
            "Publication requires an evidence-first build with a known generated base; build this guide from its exact sources first",
        );
    return {
        content: version.content,
        relationships: authoredRelationships(version),
        outcome: version.generation.outcome,
        missingEvidence: version.generation.missingEvidence,
        ...inventoryEvidence(version.generation),
    };
}

export function publicationProof(
    inputFingerprint: string,
    output: ViewSynthesisOutput,
    support: ViewSupportReport,
): ViewPublicationProof {
    return {
        inputFingerprint,
        artifactFingerprint: viewHash(output),
        support,
    };
}

export function assertPublicationProof(version: ViewVersion): void {
    const output = publicationArtifact(version);
    const input = version.generation!.input!;
    if (
        input.pipeline !== "schema-defined-v1" &&
        (!output.inventory || !output.inventoryAudit || !output.coverage)
    )
        throw new Error(
            "Publication requires complete source inventory, independent source checking and final artifact coverage; rebuild with an evidence-first adapter",
        );
    if (output.inventory && output.inventoryAudit)
        validateInventoryAudit(input, output.inventory, output.inventoryAudit);
    validateConstructedGuide(input, output);
    const proof = version.validation;
    if (
        !proof ||
        proof.inputFingerprint !== input.fingerprint ||
        proof.artifactFingerprint !== viewHash(output)
    )
        throw new Error(
            "This exact artifact has no independent support proof; validate it through Save draft or rebuild before publishing",
        );
    validateSupport(output, proof.support);
}

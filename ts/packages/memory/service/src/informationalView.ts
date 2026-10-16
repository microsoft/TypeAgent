// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import type { ViewDefinitionInput } from "./viewTypes.js";

const indexedEvidenceRecipe = ":indexed-evidence-v2";

export function viewSynthesisIdentity(
    model: string,
    definition: ViewDefinitionInput,
    consolidation = false,
): string {
    if (definition.projectSummary)
        return `${model}:project-attribution-v4:editorial-v1${indexedEvidenceRecipe}`;
    if (definition.wiki)
        return `${model}:wiki-source-contribution-v4:editorial-v1${consolidation ? ":consolidation-v1" : ""}${indexedEvidenceRecipe}`;
    return model;
}

export function informationalView(content: {
    kind: string;
    construction?: string;
}): boolean {
    return (
        (content.kind === "wiki" &&
            content.construction === "informational-wiki-v1") ||
        (content.kind === "projectBrief" &&
            content.construction === "informational-project-summary-v1")
    );
}

export function informationalPipeline(pipeline: string): boolean {
    return (
        pipeline === "informational-wiki-v1" ||
        pipeline === "informational-project-summary-v1"
    );
}

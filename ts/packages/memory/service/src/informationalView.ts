// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import type { ViewDefinitionInput } from "./viewTypes.js";

export function viewSynthesisIdentity(
    model: string,
    definition: ViewDefinitionInput,
): string {
    if (definition.projectSummary) return `${model}:project-attribution-v3`;
    if (definition.wiki) return `${model}:wiki-source-contribution-v3`;
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

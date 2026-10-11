// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

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

// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import type { KnowledgeDiagnostic, KnowledgeFamily } from "./knowledgeTypes.js";
import type { ViewBuildJob } from "./viewTypes.js";

const families: Readonly<Record<string, KnowledgeFamily>> = {
    "schema-defined-v1": "questions",
    "informational-wiki-v1": "wiki",
    "informational-project-summary-v1": "projects",
    "topics-v1": "topics",
};

export function knowledgeBuildDiagnostics(
    job: ViewBuildJob,
): KnowledgeDiagnostic[] {
    return job.results.map((target) => ({
        phase: "maintenance",
        family: families[target.snapshot.pipeline],
        jobId: job.jobId,
        jobUpdatedAt: job.updatedAt,
        viewId: target.viewId,
        state: target.state,
        code:
            (target.state === "blocked" || target.state === "failed") &&
            target.missingEvidence?.length
                ? "evidence-incomplete"
                : `target-${target.state}`,
    }));
}

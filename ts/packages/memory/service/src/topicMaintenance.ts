// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import type { TopicFamilyState } from "./topicTypes.js";
import type { ViewBuildJob } from "./viewTypes.js";

export function applyTopicFamilyOperation(
    family: TopicFamilyState,
    operation: "update" | "rebuild" | "pause" | "resume",
): TopicFamilyState {
    const next = { ...family };
    if (operation === "pause") next.enabled = false;
    if (operation === "resume") next.enabled = true;
    if (operation === "rebuild" || operation === "resume") {
        next.dirty = true;
        delete next.error;
    }
    return next;
}

export function topicFamilyCanSchedule(family: TopicFamilyState): boolean {
    return family.enabled && family.dirty && !family.error;
}

export function checkpointTopicFamily(
    family: TopicFamilyState,
    job: ViewBuildJob,
    jobs: ViewBuildJob[],
): TopicFamilyState {
    const result = job.results.find(
        (entry) => entry.snapshot.pipeline === "topics-v1",
    );
    if (!result || job.state === "running") return family;
    const next = { ...family };
    if (job.state === "complete" && !result.missingEvidence?.length) {
        next.dirty = false;
        delete next.error;
        return next;
    }
    if (
        job.state === "cancelled" ||
        result.state === "blocked" ||
        result.state === "stale"
    ) {
        next.dirty = result.state === "stale";
        if (result.state !== "stale") next.error = result.reason;
        return next;
    }
    const attempts = jobs.filter(
        (candidate) =>
            candidate.state !== "running" &&
            candidate.results.some(
                (entry) =>
                    entry.snapshot.pipeline === "topics-v1" &&
                    entry.snapshot.fingerprint ===
                        result.snapshot.fingerprint &&
                    (["failed", "interrupted"].includes(entry.state) ||
                        !!entry.missingEvidence?.length),
            ),
    ).length;
    next.dirty = attempts < 2;
    if (attempts >= 2)
        next.error = result.missingEvidence?.join("; ") || result.reason;
    else delete next.error;
    return next;
}

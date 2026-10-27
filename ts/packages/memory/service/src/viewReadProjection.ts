// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { buildSummary } from "./inventory.js";
import type { ViewBuildSummary } from "./inventoryTypes.js";
import { viewBuildEvidenceFingerprint } from "./viewMerge.js";
import type { WikiFamilyState } from "./viewStore.js";
import type {
    ViewBuildJob,
    ViewMergeConflict,
    ViewPublicationStatus,
    ViewVersion,
    WikiSubjectAssessment,
} from "./viewTypes.js";

export const viewReadProjectionEntry = "view-read-projection.json";
export const viewReadProjectionVersion = 1;

export interface ViewInventoryBuild extends Omit<ViewBuildSummary, "results"> {
    results: Array<
        ViewBuildSummary["results"][number] & {
            inputFingerprint: string;
            evidenceFingerprint: string;
            wikiAssessment?: Pick<WikiSubjectAssessment, "disposition">;
        }
    >;
}

export interface ViewReadProjection {
    version?: number;
    views: ViewVersion[];
    builds: ViewInventoryBuild[];
    publications: Record<string, ViewPublicationStatus>;
    wikiFamily?: WikiFamilyState;
    projectFamily?: WikiFamilyState;
    conflicts?: Record<string, ViewMergeConflict>;
    versions?: Record<string, ViewVersion[]>;
}

export function viewReadProjection(state: {
    views: Record<string, ViewVersion[]>;
    builds?: Record<string, ViewBuildJob>;
    publications?: Record<string, ViewPublicationStatus>;
    wikiFamily?: WikiFamilyState;
    projectFamily?: WikiFamilyState;
    conflicts?: Record<string, ViewMergeConflict>;
}): ViewReadProjection {
    return {
        version: viewReadProjectionVersion,
        views: Object.values(state.views).flatMap((versions) =>
            versions.length ? [versions[versions.length - 1]] : [],
        ),
        builds: Object.values(state.builds ?? {}).map((job) => {
            const summary = buildSummary(job);
            return {
                ...summary,
                results: summary.results.map((result, index) => {
                    const target = job.results[index]!;
                    return {
                        ...result,
                        ...(target.conflictId
                            ? {
                                  conflictState:
                                      state.conflicts?.[target.conflictId]
                                          ?.state ?? "missing",
                              }
                            : {}),
                        inputFingerprint: target.snapshot.fingerprint,
                        evidenceFingerprint:
                            result.state === "conflicted" && result.conflictId
                                ? viewBuildEvidenceFingerprint(target.snapshot)
                                : "",
                        ...(target.wikiAssessment
                            ? {
                                  wikiAssessment: {
                                      disposition:
                                          target.wikiAssessment.disposition,
                                  },
                              }
                            : {}),
                    };
                }),
            };
        }),
        publications: Object.fromEntries(
            [
                ...new Set([
                    ...Object.keys(state.views),
                    ...Object.keys(state.publications ?? {}),
                ]),
            ].map((viewId) => [
                viewId,
                {
                    ...(state.publications?.[viewId] ?? {
                        viewId,
                        indexState: "absent",
                        reason: "No published revision",
                    }),
                    ...(Object.values(state.conflicts ?? {}).some(
                        (conflict) =>
                            conflict.viewId === viewId &&
                            conflict.state === "pending",
                    )
                        ? {
                              blockedReason:
                                  "Resolve the pending merge conflict before publishing or searching",
                          }
                        : {}),
                },
            ]),
        ),
        ...(state.wikiFamily ? { wikiFamily: state.wikiFamily } : {}),
        ...(state.projectFamily ? { projectFamily: state.projectFamily } : {}),
    };
}

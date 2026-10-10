// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import type { SourceType } from "./types.js";
import type { ViewBuildJob, ViewSourceSelector } from "./viewTypes.js";

export type ViewMaintenanceScope =
    | { mode: "pinned" }
    | { mode: "currentSources"; sourceIds: string[] }
    | {
          mode: "scopedSources";
          sourceTypes?: SourceType[];
          tags?: string[];
          project?: string;
      };

export interface WikiSubject {
    key: string;
    title: string;
    taxonomy: "concept" | "system" | "project";
    pageId?: string;
}

export interface ViewMaintenanceDefinition {
    schemaVersion: 1;
    scope: ViewMaintenanceScope;
    wikiDiscovery?: {
        rules: "explicit-subjects-v1";
        createDraftPages: boolean;
        subjects: WikiSubject[];
    };
}

export interface WikiSubjectIdentity extends WikiSubject {
    pageId: string;
    state: "active" | "omitted" | "merged";
    mergedInto?: string;
}

export interface ViewMaintenanceDependency {
    sourceId: string;
    revisionId: string;
    contentHash: string;
    metadataHash: string;
    pipelineVersion: string;
    embeddingIdentity?: string;
}

export interface ViewMaintenanceSnapshot {
    schemaVersion: 1;
    fingerprint: string;
    dependencies: ViewMaintenanceDependency[];
    subjects: WikiSubjectIdentity[];
    registry: WikiSubjectIdentity[];
    privacySources: string[];
}

export interface ViewMaintenanceManifest extends ViewMaintenanceSnapshot {
    acceptedRevisionId: string;
    acceptedAt: string;
    pages: Array<{
        pageId: string;
        subjectKeys: string[];
        contributing: ViewMaintenanceDependency[];
        context: ViewMaintenanceDependency[];
        inventoryIds: string[];
    }>;
}

export interface ViewMaintenanceTargetPlan {
    viewId: string;
    expectedVersion: number;
    state: "unchanged" | "rebuild" | "blocked" | "pinned";
    reason: string;
    selector?: ViewSourceSelector;
    snapshot?: ViewMaintenanceSnapshot;
}

export interface ViewMaintenancePlan {
    corpusId: string;
    expectedHead: string | null;
    targets: ViewMaintenanceTargetPlan[];
}

export interface ViewMaintenancePlanRequest {
    corpusId: string;
    viewIds: string[];
}

export interface ViewMaintenanceRequest {
    corpusId: string;
    expectedHead: string | null;
    targets: Array<{ viewId: string; expectedVersion: number }>;
}

export interface ViewMaintenanceResult {
    receiptId: string;
    plan: ViewMaintenancePlan;
    job?: ViewBuildJob;
}

export interface ViewMaintenanceUpdate {
    corpusId: string;
    viewId: string;
    expectedHead: string | null;
    expectedVersion: number;
    maintenance: ViewMaintenanceDefinition;
}

export interface ViewMaintenanceRead {
    corpusId: string;
    receiptId: string;
}

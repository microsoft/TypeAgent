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

export interface ViewMaintenanceDefinition {
    schemaVersion: 1;
    scope: ViewMaintenanceScope;
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
    privacySources: string[];
}

export interface ViewMaintenanceManifest extends ViewMaintenanceSnapshot {
    acceptedRevisionId: string;
    acceptedAt: string;
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

export interface ExplicitViewMaintenanceRequest {
    corpusId: string;
    expectedHead: string | null;
    targets: Array<{ viewId: string; expectedVersion: number }>;
}
export interface WikiFamilyMaintenanceRequest {
    corpusId: string;
    expectedHead: string | null;
    family: "wiki" | "projects";
    operation: "update" | "rebuild" | "pause" | "resume";
}
export interface TopicFamilyMaintenanceRequest
    extends Omit<WikiFamilyMaintenanceRequest, "family"> {
    family: "topics";
}
export type ViewMaintenanceRequest =
    | ExplicitViewMaintenanceRequest
    | WikiFamilyMaintenanceRequest
    | TopicFamilyMaintenanceRequest;

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

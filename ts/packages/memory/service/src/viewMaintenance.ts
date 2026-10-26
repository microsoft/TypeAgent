// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import type { SourceDocument, SourceType, SourceRevision } from "./types.js";
import type {
    ViewBuildBounds,
    ViewDefinitionInput,
    ViewVersion,
    ViewSourceSelector,
} from "./viewTypes.js";
import type {
    ViewMaintenanceDefinition,
    ViewMaintenanceManifest,
    ViewMaintenanceSnapshot,
    ViewMaintenanceTargetPlan,
    ViewMaintenanceScope,
} from "./viewMaintenanceTypes.js";
import { assertViewIdentifier } from "./viewContent.js";
import { viewHash } from "./viewMerge.js";

export interface MaintenanceSource extends SourceDocument {
    revisions: Array<{
        revisionId: string;
        state: string;
        content: string;
        contentHash: string;
        pipelineVersion: string;
        embeddingIdentity?: string;
        capturedAt?: string;
        sourceModifiedAt?: string;
        pipeline?: SourceRevision["pipeline"];
    }>;
}

function record(
    value: unknown,
    keys: string[],
    label: string,
): asserts value is Record<string, unknown> {
    if (
        !value ||
        typeof value !== "object" ||
        Array.isArray(value) ||
        Object.keys(value).some((key) => !keys.includes(key))
    )
        throw new Error(`Invalid ${label} fields`);
}

function ids(
    value: unknown,
    label: string,
    limit = 32,
): asserts value is string[] {
    if (!Array.isArray(value) || !value.length || value.length > limit)
        throw new Error(`${label} requires 1 to ${limit} identities`);
    for (const id of value) assertViewIdentifier(label, id);
    if (new Set(value).size !== value.length)
        throw new Error(`Duplicate ${label}`);
}

export function validateMaintenanceDefinition(
    definition: ViewDefinitionInput,
): void {
    const value = definition.maintenance;
    if (value === undefined) return;
    if (definition.kind === "wiki")
        throw new Error(
            "Wiki maintenance uses the informational-wiki-v1 family",
        );
    record(value, ["schemaVersion", "scope"], "maintenance definition");
    if (value.schemaVersion !== 1)
        throw new Error("Unsupported maintenance schema version");
    const scope = value.scope;
    record(
        scope,
        ["mode", "sourceIds", "sourceTypes", "tags", "project"],
        "maintenance scope",
    );
    switch (scope.mode) {
        case "pinned":
            record(scope, ["mode"], "pinned scope");
            break;
        case "currentSources":
            record(scope, ["mode", "sourceIds"], "current source scope");
            ids(scope.sourceIds, "maintenance source IDs");
            break;
        case "scopedSources":
            validateScopedSources(scope);
            break;
        default:
            throw new Error("Unsupported maintenance scope mode");
    }
}

function validateScopedSources(
    scope: Extract<ViewMaintenanceScope, { mode: "scopedSources" }>,
): void {
    record(scope, ["mode", "sourceTypes", "tags", "project"], "scoped sources");
    if (scope.sourceTypes !== undefined) {
        ids(scope.sourceTypes, "source types");
        const types: SourceType[] = ["web", "markdown", "text", "html", "vtt"];
        if (scope.sourceTypes.some((type) => !types.includes(type)))
            throw new Error("Unsupported maintenance source type");
    }
    if (
        scope.tags !== undefined &&
        (!Array.isArray(scope.tags) ||
            !scope.tags.length ||
            scope.tags.length > 32 ||
            !scope.tags.every(
                (tag) =>
                    typeof tag === "string" && tag.trim() && tag.length <= 200,
            ) ||
            new Set(scope.tags).size !== scope.tags.length)
    )
        throw new Error(
            "Maintenance tags require 1 to 32 distinct bounded strings",
        );
    if (
        scope.project !== undefined &&
        (typeof scope.project !== "string" ||
            !scope.project.trim() ||
            scope.project.length > 200)
    )
        throw new Error(
            "Maintenance project requires a bounded authoritative metadata.project string",
        );
}

export function maintenanceScopeMatches(
    definition: ViewMaintenanceDefinition,
    source: SourceDocument,
): boolean {
    const scope = definition.scope;
    if (scope.mode === "pinned") return false;
    if (scope.mode === "currentSources")
        return scope.sourceIds.includes(source.sourceId);
    return (
        (!scope.sourceTypes || scope.sourceTypes.includes(source.sourceType)) &&
        (!scope.tags ||
            scope.tags.every((tag) => source.tags?.includes(tag))) &&
        (scope.project === undefined ||
            source.metadata?.project === scope.project)
    );
}

export function resolveViewMaintenance(
    definition: ViewDefinitionInput,
    sources: MaintenanceSource[],
    model: string,
    bounds: ViewBuildBounds,
    current?: ViewVersion,
    eventFingerprint?: string,
): ViewMaintenanceTargetPlan {
    validateMaintenanceDefinition(definition);
    const target = {
        viewId: definition.viewId,
        expectedVersion: current?.version ?? 0,
    };
    const maintenance = definition.maintenance;
    if (!maintenance || maintenance.scope.mode === "pinned")
        return {
            ...target,
            state: "pinned",
            reason: "Exact selector remains manual; no dynamic advancement",
        };
    const selected = sources
        .filter((source) => maintenanceScopeMatches(maintenance, source))
        .sort((a, b) => a.sourceId.localeCompare(b.sourceId));
    const blocker = membershipBlocker(definition, maintenance, selected);
    if (blocker) return { ...target, state: "blocked", reason: blocker };
    const dependencies = selected.map((source) => {
        const revision = source.revisions.find(
            (revision) => revision.revisionId === source.activeRevisionId,
        )!;
        return {
            sourceId: source.sourceId,
            revisionId: revision.revisionId,
            contentHash: viewHash(revision.content),
            metadataHash: viewHash([
                source.sourceType,
                source.title,
                source.tags ?? [],
                source.metadata ?? {},
                source.canonicalUri ?? null,
                revision.capturedAt,
                revision.sourceModifiedAt,
                revision.pipeline,
            ]),
            pipelineVersion: revision.pipelineVersion,
            ...(revision.embeddingIdentity
                ? { embeddingIdentity: revision.embeddingIdentity }
                : {}),
        };
    });
    const selector: ViewSourceSelector =
        definition.selector.kind === "timelineEvidence"
            ? {
                  ...definition.selector,
                  sources: dependencies.map(({ sourceId, revisionId }) => ({
                      sourceId,
                      revisionId,
                  })),
              }
            : {
                  kind: "sources" as const,
                  sources: dependencies.map(({ sourceId, revisionId }) => ({
                      sourceId,
                      revisionId,
                  })),
              };
    const snapshot: ViewMaintenanceSnapshot = {
        schemaVersion: 1,
        dependencies,
        privacySources: [
            ...new Set([
                ...(current?.maintenance?.privacySources ?? []),
                ...(current?.definition.selector.sources.map(
                    (source) => source.sourceId,
                ) ?? []),
                ...dependencies.map((source) => source.sourceId),
            ]),
        ].sort(),
        fingerprint: viewHash([
            "view-maintenance-v1",
            definition.kind,
            ...(definition.schemaView ? [definition.schemaView] : []),
            maintenance,
            dependencies,
            bounds,
            selector.events ?? [],
            eventFingerprint,
            model,
        ]),
    };
    if (snapshot.privacySources.length > 128)
        return {
            ...target,
            state: "blocked",
            reason: "Retained discovery provenance exceeds 128 source identities; review retirement before continuing",
        };
    const unchanged =
        current?.maintenance?.schemaVersion === 1 &&
        current.maintenance.fingerprint === snapshot.fingerprint &&
        current.state === "draft";
    return {
        ...target,
        selector,
        snapshot,
        state: unchanged ? "unchanged" : "rebuild",
        reason: unchanged
            ? "Accepted evidence and rules are unchanged"
            : "Membership, evidence, rules or model changed; full-view reconciliation required",
    };
}

function membershipBlocker(
    definition: ViewDefinitionInput,
    maintenance: ViewMaintenanceDefinition,
    selected: MaintenanceSource[],
): string | undefined {
    if (
        maintenance.scope.mode === "currentSources" &&
        selected.length !== maintenance.scope.sourceIds.length
    )
        return "A configured source is missing or inaccessible";
    if (
        (!selected.length && definition.kind !== "schemaView") ||
        selected.length + (definition.selector.events?.length ?? 0) > 32
    )
        return "Resolved scope requires 1 to 32 sources; empty scope and overflow require review";
    const revisions = selected.map((source) =>
        source.revisions.find(
            (revision) => revision.revisionId === source.activeRevisionId,
        ),
    );
    if (revisions.some((revision) => revision?.state !== "ready"))
        return "Eligible source ingestion is pending, failed or unavailable";
    if (
        revisions.reduce(
            (count, revision) => count + revision!.content.length,
            0,
        ) > 120_000
    )
        return "Complete input exceeds 120000 characters; no truncation";
    return undefined;
}

export function maintenanceManifest(
    snapshot: ViewMaintenanceSnapshot,
    version: ViewVersion,
): ViewMaintenanceManifest {
    return {
        ...structuredClone(snapshot),
        acceptedRevisionId: version.revisionId,
        acceptedAt: version.createdAt,
    };
}

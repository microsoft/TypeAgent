// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import type { SourceDocument, SourceType, SourceRevision } from "./types.js";
import type {
    ViewBuildBounds,
    ViewDefinitionInput,
    ViewSynthesisOutput,
    ViewVersion,
    ViewSourceSelector,
} from "./viewTypes.js";
import type {
    ViewMaintenanceDefinition,
    ViewMaintenanceManifest,
    ViewMaintenanceSnapshot,
    ViewMaintenanceTargetPlan,
    WikiSubject,
    WikiSubjectIdentity,
    ViewMaintenanceScope,
} from "./viewMaintenanceTypes.js";
import { assertViewIdentifier } from "./viewContent.js";
import { viewHash } from "./viewMerge.js";

class ViewMaintenanceIdentityError extends Error {}

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
        throw new ViewMaintenanceIdentityError(`Invalid ${label} fields`);
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

export function validateWikiSubject(
    value: unknown,
): asserts value is WikiSubject {
    record(value, ["key", "title", "taxonomy", "pageId"], "wiki subject");
    if (
        typeof value.key !== "string" ||
        !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/.test(value.key)
    )
        throw new ViewMaintenanceIdentityError("Invalid subject key");
    if (
        typeof value.title !== "string" ||
        !value.title.trim() ||
        value.title.length > 1000
    )
        throw new ViewMaintenanceIdentityError(
            "Wiki subject requires a bounded title",
        );
    if (
        typeof value.taxonomy !== "string" ||
        !["concept", "system", "project"].includes(value.taxonomy)
    )
        throw new ViewMaintenanceIdentityError(
            "Wiki subject requires a fixed taxonomy",
        );
    if (
        value.pageId !== undefined &&
        (typeof value.pageId !== "string" ||
            !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/.test(value.pageId))
    )
        throw new ViewMaintenanceIdentityError("Invalid subject page ID");
}

export function validateMaintenanceDefinition(
    definition: ViewDefinitionInput,
): void {
    const value = definition.maintenance;
    if (value === undefined) return;
    record(
        value,
        ["schemaVersion", "scope", "wikiDiscovery"],
        "maintenance definition",
    );
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
    if (value.wikiDiscovery !== undefined) {
        if (definition.kind !== "wiki")
            throw new Error("Page discovery is only supported for wiki views");
        record(
            value.wikiDiscovery,
            ["rules", "createDraftPages", "subjects"],
            "wiki discovery",
        );
        const discovery = value.wikiDiscovery;
        if (
            discovery.rules !== "explicit-subjects-v1" ||
            typeof discovery.createDraftPages !== "boolean" ||
            !Array.isArray(discovery.subjects) ||
            discovery.subjects.length > 32
        )
            throw new Error(
                "Invalid bounded explicit-subject wiki discovery policy",
            );
        discovery.subjects.forEach(validateWikiSubject);
        if (
            new Set(discovery.subjects.map((subject) => subject.key)).size !==
            discovery.subjects.length
        )
            throw new Error("Duplicate reviewed wiki subject key");
    }
    if (
        definition.kind === "wiki" &&
        scope.mode !== "pinned" &&
        !value.wikiDiscovery
    )
        throw new Error(
            "Dynamic wiki maintenance requires an explicit subject discovery policy",
        );
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

function declaredSubjects(
    sources: MaintenanceSource[],
    policy: NonNullable<ViewMaintenanceDefinition["wikiDiscovery"]>,
): Map<string, WikiSubject> {
    const reviewed = new Map(
        policy.subjects.map((subject) => [subject.key, subject]),
    );
    const discovered = new Map(reviewed);
    for (const source of sources) {
        const declarations = source.metadata?.viewSubjects;
        if (declarations === undefined) continue;
        if (!Array.isArray(declarations) || declarations.length > 32)
            throw new ViewMaintenanceIdentityError(
                `Source ${source.sourceId} has invalid viewSubjects metadata`,
            );
        for (const subject of declarations) {
            validateWikiSubject(subject);
            if (subject.pageId !== undefined)
                throw new ViewMaintenanceIdentityError(
                    "Source metadata cannot allocate or rebind page identities",
                );
            const binding = reviewed.get(subject.key);
            if (binding) {
                if (binding.taxonomy !== subject.taxonomy)
                    throw new ViewMaintenanceIdentityError(
                        `Source taxonomy conflicts with reviewed subject ${subject.key}`,
                    );
                continue;
            }
            const known = discovered.get(subject.key);
            if (
                known &&
                (known.title !== subject.title ||
                    known.taxonomy !== subject.taxonomy)
            )
                throw new ViewMaintenanceIdentityError(
                    `Ambiguous wiki subject ${subject.key}; review its definition binding`,
                );
            discovered.set(subject.key, subject);
        }
    }
    if (!discovered.size || discovered.size > 32)
        throw new ViewMaintenanceIdentityError(
            "Wiki discovery requires 1 to 32 explicit supported subject keys; no truncation",
        );
    return discovered;
}

function discoverSubjects(
    definition: ViewDefinitionInput,
    sources: MaintenanceSource[],
    current?: ViewVersion,
): { subjects: WikiSubjectIdentity[]; registry: WikiSubjectIdentity[] } {
    const policy = definition.maintenance?.wikiDiscovery;
    const prior =
        current?.maintenance?.schemaVersion === 1
            ? current.maintenance.registry
            : [];
    if (!policy) return { subjects: [], registry: structuredClone(prior) };
    const discovered = declaredSubjects(sources, policy);
    const subjects = [...discovered.values()]
        .sort((a, b) => a.key.localeCompare(b.key))
        .map((subject): WikiSubjectIdentity => {
            const existing = prior.find((entry) => entry.key === subject.key);
            if (
                existing &&
                subject.pageId &&
                existing.pageId !== subject.pageId
            )
                throw new ViewMaintenanceIdentityError(
                    `Cannot rebind stable wiki subject ${subject.key}`,
                );
            if (existing && existing.taxonomy !== subject.taxonomy)
                throw new ViewMaintenanceIdentityError(
                    `Wiki subject taxonomy changed for ${subject.key}; explicit resolution required`,
                );
            const pageId =
                existing?.pageId ??
                subject.pageId ??
                subjectPageId(
                    sources[0].corpusId,
                    definition.viewId,
                    subject.key,
                );
            if (!existing && !subject.pageId && !policy.createDraftPages)
                throw new ViewMaintenanceIdentityError(
                    `New subject ${subject.key} requires opt-in draft page creation`,
                );
            if (
                subject.pageId &&
                !existing &&
                !(
                    current?.content.kind === "wiki" &&
                    current.content.sections.some(
                        (page) =>
                            page.id === subject.pageId &&
                            page.details.taxonomy === subject.taxonomy,
                    )
                )
            )
                throw new ViewMaintenanceIdentityError(
                    `Reviewed page binding ${subject.pageId} does not identify an existing matching page`,
                );
            return {
                ...subject,
                pageId,
                state: existing?.state ?? "active",
                ...(existing?.mergedInto
                    ? { mergedInto: existing.mergedInto }
                    : {}),
            };
        });
    if (
        new Set(subjects.map((subject) => subject.pageId)).size !==
        subjects.length
    )
        throw new ViewMaintenanceIdentityError(
            "Multiple subject keys require an explicit accepted merge, not duplicate page bindings",
        );
    if (current?.content.kind === "wiki") {
        for (const page of current.content.sections)
            if (
                !subjects.some(
                    (subject) =>
                        subject.pageId === page.id ||
                        subject.mergedInto === page.id,
                )
            )
                throw new ViewMaintenanceIdentityError(
                    `Existing wiki page ${page.id} lacks a reviewed stable subject binding; removal requires resolution`,
                );
    }
    const registry = [
        ...prior.filter((entry) => !discovered.has(entry.key)),
        ...subjects,
    ];
    if (registry.length > 128)
        throw new ViewMaintenanceIdentityError(
            "Wiki subject registry limit exceeded; retirement requires review",
        );
    return { subjects, registry };
}

function subjectPageId(corpusId: string, viewId: string, key: string): string {
    const hash = viewHash(["explicit-wiki-subject-v1", corpusId, viewId, key]);
    return `${hash.slice(0, 8)}-${hash.slice(8, 12)}-8${hash.slice(13, 16)}-a${hash.slice(17, 20)}-${hash.slice(20, 32)}`;
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
    let identities: ReturnType<typeof discoverSubjects>;
    try {
        identities = discoverSubjects(definition, selected, current);
    } catch (error) {
        if (!(error instanceof ViewMaintenanceIdentityError)) throw error;
        return { ...target, state: "blocked", reason: error.message };
    }
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
        ...identities,
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
        !selected.length ||
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

export function validateMaintenanceConstruction(
    snapshot: ViewMaintenanceSnapshot | undefined,
    output: ViewSynthesisOutput,
): void {
    if (!snapshot?.subjects.length || output.content.kind !== "wiki") return;
    for (const page of output.content.sections) {
        const subject = snapshot.subjects.find(
            (entry) => entry.pageId === page.id,
        );
        if (
            !subject ||
            subject.taxonomy !== page.details.taxonomy ||
            subject.title !== page.heading
        )
            throw new Error(
                `Wiki page ${page.id} has an unresolved subject identity, taxonomy or reviewed title`,
            );
    }
    if (
        snapshot.subjects.some(
            (subject) =>
                !output.content.sections.some(
                    (page) => page.id === subject.pageId,
                ),
        )
    )
        throw new Error(
            "Wiki construction omitted a discovered subject; no silent partial discovery",
        );
}

export function maintenanceManifest(
    snapshot: ViewMaintenanceSnapshot,
    version: ViewVersion,
): ViewMaintenanceManifest {
    const pages =
        version.content.kind === "wiki" ? version.content.sections : [];
    return {
        ...structuredClone(snapshot),
        acceptedRevisionId: version.revisionId,
        acceptedAt: version.createdAt,
        registry: snapshot.registry.map((subject) => {
            const survivor = pages.find((page) =>
                page.details.mergedPageIds.includes(subject.pageId),
            );
            return {
                ...subject,
                state: pages.some((page) => page.id === subject.pageId)
                    ? "active"
                    : survivor
                      ? "merged"
                      : "omitted",
                ...(survivor ? { mergedInto: survivor.id } : {}),
            };
        }),
        pages: pages.map((page) => {
            const citations = version.relationships.flatMap((edge) =>
                edge.predicate === "supportedBy" &&
                edge.from.sectionId === page.id
                    ? edge.citations
                    : [],
            );
            return {
                pageId: page.id,
                subjectKeys: snapshot.registry
                    .filter(
                        (subject) =>
                            subject.pageId === page.id ||
                            page.details.mergedPageIds.includes(subject.pageId),
                    )
                    .map((subject) => subject.key),
                contributing: snapshot.dependencies.filter((source) =>
                    citations.some(
                        (citation) => citation.sourceId === source.sourceId,
                    ),
                ),
                context: structuredClone(snapshot.dependencies),
                inventoryIds: [...page.details.inventoryIds],
            };
        }),
    };
}

// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.
import { informationalView } from "./informationalView.js";
import { queryTopicSnapshot, validateTopicSnapshot } from "./topicSnapshot.js";
import { validateTopicBuildOutput } from "./topicBuilds.js";
import type {
    TopicFamilyState,
    TopicQueryPage,
    TopicQueryRequest,
    TopicSnapshot,
    TopicConcept,
} from "./topicTypes.js";

import { randomUUID } from "node:crypto";
import { AsyncLocalStorage } from "node:async_hooks";
import { readdir, rm } from "node:fs/promises";
import path from "node:path";
import {
    canonicalizeProcedure as canonicalize,
    getProcedureEvidenceReferences,
} from "./agentEdition.js";
import { retryFilesystemPublication } from "./filesystemPublication.js";
import { assertViewIdentifier } from "./viewContent.js";
import { ViewHistory, type HistorySnapshot } from "./viewHistory.js";
import {
    inventoryCoverage,
    inventoryEvidence,
} from "./viewInventoryCoverage.js";
import { maintenanceManifest } from "./viewMaintenance.js";
import {
    viewReadProjection,
    viewReadProjectionEntry,
    type ViewInventoryBuild,
    type ViewReadProjection,
} from "./viewReadProjection.js";
import {
    rebaseViewEdits,
    reconcileResolutionEdits,
    recordViewEdits,
    sameViewBuildEvidence,
    viewHash,
} from "./viewMerge.js";
import {
    recordEditorialProtection,
    unlockEditorialProtection,
} from "./viewEditorial.js";
import { reusableWikiAssessment } from "./wikiAdmission.js";
import { assertWikiContribution } from "./wikiContribution.js";
import {
    assertWikiRedirectCapacity,
    automaticallyConsolidatable,
    ConsolidationTargetChanged,
} from "./wikiConsolidation.js";
import { assertPublicationProof } from "./viewPublication.js";
import {
    authoredRelationships,
    editedViewState,
    materializeDefinition,
    preserveMaintenanceDefinition,
    versionRelationships,
} from "./viewRelationships.js";
import type {
    ViewArchiveRequest,
    ViewBuildJob,
    ViewBuildRequest,
    ViewBuildSnapshot,
    ViewBuildTargetResult,
    ViewConflictResolution,
    ViewHistoryEntry,
    ViewMaintenancePlan,
    ViewMaintenanceResult,
    ViewMaintenanceUpdate,
    ViewMergeConflict,
    ViewPublicationPolicy,
    ViewPublicationPolicyUpdate,
    ViewPublicationProof,
    ViewPublicationStatus,
    ViewPublishRequest,
    ViewReadRequest,
    ViewSaveRequest,
    ViewSnapshot,
    ViewSourceUsage,
    ViewSynthesisOutput,
    ViewVersion,
    WikiSubjectAssessment,
} from "./viewTypes.js";

import type {
    KnowledgeStatus,
    KnowledgeDiscoveryState,
} from "./knowledgeTypes.js";

interface ViewStoreState {
    knowledge?: KnowledgeStatus;
    views: Record<string, ViewVersion[]>;
    builds?: Record<string, ViewBuildJob>;
    conflicts?: Record<string, ViewMergeConflict>;
    publicationPolicy?: ViewPublicationPolicy;
    publications?: Record<string, ViewPublicationStatus>;
    viewIndexCleanup?: string[];
    wikiFamily?: WikiFamilyState;
    projectFamily?: WikiFamilyState;
    topics?: TopicSnapshot;
    topicFamily?: TopicFamilyState;
    maintenanceReceipts?: Record<
        string,
        Pick<ViewMaintenanceResult, "receiptId" | "plan"> & { jobId?: string }
    >;
}

export interface WikiFamilyState {
    enabled: boolean;
    dirty: boolean;
    cursor: number;
    indexVersion?: string;
    error?: string;
    automaticPasses?: {
        generation: string | undefined;
        policy: string;
        count: number;
    };
    descriptors: Array<{
        viewId: string;
        query: string;
        sourceIds: string[];
        postingCount?: number;
        salience?: number;
        identity?: import("./types.js").IndexedSubjectIdentity;
        admission?: {
            generation: string | undefined;
            policy: string;
            reason: string;
        };
    }>;
}

function forgottenEventIds(marker: string): Set<string> | undefined {
    if (!marker.startsWith("{")) return undefined;
    const selection: unknown = JSON.parse(marker);
    if (!selection || typeof selection !== "object" || !("kind" in selection))
        throw new Error("Invalid event privacy purge selection");
    if (selection.kind === "event" && "eventId" in selection) {
        if (typeof selection.eventId !== "string")
            throw new Error("Invalid event privacy purge selection");
        assertViewIdentifier("event ID", selection.eventId);
        return new Set([selection.eventId]);
    }
    if (
        selection.kind !== "events" ||
        !("eventIds" in selection) ||
        !Array.isArray(selection.eventIds) ||
        !selection.eventIds.length
    )
        throw new Error("Invalid event privacy purge selection");
    return new Set(
        selection.eventIds.map((id: unknown) => {
            if (typeof id !== "string")
                throw new Error("Invalid event privacy purge selection");
            assertViewIdentifier("event ID", id);
            return id;
        }),
    );
}

function viewVersions(state: ViewStoreState, viewId: string): ViewVersion[] {
    return Object.prototype.hasOwnProperty.call(state.views, viewId)
        ? state.views[viewId]
        : [];
}

function timestamp(): string {
    return new Date().toISOString();
}

function freezeSnapshot(value: unknown): void {
    if (!value || typeof value !== "object" || Object.isFrozen(value)) return;
    for (const child of Object.values(value)) freezeSnapshot(child);
    Object.freeze(value);
}

function eraseInformationalRetrieval(value: unknown, sourceId: string): void {
    if (!value || typeof value !== "object") return;
    const record = value as Record<string, unknown>;
    const context = record.informationalRetrieval as
        | ViewBuildSnapshot["informationalRetrieval"]
        | undefined;
    if (context?.sources.some((source) => source.sourceId === sourceId))
        delete record.informationalRetrieval;
    for (const child of Object.values(record))
        eraseInformationalRetrieval(child, sourceId);
}

function validateIdentifier(kind: string, value: string): void {
    if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/.test(value)) {
        throw new Error(`Invalid ${kind} '${value}'`);
    }
}

export class TypedViewStore {
    public async getKnowledgeState(corpusId: string): Promise<KnowledgeStatus> {
        const { state } = await this.readSnapshot(corpusId);
        return structuredClone(
            state.knowledge ?? {
                discovery: {
                    version: 1,
                    policy: "off",
                    policyVersion: 1,
                    receipts: [],
                    routes: [],
                    callTimes: [],
                },
                checkpoints: [],
            },
        );
    }

    public async updateKnowledgeState(
        corpusId: string,
        update: (knowledge: KnowledgeStatus) => void,
    ): Promise<KnowledgeStatus> {
        const { head, state } = await this.history(corpusId).read();
        const knowledge = state.knowledge ?? {
            discovery: {
                version: 1 as const,
                policy: "off" as const,
                policyVersion: 1 as const,
                receipts: [],
                routes: [],
                callTimes: [],
            },
            checkpoints: [],
        };
        update(knowledge);
        state.knowledge = knowledge;
        await this.commitBuildState(
            corpusId,
            head,
            state,
            "Checkpoint maintained knowledge",
        );
        return structuredClone(knowledge);
    }

    private readonly readOperation = new AsyncLocalStorage<{
        corpusId: string;
        active: boolean;
        snapshot: Promise<HistorySnapshot<ViewStoreState>>;
    }>();

    public constructor(
        private readonly rootDirectory: string,
        private readonly actor = "local-owner",
    ) {}

    private readonly topicSizes = new Map<
        string,
        { head: string | null; bytes: number }
    >();
    private readonly inventoryRead = new AsyncLocalStorage<{
        corpusId: string;
        head: string | null;
        projection: ViewReadProjection;
        active: boolean;
    }>();

    public async withInventorySnapshot<T>(
        corpusId: string,
        operation: () => Promise<T>,
        validateHead = true,
    ): Promise<T> {
        const existing = this.inventoryRead.getStore();
        if (existing?.active && existing.corpusId === corpusId)
            return operation();
        const history = this.history(corpusId);
        const { head, value } = await history.readEntry<ViewReadProjection>(
            viewReadProjectionEntry,
        );
        let projection = value;
        if (!projection) {
            const state: ViewStoreState = head
                ? (await history.read(head)).state
                : { views: {} };
            projection = {
                ...viewReadProjection(state),
                versions: state.views,
                ...(state.conflicts ? { conflicts: state.conflicts } : {}),
            };
        }
        freezeSnapshot(projection);
        const scope = { corpusId, head, projection, active: true };
        return this.inventoryRead.run(scope, async () => {
            try {
                const result = await operation();
                if (validateHead) await history.assertHead(head);
                else await history.assertReadable();
                return result;
            } finally {
                scope.active = false;
            }
        });
    }

    private inventory(corpusId: string): ViewReadProjection | undefined {
        const scope = this.inventoryRead.getStore();
        return scope?.active && scope.corpusId === corpusId
            ? scope.projection
            : undefined;
    }

    private needsInventorySnapshot(corpusId: string): boolean {
        const full = this.readOperation.getStore();
        return (
            !this.inventory(corpusId) &&
            !(full?.active && full.corpusId === corpusId)
        );
    }

    private withInventoryRead<T>(
        corpusId: string,
        operation: () => Promise<T>,
    ): Promise<T> {
        // Standalone store reads retain point-in-time semantics; service read
        // operations use head-checked scopes inside the corpus access boundary.
        return this.withInventorySnapshot(corpusId, operation, false);
    }

    public async ensureReadProjection(corpusId: string): Promise<void> {
        const history = this.history(corpusId);
        const { head, value } = await history.readEntry<ViewReadProjection>(
            viewReadProjectionEntry,
        );
        if (!head || value) return;
        const { state } = await history.read(head);
        await history.commit(
            head,
            state,
            this.entries(state),
            this.actor,
            "Index current view detail and inventory reads",
        );
    }

    public async listViewInventoryBuilds(
        corpusId: string,
    ): Promise<ViewInventoryBuild[]> {
        if (this.needsInventorySnapshot(corpusId))
            return this.withInventoryRead(corpusId, () =>
                this.listViewInventoryBuilds(corpusId),
            );
        return structuredClone(
            this.inventory(corpusId)?.builds ??
                viewReadProjection((await this.readSnapshot(corpusId)).state)
                    .builds,
        );
    }

    private history(corpusId: string): ViewHistory<ViewStoreState> {
        validateIdentifier("corpus ID", corpusId);
        return new ViewHistory(
            this.viewDirectory(corpusId),
            () => ({ views: {} }),
            undefined,
            (state: ViewStoreState) => state.views,
        );
    }

    public async withReadSnapshot<T>(
        corpusId: string,
        operation: () => Promise<T>,
    ): Promise<T> {
        const existing = this.readOperation.getStore();
        if (existing?.active && existing.corpusId === corpusId)
            return operation();
        const history = this.history(corpusId);
        const scope = {
            corpusId,
            active: true,
            snapshot: history.read().then((snapshot) => {
                freezeSnapshot(snapshot);
                return snapshot;
            }),
        };
        return this.readOperation.run(scope, async () => {
            try {
                await scope.snapshot;
                const result = await operation();
                await history.assertHead((await scope.snapshot).head);
                return result;
            } finally {
                scope.active = false;
            }
        });
    }

    private async readSnapshot(corpusId: string) {
        const scope = this.readOperation.getStore();
        const history = this.history(corpusId);
        if (!scope?.active || scope.corpusId !== corpusId)
            return history.read();
        await history.assertReadable();
        return scope.snapshot;
    }

    private expireReadSnapshot(): void {
        const scope = this.readOperation.getStore();
        if (scope) scope.active = false;
        const inventory = this.inventoryRead.getStore();
        if (inventory) inventory.active = false;
    }

    public async getViewVersions(
        request: ViewReadRequest,
    ): Promise<ViewVersion[]> {
        assertViewIdentifier("view ID", request.viewId);
        if (this.needsInventorySnapshot(request.corpusId))
            return this.withInventoryRead(request.corpusId, () =>
                this.getViewVersions(request),
            );
        const scope = this.inventoryRead.getStore();
        if (scope?.active && scope.corpusId === request.corpusId) {
            const legacy = scope.projection.versions?.[request.viewId];
            if (legacy) return structuredClone(legacy).reverse();
            if (!scope.head) return [];
            const { value } = await this.history(request.corpusId).readEntry<
                ViewVersion[]
            >(`view-${encodeURIComponent(request.viewId)}.json`, scope.head);
            return (value ?? []).reverse();
        }
        const { state } = await this.readSnapshot(request.corpusId);
        return structuredClone(viewVersions(state, request.viewId)).reverse();
    }

    public getCommittedHead(corpusId: string): Promise<string | null> {
        return this.history(corpusId).readHead();
    }

    public async getTopicState(corpusId: string): Promise<{
        head: string | null;
        snapshot?: TopicSnapshot;
        family: TopicFamilyState;
        building: boolean;
    }> {
        const { head, state } = await this.history(corpusId).read();
        if (state.topics) validateTopicSnapshot(state.topics);
        return {
            head,
            ...(state.topics ? { snapshot: state.topics } : {}),
            family: state.topicFamily ?? { enabled: true, dirty: true },
            building: Object.values(state.builds ?? {}).some(
                (job) =>
                    job.state === "running" &&
                    job.results.some(
                        (result) =>
                            result.snapshot.pipeline === "topics-v1" &&
                            result.state === "generating" &&
                            result.topicGeneration === state.topics?.generation,
                    ),
            ),
        };
    }

    public async queryTopics(
        request: TopicQueryRequest,
        eligibleFingerprint?: string,
    ): Promise<TopicQueryPage> {
        const started = performance.now();
        const { head, state, stateBytes } = await this.history(
            request.corpusId,
        ).read();
        if (state.topics) validateTopicSnapshot(state.topics);
        const withheld =
            state.topics &&
            eligibleFingerprint !== undefined &&
            state.topics.inputFingerprint !== eligibleFingerprint;
        if (withheld && request.continuationToken)
            throw new Error(
                "Topic continuation is stale after source eligibility changed",
            );
        const page = queryTopicSnapshot(
            withheld ? undefined : state.topics,
            request,
        );
        if (withheld)
            page.limits.push(
                "Topic snapshot withheld: active sources or indexed eligibility changed; maintenance pending.",
            );
        if (state.topicFamily?.error)
            page.limits = [
                ...page.limits,
                `Topic family failure: ${state.topicFamily.error}`,
            ];
        let size = this.topicSizes.get(request.corpusId);
        if (!size || size.head !== head) {
            size = {
                head,
                bytes: Buffer.byteLength(JSON.stringify(state.topics ?? null)),
            };
            this.topicSizes.set(request.corpusId, size);
        }
        page.io = {
            stateBytes,
            snapshotBytes: size.bytes,
            elapsedMs: performance.now() - started,
        };
        return page;
    }

    public async saveTopicFamily(
        corpusId: string,
        family: TopicFamilyState,
    ): Promise<void> {
        const { head, state } = await this.history(corpusId).read();
        if (
            JSON.stringify(
                state.topicFamily ?? { enabled: true, dirty: true },
            ) === JSON.stringify(family)
        )
            return;
        state.topicFamily = structuredClone(family);
        await this.commitBuildState(
            corpusId,
            head,
            state,
            "Checkpoint topic maintenance",
        );
    }

    public async saveTopicConceptSummary(
        corpusId: string,
        generation: string,
        conceptId: string,
        output: Pick<TopicConcept, "summary" | "citations">,
    ): Promise<void> {
        const { head, state } = await this.history(corpusId).read();
        const snapshot = state.topics;
        const concept = snapshot?.curation?.concepts.find(
            (entry) => entry.id === conceptId,
        );
        if (!snapshot || snapshot.generation !== generation || !concept)
            throw new Error(
                "Topic generation changed during lazy summarization",
            );
        const supplied = new Set(concept.citations.map(viewHash));
        if (
            !output.citations.length ||
            output.citations.some(
                (citation) => !supplied.has(viewHash(citation)),
            )
        )
            throw new Error("Topic summary changed supplied concept evidence");
        concept.summary = output.summary;
        concept.summaryState = "ready";
        if (concept.validation)
            concept.summaryCitations = structuredClone(output.citations);
        else concept.citations = structuredClone(output.citations);
        validateTopicSnapshot(snapshot);
        await this.commitBuildState(
            corpusId,
            head,
            state,
            `Summarize selected topic concept ${conceptId}`,
        );
    }

    public async materializeTopicBuild(
        corpusId: string,
        jobId: string,
        snapshot: TopicSnapshot,
        complete = true,
    ): Promise<void> {
        validateTopicSnapshot(snapshot);
        if (complete && snapshot.curationProgress)
            throw new Error("Incomplete topic curation cannot finish a build");
        const { head, state } = await this.history(corpusId).read();
        const job = state.builds?.[jobId];
        const result = job?.results.find(
            (entry) => entry.snapshot.pipeline === "topics-v1",
        );
        if (
            !job ||
            !result ||
            job.state !== "running" ||
            snapshot.corpusId !== corpusId ||
            snapshot.inputFingerprint !== result.snapshot.fingerprint
        )
            throw new Error(
                "Topic build is no longer eligible for materialization",
            );
        validateTopicBuildOutput(result.snapshot, snapshot);
        if (result.state === "draft")
            throw new Error("Topic generation changed or already completed");
        if (
            (state.topics?.generation ?? undefined) !==
            (result.topicGeneration ?? result.snapshot.targetRevisionId)
        )
            throw new Error("Topic generation changed during build");
        state.topics = structuredClone(snapshot);
        state.topicFamily = {
            enabled: state.topicFamily?.enabled ?? true,
            dirty: false,
            ...(result.snapshot.topicInput?.indexGeneration
                ? {
                      indexGeneration:
                          result.snapshot.topicInput.indexGeneration,
                  }
                : {}),
        };
        result.state = complete ? "draft" : "generating";
        result.topicGeneration = snapshot.generation;
        result.reason = `Complete topic snapshot ${snapshot.generation} committed and available for browsing; ${snapshot.curation ? `${snapshot.curation.concepts.length} admitted concepts; summaries generated on explicit detail requests` : `${snapshot.nodes.filter((node) => node.summaryState === "ready").length}/${snapshot.nodes.length} summaries ready`}; ${complete ? "generation finished" : "generation pending"}; not a Wiki article revision`;
        if (complete)
            result.missingEvidence = [
                ...(snapshot.curation ? [] : snapshot.nodes)
                    .filter((node) => node.summaryState !== "ready")
                    .map(
                        (node) =>
                            `Topic summary ${node.summaryState}: ${node.id}`,
                    ),
                ...snapshot.limits.filter((limit) =>
                    limit.startsWith("Organizational generation failed:"),
                ),
            ];
        await this.commitBuildState(
            corpusId,
            head,
            state,
            `Materialize topic snapshot ${snapshot.generation}`,
        );
    }

    public async getWikiFamily(
        corpusId: string,
        family: "wiki" | "projects" = "wiki",
    ): Promise<WikiFamilyState> {
        if (this.needsInventorySnapshot(corpusId))
            return this.withInventoryRead(corpusId, () =>
                this.getWikiFamily(corpusId, family),
            );
        const projection = this.inventory(corpusId);
        const state = projection ?? (await this.readSnapshot(corpusId)).state;
        return structuredClone(
            state[family === "wiki" ? "wikiFamily" : "projectFamily"] ?? {
                enabled: true,
                dirty: true,
                cursor: 0,
                descriptors: [],
            },
        );
    }

    public async saveWikiFamily(
        corpusId: string,
        family: WikiFamilyState,
        kind: "wiki" | "projects" = "wiki",
    ): Promise<void> {
        const { head, state } = await this.history(corpusId).read();
        state[kind === "wiki" ? "wikiFamily" : "projectFamily"] =
            structuredClone(family);
        await this.commitBuildState(
            corpusId,
            head,
            state,
            `Checkpoint informational ${kind} maintenance`,
        );
    }

    public async makeInformationalVisible(
        version: ViewVersion,
    ): Promise<ViewPublicationStatus> {
        const { head, state } = await this.history(version.corpusId).read();
        const current = viewVersions(state, version.viewId).at(-1);
        if (
            current?.revisionId !== version.revisionId ||
            current.state !== "draft" ||
            !informationalView(current.content)
        )
            throw new Error(
                "Informational visibility requires the exact current page",
            );
        const publication: ViewPublicationStatus = {
            viewId: version.viewId,
            latestBuiltRevisionId: version.revisionId,
            publishedRevisionId: version.revisionId,
            indexState: "pending",
            reason: "Informational page automatically visible; derivative indexing pending",
        };
        state.publications ??= {};
        state.publications[version.viewId] = publication;
        await this.commitBuildState(
            version.corpusId,
            head,
            state,
            "Accept current informational page",
        );
        return publication;
    }

    private entries(state: ViewStoreState): Record<string, string> {
        return Object.fromEntries([
            [
                viewReadProjectionEntry,
                JSON.stringify(viewReadProjection(state)),
            ],
            ...Object.entries(state.conflicts ?? {}).map(([id, conflict]) => [
                `conflict-${encodeURIComponent(id)}.json`,
                JSON.stringify(conflict),
            ]),
            ...Object.entries(state.views).map(([id, versions]) => [
                `view-${encodeURIComponent(id)}.json`,
                canonicalize(versions),
            ]),
        ]);
    }

    public async listViews(corpusId: string): Promise<ViewSnapshot> {
        if (this.needsInventorySnapshot(corpusId))
            return this.withInventoryRead(corpusId, () =>
                this.listViews(corpusId),
            );
        const scope = this.inventoryRead.getStore();
        if (scope?.active && scope.corpusId === corpusId)
            return {
                head: scope.head,
                views: structuredClone(scope.projection.views),
            };
        const snapshot = await this.readSnapshot(corpusId);
        return {
            head: snapshot.head,
            views: structuredClone(
                Object.values(snapshot.state.views).map(
                    (versions) => versions[versions.length - 1],
                ),
            ),
        };
    }

    public async getView(
        request: ViewReadRequest,
    ): Promise<ViewVersion | undefined> {
        assertViewIdentifier("view ID", request.viewId);
        if (this.needsInventorySnapshot(request.corpusId))
            return this.withInventoryRead(request.corpusId, () =>
                this.getView(request),
            );
        const projection = this.inventory(request.corpusId);
        if (projection) {
            const current = projection.views.find(
                (view) => view.viewId === request.viewId,
            );
            if (
                !request.revisionId ||
                current?.revisionId === request.revisionId
            )
                return structuredClone(current);
            return (await this.getViewVersions(request)).find(
                (view) => view.revisionId === request.revisionId,
            );
        }
        const state = (await this.readSnapshot(request.corpusId)).state;
        const versions = viewVersions(state, request.viewId);
        return structuredClone(
            request.revisionId === undefined
                ? versions.at(-1)
                : versions.find(
                      (version) => version.revisionId === request.revisionId,
                  ),
        );
    }

    public async sourceUsage(
        corpusId: string,
        sourceId: string,
    ): Promise<ViewSourceUsage[]> {
        const snapshot = await this.listViews(corpusId);
        const documentReference = (reference: {
            sourceId: string;
            evidence?: { kind: "event"; eventId: string };
        }) => reference.sourceId === sourceId && !reference.evidence;
        return snapshot.views
            .filter((view) => {
                const content = [
                    view.content,
                    ...(view.generation ? [view.generation.content] : []),
                ];
                const references = content.flatMap((item) => {
                    const evidence = getProcedureEvidenceReferences(item);
                    return [...evidence.citations, ...evidence.assets];
                });
                const endpoints = view.relationships.flatMap((edge) => [
                    edge.from,
                    edge.to,
                ]);
                return (
                    view.definition.selector.sources.some(documentReference) ||
                    references.some(documentReference) ||
                    view.generation?.input?.inputs.some(documentReference) ||
                    view.generation?.input?.influenceSources?.some(
                        documentReference,
                    ) ||
                    endpoints.some(
                        (endpoint) =>
                            endpoint.kind === "source" &&
                            documentReference(endpoint),
                    ) ||
                    view.relationships.some(
                        (edge) =>
                            "citations" in edge &&
                            edge.citations?.some(documentReference),
                    )
                );
            })
            .sort((left, right) =>
                left.viewId < right.viewId
                    ? -1
                    : left.viewId > right.viewId
                      ? 1
                      : 0,
            )
            .map((view) => ({
                viewId: view.viewId,
                revisionId: view.revisionId,
                version: view.version,
                kind: view.definition.kind,
                title: view.content.title,
                state: view.state,
                provenance: view.provenance,
            }));
    }

    private draftEdits(
        current: ViewVersion | undefined,
        request: ViewSaveRequest,
    ): NonNullable<ViewVersion["edits"]> {
        if (request.unlockProtection) {
            if (!current)
                throw new Error("Protection unlock requires an existing view");
            return unlockEditorialProtection(current, request.unlockProtection);
        }
        return recordEditorialProtection(
            current,
            recordViewEdits(
                current,
                request.content,
                request.relationships,
                this.actor,
            ),
        );
    }

    public async saveViewDraft(
        request: ViewSaveRequest,
        validation?: ViewPublicationProof,
        discovery?: KnowledgeDiscoveryState,
    ): Promise<ViewHistoryEntry> {
        const history = this.history(request.corpusId);
        const { head, state } = await history.read();
        if (head !== request.expectedHead)
            throw new Error("View history head conflict");
        const versions = viewVersions(state, request.viewId);
        const current = versions.at(-1);
        if ((current?.version ?? 0) !== request.expectedVersion)
            throw new Error("View version conflict");
        if (current?.state === "archived")
            throw new Error(`Cannot edit a ${current.state} view`);
        const version: ViewVersion = {
            corpusId: request.corpusId,
            viewId: request.viewId,
            revisionId: randomUUID(),
            version: request.expectedVersion + 1,
            state: editedViewState(current),
            createdAt: timestamp(),
            actor: this.actor,
            provenance: "human",
            ...(validation ? { validation } : {}),
            ...(current?.generation
                ? { generation: structuredClone(current.generation) }
                : {}),
            ...(current?.maintenance
                ? { maintenance: structuredClone(current.maintenance) }
                : {}),
            edits: this.draftEdits(current, request),
            ...(current ? { baseRevisionId: current.revisionId } : {}),
            definition: materializeDefinition(
                preserveMaintenanceDefinition(
                    request.definition,
                    current?.definition,
                ),
                current?.definition,
            ),
            content: structuredClone(request.content),
            relationships: [],
        };
        version.relationships = versionRelationships(
            version,
            request.relationships,
            current?.generation !== undefined,
        );
        if (current?.maintenance)
            version.maintenance = maintenanceManifest(
                current.maintenance,
                version,
            );
        if (version.generation?.inventory) {
            version.generation.coverage = inventoryCoverage({
                content: request.content,
                relationships: request.relationships,
                outcome: version.generation.outcome ?? "diagnosticOnly",
                missingEvidence: ["Human edits retain source inventory limits"],
                ...inventoryEvidence(version.generation),
            });
        }
        state.views[request.viewId] = [...versions, version];
        if (discovery) {
            state.knowledge ??= { discovery, checkpoints: [] };
            state.knowledge.discovery = structuredClone(discovery);
            version.provenance = "generated";
        }
        this.expireReadSnapshot();
        const commitId = await history.commit(
            head,
            state,
            this.entries(state),
            this.actor,
            `Draft ${request.viewId} revision ${version.revisionId}; base ${version.baseRevisionId ?? "none"}`,
        );
        return { commitId, version };
    }

    private async commitBuildState(
        corpusId: string,
        head: string | null,
        state: ViewStoreState,
        message: string,
    ): Promise<string> {
        this.expireReadSnapshot();
        return this.history(corpusId).commit(
            head,
            state,
            this.entries(state),
            this.actor,
            message,
        );
    }

    public async listViewBuilds(corpusId: string): Promise<ViewBuildJob[]> {
        const { state } = await this.readSnapshot(corpusId);
        return structuredClone(
            Object.values(state.builds ?? {})
                .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
                .slice(0, 100),
        );
    }

    public async getViewBuild(
        corpusId: string,
        jobId: string,
    ): Promise<ViewBuildJob | undefined> {
        assertViewIdentifier("build job ID", jobId);
        const { state } = await this.history(corpusId).read();
        return state.builds?.[jobId];
    }

    public async admitViewBuild(
        request: ViewBuildRequest,
        snapshots: ViewBuildSnapshot[],
        maintenancePlan?: ViewMaintenancePlan,
        wikiFamily?: WikiFamilyState,
        familyKind: "wiki" | "projects" = "wiki",
        topicFamily?: TopicFamilyState,
    ): Promise<{ job: ViewBuildJob; admitted: boolean }> {
        const { head, state } = await this.history(request.corpusId).read();
        const fingerprint = viewHash({ request, snapshots });
        const existing = Object.values(state.builds ?? {}).find(
            (job) => job.fingerprint === fingerprint,
        );
        if (existing) return { job: existing, admitted: false };
        if (head !== request.expectedHead)
            throw new Error("View history head conflict at build admission");
        const timestamp = new Date().toISOString();
        const job: ViewBuildJob = {
            jobId: randomUUID(),
            corpusId: request.corpusId,
            fingerprint,
            request: structuredClone(request),
            actor: this.actor,
            createdAt: timestamp,
            updatedAt: timestamp,
            state: "running",
            publication: snapshots.some(
                (snapshot) => snapshot.publicationPolicy?.autoPublish,
            ),
            results: snapshots.map((snapshot) => ({
                viewId: snapshot.definition.viewId,
                snapshot,
                state: "pending",
                reason: "Queued for cross-source synthesis",
            })),
            ...(maintenancePlan ? { maintenancePlan } : {}),
        };
        state.builds ??= {};
        state.builds[job.jobId] = job;
        if (topicFamily) state.topicFamily = structuredClone(topicFamily);
        if (wikiFamily)
            state[familyKind === "wiki" ? "wikiFamily" : "projectFamily"] =
                structuredClone(wikiFamily);
        await this.commitBuildState(
            request.corpusId,
            head,
            state,
            `Admit draft build ${job.jobId}`,
        );
        return { job, admitted: true };
    }

    public async admitTopicBuild(
        input: ViewBuildSnapshot,
        expectedHead: string | null,
        family: TopicFamilyState,
    ): Promise<{
        job: ViewBuildJob;
        admitted: boolean;
    }> {
        if (input.pipeline !== "topics-v1" || !input.topicInput)
            throw new Error(
                "Topic admission requires complete captured incidence",
            );
        const checkpoint: TopicFamilyState = {
            enabled: family.enabled,
            dirty: false,
            ...(input.topicInput.indexGeneration
                ? { indexGeneration: input.topicInput.indexGeneration }
                : {}),
        };
        return this.admitViewBuild(
            {
                corpusId: input.corpusId,
                expectedHead,
                targets: [
                    {
                        definition: input.definition,
                        expectedVersion: input.expectedVersion,
                    },
                ],
            },
            [input],
            undefined,
            undefined,
            "wiki",
            checkpoint,
        );
    }

    public async recordViewMaintenance(
        plan: ViewMaintenancePlan,
        job?: ViewBuildJob,
    ): Promise<ViewMaintenanceResult> {
        const { head, state } = await this.history(plan.corpusId).read();
        const receipt: ViewMaintenanceResult = {
            receiptId: randomUUID(),
            plan,
            ...(job ? { job } : {}),
        };
        state.maintenanceReceipts ??= {};
        state.maintenanceReceipts[receipt.receiptId] = {
            receiptId: receipt.receiptId,
            plan,
            ...(job ? { jobId: job.jobId } : {}),
        };
        const entries = Object.entries(state.maintenanceReceipts);
        state.maintenanceReceipts = Object.fromEntries(entries.slice(-100));
        await this.commitBuildState(
            plan.corpusId,
            head,
            state,
            "Record manual view maintenance plan",
        );
        return receipt;
    }

    public async getViewMaintenance(
        corpusId: string,
        receiptId: string,
    ): Promise<ViewMaintenanceResult | undefined> {
        const { state } = await this.history(corpusId).read();
        const receipt = state.maintenanceReceipts?.[receiptId];
        if (!receipt) return undefined;
        if (!receipt.jobId)
            return { receiptId: receipt.receiptId, plan: receipt.plan };
        const job = state.builds?.[receipt.jobId];
        if (!job)
            throw new Error(
                "Maintenance receipt references a missing build job",
            );
        return { receiptId: receipt.receiptId, plan: receipt.plan, job };
    }

    public async updateViewMaintenance(
        request: ViewMaintenanceUpdate,
    ): Promise<ViewHistoryEntry> {
        const { head, state } = await this.history(request.corpusId).read();
        const current = viewVersions(state, request.viewId).at(-1);
        if (
            head !== request.expectedHead ||
            current?.version !== request.expectedVersion
        )
            throw new Error(
                "View maintenance definition head or version conflict",
            );
        if (!current || current.state === "archived")
            throw new Error(
                "View is not eligible for maintenance configuration",
            );
        const definition = materializeDefinition(
            { ...current.definition, maintenance: request.maintenance },
            current.definition,
        );
        const version: ViewVersion = {
            ...current,
            definition,
            revisionId: randomUUID(),
            baseRevisionId: current.revisionId,
            version: current.version + 1,
            createdAt: timestamp(),
            actor: this.actor,
            state:
                request.maintenance.scope.mode === "pinned"
                    ? current.state
                    : "stale",
        };
        version.relationships = versionRelationships(
            version,
            authoredRelationships(current),
            !!current.generation,
        );
        state.views[request.viewId].push(version);
        const commitId = await this.commitBuildState(
            request.corpusId,
            head,
            state,
            "Update explicit view maintenance definition",
        );
        return { commitId, version };
    }

    public async updateViewBuild(
        corpusId: string,
        jobId: string,
        update: (job: ViewBuildJob) => void,
    ): Promise<ViewBuildJob> {
        const { head, state } = await this.history(corpusId).read();
        const job = state.builds?.[jobId];
        if (!job)
            throw new Error(
                "View build was removed or forgotten; cannot persist a result",
            );
        update(job);
        job.updatedAt = timestamp();
        await this.commitBuildState(
            corpusId,
            head,
            state,
            `Build receipt ${jobId}`,
        );
        return job;
    }

    public async recoverViewBuilds(corpusId: string): Promise<void> {
        const { head, state } = await this.history(corpusId).read();
        const running = Object.values(state.builds ?? {}).filter(
            (job) => job.state === "running",
        );
        if (!running.length) return;
        for (const kind of ["wiki", "projects"] as const) {
            const family =
                state[kind === "wiki" ? "wikiFamily" : "projectFamily"];
            if (
                family &&
                running.some((job) =>
                    job.results.some(
                        (result) =>
                            result.snapshot.pipeline ===
                            (kind === "wiki"
                                ? "informational-wiki-v1"
                                : "informational-project-summary-v1"),
                    ),
                )
            ) {
                family.dirty = true;
                family.cursor = 0;
                delete family.error;
            }
        }
        for (const job of running) {
            job.state = "interrupted";
            job.updatedAt = timestamp();
            for (const result of job.results) {
                if (
                    [
                        "pending",
                        "inventorying",
                        "checkingInventory",
                        "generating",
                        "validating",
                    ].includes(result.state)
                ) {
                    result.state = "interrupted";
                    result.reason =
                        "Service restarted before durable materialization; pending indexed work will reconcile";
                }
            }
        }
        await this.commitBuildState(
            corpusId,
            head,
            state,
            "Reconcile interrupted draft builds",
        );
    }

    public async getViewConflict(
        corpusId: string,
        conflictId: string,
    ): Promise<ViewMergeConflict | undefined> {
        assertViewIdentifier("conflict ID", conflictId);
        if (this.needsInventorySnapshot(corpusId))
            return this.withInventoryRead(corpusId, () =>
                this.getViewConflict(corpusId, conflictId),
            );
        const scope = this.inventoryRead.getStore();
        if (scope?.active && scope.corpusId === corpusId) {
            const legacy = scope.projection.conflicts?.[conflictId];
            if (legacy) return structuredClone(legacy);
            return (
                await this.history(corpusId).readEntry<ViewMergeConflict>(
                    `conflict-${encodeURIComponent(conflictId)}.json`,
                    scope.head ?? undefined,
                )
            ).value;
        }
        return structuredClone(
            (await this.readSnapshot(corpusId)).state.conflicts?.[conflictId],
        );
    }

    public async pendingWikiContributionConflict(
        input: ViewBuildSnapshot,
    ): Promise<ViewMergeConflict | undefined> {
        const { state } = await this.history(input.corpusId).read();
        for (const result of Object.values(state.builds ?? {}).flatMap(
            (job) => job.results,
        )) {
            if (
                result.viewId !== input.definition.viewId ||
                result.wikiAssessment?.disposition !== "contribute" ||
                !result.conflictId ||
                !sameViewBuildEvidence(result.snapshot, input)
            )
                continue;
            const conflict = state.conflicts?.[result.conflictId];
            if (
                conflict?.state === "pending" &&
                viewVersions(state, conflict.viewId).at(-1)?.revisionId ===
                    conflict.expectedRevisionId
            )
                return conflict;
        }
        return undefined;
    }

    public async hasPendingInformationalInput(
        corpusId: string,
        viewId: string,
        input: ViewBuildSnapshot,
        includeParkedFailures = true,
    ): Promise<boolean> {
        const { state } = await this.history(corpusId).read();
        const pendingConflict = Object.values(state.conflicts ?? {}).some(
            (conflict) =>
                conflict.state === "pending" &&
                conflict.viewId === viewId &&
                sameViewBuildEvidence(conflict.input, input),
        );
        if (pendingConflict) return true;
        const attempts = Object.values(state.builds ?? {}).flatMap((job) =>
            job.results.filter(
                (result) =>
                    result.viewId === viewId &&
                    sameViewBuildEvidence(result.snapshot, input),
            ),
        );
        if (
            includeParkedFailures &&
            attempts.some((result) =>
                ["blocked", "conflicted", "cancelled"].includes(result.state),
            )
        )
            return true;
        if (
            includeParkedFailures &&
            attempts.filter((result) => result.state === "failed").length >= 2
        )
            return true;
        return Object.values(state.builds ?? {}).some((job) =>
            job.results.some((result) => {
                if (result.viewId !== viewId) return false;
                const canonicalId = result.wikiAssessment?.canonicalViewId;
                if (!canonicalId) return false;
                const publication = this.publicationStatus(state, canonicalId);
                return (
                    publication.indexState === "ready" &&
                    !publication.blockedReason &&
                    publication.publishedRevisionId ===
                        result.wikiAssessment?.canonicalRevisionId &&
                    reusableWikiAssessment(
                        result,
                        input,
                        viewVersions(state, canonicalId).at(-1),
                    )
                );
            }),
        );
    }

    public async materializeViewBuild(
        corpusId: string,
        jobId: string,
        viewId: string,
        candidate: ViewSynthesisOutput,
        merged: ViewSynthesisOutput,
        conflicts: string[],
        validation?: ViewPublicationProof,
        contribution?: {
            input: ViewBuildSnapshot;
            verification: WikiSubjectAssessment;
        },
    ): Promise<ViewBuildTargetResult> {
        const { head, state } = await this.history(corpusId).read();
        const job = state.builds?.[jobId];
        const result = job?.results.find((entry) => entry.viewId === viewId);
        if (!job || !result || job.state !== "running")
            throw new Error("Build is no longer eligible for materialization");
        const input = contribution?.input ?? result.snapshot;
        if (contribution)
            assertWikiContribution(result, contribution, conflicts.length > 0);
        const targetId = input.definition.viewId;
        const current = viewVersions(state, targetId).at(-1);
        if (
            (current?.version ?? 0) !== input.expectedVersion ||
            current?.revisionId !== input.targetRevisionId ||
            current?.state === "archived"
        )
            throw new Error("View target changed during build");
        if (conflicts.length) {
            if (!current)
                throw new Error("A missing target cannot have edit conflicts");
            const target = { ...result, viewId: targetId, snapshot: input };
            this.recordMergeConflict(
                state,
                job,
                target,
                current,
                candidate,
                conflicts,
            );
            result.state = target.state;
            result.reason = target.reason;
            if (target.conflictId) result.conflictId = target.conflictId;
        } else {
            const version = this.generatedVersion(
                input,
                current,
                candidate,
                merged,
            );
            if (validation) version.validation = validation;
            state.views[targetId] = [...viewVersions(state, targetId), version];
            result.state = version.provenance === "merged" ? "merged" : "draft";
            result.reason =
                "Validated draft saved; no publication, review or execution authority";
            result.revisionId = version.revisionId;
            if (contribution) {
                result.wikiContribution = {
                    input,
                    revisionId: version.revisionId,
                    state: "committed",
                    verification: contribution.verification,
                };
                result.state = "validating";
                result.reason =
                    "Canonical contribution committed; publication/index binding pending";
            }
            state.publications ??= {};
            const publication = state.publications[targetId] ?? {
                viewId: targetId,
                indexState: "absent" as const,
                reason: "No published revision",
            };
            publication.latestBuiltRevisionId = version.revisionId;
            state.publications[targetId] = publication;
            result.missingEvidence = candidate.missingEvidence;
            if (merged.coverage) result.coverage = merged.coverage;
        }
        job.updatedAt = timestamp();
        await this.commitBuildState(
            corpusId,
            head,
            state,
            `Materialize draft build ${jobId}: ${viewId} ${result.state}`,
        );
        return result;
    }

    public async acceptWikiConsolidation(
        corpusId: string,
        jobId: string,
        targetId: string,
    ): Promise<ViewVersion> {
        const { head, state } = await this.history(corpusId).read();
        const receipt = state.builds?.[jobId]?.results.find(
            (result) => result.viewId === targetId,
        )?.wikiConsolidation;
        if (!receipt)
            throw new Error("Consolidation receipt was removed or forgotten");
        const survivor = viewVersions(state, receipt.survivorViewId).at(-1);
        if (receipt.acceptedRevisionId) {
            if (survivor?.revisionId !== receipt.acceptedRevisionId)
                throw new ConsolidationTargetChanged(
                    "Accepted consolidation target changed",
                );
            return survivor;
        }
        const retiring = viewVersions(state, receipt.retiringViewId).at(-1);
        const generated = (view: ViewVersion) =>
            automaticallyConsolidatable(
                view,
                viewVersions(state, view.viewId).map((version) => ({
                    commitId: "",
                    version,
                })),
            );
        if (
            receipt.stage !== "prepared" ||
            receipt.assessment.relation !== "samePurpose" ||
            !receipt.verification.safe ||
            receipt.verification.failures.length ||
            !survivor ||
            !retiring ||
            !generated(survivor) ||
            !generated(retiring) ||
            survivor.revisionId !== receipt.input.targetRevisionId ||
            survivor.version !== receipt.input.expectedVersion ||
            retiring.revisionId !== receipt.retiringRevisionId ||
            retiring.version !== receipt.retiringVersion
        )
            throw new ConsolidationTargetChanged(
                "Consolidation acceptance target or authorship changed",
            );
        assertWikiRedirectCapacity(
            Object.keys(state.views).flatMap((viewId) =>
                viewVersions(state, viewId).slice(-1),
            ),
            retiring.viewId,
        );
        const version = this.generatedVersion(
            receipt.input,
            survivor,
            receipt.output,
            receipt.output,
        );
        state.views[version.viewId].push(version);
        receipt.acceptedRevisionId = version.revisionId;
        receipt.stage = "accepted";
        state.publications ??= {};
        state.publications[version.viewId] = {
            ...state.publications[version.viewId],
            viewId: version.viewId,
            latestBuiltRevisionId: version.revisionId,
            indexState: "pending",
            reason: "Canonical consolidation accepted; exact derivative readiness pending",
        };
        await this.commitBuildState(
            corpusId,
            head,
            state,
            "Accept qualified canonical consolidation",
        );
        return version;
    }

    public async activateWikiRedirect(
        corpusId: string,
        jobId: string,
        targetId: string,
    ): Promise<void> {
        const { head, state } = await this.history(corpusId).read();
        const receipt = state.builds?.[jobId]?.results.find(
            (result) => result.viewId === targetId,
        )?.wikiConsolidation;
        if (!receipt)
            throw new Error("Consolidation receipt was removed or forgotten");
        if (receipt.stage === "redirected" || receipt.stage === "ready") return;
        const survivor = viewVersions(state, receipt.survivorViewId).at(-1);
        const retiring = viewVersions(state, receipt.retiringViewId).at(-1);
        if (
            receipt.stage !== "accepted" ||
            !survivor ||
            !retiring ||
            !survivor.generation ||
            survivor.revisionId !== receipt.acceptedRevisionId ||
            retiring.revisionId !== receipt.retiringRevisionId ||
            !automaticallyConsolidatable(
                retiring,
                viewVersions(state, retiring.viewId).map((version) => ({
                    commitId: "",
                    version,
                })),
            ) ||
            !automaticallyConsolidatable(
                survivor,
                viewVersions(state, survivor.viewId).map((version) => ({
                    commitId: "",
                    version,
                })),
            )
        )
            throw new ConsolidationTargetChanged(
                "Consolidation redirect target or authorship changed",
            );
        assertWikiRedirectCapacity(
            Object.keys(state.views).flatMap((viewId) =>
                viewVersions(state, viewId).slice(-1),
            ),
            retiring.viewId,
        );
        const alias: ViewVersion = {
            ...retiring,
            revisionId: randomUUID(),
            version: retiring.version + 1,
            baseRevisionId: retiring.revisionId,
            state: "archived",
            actor: "memory-view-generator",
            createdAt: timestamp(),
            content: structuredClone(survivor.content),
            generation: structuredClone(survivor.generation),
            relationships: structuredClone(survivor.relationships),
            edits: [],
            redirect: {
                viewId: survivor.viewId,
                acceptedRevisionId: survivor.revisionId,
                anchors: receipt.anchors,
            },
        };
        state.views[retiring.viewId].push(alias);
        receipt.redirectRevisionId = alias.revisionId;
        receipt.stage = "redirected";
        if (state.wikiFamily)
            state.wikiFamily.descriptors = state.wikiFamily.descriptors.filter(
                (descriptor) => descriptor.viewId !== retiring.viewId,
            );
        await this.commitBuildState(
            corpusId,
            head,
            state,
            "Activate accepted canonical Wiki redirect",
        );
    }

    private recordMergeConflict(
        state: ViewStoreState,
        job: ViewBuildJob,
        result: ViewBuildTargetResult,
        current: ViewVersion,
        candidate: ViewSynthesisOutput,
        targets: string[],
    ): void {
        const identity = viewHash({
            viewId: current.viewId,
            current: current.revisionId,
            input: result.snapshot.fingerprint,
            candidate,
            targets,
        });
        state.conflicts ??= {};
        let conflict = Object.values(state.conflicts).find(
            (entry) => entry.identity === identity,
        );
        if (!conflict) {
            conflict = {
                event: {
                    kind: "viewMergeConflict",
                    editIds: (current.edits ?? [])
                        .filter((edit) => edit.status !== "cleared")
                        .map((edit) => edit.id),
                    evidence: result.snapshot.inputs.map(
                        ({ sourceId, revisionId }) => ({
                            sourceId,
                            revisionId,
                        }),
                    ),
                },
                conflictId: randomUUID(),
                identity,
                corpusId: job.corpusId,
                viewId: current.viewId,
                jobId: job.jobId,
                createdAt: timestamp(),
                actor: "memory-view-generator",
                state: "pending",
                expectedRevisionId: current.revisionId,
                input: result.snapshot,
                base: current.generation,
                human: current,
                candidate,
                targets,
                reason: "Explicit edits cannot be preserved safely; authenticated resolution required",
            };
            state.conflicts[conflict.conflictId] = conflict;
        }
        result.state = "conflicted";
        result.conflictId = conflict.conflictId;
        result.reason = conflict.reason;
    }

    private generatedVersion(
        input: ViewBuildSnapshot,
        current: ViewVersion | undefined,
        candidate: ViewSynthesisOutput,
        merged: ViewSynthesisOutput,
    ): ViewVersion & {
        generation: NonNullable<ViewVersion["generation"]>;
        edits: NonNullable<ViewVersion["edits"]>;
    } {
        const candidateId = randomUUID();
        const edits = rebaseViewEdits(current, candidate, merged, candidateId);
        const version: ViewVersion & {
            generation: NonNullable<ViewVersion["generation"]>;
            edits: NonNullable<ViewVersion["edits"]>;
        } = {
            corpusId: input.corpusId,
            viewId: input.definition.viewId,
            revisionId: randomUUID(),
            version: (current?.version ?? 0) + 1,
            state: "draft",
            createdAt: timestamp(),
            actor: "memory-view-generator",
            ...(current ? { baseRevisionId: current.revisionId } : {}),
            provenance: edits.some((edit) => edit.status !== "cleared")
                ? "merged"
                : "generated",
            definition: materializeDefinition(
                input.definition,
                current?.definition,
            ),
            content: structuredClone(merged.content),
            generation: {
                candidateId,
                content: structuredClone(candidate.content),
                fingerprint: viewHash(candidate.content),
                relationships: structuredClone(candidate.relationships),
                input,
                outcome: candidate.outcome,
                missingEvidence: merged.missingEvidence,
                ...inventoryEvidence(merged),
            },
            edits,
            relationships: [],
        };
        version.relationships = versionRelationships(
            version,
            merged.relationships,
            true,
        );
        if (input.maintenance)
            version.maintenance = maintenanceManifest(
                input.maintenance,
                version,
            );
        return version;
    }

    public async resolveViewConflict(
        request: ViewConflictResolution,
        output: ViewSynthesisOutput,
        validation?: ViewPublicationProof,
    ): Promise<ViewHistoryEntry> {
        const { head, state } = await this.history(request.corpusId).read();
        const conflict = state.conflicts?.[request.conflictId];
        const current = conflict && viewVersions(state, conflict.viewId).at(-1);
        if (
            head !== request.expectedHead ||
            !conflict ||
            conflict.state !== "pending" ||
            !current ||
            current.version !== request.expectedVersion ||
            current.revisionId !== request.expectedRevisionId ||
            current.revisionId !== conflict.expectedRevisionId ||
            request.inputFingerprint !== conflict.input.fingerprint
        )
            throw new Error(
                "Conflict resolution head/target/input guard changed",
            );
        const version = this.generatedVersion(
            conflict.input,
            current,
            conflict.candidate,
            output,
        );
        version.actor = this.actor;
        if (validation) version.validation = validation;
        version.provenance = "human";
        if (request.choice === "generated")
            version.edits = (current.edits ?? []).map((edit) => ({
                ...edit,
                status: "cleared",
            }));
        else {
            const baseline = {
                ...version,
                content: conflict.candidate.content,
                edits: [],
                relationships: versionRelationships(
                    version,
                    conflict.candidate.relationships,
                    true,
                ),
            };
            const fresh = recordViewEdits(
                baseline,
                output.content,
                output.relationships,
                this.actor,
            );
            version.edits = reconcileResolutionEdits(
                current,
                version.edits,
                fresh,
                output,
            );
        }
        version.relationships = versionRelationships(
            version,
            output.relationships,
            true,
        );
        state.views[version.viewId] = [
            ...viewVersions(state, version.viewId),
            version,
        ];
        conflict.state = "resolved";
        conflict.resolutionRevisionId = version.revisionId;
        const commitId = await this.commitBuildState(
            request.corpusId,
            head,
            state,
            `Resolve view conflict ${conflict.conflictId} by ${this.actor}`,
        );
        return { commitId, version };
    }

    public async archiveView(
        request: ViewArchiveRequest,
    ): Promise<ViewHistoryEntry> {
        const history = this.history(request.corpusId);
        const { head, state } = await history.read();
        if (head !== request.expectedHead)
            throw new Error("View history head conflict");
        const versions = viewVersions(state, request.viewId);
        const current = versions.at(-1);
        if (!current) throw new Error(`Unknown view '${request.viewId}'`);
        if (current.version !== request.expectedVersion)
            throw new Error("View version conflict");
        if (current.state === "archived")
            throw new Error("View is already archived");
        const version: ViewVersion = {
            ...current,
            revisionId: randomUUID(),
            version: current.version + 1,
            baseRevisionId: current.revisionId,
            state: "archived",
            actor: this.actor,
            createdAt: timestamp(),
        };
        version.relationships = versionRelationships(
            version,
            authoredRelationships(current),
            current.generation?.input !== undefined,
        );
        state.views[request.viewId] = [...versions, version];
        if (state.publications?.[request.viewId]?.publishedRevisionId) {
            delete state.publications[request.viewId];
            state.viewIndexCleanup = [
                ...new Set([...(state.viewIndexCleanup ?? []), request.viewId]),
            ];
        }
        this.expireReadSnapshot();
        const commitId = await history.commit(
            head,
            state,
            this.entries(state),
            this.actor,
            `Archive ${request.viewId}`,
        );
        return { commitId, version };
    }

    public async getViewHistory(
        request: ViewReadRequest,
    ): Promise<ViewHistoryEntry[]> {
        assertViewIdentifier("view ID", request.viewId);
        const scope = this.readOperation.getStore();
        const head =
            scope?.active && scope.corpusId === request.corpusId
                ? (await scope.snapshot).head
                : undefined;
        const commits = (
            await this.history(request.corpusId).historyForRecord<
                ViewVersion[]
            >(request.viewId, head)
        ).reverse();
        const seen = new Set<string>();
        const entries = commits.flatMap(({ commitId, record }) => {
            return (record ?? []).flatMap((version) => {
                if (seen.has(version.revisionId)) return [];
                seen.add(version.revisionId);
                return [{ commitId, version }];
            });
        });
        return entries
            .reverse()
            .filter(
                (entry) =>
                    request.revisionId === undefined ||
                    entry.version.revisionId === request.revisionId,
            );
    }

    private sanitize(state: ViewStoreState, sourceId: string): ViewStoreState {
        const clearingDerived = sourceId === "@clear-derived-views";
        const forgottenEvents = forgottenEventIds(sourceId);
        if (state.knowledge && !forgottenEvents) {
            state.knowledge.discovery.receipts =
                state.knowledge.discovery.receipts.filter(
                    (receipt) =>
                        !clearingDerived &&
                        !receipt.sources.some(
                            (source) => source.sourceId === sourceId,
                        ),
                );
            state.knowledge.discovery.routes =
                state.knowledge.discovery.routes.filter(
                    (route) =>
                        !clearingDerived && !route.sourceIds.includes(sourceId),
                );
            delete state.knowledge.discovery.error;
            state.knowledge.checkpoints = state.knowledge.checkpoints.map(
                (checkpoint) =>
                    clearingDerived ||
                    checkpoint.sources.some(
                        (source) => source.sourceId === sourceId,
                    )
                        ? {
                              ...checkpoint,
                              state: "superseded",
                              sources: [],
                              viewIds: [],
                              jobIds: [],
                              discoveryFingerprints: [],
                              reasons: ["Knowledge evidence was removed"],
                              updatedAt: timestamp(),
                          }
                        : checkpoint,
            );
        }
        if (
            clearingDerived ||
            (forgottenEvents &&
                state.topics?.influenceEvents?.some((event) =>
                    forgottenEvents.has(event.eventId),
                )) ||
            (!forgottenEvents &&
                state.topics?.influenceSources.some(
                    (source) => source.sourceId === sourceId,
                ))
        ) {
            delete state.topics;
            state.topicFamily = {
                enabled: state.topicFamily?.enabled ?? true,
                dirty: true,
            };
        }
        if (!forgottenEvents) eraseInformationalRetrieval(state, sourceId);
        const matches = (value: {
            sourceId: string;
            evidence?: { kind: "event"; eventId: string };
        }) =>
            forgottenEvents
                ? value.evidence !== undefined &&
                  forgottenEvents.has(value.evidence.eventId)
                : !value.evidence && value.sourceId === sourceId;
        const selected = (
            definition: Pick<ViewVersion["definition"], "selector">,
        ) =>
            forgottenEvents
                ? definition.selector.events?.some((event) =>
                      forgottenEvents.has(event.eventId),
                  )
                : definition.selector.sources.some(
                      (source) => source.sourceId === sourceId,
                  );
        const affected = new Set(
            Object.entries(state.views).flatMap(([id, versions]) =>
                versions.some((version) => {
                    if (clearingDerived) return true;
                    const content = [
                        version.content,
                        ...(version.generation
                            ? [version.generation.content]
                            : []),
                    ];
                    const references = content.flatMap((item) => {
                        const evidence = getProcedureEvidenceReferences(item);
                        return [...evidence.citations, ...evidence.assets];
                    });
                    return (
                        selected(version.definition) ||
                        version.generation?.input?.inputs.some(matches) ||
                        (!forgottenEvents &&
                            version.generation?.input?.influenceSources?.some(
                                matches,
                            )) ||
                        references.some(matches) ||
                        (!forgottenEvents &&
                            version.maintenance?.privacySources.includes(
                                sourceId,
                            ))
                    );
                })
                    ? [id]
                    : [],
            ),
        );
        state.views = Object.fromEntries(
            Object.entries(state.views).filter(([id]) => !affected.has(id)),
        );
        state.builds = Object.fromEntries(
            Object.entries(state.builds ?? {}).filter(
                ([, job]) =>
                    !clearingDerived &&
                    !job.results.some(
                        (result) =>
                            result.snapshot.inputs.some(matches) ||
                            this.forgottenTopicInfluence(
                                result.snapshot,
                                sourceId,
                                forgottenEvents,
                            ) ||
                            result.wikiContribution?.input.inputs.some(
                                matches,
                            ) ||
                            result.wikiConsolidation?.input.inputs.some(
                                matches,
                            ) ||
                            (!forgottenEvents &&
                                result.wikiConsolidation?.input.influenceSources?.some(
                                    matches,
                                )) ||
                            (!!result.wikiConsolidation &&
                                (affected.has(
                                    result.wikiConsolidation.survivorViewId,
                                ) ||
                                    affected.has(
                                        result.wikiConsolidation.retiringViewId,
                                    ))) ||
                            (!forgottenEvents &&
                                result.snapshot.maintenance?.privacySources.includes(
                                    sourceId,
                                )) ||
                            selected(result.snapshot.definition) ||
                            affected.has(result.viewId) ||
                            (!!result.wikiAssessment?.canonicalViewId &&
                                affected.has(
                                    result.wikiAssessment.canonicalViewId,
                                )),
                    ),
            ),
        );
        state.conflicts = Object.fromEntries(
            Object.entries(state.conflicts ?? {}).filter(
                ([, conflict]) =>
                    !clearingDerived &&
                    !affected.has(conflict.viewId) &&
                    !conflict.input.inputs.some(matches) &&
                    (forgottenEvents !== undefined ||
                        !conflict.input.influenceSources?.some(matches)) &&
                    (forgottenEvents !== undefined ||
                        !conflict.input.maintenance?.privacySources.includes(
                            sourceId,
                        )) &&
                    !selected(conflict.input.definition),
            ),
        );
        state.publications = Object.fromEntries(
            Object.entries(state.publications ?? {}).filter(
                ([id]) => !clearingDerived && !affected.has(id),
            ),
        );
        state.maintenanceReceipts = {};
        for (const family of [state.wikiFamily, state.projectFamily]) {
            if (!family) continue;
            family.descriptors = family.descriptors.filter(
                (descriptor) =>
                    !clearingDerived &&
                    !affected.has(descriptor.viewId) &&
                    !descriptor.sourceIds.includes(sourceId),
            );
            family.dirty = true;
            family.cursor = 0;
            delete family.indexVersion;
            delete family.error;
        }
        for (const job of Object.values(state.builds))
            delete job.maintenancePlan;
        if (state.viewIndexCleanup)
            state.viewIndexCleanup = state.viewIndexCleanup.filter(
                (id) => !clearingDerived && !affected.has(id),
            );
        if (state.publicationPolicy)
            state.publicationPolicy.views = Object.fromEntries(
                Object.entries(state.publicationPolicy.views).filter(
                    ([id]) => !clearingDerived && !affected.has(id),
                ),
            );
        return state;
    }

    public async forgetSource(
        corpusId: string,
        sourceId: string,
    ): Promise<void> {
        this.expireReadSnapshot();
        await this.history(corpusId).purge(
            sourceId,
            (state, id) => this.sanitize(state, id),
            (state) => this.entries(state),
            () => this.removeSearchIndex(corpusId),
        );
    }

    public async forgetEvent(corpusId: string, eventId: string): Promise<void> {
        await this.forgetEvents(corpusId, [eventId]);
    }

    private forgottenTopicInfluence(
        input: ViewBuildSnapshot,
        sourceId: string,
        forgottenEvents: Set<string> | undefined,
    ): boolean {
        return forgottenEvents
            ? (input.influenceEvents?.some((event) =>
                  forgottenEvents.has(event.eventId),
              ) ?? false)
            : (input.influenceSources?.some(
                  (source) => source.sourceId === sourceId,
              ) ?? false);
    }

    public async forgetEvents(
        corpusId: string,
        eventIds: string[],
    ): Promise<void> {
        if (!eventIds.length) return;
        for (const id of eventIds) assertViewIdentifier("event ID", id);
        this.expireReadSnapshot();
        await this.history(corpusId).purge(
            JSON.stringify({
                kind: "events",
                eventIds: [...new Set(eventIds)],
            }),
            (state, id) => this.sanitize(state, id),
            (state) => this.entries(state),
            () => this.removeSearchIndex(corpusId),
        );
    }

    public async clearDerivedViews(corpusId: string): Promise<void> {
        const history = this.history(corpusId);
        const { state } = await history.read();
        if (
            !Object.keys(state.views).length &&
            !Object.keys(state.builds ?? {}).length &&
            !Object.keys(state.conflicts ?? {}).length &&
            !state.topics &&
            !Object.keys(state.maintenanceReceipts ?? {}).length &&
            !Object.keys(state.publications ?? {}).length &&
            !state.viewIndexCleanup?.length &&
            !Object.keys(state.publicationPolicy?.views ?? {}).length &&
            !state.knowledge
        )
            return;
        // This identity cannot collide with a validated source ID and is recoverable by the same purge journal.
        this.expireReadSnapshot();
        await history.purge(
            "@clear-derived-views",
            (state, id) => this.sanitize(state, id),
            (state) => this.entries(state),
            () => this.removeSearchIndex(corpusId),
        );
    }

    public async recover(corpusId: string): Promise<void> {
        this.expireReadSnapshot();
        await this.history(corpusId).recoverPurge(
            (state, id) => this.sanitize(state, id),
            (state) => this.entries(state),
            () => this.removeSearchIndex(corpusId),
        );
    }

    private async removeSearchIndex(corpusId: string): Promise<void> {
        const { state } = await this.history(corpusId).read(undefined, true);
        const retained = new Set(
            Object.keys(state.views).map((id) => viewHash(id)),
        );
        const root = path.join(
            this.viewDirectory(corpusId),
            "view-search-index",
        );
        let entries: string[];
        try {
            entries = await readdir(root);
        } catch (error) {
            if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
            entries = [];
        }
        for (const entry of entries) {
            if (!/^[0-9a-f]{64}$/.test(entry))
                throw new Error(
                    "Unexpected derived view index directory during privacy cleanup",
                );
            if (!retained.has(entry))
                await retryFilesystemPublication(() =>
                    rm(path.join(root, entry), {
                        recursive: true,
                        force: true,
                    }),
                );
        }
    }

    public async getViewPublicationPolicy(
        corpusId: string,
    ): Promise<ViewPublicationPolicy> {
        const { state } = await this.readSnapshot(corpusId);
        return structuredClone(
            state.publicationPolicy ?? {
                revision: 0,
                autoPublish: true,
                views: {},
            },
        );
    }

    public async initializeViewPublicationPolicy(
        corpusId: string,
    ): Promise<void> {
        const { head, state } = await this.history(corpusId).read();
        if (state.publicationPolicy) return;
        state.publicationPolicy = { revision: 0, autoPublish: true, views: {} };
        await this.commitBuildState(
            corpusId,
            head,
            state,
            "Initialize corpus auto-publish policy",
        );
    }

    public async getViewIndexCleanup(corpusId: string): Promise<string[]> {
        return (
            (await this.history(corpusId).read()).state.viewIndexCleanup ?? []
        );
    }

    public async completeViewIndexCleanup(
        corpusId: string,
        viewId: string,
    ): Promise<void> {
        const { head, state } = await this.history(corpusId).read();
        state.viewIndexCleanup = (state.viewIndexCleanup ?? []).filter(
            (id) => id !== viewId,
        );
        await this.commitBuildState(
            corpusId,
            head,
            state,
            `Complete archived view index cleanup ${viewId}`,
        );
    }

    public async updateViewPublicationPolicy(
        request: ViewPublicationPolicyUpdate,
    ): Promise<ViewPublicationPolicy> {
        const { head, state } = await this.history(request.corpusId).read();
        if (head !== request.expectedHead)
            throw new Error("View policy history head conflict");
        const policy = state.publicationPolicy ?? {
            revision: 0,
            autoPublish: true,
            views: {},
        };
        if (request.viewId !== undefined) {
            assertViewIdentifier("view ID", request.viewId);
            const prior = policy.views[request.viewId];
            if ((prior?.revision ?? 0) !== request.expectedRevision)
                throw new Error("View policy revision conflict");
            policy.views[request.viewId] = {
                revision: request.expectedRevision + 1,
                autoPublish: request.autoPublish,
            };
        } else {
            if (policy.revision !== request.expectedRevision)
                throw new Error("Corpus publication policy revision conflict");
            if (request.autoPublish === null)
                throw new Error("Corpus publication setting cannot inherit");
            policy.revision++;
            policy.autoPublish = request.autoPublish;
        }
        state.publicationPolicy = policy;
        await this.commitBuildState(
            request.corpusId,
            head,
            state,
            "Update auto-publish policy",
        );
        return policy;
    }

    public async getViewPublication(
        request: ViewReadRequest,
    ): Promise<ViewPublicationStatus> {
        if (this.needsInventorySnapshot(request.corpusId))
            return this.withInventoryRead(request.corpusId, () =>
                this.getViewPublication(request),
            );
        const projection = this.inventory(request.corpusId);
        if (projection)
            return structuredClone(
                projection.publications[request.viewId] ?? {
                    viewId: request.viewId,
                    indexState: "absent",
                    reason: "No published revision",
                },
            );
        const { state } = await this.readSnapshot(request.corpusId);
        return structuredClone(this.publicationStatus(state, request.viewId));
    }

    public async listPublishedViews(corpusId: string) {
        const { state } = await this.history(corpusId).read();
        return Object.entries(state.views).map(([viewId, versions]) => {
            const publication = this.publicationStatus(state, viewId);
            return {
                current: versions[versions.length - 1],
                view: versions.find(
                    (version) =>
                        version.revisionId === publication.publishedRevisionId,
                ),
                publication,
            };
        });
    }

    private publicationStatus(
        state: ViewStoreState,
        viewId: string,
    ): ViewPublicationStatus {
        const publication = state.publications?.[viewId] ?? {
            viewId,
            indexState: "absent" as const,
            reason: "No published revision",
        };
        const pending = Object.values(state.conflicts ?? {}).some(
            (conflict) =>
                conflict.viewId === viewId && conflict.state === "pending",
        );
        return {
            ...publication,
            ...(pending
                ? {
                      blockedReason:
                          "Resolve the pending merge conflict before publishing or searching",
                  }
                : {}),
        };
    }

    public async publishView(
        request: ViewPublishRequest,
    ): Promise<ViewPublicationStatus> {
        const { head, state } = await this.history(request.corpusId).read();
        const current = viewVersions(state, request.viewId).at(-1);
        if (
            head !== request.expectedHead ||
            current?.revisionId !== request.revisionId ||
            current.version !== request.expectedVersion
        )
            throw new Error("Publication head or target revision conflict");
        if (current.state !== "draft")
            throw new Error("Only a current eligible draft may publish");
        if (
            Object.values(state.conflicts ?? {}).some(
                (conflict) =>
                    conflict.viewId === request.viewId &&
                    conflict.state === "pending",
            )
        )
            throw new Error(
                "Resolve the pending merge conflict before publishing",
            );
        if (!informationalView(current.content))
            assertPublicationProof(current);
        state.publications ??= {};
        const prior = state.publications[request.viewId];
        if (prior?.publishedRevisionId === current.revisionId) return prior;
        const publication: ViewPublicationStatus = {
            viewId: request.viewId,
            ...(prior?.latestBuiltRevisionId
                ? { latestBuiltRevisionId: prior.latestBuiltRevisionId }
                : {}),
            publishedRevisionId: current.revisionId,
            indexState: "pending",
            reason: "Published, indexing pending",
            intent: {
                revisionId: current.revisionId,
                actor: this.actor,
                createdAt: timestamp(),
            },
        };
        state.publications[request.viewId] = publication;
        await this.commitBuildState(
            request.corpusId,
            head,
            state,
            `Publish ${request.viewId} revision ${current.revisionId}`,
        );
        return publication;
    }

    public async updateViewIndex(
        corpusId: string,
        viewId: string,
        revisionId: string,
        error?: string,
    ): Promise<ViewPublicationStatus> {
        if (
            viewId === "__proto__" ||
            viewId === "constructor" ||
            viewId === "prototype"
        )
            throw new Error("Invalid view identifier");
        const { head, state } = await this.history(corpusId).read();
        const publication = state.publications?.[viewId];
        if (!publication || publication.publishedRevisionId !== revisionId)
            throw new Error(
                "Published revision changed before index completion",
            );
        publication.indexState = error === undefined ? "ready" : "failed";
        publication.reason =
            error === undefined
                ? "Exact published revision is searchable"
                : error;
        if (error === undefined) publication.indexedRevisionId = revisionId;
        else delete publication.indexedRevisionId;
        await this.commitBuildState(
            corpusId,
            head,
            state,
            `Index ${viewId} revision ${revisionId}: ${publication.indexState}`,
        );
        return publication;
    }

    private async invalidateDrafts(
        corpusId: string,
        invalidate: (version: ViewVersion) => boolean,
    ): Promise<void> {
        const history = this.history(corpusId);
        const snapshot = await history.read();
        let changed = false;
        for (const [id, versions] of Object.entries(snapshot.state.views)) {
            const current = versions.at(-1)!;
            if (current.state !== "draft" || !invalidate(current)) continue;
            const next: ViewVersion = {
                ...current,
                revisionId: randomUUID(),
                version: current.version + 1,
                baseRevisionId: current.revisionId,
                state: "stale",
                actor: "memory-service",
                createdAt: timestamp(),
            };
            next.relationships = versionRelationships(
                next,
                authoredRelationships(current),
                current.generation?.input !== undefined,
            );
            snapshot.state.views[id] = [...versions, next];
            changed = true;
        }
        if (changed) {
            this.expireReadSnapshot();
            await history.commit(
                snapshot.head,
                snapshot.state,
                this.entries(snapshot.state),
                "memory-service",
                "Invalidate changed view evidence or membership",
            );
        }
    }

    public async markSourceRevisionStale(
        corpusId: string,
        sourceId: string,
        activeRevisionId?: string,
    ): Promise<void> {
        await this.invalidateDrafts(corpusId, (view) =>
            [
                ...view.definition.selector.sources,
                ...(view.generation?.input?.influenceSources ?? []),
            ].some(
                (source) =>
                    source.sourceId === sourceId &&
                    source.revisionId !== activeRevisionId,
            ),
        );
    }

    public async markMaintenanceStale(
        corpusId: string,
        viewIds: string[],
    ): Promise<void> {
        const selected = new Set(viewIds);
        await this.invalidateDrafts(corpusId, (view) =>
            selected.has(view.viewId),
        );
    }

    private viewDirectory(corpusId: string): string {
        return path.join(this.rootDirectory, corpusId, "views");
    }
}

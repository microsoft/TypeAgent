// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import {
    currentSearchTraceId,
    recordSearchTiming,
    runWithSearchTiming,
    timeSearchStage,
    collectJsonSegments,
    clearJsonSegmentCache,
    jsonSegmentDirectory,
} from "@typeagent/knowpro";
import { createHash, randomUUID } from "node:crypto";
import {
    access,
    cp,
    mkdir,
    readFile,
    readdir,
    rename,
    rm,
    writeFile,
} from "node:fs/promises";
import { userInfo } from "node:os";
import path from "node:path";
import lockfile from "proper-lockfile";
import {
    MemoryBatchStore,
    type MemoryBatchImport,
    type MemoryBatchImportLookup,
    type MemoryBatchImportRequest,
} from "./batchImport.js";
import {
    createChangeReceipt,
    opaqueChangeReference,
    pageChangeReceipts,
    pruneChangeReceipts,
} from "./changeReceipts.js";
import { CorpusAccess } from "./corpusAccess.js";
import { EventSegmentStore } from "./eventSegmentStore.js";
import { BoundedIngestionGroup } from "./boundedIngestionGroup.js";
import { AgentSessionStore } from "./agentSessionStore.js";
import { configuredAgentSessionModel } from "./agentSessionDistillation.js";
import type {
    AgentMemorySearchRequest,
    AgentMemorySearchResult,
    AgentSessionDistillationModel,
    AgentSessionImportReceipt,
    AgentSessionImportRequest,
    AgentSessionReadRequest,
} from "./agentSessionTypes.js";
import {
    RevisionTextStore,
    type RevisionTextFaultPoint,
    type SerializedTextRevision,
} from "./revisionTextStore.js";
import {
    configuredSourceSynopsisModel,
    generateSourceSynopsis,
    synopsisInputHash,
    sourceSynopsisRecipe,
    type SourceSynopsisModel,
} from "./sourceSynopsis.js";
import { writeRunbookJson } from "./durableRunbookJson.js";
import {
    classifyIndexSchema,
    indexFingerprint,
    stampIndexSchema,
    type IndexKind,
} from "./indexSchema.js";
import { createKnowProCorpusIndex } from "./knowProCorpusIndex.js";
import {
    RevisionAssetStore,
    revisionDigest,
    validateAssetInputs,
    type RevisionAssetDescriptor,
    type RevisionAssetReadRequest,
    type RevisionAssetRequest,
} from "./revisionAssetStore.js";
import { redactRunbookText } from "./runbookRedaction.js";
import {
    timelineDocumentInput,
    timelineEventInput,
    validateTimelineCorrections,
    validateTimelineEvidence,
} from "./timeline.js";
import { validateIsoTimestamp } from "./timestampValidation.js";
import type {
    AnswerMode,
    CorpusIndex,
    CorpusIndexFactory,
    CorpusIndexMatch,
    DocumentIngestRequest,
    DocumentIngestResult,
    IndexedDocument,
    IngestionJobStatus,
    JobListRequest,
    JobProgress,
    JobState,
    MemoryAnswerRequest,
    MemoryAnswerResult,
    MemoryChangeListRequest,
    MemoryChangeReceipt,
    MemoryCorpus,
    MemoryCorpusStatus,
    MemoryEvent,
    MemoryEventAppendRequest,
    MemoryEventAppendResult,
    MemoryEventAuthority,
    MemoryEventFilter,
    MemoryEventForgetRequest,
    MemoryEventForgetResult,
    MemoryEventListRequest,
    MemoryEventSearchRequest,
    MemoryEventSearchResult,
    MemoryEvidence,
    MemoryKnowledgeGraph,
    MemoryPage,
    MemorySearchRequest,
    MemorySearchResult,
    MemoryService,
    MemoryServiceCapabilities,
    MemorySource,
    ReindexResult,
    SourceContent,
    SourceContentRequest,
    SourceDocument,
    SourceForgetPreview,
    SourceForgetRequest,
    SourceForgetResult,
    SourceKnowledgeSuppression,
    SourceKnowledgeSuppressionRequest,
    SourceListRequest,
    SourceReplaceRequest,
    SourceRevision,
    SourceSynopsis,
    SourceSynopsisPreview,
    SourceSynopsisRequest,
} from "./types.js";
import {
    validateBuildRequest,
    validateConflictResolution,
} from "./viewBuildValidation.js";
import {
    ViewBuildRunner,
    ViewBuildStaleError,
    safeError,
    abortable,
} from "./viewBuilds.js";
import { inventoryEvidence } from "./viewInventoryCoverage.js";
import {
    resolveViewMaintenance,
    validateMaintenanceDefinition,
} from "./viewMaintenance.js";
import {
    assertMaintenanceMembership,
    validateMaintenanceRequest,
} from "./viewMaintenanceValidation.js";
import { mergeView, sameViewBuildEvidence, viewHash } from "./viewMerge.js";
import {
    captureEditorialContext,
    editorialArticle,
    editorialProtection,
    isEditorialUnlockSuccessor,
    relatedEditorialArticles,
    unlockEditorialProtection,
} from "./viewEditorial.js";
import {
    captureTopicBuild,
    requireTopicIndex,
    supportsTopicIndex,
    topicInputFingerprint,
    reconcileTopicFamily,
} from "./topicCapture.js";
import { createConfiguredTopicGenerator } from "./topicGeneration.js";
import {
    applyTopicFamilyOperation,
    checkpointTopicFamily,
    topicFamilyCanSchedule,
} from "./topicMaintenance.js";
import type {
    MemoryTopicService,
    TopicQueryRequest,
    TopicQueryPage,
    TopicSnapshot,
} from "./topicTypes.js";
import {
    informationalView as informationalWiki,
    viewSynthesisIdentity,
} from "./informationalView.js";
import {
    RequestBudget,
    runWithRequestBudget,
    type ChatModel,
    type RequestBudgetLimits,
} from "@typeagent/aiclient";
import { answerIndexedEvidence } from "./indexedAnswer.js";
import {
    assertPublicationProof,
    effectiveViewPublicationPolicy,
    publicationProof,
} from "./viewPublication.js";
import {
    authoredRelationships,
    derivedDefinitionInput,
} from "./viewRelationships.js";
import { TypedViewStore, type WikiFamilyState } from "./viewStore.js";
import {
    nominateWikiPages,
    parseWikiAssessment,
    wikiPageContext,
} from "./wikiAdmission.js";
import {
    refreshWikiContributionInput,
    wikiContributionInput,
} from "./wikiContribution.js";
import {
    automaticallyConsolidatable,
    compatibleConsolidationPair,
    consolidationInput,
    preservedCanonicalOutput,
    readConsolidationScope,
    type WikiConsolidationReceipt,
    ConsolidationTargetChanged,
} from "./wikiConsolidation.js";
import { assertEditorialAssessment } from "./viewEditorial.js";
import { viewSourceKey } from "./viewContent.js";
import type {
    WikiPagePurposeContext,
    WikiSubjectAssessment,
    ViewBuildTargetResult,
} from "./viewTypes.js";
import {
    discoverInformationalDescriptors,
    retireWikiCandidate,
    usefulWikiSubject,
    usefulWikiSubjectLabel,
} from "./wikiGrouping.js";
import {
    createConfiguredViewSynthesisAdapter,
    validateConstructedGuide,
    validateSupport,
} from "./viewSynthesis.js";
import { viewContentToText } from "./viewText.js";
import type {
    MemoryViewService,
    ViewArchiveRequest,
    ViewBuildJob,
    ViewBuildJobRequest,
    ViewBuildRequest,
    ViewBuildSnapshot,
    ViewBuildTarget,
    ViewConflictReadRequest,
    ViewConflictResolution,
    ViewDefinitionInput,
    ViewHistoryEntry,
    ViewMaintenancePlan,
    ViewMaintenancePlanRequest,
    ViewMaintenanceRead,
    ViewMaintenanceRequest,
    ViewMaintenanceResult,
    ViewMaintenanceTargetPlan,
    ViewMaintenanceUpdate,
    ViewMergeConflict,
    ViewPublicationPolicy,
    ViewPublicationPolicyUpdate,
    ViewPublicationProof,
    ViewPublicationStatus,
    ViewPublishRequest,
    ViewReadRequest,
    ViewSaveRequest,
    ViewSearchMatch,
    ViewSearchRequest,
    ViewSnapshot,
    ViewSourceUsagePage,
    ViewSourceUsageRequest,
    ViewSynthesisAdapter,
    ViewSynthesisOutput,
    ViewVersion,
} from "./viewTypes.js";
import { validateViewArchive, validateViewDraft } from "./viewValidation.js";

const manifestFileName = "manifest.json";
const eventsFileName = "events.jsonl";
const jobsDirectoryName = "jobs";
const indexDirectoryName = "index";
const pipelineVersion = "1";
const eventSourceKinds = new Set([
    "conversation",
    "document",
    "web-activity",
    "system",
    "other",
]);
const eventSenders = new Set([
    "user",
    "assistant",
    "system",
    "tool",
    "agent",
    "other",
]);
const eventAuthorities: ReadonlySet<string> = new Set<MemoryEventAuthority>([
    "user-assertion",
    "evidence-only",
    "verified-observation",
    "explicit",
    "producer-reported",
]);

interface StoredRevision extends SourceRevision {
    content: string;
    synopsis?: SourceSynopsis & { attempts: number };
}

interface EventIndexState {
    sequence?: number;
    eligibilityRevision?: number;
    generation: string;
    watermark: string;
}

type EventSuppression =
    | {
          recordType: "event-suppression";
          scope: "idempotency";
          producerId: string;
          idempotencyKey: string;
      }
    | {
          recordType: "event-suppression";
          scope: "conversation";
          conversationId: string;
          sourceKind?: MemoryEvent["sourceKind"];
      }
    | {
          recordType: "event-suppression";
          scope: "turn";
          conversationId?: string;
          turnId: string;
          sourceKind?: MemoryEvent["sourceKind"];
          authority?: MemoryEventAuthority;
      };

export class ForgottenEventError extends Error {
    public readonly code = "EVENT_FORGOTTEN";

    public constructor() {
        super("Event was previously forgotten and cannot be appended");
        this.name = "ForgottenEventError";
    }
}

interface StoredSource extends SourceDocument {
    revisions: StoredRevision[];
}

interface AcceptedIngestion {
    request: DocumentIngestRequest;
    content: string;
    contentHash: string;
    sourceId: string;
    revisionId: string;
    job: IngestionJobStatus;
    signal: AbortSignal;
    execute: () => Promise<void>;
}

interface CorpusManifest {
    corpus: MemoryCorpus;
    sources: StoredSource[];
    changes?: MemoryChangeReceipt[];
    knowledgeSuppressions?: SourceKnowledgeSuppression[];
    indexGeneration?: string;
    pendingSourceForget?: {
        sourceId: string;
        activeRevisionId: string;
        confirmationToken: string;
        expiresAt: string;
    };
    authorizedSourceRemoval?: {
        sourceId: string;
        activeRevisionId: string;
        revisions: Array<{ revisionId: string; hasAssets: boolean }>;
    };
    pendingCorpusClear?: Array<{
        sourceId: string;
        revisions: Array<{ revisionId: string; hasAssets: boolean }>;
    }>;
}

interface SerializedCorpusManifest extends Omit<CorpusManifest, "sources"> {
    storageVersion: 1;
    sources: Array<
        Omit<StoredSource, "revisions"> & {
            revisions: SerializedTextRevision<StoredRevision>[];
        }
    >;
}

interface CorpusRuntime {
    manifest: CorpusManifest;
    index: CorpusIndex;
    events: MemoryEvent[];
    eventIdempotency: Map<string, MemoryEvent>;
    eventSuppressions: EventSuppression[];
    suppressedEventKeys: Set<string>;
    suppressedConversations: Set<string>;
    suppressedTurns: Set<string>;
    access: CorpusAccess;
    documentIndex?: PreparedCorpusIndex;
}

interface PreparedCorpusIndex {
    generation: string | undefined;
    index: CorpusIndex;
    fingerprint: string;
}

export interface FileMemoryServiceOptions {
    agentSessionImports?: boolean;
    agentSessionDistillationModel?: AgentSessionDistillationModel;
    revisionTextCheckpoint?: (point: RevisionTextFaultPoint) => Promise<void>;
    sourceSynopses?: boolean;
    sourceSynopsisModel?: SourceSynopsisModel;
    indexedAnswerModel?: ChatModel;
    /** Derived Views are enabled unless explicitly disabled by the host. */
    viewDrafts?: boolean;
    /** Informational views follow Views enablement unless explicitly disabled. */
    informationalViews?: boolean;
    viewPublicationCheckpoint?: (point: "intent" | "index") => Promise<void>;
    viewSynthesisAdapter?: ViewSynthesisAdapter;
    viewModelEndpoint?: string;
    indexFactory?: CorpusIndexFactory;
    eventIndexFactory?: CorpusIndexFactory;
    capabilities?: MemoryServiceCapabilities;
    /** Opt-in rehearsal envelope only; never enables product behavior. */
    informationalBudget?: RequestBudgetLimits;
}

function now(): string {
    return new Date().toISOString();
}

function normalizedKnowledgeName(name: string): string {
    return name.trim().toLocaleLowerCase();
}

function applyKnowledgeSuppressions(
    graph: MemoryKnowledgeGraph,
    suppressions: SourceKnowledgeSuppression[],
    allowedSourceIds?: ReadonlySet<string>,
): MemoryKnowledgeGraph {
    const suppressed = new Set(
        suppressions.map(
            (item) =>
                `${item.sourceId}\0${item.kind}\0${normalizedKnowledgeName(item.name)}`,
        ),
    );
    const retainedSources = (
        sourceIds: string[],
        kind: SourceKnowledgeSuppression["kind"],
        name: string,
    ): string[] =>
        sourceIds.filter(
            (sourceId) =>
                (allowedSourceIds === undefined ||
                    allowedSourceIds.has(sourceId)) &&
                !suppressed.has(
                    `${sourceId}\0${kind}\0${normalizedKnowledgeName(name)}`,
                ),
        );
    return {
        entities: graph.entities.flatMap((entity) => {
            const sourceIds = retainedSources(
                entity.sourceIds,
                "entity",
                entity.name,
            );
            return sourceIds.length === 0 ? [] : [{ ...entity, sourceIds }];
        }),
        topics: graph.topics.flatMap((topic) => {
            const sourceIds = retainedSources(
                topic.sourceIds,
                "topic",
                topic.name,
            );
            return sourceIds.length === 0 ? [] : [{ ...topic, sourceIds }];
        }),
        relationships: graph.relationships.flatMap((relationship) => {
            const sourceIds = relationship.sourceIds.filter(
                (sourceId) =>
                    (allowedSourceIds === undefined ||
                        allowedSourceIds.has(sourceId)) &&
                    !suppressed.has(
                        `${sourceId}\0entity\0${normalizedKnowledgeName(relationship.fromEntity)}`,
                    ) &&
                    !suppressed.has(
                        `${sourceId}\0entity\0${normalizedKnowledgeName(relationship.toEntity)}`,
                    ),
            );
            return sourceIds.length === 0
                ? []
                : [{ ...relationship, sourceIds }];
        }),
    };
}

function contentFor(request: DocumentIngestRequest): string {
    const { source } = request;
    const candidates = [source.markdown, source.text, source.html].filter(
        (value): value is string => value !== undefined,
    );
    if (candidates.length !== 1 || candidates[0].trim().length === 0) {
        throw new Error(
            "Exactly one non-empty markdown, text, or html value is required",
        );
    }
    if (
        source.sourceType === "markdown" ||
        source.sourceType === "web" ||
        source.sourceType === "vtt"
    ) {
        if (source.markdown === undefined && source.text === undefined) {
            throw new Error(
                `Source type '${source.sourceType}' requires markdown or text content`,
            );
        }
    } else if (source.sourceType === "html" && source.html === undefined) {
        throw new Error("HTML sources require html content");
    }
    return candidates[0];
}

function hashContent(content: string): string {
    return createHash("sha256").update(content).digest("hex");
}

function contentPipeline(
    pipeline: SourceRevision["pipeline"],
): IndexedDocument["pipeline"] {
    return {
        mode: "content",
        ...(pipeline?.maxCharsPerChunk === undefined
            ? {}
            : { maxCharsPerChunk: pipeline.maxCharsPerChunk }),
    };
}

function createStoredSource(
    request: DocumentIngestRequest,
    content: string,
    contentHash: string,
    sourceId: string,
    revisionId: string,
    mimeType: string,
    existing: StoredSource | undefined,
): { source: StoredSource; revision: StoredRevision } {
    const revision: StoredRevision = {
        revisionId,
        sourceId,
        contentHash,
        mimeType,
        ...(request.source.capturedAt === undefined
            ? {}
            : { capturedAt: request.source.capturedAt }),
        ...(request.source.sourceModifiedAt === undefined
            ? {}
            : { sourceModifiedAt: request.source.sourceModifiedAt }),
        pipelineVersion,
        pipeline: {
            mode: request.pipeline?.mode ?? "content",
            ...(request.pipeline?.maxCharsPerChunk === undefined
                ? {}
                : { maxCharsPerChunk: request.pipeline.maxCharsPerChunk }),
        },
        state: "processing",
        content,
    };
    const policy = request.pipeline?.updatePolicy ?? "skipIfUnchanged";
    const source: StoredSource = {
        sourceId,
        corpusId: request.corpusId,
        sourceType: request.source.sourceType,
        ...(request.source.canonicalUri === undefined
            ? {}
            : { canonicalUri: request.source.canonicalUri }),
        title: request.source.title,
        ...(request.source.tags === undefined
            ? {}
            : { tags: request.source.tags }),
        ...(request.source.metadata === undefined
            ? {}
            : { metadata: request.source.metadata }),
        activeRevisionId: revisionId,
        revisions:
            existing === undefined
                ? [revision]
                : policy === "retainRevisionHistory"
                  ? [
                        ...existing.revisions.filter(
                            (item) => item.revisionId !== revisionId,
                        ),
                        revision,
                    ]
                  : [revision],
    };
    return { source, revision };
}

function validateIdentifier(kind: string, value: string): void {
    if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/.test(value)) {
        throw new Error(`Invalid ${kind} '${value}'`);
    }
}

function validateIndexGeneration(
    generation: unknown,
): asserts generation is string {
    if (
        typeof generation !== "string" ||
        !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
            generation,
        )
    ) {
        throw new Error(`Invalid index generation '${String(generation)}'`);
    }
}

function validateTimestamp(kind: string, value: string): void {
    if (!Number.isFinite(Date.parse(value))) {
        throw new Error(`Invalid ${kind} '${value}'`);
    }
}

function validateSearchTimestamp(kind: string, value: string): void {
    validateIsoTimestamp(`search ${kind}`, value);
}

function validateSearchDateRange(
    request: Pick<MemorySearchRequest, "dateFrom" | "dateTo">,
): void {
    if (request.dateFrom !== undefined) {
        validateSearchTimestamp("dateFrom", request.dateFrom);
    }
    if (request.dateTo !== undefined) {
        validateSearchTimestamp("dateTo", request.dateTo);
    }
    if (
        request.dateFrom !== undefined &&
        request.dateTo !== undefined &&
        Date.parse(request.dateFrom) > Date.parse(request.dateTo)
    ) {
        throw new Error("Search dateFrom must not be later than dateTo");
    }
}

function matchesSearchDate(
    revision: SourceRevision,
    request: Pick<MemorySearchRequest, "dateFrom" | "dateTo">,
): boolean {
    if (request.dateFrom === undefined && request.dateTo === undefined) {
        return true;
    }
    const capturedAt = Date.parse(revision.capturedAt ?? "");
    return (
        Number.isFinite(capturedAt) &&
        (request.dateFrom === undefined ||
            capturedAt >= Date.parse(request.dateFrom)) &&
        (request.dateTo === undefined ||
            capturedAt <= Date.parse(request.dateTo))
    );
}

function eventIdempotencyKey(
    event:
        | { producer: { producerId: string }; idempotencyKey: string }
        | { producerId: string; idempotencyKey: string },
): string {
    const producerId =
        "producer" in event ? event.producer.producerId : event.producerId;
    return `${producerId}\n${event.idempotencyKey}`;
}

function validateEventAuthority(
    authority: string,
): asserts authority is MemoryEventAuthority {
    if (!eventAuthorities.has(authority)) {
        throw new Error(`Invalid event authority '${authority}'`);
    }
}

function eventAuthority(
    event: Pick<MemoryEvent, "metadata">,
): MemoryEventAuthority | undefined {
    const authority = event.metadata?.authority;
    if (authority === undefined) {
        return undefined;
    }
    if (typeof authority !== "string") {
        throw new Error("Event authority must be a string");
    }
    validateEventAuthority(authority);
    return authority;
}

function matchesEventProvenance(
    event: MemoryEvent,
    filter: MemoryEventFilter,
): boolean {
    const authority = eventAuthority(event);
    return (
        (filter.sourceKinds === undefined ||
            filter.sourceKinds.includes(event.sourceKind)) &&
        (filter.authorities === undefined ||
            (authority !== undefined &&
                filter.authorities.includes(authority))) &&
        (filter.producerIds === undefined ||
            filter.producerIds.includes(event.producer.producerId)) &&
        (filter.eventTypes === undefined ||
            filter.eventTypes.includes(event.eventType)) &&
        (filter.conversationIds === undefined ||
            (event.conversationId !== undefined &&
                filter.conversationIds.includes(event.conversationId))) &&
        (filter.turnIds === undefined ||
            (event.turnId !== undefined &&
                filter.turnIds.includes(event.turnId))) &&
        (filter.runIds === undefined ||
            (event.runId !== undefined &&
                filter.runIds.includes(event.runId))) &&
        (filter.linkedSourceIds === undefined ||
            filter.linkedSourceIds.some((sourceId) =>
                event.linkedSourceIds?.includes(sourceId),
            ))
    );
}

function matchesEventFilter(
    event: MemoryEvent,
    filter: MemoryEventFilter,
): boolean {
    return (
        matchesEventProvenance(event, filter) &&
        (filter.observedFrom === undefined ||
            Date.parse(event.observedAt) >= Date.parse(filter.observedFrom)) &&
        (filter.observedTo === undefined ||
            Date.parse(event.observedAt) <= Date.parse(filter.observedTo)) &&
        (filter.eventFrom === undefined ||
            Date.parse(event.eventTime) >= Date.parse(filter.eventFrom)) &&
        (filter.eventTo === undefined ||
            Date.parse(event.eventTime) <= Date.parse(filter.eventTo))
    );
}

function suppressedConversationKey(
    conversationId: string,
    sourceKind?: MemoryEvent["sourceKind"],
): string {
    return JSON.stringify([conversationId, sourceKind ?? null]);
}

function suppressedTurnKey(
    conversationId: string | undefined,
    turnId: string,
    sourceKind?: MemoryEvent["sourceKind"],
    authority?: MemoryEventAuthority,
): string {
    return JSON.stringify([
        conversationId ?? null,
        turnId,
        sourceKind ?? null,
        authority ?? null,
    ]);
}

type EventSuppressionState = Pick<
    CorpusRuntime,
    | "eventSuppressions"
    | "suppressedEventKeys"
    | "suppressedConversations"
    | "suppressedTurns"
>;

function isSuppressedEvent(
    runtime: EventSuppressionState,
    event: MemoryEvent,
): boolean {
    return (
        runtime.suppressedEventKeys.has(eventIdempotencyKey(event)) ||
        (event.conversationId !== undefined &&
            (runtime.suppressedConversations.has(
                suppressedConversationKey(
                    event.conversationId,
                    event.sourceKind,
                ),
            ) ||
                runtime.suppressedConversations.has(
                    suppressedConversationKey(event.conversationId),
                ))) ||
        isSuppressedTurn(runtime, event)
    );
}

function isSuppressedTurn(
    runtime: Pick<EventSuppressionState, "suppressedTurns">,
    request: MemoryEventAppendRequest,
): boolean {
    if (request.turnId === undefined) {
        return false;
    }
    for (const conversationId of [request.conversationId, undefined]) {
        for (const sourceKind of [request.sourceKind, undefined]) {
            for (const authority of [eventAuthority(request), undefined]) {
                if (
                    runtime.suppressedTurns.has(
                        suppressedTurnKey(
                            conversationId,
                            request.turnId,
                            sourceKind,
                            authority,
                        ),
                    )
                ) {
                    return true;
                }
            }
        }
    }
    return false;
}

function isWholeConversationForget(
    request: MemoryEventFilter & { eventIds?: string[] },
): boolean {
    return (
        request.conversationIds !== undefined &&
        request.turnIds === undefined &&
        (request.eventIds?.length ?? 0) === 0 &&
        request.authorities === undefined &&
        request.producerIds === undefined &&
        request.eventTypes === undefined &&
        request.runIds === undefined &&
        request.linkedSourceIds === undefined &&
        request.observedFrom === undefined &&
        request.observedTo === undefined &&
        request.eventFrom === undefined &&
        request.eventTo === undefined
    );
}

function addExplicitTurnSuppressions(
    request: MemoryEventFilter,
    add: (suppression: EventSuppression) => void,
): void {
    for (const turnId of request.turnIds ?? []) {
        for (const conversationId of request.conversationIds ?? [undefined]) {
            for (const sourceKind of request.sourceKinds ?? [undefined]) {
                for (const authority of request.authorities ?? [undefined]) {
                    add({
                        recordType: "event-suppression",
                        scope: "turn",
                        ...(conversationId === undefined
                            ? {}
                            : { conversationId }),
                        turnId,
                        ...(sourceKind === undefined ? {} : { sourceKind }),
                        ...(authority === undefined ? {} : { authority }),
                    });
                }
            }
        }
    }
}

function pageOffset(token: string | undefined): number {
    if (token === undefined) {
        return 0;
    }
    if (!/^(0|[1-9][0-9]*)$/.test(token)) {
        throw new Error("Invalid continuation token");
    }
    return Number(token);
}

function pageItems<T>(
    items: T[],
    pageSize: number | undefined,
    continuationToken: string | undefined,
): MemoryPage<T> {
    const offset = pageOffset(continuationToken);
    const limit = Math.max(1, Math.min(pageSize ?? 50, 200));
    if (offset > items.length) {
        throw new Error("Continuation token is out of range");
    }
    const page = items.slice(offset, offset + limit);
    const nextOffset = offset + page.length;
    return {
        items: page,
        total: items.length,
        ...(nextOffset < items.length
            ? { nextContinuationToken: String(nextOffset) }
            : {}),
    };
}

async function readJson<T>(filePath: string): Promise<T | undefined> {
    try {
        return JSON.parse(await readFile(filePath, "utf8")) as T;
    } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") {
            return undefined;
        }
        throw error;
    }
}

async function writeJsonAtomic(
    filePath: string,
    value: unknown,
): Promise<void> {
    await mkdir(path.dirname(filePath), { recursive: true });
    const temporaryPath = `${filePath}.${randomUUID()}.tmp`;
    const backupPath = `${filePath}.${randomUUID()}.bak`;
    await writeFile(temporaryPath, `${JSON.stringify(value, undefined, 2)}\n`);
    let hasBackup = false;
    try {
        await rename(filePath, backupPath);
        hasBackup = true;
    } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
            await rm(temporaryPath, { force: true });
            throw error;
        }
    }
    try {
        await rename(temporaryPath, filePath);
        if (hasBackup) {
            await rm(backupPath, { force: true });
        }
    } catch (error) {
        await rm(temporaryPath, { force: true });
        if (hasBackup) {
            await rename(backupPath, filePath);
        }
        throw error;
    }
}

function defaultCapabilities(): MemoryServiceCapabilities {
    return {
        features: {
            knowledgeExtraction: true,
            queryTranslation: true,
            vectorSimilarity: true,
            structuredSearch: true,
            exactSearch: true,
            management: true,
            groundedAnswer: true,
        },
        warnings: [],
    };
}

export class FileMemoryService
    implements MemoryService, MemoryViewService, MemoryTopicService
{
    private readonly viewDrafts: boolean;
    private readonly viewPublicationCheckpoint: FileMemoryServiceOptions["viewPublicationCheckpoint"];
    private readonly viewAdapter: ViewSynthesisAdapter;
    private readonly viewBuilds: ViewBuildRunner;
    private readonly indexFactory: CorpusIndexFactory;
    private readonly eventIndexFactory: CorpusIndexFactory;
    private readonly capabilities: MemoryServiceCapabilities;
    private readonly viewStore: TypedViewStore;
    private readonly assetStore: RevisionAssetStore;
    private readonly batchStore: MemoryBatchStore;
    private readonly corpora = new Map<string, CorpusRuntime>();
    private readonly corpusAccesses = new Map<string, CorpusAccess>();
    private readonly eventStores = new Map<
        string,
        EventSegmentStore<EventSuppression>
    >();

    private corpusAccess(corpusId: string): CorpusAccess {
        let access = this.corpusAccesses.get(corpusId);
        if (!access) {
            access = new CorpusAccess(() => {
                const runtime = this.corpora.get(corpusId);
                if (runtime) this.assertRemovalComplete(runtime);
            });
            this.corpusAccesses.set(corpusId, access);
        }
        return access;
    }

    private eventStore(corpusId: string): EventSegmentStore<EventSuppression> {
        let store = this.eventStores.get(corpusId);
        if (!store) {
            store = new EventSegmentStore(this.eventsPath(corpusId), () =>
                this.removeDerivedIndexRoot(
                    this.eventIndexRoot(corpusId),
                    "conversation-events",
                ),
            );
            this.eventStores.set(corpusId, store);
        }
        return store;
    }
    private readonly corpusLoads = new Map<string, Promise<CorpusRuntime>>();
    private readonly indexedReads = new Set<Promise<unknown>>();
    private readonly reindexWork = new Set<Promise<ReindexResult>>();
    private readonly documentRepairs = new Map<string, Promise<void>>();
    private readonly detachedRebuilds = new Map<
        string,
        {
            corpusId: string;
            sourceIds: Set<string>;
            baseSourceIds: Set<string>;
            controller: AbortController;
            prepared: Promise<void>;
            jobIds?: string[];
        }
    >();
    private readonly ingestionTails = new Map<string, Promise<void>>();
    private readonly segmentCollectionWork = new Map<string, Promise<void>>();
    private readonly ingestionGroups =
        new BoundedIngestionGroup<AcceptedIngestion>((entries) =>
            this.dispatchIngestionGroup(entries),
        );
    private readonly preparingIndexes = new Map<
        string,
        { corpusId: string; jobId: string; sourceIds: Set<string> }
    >();
    private readonly jobs = new Map<string, IngestionJobStatus>();
    private readonly jobWrites = new Map<string, Promise<void>>();
    private readonly controllers = new Map<string, AbortController>();
    private initializePromise: Promise<void> | undefined;
    private releaseLock: (() => Promise<void>) | undefined;
    private rootWriteTail: Promise<void> = Promise.resolve();
    private closed = false;
    private reconciliationTimer: ReturnType<typeof setInterval> | undefined;
    private readonly wikiTimers = new Map<
        string,
        ReturnType<typeof setTimeout>
    >();
    private readonly wikiMaintenanceFailures = new Map<string, Error>();
    private readonly informationalWikiEnabled: boolean;
    private readonly wikiBudget: RequestBudgetLimits | undefined;
    private readonly wikiModelEndpoint: string | undefined;
    private readonly indexedAnswerModel: ChatModel | undefined;
    private readonly sourceSynopsesEnabled: boolean;
    private synopsisModel: SourceSynopsisModel | undefined;
    private synopsisModelFailure: string | undefined;
    private readonly synopsisWork = new Map<string, Promise<void>>();
    private readonly textStores = new Map<string, RevisionTextStore>();
    private readonly revisionTextCheckpoint: FileMemoryServiceOptions["revisionTextCheckpoint"];
    private readonly agentSessionStore: AgentSessionStore;
    private readonly agentSessionImportsEnabled: boolean;

    public constructor(
        private readonly rootDirectory: string,
        options: FileMemoryServiceOptions = {},
    ) {
        this.revisionTextCheckpoint = options.revisionTextCheckpoint;
        this.viewPublicationCheckpoint = options.viewPublicationCheckpoint;
        this.viewDrafts = options.viewDrafts !== false;
        this.wikiModelEndpoint = options.viewModelEndpoint;
        this.indexedAnswerModel = options.indexedAnswerModel;
        this.sourceSynopsesEnabled =
            options.sourceSynopses ?? options.informationalViews !== false;
        this.synopsisModel = options.sourceSynopsisModel;
        this.wikiBudget = options.informationalBudget;
        this.informationalWikiEnabled =
            this.viewDrafts && options.informationalViews !== false;
        const adapter =
            options.viewSynthesisAdapter ??
            createConfiguredViewSynthesisAdapter(
                options.viewModelEndpoint,
                Math.min(this.wikiBudget?.outputTokens ?? 4000, 4000),
            );
        this.viewAdapter = adapter;
        this.viewBuilds = new ViewBuildRunner(
            this.viewAdapter,
            {
                unchanged: async (input) => {
                    const current = await this.viewStore.getView({
                        corpusId: input.corpusId,
                        viewId: input.definition.viewId,
                    });
                    const prior = current?.generation?.input;
                    if (current && sameViewBuildEvidence(prior, input)) {
                        await this.enqueueWrite(input.corpusId, () =>
                            this.recoverInformationalEffect(current),
                        );
                        return true;
                    }
                    return this.viewStore.hasPendingInformationalInput(
                        input.corpusId,
                        input.definition.viewId,
                        input,
                        false,
                    );
                },
                wikiPages: (input) => this.wikiAdmissionPages(input),
                consolidateWiki: (job, result, signal) =>
                    this.consolidateWiki(job, result, signal),
                contributeWikiSubject: (
                    job,
                    result,
                    assessment,
                    pages,
                    signal,
                ) =>
                    this.contributeWikiSubject(
                        job,
                        result,
                        assessment,
                        pages,
                        signal,
                    ),
                resumeWikiContribution: (job, result, signal) =>
                    this.resumeWikiContribution(job, result, signal),
                recordWikiAssessment: (
                    job,
                    result,
                    assessment,
                    pages,
                    signal,
                ) =>
                    this.recordWikiAssessment(
                        job,
                        result,
                        assessment,
                        pages,
                        signal,
                    ),
                update: async (corpusId, jobId, update) => {
                    return this.enqueueWrite(corpusId, async () => {
                        const job = await this.viewStore.updateViewBuild(
                            corpusId,
                            jobId,
                            update,
                        );
                        await this.checkpointInformationalFamilies(job);
                        await this.checkpointTopics(job);
                        return job;
                    });
                },
                materializeTopicIncidence: (job, result, snapshot, signal) =>
                    this.writeTopics(job, result, snapshot, signal, false),
                materializeTopics: (job, result, snapshot, signal) =>
                    this.writeTopics(job, result, snapshot, signal, true),
                current: (input) =>
                    this.getCorpusRuntime(input.corpusId).then((runtime) =>
                        runtime.access.read(() =>
                            this.viewStore.getView({
                                corpusId: input.corpusId,
                                viewId: input.definition.viewId,
                            }),
                        ),
                    ),
                materialize: (
                    job,
                    result,
                    candidate,
                    merged,
                    conflicts,
                    signal,
                    proof,
                ) =>
                    this.enqueueWrite(job.corpusId, async () => {
                        signal.throwIfAborted();
                        await this.recheckViewInput(result.snapshot);
                        const saved = await this.viewStore.materializeViewBuild(
                            job.corpusId,
                            job.jobId,
                            result.viewId,
                            candidate,
                            merged,
                            conflicts,
                            proof,
                        );
                        if (
                            !conflicts.length &&
                            saved.revisionId &&
                            informationalWiki(merged.content)
                        ) {
                            const view = await this.viewStore.getView({
                                corpusId: job.corpusId,
                                viewId: result.viewId,
                            });
                            if (!view)
                                throw new Error(
                                    "Accepted informational page is missing",
                                );
                            await this.viewStore.makeInformationalVisible(view);
                            await this.indexViewLocked(view);
                        } else if (
                            !conflicts.length &&
                            saved.revisionId &&
                            result.snapshot.publicationPolicy?.autoPublish
                        ) {
                            const snapshot = await this.viewStore.listViews(
                                job.corpusId,
                            );
                            const view = snapshot.views.find(
                                (entry) => entry.viewId === result.viewId,
                            );
                            if (!view || !snapshot.head)
                                throw new Error(
                                    "Materialized build target is missing",
                                );
                            const publication = await this.publishViewLocked({
                                corpusId: job.corpusId,
                                viewId: view.viewId,
                                revisionId: view.revisionId,
                                expectedVersion: view.version,
                                expectedHead: snapshot.head,
                            });
                            await this.viewStore.updateViewBuild(
                                job.corpusId,
                                job.jobId,
                                (current) => {
                                    const receipt = current.results.find(
                                        (entry) => entry.viewId === view.viewId,
                                    );
                                    if (!receipt)
                                        throw new Error(
                                            "Publication receipt target is missing",
                                        );
                                    receipt.publication = publication;
                                    receipt.state =
                                        publication.indexState === "ready"
                                            ? "searchable"
                                            : "published";
                                    receipt.reason = publication.reason;
                                },
                            );
                        }
                    }),
            },
            this.wikiBudget,
            createConfiguredTopicGenerator(options.viewModelEndpoint),
        );
        this.indexFactory = options.indexFactory ?? createKnowProCorpusIndex;
        this.eventIndexFactory = options.eventIndexFactory ?? this.indexFactory;
        this.capabilities = options.capabilities ?? defaultCapabilities();
        this.assetStore = new RevisionAssetStore(rootDirectory);
        this.batchStore = new MemoryBatchStore(
            rootDirectory,
            this,
            (corpusId) => this.resumeBatchMaintenance(corpusId),
        );
        this.viewStore = new TypedViewStore(rootDirectory, userInfo().username);
        this.agentSessionImportsEnabled = options.agentSessionImports !== false;
        let sessionModel = options.agentSessionDistillationModel;
        this.agentSessionStore = new AgentSessionStore(
            rootDirectory,
            {
                ingestDocument: (request, signal) =>
                    this.ingestDocument(request, signal),
                getJob: (jobId) => this.getJob(jobId),
                search: (request) => this.search(request),
                withEligible: (corpusId, sources, operation) =>
                    this.withEligibleAgentSessionSources(
                        corpusId,
                        sources,
                        operation,
                    ),
                withIngestionGroup: (operation) =>
                    this.withIngestionGroup(operation),
            },
            () =>
                (sessionModel ??= configuredAgentSessionModel(
                    options.viewModelEndpoint,
                )),
        );
    }

    private withEligibleAgentSessionSources(
        corpusId: string,
        sources: Array<{ sourceId: string; revisionId: string }>,
        operation: () => Promise<void>,
    ): Promise<void> {
        return this.enqueueWrite(corpusId, async () => {
            const runtime = await this.getCorpusRuntime(corpusId);
            if (runtime.manifest.pendingCorpusClear)
                throw new Error("Agent session corpus removal is in progress");
            for (const selected of sources) {
                const source = runtime.manifest.sources.find(
                    (entry) => entry.sourceId === selected.sourceId,
                );
                if (
                    runtime.manifest.authorizedSourceRemoval?.sourceId ===
                        selected.sourceId ||
                    source?.activeRevisionId !== selected.revisionId ||
                    !source.revisions.some(
                        (revision) =>
                            revision.revisionId === selected.revisionId &&
                            revision.state === "ready",
                    ) ||
                    runtime.manifest.knowledgeSuppressions?.some(
                        (entry) => entry.sourceId === selected.sourceId,
                    )
                )
                    throw new Error(
                        "Agent session evidence is unavailable, replaced or suppressed",
                    );
            }
            await operation();
        });
    }

    public initialize(): Promise<void> {
        if (this.closed) {
            return Promise.reject(new Error("Memory service is closed"));
        }
        this.initializePromise ??= this.acquireStorageLock().then(async () => {
            await this.batchStore.recover();
            const directories = await readdir(this.rootDirectory, {
                withFileTypes: true,
            });
            for (const directory of directories) {
                if (
                    directory.isDirectory() &&
                    /^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/.test(directory.name)
                ) {
                    await this.cleanManifestStaging(directory.name);
                    await this.viewStore.recover(directory.name);
                    await this.cleanArchivedViewIndexes(directory.name);
                    await this.viewStore.recoverViewBuilds(directory.name);
                    let manifest:
                        | Pick<
                              CorpusManifest,
                              | "authorizedSourceRemoval"
                              | "pendingCorpusClear"
                              | "indexGeneration"
                          >
                        | undefined = await this.readSerializedManifest(
                        directory.name,
                    );
                    if (manifest) {
                        await this.agentSessionStore.recover(directory.name);
                        if (manifest.pendingCorpusClear) {
                            const runtime = await this.getCorpusRuntime(
                                directory.name,
                                true,
                            );
                            await this.completeCorpusClear(
                                directory.name,
                                runtime,
                            );
                            manifest = runtime.manifest;
                        }
                        if (manifest.authorizedSourceRemoval) {
                            const runtime = await this.getCorpusRuntime(
                                directory.name,
                                true,
                            );
                            await this.completeAuthorizedSourceRemoval(
                                directory.name,
                                runtime,
                            );
                            manifest = runtime.manifest;
                        }
                        this.scheduleSourceSynopses(directory.name);
                        const runtime = await this.getCorpusRuntime(
                            directory.name,
                        );
                        await this.textStore(directory.name).purge(
                            runtime.manifest.sources,
                        );
                        await this.reconcileTopics(directory.name, runtime);
                        if (!this.informationalWikiEnabled) continue;
                        await this.enqueueWrite(directory.name, () =>
                            this.recoverWikiConsolidationsLocked(
                                directory.name,
                            ),
                        );
                        const views = (
                            await this.viewStore.listViews(directory.name)
                        ).views;
                        for (const kind of ["projects", "wiki"] as const) {
                            const family =
                                await this.reconcileInformationalFamily(
                                    directory.name,
                                    kind,
                                    manifest.indexGeneration,
                                    views,
                                );
                            if (family.enabled && family.dirty && !family.error)
                                this.scheduleWikiMaintenance(
                                    directory.name,
                                    kind,
                                );
                        }
                    }
                }
            }
            await this.pruneStoredChanges();
            await this.recoverInterruptedJobs();
            this.startMaintenanceReconciliation();
        });
        return this.initializePromise;
    }

    public async close(): Promise<void> {
        if (this.closed) {
            return;
        }
        this.closed = true;
        if (this.reconciliationTimer) clearInterval(this.reconciliationTimer);
        for (const timer of this.wikiTimers.values()) clearTimeout(timer);
        this.wikiTimers.clear();
        await this.initializePromise?.catch(() => undefined);
        for (const controller of this.controllers.values()) {
            controller.abort(new Error("Memory service is closing"));
        }
        await this.agentSessionStore.close();
        await Promise.allSettled(this.synopsisWork.values());
        await this.batchStore.close();

        this.viewBuilds.cancelAll();
        await Promise.allSettled([
            this.rootWriteTail,
            ...this.corpusLoads.values(),
            ...this.indexedReads,
            ...this.reindexWork,
        ]);
        await Promise.allSettled(this.segmentCollectionWork.values());
        // Family maintenance may admit a new build while tracked reads drain.
        const viewClosure = await Promise.allSettled([this.viewBuilds.close()]);
        await Promise.allSettled(
            [...this.corpusAccesses.values()].map((access) => access.idle()),
        );
        await this.releaseLock?.();
        this.releaseLock = undefined;
        const viewFailure = viewClosure[0];
        if (viewFailure.status === "rejected") throw viewFailure.reason;
        for (const failure of this.wikiMaintenanceFailures.values())
            throw failure;
    }

    public async createCorpus(
        name: string,
        description?: string,
    ): Promise<MemoryCorpus> {
        await this.initialize();
        const normalizedName = name.trim();
        if (normalizedName.length === 0) {
            throw new Error("Corpus name cannot be empty");
        }
        return this.enqueueRootWrite(async () => {
            const existing = (await this.listCorpora()).find(
                (corpus) => corpus.name === normalizedName,
            );
            if (existing !== undefined) {
                return structuredClone(existing);
            }
            const corpusId = randomUUID();
            const timestamp = now();
            const corpus: MemoryCorpus = {
                corpusId,
                name: normalizedName,
                ...(description === undefined ? {} : { description }),
                createdAt: timestamp,
                updatedAt: timestamp,
                status: "ready",
                documentCount: 0,
            };
            const manifest: CorpusManifest = { corpus, sources: [] };
            await this.writeManifest(corpusId, manifest);
            if (this.viewDrafts)
                await this.viewStore.initializeViewPublicationPolicy(corpusId);
            const index = this.createIndex(corpusId);
            const runtime: CorpusRuntime = {
                manifest,
                index,
                events: [],
                eventIdempotency: new Map(),
                eventSuppressions: [],
                suppressedEventKeys: new Set(),
                suppressedConversations: new Set(),
                suppressedTurns: new Set(),
                access: new CorpusAccess(() =>
                    this.assertRemovalComplete(runtime),
                ),
            };
            this.corpora.set(corpusId, runtime);
            return structuredClone(corpus);
        });
    }

    public async listCorpora(): Promise<MemoryCorpus[]> {
        await this.initialize();
        await mkdir(this.rootDirectory, { recursive: true });
        const entries = await import("node:fs/promises").then((fs) =>
            fs.readdir(this.rootDirectory, { withFileTypes: true }),
        );
        const corpora: MemoryCorpus[] = [];
        for (const entry of entries) {
            if (!entry.isDirectory()) {
                continue;
            }
            const manifest = await this.readSerializedManifest(entry.name);
            if (manifest !== undefined) {
                corpora.push(manifest.corpus);
            }
        }
        return corpora.sort((left, right) =>
            left.name.localeCompare(right.name),
        );
    }

    public async getCorpus(
        corpusId: string,
    ): Promise<MemoryCorpusStatus | undefined> {
        await this.initialize();
        validateIdentifier("corpus ID", corpusId);
        let runtime: CorpusRuntime;
        try {
            runtime = await this.getCorpusRuntime(corpusId);
        } catch (error) {
            if (
                error instanceof Error &&
                error.message === `Unknown corpus '${corpusId}'`
            ) {
                return undefined;
            }
            throw error;
        }
        const revisions = runtime.manifest.sources.flatMap(
            (source) => source.revisions,
        );
        const activeStates: JobState[] = [
            "accepted",
            "validating",
            "normalizing",
            "chunking",
            "extracting-knowledge",
            "embedding",
            "building-indexes",
            "persisting",
            "cancelling",
        ];
        let activeJobCount = 0;
        let continuationToken: string | undefined;
        do {
            const jobs = await this.listJobs({
                corpusId,
                states: activeStates,
                pageSize: 200,
                ...(continuationToken === undefined
                    ? {}
                    : { continuationToken }),
            });
            activeJobCount += jobs.items.length;
            continuationToken = jobs.nextContinuationToken;
        } while (continuationToken !== undefined);
        return {
            ...structuredClone(runtime.manifest.corpus),
            sourceCount: runtime.manifest.sources.length,
            revisionCount: revisions.length,
            readyRevisionCount: revisions.filter(
                (revision) => revision.state === "ready",
            ).length,
            failedRevisionCount: revisions.filter(
                (revision) => revision.state === "failed",
            ).length,
            activeJobCount,
            indexVersion: this.indexVersion(runtime.manifest),
        };
    }

    public async clearCorpus(corpusId: string): Promise<number> {
        await this.initialize();
        validateIdentifier("corpus ID", corpusId);
        await this.batchStore.purge(corpusId);
        this.viewBuilds.forget(corpusId);
        return this.enqueueWrite(corpusId, async () => {
            const runtime = await this.getCorpusRuntime(corpusId);
            await this.agentSessionStore.purge(corpusId);
            await this.viewStore.clearDerivedViews(corpusId);
            if (runtime.manifest.indexGeneration !== undefined) {
                await classifyIndexSchema(
                    this.indexDirectory(
                        corpusId,
                        runtime.manifest.indexGeneration,
                    ),
                    "documents",
                    false,
                );
            }
            const clearedCount = runtime.manifest.sources.length;
            const removedSources = structuredClone(runtime.manifest.sources);
            const indexGeneration = randomUUID();
            await mkdir(this.indexDirectory(corpusId, indexGeneration), {
                recursive: true,
            });
            const candidateIndex = this.createIndex(corpusId, indexGeneration);
            await candidateIndex.rebuild(
                [],
                new AbortController().signal,
                async () => {},
            );
            await stampIndexSchema(
                this.indexDirectory(corpusId, indexGeneration),
                "documents",
                false,
            );
            const timestamp = now();
            const candidateManifest: CorpusManifest = {
                corpus: {
                    ...runtime.manifest.corpus,
                    updatedAt: timestamp,
                    status: "ready",
                    documentCount: 0,
                },
                sources: [],
                indexGeneration,
                pendingCorpusClear: removedSources.map((source) => ({
                    sourceId: source.sourceId,
                    revisions: source.revisions.map((revision) => ({
                        revisionId: revision.revisionId,
                        hasAssets: !!revision.assets?.length,
                    })),
                })),
            };
            await this.writeManifest(corpusId, candidateManifest);
            runtime.manifest = candidateManifest;
            runtime.index = candidateIndex;
            await this.completeCorpusClear(corpusId, runtime);
            return clearedCount;
        });
    }

    private async completeCorpusClear(
        corpusId: string,
        runtime: CorpusRuntime,
    ): Promise<void> {
        const removedSources = runtime.manifest.pendingCorpusClear;
        const indexGeneration = runtime.manifest.indexGeneration;
        if (!removedSources || !indexGeneration)
            throw new Error(
                "Corpus clear lacks its durable purge intent or index generation",
            );
        const suppressions = this.collectEventSuppressions(
            runtime.eventSuppressions,
            runtime.events,
            {
                conversationIds: [
                    ...new Set(
                        runtime.events.flatMap((event) =>
                            event.conversationId === undefined
                                ? []
                                : [event.conversationId],
                        ),
                    ),
                ],
            },
        );
        await this.writeEvents(corpusId, [], suppressions);
        await this.rememberDocumentIndex(corpusId, runtime);
        runtime.events = [];
        runtime.eventIdempotency.clear();
        this.setEventSuppressions(runtime, suppressions);
        for (const source of removedSources) {
            for (const revision of source.revisions) {
                if (!revision.hasAssets) continue;
                await this.assetStore.removeRevision({
                    corpusId,
                    sourceId: source.sourceId,
                    revisionId: revision.revisionId,
                });
            }
        }
        for (const source of removedSources) {
            await this.viewStore.markSourceRevisionStale(
                corpusId,
                source.sourceId,
            );
        }
        await this.removeDerivedIndexRoot(
            this.eventIndexRoot(corpusId),
            "conversation-events",
        );
        await this.removeInactiveIndexGenerations(corpusId, indexGeneration);
        await this.textStore(corpusId).purge(runtime.manifest.sources);
        const complete = structuredClone(runtime.manifest);
        delete complete.pendingCorpusClear;
        await this.writeManifest(corpusId, complete);
        runtime.manifest = complete;
    }

    public async listSources(corpusId: string): Promise<MemorySource[]> {
        await this.initialize();
        validateIdentifier("corpus ID", corpusId);
        const runtime = await this.getCorpusRuntime(corpusId);
        return runtime.manifest.sources.map((source) =>
            this.toMemorySource(source),
        );
    }

    public async getRevisionAssets(
        request: RevisionAssetRequest,
    ): Promise<RevisionAssetDescriptor[]> {
        await this.initialize();
        validateIdentifier("corpus ID", request.corpusId);
        validateIdentifier("source ID", request.sourceId);
        validateIdentifier("revision ID", request.revisionId);
        const runtime = await this.getCorpusRuntime(request.corpusId);
        const source = runtime.manifest.sources.find(
            (item) => item.sourceId === request.sourceId,
        );
        const revision = source?.revisions.find(
            (item) => item.revisionId === request.revisionId,
        );
        if (!revision) throw new Error("Unknown retained source revision");
        return structuredClone(revision.assets ?? []);
    }

    public async readRevisionAsset(
        request: RevisionAssetReadRequest,
    ): Promise<{ descriptor: RevisionAssetDescriptor; bytes: Uint8Array }> {
        const descriptor = (await this.getRevisionAssets(request)).find(
            (asset) => asset.assetId === request.assetId,
        );
        if (!descriptor) throw new Error("Unknown retained revision asset");
        const runtime = await this.getCorpusRuntime(request.corpusId);
        return runtime.access.read(async () => ({
            descriptor,
            bytes: await this.assetStore.read(request, descriptor),
        }));
    }

    public async startBatchImport(
        request: MemoryBatchImportRequest,
    ): Promise<MemoryBatchImport> {
        await this.initialize();
        validateIdentifier("corpus ID", request.corpusId);
        await this.getCorpusRuntime(request.corpusId);
        return this.enqueueRootWrite(() => this.batchStore.start(request));
    }

    private async requireAgentSessionImports(corpusId: string): Promise<void> {
        await this.initialize();
        validateIdentifier("corpus ID", corpusId);
        if (!this.agentSessionImportsEnabled)
            throw new Error(
                "Agent session imports are explicitly disabled by this host",
            );
        await this.getCorpusRuntime(corpusId);
    }

    public async importAgentSession(
        request: AgentSessionImportRequest,
    ): Promise<AgentSessionImportReceipt> {
        await this.requireAgentSessionImports(request.corpusId);
        return this.enqueueWrite(request.corpusId, () =>
            this.agentSessionStore.import(request),
        );
    }

    public async getAgentSessionImport(
        request: AgentSessionReadRequest,
    ): Promise<AgentSessionImportReceipt | undefined> {
        await this.requireAgentSessionImports(request.corpusId);
        return this.agentSessionStore.get(request);
    }

    public async cancelAgentSessionImport(
        request: AgentSessionReadRequest,
    ): Promise<AgentSessionImportReceipt> {
        await this.requireAgentSessionImports(request.corpusId);
        return this.agentSessionStore.cancel(request);
    }

    public async searchAgentMemories(
        request: AgentMemorySearchRequest,
    ): Promise<AgentMemorySearchResult> {
        await this.requireAgentSessionImports(request.corpusId);
        return this.agentSessionStore.search(request);
    }

    public async getBatchImport(batchId: string): Promise<MemoryBatchImport> {
        await this.initialize();
        const batch = await this.batchStore.get(batchId);
        await this.getCorpusRuntime(batch.corpusId);
        return batch;
    }

    public async findBatchImport(
        request: MemoryBatchImportLookup,
    ): Promise<MemoryBatchImport | undefined> {
        await this.initialize();
        validateIdentifier("corpus ID", request.corpusId);
        await this.getCorpusRuntime(request.corpusId);
        return this.batchStore.find(request.corpusId, request.idempotencyKey);
    }

    public async listBatchImports(
        corpusId: string,
    ): Promise<MemoryBatchImport[]> {
        await this.initialize();
        validateIdentifier("corpus ID", corpusId);
        await this.getCorpusRuntime(corpusId);
        return this.batchStore.list(corpusId);
    }

    public async retryBatchImport(batchId: string): Promise<MemoryBatchImport> {
        await this.initialize();
        const batch = await this.getBatchImport(batchId);
        return this.enqueueRootWrite(async () => {
            await this.getCorpusRuntime(batch.corpusId);
            return this.batchStore.retry(batchId);
        });
    }

    public async cancelBatchImport(
        batchId: string,
    ): Promise<MemoryBatchImport> {
        await this.initialize();
        return this.batchStore.cancel(batchId);
    }

    public async listChanges(
        request: MemoryChangeListRequest,
    ): Promise<MemoryPage<MemoryChangeReceipt>> {
        await this.initialize();
        validateIdentifier("corpus ID", request.corpusId);
        return this.enqueueWrite(request.corpusId, async () => {
            const runtime = await this.getCorpusRuntime(request.corpusId);
            return pageChangeReceipts(runtime.manifest.changes ?? [], request);
        });
    }

    public async listSourcesPage(
        request: SourceListRequest,
    ): Promise<MemoryPage<MemorySource>> {
        const query = request.query?.trim().toLocaleLowerCase();
        const sourceTypes =
            request.sourceTypes === undefined
                ? undefined
                : new Set(request.sourceTypes);
        const sources = (await this.listSources(request.corpusId))
            .filter(
                (source) =>
                    (sourceTypes === undefined ||
                        sourceTypes.has(source.sourceType)) &&
                    (query === undefined ||
                        query.length === 0 ||
                        source.sourceId.toLocaleLowerCase().includes(query) ||
                        source.title.toLocaleLowerCase().includes(query) ||
                        source.canonicalUri
                            ?.toLocaleLowerCase()
                            .includes(query) === true ||
                        source.tags?.some((tag) =>
                            tag.toLocaleLowerCase().includes(query),
                        ) === true),
            )
            .sort((left, right) => left.sourceId.localeCompare(right.sourceId));
        return pageItems(sources, request.pageSize, request.continuationToken);
    }

    public async getSource(
        corpusId: string,
        sourceId: string,
    ): Promise<MemorySource | undefined> {
        await this.initialize();
        validateIdentifier("corpus ID", corpusId);
        validateIdentifier("source ID", sourceId);
        const runtime = await this.getCorpusRuntime(corpusId);
        const source = runtime.manifest.sources.find(
            (item) => item.sourceId === sourceId,
        );
        return source === undefined ? undefined : this.toMemorySource(source);
    }

    public async getSourceContent(
        request: SourceContentRequest,
    ): Promise<SourceContent> {
        await this.initialize();
        validateIdentifier("corpus ID", request.corpusId);
        validateIdentifier("source ID", request.sourceId);
        const runtime = await this.getCorpusRuntime(request.corpusId);
        if (request.indexedLocator !== undefined)
            return this.enqueueDocumentRead(
                request.corpusId,
                async (runtime) => {
                    const source = runtime.manifest.sources.find(
                        (item) => item.sourceId === request.sourceId,
                    );
                    const revisionId =
                        request.revisionId ?? source?.activeRevisionId;
                    if (
                        !source ||
                        !revisionId ||
                        source.activeRevisionId !== revisionId ||
                        !source.revisions.some(
                            (revision) =>
                                revision.revisionId === revisionId &&
                                revision.state === "ready",
                        )
                    )
                        throw new Error(
                            "Indexed source revision is unavailable or stale",
                        );
                    if (!runtime.index.resolveIndexedLocator)
                        throw new Error(
                            "Host does not support indexed-text citation resolution",
                        );
                    const content = await runtime.index.resolveIndexedLocator(
                        request.sourceId,
                        revisionId,
                        request.indexedLocator!,
                    );
                    return {
                        corpusId: request.corpusId,
                        sourceId: request.sourceId,
                        revisionId,
                        mimeType: "text/plain; anchor=indexed-text",
                        offset: 0,
                        content,
                        totalChars: content.length,
                        truncated: false,
                    };
                },
            );
        const source = runtime.manifest.sources.find(
            (item) => item.sourceId === request.sourceId,
        );
        if (source === undefined) {
            throw new Error(`Unknown source '${request.sourceId}'`);
        }

        const revisionId = request.revisionId ?? source.activeRevisionId;
        validateIdentifier("revision ID", revisionId);
        const revision = source.revisions.find(
            (item) => item.revisionId === revisionId,
        );
        if (revision === undefined) {
            throw new Error(`Unknown revision '${revisionId}'`);
        }
        const offset = request.offset ?? 0;
        const maxChars = Math.max(
            1,
            Math.min(request.maxChars ?? 20_000, 100_000),
        );
        if (
            !Number.isInteger(offset) ||
            offset < 0 ||
            offset > revision.content.length
        ) {
            throw new Error("Content offset is out of range");
        }
        const content = revision.content.slice(offset, offset + maxChars);
        const nextOffset = offset + content.length;
        return {
            corpusId: request.corpusId,
            sourceId: request.sourceId,
            revisionId,
            mimeType: revision.mimeType,
            offset,
            content,
            totalChars: revision.content.length,
            truncated: nextOffset < revision.content.length,
            ...(nextOffset < revision.content.length ? { nextOffset } : {}),
        };
    }

    public async getSourceSynopsis(
        request: SourceSynopsisRequest,
    ): Promise<SourceSynopsis> {
        await this.initialize();
        validateIdentifier("corpus ID", request.corpusId);
        validateIdentifier("source ID", request.sourceId);
        if (request.revisionId)
            validateIdentifier("revision ID", request.revisionId);
        if (!this.sourceSynopsesEnabled)
            throw new Error(
                "Source synopses are explicitly disabled by this host",
            );
        const runtime = await this.getCorpusRuntime(request.corpusId);
        return runtime.access.read(async () => {
            const source = runtime.manifest.sources.find(
                (item) => item.sourceId === request.sourceId,
            );
            const revision = source?.revisions.find(
                (item) =>
                    item.revisionId ===
                    (request.revisionId ?? source.activeRevisionId),
            );
            if (!source || !revision)
                throw new Error("Unknown retained source revision");
            if (
                !revision.synopsis ||
                runtime.manifest.knowledgeSuppressions?.some(
                    (entry) => entry.sourceId === source.sourceId,
                )
            )
                return this.emptySourceSynopsis(source, revision);
            const { attempts: _attempts, ...detail } = revision.synopsis;
            return {
                ...structuredClone(detail),
                freshness: this.synopsisFreshness(source, revision),
            };
        });
    }

    public async getSourceKnowledge(
        corpusId: string,
        sourceId: string,
        traceId?: string,
    ): Promise<MemoryKnowledgeGraph> {
        return runWithSearchTiming(traceId, "service.knowledge", () =>
            timeSearchStage("service.total", () =>
                this.readSourceKnowledge(corpusId, sourceId),
            ),
        );
    }

    private async readSourceKnowledge(
        corpusId: string,
        sourceId: string,
    ): Promise<MemoryKnowledgeGraph> {
        await this.initialize();
        validateIdentifier("corpus ID", corpusId);
        validateIdentifier("source ID", sourceId);
        return this.enqueueDocumentRead(corpusId, async (runtime) => {
            if (
                !runtime.manifest.sources.some(
                    (source) => source.sourceId === sourceId,
                )
            )
                throw new Error(`Unknown source '${sourceId}'`);
            const graph = await timeSearchStage(
                "knowledge.graph",
                () => runtime.index.getKnowledgeGraph(new Set([sourceId])),
                { corpusId },
            );
            return applyKnowledgeSuppressions(
                graph,
                runtime.manifest.knowledgeSuppressions ?? [],
                new Set([sourceId]),
            );
        });
    }

    public async listSourceKnowledgeSuppressions(
        corpusId: string,
        sourceId: string,
    ): Promise<SourceKnowledgeSuppression[]> {
        await this.initialize();
        const source = await this.getSource(corpusId, sourceId);
        if (source === undefined) {
            throw new Error(`Unknown source '${sourceId}'`);
        }
        const runtime = await this.getCorpusRuntime(corpusId);
        return structuredClone(
            (runtime.manifest.knowledgeSuppressions ?? [])
                .filter((item) => item.sourceId === sourceId)
                .sort(
                    (left, right) =>
                        left.kind.localeCompare(right.kind) ||
                        left.name.localeCompare(right.name),
                ),
        );
    }

    public async suppressSourceKnowledge(
        request: SourceKnowledgeSuppressionRequest,
    ): Promise<SourceKnowledgeSuppression[]> {
        return this.updateSourceKnowledgeSuppression(request, true);
    }

    public async restoreSourceKnowledge(
        request: SourceKnowledgeSuppressionRequest,
    ): Promise<SourceKnowledgeSuppression[]> {
        return this.updateSourceKnowledgeSuppression(request, false);
    }

    public async ingestDocument(
        request: DocumentIngestRequest,
        signal?: AbortSignal,
    ): Promise<DocumentIngestResult> {
        await this.initialize();
        validateIdentifier("corpus ID", request.corpusId);
        if (
            request.pipeline?.mode !== undefined &&
            request.pipeline.mode !== "content"
        ) {
            throw new Error("Pipeline mode must be 'content'");
        }
        if (
            request.pipeline?.maxCharsPerChunk !== undefined &&
            (!Number.isInteger(request.pipeline.maxCharsPerChunk) ||
                request.pipeline.maxCharsPerChunk <= 0)
        ) {
            throw new Error(
                "Pipeline maxCharsPerChunk must be a positive integer",
            );
        }
        const content = contentFor(request);
        const computedContentHash = hashContent(content);
        const contentHash = request.source.contentHash ?? computedContentHash;
        if (contentHash !== computedContentHash) {
            throw new Error("The supplied content hash does not match content");
        }
        const sourceId = request.source.sourceId ?? randomUUID();
        validateIdentifier("source ID", sourceId);
        const runtime = await this.getCorpusRuntime(request.corpusId, true);
        this.assertSourceIngestionAllowed(runtime, sourceId);
        validateAssetInputs(request.source.assets ?? []);
        const revisionId = revisionDigest(
            contentHash,
            request.source.assets ?? [],
        );
        request = structuredClone(request);
        const jobId = randomUUID();
        const timestamp = now();
        const job: IngestionJobStatus = {
            jobId,
            corpusId: request.corpusId,
            sourceId,
            revisionId,
            state: "accepted",
            progress: { completed: 0, total: 1, message: "Accepted" },
            createdAt: timestamp,
            updatedAt: timestamp,
            warnings: [],
        };
        await this.saveJob(job);
        const controller = new AbortController();
        this.controllers.set(jobId, controller);
        signal?.addEventListener(
            "abort",
            () => controller.abort(signal.reason),
            {
                once: true,
            },
        );
        if (signal?.aborted) controller.abort(signal.reason);
        const work = runWithSearchTiming(
            job.jobId,
            "memory.ingestion",
            () =>
                this.ingestionGroups.submit({
                    request,
                    content,
                    contentHash,
                    sourceId,
                    revisionId,
                    job,
                    signal: controller.signal,
                    execute: async () => {
                        const ingest = () =>
                            timeSearchStage("ingestion.total", () =>
                                this.processIngestion(
                                    request,
                                    content,
                                    contentHash,
                                    sourceId,
                                    revisionId,
                                    job,
                                    controller.signal,
                                ),
                            );
                        await (this.wikiBudget
                            ? runWithRequestBudget(
                                  new RequestBudget(this.wikiBudget),
                                  ingest,
                              )
                            : ingest());
                    },
                }),
            { corpusId: request.corpusId, sourceId, revisionId },
        )
            .catch(async (error: unknown) => {
                const forgotten =
                    this.jobs.get(jobId)?.progress.message ===
                    "Forgotten source; diagnostics removed";
                await this.updateJob(
                    job,
                    controller.signal.aborted ? "cancelled" : "failed",
                    {
                        completed: 0,
                        total: 1,
                        message: "Ingestion admission failed",
                    },
                    safeError(error),
                );
                if (forgotten) throw error;
            })
            .finally(() => this.controllers.delete(jobId));
        this.indexedReads.add(work);
        void work.then(
            () => this.indexedReads.delete(work),
            (error: unknown) => {
                this.indexedReads.delete(work);
                this.wikiMaintenanceFailures.set(
                    `${request.corpusId}:ingestion:${jobId}`,
                    new Error(safeError(error)),
                );
            },
        );
        return {
            jobId,
            sourceId,
            revisionId,
            state: "accepted",
            statusUri: `typeagent-memory://jobs/${jobId}`,
        };
    }

    public withIngestionGroup(operation: () => Promise<void>): Promise<void> {
        return this.ingestionGroups.run(operation);
    }

    private async dispatchIngestionGroup(
        entries: AcceptedIngestion[],
    ): Promise<void> {
        const corpusId = entries[0]!.request.corpusId;
        if (entries.some((entry) => entry.request.corpusId !== corpusId)) {
            await Promise.all(
                entries.map((entry) =>
                    this.enqueueIngestion(
                        entry.request.corpusId,
                        entry.execute,
                    ),
                ),
            );
            return;
        }
        await this.enqueueIngestion(corpusId, async () => {
            if (
                entries.length === 2 &&
                !this.wikiBudget &&
                (await this.processIngestionGroup(corpusId, entries))
            )
                return;
            for (const entry of entries) await entry.execute();
        });
    }

    public async replaceSource(
        request: SourceReplaceRequest,
        signal?: AbortSignal,
    ): Promise<DocumentIngestResult> {
        validateIdentifier("source ID", request.sourceId);
        validateIdentifier("revision ID", request.expectedActiveRevisionId);
        const source = await this.getSource(request.corpusId, request.sourceId);
        if (source === undefined) {
            throw new Error(`Unknown source '${request.sourceId}'`);
        }
        const activePipeline = source.revisions.find(
            (revision) => revision.revisionId === source.activeRevisionId,
        )?.pipeline;
        return this.ingestDocument(
            {
                corpusId: request.corpusId,
                source: { ...request.source, sourceId: request.sourceId },
                pipeline: {
                    ...activePipeline,
                    updatePolicy:
                        request.retainRevisionHistory === false
                            ? "replaceActiveRevision"
                            : "retainRevisionHistory",
                    expectedActiveRevisionId: request.expectedActiveRevisionId,
                },
            },
            signal,
        );
    }

    public async previewForgetSource(
        corpusId: string,
        sourceId: string,
    ): Promise<SourceForgetPreview> {
        await this.initialize();
        validateIdentifier("corpus ID", corpusId);
        validateIdentifier("source ID", sourceId);
        let preview: SourceForgetPreview | undefined;
        await this.enqueueWrite(corpusId, async () => {
            const runtime = await this.getCorpusRuntime(corpusId);
            const source = runtime.manifest.sources.find(
                (item) => item.sourceId === sourceId,
            );
            if (source === undefined) {
                throw new Error(`Unknown source '${sourceId}'`);
            }
            await this.ensureDocumentIndex(corpusId, runtime);
            const graph = await runtime.index.getKnowledgeGraph(
                new Set([sourceId]),
            );
            const confirmationToken = randomUUID();
            const expiresAt = new Date(Date.now() + 10 * 60_000).toISOString();
            const candidateManifest = structuredClone(runtime.manifest);
            candidateManifest.pendingSourceForget = {
                sourceId,
                activeRevisionId: source.activeRevisionId,
                confirmationToken,
                expiresAt,
            };
            await this.writeManifest(corpusId, candidateManifest);
            runtime.manifest = candidateManifest;
            preview = {
                corpusId,
                sourceId,
                activeRevisionId: source.activeRevisionId,
                revisionCount: source.revisions.length,
                derivedEntityCount: graph.entities.length,
                derivedTopicCount: graph.topics.length,
                derivedRelationshipCount: graph.relationships.length,
                confirmationToken,
                expiresAt,
            };
        });
        return preview!;
    }

    public async forgetSource(
        request: SourceForgetRequest,
    ): Promise<SourceForgetResult> {
        await this.initialize();
        validateIdentifier("corpus ID", request.corpusId);
        validateIdentifier("source ID", request.sourceId);
        const forgetRuntime = await this.getCorpusRuntime(request.corpusId);
        const pendingForget = forgetRuntime.manifest.pendingSourceForget;
        const forgetSource = forgetRuntime.manifest.sources.find(
            (source) => source.sourceId === request.sourceId,
        );
        if (
            pendingForget === undefined ||
            pendingForget.sourceId !== request.sourceId ||
            pendingForget.activeRevisionId !== forgetSource?.activeRevisionId ||
            pendingForget.confirmationToken !== request.confirmationToken
        )
            throw new Error("Invalid or stale source forget confirmation");
        if (Date.parse(pendingForget.expiresAt) <= Date.now())
            throw new Error("Source forget confirmation has expired");
        await this.enqueueWrite(request.corpusId, async () => {
            const runtime = await this.getCorpusRuntime(request.corpusId);
            const source = runtime.manifest.sources.find(
                (item) => item.sourceId === request.sourceId,
            );
            if (source === undefined) {
                throw new Error(`Unknown source '${request.sourceId}'`);
            }
            const confirmation = runtime.manifest.pendingSourceForget;
            if (
                confirmation === undefined ||
                confirmation.sourceId !== request.sourceId ||
                confirmation.activeRevisionId !== source.activeRevisionId ||
                confirmation.confirmationToken !== request.confirmationToken
            ) {
                throw new Error("Invalid or stale source forget confirmation");
            }
            if (Date.parse(confirmation.expiresAt) <= Date.now()) {
                throw new Error("Source forget confirmation has expired");
            }
            const candidateManifest = structuredClone(runtime.manifest);
            candidateManifest.authorizedSourceRemoval = {
                sourceId: source.sourceId,
                activeRevisionId: source.activeRevisionId,
                revisions: source.revisions.map((revision) => ({
                    revisionId: revision.revisionId,
                    hasAssets: !!revision.assets?.length,
                })),
            };
            delete candidateManifest.pendingSourceForget;
            await this.writeManifest(request.corpusId, candidateManifest);
            runtime.manifest = candidateManifest;
            this.viewBuilds.forget(request.corpusId, request.sourceId);
            this.controllers
                .get(`synopsis:${request.corpusId}:${request.sourceId}`)
                ?.abort(new ViewBuildStaleError("Source removal authorized"));
            for (const job of this.jobs.values()) {
                if (
                    job.corpusId !== request.corpusId ||
                    job.sourceId !== request.sourceId ||
                    ["complete", "partial", "failed", "cancelled"].includes(
                        job.state,
                    )
                )
                    continue;
                this.controllers
                    .get(job.jobId)
                    ?.abort(new Error("Source removal authorized"));
                await this.updateJob(job, "cancelled", {
                    completed: 0,
                    total: 1,
                    message: "Source removal authorized",
                });
            }
        });
        await this.batchStore.cancelSource(request.corpusId, request.sourceId);
        return this.enqueueWrite(
            request.corpusId,
            async () => {
                const runtime = await this.getCorpusRuntime(
                    request.corpusId,
                    true,
                );
                return this.completeAuthorizedSourceRemoval(
                    request.corpusId,
                    runtime,
                );
            },
            true,
        );
    }

    private async completeAuthorizedSourceRemoval(
        corpusId: string,
        runtime: CorpusRuntime,
    ): Promise<SourceForgetResult> {
        const removal = runtime.manifest.authorizedSourceRemoval;
        if (!removal)
            throw new Error("No authorized source removal to recover");
        const sourceId = removal.sourceId;
        this.viewBuilds.forget(corpusId, sourceId);
        const candidateManifest = structuredClone(runtime.manifest);
        const retained = candidateManifest.sources.some(
            (source) => source.sourceId === sourceId,
        );
        candidateManifest.sources = candidateManifest.sources.filter(
            (item) => item.sourceId !== sourceId,
        );
        if (candidateManifest.knowledgeSuppressions)
            candidateManifest.knowledgeSuppressions =
                candidateManifest.knowledgeSuppressions.filter(
                    (item) => item.sourceId !== sourceId,
                );
        const forgottenReference = opaqueChangeReference(
            corpusId,
            "source",
            sourceId,
        );
        candidateManifest.changes = pruneChangeReceipts(
            candidateManifest.changes,
        ).filter((receipt) => receipt.sourceId !== forgottenReference);
        if (
            !candidateManifest.changes.some(
                (receipt) =>
                    receipt.operation === "forget" &&
                    receipt.sourceId === forgottenReference,
            )
        )
            candidateManifest.changes.push(
                createChangeReceipt(corpusId, "forget", sourceId, {
                    sources: 1,
                    revisions: removal.revisions.length,
                    knowledge: 0,
                }),
            );
        await this.viewStore.forgetSource(corpusId, sourceId);
        await this.agentSessionStore.purge(corpusId, sourceId);
        if (retained) {
            await this.rebuildAndActivate(
                corpusId,
                runtime,
                candidateManifest,
                new AbortController().signal,
            );
        } else if (runtime.manifest.indexGeneration) {
            await this.removeInactiveIndexGenerations(
                corpusId,
                runtime.manifest.indexGeneration,
            );
        } else {
            throw new Error(
                "Authorized source removal lacks a committed source-index generation",
            );
        }
        for (const revision of removal.revisions) {
            if (!revision.hasAssets) continue;
            await this.assetStore.removeRevision({
                corpusId,
                sourceId,
                revisionId: revision.revisionId,
            });
        }
        await this.viewStore.markSourceRevisionStale(corpusId, sourceId);
        await this.batchStore.purge(corpusId, sourceId);
        await this.purgeSourceJobDiagnostics(corpusId, sourceId);
        await this.textStore(corpusId).purge(runtime.manifest.sources);
        for (const key of this.wikiMaintenanceFailures.keys())
            if (key.startsWith(`${corpusId}:`))
                this.wikiMaintenanceFailures.delete(key);
        const complete = structuredClone(runtime.manifest);
        delete complete.authorizedSourceRemoval;
        await this.writeManifest(corpusId, complete);
        runtime.manifest = complete;
        this.resumeBatchMaintenance(corpusId);
        return {
            corpusId,
            sourceId,
            deletedRevisionCount: removal.revisions.length,
            indexVersion: this.indexVersion(runtime.manifest),
        };
    }

    public async reindexCorpus(
        corpusId: string,
        signal: AbortSignal = new AbortController().signal,
    ): Promise<ReindexResult> {
        return this.reindex(corpusId, undefined, signal);
    }

    public async reindexSource(
        corpusId: string,
        sourceId: string,
        signal: AbortSignal = new AbortController().signal,
    ): Promise<ReindexResult> {
        validateIdentifier("source ID", sourceId);
        return this.reindex(corpusId, sourceId, signal);
    }

    public async getJob(
        jobId: string,
    ): Promise<IngestionJobStatus | undefined> {
        await this.initialize();
        validateIdentifier("job ID", jobId);
        const job =
            this.jobs.get(jobId) ??
            (await readJson<IngestionJobStatus>(this.jobPath(jobId)));
        if (!job) return undefined;
        return this.sourceJobRead(job);
    }

    public async listJobs(
        request: JobListRequest = {},
    ): Promise<MemoryPage<IngestionJobStatus>> {
        await this.initialize();
        if (request.corpusId !== undefined) {
            validateIdentifier("corpus ID", request.corpusId);
        }
        if (request.sourceId !== undefined) {
            validateIdentifier("source ID", request.sourceId);
        }
        let entries: string[];
        try {
            entries = await readdir(
                path.join(this.rootDirectory, jobsDirectoryName),
            );
        } catch (error) {
            if ((error as NodeJS.ErrnoException).code === "ENOENT") {
                entries = [];
            } else {
                throw error;
            }
        }
        const jobs = (
            await Promise.all(
                entries
                    .filter((entry) => entry.endsWith(".json"))
                    .map((entry) =>
                        readJson<IngestionJobStatus>(
                            path.join(
                                this.rootDirectory,
                                jobsDirectoryName,
                                entry,
                            ),
                        ),
                    ),
            )
        )
            .filter((job): job is IngestionJobStatus => job !== undefined)
            .filter(
                (job) =>
                    (request.corpusId === undefined ||
                        job.corpusId === request.corpusId) &&
                    (request.sourceId === undefined ||
                        job.sourceId === request.sourceId) &&
                    (request.states === undefined ||
                        request.states.includes(job.state)),
            )
            .sort(
                (left, right) =>
                    right.createdAt.localeCompare(left.createdAt) ||
                    right.jobId.localeCompare(left.jobId),
            );
        return pageItems(
            jobs.map((job) => this.sourceJobRead(job)),
            request.pageSize,
            request.continuationToken,
        );
    }

    private sourceJobRead(job: IngestionJobStatus): IngestionJobStatus {
        const removal = this.corpora.get(job.corpusId)?.manifest
            .authorizedSourceRemoval;
        return removal?.sourceId === job.sourceId
            ? this.withoutSourceJobDiagnostics(job)
            : structuredClone(job);
    }

    private withoutSourceJobDiagnostics(
        job: IngestionJobStatus,
    ): IngestionJobStatus {
        const sanitized = structuredClone(job);
        sanitized.progress.message = "Forgotten source; diagnostics removed";
        sanitized.warnings = [];
        delete sanitized.error;
        delete sanitized.trace;
        return sanitized;
    }

    private async purgeSourceJobDiagnostics(
        corpusId: string,
        sourceId: string,
    ): Promise<void> {
        const directory = path.join(this.rootDirectory, jobsDirectoryName);
        let entries: string[];
        try {
            entries = await readdir(directory);
        } catch (error) {
            if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
            throw error;
        }
        for (const entry of entries.filter((name) => name.endsWith(".json"))) {
            const job = await readJson<IngestionJobStatus>(
                path.join(directory, entry),
            );
            if (job?.corpusId !== corpusId || job.sourceId !== sourceId)
                continue;
            await this.serializeJobWrite(job.jobId, async () => {
                const sanitized = this.withoutSourceJobDiagnostics(
                    this.jobs.get(job.jobId) ?? job,
                );
                await writeJsonAtomic(this.jobPath(job.jobId), sanitized);
                this.jobs.set(job.jobId, sanitized);
            });
        }
    }

    public async cancelJob(
        jobId: string,
    ): Promise<IngestionJobStatus | undefined> {
        await this.initialize();
        const job = await this.getJob(jobId);
        if (job === undefined) {
            return undefined;
        }
        if (
            ["complete", "partial", "failed", "cancelled"].includes(job.state)
        ) {
            return job;
        }
        await this.updateJob(job, "cancelling", {
            ...job.progress,
            message: "Cancellation requested",
        });
        this.controllers.get(jobId)?.abort(new Error("Ingestion cancelled"));
        return structuredClone(job);
    }

    public async appendEvent(
        request: MemoryEventAppendRequest,
    ): Promise<MemoryEventAppendResult> {
        await this.initialize();
        this.validateEventAppendRequest(request);
        let result: MemoryEventAppendResult | undefined;
        await this.enqueueWrite(request.corpusId, async () => {
            const runtime = await this.getCorpusRuntime(request.corpusId);
            const key = eventIdempotencyKey(request);
            const existing = runtime.eventIdempotency.get(key);
            if (existing !== undefined) {
                result = {
                    event: structuredClone(existing),
                    replayed: true,
                };
                return;
            }
            if (
                runtime.suppressedEventKeys.has(key) ||
                (request.conversationId !== undefined &&
                    (runtime.suppressedConversations.has(
                        suppressedConversationKey(
                            request.conversationId,
                            request.sourceKind,
                        ),
                    ) ||
                        runtime.suppressedConversations.has(
                            suppressedConversationKey(request.conversationId),
                        ))) ||
                isSuppressedTurn(runtime, request)
            ) {
                throw new ForgottenEventError();
            }
            const linkedSourceIds = [...new Set(request.linkedSourceIds ?? [])];
            for (const sourceId of linkedSourceIds) {
                if (
                    !runtime.manifest.sources.some(
                        (source) => source.sourceId === sourceId,
                    )
                ) {
                    throw new Error(`Unknown linked source '${sourceId}'`);
                }
            }
            const timestamp = now();
            const observedAt = request.observedAt ?? timestamp;
            const event: MemoryEvent = {
                eventId: randomUUID(),
                corpusId: request.corpusId,
                idempotencyKey: request.idempotencyKey,
                producer: structuredClone(request.producer),
                eventType: request.eventType,
                sourceKind: request.sourceKind,
                observedAt,
                eventTime: request.eventTime ?? observedAt,
                createdAt: timestamp,
                ...(request.content === undefined
                    ? {}
                    : { content: request.content }),
                ...(request.conversationId === undefined
                    ? {}
                    : { conversationId: request.conversationId }),
                ...(request.runId === undefined
                    ? {}
                    : { runId: request.runId }),
                ...(request.turnId === undefined
                    ? {}
                    : { turnId: request.turnId }),
                ...(request.sender === undefined
                    ? {}
                    : { sender: request.sender }),
                ...(request.actionName === undefined
                    ? {}
                    : { actionName: request.actionName }),
                ...(linkedSourceIds.length === 0 ? {} : { linkedSourceIds }),
                ...(request.metadata === undefined
                    ? {}
                    : { metadata: structuredClone(request.metadata) }),
            };
            await this.eventStore(request.corpusId).append(event);
            runtime.events.push(event);
            runtime.eventIdempotency.set(key, event);
            result = { event: structuredClone(event), replayed: false };
        });
        return result!;
    }

    public async getEvent(
        corpusId: string,
        eventId: string,
    ): Promise<MemoryEvent | undefined> {
        await this.initialize();
        validateIdentifier("corpus ID", corpusId);
        validateIdentifier("event ID", eventId);
        return this.corpusAccess(corpusId).read(async () => {
            const manifest =
                this.corpora.get(corpusId)?.manifest ??
                (await this.readSerializedManifest(corpusId));
            if (!manifest) throw new Error(`Unknown corpus '${corpusId}'`);
            this.assertRemovalComplete({ manifest });
            const store = this.eventStore(corpusId);
            const event = await store.get(eventId);
            if (!event) return undefined;
            this.validateStoredEvent(event, corpusId);
            let suppressionState: EventSuppressionState | undefined =
                this.corpora.get(corpusId);
            if (!suppressionState) {
                const suppressions = await store.suppressions();
                for (const record of suppressions)
                    this.validateStoredEventSuppression(record);
                suppressionState = {
                    eventSuppressions: [],
                    suppressedEventKeys: new Set(),
                    suppressedConversations: new Set(),
                    suppressedTurns: new Set(),
                };
                this.setEventSuppressions(suppressionState, suppressions);
            }
            return isSuppressedEvent(suppressionState, event)
                ? undefined
                : event;
        });
    }

    public async listEvents(
        request: MemoryEventListRequest,
    ): Promise<MemoryPage<MemoryEvent>> {
        await this.initialize();
        this.validateEventFilterRequest(request);
        const runtime = await this.getCorpusRuntime(request.corpusId);
        const events = [...runtime.events]
            .filter(
                (event) =>
                    !isSuppressedEvent(runtime, event) &&
                    matchesEventFilter(event, request),
            )
            .sort(
                (left, right) =>
                    Date.parse(right.observedAt) -
                        Date.parse(left.observedAt) ||
                    right.eventId.localeCompare(left.eventId),
            )
            .map((event) => structuredClone(event));
        return pageItems(events, request.pageSize, request.continuationToken);
    }

    public async searchEvents(
        request: MemoryEventSearchRequest,
    ): Promise<MemoryEventSearchResult> {
        return runWithSearchTiming(request.traceId, "service.events", () =>
            timeSearchStage("service.total", () =>
                this.searchEventIndex(request),
            ),
        );
    }

    private async searchEventIndex(
        request: MemoryEventSearchRequest,
    ): Promise<MemoryEventSearchResult> {
        await this.initialize();
        this.validateEventFilterRequest(request);
        const query = request.query.trim();
        if (query.length === 0) {
            throw new Error("Event search query must not be empty");
        }
        const limit = Math.max(1, Math.min(request.limit ?? 20, 100));
        return this.enqueueWrite(request.corpusId, async () => {
            const runtime = await this.getCorpusRuntime(request.corpusId);
            const eligible = runtime.events.filter(
                (event) =>
                    !isSuppressedEvent(runtime, event) &&
                    matchesEventFilter(event, request),
            );
            if (eligible.length === 0) {
                await this.purgeObsoleteEventIndex(request.corpusId, runtime);
                return { query: request.query, matches: [] };
            }
            const index = await this.getEventIndex(request.corpusId, runtime);
            const eligibleById = new Map(
                eligible.map((event) => [event.eventId, event]),
            );
            const tags =
                eligible.length === runtime.events.length
                    ? undefined
                    : eligible.map((event) => `event-id:${event.eventId}`);
            const matches: MemoryEventSearchResult["matches"] = [];
            const seen = new Set<string>();
            for (const match of await index.search(query, limit * 4, tags)) {
                const event = eligibleById.get(match.sourceId);
                if (event === undefined) {
                    throw new Error(
                        `Event index returned an out-of-scope event '${match.sourceId}'`,
                    );
                }
                if (!seen.has(event.eventId)) {
                    seen.add(event.eventId);
                    matches.push({
                        event: structuredClone(event),
                        snippet: match.snippet,
                        score: match.score,
                    });
                }
                if (matches.length === limit) {
                    break;
                }
            }
            return { query: request.query, matches };
        });
    }

    public async forgetEvents(
        request: MemoryEventForgetRequest,
    ): Promise<MemoryEventForgetResult> {
        await this.initialize();
        this.validateEventFilterRequest(request);
        const eventIds = request.eventIds ?? [];
        for (const eventId of eventIds) {
            validateIdentifier("event ID", eventId);
        }
        if (
            eventIds.length === 0 &&
            request.sourceKinds === undefined &&
            request.authorities === undefined &&
            request.producerIds === undefined &&
            request.eventTypes === undefined &&
            request.conversationIds === undefined &&
            request.turnIds === undefined &&
            request.runIds === undefined &&
            request.linkedSourceIds === undefined &&
            request.observedFrom === undefined &&
            request.observedTo === undefined &&
            request.eventFrom === undefined &&
            request.eventTo === undefined
        ) {
            throw new Error("At least one event forget selector is required");
        }
        let result: MemoryEventForgetResult | undefined;
        await this.enqueueWrite(request.corpusId, async () => {
            const runtime = await this.getCorpusRuntime(request.corpusId);
            const deleted = runtime.events.filter(
                (event) =>
                    (eventIds.length === 0 ||
                        eventIds.includes(event.eventId)) &&
                    matchesEventFilter(event, request),
            );
            const deletedIds = new Set(deleted.map((event) => event.eventId));
            for (const event of deleted) {
                this.viewBuilds.forgetEvent(request.corpusId, event.eventId);
            }
            await this.viewStore.forgetEvents(request.corpusId, [
                ...deletedIds,
            ]);
            const remaining = runtime.events.filter(
                (event) => !deletedIds.has(event.eventId),
            );
            const suppressions = this.collectEventSuppressions(
                runtime.eventSuppressions,
                deleted,
                request,
            );
            const linkedSourceIds = [
                ...new Set(
                    deleted.flatMap((event) => event.linkedSourceIds ?? []),
                ),
            ];
            const retainedLinkIds = new Set(
                remaining.flatMap((event) => event.linkedSourceIds ?? []),
            );
            const deletableSourceIds =
                request.forgetLinkedSources === true
                    ? linkedSourceIds.filter(
                          (sourceId) =>
                              !retainedLinkIds.has(sourceId) &&
                              runtime.manifest.sources.some(
                                  (source) => source.sourceId === sourceId,
                              ),
                      )
                    : [];
            if (deletableSourceIds.length > 0) {
                for (const sourceId of deletableSourceIds) {
                    this.viewBuilds.forget(request.corpusId, sourceId);
                    await this.viewStore.forgetSource(
                        request.corpusId,
                        sourceId,
                    );
                }
                const sourceIds = new Set(deletableSourceIds);
                const candidateManifest = structuredClone(runtime.manifest);
                candidateManifest.sources = candidateManifest.sources.filter(
                    (source) => !sourceIds.has(source.sourceId),
                );
                await this.rebuildAndActivate(
                    request.corpusId,
                    runtime,
                    candidateManifest,
                    new AbortController().signal,
                );
            }
            if (
                deleted.length > 0 ||
                suppressions.length > runtime.eventSuppressions.length
            ) {
                await this.writeEvents(
                    request.corpusId,
                    remaining,
                    suppressions,
                );
            }
            runtime.events = remaining;
            runtime.eventIdempotency = new Map(
                remaining.map((event) => [eventIdempotencyKey(event), event]),
            );
            this.setEventSuppressions(runtime, suppressions);
            if (deleted.length > 0) {
                await this.removeDerivedIndexRoot(
                    this.eventIndexRoot(request.corpusId),
                    "conversation-events",
                );
            }
            result = {
                corpusId: request.corpusId,
                deletedEventCount: deleted.length,
                deletedSourceCount: deletableSourceIds.length,
                retainedLinkedSourceIds: linkedSourceIds.filter(
                    (sourceId) => !deletableSourceIds.includes(sourceId),
                ),
                indexVersion: this.indexVersion(runtime.manifest),
            };
        });
        return result!;
    }

    public async search(
        request: MemorySearchRequest,
    ): Promise<MemorySearchResult> {
        return runWithSearchTiming(request.traceId, "service.documents", () =>
            timeSearchStage("service.total", () =>
                this.searchDocuments(request),
            ),
        );
    }

    private async searchDocuments(
        request: MemorySearchRequest,
    ): Promise<MemorySearchResult> {
        await this.initialize();
        validateIdentifier("corpus ID", request.corpusId);
        validateSearchDateRange(request);
        const query = request.query.trim();
        if (query.length === 0) {
            throw new Error("Search query cannot be empty");
        }
        return this.enqueueDocumentRead(request.corpusId, async (runtime) => {
            const limit = Math.max(1, Math.min(request.limit ?? 10, 100));
            let candidates: CorpusIndexMatch[] = request.indexedFragments
                ? []
                : await runtime.index.search(query, limit * 4);
            let fragmentLimited = false;
            if (request.indexedFragments) {
                if (!runtime.index.readFragments)
                    throw new Error(
                        "This index does not support bounded indexed fragments",
                    );
                const nominated = runtime.manifest.sources
                    .filter(
                        (source) =>
                            (!request.sourceIds ||
                                request.sourceIds.includes(source.sourceId)) &&
                            (!request.sourceTypes ||
                                request.sourceTypes.includes(
                                    source.sourceType,
                                )) &&
                            (request.tags ?? []).every((tag) =>
                                source.tags?.includes(tag),
                            ) &&
                            source.revisions.some(
                                (revision) =>
                                    revision.revisionId ===
                                        source.activeRevisionId &&
                                    revision.state === "ready" &&
                                    matchesSearchDate(revision, request),
                            ),
                    )
                    .slice(-32);
                const selection = await runtime.index.readFragments({
                    query,
                    terms: [
                        ...new Set(
                            query
                                .toLowerCase()
                                .match(/[\p{L}\p{N}][\p{L}\p{N}-]*/gu) ?? [
                                query.slice(0, 200),
                            ],
                        ),
                    ]
                        .filter(
                            (term) =>
                                term.length <= 200 &&
                                !new Set([
                                    "what",
                                    "which",
                                    "does",
                                    "about",
                                    "with",
                                    "from",
                                    "have",
                                    "that",
                                    "this",
                                    "their",
                                    "were",
                                    "when",
                                    "where",
                                    "should",
                                    "would",
                                    "could",
                                    "how",
                                    "why",
                                    "the",
                                    "and",
                                    "for",
                                    "are",
                                    "can",
                                    "was",
                                    "not",
                                    "did",
                                    "its",
                                    "is",
                                    "to",
                                    "of",
                                    "in",
                                    "a",
                                    "an",
                                ]).has(term),
                        )
                        .slice(0, 8),
                    sourceIds: nominated.map((item) => item.sourceId),
                });
                candidates = selection.fragments;
                fragmentLimited = fragmentLimited || selection.limited;
            }
            const matches = this.toEvidence(
                request.corpusId,
                runtime,
                candidates,
                request,
                limit,
            );
            return {
                query,
                matches,
                warnings: [
                    ...this.capabilities.warnings,
                    ...(fragmentLimited
                        ? [
                              "Limited indexed selection: bounded subranges may omit context; open sources for more detail.",
                          ]
                        : []),
                    ...(request.dateFrom === undefined &&
                    request.dateTo === undefined
                        ? []
                        : [
                              `Date predicates filter at most ${limit * 4} ranked index candidates; additional matching evidence may be omitted. Results are not complete totals.`,
                          ]),
                ],
                capabilitiesUsed: ["structured-search"],
                indexVersion: this.indexVersion(runtime.manifest),
            };
        });
    }

    private toEvidence(
        corpusId: string,
        runtime: CorpusRuntime,
        candidates: CorpusIndexMatch[],
        request: Pick<
            MemorySearchRequest,
            | "sourceIds"
            | "sourceTypes"
            | "tags"
            | "maxResponseChars"
            | "dateFrom"
            | "dateTo"
        >,
        limit: number,
    ): MemoryEvidence[] {
        const sourceIds =
            request.sourceIds === undefined
                ? undefined
                : new Set(request.sourceIds);
        const sourceTypes =
            request.sourceTypes === undefined
                ? undefined
                : new Set(request.sourceTypes);
        const requestedTags = request.tags ?? [];
        let usedCharacters = 0;
        const maxCharacters = request.maxResponseChars ?? 50_000;
        const matches: MemoryEvidence[] = [];
        for (const candidate of candidates) {
            const source = runtime.manifest.sources.find(
                (item) => item.sourceId === candidate.sourceId,
            );
            const revision = source?.revisions.find(
                (item) => item.revisionId === candidate.revisionId,
            );
            if (
                source === undefined ||
                revision === undefined ||
                source.activeRevisionId !== revision.revisionId ||
                !matchesSearchDate(revision, request) ||
                (sourceIds !== undefined && !sourceIds.has(source.sourceId)) ||
                (sourceTypes !== undefined &&
                    !sourceTypes.has(source.sourceType)) ||
                requestedTags.some((tag) => !source.tags?.includes(tag))
            ) {
                continue;
            }
            if (usedCharacters + candidate.snippet.length > maxCharacters) {
                break;
            }
            usedCharacters += candidate.snippet.length;
            matches.push({
                evidenceId: `${candidate.sourceId}:${candidate.revisionId}:${candidate.locator ?? matches.length}`,
                corpusId,
                sourceId: candidate.sourceId,
                revisionId: candidate.revisionId,
                title: source.title,
                ...(this.sourceSynopsesEnabled
                    ? { synopsis: this.sourceSynopsisPreview(source, revision) }
                    : {}),
                ...(source.canonicalUri === undefined
                    ? {}
                    : { canonicalUri: source.canonicalUri }),
                ...(candidate.locator === undefined
                    ? {}
                    : { locator: candidate.locator }),
                snippet: candidate.snippet,
                score: candidate.score,
                sourceType: source.sourceType,
                ...(revision.capturedAt === undefined
                    ? {}
                    : { capturedAt: revision.capturedAt }),
                indexedAt:
                    revision.indexedAt ?? revision.sourceModifiedAt ?? now(),
            });
            if (matches.length === limit) {
                break;
            }
        }
        return matches;
    }

    public async getCapabilities(): Promise<MemoryServiceCapabilities> {
        await this.initialize();
        const capabilities = structuredClone(this.capabilities);
        delete capabilities.derivedViews;
        return {
            ...capabilities,
            features: {
                ...capabilities.features,
                sourceSynopses: this.sourceSynopsesEnabled,
                agentSessionImportTypes: this.agentSessionImportsEnabled
                    ? ["agent-session-jsonl", "copilot-session-jsonl"]
                    : [],
            },
            ...(this.viewDrafts
                ? {
                      derivedViews: {
                          builds: true as const,
                          editMerging: true as const,
                          maintenance: true as const,
                          ...(this.informationalWikiEnabled
                              ? {
                                    informationalWiki: true as const,
                                    informationalProjects: true as const,
                                }
                              : {}),
                          kinds: [
                              "troubleshootingGuide",
                              "projectBrief",
                              "timeline",
                              "wiki",
                          ] as Array<
                              | "troubleshootingGuide"
                              | "projectBrief"
                              | "timeline"
                              | "wiki"
                          >,
                          drafts: true as const,
                          history: true as const,
                          publication: true as const,
                          search: true as const,
                      },
                  }
                : {}),
        };
    }

    private async requireViews(corpusId: string): Promise<CorpusRuntime> {
        if (!this.viewDrafts)
            throw new Error(
                "Memory Views are not supported: explicitly disabled by this host",
            );
        await this.initialize();
        validateIdentifier("corpus ID", corpusId);
        return this.getCorpusRuntime(corpusId);
    }

    public async listViews(corpusId: string): Promise<ViewSnapshot> {
        const runtime = await this.requireViews(corpusId);
        return runtime.access.read(() =>
            this.viewStore.withReadSnapshot(corpusId, () =>
                this.listViewSnapshot(corpusId),
            ),
        );
    }

    private async listViewSnapshot(corpusId: string): Promise<ViewSnapshot> {
        const snapshot = await this.viewStore.listViews(corpusId);
        const eligible = await Promise.all(
            snapshot.views.map((view) =>
                this.informationalVersionEligible(view, view),
            ),
        );
        const views = snapshot.views.filter((_, index) => eligible[index]);
        return {
            ...snapshot,
            views: views.map((view) => {
                return {
                    ...view,
                    ...(view.generation && editorialArticle(view.content)
                        ? {
                              relatedArticles: relatedEditorialArticles(
                                  view,
                                  views,
                              ),
                              protectedTargets: editorialProtection(view),
                          }
                        : {}),
                };
            }),
            ...(this.informationalWikiEnabled
                ? {
                      wikiFamily: await this.wikiFamilyStatus(
                          corpusId,
                          "wiki",
                          views,
                      ),
                      projectFamily: await this.wikiFamilyStatus(
                          corpusId,
                          "projects",
                          views,
                      ),
                  }
                : {}),
        };
    }

    private async readConsolidationPairs(
        corpusId: string,
        targetId: string,
    ): Promise<Array<[ViewVersion, ViewVersion]>> {
        const runtime = await this.requireViews(corpusId);
        return runtime.access.read(() =>
            this.viewStore.withReadSnapshot(corpusId, () =>
                this.consolidationPairs(corpusId, targetId),
            ),
        );
    }

    private async wikiFamilyStatus(
        corpusId: string,
        kind: "wiki" | "projects",
        currentViews: ViewVersion[],
    ): Promise<NonNullable<ViewSnapshot["wikiFamily"]>> {
        const family = await this.viewStore.getWikiFamily(corpusId, kind);
        const jobs = await this.viewStore.listViewBuilds(corpusId);
        const active = jobs.some(
            (job) =>
                job.state === "running" &&
                job.results.some(
                    (result) =>
                        result.snapshot.pipeline ===
                        (kind === "wiki"
                            ? "informational-wiki-v1"
                            : "informational-project-summary-v1"),
                ),
        );
        const latest = new Map<string, ViewBuildTargetResult>();
        for (const job of jobs.sort((a, b) =>
            b.updatedAt.localeCompare(a.updatedAt),
        ))
            for (const result of job.results)
                if (
                    result.snapshot.pipeline ===
                        (kind === "wiki"
                            ? "informational-wiki-v1"
                            : "informational-project-summary-v1") &&
                    !latest.has(result.viewId)
                )
                    latest.set(result.viewId, result);
        const parked = [];
        let resolvedIndexPending = false;
        for (const result of latest.values()) {
            if (
                ![
                    "blocked",
                    "conflicted",
                    "failed",
                    "interrupted",
                    "cancelled",
                    "stale",
                ].includes(result.state)
            )
                continue;
            const resolution = await this.familyConflictResolution(
                corpusId,
                result,
                jobs.find((job) => job.results.includes(result))!.jobId,
                currentViews,
            );
            if (resolution === "ready") continue;
            if (resolution === "indexPending") resolvedIndexPending = true;
            parked.push({ result, resolution });
        }
        const decisions = parked.filter(
            ({ result, resolution }) =>
                (result.state === "conflicted" &&
                    resolution !== "indexPending") ||
                result.wikiAssessment?.disposition === "ambiguous",
        ).length;
        const error =
            family.error ??
            (parked.length
                ? `${parked.length - decisions} technical targets parked; ${decisions} user decisions pending; independent maintenance continues`
                : undefined);
        return {
            enabled: family.enabled,
            pending:
                family.dirty ||
                active ||
                resolvedIndexPending ||
                decisions > 0 ||
                !!family.error?.startsWith("User decision required:"),
            ...(error ? { error } : {}),
        };
    }

    private async familyConflictResolution(
        corpusId: string,
        result: ViewBuildTargetResult,
        jobId: string,
        currentViews: ViewVersion[],
    ): Promise<"unresolved" | "ready" | "indexPending"> {
        if (
            result.state !== "conflicted" ||
            !result.conflictId ||
            result.wikiAssessment?.disposition === "ambiguous"
        )
            return "unresolved";
        const conflict = await this.viewStore.getViewConflict(
            corpusId,
            result.conflictId,
        );
        if (
            !conflict ||
            conflict.state !== "resolved" ||
            conflict.conflictId !== result.conflictId ||
            conflict.corpusId !== corpusId ||
            conflict.viewId !== result.viewId ||
            conflict.jobId !== jobId ||
            conflict.human.viewId !== result.viewId ||
            conflict.human.revisionId !== conflict.expectedRevisionId ||
            conflict.input.fingerprint !== result.snapshot.fingerprint ||
            !sameViewBuildEvidence(conflict.input, result.snapshot)
        )
            return "unresolved";
        const current = await this.familyResolutionVersion(
            conflict,
            currentViews,
        );
        if (!current) return "unresolved";
        const publication = await this.viewStore.getViewPublication({
            corpusId,
            viewId: current.viewId,
        });
        if (
            publication.viewId !== current.viewId ||
            publication.publishedRevisionId !== current.revisionId ||
            publication.blockedReason
        )
            return "unresolved";
        return publication.indexState === "ready" &&
            publication.indexedRevisionId === current.revisionId
            ? "ready"
            : "indexPending";
    }

    private async familyResolutionVersion(
        conflict: ViewMergeConflict,
        currentViews: ViewVersion[],
    ): Promise<ViewVersion | undefined> {
        const current = currentViews.find(
            (view) => view.viewId === conflict.viewId,
        );
        if (
            !conflict.resolutionRevisionId ||
            !current ||
            current.provenance !== "human" ||
            !current.generation?.input ||
            current.generation.input.fingerprint !==
                conflict.input.fingerprint ||
            !sameViewBuildEvidence(current.generation.input, conflict.input)
        )
            return undefined;
        if (current.revisionId === conflict.resolutionRevisionId)
            return current;
        const versions = await this.viewStore.getViewVersions({
            corpusId: conflict.corpusId,
            viewId: conflict.viewId,
        });
        const lineage = versions
            .filter((version) => version.version <= current.version)
            .sort((left, right) => left.version - right.version);
        const start = lineage.findIndex(
            (version) => version.revisionId === conflict.resolutionRevisionId,
        );
        if (start < 0 || lineage.at(-1)?.revisionId !== current.revisionId)
            return undefined;
        const resolution = lineage[start];
        if (
            resolution.baseRevisionId !== conflict.expectedRevisionId ||
            resolution.version !== conflict.human.version + 1 ||
            viewHash(resolution.generation?.content) !==
                viewHash(conflict.candidate.content) ||
            viewHash(resolution.generation?.relationships) !==
                viewHash(conflict.candidate.relationships)
        )
            return undefined;
        for (let index = start + 1; index < lineage.length; index++)
            if (
                !isEditorialUnlockSuccessor(
                    lineage[index - 1],
                    lineage[index],
                    conflict.targets,
                )
            )
                return undefined;
        return current;
    }

    private async informationalVersionEligible(
        view: ViewVersion,
        current?: ViewVersion,
    ): Promise<boolean> {
        if (!informationalWiki(view.content)) return true;
        if (view.state !== "draft") return false;
        try {
            await this.assertViewPublicationFresh(view, current);
            return true;
        } catch (error) {
            if (error instanceof ViewBuildStaleError) return false;
            throw error;
        }
    }

    public async getSourceViewUsage(
        request: ViewSourceUsageRequest,
    ): Promise<ViewSourceUsagePage> {
        if (
            !request ||
            Object.keys(request).some(
                (key) =>
                    ![
                        "corpusId",
                        "sourceId",
                        "pageSize",
                        "continuationToken",
                    ].includes(key),
            )
        )
            throw new Error("Unsupported source View usage request");
        validateIdentifier("source ID", request.sourceId);
        if (
            request.pageSize !== undefined &&
            (!Number.isInteger(request.pageSize) ||
                request.pageSize < 1 ||
                request.pageSize > 200)
        )
            throw new Error(
                "View usage pageSize must be an integer from 1 to 200",
            );
        if (
            request.continuationToken !== undefined &&
            typeof request.continuationToken !== "string"
        )
            throw new Error("Invalid continuation token");
        const offset = pageOffset(request.continuationToken);
        if (!Number.isSafeInteger(offset))
            throw new Error("Invalid continuation token");
        const runtime = await this.requireViews(request.corpusId);
        return runtime.access.read(async () => {
            if (
                !runtime.manifest.sources.some(
                    (source) => source.sourceId === request.sourceId,
                )
            )
                throw new Error(`Source '${request.sourceId}' does not exist`);
            const items = await this.viewStore.sourceUsage(
                request.corpusId,
                request.sourceId,
            );
            return pageItems(
                items,
                request.pageSize,
                request.continuationToken,
            );
        });
    }

    public async getView(
        request: ViewReadRequest,
    ): Promise<ViewVersion | undefined> {
        const runtime = await this.requireViews(request.corpusId);
        return runtime.access.read(async () => {
            const view = await this.viewStore.getView(request);
            if (view?.redirect)
                return this.readWikiRedirect(
                    view,
                    request.revisionId !== undefined,
                );
            if (view && !(await this.informationalVersionEligible(view)))
                return undefined;
            if (view?.generation && editorialArticle(view.content)) {
                const snapshot = await this.viewStore.listViews(
                    request.corpusId,
                );
                const eligible = await Promise.all(
                    snapshot.views.map((entry) =>
                        this.informationalVersionEligible(entry, entry),
                    ),
                );
                return {
                    ...view,
                    protectedTargets: editorialProtection(view),
                    relatedArticles: relatedEditorialArticles(
                        view,
                        snapshot.views.filter((_, index) => eligible[index]),
                    ),
                };
            }
            return view;
        });
    }

    public async saveViewDraft(
        request: ViewSaveRequest,
    ): Promise<ViewHistoryEntry> {
        validateViewDraft(request);
        await this.requireViews(request.corpusId);
        const prior = await this.getView({
            corpusId: request.corpusId,
            viewId: request.viewId,
        });
        if (prior && prior.content.kind !== request.content.kind)
            throw new Error("An existing view cannot change kind");
        if (request.unlockProtection) {
            if (!prior || !captureEditorialContext(prior))
                throw new Error(
                    "Protection unlock requires a generated editorial draft",
                );
            unlockEditorialProtection(prior, request.unlockProtection);
            if (
                viewHash(prior.content) !== viewHash(request.content) ||
                viewHash(authoredRelationships(prior)) !==
                    viewHash(request.relationships) ||
                viewHash(derivedDefinitionInput(prior)) !==
                    viewHash(request.definition)
            )
                throw new Error(
                    "Protection unlock cannot also edit content or definition",
                );
        }
        if (
            request.definition.maintenance !== undefined &&
            viewHash(request.definition.maintenance) !==
                viewHash(prior?.definition.maintenance)
        )
            throw new Error(
                "Change maintenance intent through updateViewMaintenance, not a content edit",
            );
        if (
            (request.content.kind === "timeline" ||
                request.content.kind === "wiki") &&
            !prior?.generation?.input
        )
            throw new Error(
                "Timeline and wiki drafts must begin with a grounded Build views result",
            );
        let proof: ViewPublicationProof | undefined;
        if (prior?.generation?.input) {
            if (
                viewHash(prior.definition.selector) !==
                viewHash(request.definition.selector)
            )
                throw new Error(
                    "Generated guide source selection must change through an explicit rebuild",
                );
            const output: ViewSynthesisOutput = {
                content: request.content,
                relationships: request.relationships,
                outcome: prior.generation.outcome ?? "diagnosticOnly",
                missingEvidence: prior.generation.missingEvidence ?? [
                    "Human edit retains generation evidence limits",
                ],
                ...inventoryEvidence(prior.generation),
            };
            validateConstructedGuide(prior.generation.input, output);
            const support = informationalWiki(output.content)
                ? undefined
                : await this.viewAdapter.validate(
                      prior.generation.input,
                      output,
                      new AbortController().signal,
                  );
            if (support) {
                validateSupport(output, support);
                proof = publicationProof(
                    prior.generation.input.fingerprint,
                    output,
                    support,
                );
            }
        }
        return this.enqueueWrite(request.corpusId, async () => {
            const runtime = await this.getCorpusRuntime(request.corpusId);
            if (informationalWiki(request.content))
                await this.ensureDocumentIndex(request.corpusId, runtime);
            for (const selected of request.definition.selector.sources) {
                const source = runtime.manifest.sources.find(
                    (item) => item.sourceId === selected.sourceId,
                );
                if (!source || source.activeRevisionId !== selected.revisionId)
                    throw new Error(
                        "Selected source revision is missing or stale",
                    );
            }
            const citations = [
                ...request.content.citations,
                ...request.relationships.flatMap((edge) => edge.citations),
            ];
            for (const citation of citations) {
                if (
                    await this.validateIndexedDraftCitation(
                        runtime,
                        citation,
                        informationalWiki(request.content),
                    )
                )
                    continue;
                if (citation.evidence) {
                    const event = runtime.events.find(
                        (entry) => entry.eventId === citation.evidence?.eventId,
                    );
                    if (
                        !event ||
                        isSuppressedEvent(runtime, event) ||
                        viewHash(event) !== citation.revisionId ||
                        citation.locator !==
                            `chars:0-${JSON.stringify(event).length}` ||
                        citation.excerpt !== JSON.stringify(event)
                    )
                        throw new Error(
                            "Canonical event citation is missing, suppressed or changed",
                        );
                    continue;
                }
                const source = runtime.manifest.sources.find(
                    (item) => item.sourceId === citation.sourceId,
                );
                const revision = source?.revisions.find(
                    (item) => item.revisionId === citation.revisionId,
                );
                const match = /^chars:(\d+)-(\d+)$/.exec(
                    citation.locator ?? "",
                );
                const start = Number(match?.[1]);
                const end = Number(match?.[2]);
                if (
                    !revision ||
                    !match ||
                    !Number.isSafeInteger(start) ||
                    !Number.isSafeInteger(end) ||
                    start < 0 ||
                    end <= start ||
                    end > revision.content.length ||
                    revision.content.slice(start, end) !== citation.excerpt
                )
                    throw new Error(
                        "View citation does not match the exact retained source revision",
                    );
            }
            const saved = await this.viewStore.saveViewDraft(request, proof);
            await this.acceptInformationalVersion(saved.version);
            await this.markWikiRetrievalChanged(request, prior);
            return saved;
        });
    }

    private async markWikiRetrievalChanged(
        request: ViewSaveRequest,
        prior: ViewVersion | undefined,
    ): Promise<void> {
        const selector =
            request.definition.wiki ?? request.definition.projectSummary;
        if (
            !selector ||
            (!request.unlockProtection &&
                viewHash(selector) ===
                    viewHash(
                        prior?.definition.wiki ??
                            prior?.definition.projectSummary,
                    ))
        )
            return;
        const kind = request.definition.projectSummary ? "projects" : "wiki";
        const family = await this.viewStore.getWikiFamily(
            request.corpusId,
            kind,
        );
        family.dirty = true;
        family.cursor = 0;
        await this.viewStore.saveWikiFamily(request.corpusId, family, kind);
        this.scheduleWikiMaintenance(request.corpusId, kind);
    }

    private async validateIndexedDraftCitation(
        runtime: CorpusRuntime,
        citation: ViewSynthesisOutput["content"]["citations"][number],
        informational: boolean,
    ): Promise<boolean> {
        if (!informational || !citation.locator.startsWith("indexed:"))
            return false;
        if (
            !runtime.index.resolveIndexedLocator ||
            (await runtime.index.resolveIndexedLocator(
                citation.sourceId,
                citation.revisionId,
                citation.locator,
            )) !== citation.excerpt
        )
            throw new Error("Indexed citation is unavailable or changed");
        return true;
    }

    private async acceptInformationalVersion(view: ViewVersion): Promise<void> {
        if (!informationalWiki(view.content)) return;
        await this.assertViewPublicationFresh(view);
        await this.viewStore.makeInformationalVisible(view);
        await this.indexViewLocked(view);
    }

    public async archiveView(
        request: ViewArchiveRequest,
    ): Promise<ViewHistoryEntry> {
        validateViewArchive(request);
        await this.requireViews(request.corpusId);
        validateIdentifier("view ID", request.viewId);
        return this.enqueueWrite(request.corpusId, async () => {
            const archived = await this.viewStore.archiveView(request);
            await this.cleanArchivedViewIndexes(request.corpusId);
            return archived;
        });
    }

    public async getViewHistory(
        request: ViewReadRequest,
    ): Promise<ViewHistoryEntry[]> {
        const runtime = await this.requireViews(request.corpusId);
        return runtime.access.read(async () => {
            const history = await this.viewStore.getViewHistory(request);
            const eligible = await Promise.all(
                history.map((entry) =>
                    this.informationalVersionEligible(entry.version),
                ),
            );
            return history.filter((_, index) => eligible[index]);
        });
    }

    public async getViewPublicationPolicy(
        corpusId: string,
    ): Promise<ViewPublicationPolicy> {
        const runtime = await this.requireViews(corpusId);
        return runtime.access.read(() =>
            this.viewStore.getViewPublicationPolicy(corpusId),
        );
    }

    public async updateViewPublicationPolicy(
        request: ViewPublicationPolicyUpdate,
    ): Promise<ViewPublicationPolicy> {
        await this.requireViews(request.corpusId);
        if (
            Object.keys(request).some(
                (key) =>
                    ![
                        "corpusId",
                        "expectedHead",
                        "expectedRevision",
                        "autoPublish",
                        "viewId",
                    ].includes(key),
            ) ||
            !Number.isSafeInteger(request.expectedRevision) ||
            request.expectedRevision < 0 ||
            (request.autoPublish !== null &&
                typeof request.autoPublish !== "boolean")
        )
            throw new Error(
                "Invalid publication policy update; actor is service-owned",
            );
        return this.enqueueWrite(request.corpusId, () =>
            this.viewStore.updateViewPublicationPolicy(request),
        );
    }

    public async getViewPublication(
        request: ViewReadRequest,
    ): Promise<ViewPublicationStatus> {
        const runtime = await this.requireViews(request.corpusId);
        validateIdentifier("view ID", request.viewId);
        return runtime.access.read(() =>
            this.viewStore.getViewPublication(request),
        );
    }

    public async publishView(
        request: ViewPublishRequest,
    ): Promise<ViewPublicationStatus> {
        await this.requireViews(request.corpusId);
        this.validateViewPublishRequest(request);
        return this.enqueueWrite(request.corpusId, () =>
            this.publishViewLocked(request),
        );
    }

    private validateViewPublishRequest(request: ViewPublishRequest): void {
        if (
            Object.keys(request).some(
                (key) =>
                    ![
                        "corpusId",
                        "viewId",
                        "revisionId",
                        "expectedVersion",
                        "expectedHead",
                    ].includes(key),
            ) ||
            !/^[0-9a-f]{40}$/.test(request.expectedHead) ||
            !Number.isSafeInteger(request.expectedVersion) ||
            request.expectedVersion < 1
        )
            throw new Error(
                "Publication requires exact expected head, version and revision; actor is service-owned",
            );
        validateIdentifier("view ID", request.viewId);
        validateIdentifier("revision ID", request.revisionId);
    }

    private async assertViewPublicationFresh(
        version: ViewVersion,
        current?: ViewVersion,
    ): Promise<void> {
        if (version.state !== "draft")
            throw new Error(
                "Archived or stale view cannot be published or searched",
            );
        if (!informationalWiki(version.content))
            assertPublicationProof(version);
        const runtime = await this.getCorpusRuntime(version.corpusId);
        await this.assertInfluenceEligible(version.generation?.input);
        const latest =
            current ??
            (await this.viewStore.getView({
                corpusId: version.corpusId,
                viewId: version.viewId,
            }));
        if (
            !latest ||
            viewHash(latest.definition.maintenance) !==
                viewHash(version.definition.maintenance)
        )
            throw new ViewBuildStaleError(
                "Maintenance intent changed since publication; reconcile and publish the intended exact revision",
            );
        this.assertPublicationMaintenance(version, runtime);
        for (const input of version.generation!.input!.inputs) {
            if (input.evidence) {
                const event = runtime.events.find(
                    (entry) => entry.eventId === input.evidence?.eventId,
                );
                if (
                    !event ||
                    isSuppressedEvent(runtime, event) ||
                    viewHash(event) !== input.contentHash
                )
                    throw new ViewBuildStaleError(
                        "Canonical timeline event changed, was forgotten or suppressed",
                    );
                continue;
            }
            const source = runtime.manifest.sources.find(
                (entry) => entry.sourceId === input.sourceId,
            );
            const revision = source?.revisions.find(
                (entry) => entry.revisionId === input.revisionId,
            );
            if (
                !revision ||
                revision.state !== "ready" ||
                source?.activeRevisionId !== input.revisionId ||
                viewHash(revision.content) !== input.contentHash
            )
                throw new ViewBuildStaleError(
                    "Publication evidence was changed, forgotten or is no longer the exact accessible current revision; rebuild first",
                );
        }
        if (version.content.kind === "timeline") {
            const frozen = version.generation!.input!;
            validateTimelineEvidence(frozen, version.content);
            validateTimelineCorrections(
                frozen,
                version.content,
                authoredRelationships(version),
            );
            const target = await this.snapshotViewTarget(
                version.corpusId,
                {
                    definition: frozen.definition,
                    expectedVersion: (await this.viewStore.getView({
                        corpusId: version.corpusId,
                        viewId: version.viewId,
                    }))!.version,
                },
                frozen.bounds,
                frozen.publicationPolicy?.buildOverride,
            );
            if (target.selectionFingerprint !== frozen.selectionFingerprint)
                throw new ViewBuildStaleError(
                    "Timeline record membership or retained evidence changed; rebuild first",
                );
        }
    }

    private assertPublicationMaintenance(
        version: ViewVersion,
        runtime: CorpusRuntime,
    ): void {
        if (
            !version.definition.maintenance ||
            version.definition.maintenance.scope.mode === "pinned"
        )
            return;
        const plan = this.resolveMaintenanceTarget(
            derivedDefinitionInput(version),
            runtime,
            version.generation!.input!.bounds,
            version,
        );
        if (
            plan.state === "blocked" ||
            !plan.snapshot ||
            plan.snapshot.fingerprint !== version.maintenance?.fingerprint
        )
            throw new ViewBuildStaleError(
                `Maintained view scope is outdated: ${plan.reason}`,
            );
    }

    private async publishViewLocked(
        request: ViewPublishRequest,
    ): Promise<ViewPublicationStatus> {
        const view = await this.viewStore.getView(request);
        if (!view) throw new Error("Publication revision is missing");
        await this.assertViewPublicationFresh(view);
        const publication = await this.viewStore.publishView(request);
        if (publication.indexState === "ready") return publication;
        await this.viewPublicationCheckpoint?.("intent");
        return this.indexViewLocked(view);
    }

    public async retryViewIndex(
        request: ViewPublishRequest,
    ): Promise<ViewPublicationStatus> {
        await this.requireViews(request.corpusId);
        this.validateViewPublishRequest(request);
        return this.enqueueWrite(request.corpusId, async () => {
            const snapshot = await this.viewStore.listViews(request.corpusId);
            const publication =
                await this.viewStore.getViewPublication(request);
            if (publication.blockedReason)
                throw new Error(publication.blockedReason);
            const current = snapshot.views.find(
                (entry) => entry.viewId === request.viewId,
            );
            if (
                snapshot.head !== request.expectedHead ||
                current?.version !== request.expectedVersion ||
                publication.publishedRevisionId !== request.revisionId
            )
                throw new Error(
                    "Index retry head, target or published revision conflict",
                );
            const published = await this.viewStore.getView(request);
            if (!published || current.state === "archived")
                throw new Error(
                    "Published revision is unavailable or archived",
                );
            await this.assertViewPublicationFresh(published);
            return this.indexViewLocked(published);
        });
    }

    private viewIndexDirectory(
        version: Pick<ViewVersion, "corpusId" | "viewId" | "revisionId">,
    ): string {
        return path.join(
            this.rootDirectory,
            version.corpusId,
            "views",
            "view-search-index",
            viewHash(version.viewId),
            viewHash(version.revisionId),
        );
    }

    private async indexViewLocked(
        view: ViewVersion,
    ): Promise<ViewPublicationStatus> {
        const directory = this.viewIndexDirectory(view);
        const content = viewContentToText(view.content);
        try {
            await mkdir(directory, { recursive: true });
            const index = this.indexFactory(view.corpusId, directory);
            await index.rebuild(
                [
                    {
                        source: {
                            corpusId: view.corpusId,
                            sourceId: view.viewId,
                            sourceType: "markdown",
                            title: view.content.title,
                            activeRevisionId: view.revisionId,
                        },
                        revision: {
                            revisionId: view.revisionId,
                            sourceId: view.viewId,
                            contentHash: viewHash(content),
                            mimeType: "text/markdown",
                            pipelineVersion,
                            state: "ready",
                        },
                        content,
                        pipeline: { mode: "content" },
                    },
                ],
                new AbortController().signal,
                async () => {},
            );
            await stampIndexSchema(directory, "views", true);
            await writeFile(
                path.join(directory, "ready"),
                view.revisionId,
                "utf8",
            );
        } catch (error) {
            await rm(directory, { recursive: true, force: true });
            return this.viewStore.updateViewIndex(
                view.corpusId,
                view.viewId,
                view.revisionId,
                `Indexing failed: ${redactRunbookText(error instanceof Error ? error.message : String(error))}`,
            );
        }

        await this.viewPublicationCheckpoint?.("index");
        return this.viewStore.updateViewIndex(
            view.corpusId,
            view.viewId,
            view.revisionId,
        );
    }

    private async informationalIndexReady(view: ViewVersion): Promise<boolean> {
        const directory = this.viewIndexDirectory(view);
        try {
            if (
                (await readFile(path.join(directory, "ready"), "utf8")) !==
                view.revisionId
            )
                return false;
        } catch (error) {
            if ((error as NodeJS.ErrnoException).code === "ENOENT")
                return false;
            throw error;
        }
        return (
            (await classifyIndexSchema(directory, "views", true)) === "current"
        );
    }

    private async recoverInformationalEffect(view: ViewVersion): Promise<void> {
        await this.assertViewPublicationFresh(view);
        let publication = await this.viewStore.getViewPublication({
            corpusId: view.corpusId,
            viewId: view.viewId,
        });
        if (publication.publishedRevisionId !== view.revisionId)
            publication = await this.viewStore.makeInformationalVisible(view);
        if (
            publication.indexState !== "ready" ||
            !(await this.informationalIndexReady(view))
        )
            await this.indexViewLocked(view);
    }

    private async cleanArchivedViewIndexes(corpusId: string): Promise<void> {
        for (const viewId of await this.viewStore.getViewIndexCleanup(
            corpusId,
        )) {
            await rm(
                path.join(
                    this.rootDirectory,
                    corpusId,
                    "views",
                    "view-search-index",
                    viewHash(viewId),
                ),
                { recursive: true, force: true },
            );
            await this.viewStore.completeViewIndexCleanup(corpusId, viewId);
        }
    }

    public async searchViews(
        request: ViewSearchRequest,
    ): Promise<ViewSearchMatch[]> {
        const runtime = await this.requireViews(request.corpusId);
        if (
            Object.keys(request).some(
                (key) =>
                    ![
                        "corpusId",
                        "query",
                        "limit",
                        "freshness",
                        "kinds",
                    ].includes(key),
            ) ||
            !request.query.trim() ||
            request.freshness !== "current" ||
            (request.kinds !== undefined &&
                (!Array.isArray(request.kinds) ||
                    request.kinds.length > 4 ||
                    request.kinds.some(
                        (kind) =>
                            ![
                                "troubleshootingGuide",
                                "projectBrief",
                                "timeline",
                                "wiki",
                            ].includes(kind),
                    ))) ||
            (request.limit !== undefined &&
                (!Number.isSafeInteger(request.limit) ||
                    request.limit < 1 ||
                    request.limit > 100))
        )
            throw new Error(
                "Derived search requires a nonempty query and explicit current freshness",
            );
        return runtime.access.read(async () => {
            const results: ViewSearchMatch[] = [];
            for (const {
                current,
                view,
                publication,
            } of await this.viewStore.listPublishedViews(request.corpusId)) {
                if (current.state === "archived") continue;
                if (
                    request.kinds &&
                    !request.kinds.some((kind) => kind === current.content.kind)
                )
                    continue;
                if (
                    publication.blockedReason ||
                    !publication.publishedRevisionId ||
                    publication.indexState !== "ready" ||
                    publication.indexedRevisionId !==
                        publication.publishedRevisionId
                )
                    continue;
                if (!view)
                    throw new Error(
                        "Published view pointer references a missing revision",
                    );
                try {
                    await this.assertViewPublicationFresh(view, current);
                } catch (error) {
                    if (error instanceof ViewBuildStaleError) continue;
                    throw error;
                }
                const directory = this.viewIndexDirectory(view);
                if (
                    (await classifyIndexSchema(directory, "views", true)) !==
                        "current" ||
                    (await readFile(path.join(directory, "ready"), "utf8")) !==
                        view.revisionId
                )
                    throw new Error(
                        "Published view index is missing or does not match the exact revision; retry indexing",
                    );
                const index = this.indexFactory(request.corpusId, directory);
                await index.initialize();
                const matches =
                    informationalWiki(view.content) && index.readFragments
                        ? (
                              await index.readFragments({
                                  terms: [
                                      ...new Set(
                                          request.query
                                              .toLocaleLowerCase()
                                              .match(/[\p{L}\p{N}-]+/gu) ?? [],
                                      ),
                                  ].slice(0, 8),
                                  sourceIds: [view.viewId],
                                  maxFragments: 1,
                              })
                          ).fragments
                        : await index.search(
                              request.query.trim(),
                              request.limit ?? 20,
                          );
                for (const match of matches) {
                    if (
                        match.sourceId !== view.viewId ||
                        match.revisionId !== view.revisionId
                    )
                        throw new Error(
                            "Derived index returned a different published revision",
                        );
                    results.push({
                        view,
                        score: match.score,
                        snippet: match.snippet,
                        review: "unreviewed",
                        freshness: "current",
                        evidence: view.content.citations,
                        corroboration: "derived",
                    });
                }
            }
            return results
                .sort((a, b) => b.score - a.score)
                .slice(0, request.limit ?? 20);
        });
    }

    private async snapshotInformationalTarget(
        corpusId: string,
        target: ViewBuildTarget,
        current?: ViewVersion,
        retrieval?: ViewBuildSnapshot["informationalRetrieval"] | false,
    ): Promise<ViewBuildSnapshot> {
        if (!this.informationalWikiEnabled)
            throw new Error(
                "Informational views are explicitly disabled by this host",
            );
        const runtime = await this.getCorpusRuntime(corpusId);
        if (retrieval)
            this.assertInformationalRetrieval(
                runtime,
                {
                    ...retrieval,
                    indexGeneration: runtime.manifest.indexGeneration!,
                },
                retrieval,
            );
        await this.ensureDocumentIndex(corpusId, runtime);
        const wiki = target.definition.wiki ?? target.definition.projectSummary;
        if (!wiki || !runtime.index.readFragments)
            throw new Error(
                "Host does not support bounded informational wiki retrieval",
            );
        const selected = retrieval
            ? retrieval.sources.map((source) => ({ ...source }))
            : target.definition.selector.sources.length
              ? target.definition.selector.sources
              : runtime.manifest.sources
                    .filter((source) =>
                        source.revisions.some(
                            (revision) =>
                                revision.revisionId ===
                                    source.activeRevisionId &&
                                revision.state === "ready",
                        ),
                    )
                    .map((source) => ({
                        sourceId: source.sourceId,
                        revisionId: source.activeRevisionId,
                    }));
        const priorCapture = current?.generation?.input;
        const followSources = this.informationalFollowSources(
            runtime,
            selected,
            priorCapture,
            wiki.excludedSourceIds,
            retrieval,
        );
        const context = this.informationalRetrievalContext(
            runtime,
            selected,
            followSources,
            wiki.excludedSourceIds,
            retrieval,
        );
        const selection = await runtime.index.readFragments({
            terms: [wiki.query, ...wiki.aliases],
            ...(followSources.length ? { followSources } : {}),
            sourceIds: (context?.sources ?? selected)
                .map((source) => source.sourceId)
                .filter(
                    (sourceId) => !wiki.excludedSourceIds.includes(sourceId),
                ),
        });
        if (!selection.fragments.length)
            throw new Error(
                "No substantive indexed fragments matched this wiki selector",
            );
        const inputs = selected.flatMap((item) => {
            const source = runtime.manifest.sources.find(
                (entry) => entry.sourceId === item.sourceId,
            );
            const revision = source?.revisions.find(
                (entry) => entry.revisionId === item.revisionId,
            );
            if (
                !source ||
                !revision ||
                source.activeRevisionId !== item.revisionId ||
                revision.state !== "ready"
            )
                throw new ViewBuildStaleError(
                    "Informational source revision is unavailable or changed",
                );
            const fragments = selection.fragments.filter(
                (fragment) =>
                    fragment.sourceId === item.sourceId &&
                    fragment.revisionId === item.revisionId,
            );
            if (!fragments.length) return [];
            return [
                {
                    ...item,
                    title: source.title,
                    content: fragments
                        .map((fragment) => fragment.snippet)
                        .join("\n\n"),
                    contentHash: viewHash(revision.content),
                    passages: fragments.map((fragment) => ({
                        sourceId: fragment.sourceId,
                        revisionId: fragment.revisionId,
                        locator: fragment.locator,
                        excerpt: fragment.snippet,
                    })),
                },
            ];
        });
        const editorial = captureEditorialContext(current);
        const snapshot = {
            corpusId,
            actor: userInfo().username,
            definition: {
                ...structuredClone(target.definition),
                selector: {
                    kind: "sources" as const,
                    sources: inputs.map(({ sourceId, revisionId }) => ({
                        sourceId,
                        revisionId,
                    })),
                },
            },
            expectedVersion: target.expectedVersion,
            ...(current
                ? {
                      definitionRevisionId: current.definition.revisionId,
                      targetRevisionId: current.revisionId,
                  }
                : {}),
            bounds: {},
            ...(editorial ? { editorial } : {}),
            inputs,
            ...(context ? { informationalRetrieval: context } : {}),
            selectionFingerprint: viewHash({
                readChars: selection.readChars,
                limited: selection.limited,
                fragments: selection.fragments,
            }),
            pipeline: target.definition.projectSummary
                ? ("informational-project-summary-v1" as const)
                : ("informational-wiki-v1" as const),
            model: viewSynthesisIdentity(
                this.viewAdapter.identity,
                target.definition,
                !!this.viewAdapter.assessWikiConsolidation &&
                    !!this.viewAdapter.checkWikiConsolidation,
            ),
        };
        const frozen = { ...snapshot, fingerprint: viewHash(snapshot) };
        if (!target.definition.wiki) return frozen;
        if (
            priorCapture?.wikiContribution &&
            inputs.some((input) =>
                runtime.manifest.knowledgeSuppressions?.some(
                    (entry) => entry.sourceId === input.sourceId,
                ),
            )
        )
            throw new ViewBuildStaleError(
                "Wiki contribution refresh has suppressed evidence; reconcile eligibility before synthesis",
            );
        return refreshWikiContributionInput(
            frozen,
            current,
            new Set(
                runtime.manifest.sources.flatMap((source) =>
                    source.revisions.some(
                        (revision) =>
                            revision.revisionId === source.activeRevisionId &&
                            revision.state === "ready",
                    )
                        ? [
                              viewSourceKey({
                                  sourceId: source.sourceId,
                                  revisionId: source.activeRevisionId,
                              }),
                          ]
                        : [],
                ),
            ),
        );
    }

    private informationalFollowSources(
        runtime: CorpusRuntime,
        selected: ViewDefinitionInput["selector"]["sources"],
        prior: ViewBuildSnapshot | undefined,
        excludedSourceIds: string[],
        expected?: ViewBuildSnapshot["informationalRetrieval"] | false,
    ): ViewDefinitionInput["selector"]["sources"] {
        if (expected)
            return expected.followSources.map((source) => ({ ...source }));
        const priorSources = new Set(
            [...(prior?.inputs ?? []), ...(prior?.influenceSources ?? [])].map(
                (source) => source.sourceId,
            ),
        );
        return selected.filter(
            (source) =>
                priorSources.has(source.sourceId) &&
                runtime.manifest.authorizedSourceRemoval?.sourceId !==
                    source.sourceId &&
                !excludedSourceIds.includes(source.sourceId) &&
                !runtime.manifest.knowledgeSuppressions?.some(
                    (entry) => entry.sourceId === source.sourceId,
                ),
        );
    }

    private informationalRetrievalContext(
        runtime: CorpusRuntime,
        selected: Array<{ sourceId: string; revisionId: string }>,
        followSources: Array<{ sourceId: string; revisionId: string }>,
        excludedSourceIds: string[],
        expected?: ViewBuildSnapshot["informationalRetrieval"] | false,
    ): ViewBuildSnapshot["informationalRetrieval"] {
        if (expected === false) return undefined;
        const context = {
            indexGeneration: runtime.manifest.indexGeneration!,
            sources: expected
                ? selected
                : selected.filter(
                      (source) =>
                          !excludedSourceIds.includes(source.sourceId) &&
                          runtime.manifest.authorizedSourceRemoval?.sourceId !==
                              source.sourceId &&
                          !runtime.manifest.knowledgeSuppressions?.some(
                              (entry) => entry.sourceId === source.sourceId,
                          ),
                  ),
            followSources,
        };
        this.assertInformationalRetrieval(runtime, context, expected);
        return Object.freeze({
            ...context,
            sources: Object.freeze(
                context.sources.map((source) => Object.freeze({ ...source })),
            ),
            followSources: Object.freeze(
                context.followSources.map((source) =>
                    Object.freeze({ ...source }),
                ),
            ),
        });
    }

    private assertInformationalRetrieval(
        runtime: CorpusRuntime,
        context: NonNullable<ViewBuildSnapshot["informationalRetrieval"]>,
        expected?: ViewBuildSnapshot["informationalRetrieval"] | false,
    ): void {
        const references = new Map(
            context.sources.map((source) => [
                source.sourceId,
                source.revisionId,
            ]),
        );
        if (
            !context.indexGeneration ||
            !context.sources.length ||
            (expected &&
                expected.indexGeneration !== context.indexGeneration) ||
            references.size !== context.sources.length ||
            new Set(context.followSources.map((source) => source.sourceId))
                .size !== context.followSources.length ||
            context.followSources.some(
                (source) =>
                    references.get(source.sourceId) !== source.revisionId,
            )
        )
            throw new ViewBuildStaleError(
                "Informational retrieval index or following scope changed",
            );
        for (const selected of context.sources) {
            const source = runtime.manifest.sources.find(
                (source) => source.sourceId === selected.sourceId,
            );
            if (
                !source ||
                source.activeRevisionId !== selected.revisionId ||
                !source.revisions.some(
                    (revision) =>
                        revision.revisionId === selected.revisionId &&
                        revision.state === "ready",
                ) ||
                runtime.manifest.authorizedSourceRemoval?.sourceId ===
                    selected.sourceId ||
                runtime.manifest.knowledgeSuppressions?.some(
                    (entry) => entry.sourceId === selected.sourceId,
                )
            )
                throw new ViewBuildStaleError(
                    "Informational retrieval source scope changed, was suppressed or forgotten",
                );
        }
    }

    private async wikiAdmissionPages(
        input: ViewBuildSnapshot,
    ): Promise<WikiPagePurposeContext[]> {
        const family = await this.viewStore.getWikiFamily(input.corpusId);
        const published = await this.viewStore.listPublishedViews(
            input.corpusId,
        );
        const views: ViewVersion[] = [];
        for (const entry of published) {
            if (
                entry.view &&
                entry.view.revisionId === entry.current.revisionId &&
                entry.publication.indexState === "ready" &&
                !entry.publication.blockedReason &&
                (await this.informationalVersionEligible(
                    entry.view,
                    entry.current,
                ))
            )
                views.push(entry.view);
        }
        return nominateWikiPages(
            input,
            views,
            new Map(
                family.descriptors.map((descriptor) => [
                    descriptor.viewId,
                    descriptor.identity,
                ]),
            ),
        );
    }

    private async readWikiRedirect(
        alias: ViewVersion,
        historical: boolean,
    ): Promise<ViewVersion | undefined> {
        let current = alias;
        let anchors = structuredClone(alias.redirect!.anchors);
        const seen = new Set([alias.viewId]);
        for (let depth = 0; depth < 16; depth++) {
            const redirect = current.redirect;
            if (!redirect) throw new Error("Wiki redirect record is missing");
            if (seen.has(redirect.viewId))
                throw new Error("Wiki redirect cycle rejected");
            seen.add(redirect.viewId);
            const canonical = await this.viewStore.getView({
                corpusId: alias.corpusId,
                viewId: redirect.viewId,
                ...(historical
                    ? { revisionId: redirect.acceptedRevisionId }
                    : {}),
            });
            if (!canonical) return undefined;
            if (canonical.redirect) {
                const next = canonical.redirect;
                anchors = anchors.map((anchor) => ({
                    from: anchor.from,
                    to:
                        next.anchors.find((entry) => entry.from === anchor.to)
                            ?.to ?? anchor.to,
                }));
                current = canonical;
                continue;
            }
            if (!(await this.informationalVersionEligible(canonical)))
                return undefined;
            if (
                alias.generation?.input?.definition.wiki?.query !==
                canonical.definition.wiki?.query
            )
                throw new ViewBuildStaleError(
                    "Canonical purpose changed; old redirect cannot imply a new scope",
                );
            const currentAnchors = new Set(
                canonical.content.sections.map((section) => section.id),
            );
            anchors = anchors.map((anchor) => ({
                from: anchor.from,
                to: currentAnchors.has(anchor.to)
                    ? anchor.to
                    : canonical.content.sections[0].id,
            }));
            return {
                ...canonical,
                viewId: alias.viewId,
                revisionId: alias.revisionId,
                version: alias.version,
                state: "archived",
                redirect: {
                    viewId: canonical.viewId,
                    acceptedRevisionId: canonical.revisionId,
                    anchors,
                },
            };
        }
        throw new Error("Wiki redirect exceeds supported navigation depth");
    }

    private async checkWikiContributionInput(
        input: ViewBuildSnapshot,
        checkTarget = true,
    ): Promise<void> {
        await this.assertInfluenceEligible(input);
        const current = await this.viewStore.getView({
            corpusId: input.corpusId,
            viewId: input.definition.viewId,
        });
        if (
            !current ||
            current.state !== "draft" ||
            (checkTarget &&
                (current.version !== input.expectedVersion ||
                    current.revisionId !== input.targetRevisionId ||
                    current.definition.revisionId !==
                        input.definitionRevisionId))
        )
            throw new ViewBuildStaleError(
                "Wiki canonical target changed during contribution",
            );
        const runtime = await this.getCorpusRuntime(input.corpusId);
        await this.ensureDocumentIndex(input.corpusId, runtime);
        for (const retained of input.inputs) {
            const source = runtime.manifest.sources.find(
                (entry) => entry.sourceId === retained.sourceId,
            );
            const revision = source?.revisions.find(
                (entry) => entry.revisionId === retained.revisionId,
            );
            if (
                !source ||
                !revision ||
                revision.state !== "ready" ||
                source.activeRevisionId !== retained.revisionId ||
                runtime.manifest.authorizedSourceRemoval?.sourceId ===
                    retained.sourceId ||
                viewHash(revision.content) !== retained.contentHash ||
                current.definition.wiki?.excludedSourceIds.includes(
                    retained.sourceId,
                ) ||
                runtime.manifest.knowledgeSuppressions?.some(
                    (entry) => entry.sourceId === retained.sourceId,
                )
            )
                throw new ViewBuildStaleError(
                    "Wiki contribution evidence was replaced, excluded, suppressed or forgotten",
                );
            for (const citation of retained.passages ?? [])
                if (
                    !(await this.validateIndexedDraftCitation(
                        runtime,
                        citation,
                        true,
                    ))
                )
                    throw new Error(
                        "Wiki contribution requires exact indexed evidence",
                    );
        }
    }

    private async consolidationPairs(
        corpusId: string,
        targetId: string,
    ): Promise<Array<[ViewVersion, ViewVersion]>> {
        const snapshot = await this.listViewSnapshot(corpusId);
        const targetView = snapshot.views.find(
            (view) => view.viewId === targetId,
        );
        if (!targetView?.generation?.input || !targetView.definition.wiki)
            return [];
        const family = await this.viewStore.getWikiFamily(corpusId);
        const nominated = new Set(
            nominateWikiPages(
                targetView.generation.input,
                snapshot.views,
                new Map(
                    family.descriptors.map((descriptor) => [
                        descriptor.viewId,
                        descriptor.identity,
                    ]),
                ),
            ).map((page) => page.viewId),
        );
        const candidates: Array<{ view: ViewVersion; first: string }> = [];
        for (const view of snapshot.views) {
            if (view.viewId !== targetId && !nominated.has(view.viewId))
                continue;
            const versions = await this.viewStore.getViewVersions({
                corpusId,
                viewId: view.viewId,
            });
            if (
                automaticallyConsolidatable(
                    view,
                    versions.map((version) => ({ version })),
                )
            )
                candidates.push({
                    view,
                    first: versions.at(-1)!.createdAt,
                });
        }
        candidates.sort(
            (left, right) =>
                left.first.localeCompare(right.first) ||
                left.view.viewId.localeCompare(right.view.viewId),
        );
        const target = candidates.find(
            (candidate) => candidate.view.viewId === targetId,
        );
        if (!target) return [];
        return candidates
            .filter(
                (candidate) =>
                    candidate.view.viewId !== targetId &&
                    compatibleConsolidationPair(target.view, candidate.view),
            )
            .map((partner) =>
                candidates.indexOf(target) < candidates.indexOf(partner)
                    ? [target.view, partner.view]
                    : [partner.view, target.view],
            );
    }

    private async consolidateWiki(
        job: ViewBuildJob,
        result: ViewBuildTargetResult,
        signal: AbortSignal,
    ): Promise<void> {
        if (
            !this.viewAdapter.assessWikiConsolidation ||
            !this.viewAdapter.checkWikiConsolidation
        )
            return;
        for (const pair of await this.readConsolidationPairs(
            job.corpusId,
            result.viewId,
        ))
            if (await this.tryConsolidateWiki(job, result, pair, signal))
                return;
    }

    private async tryConsolidateWiki(
        job: ViewBuildJob,
        result: ViewBuildTargetResult,
        pair: [ViewVersion, ViewVersion],
        signal: AbortSignal,
    ): Promise<boolean> {
        if (
            !this.viewAdapter.assessWikiConsolidation ||
            !this.viewAdapter.checkWikiConsolidation
        )
            return false;
        const [survivor, retiring] = pair;
        const input = consolidationInput(survivor, retiring);
        this.viewBuilds.trackContribution(job.jobId, input);
        await this.checkWikiContributionInput(input);
        await this.assertInfluenceEligible(input);
        signal.throwIfAborted();
        const assessment = await readConsolidationScope(
            abortable(
                this.viewAdapter.assessWikiConsolidation(
                    input,
                    survivor,
                    retiring,
                    signal,
                ),
                signal,
            ),
            input,
        );
        if (assessment.relation !== "samePurpose") return false;
        input.wikiContribution!.purpose = assessment.scope.purpose;
        input.wikiContribution!.essentialDistinctions =
            assessment.criticalDistinctions.map((distinction) => ({
                ...distinction,
                canonicalExcerpt: "",
            }));
        const { fingerprint: _priorFingerprint, ...checkedInput } = input;
        input.fingerprint = viewHash(checkedInput);
        const { output, anchors } = preservedCanonicalOutput(
            survivor,
            retiring,
        );
        validateConstructedGuide(input, output);
        const verification = await abortable(
            this.viewAdapter.checkWikiConsolidation(
                input,
                output,
                assessment,
                signal,
            ),
            signal,
        );
        assertEditorialAssessment(verification);
        signal.throwIfAborted();
        const receipt: WikiConsolidationReceipt = {
            identity: viewHash({
                survivor: survivor.revisionId,
                retiring: retiring.revisionId,
                input: input.fingerprint,
                output,
                assessment,
            }),
            stage: "prepared",
            survivorViewId: survivor.viewId,
            retiringViewId: retiring.viewId,
            retiringRevisionId: retiring.revisionId,
            retiringVersion: retiring.version,
            input,
            output,
            anchors,
            assessment,
            verification,
        };
        await this.enqueueWrite(job.corpusId, async () => {
            signal.throwIfAborted();
            await this.checkWikiContributionInput(input);
            await this.assertInfluenceEligible(input);
            await this.viewStore.updateViewBuild(
                job.corpusId,
                job.jobId,
                (current) => {
                    const target = current.results.find(
                        (entry) => entry.viewId === result.viewId,
                    );
                    if (!target || current.state !== "running")
                        throw new ViewBuildStaleError(
                            "Consolidation owner changed or was forgotten",
                        );
                    target.wikiConsolidation = receipt;
                },
            );
            await this.resumeWikiConsolidationLocked(
                job.corpusId,
                job.jobId,
                result.viewId,
                signal,
            );
        });
        return true;
    }

    private async resumeWikiConsolidationLocked(
        corpusId: string,
        jobId: string,
        targetId: string,
        signal?: AbortSignal,
    ): Promise<void> {
        const job = await this.viewStore.getViewBuild(corpusId, jobId);
        const result = job?.results.find((entry) => entry.viewId === targetId);
        const receipt = result?.wikiConsolidation;
        if (!result || !receipt)
            throw new ViewBuildStaleError(
                "Consolidation receipt was removed or forgotten",
            );
        if (receipt.stage === "stale") return;
        if (receipt.stage === "prepared" && job!.state === "cancelled")
            throw new ViewBuildStaleError(
                "Consolidation cancelled before canonical acceptance",
            );
        signal?.throwIfAborted();
        if (receipt.stage === "ready") {
            if (result.state !== "merged")
                await this.acknowledgeWikiConsolidation(
                    corpusId,
                    jobId,
                    targetId,
                );
            return;
        }
        await this.checkWikiContributionInput(
            receipt.input,
            receipt.stage === "prepared",
        );
        await this.assertInfluenceEligible(receipt.input);
        const canonical =
            receipt.stage === "prepared"
                ? await this.viewStore.acceptWikiConsolidation(
                      corpusId,
                      jobId,
                      targetId,
                  )
                : await this.viewStore.getView({
                      corpusId,
                      viewId: receipt.survivorViewId,
                  });
        signal?.throwIfAborted();
        if (
            !canonical ||
            (receipt.acceptedRevisionId &&
                canonical.revisionId !== receipt.acceptedRevisionId)
        )
            throw new ViewBuildStaleError(
                "Accepted consolidation changed before binding",
            );
        await this.assertViewPublicationFresh(canonical);
        await this.viewStore.activateWikiRedirect(corpusId, jobId, targetId);
        signal?.throwIfAborted();
        await this.cleanArchivedViewIndexes(corpusId);
        await this.recoverInformationalEffect(canonical);
        await this.acknowledgeWikiConsolidation(corpusId, jobId, targetId);
    }

    private async acknowledgeWikiConsolidation(
        corpusId: string,
        jobId: string,
        targetId: string,
    ): Promise<void> {
        await this.viewStore.updateViewBuild(corpusId, jobId, (current) => {
            const target = current.results.find(
                (entry) => entry.viewId === targetId,
            );
            if (!target?.wikiConsolidation)
                throw new ViewBuildStaleError(
                    "Consolidation receipt was forgotten",
                );
            target.wikiConsolidation.stage = "ready";
            target.state = "merged";
            target.revisionId =
                target.viewId === target.wikiConsolidation.survivorViewId
                    ? target.wikiConsolidation.acceptedRevisionId!
                    : target.wikiConsolidation.redirectRevisionId!;
            target.reason =
                "Qualified canonical accepted; old ID/anchors redirect; exact derivative index ready";
            if (current.state !== "running" && current.state !== "cancelled") {
                const successful = new Set([
                    "draft",
                    "merged",
                    "published",
                    "searchable",
                    "skipped",
                ]);
                current.state = current.results.every((entry) =>
                    successful.has(entry.state),
                )
                    ? "complete"
                    : "partial";
            }
        });
    }

    private async recoverWikiConsolidationsLocked(
        corpusId: string,
    ): Promise<void> {
        for (const job of await this.viewStore.listViewBuilds(corpusId))
            for (const result of job.results) {
                if (
                    !result.wikiConsolidation ||
                    result.wikiConsolidation.stage === "stale" ||
                    (result.wikiConsolidation.stage === "ready" &&
                        result.state === "merged")
                )
                    continue;
                try {
                    await this.resumeWikiConsolidationLocked(
                        corpusId,
                        job.jobId,
                        result.viewId,
                    );
                } catch (error) {
                    await this.viewStore.updateViewBuild(
                        corpusId,
                        job.jobId,
                        (current) => {
                            const target = current.results.find(
                                (entry) => entry.viewId === result.viewId,
                            );
                            if (!target?.wikiConsolidation)
                                throw new Error(
                                    "Consolidation recovery receipt disappeared",
                                );
                            const stale =
                                error instanceof ViewBuildStaleError ||
                                error instanceof ConsolidationTargetChanged;
                            target.state = stale ? "stale" : "failed";
                            target.reason = safeError(error);
                            if (stale) target.wikiConsolidation.stage = "stale";
                        },
                    );
                }
            }
    }

    private async contributeWikiSubject(
        job: ViewBuildJob,
        result: ViewBuildTargetResult,
        assessment: WikiSubjectAssessment,
        pages: WikiPagePurposeContext[],
        signal: AbortSignal,
    ): Promise<void> {
        const nominated = pages.find(
            (page) => page.viewId === assessment.canonicalViewId,
        );
        const current = await this.viewStore.getView({
            corpusId: job.corpusId,
            viewId: assessment.canonicalViewId,
        });
        if (!current || current.revisionId !== nominated?.revisionId)
            throw new ViewBuildStaleError(
                "Wiki contribution canonical changed after assessment",
            );
        this.viewBuilds.trackContribution(
            job.jobId,
            current.generation!.input!,
        );
        const input = wikiContributionInput(
            result.snapshot,
            current,
            assessment,
        );
        this.viewBuilds.trackContribution(job.jobId, input);
        await this.checkWikiContributionInput(input);
        signal.throwIfAborted();
        const candidate = await abortable(
            this.viewAdapter.generate(input, signal),
            signal,
        );
        signal.throwIfAborted();
        validateConstructedGuide(input, candidate);
        const { output, conflicts } = mergeView(
            current,
            candidate,
            input.inputs,
        );
        let verification = assessment;
        if (!conflicts.length) {
            validateConstructedGuide(input, output);
            const context = wikiPageContext(
                input,
                {
                    ...current,
                    definition: { ...current.definition, ...input.definition },
                    content: output.content,
                },
                undefined,
                false,
            );
            if (!this.viewAdapter.assessWikiSubject)
                throw new Error(
                    "Wiki contribution lacks actual-prose coverage checker",
                );
            verification = parseWikiAssessment(
                await abortable(
                    this.viewAdapter.assessWikiSubject(
                        input,
                        [context],
                        signal,
                    ),
                    signal,
                ),
                [context],
                input.wikiContribution?.essentialDistinctions,
            );
            if (verification.disposition !== "covered")
                throw new Error(
                    "Wiki canonical contribution did not cover all essential old/new distinctions in actual prose",
                );
        }
        await this.enqueueWrite(job.corpusId, async () => {
            signal.throwIfAborted();
            await this.recheckViewInput(result.snapshot);
            await this.checkWikiContributionInput(input);
            const saved = await this.viewStore.materializeViewBuild(
                job.corpusId,
                job.jobId,
                result.viewId,
                candidate,
                output,
                conflicts,
                undefined,
                { input, verification },
            );
            if (conflicts.length) return;
            if (!saved.wikiContribution)
                throw new Error("Durable Wiki contribution receipt missing");
            await this.bindWikiContribution(
                job,
                result,
                saved.wikiContribution,
                signal,
            );
        });
    }

    private async bindWikiContribution(
        job: ViewBuildJob,
        result: ViewBuildTargetResult,
        contribution: NonNullable<ViewBuildTargetResult["wikiContribution"]>,
        signal: AbortSignal,
    ): Promise<void> {
        signal.throwIfAborted();
        await this.recheckViewInput(result.snapshot);
        await this.checkWikiContributionInput(contribution.input, false);
        const canonical = await this.viewStore.getView({
            corpusId: job.corpusId,
            viewId: contribution.input.definition.viewId,
        });
        if (!canonical || canonical.revisionId !== contribution.revisionId)
            throw new ViewBuildStaleError(
                "Committed Wiki contribution canonical revision changed before binding",
            );
        await this.assertViewPublicationFresh(canonical);
        const context = wikiPageContext(
            contribution.input,
            canonical,
            undefined,
            false,
        );
        if (
            parseWikiAssessment(
                contribution.verification,
                [context],
                contribution.input.wikiContribution?.essentialDistinctions,
            ).disposition !== "covered"
        )
            throw new Error(
                "Wiki contribution binding requires verified complete actual-prose coverage",
            );
        let publication = await this.viewStore.getViewPublication({
            corpusId: job.corpusId,
            viewId: canonical.viewId,
        });
        if (publication.publishedRevisionId !== canonical.revisionId)
            publication =
                await this.viewStore.makeInformationalVisible(canonical);
        if (
            publication.indexState !== "ready" ||
            !(await this.informationalIndexReady(canonical))
        )
            publication = await this.indexViewLocked(canonical);
        signal.throwIfAborted();
        if (
            publication.indexState !== "ready" ||
            publication.blockedReason ||
            publication.publishedRevisionId !== canonical.revisionId
        )
            throw new Error(
                `Wiki contribution cannot bind before current derivative index is ready: ${publication.reason}`,
            );
        await this.viewStore.updateViewBuild(
            job.corpusId,
            job.jobId,
            (current) => {
                const target = current.results.find(
                    (entry) => entry.viewId === result.viewId,
                );
                if (
                    !target ||
                    current.state !== "running" ||
                    target.wikiAssessment?.disposition !== "contribute"
                )
                    throw new ViewBuildStaleError(
                        "Wiki contribution candidate is no longer active",
                    );
                target.wikiContribution = { ...contribution, state: "bound" };
                target.wikiAssessment.canonicalRevisionId =
                    canonical.revisionId;
                target.state = "skipped";
                target.reason = `Essential distinctions contributed to canonical ${canonical.viewId}; current publication/index binding complete`;
            },
        );
    }

    private async resumeWikiContribution(
        job: ViewBuildJob,
        result: ViewBuildTargetResult,
        signal: AbortSignal,
    ): Promise<boolean> {
        if (
            result.snapshot.pipeline !== "informational-wiki-v1" ||
            result.snapshot.expectedVersion !== 0
        )
            return false;
        const prior = (await this.viewStore.listViewBuilds(job.corpusId))
            .flatMap((entry) => entry.results)
            .find(
                (entry) =>
                    entry.viewId === result.viewId &&
                    entry.wikiContribution &&
                    sameViewBuildEvidence(entry.snapshot, result.snapshot),
            );
        if (!prior?.wikiContribution) return false;
        const canonical = await this.viewStore.getView({
            corpusId: job.corpusId,
            viewId: prior.wikiContribution.input.definition.viewId,
        });
        if (
            !canonical ||
            canonical.revisionId !== prior.wikiContribution.revisionId
        )
            return false;
        this.viewBuilds.trackContribution(
            job.jobId,
            prior.wikiContribution.input,
        );
        await this.enqueueWrite(job.corpusId, async () => {
            await this.viewStore.updateViewBuild(
                job.corpusId,
                job.jobId,
                (current) => {
                    const target = current.results.find(
                        (entry) => entry.viewId === result.viewId,
                    );
                    if (!target || !prior.wikiAssessment)
                        throw new Error(
                            "Wiki contribution retry receipt missing",
                        );
                    target.wikiAssessment = structuredClone(
                        prior.wikiAssessment,
                    );
                    target.wikiContribution = structuredClone(
                        prior.wikiContribution!,
                    );
                },
            );
            await this.bindWikiContribution(
                job,
                result,
                prior.wikiContribution!,
                signal,
            );
        });
        return true;
    }

    private async recordWikiAssessment(
        job: ViewBuildJob,
        result: ViewBuildTargetResult,
        assessment: WikiSubjectAssessment,
        pages: WikiPagePurposeContext[],
        signal: AbortSignal,
    ): Promise<void> {
        await this.enqueueWrite(job.corpusId, async () => {
            signal.throwIfAborted();
            await this.recheckViewInput(result.snapshot);
            const canonical = pages.find(
                (page) => page.viewId === assessment.canonicalViewId,
            );
            for (const nominated of pages) {
                const current = (
                    await this.wikiAdmissionPages(result.snapshot)
                ).find((page) => page.viewId === nominated.viewId);
                if (!current || current.revisionId !== nominated.revisionId)
                    throw new ViewBuildStaleError(
                        "Wiki purpose canonical page changed during assessment",
                    );
            }
            await this.viewStore.updateViewBuild(
                job.corpusId,
                job.jobId,
                (current) => {
                    const target = current.results.find(
                        (entry) => entry.viewId === result.viewId,
                    );
                    if (!target || current.state !== "running")
                        throw new ViewBuildStaleError(
                            "Wiki purpose target is no longer active",
                        );
                    target.wikiAssessment = {
                        ...assessment,
                        ...(canonical
                            ? { canonicalRevisionId: canonical.revisionId }
                            : {}),
                    };
                    if (result.snapshot.influenceSources)
                        target.snapshot.influenceSources = structuredClone(
                            result.snapshot.influenceSources,
                        );
                    if (assessment.disposition === "covered") {
                        target.state = "skipped";
                        target.reason = `Standalone purpose already covered by ${assessment.canonicalViewId}: ${assessment.reason}`;
                    } else if (assessment.disposition === "ambiguous") {
                        target.state = "blocked";
                        target.reason = `User decision required: multiple existing Wiki pages require explicit ambiguity review (${assessment.ambiguousViewIds.join(", ")}): ${assessment.reason}`;
                    }
                },
            );
        });
    }

    private async checkpointInformationalFamilies(
        job: ViewBuildJob,
    ): Promise<void> {
        if (job.state === "running" || !this.informationalWikiEnabled) return;
        const runtime = await this.getCorpusRuntime(job.corpusId);
        if (!runtime.index.listSubjects || !runtime.index.readFragments) return;
        for (const kind of ["projects", "wiki"] as const) {
            const results = job.results.filter(
                (result) =>
                    result.snapshot.pipeline ===
                    (kind === "wiki"
                        ? "informational-wiki-v1"
                        : "informational-project-summary-v1"),
            );
            if (!results.length) continue;
            const family = await this.viewStore.getWikiFamily(
                job.corpusId,
                kind,
            );
            family.dirty ||= job.state !== "complete";
            delete family.error;
            await this.viewStore.saveWikiFamily(job.corpusId, family, kind);
        }
        for (const kind of ["projects", "wiki"] as const) {
            const family = await this.viewStore.getWikiFamily(
                job.corpusId,
                kind,
            );
            if (family.enabled && family.dirty && !family.error)
                this.scheduleWikiMaintenance(job.corpusId, kind);
        }
    }

    private scheduleWikiMaintenance(
        corpusId: string,
        kind: "wiki" | "projects" = "wiki",
    ): void {
        const key = `${corpusId}:${kind}`;
        if (
            !this.informationalWikiEnabled ||
            this.closed ||
            this.batchStore.hasActiveImports(corpusId) ||
            this.wikiTimers.has(key)
        )
            return;
        const timer = setTimeout(() => {
            this.wikiTimers.delete(key);
            if (this.closed || this.batchStore.hasActiveImports(corpusId))
                return;
            const work = this.enqueueWrite(
                corpusId,
                async () => {
                    if (
                        this.closed ||
                        this.batchStore.hasActiveImports(corpusId)
                    )
                        return;
                    const runtime = await this.getCorpusRuntime(corpusId, true);
                    if (runtime.manifest.authorizedSourceRemoval) return;
                    const family = await this.viewStore.getWikiFamily(
                        corpusId,
                        kind,
                    );
                    if (!family.enabled || !family.dirty || family.error)
                        return;
                    const snapshot = await this.viewStore.listViews(corpusId);
                    if (this.batchStore.hasActiveImports(corpusId)) return;
                    try {
                        await this.maintainWikiFamily(
                            runtime,
                            {
                                corpusId,
                                expectedHead: snapshot.head,
                                family: kind,
                                operation: "update",
                            },
                            true,
                        );
                    } catch (error) {
                        const family = await this.viewStore.getWikiFamily(
                            corpusId,
                            kind,
                        );
                        family.dirty = true;
                        family.error = safeError(error);
                        await this.viewStore.saveWikiFamily(
                            corpusId,
                            family,
                            kind,
                        );
                    }
                },
                true,
            );
            this.indexedReads.add(work);
            void work.then(
                () => this.indexedReads.delete(work),
                (error: unknown) => {
                    this.indexedReads.delete(work);
                    this.wikiMaintenanceFailures.set(
                        key,
                        new Error(safeError(error)),
                    );
                },
            );
        }, 250);
        this.wikiTimers.set(key, timer);
    }

    private deferBatchMaintenance(
        corpusId: string,
        automatic: boolean,
    ): boolean {
        return automatic && this.batchStore.hasActiveImports(corpusId);
    }

    private resumeBatchMaintenance(corpusId: string): void {
        if (this.closed || this.batchStore.hasActiveImports(corpusId)) return;
        const runtime = this.corpora.get(corpusId);
        if (!runtime) return;
        this.scheduleTopics(corpusId, runtime);
        if (!runtime.index.listSubjects || !runtime.index.readFragments) return;
        for (const kind of ["projects", "wiki"] as const)
            this.scheduleWikiMaintenance(corpusId, kind);
    }

    private startMaintenanceReconciliation(): void {
        if (this.closed) return;
        this.reconciliationTimer = setInterval(() => {
            for (const [corpusId, runtime] of this.corpora) {
                if (
                    !this.informationalWikiEnabled &&
                    !this.sourceSynopsesEnabled &&
                    !runtime.manifest.authorizedSourceRemoval
                )
                    continue;
                const work = this.enqueueWrite(
                    corpusId,
                    async () => {
                        if (runtime.manifest.authorizedSourceRemoval)
                            await this.completeAuthorizedSourceRemoval(
                                corpusId,
                                runtime,
                            );
                        this.scheduleSourceSynopses(corpusId);
                        await this.reconcileTopics(corpusId, runtime);
                        if (!this.informationalWikiEnabled) return;
                        await this.recoverWikiConsolidationsLocked(corpusId);
                        const views = (await this.viewStore.listViews(corpusId))
                            .views;
                        for (const kind of ["projects", "wiki"] as const) {
                            const family =
                                await this.reconcileInformationalFamily(
                                    corpusId,
                                    kind,
                                    runtime.manifest.indexGeneration,
                                    views,
                                );
                            if (family.enabled && family.dirty && !family.error)
                                this.scheduleWikiMaintenance(corpusId, kind);
                        }
                    },
                    true,
                );
                this.indexedReads.add(work);
                void work.then(
                    () => {
                        this.indexedReads.delete(work);
                        this.wikiMaintenanceFailures.delete(
                            `${corpusId}:reconciliation`,
                        );
                    },
                    (error: unknown) => {
                        this.indexedReads.delete(work);
                        this.wikiMaintenanceFailures.set(
                            `${corpusId}:reconciliation`,
                            new Error(safeError(error)),
                        );
                    },
                );
            }
        }, 30_000);
        this.reconciliationTimer.unref();
    }

    private async reconcileInformationalFamily(
        corpusId: string,
        kind: "wiki" | "projects",
        indexGeneration: string | undefined,
        views: ViewVersion[],
    ): Promise<WikiFamilyState> {
        const family = await this.viewStore.getWikiFamily(corpusId, kind);
        const before = JSON.stringify(family);
        for (const view of views.filter(
            (view) =>
                view.state === "draft" &&
                (kind === "wiki"
                    ? !!view.definition.wiki
                    : !!view.definition.projectSummary),
        )) {
            const publication = await this.viewStore.getViewPublication({
                corpusId,
                viewId: view.viewId,
            });
            if (
                publication.publishedRevisionId !== view.revisionId ||
                publication.indexState !== "ready" ||
                !(await this.informationalIndexReady(view))
            )
                family.dirty = true;
        }
        if (family.indexVersion !== indexGeneration) {
            family.dirty = true;
            family.cursor = 0;
            delete family.error;
        }
        if (
            !family.dirty &&
            (await this.informationalRecipeChanged(corpusId, kind, views))
        ) {
            family.dirty = true;
            family.cursor = 0;
            delete family.error;
        }
        if (JSON.stringify(family) !== before)
            await this.viewStore.saveWikiFamily(corpusId, family, kind);
        return family;
    }

    private async informationalRecipeChanged(
        corpusId: string,
        kind: "wiki" | "projects",
        views: ViewVersion[],
    ): Promise<boolean> {
        const changed = views.flatMap((view) => {
            if (
                view.state !== "draft" ||
                !view.generation?.input ||
                !(kind === "wiki"
                    ? view.definition.wiki
                    : view.definition.projectSummary)
            )
                return [];
            const model = viewSynthesisIdentity(
                this.viewAdapter.identity,
                view.definition,
                !!this.viewAdapter.assessWikiConsolidation &&
                    !!this.viewAdapter.checkWikiConsolidation,
            );
            return view.generation.input.model === model
                ? []
                : [{ view, model }];
        });
        if (!changed.length) return false;
        const jobs = await this.viewStore.listViewBuilds(corpusId);
        return changed.some(
            ({ view, model }) =>
                !jobs.some((job) =>
                    job.results.some(
                        (result) =>
                            result.viewId === view.viewId &&
                            result.snapshot.model === model &&
                            result.snapshot.targetRevisionId ===
                                view.revisionId &&
                            result.snapshot.definitionRevisionId ===
                                view.definition.revisionId,
                    ),
                ),
        );
    }

    private async assertInfluenceEligible(
        input?: Pick<ViewBuildSnapshot, "corpusId" | "influenceSources">,
    ): Promise<void> {
        if (!input?.influenceSources?.length) return;
        const runtime = await this.getCorpusRuntime(input.corpusId);
        for (const influence of input.influenceSources) {
            const source = runtime.manifest.sources.find(
                (entry) => entry.sourceId === influence.sourceId,
            );
            if (
                runtime.manifest.authorizedSourceRemoval?.sourceId ===
                    influence.sourceId ||
                source?.activeRevisionId !== influence.revisionId ||
                !source.revisions.some(
                    (revision) =>
                        revision.revisionId === influence.revisionId &&
                        revision.state === "ready",
                ) ||
                runtime.manifest.knowledgeSuppressions?.some(
                    (entry) => entry.sourceId === influence.sourceId,
                )
            )
                throw new ViewBuildStaleError(
                    "Read-but-not-cited evidence was replaced or forgotten",
                );
        }
    }

    private async maintainWikiFamily(
        runtime: CorpusRuntime,
        request: Extract<
            ViewMaintenanceRequest,
            { family: "wiki" | "projects" }
        >,
        automatic = false,
    ): Promise<ViewMaintenanceResult> {
        const corpusId = request.corpusId;
        const kind = request.family;
        if (!this.informationalWikiEnabled)
            throw new Error(
                "Informational views are explicitly disabled by this host",
            );
        const snapshot = await this.viewStore.listViews(corpusId);
        if (snapshot.head !== request.expectedHead)
            throw new ViewBuildStaleError("Wiki-family history head changed");
        const family = await this.viewStore.getWikiFamily(corpusId, kind);
        const plan: ViewMaintenancePlan = {
            corpusId,
            expectedHead: snapshot.head,
            targets: [],
        };
        await this.applyInformationalFamilyOperation(request, family);
        if (!family.enabled) return this.viewStore.recordViewMaintenance(plan);
        const active = await this.viewStore.listViewBuilds(corpusId);
        if (active.some((job) => job.state === "running"))
            return this.viewStore.recordViewMaintenance(plan);
        if (
            !family.dirty &&
            family.indexVersion === runtime.manifest.indexGeneration
        )
            return this.viewStore.recordViewMaintenance(plan);
        if (!runtime.index.listSubjects || !runtime.index.readFragments)
            throw new Error(
                "Host does not support indexed wiki candidate discovery",
            );
        const eligible = runtime.manifest.sources.filter((source) =>
            source.revisions.some(
                (revision) =>
                    revision.revisionId === source.activeRevisionId &&
                    revision.state === "ready",
            ),
        );
        if (!eligible.length) {
            family.dirty = false;
            family.cursor = 0;
            family.descriptors = [];
            await this.viewStore.saveWikiFamily(corpusId, family, kind);
            return this.viewStore.recordViewMaintenance(plan);
        }
        await this.ensureDocumentIndex(corpusId, runtime);
        const page = await runtime.index.listSubjects(
            family.cursor,
            48,
            new Set(eligible.map((source) => source.sourceId)),
        );
        const subjects = await runtime.index.getKnowledgeGraph(
            new Set(eligible.map((source) => source.sourceId)),
        );
        const subjectNames = new Set(
            [
                ...subjects.entities.map((subject) => subject.name),
                ...subjects.topics.map((subject) => subject.name),
                ...page.items.map((subject) => subject.term),
            ].map((name) => name.trim().toLocaleLowerCase()),
        );
        const descriptors = family.descriptors.filter(
            (descriptor) =>
                snapshot.views.some(
                    (view) => view.viewId === descriptor.viewId,
                ) ||
                subjectNames.has(descriptor.query.trim().toLocaleLowerCase()),
        );
        if (descriptors.length !== family.descriptors.length) {
            family.descriptors = descriptors;
            family.cursor = 0;
        }
        discoverInformationalDescriptors(
            family,
            kind === "projects"
                ? page.items.filter((subject) => subject.initiative)
                : page.items,
            snapshot.views,
            kind,
        );
        const { targets, snapshots } = await this.prepareWikiTargets(
            corpusId,
            family,
            snapshot.views,
            eligible,
            request.operation === "rebuild",
            plan,
            kind,
        );
        // Save discovered identities while leaving unadmitted work retryable.
        await this.viewStore.saveWikiFamily(corpusId, family, kind);
        if (this.deferBatchMaintenance(corpusId, automatic))
            return this.viewStore.recordViewMaintenance(plan);
        const nextFamily = structuredClone(family);
        const admittedIds = new Set(
            targets.map((target) => target.definition.viewId),
        );
        nextFamily.descriptors = [
            ...nextFamily.descriptors.filter(
                (descriptor) => !admittedIds.has(descriptor.viewId),
            ),
            ...nextFamily.descriptors.filter((descriptor) =>
                admittedIds.has(descriptor.viewId),
            ),
        ];
        nextFamily.cursor = Number(page.nextContinuationToken ?? 0);
        if (runtime.manifest.indexGeneration)
            nextFamily.indexVersion = runtime.manifest.indexGeneration;
        else delete nextFamily.indexVersion;
        nextFamily.dirty =
            !!page.nextContinuationToken || targets.length === 12;
        if (!nextFamily.dirty) {
            const decisions = plan.targets.filter(
                (target) =>
                    target.state === "blocked" &&
                    target.reason.startsWith("User decision required:"),
            );
            if (decisions.length)
                nextFamily.error = `${decisions[0].reason}; ${decisions.length} targets require decisions; independent maintenance continues`;
        }
        if (!targets.length) {
            await this.viewStore.saveWikiFamily(corpusId, nextFamily, kind);
            if (nextFamily.dirty && !nextFamily.error)
                this.scheduleWikiMaintenance(corpusId, kind);
            return this.viewStore.recordViewMaintenance(plan);
        }
        const head = (await this.viewStore.listViews(corpusId)).head;
        if (this.deferBatchMaintenance(corpusId, automatic))
            return this.viewStore.recordViewMaintenance(plan);
        const buildRequest = { corpusId, expectedHead: head, targets };
        validateBuildRequest(buildRequest);
        const reservation = this.viewBuilds.reserve();
        try {
            const admitted = await this.viewStore.admitViewBuild(
                buildRequest,
                snapshots,
                plan,
                nextFamily,
                kind,
            );
            if (admitted.admitted) reservation.start(admitted.job);
            return await this.viewStore.recordViewMaintenance(
                plan,
                admitted.job,
            );
        } finally {
            reservation.release();
        }
    }

    private async applyInformationalFamilyOperation(
        request: Extract<
            ViewMaintenanceRequest,
            { family: "wiki" | "projects" }
        >,
        family: WikiFamilyState,
    ): Promise<void> {
        if (request.operation !== "pause") {
            delete family.error;
            if (request.operation === "update") family.dirty = true;
        }
        if (request.operation === "pause" || request.operation === "resume") {
            family.enabled = request.operation === "resume";
            family.dirty ||= family.enabled;
        }
        if (request.operation === "rebuild") {
            family.dirty = true;
            family.cursor = 0;
        }
        await this.viewStore.saveWikiFamily(
            request.corpusId,
            family,
            request.family,
        );
    }

    private async prepareWikiTargets(
        corpusId: string,
        family: WikiFamilyState,
        views: ViewVersion[],
        eligible: StoredSource[],
        rebuild: boolean,
        plan: ViewMaintenancePlan,
        kind: "wiki" | "projects",
    ): Promise<{ targets: ViewBuildTarget[]; snapshots: ViewBuildSnapshot[] }> {
        const targets: ViewBuildTarget[] = [];
        const snapshots: ViewBuildSnapshot[] = [];
        for (const descriptor of family.descriptors) {
            if (targets.length === 12) break;
            const current = views.find(
                (view) => view.viewId === descriptor.viewId,
            );
            if (
                !current &&
                kind === "wiki" &&
                !usefulWikiSubjectLabel(descriptor.query)
            ) {
                retireWikiCandidate(family, descriptor.viewId, plan);
                continue;
            }
            const target = this.informationalFamilyTarget(
                descriptor,
                current,
                eligible,
                kind,
                plan,
            );
            if (!target) continue;
            try {
                const input = await this.snapshotInformationalTarget(
                    corpusId,
                    target,
                    current,
                );
                if (
                    !current &&
                    kind === "wiki" &&
                    !usefulWikiSubject(
                        descriptor.query,
                        input.inputs
                            .map((source) => source.content)
                            .join("\n\n"),
                    )
                ) {
                    retireWikiCandidate(family, descriptor.viewId, plan);
                    continue;
                }
                target.definition = input.definition;
                const contributionConflict =
                    kind === "wiki" && !current
                        ? await this.viewStore.pendingWikiContributionConflict(
                              input,
                          )
                        : undefined;
                if (
                    contributionConflict &&
                    (await this.informationalVersionEligible(
                        contributionConflict.human,
                    ))
                ) {
                    plan.targets.push({
                        viewId: descriptor.viewId,
                        expectedVersion: 0,
                        state: "blocked",
                        reason: `User decision required: resolve canonical edit conflict ${contributionConflict.conflictId}`,
                    });
                    continue;
                }
                if (
                    current &&
                    sameViewBuildEvidence(current?.generation?.input, input) &&
                    !rebuild
                ) {
                    await this.recoverInformationalEffect(current);
                    continue;
                }
                if (
                    !rebuild &&
                    (await this.viewStore.hasPendingInformationalInput(
                        corpusId,
                        descriptor.viewId,
                        input,
                    ))
                )
                    continue;
                targets.push(target);
                snapshots.push(input);
                plan.targets.push({
                    viewId: descriptor.viewId,
                    expectedVersion: target.expectedVersion,
                    state: "rebuild",
                    reason: "Indexed wiki selector has new evidence",
                    selector: target.definition.selector,
                });
            } catch (error) {
                if (!(error instanceof Error) || "code" in error) throw error;
                plan.targets.push({
                    viewId: descriptor.viewId,
                    expectedVersion: target.expectedVersion,
                    state: "blocked",
                    reason: `Technical target rejection: ${safeError(error)}`,
                });
            }
        }
        return { targets, snapshots };
    }

    private informationalFamilyTarget(
        descriptor: WikiFamilyState["descriptors"][number],
        current: ViewVersion | undefined,
        eligible: StoredSource[],
        kind: "wiki" | "projects",
        plan: ViewMaintenancePlan,
    ): ViewBuildTarget | undefined {
        if (current?.state === "archived") return undefined;
        const retrieval =
            current?.definition.wiki ?? current?.definition.projectSummary;
        const sources = eligible
            .filter(
                (source) =>
                    !retrieval?.excludedSourceIds.includes(source.sourceId),
            )
            .map((source) => ({
                sourceId: source.sourceId,
                revisionId: source.activeRevisionId,
            }));
        if (!sources.length) {
            plan.targets.push({
                viewId: descriptor.viewId,
                expectedVersion: current?.version ?? 0,
                state: "blocked",
                reason: `User decision required: ${kind} refresh blocked: all matching sources are excluded. Change exclusions or archive the view.`,
            });
            return undefined;
        }
        return {
            expectedVersion: current?.version ?? 0,
            definition: {
                viewId: descriptor.viewId,
                kind: kind === "wiki" ? "wiki" : "projectBrief",
                selector: { kind: "sources", sources },
                ...(kind === "wiki"
                    ? {
                          wiki: current?.definition.wiki ?? {
                              construction: "informational-wiki-v1",
                              query: descriptor.query,
                              aliases: [],
                              excludedSourceIds: [],
                          },
                      }
                    : {
                          projectSummary: current?.definition
                              .projectSummary ?? {
                              construction: "informational-project-summary-v1",
                              query: descriptor.query,
                              aliases: [],
                              excludedSourceIds: [],
                          },
                      }),
            },
        };
    }

    private async snapshotViewTarget(
        corpusId: string,
        target: ViewBuildTarget,
        bounds: ViewBuildRequest["bounds"],
        buildOverride?: boolean,
        retrieval?: ViewBuildSnapshot["informationalRetrieval"] | false,
    ): Promise<ViewBuildSnapshot> {
        const runtime = await this.getCorpusRuntime(corpusId);
        const current = await this.viewStore.getView({
            corpusId,
            viewId: target.definition.viewId,
        });
        if (
            (current?.version ?? 0) !== target.expectedVersion ||
            current?.state === "archived"
        )
            throw new ViewBuildStaleError(
                "View target version is stale or archived",
            );
        if (target.definition.wiki || target.definition.projectSummary)
            return this.snapshotInformationalTarget(
                corpusId,
                target,
                current,
                retrieval,
            );
        if (target.definition.kind === "wiki")
            throw new Error("Wiki construction requires informational-wiki-v1");
        const maintenance = this.resolveMaintenanceTarget(
            target.definition,
            runtime,
            bounds ?? {},
            current,
        );
        assertMaintenanceMembership(target, current, maintenance);
        const inputs = target.definition.selector.sources.map((selected) => {
            const source = runtime.manifest.sources.find(
                (entry) => entry.sourceId === selected.sourceId,
            );
            const revision = source?.revisions.find(
                (entry) => entry.revisionId === selected.revisionId,
            );
            if (
                !source ||
                !revision ||
                revision.state !== "ready" ||
                source.activeRevisionId !== selected.revisionId
            )
                throw new ViewBuildStaleError(
                    "Selected source is unavailable or no longer the current exact retained revision",
                );
            if (target.definition.kind === "timeline")
                return timelineDocumentInput(
                    {
                        ...selected,
                        title: source.title,
                        content: revision.content,
                        capturedAt: revision.capturedAt,
                    },
                    bounds ?? {},
                );
            const learnedAt = revision.capturedAt;
            const occurredAt = revision.sourceModifiedAt;
            if (
                (bounds?.learnedBefore &&
                    (!learnedAt ||
                        Date.parse(learnedAt) >
                            Date.parse(bounds.learnedBefore))) ||
                (bounds?.occurredFrom &&
                    (!occurredAt ||
                        Date.parse(occurredAt) <
                            Date.parse(bounds.occurredFrom))) ||
                (bounds?.occurredTo &&
                    (!occurredAt ||
                        Date.parse(occurredAt) > Date.parse(bounds.occurredTo)))
            )
                throw new ViewBuildStaleError(
                    "Selected complete source is outside the temporal bounds or lacks a required timestamp; no source truncation is applied",
                );
            return {
                ...selected,
                title: source.title,
                content: revision.content,
                contentHash: viewHash(revision.content),
                ...(learnedAt === undefined ? {} : { learnedAt }),
                ...(occurredAt === undefined ? {} : { occurredAt }),
            };
        });
        for (const selected of target.definition.selector.events ?? []) {
            const event = runtime.events.find(
                (entry) => entry.eventId === selected.eventId,
            );
            if (!event || isSuppressedEvent(runtime, event))
                throw new ViewBuildStaleError(
                    "Selected canonical event is missing or suppressed",
                );
            inputs.push(timelineEventInput(event, bounds ?? {}));
        }
        if (
            inputs.reduce((count, input) => count + input.content.length, 0) >
            120_000
        )
            throw new Error(
                "Complete view inputs exceed 120000 UTF-16 characters; no truncation applied",
            );
        const snapshot = {
            corpusId,
            actor: userInfo().username,
            definition: structuredClone(target.definition),
            ...(current
                ? {
                      definitionRevisionId: current.definition.revisionId,
                      targetRevisionId: current.revisionId,
                  }
                : {}),
            expectedVersion: target.expectedVersion,
            bounds: bounds ?? {},
            inputs:
                target.definition.kind === "timeline"
                    ? inputs.filter((input) => input.records?.length)
                    : inputs,
            ...(target.definition.kind === "timeline"
                ? {
                      selectionFingerprint: viewHash(
                          inputs.map((input) => [
                              input.sourceId,
                              input.evidence,
                              input.revisionId,
                              input.contentHash,
                              input.records,
                          ]),
                      ),
                  }
                : {}),
            pipeline:
                target.definition.kind === "timeline"
                    ? ("timeline-v1" as const)
                    : ("troubleshooting-v1" as const),
            model: this.viewAdapter.identity,
            publicationPolicy: effectiveViewPublicationPolicy(
                await this.viewStore.getViewPublicationPolicy(corpusId),
                target.definition.viewId,
                buildOverride,
            ),
            ...(maintenance.snapshot
                ? { maintenance: maintenance.snapshot }
                : {}),
        };
        return { ...snapshot, fingerprint: viewHash(snapshot) };
    }

    private topicSources(runtime: CorpusRuntime) {
        return runtime.manifest.sources
            .filter(
                (source) =>
                    source.revisions.some(
                        (revision) =>
                            revision.revisionId === source.activeRevisionId &&
                            revision.state === "ready",
                    ) &&
                    !runtime.manifest.knowledgeSuppressions?.some(
                        (entry) => entry.sourceId === source.sourceId,
                    ),
            )
            .map((source) => ({
                sourceId: source.sourceId,
                revisionId: source.activeRevisionId,
            }));
    }

    private topicFingerprint(runtime: CorpusRuntime): string {
        return topicInputFingerprint(
            this.topicSources(runtime),
            runtime.manifest.indexGeneration,
            runtime.manifest.knowledgeSuppressions ?? [],
            this.viewAdapter.identity,
        );
    }

    public async queryTopics(
        request: TopicQueryRequest,
    ): Promise<TopicQueryPage> {
        const runtime = await this.requireViews(request.corpusId);
        requireTopicIndex(runtime.index);
        return runtime.access.read(async () => {
            const page = await this.viewStore.queryTopics(
                request,
                this.topicFingerprint(runtime),
            );
            if (runtime.manifest.knowledgeSuppressions?.length)
                page.limits.push(
                    "Sources containing suppressed knowledge are withheld because retained original blocks cannot safely isolate forgotten influence.",
                );
            return page;
        });
    }

    public async rebuildTopics(corpusId: string): Promise<ViewBuildJob> {
        const runtime = await this.requireViews(corpusId);
        requireTopicIndex(runtime.index);
        const receipt = await this.enqueueWrite(corpusId, async () => {
            const { head } = await this.viewStore.getTopicState(corpusId);
            return this.maintainTopics(runtime, {
                corpusId,
                expectedHead: head,
                family: "topics",
                operation: "rebuild",
            });
        });
        if (!receipt.job)
            throw new Error(
                "Topic rebuild was not admitted; another view build is active or the family is paused",
            );
        return receipt.job;
    }

    private async maintainTopics(
        runtime: CorpusRuntime,
        request: Extract<ViewMaintenanceRequest, { family: string }>,
        automatic = false,
    ): Promise<ViewMaintenanceResult> {
        requireTopicIndex(runtime.index);
        if (!this.informationalWikiEnabled)
            throw new Error(
                "Informational views are explicitly disabled by this host",
            );
        const state = await this.viewStore.getTopicState(request.corpusId);
        if (state.head !== request.expectedHead)
            throw new ViewBuildStaleError("Topic-family history head changed");
        const plan: ViewMaintenancePlan = {
            corpusId: request.corpusId,
            expectedHead: state.head,
            targets: [],
        };
        const family = applyTopicFamilyOperation(
            state.family,
            request.operation,
        );
        const jobs = await this.viewStore.listViewBuilds(request.corpusId);
        const running = jobs.find((job) => job.state === "running");
        if (running || !family.enabled) {
            await this.viewStore.saveTopicFamily(request.corpusId, family);
            return this.viewStore.recordViewMaintenance(
                plan,
                running?.results.some(
                    (result) => result.snapshot.pipeline === "topics-v1",
                )
                    ? running
                    : undefined,
            );
        }
        if (
            !topicFamilyCanSchedule(family) &&
            state.snapshot?.inputFingerprint === this.topicFingerprint(runtime)
        )
            return this.viewStore.recordViewMaintenance(plan);
        await this.ensureDocumentIndex(request.corpusId, runtime);
        const input = await captureTopicBuild({
            corpusId: request.corpusId,
            actor: userInfo().username,
            index: runtime.index,
            sources: this.topicSources(runtime),
            suppressions: runtime.manifest.knowledgeSuppressions ?? [],
            model: this.viewAdapter.identity,
            ...(runtime.manifest.indexGeneration
                ? { indexGeneration: runtime.manifest.indexGeneration }
                : {}),
            ...(state.snapshot ? { current: state.snapshot } : {}),
        });
        if (this.deferBatchMaintenance(request.corpusId, automatic))
            return this.viewStore.recordViewMaintenance(plan);
        const reservation = this.viewBuilds.reserve();
        try {
            const admitted = await this.viewStore.admitTopicBuild(
                input,
                state.head,
                family,
            );
            if (admitted.admitted) reservation.start(admitted.job);
            return this.viewStore.recordViewMaintenance(plan, admitted.job);
        } finally {
            reservation.release();
        }
    }

    private writeTopics(
        job: ViewBuildJob,
        result: ViewBuildTargetResult,
        snapshot: TopicSnapshot,
        signal: AbortSignal,
        complete: boolean,
    ): Promise<void> {
        return this.enqueueWrite(job.corpusId, async () => {
            signal.throwIfAborted();
            await this.assertInfluenceEligible(result.snapshot);
            const runtime = await this.getCorpusRuntime(job.corpusId);
            if (result.snapshot.fingerprint !== this.topicFingerprint(runtime))
                throw new ViewBuildStaleError(
                    "Topic source/index eligibility changed during generation",
                );
            await this.viewStore.materializeTopicBuild(
                job.corpusId,
                job.jobId,
                snapshot,
                complete,
            );
        });
    }

    private async checkpointTopics(job: ViewBuildJob): Promise<void> {
        if (job.state === "running") return;
        const runtime = await this.getCorpusRuntime(job.corpusId);
        if (
            job.results.some(
                (result) => result.snapshot.pipeline === "topics-v1",
            )
        ) {
            const { family } = await this.viewStore.getTopicState(job.corpusId);
            await this.viewStore.saveTopicFamily(
                job.corpusId,
                checkpointTopicFamily(
                    family,
                    job,
                    await this.viewStore.listViewBuilds(job.corpusId),
                ),
            );
        }
        await this.reconcileTopics(job.corpusId, runtime);
    }

    private async reconcileTopics(
        corpusId: string,
        runtime: CorpusRuntime,
    ): Promise<void> {
        if (
            !this.informationalWikiEnabled ||
            !supportsTopicIndex(runtime.index)
        )
            return;
        const state = await this.viewStore.getTopicState(corpusId);
        let family = reconcileTopicFamily(
            state.family,
            runtime.manifest.indexGeneration,
        );
        const jobs = await this.viewStore.listViewBuilds(corpusId);
        const latest = jobs.filter((job) =>
            job.results.some(
                (result) => result.snapshot.pipeline === "topics-v1",
            ),
        )[0];
        if (latest?.state === "interrupted")
            family = checkpointTopicFamily(family, latest, jobs);
        await this.viewStore.saveTopicFamily(corpusId, family);
        if (topicFamilyCanSchedule(family))
            this.scheduleTopics(corpusId, runtime);
    }

    private scheduleTopics(corpusId: string, runtime: CorpusRuntime): void {
        const key = `${corpusId}:topics`;
        if (
            !this.informationalWikiEnabled ||
            this.closed ||
            this.batchStore.hasActiveImports(corpusId) ||
            this.wikiTimers.has(key) ||
            !runtime.manifest.sources.length ||
            !supportsTopicIndex(runtime.index)
        )
            return;
        const timer = setTimeout(() => {
            this.wikiTimers.delete(key);
            if (this.closed || this.batchStore.hasActiveImports(corpusId))
                return;
            const work = this.enqueueWrite(
                corpusId,
                async () => {
                    if (
                        this.closed ||
                        this.batchStore.hasActiveImports(corpusId) ||
                        runtime.manifest.authorizedSourceRemoval
                    )
                        return;
                    const state = await this.viewStore.getTopicState(corpusId);
                    const family = reconcileTopicFamily(
                        state.family,
                        runtime.manifest.indexGeneration,
                    );
                    if (!topicFamilyCanSchedule(family)) return;
                    if (this.batchStore.hasActiveImports(corpusId)) return;
                    try {
                        await this.maintainTopics(
                            runtime,
                            {
                                corpusId,
                                expectedHead: state.head,
                                family: "topics",
                                operation: "update",
                            },
                            true,
                        );
                    } catch (error) {
                        await this.viewStore.saveTopicFamily(corpusId, {
                            ...family,
                            dirty: true,
                            error: safeError(error),
                        });
                    }
                },
                true,
            );
            this.indexedReads.add(work);
            void work.then(
                () => this.indexedReads.delete(work),
                (error: unknown) => {
                    this.indexedReads.delete(work);
                    this.wikiMaintenanceFailures.set(
                        key,
                        new Error(safeError(error)),
                    );
                },
            );
        }, 250);
        this.wikiTimers.set(key, timer);
    }

    private async recheckViewInput(input: ViewBuildSnapshot): Promise<void> {
        await this.assertInfluenceEligible(input);
        const snapshot = await this.snapshotViewTarget(
            input.corpusId,
            {
                definition: input.definition,
                expectedVersion: input.expectedVersion,
            },
            input.bounds,
            input.publicationPolicy?.buildOverride,
            input.informationalRetrieval ?? false,
        );
        if (snapshot.fingerprint !== input.fingerprint)
            throw new ViewBuildStaleError(
                !input.informationalRetrieval &&
                (input.definition.wiki || input.definition.projectSummary)
                    ? "Legacy informational snapshot lacks original retrieval context; rebuild from intended scope"
                    : "View definition, membership, access, target or retained source changed during generation",
            );
    }

    public async buildViews(request: ViewBuildRequest): Promise<ViewBuildJob> {
        validateBuildRequest(request);
        await this.requireViews(request.corpusId);
        if (
            !this.informationalWikiEnabled &&
            request.targets.some(
                (target) =>
                    target.definition.wiki || target.definition.projectSummary,
            )
        )
            throw new Error(
                "Informational views are explicitly disabled by this host",
            );
        const existing = (await this.listViewBuilds(request.corpusId)).find(
            (job) =>
                viewHash(job.request) === viewHash(request) &&
                job.results.every(
                    (result) =>
                        result.snapshot.model ===
                        viewSynthesisIdentity(
                            this.viewAdapter.identity,
                            result.snapshot.definition,
                            !!this.viewAdapter.assessWikiConsolidation &&
                                !!this.viewAdapter.checkWikiConsolidation,
                        ),
                ),
        );
        if (existing) return existing;
        const admitted = await this.enqueueWrite(request.corpusId, async () => {
            const reservation = this.viewBuilds.reserve();
            try {
                const snapshots: ViewBuildSnapshot[] = [];
                for (const target of request.targets)
                    snapshots.push(
                        await this.snapshotViewTarget(
                            request.corpusId,
                            target,
                            request.bounds,
                            request.publication,
                        ),
                    );
                const admitted = await this.viewStore.admitViewBuild(
                    request,
                    snapshots,
                );
                if (admitted.admitted) reservation.start(admitted.job);
                return admitted;
            } finally {
                reservation.release();
            }
        });
        return admitted.job;
    }

    private resolveMaintenanceTarget(
        definition: ViewDefinitionInput,
        runtime: CorpusRuntime,
        bounds: ViewBuildRequest["bounds"],
        current?: ViewVersion,
    ): ViewMaintenanceTargetPlan {
        const events = (definition.selector.events ?? []).map((selected) =>
            runtime.events.find(
                (event) =>
                    event.eventId === selected.eventId &&
                    !isSuppressedEvent(runtime, event),
            ),
        );
        const plan = resolveViewMaintenance(
            definition,
            runtime.manifest.sources,
            this.viewAdapter.identity,
            bounds ?? {},
            current,
            viewHash(events),
        );
        if (plan.state === "pinned") return plan;
        if (events.some((event) => !event))
            return {
                ...plan,
                state: "blocked",
                reason: "A configured canonical event is missing or suppressed",
            };
        if (
            (runtime.manifest.knowledgeSuppressions ?? []).some((suppression) =>
                plan.selector?.sources.some(
                    (source) => source.sourceId === suppression.sourceId,
                ),
            )
        )
            return {
                ...plan,
                state: "blocked",
                reason: "Eligible source has suppressed knowledge; reconcile scope before constructing from retained text",
            };
        return plan;
    }

    private async planMaintenanceLocked(
        runtime: CorpusRuntime,
        viewIds: string[],
    ): Promise<ViewMaintenancePlan> {
        const snapshot = await this.viewStore.listViews(
            runtime.manifest.corpus.corpusId,
        );
        return {
            corpusId: runtime.manifest.corpus.corpusId,
            expectedHead: snapshot.head,
            targets: viewIds.map((viewId) => {
                const view = snapshot.views.find(
                    (entry) => entry.viewId === viewId,
                );
                if (!view || view.state === "archived")
                    return {
                        viewId,
                        expectedVersion: view?.version ?? 0,
                        state: "blocked",
                        reason: "View is missing or archived",
                    };
                if (view.definition.maintenance && !view.generation?.input)
                    return {
                        viewId,
                        expectedVersion: view.version,
                        state: "blocked",
                        reason: "Unknown generated base; explicit grounded build is required",
                    };
                return this.resolveMaintenanceTarget(
                    derivedDefinitionInput(view),
                    runtime,
                    view.generation?.input?.bounds,
                    view,
                );
            }),
        };
    }

    public async planViewMaintenance(
        request: ViewMaintenancePlanRequest,
    ): Promise<ViewMaintenancePlan> {
        validateMaintenanceRequest(request, false);
        const runtime = await this.requireViews(request.corpusId);
        return runtime.access.read(() =>
            this.planMaintenanceLocked(runtime, request.viewIds),
        );
    }

    public async maintainViews(
        request: ViewMaintenanceRequest,
    ): Promise<ViewMaintenanceResult> {
        validateMaintenanceRequest(request, true);
        const runtime = await this.requireViews(request.corpusId);
        if ("family" in request) {
            const key = `${request.corpusId}:${request.family}`;
            const timer = this.wikiTimers.get(key);
            if (timer) clearTimeout(timer);
            this.wikiTimers.delete(key);
            return this.enqueueWrite(request.corpusId, () =>
                request.family === "topics"
                    ? this.maintainTopics(runtime, request)
                    : this.maintainWikiFamily(runtime, request),
            );
        }
        return this.enqueueWrite(request.corpusId, async () => {
            const plan = await this.planMaintenanceLocked(
                runtime,
                request.targets.map((target) => target.viewId),
            );
            if (
                plan.expectedHead !== request.expectedHead ||
                plan.targets.some(
                    (target) =>
                        target.expectedVersion !==
                        request.targets.find(
                            (selected) => selected.viewId === target.viewId,
                        )!.expectedVersion,
                )
            )
                throw new ViewBuildStaleError(
                    "Maintenance head or target version changed; inspect a fresh plan",
                );
            const targets: ViewBuildTarget[] = [];
            for (const target of plan.targets) {
                if (target.state !== "rebuild" || !target.selector) continue;
                const current = await this.viewStore.getView({
                    corpusId: request.corpusId,
                    viewId: target.viewId,
                });
                if (!current)
                    throw new ViewBuildStaleError(
                        "Maintenance target disappeared",
                    );
                targets.push({
                    expectedVersion: current.version,
                    definition: {
                        viewId: current.viewId,
                        kind: current.definition.kind,
                        selector: target.selector,
                        ...(current.definition.maintenance
                            ? { maintenance: current.definition.maintenance }
                            : {}),
                    },
                });
            }
            if (!targets.length)
                return this.viewStore.recordViewMaintenance(plan);
            const buildRequest: ViewBuildRequest = {
                corpusId: request.corpusId,
                expectedHead: plan.expectedHead,
                targets,
            };
            validateBuildRequest(buildRequest);
            const reservation = this.viewBuilds.reserve();
            try {
                const snapshots: ViewBuildSnapshot[] = [];
                for (const target of targets) {
                    const view = await this.viewStore.getView({
                        corpusId: request.corpusId,
                        viewId: target.definition.viewId,
                    });
                    snapshots.push(
                        await this.snapshotViewTarget(
                            request.corpusId,
                            target,
                            view?.generation?.input?.bounds,
                        ),
                    );
                }
                const admitted = await this.viewStore.admitViewBuild(
                    buildRequest,
                    snapshots,
                    plan,
                );
                const receipt = await this.viewStore.recordViewMaintenance(
                    plan,
                    admitted.job,
                );
                if (admitted.admitted) reservation.start(admitted.job);
                return receipt;
            } finally {
                reservation.release();
            }
        });
    }

    private async invalidateMaintainedViews(corpusId: string): Promise<void> {
        this.scheduleSourceSynopses(corpusId);
        const runtime = await this.getCorpusRuntime(corpusId);
        const { views } = await this.viewStore.listViews(corpusId);
        const invalid = views.filter((view) => {
            if (!view.definition.maintenance || view.state !== "draft")
                return false;
            const plan = this.resolveMaintenanceTarget(
                derivedDefinitionInput(view),
                runtime,
                view.generation?.input?.bounds,
                view,
            );
            return plan.state === "rebuild" || plan.state === "blocked";
        });
        await this.viewStore.markMaintenanceStale(
            corpusId,
            invalid.map((view) => view.viewId),
        );
        if (
            !this.informationalWikiEnabled ||
            !runtime.index.listSubjects ||
            !runtime.index.readFragments
        )
            return;
        for (const kind of ["projects", "wiki"] as const) {
            const family = await this.viewStore.getWikiFamily(corpusId, kind);
            family.dirty = true;
            family.cursor = 0;
            await this.viewStore.saveWikiFamily(corpusId, family, kind);
            if (family.enabled && !family.error)
                this.scheduleWikiMaintenance(corpusId, kind);
        }
    }

    public async updateViewMaintenance(
        request: ViewMaintenanceUpdate,
    ): Promise<ViewHistoryEntry> {
        if (
            !request ||
            Object.keys(request).some(
                (key) =>
                    ![
                        "corpusId",
                        "viewId",
                        "expectedHead",
                        "expectedVersion",
                        "maintenance",
                    ].includes(key),
            )
        )
            throw new Error("Unsupported maintenance update fields");
        validateMaintenanceRequest(
            {
                corpusId: request.corpusId,
                expectedHead: request.expectedHead,
                targets: [
                    {
                        viewId: request.viewId,
                        expectedVersion: request.expectedVersion,
                    },
                ],
            },
            true,
        );
        await this.requireViews(request.corpusId);
        return this.enqueueWrite(request.corpusId, async () => {
            const view = await this.viewStore.getView(request);
            if (!view)
                throw new Error("Unknown derived view maintenance target");
            if (!request.maintenance)
                throw new Error("Explicit maintenance definition is required");
            validateMaintenanceDefinition({
                viewId: view.viewId,
                kind: view.definition.kind,
                selector: view.definition.selector,
                maintenance: request.maintenance,
            });
            return this.viewStore.updateViewMaintenance(request);
        });
    }

    public async getViewMaintenance(
        request: ViewMaintenanceRead,
    ): Promise<ViewMaintenanceResult | undefined> {
        if (
            !request ||
            Object.keys(request).some(
                (key) => !["corpusId", "receiptId"].includes(key),
            )
        )
            throw new Error("Unsupported maintenance receipt request");
        validateIdentifier("maintenance receipt ID", request.receiptId);
        const runtime = await this.requireViews(request.corpusId);
        return runtime.access.read(() =>
            this.viewStore.getViewMaintenance(
                request.corpusId,
                request.receiptId,
            ),
        );
    }

    public async listViewBuilds(corpusId: string): Promise<ViewBuildJob[]> {
        const runtime = await this.requireViews(corpusId);
        return runtime.access.read(() =>
            this.viewStore.listViewBuilds(corpusId),
        );
    }

    public async getViewBuild(
        request: ViewBuildJobRequest,
    ): Promise<ViewBuildJob | undefined> {
        const runtime = await this.requireViews(request.corpusId);
        this.viewBuilds.assertPersistence(request.jobId);
        return runtime.access.read(() =>
            this.viewStore.getViewBuild(request.corpusId, request.jobId),
        );
    }

    public async cancelViewBuild(
        request: ViewBuildJobRequest,
    ): Promise<ViewBuildJob> {
        const job = await this.getViewBuild(request);
        if (!job) throw new Error("Unknown view build");
        if (job.state !== "running") return job;
        this.viewBuilds.cancel(job.jobId);
        return this.enqueueWrite(request.corpusId, () =>
            this.viewStore.updateViewBuild(
                request.corpusId,
                request.jobId,
                (current) => {
                    for (const result of current.results)
                        if (
                            ["pending", "generating", "validating"].includes(
                                result.state,
                            )
                        ) {
                            result.state = "cancelled";
                            result.reason =
                                "Cancellation stops materialization; already saved drafts remain";
                        }
                    current.state = "cancelled";
                },
            ),
        );
    }

    public async retryViewBuild(
        request: ViewBuildJobRequest,
    ): Promise<ViewBuildJob> {
        const job = await this.getViewBuild(request);
        if (!job || job.state === "running")
            throw new Error("Retry requires an existing terminal view build");
        if (
            job.results.some(
                (result) => result.snapshot.pipeline === "topics-v1",
            )
        )
            return this.rebuildTopics(job.corpusId);
        const targets: ViewBuildTarget[] = [];
        for (const result of job.results.filter(
            (result) => !["draft", "merged", "skipped"].includes(result.state),
        )) {
            const contributionConflict =
                await this.viewStore.pendingWikiContributionConflict(
                    result.snapshot,
                );
            if (
                contributionConflict &&
                (await this.informationalVersionEligible(
                    contributionConflict.human,
                ))
            )
                throw new Error(
                    `Resolve canonical Wiki edit conflict ${contributionConflict.conflictId} before retrying this contribution`,
                );
            const view = await this.getView({
                corpusId: job.corpusId,
                viewId: result.viewId,
            });
            targets.push({
                definition: result.snapshot.definition,
                expectedVersion: view?.version ?? 0,
            });
        }
        if (!targets.length) throw new Error("Build has no retryable targets");
        return this.buildViews({
            ...job.request,
            expectedHead: (await this.listViews(job.corpusId)).head,
            targets,
        });
    }

    public async getViewConflict(
        request: ViewConflictReadRequest,
    ): Promise<ViewMergeConflict | undefined> {
        const runtime = await this.requireViews(request.corpusId);
        return runtime.access.read(() =>
            this.viewStore.getViewConflict(
                request.corpusId,
                request.conflictId,
            ),
        );
    }

    public async resolveViewConflict(
        request: ViewConflictResolution,
    ): Promise<ViewHistoryEntry> {
        validateConflictResolution(request);
        const conflict = await this.getViewConflict(request);
        if (!conflict || conflict.state !== "pending")
            throw new Error("Unknown or already resolved view conflict");
        const selected =
            request.choice === "generated"
                ? conflict.candidate
                : request.choice === "combined"
                  ? request.combined!
                  : {
                        ...conflict.candidate,
                        content: conflict.human
                            .content as ViewSynthesisOutput["content"],
                        relationships: authoredRelationships(conflict.human),
                    };
        const output: ViewSynthesisOutput = {
            content: selected.content,
            relationships: selected.relationships,
            outcome: selected.outcome,
            missingEvidence: selected.missingEvidence,
            ...inventoryEvidence(conflict.candidate),
        };
        validateConstructedGuide(conflict.input, output);
        if (informationalWiki(output.content))
            return this.enqueueWrite(request.corpusId, async () => {
                await this.recheckViewInput(conflict.input);
                const saved = await this.viewStore.resolveViewConflict(
                    request,
                    output,
                );
                await this.viewStore.makeInformationalVisible(saved.version);
                await this.indexViewLocked(saved.version);
                return saved;
            });
        const support = await this.viewAdapter.validate(
            conflict.input,
            output,
            new AbortController().signal,
        );
        validateSupport(output, support);
        return this.enqueueWrite(request.corpusId, async () => {
            await this.recheckViewInput(conflict.input);
            return this.viewStore.resolveViewConflict(
                request,
                output,
                publicationProof(conflict.input.fingerprint, output, support),
            );
        });
    }

    public async answer(
        request: MemoryAnswerRequest,
    ): Promise<MemoryAnswerResult> {
        const question = request.question.trim();
        if (question.length === 0) {
            throw new Error("Memory question cannot be empty");
        }
        if (
            request.answerMode !== "extractive" &&
            this.informationalWikiEnabled
        ) {
            const answer = async (): Promise<MemoryAnswerResult> => {
                const result = await this.search({
                    corpusId: request.corpusId,
                    query: question,
                    ...(request.sourceIds
                        ? { sourceIds: request.sourceIds }
                        : {}),
                    indexedFragments: true,
                    limit: Math.min(request.limit ?? 12, 12),
                    maxResponseChars: Math.min(
                        request.maxResponseChars ?? 24000,
                        24000,
                    ),
                });
                const generated = await answerIndexedEvidence(
                    question,
                    result.matches,
                    Math.min(this.wikiBudget?.outputTokens ?? 4000, 4000),
                    this.wikiModelEndpoint,
                    this.indexedAnswerModel,
                );
                for (const citation of generated.citations) {
                    if (!citation.locator?.startsWith("indexed:"))
                        throw new Error(
                            "Indexed answer requires an exact indexed locator",
                        );
                    const source = await this.getSource(
                        request.corpusId,
                        citation.sourceId,
                    );
                    if (source?.activeRevisionId !== citation.revisionId)
                        throw new Error(
                            "Indexed answer evidence changed before delivery",
                        );
                    const current = await this.getSourceContent({
                        corpusId: request.corpusId,
                        sourceId: citation.sourceId,
                        revisionId: citation.revisionId,
                        indexedLocator: citation.locator,
                    });
                    if (current.content !== citation.snippet)
                        throw new Error(
                            "Indexed answer evidence is unavailable or changed",
                        );
                }
                return {
                    question,
                    ...generated,
                    mode: "synthesized",
                    grounded: true,
                    indexVersion: result.indexVersion,
                    warnings: result.warnings,
                };
            };
            return this.wikiBudget
                ? runWithRequestBudget(
                      new RequestBudget(this.wikiBudget),
                      answer,
                  )
                : answer();
        }
        if (request.answerMode !== "extractive") {
            const synthesized = await this.synthesizeAnswer(request, question);
            if (synthesized !== undefined) {
                return synthesized;
            }
        }
        return this.extractiveAnswer(request, question);
    }

    private async synthesizeAnswer(
        request: MemoryAnswerRequest,
        question: string,
    ): Promise<MemoryAnswerResult | undefined> {
        await this.initialize();
        validateIdentifier("corpus ID", request.corpusId);
        return this.enqueueDocumentRead(request.corpusId, async (runtime) => {
            const index = runtime.index;
            if (index.answer === undefined) {
                if (request.answerMode === "synthesized") {
                    throw new Error(
                        "This corpus index does not support synthesized answers",
                    );
                }
                return undefined;
            }
            const limit = Math.max(1, Math.min(request.limit ?? 5, 100));
            const scope =
                request.sourceIds === undefined
                    ? undefined
                    : new Set(request.sourceIds);
            const result = await index.answer(question, limit * 4, scope);
            const citations = this.toEvidence(
                request.corpusId,
                runtime,
                result.matches,
                request,
                limit,
            );
            const mode: AnswerMode = "synthesized";
            const indexVersion = this.indexVersion(runtime.manifest);
            const warnings = [...this.capabilities.warnings];
            if (result.answer === undefined) {
                return {
                    question,
                    answer:
                        citations.length === 0
                            ? "No supporting memory evidence was found."
                            : `No answer could be derived from the memory evidence. ${result.whyNoAnswer ?? ""}`.trim(),
                    mode,
                    citations,
                    grounded: true,
                    indexVersion,
                    warnings,
                };
            }
            return {
                question,
                answer: result.answer,
                mode,
                citations,
                grounded: true,
                indexVersion,
                warnings,
            };
        });
    }

    private async extractiveAnswer(
        request: MemoryAnswerRequest,
        question: string,
    ): Promise<MemoryAnswerResult> {
        const result = await this.search({
            corpusId: request.corpusId,
            query: question,
            limit: request.limit ?? 5,
            ...(request.maxResponseChars === undefined
                ? {}
                : { maxResponseChars: request.maxResponseChars }),
            ...(request.sourceIds === undefined
                ? {}
                : { sourceIds: request.sourceIds }),
        });
        if (result.matches.length === 0) {
            return {
                question,
                answer: "No supporting memory evidence was found.",
                mode: "extractive",
                citations: [],
                grounded: true,
                indexVersion: result.indexVersion,
                warnings: result.warnings,
            };
        }
        const answer = result.matches
            .map(
                (evidence, index) =>
                    `[${index + 1}] ${evidence.snippet.trim()}`,
            )
            .join("\n\n");
        return {
            question,
            answer,
            mode: "extractive",
            citations: result.matches,
            grounded: true,
            indexVersion: result.indexVersion,
            warnings: result.warnings,
        };
    }

    public async getKnowledgeGraph(
        corpusId: string,
    ): Promise<MemoryKnowledgeGraph> {
        await this.initialize();
        validateIdentifier("corpus ID", corpusId);
        return this.enqueueDocumentRead(corpusId, async (runtime) => {
            return applyKnowledgeSuppressions(
                await runtime.index.getKnowledgeGraph(),
                runtime.manifest.knowledgeSuppressions ?? [],
            );
        });
    }

    private async updateSourceKnowledgeSuppression(
        request: SourceKnowledgeSuppressionRequest,
        suppress: boolean,
    ): Promise<SourceKnowledgeSuppression[]> {
        await this.initialize();
        validateIdentifier("corpus ID", request.corpusId);
        validateIdentifier("source ID", request.sourceId);
        const name = request.name.trim();
        if (name.length === 0) {
            throw new Error("Knowledge name cannot be empty");
        }
        await this.enqueueWrite(request.corpusId, async () => {
            const runtime = await this.getCorpusRuntime(request.corpusId);
            if (
                !runtime.manifest.sources.some(
                    (source) => source.sourceId === request.sourceId,
                )
            ) {
                throw new Error(`Unknown source '${request.sourceId}'`);
            }
            const candidateManifest = structuredClone(runtime.manifest);
            const suppressions = candidateManifest.knowledgeSuppressions ?? [];
            const matches = (item: SourceKnowledgeSuppression): boolean =>
                item.sourceId === request.sourceId &&
                item.kind === request.kind &&
                normalizedKnowledgeName(item.name) ===
                    normalizedKnowledgeName(name);
            candidateManifest.knowledgeSuppressions = suppress
                ? suppressions.some(matches)
                    ? suppressions
                    : [
                          ...suppressions,
                          {
                              sourceId: request.sourceId,
                              kind: request.kind,
                              name,
                          },
                      ]
                : suppressions.filter((item) => !matches(item));
            const changed =
                candidateManifest.knowledgeSuppressions.length !==
                suppressions.length;
            candidateManifest.changes = pruneChangeReceipts(
                candidateManifest.changes,
            );
            if (changed) {
                candidateManifest.changes.push(
                    createChangeReceipt(
                        request.corpusId,
                        suppress ? "suppress" : "restore",
                        request.sourceId,
                        { sources: 1, revisions: 0, knowledge: 1 },
                    ),
                );
            }
            await this.writeManifest(request.corpusId, candidateManifest);
            runtime.manifest = candidateManifest;
            if (suppress && changed)
                await this.agentSessionStore.purge(
                    request.corpusId,
                    request.sourceId,
                );
            await this.invalidateMaintainedViews(request.corpusId);
        });
        return this.listSourceKnowledgeSuppressions(
            request.corpusId,
            request.sourceId,
        );
    }

    private reindex(
        corpusId: string,
        sourceId: string | undefined,
        signal: AbortSignal,
    ): Promise<ReindexResult> {
        const work = this.prepareReindex(corpusId, sourceId, signal);
        this.reindexWork.add(work);
        void work.then(
            () => this.reindexWork.delete(work),
            () => this.reindexWork.delete(work),
        );
        return work;
    }

    private async prepareReindex(
        corpusId: string,
        sourceId: string | undefined,
        signal: AbortSignal,
    ): Promise<ReindexResult> {
        await this.initialize();
        validateIdentifier("corpus ID", corpusId);
        const generation = randomUUID();
        const directory = this.indexDirectory(corpusId, generation);
        const controller = new AbortController();
        const bounded = AbortSignal.any([signal, controller.signal]);
        let finishPreparation!: () => void;
        const prepared = new Promise<void>((resolve) => {
            finishPreparation = resolve;
        });
        let published = false;
        try {
            const capture = await this.enqueueWrite(corpusId, async () => {
                if (this.closed) throw new Error("Memory service is closed");
                this.throwIfAborted(bounded);
                const runtime = await this.getCorpusRuntime(corpusId);
                if (
                    sourceId !== undefined &&
                    !runtime.manifest.sources.some(
                        (source) => source.sourceId === sourceId,
                    )
                )
                    throw new Error(`Unknown source '${sourceId}'`);
                if (runtime.manifest.indexGeneration !== undefined)
                    await classifyIndexSchema(
                        this.indexDirectory(
                            corpusId,
                            runtime.manifest.indexGeneration,
                        ),
                        "documents",
                        false,
                    );
                const manifest = structuredClone(runtime.manifest);
                const sourceIds = new Set(
                    manifest.sources.map((source) => source.sourceId),
                );
                this.controllers.set(generation, controller);
                this.detachedRebuilds.set(directory, {
                    corpusId,
                    sourceIds,
                    baseSourceIds: sourceIds,
                    controller,
                    prepared,
                });
                this.preparingIndexes.set(directory, {
                    corpusId,
                    sourceIds,
                    jobId: generation,
                });
                return {
                    runtime,
                    documents: this.activeDocuments(manifest),
                    baseGeneration: manifest.indexGeneration,
                    baseVersion: this.indexVersion(manifest),
                };
            });
            const index = this.indexFactory(corpusId, directory);
            try {
                await mkdir(directory, { recursive: true });
                const rebuild = () =>
                    index.rebuild(capture.documents, bounded, async () => {});
                await timeSearchStage("reindex.prepare", () =>
                    this.wikiBudget
                        ? runWithRequestBudget(
                              new RequestBudget(this.wikiBudget),
                              rebuild,
                          )
                        : rebuild(),
                );
                this.throwIfAborted(bounded);
                await stampIndexSchema(
                    directory,
                    "documents",
                    capture.documents.length > 0,
                );
            } finally {
                finishPreparation();
            }
            return await this.enqueueWrite(corpusId, () =>
                timeSearchStage("reindex.commit", async () => {
                    this.throwIfAborted(bounded);
                    const runtime = capture.runtime;
                    if (
                        runtime.manifest.indexGeneration !==
                            capture.baseGeneration ||
                        this.indexVersion(runtime.manifest) !==
                            capture.baseVersion
                    )
                        throw new ViewBuildStaleError(
                            "Corpus source index changed during reindex preparation",
                        );
                    const manifest = structuredClone(runtime.manifest);
                    manifest.indexGeneration = generation;
                    manifest.corpus = {
                        ...manifest.corpus,
                        updatedAt: now(),
                        status: "ready",
                        documentCount: manifest.sources.length,
                    };
                    await this.writeManifest(corpusId, manifest);
                    published = true;
                    runtime.manifest = manifest;
                    runtime.index = index;
                    await this.rememberDocumentIndex(corpusId, runtime);
                    for (const source of manifest.sources)
                        await this.viewStore.markSourceRevisionStale(
                            corpusId,
                            source.sourceId,
                        );
                    await this.invalidateMaintainedViews(corpusId);
                    await this.removeInactiveIndexGenerations(
                        corpusId,
                        generation,
                    );
                    return {
                        corpusId,
                        ...(sourceId === undefined ? {} : { sourceId }),
                        sourceCount: manifest.sources.length,
                        indexVersion: this.indexVersion(manifest),
                    };
                }),
            );
        } finally {
            finishPreparation();
            if (!published)
                await rm(directory, { recursive: true, force: true });
            this.preparingIndexes.delete(directory);
            this.detachedRebuilds.delete(directory);
            this.controllers.delete(generation);
        }
    }

    private async rebuildAndActivate(
        corpusId: string,
        runtime: CorpusRuntime,
        candidateManifest: CorpusManifest,
        signal: AbortSignal,
    ): Promise<void> {
        if (runtime.manifest.indexGeneration !== undefined) {
            await classifyIndexSchema(
                this.indexDirectory(corpusId, runtime.manifest.indexGeneration),
                "documents",
                false,
            );
        }
        const indexGeneration = randomUUID();
        const candidateDirectory = this.indexDirectory(
            corpusId,
            indexGeneration,
        );
        await mkdir(candidateDirectory, { recursive: true });
        const candidateIndex = this.indexFactory(corpusId, candidateDirectory);
        try {
            const rebuild = async () => {
                const documents = this.activeDocuments(candidateManifest);
                if (
                    candidateManifest.sources.length <
                        runtime.manifest.sources.length &&
                    candidateIndex.rebuildRetained &&
                    (await candidateIndex.rebuildRetained(
                        runtime.index,
                        documents,
                        signal,
                        async () => {},
                    ))
                )
                    return;
                await candidateIndex.rebuild(documents, signal, async () => {});
            };
            await (this.wikiBudget
                ? runWithRequestBudget(
                      new RequestBudget(this.wikiBudget),
                      rebuild,
                  )
                : rebuild());
            this.throwIfAborted(signal);
            await stampIndexSchema(
                candidateDirectory,
                "documents",
                candidateManifest.sources.length > 0,
            );
            candidateManifest.indexGeneration = indexGeneration;
            candidateManifest.corpus = {
                ...candidateManifest.corpus,
                updatedAt: now(),
                status: "ready",
                documentCount: candidateManifest.sources.length,
            };
            await this.writeManifest(corpusId, candidateManifest);
            runtime.manifest = candidateManifest;
            runtime.index = candidateIndex;
            await this.rememberDocumentIndex(corpusId, runtime);
        } catch (error) {
            await rm(candidateDirectory, { recursive: true, force: true });
            throw error;
        }
        await this.removeInactiveIndexGenerations(corpusId, indexGeneration);
    }

    private async removeInactiveIndexGenerations(
        corpusId: string,
        activeGeneration: string,
        forceCollection = false,
    ): Promise<void> {
        validateIndexGeneration(activeGeneration);
        const root = this.indexDirectory(corpusId);
        const removal =
            this.corpora.get(corpusId)?.manifest.authorizedSourceRemoval;
        const sources = new Set(
            this.corpora
                .get(corpusId)
                ?.manifest.sources.map((source) => source.sourceId),
        );
        for (const [directory, preparation] of this.detachedRebuilds) {
            if (
                preparation.corpusId !== corpusId ||
                directory === this.indexDirectory(corpusId, activeGeneration) ||
                !(removal
                    ? preparation.sourceIds.has(removal.sourceId)
                    : this.corpora.get(corpusId)?.manifest.pendingCorpusClear ||
                      [...preparation.baseSourceIds].some(
                          (id) => !sources.has(id),
                      ))
            )
                continue;
            preparation.controller.abort(
                new ViewBuildStaleError(
                    "Source removal invalidated reindex preparation",
                ),
            );
            if (this.corpora.get(corpusId)?.manifest.pendingCorpusClear)
                for (const jobId of preparation.jobIds ?? [])
                    this.controllers
                        .get(jobId)
                        ?.abort(new Error("Corpus cleared during ingestion"));
            // Wait for provider writes, not publication (which needs this reservation).
            await preparation.prepared;
            this.preparingIndexes.delete(directory);
        }
        // Detached generations still contain retained sources and must be
        // cancelled and purged when any of that evidence is forgotten.
        if (removal)
            for (const [directory, preparation] of this.preparingIndexes) {
                if (
                    preparation.corpusId !== corpusId ||
                    !preparation.sourceIds.has(removal.sourceId)
                )
                    continue;
                this.controllers
                    .get(preparation.jobId)
                    ?.abort(
                        new ViewBuildStaleError("Source removal authorized"),
                    );
                this.preparingIndexes.delete(directory);
            }
        let entries;
        try {
            entries = await readdir(root, { withFileTypes: true });
        } catch (error) {
            if ((error as NodeJS.ErrnoException).code === "ENOENT") {
                return;
            }
            throw error;
        }
        await Promise.all(
            entries
                .filter(
                    (entry) =>
                        entry.isDirectory() &&
                        entry.name !== jsonSegmentDirectory &&
                        entry.name !== activeGeneration &&
                        !this.preparingIndexes.has(path.join(root, entry.name)),
                )
                .map(async (entry) => {
                    const directory = path.join(root, entry.name);
                    await classifyIndexSchema(directory, "documents", false);
                    await rm(directory, {
                        recursive: true,
                        force: true,
                    });
                }),
        );
        if (!this.hasUnpublishedIndex(corpusId, root))
            await this.reclaimIndexSegments(corpusId, root, forceCollection);
    }

    private hasUnpublishedIndex(corpusId: string, root: string): boolean {
        const generation = this.corpora.get(corpusId)?.manifest.indexGeneration;
        const active = generation
            ? this.indexDirectory(corpusId, generation)
            : undefined;
        return [
            ...this.preparingIndexes.keys(),
            ...this.detachedRebuilds.keys(),
        ].some(
            (directory) =>
                path.dirname(directory) === root && directory !== active,
        );
    }

    private async reclaimIndexSegments(
        corpusId: string,
        root: string,
        forceCollection: boolean,
    ): Promise<void> {
        const manifest = this.corpora.get(corpusId)?.manifest;
        if (
            forceCollection ||
            manifest?.authorizedSourceRemoval ||
            manifest?.pendingCorpusClear
        )
            await this.collectIndexSegments(root);
        else this.scheduleIndexCollection(corpusId, root);
    }

    private collectIndexSegments(root: string): Promise<void> {
        return collectJsonSegments(root);
    }

    private scheduleIndexCollection(corpusId: string, root: string): void {
        if (this.segmentCollectionWork.has(root)) return;
        const key = `${corpusId}:segment-collection`;
        let retry = false;
        const work = new Promise<void>((resolve) => setTimeout(resolve, 250))
            .then(() =>
                this.enqueueWrite(
                    corpusId,
                    async () => {
                        // Preparation can start after this collection was scheduled.
                        if (this.hasUnpublishedIndex(corpusId, root)) {
                            retry = true;
                            return;
                        }
                        await this.collectIndexSegments(root);
                        this.wikiMaintenanceFailures.delete(key);
                    },
                    true,
                ),
            )
            .then(
                () => {},
                (error: unknown) => {
                    this.wikiMaintenanceFailures.set(
                        key,
                        new Error(safeError(error)),
                    );
                },
            )
            .finally(() => {
                this.segmentCollectionWork.delete(root);
                if (retry && !this.closed)
                    this.scheduleIndexCollection(corpusId, root);
            });
        this.segmentCollectionWork.set(
            root,
            work.then(() => {}),
        );
    }

    private indexVersion(manifest: CorpusManifest): string {
        return hashContent(
            manifest.sources
                .map((source) => source.activeRevisionId)
                .sort()
                .join("\n"),
        );
    }

    private async acquireStorageLock(): Promise<void> {
        await mkdir(this.rootDirectory, { recursive: true });
        this.releaseLock = await lockfile.lock(this.rootDirectory, {
            realpath: false,
            retries: 0,
            stale: 10_000,
        });
    }

    private async recoverInterruptedJobs(): Promise<void> {
        const directory = path.join(this.rootDirectory, jobsDirectoryName);
        let entries: string[];
        try {
            entries = await readdir(directory);
        } catch (error) {
            if ((error as NodeJS.ErrnoException).code === "ENOENT") {
                return;
            }
            throw error;
        }
        const terminalStates = new Set<JobState>([
            "complete",
            "partial",
            "failed",
            "cancelled",
        ]);
        for (const entry of entries.filter((name) => name.endsWith(".json"))) {
            const job = await readJson<IngestionJobStatus>(
                path.join(directory, entry),
            );
            if (job === undefined || terminalStates.has(job.state)) {
                continue;
            }
            const timestamp = now();
            const recovered: IngestionJobStatus = {
                ...job,
                state: "failed",
                progress: {
                    ...job.progress,
                    message: "Ingestion interrupted by service restart",
                },
                updatedAt: timestamp,
                error: "Ingestion interrupted by service restart",
                trace: [
                    ...(job.trace ?? []),
                    {
                        ...job.progress,
                        state: "failed",
                        message: "Ingestion interrupted by service restart",
                        timestamp,
                    },
                ],
            };
            this.jobs.set(job.jobId, recovered);
            await writeJsonAtomic(this.jobPath(job.jobId), recovered);
        }
    }

    private async pruneStoredChanges(): Promise<void> {
        const entries = await readdir(this.rootDirectory, {
            withFileTypes: true,
        });
        for (const entry of entries) {
            if (!entry.isDirectory()) {
                continue;
            }
            const manifest = await this.readSerializedManifest(entry.name);
            if (manifest?.changes === undefined) {
                continue;
            }
            const changes = pruneChangeReceipts(manifest.changes);
            if (changes.length !== manifest.changes.length) {
                await writeRunbookJson(
                    this.manifestPath(entry.name),
                    `${JSON.stringify({ ...manifest, changes }, undefined, 2)}\n`,
                );
            }
        }
    }

    private enqueueRootWrite<T>(operation: () => Promise<T>): Promise<T> {
        const result = this.rootWriteTail.then(operation, operation);
        this.rootWriteTail = result.then(
            () => undefined,
            () => undefined,
        );
        return result;
    }

    private assertSourceIngestionAllowed(
        runtime: CorpusRuntime,
        sourceId: string,
    ): void {
        if (runtime.manifest.authorizedSourceRemoval?.sourceId === sourceId)
            throw new ViewBuildStaleError(
                "Source removal authorized; ingestion cannot restore it",
            );
    }

    private async captureIngestionGroup(
        corpusId: string,
        entries: AcceptedIngestion[],
        generation: string,
        controller: AbortController,
        prepared: Promise<void>,
    ) {
        return this.enqueueWrite(corpusId, async () => {
            const runtime = await this.getCorpusRuntime(corpusId);
            const ids = new Set(entries.map((entry) => entry.sourceId));
            if (
                ids.size !== entries.length ||
                entries.some(
                    (entry) =>
                        entry.signal.aborted ||
                        entry.request.source.assets?.length ||
                        entry.request.pipeline?.expectedActiveRevisionId !==
                            undefined ||
                        runtime.manifest.sources.some(
                            (source) => source.sourceId === entry.sourceId,
                        ),
                )
            )
                return undefined;
            const directory = this.indexDirectory(corpusId, generation);
            const index = this.indexFactory(corpusId, directory);
            const existingGeneration = runtime.manifest.indexGeneration;
            const append = runtime.manifest.sources.length > 0;
            if (
                append &&
                (!existingGeneration ||
                    !index.append ||
                    (await classifyIndexSchema(
                        this.indexDirectory(corpusId, existingGeneration),
                        "documents",
                        true,
                    )) !== "current")
            )
                return undefined;
            const additions = entries.map((entry) => {
                this.assertSourceIngestionAllowed(runtime, entry.sourceId);
                const { source, revision } = createStoredSource(
                    entry.request,
                    entry.content,
                    entry.contentHash,
                    entry.sourceId,
                    entry.revisionId,
                    this.mimeType(entry.request.source.sourceType),
                    undefined,
                );
                revision.assets = [];
                return {
                    source,
                    revision,
                    content: entry.content,
                    pipeline: contentPipeline(revision.pipeline),
                };
            });
            const candidateManifest = structuredClone(runtime.manifest);
            candidateManifest.sources.push(
                ...additions.map((document) => document.source),
            );
            const sourceIds = new Set(
                candidateManifest.sources.map((source) => source.sourceId),
            );
            await mkdir(directory, { recursive: true });
            this.preparingIndexes.set(directory, {
                corpusId,
                jobId: entries[0]!.job.jobId,
                sourceIds,
            });
            this.detachedRebuilds.set(directory, {
                corpusId,
                sourceIds,
                baseSourceIds: new Set(
                    runtime.manifest.sources.map((source) => source.sourceId),
                ),
                controller,
                prepared,
                jobIds: entries.map((entry) => entry.job.jobId),
            });
            if (append)
                await cp(
                    this.indexDirectory(corpusId, existingGeneration!),
                    directory,
                    { recursive: true },
                );
            for (const entry of entries)
                await this.updateJob(entry.job, "building-indexes", {
                    completed: 0,
                    total: 1,
                    operation: append ? "append" : "rebuild",
                    message: "Building shared two-source index",
                });
            return {
                runtime,
                index,
                additions,
                append,
                documents: this.activeDocuments(candidateManifest),
                baseGeneration: existingGeneration,
                baseVersion: this.indexVersion(runtime.manifest),
            };
        });
    }

    private async processIngestionGroup(
        corpusId: string,
        entries: AcceptedIngestion[],
    ): Promise<boolean> {
        const generation = randomUUID();
        const directory = this.indexDirectory(corpusId, generation);
        const controller = new AbortController();
        const signal = AbortSignal.any([
            controller.signal,
            ...entries.map((entry) => entry.signal),
        ]);
        let finishPreparation!: () => void;
        const prepared = new Promise<void>((resolve) => {
            finishPreparation = resolve;
        });
        let committed = false;
        try {
            const capture = await this.captureIngestionGroup(
                corpusId,
                entries,
                generation,
                controller,
                prepared,
            );
            if (!capture) return false;
            const progress = async (value: JobProgress) => {
                for (const entry of entries) {
                    if (signal.aborted) return;
                    await this.updateJob(
                        entry.job,
                        value.stage ?? "building-indexes",
                        {
                            ...value,
                            message: `Shared two-source index: ${value.message ?? "preparing"}`,
                        },
                    );
                }
            };
            try {
                signal.throwIfAborted();
                // Drain the actual provider, even if it ignores abort. Privacy
                // cleanup waits for this promise, never for publication.
                await timeSearchStage("ingestion.prepare.group", () =>
                    capture.append
                        ? capture.index.append!(
                              capture.additions,
                              signal,
                              progress,
                          )
                        : capture.index.rebuild(
                              capture.documents,
                              signal,
                              progress,
                          ),
                );
                signal.throwIfAborted();
                await stampIndexSchema(directory, "documents", true);
            } finally {
                finishPreparation();
            }
            await this.enqueueWrite(corpusId, async () => {
                signal.throwIfAborted();
                if (
                    capture.runtime.manifest.indexGeneration !==
                        capture.baseGeneration ||
                    this.indexVersion(capture.runtime.manifest) !==
                        capture.baseVersion
                )
                    throw new ViewBuildStaleError(
                        "Corpus changed during grouped ingestion preparation",
                    );
                const manifest = structuredClone(capture.runtime.manifest);
                delete manifest.pendingSourceForget;
                for (const addition of capture.additions) {
                    addition.revision.state = "ready";
                    addition.revision.indexedAt = now();
                    manifest.sources.push(addition.source);
                }
                manifest.indexGeneration = generation;
                manifest.corpus.status = "ready";
                manifest.corpus.updatedAt = now();
                manifest.corpus.documentCount = manifest.sources.length;
                manifest.changes = pruneChangeReceipts(manifest.changes);
                for (const entry of entries)
                    await this.updateJob(entry.job, "persisting", {
                        completed: 1,
                        total: 1,
                        message: "Persisting shared corpus metadata",
                    });
                await this.writeManifest(corpusId, manifest);
                capture.runtime.manifest = manifest;
                capture.runtime.index = capture.index;
                committed = true;
                await this.rememberDocumentIndex(corpusId, capture.runtime);
                for (const entry of entries)
                    await this.viewStore.markSourceRevisionStale(
                        corpusId,
                        entry.sourceId,
                        entry.revisionId,
                    );
                await this.invalidateMaintainedViews(corpusId);
                await this.textStore(corpusId).purge(manifest.sources);
                await this.removeInactiveIndexGenerations(corpusId, generation);
                for (const entry of entries)
                    await this.updateJob(entry.job, "complete", {
                        completed: 1,
                        total: 1,
                        message: "Ingestion complete",
                    });
            });
            return true;
        } catch (error) {
            finishPreparation();
            if (
                !committed &&
                (signal.aborted || error instanceof ViewBuildStaleError)
            )
                return false;
            await this.enqueueWrite(
                corpusId,
                async () => {
                    for (const entry of entries)
                        await this.handleIngestionFailure(
                            entry.job,
                            entry.signal,
                            error,
                            committed,
                            undefined,
                            false,
                        );
                },
                true,
            );
            return true;
        } finally {
            finishPreparation();
            this.detachedRebuilds.delete(directory);
            this.preparingIndexes.delete(directory);
            if (!committed)
                await this.enqueueWrite(
                    corpusId,
                    () => rm(directory, { recursive: true, force: true }),
                    true,
                );
        }
    }

    private async processIngestion(
        request: DocumentIngestRequest,
        content: string,
        contentHash: string,
        sourceId: string,
        revisionId: string,
        job: IngestionJobStatus,
        signal: AbortSignal,
    ): Promise<void> {
        const preparationController = new AbortController();
        signal = AbortSignal.any([signal, preparationController.signal]);
        let finishPreparation!: () => void;
        const prepared = new Promise<void>((resolve) => {
            finishPreparation = resolve;
        });
        const indexGeneration = randomUUID();
        const candidateDirectory = this.indexDirectory(
            request.corpusId,
            indexGeneration,
        );
        let candidateIndexDirectory: string | undefined = candidateDirectory;
        let committed = false;
        try {
            const capture = await this.enqueueWrite(
                request.corpusId,
                async () => {
                    await this.updateJob(job, "validating", {
                        completed: 0,
                        total: 1,
                        message: "Validating source",
                    });
                    if (job.state === "cancelled") return;
                    this.throwIfAborted(signal);
                    const runtime = await this.getCorpusRuntime(
                        request.corpusId,
                        true,
                    );
                    this.assertSourceIngestionAllowed(runtime, sourceId);
                    const existing = structuredClone(
                        runtime.manifest.sources.find(
                            (source) => source.sourceId === sourceId,
                        ),
                    );
                    const policy =
                        request.pipeline?.updatePolicy ?? "skipIfUnchanged";
                    const expectedRevision =
                        request.pipeline?.expectedActiveRevisionId;
                    if (
                        expectedRevision !== undefined &&
                        existing?.activeRevisionId !== expectedRevision
                    ) {
                        throw new Error(
                            `Source '${sourceId}' active revision changed`,
                        );
                    }
                    if (existing?.activeRevisionId === revisionId) {
                        if (policy === "failIfExists") {
                            throw new Error(
                                `Source '${sourceId}' already exists`,
                            );
                        }
                        await this.invalidateMaintainedViews(request.corpusId);
                        await this.updateJob(job, "complete", {
                            completed: 1,
                            total: 1,
                            message: "Source is unchanged",
                        });
                        return;
                    }
                    if (existing !== undefined && policy === "failIfExists") {
                        throw new Error(`Source '${sourceId}' already exists`);
                    }
                    const { source, revision } = createStoredSource(
                        request,
                        content,
                        contentHash,
                        sourceId,
                        revisionId,
                        this.mimeType(request.source.sourceType),
                        existing,
                    );
                    revision.assets = await this.assetStore.retain(
                        { corpusId: request.corpusId, sourceId, revisionId },
                        request.source.assets ?? [],
                    );
                    const candidateManifest = structuredClone(runtime.manifest);
                    delete candidateManifest.pendingSourceForget;
                    candidateManifest.sources = [
                        ...candidateManifest.sources.filter(
                            (item) => item.sourceId !== sourceId,
                        ),
                        source,
                    ];
                    candidateManifest.corpus.status = "indexing";
                    candidateManifest.corpus.updatedAt = now();
                    candidateManifest.corpus.documentCount =
                        candidateManifest.sources.length;
                    candidateManifest.indexGeneration = indexGeneration;
                    this.preparingIndexes.set(candidateDirectory, {
                        corpusId: request.corpusId,
                        jobId: job.jobId,
                        sourceIds: new Set(
                            candidateManifest.sources.map(
                                (item) => item.sourceId,
                            ),
                        ),
                    });
                    await mkdir(candidateDirectory, { recursive: true });
                    this.detachedRebuilds.set(candidateDirectory, {
                        corpusId: request.corpusId,
                        sourceIds: new Set(
                            candidateManifest.sources.map(
                                (item) => item.sourceId,
                            ),
                        ),
                        baseSourceIds: new Set(
                            runtime.manifest.sources.map(
                                (item) => item.sourceId,
                            ),
                        ),
                        controller: preparationController,
                        prepared,
                        jobIds: [job.jobId],
                    });
                    const candidateIndex = this.indexFactory(
                        request.corpusId,
                        candidateDirectory,
                    );
                    await this.updateJob(job, "building-indexes", {
                        completed: 0,
                        message: "Building corpus indexes",
                    });
                    const documents = this.activeDocuments(candidateManifest);
                    const canAppend =
                        (existing === undefined ||
                            (policy === "retainRevisionHistory" &&
                                !request.source.assets?.length &&
                                candidateIndex.replace !== undefined)) &&
                        runtime.manifest.sources.length > 0 &&
                        runtime.manifest.indexGeneration !== undefined &&
                        candidateIndex.append !== undefined &&
                        (await classifyIndexSchema(
                            this.indexDirectory(
                                request.corpusId,
                                runtime.manifest.indexGeneration,
                            ),
                            "documents",
                            true,
                        )) === "current";
                    if (
                        !canAppend &&
                        runtime.manifest.indexGeneration !== undefined
                    ) {
                        await classifyIndexSchema(
                            this.indexDirectory(
                                request.corpusId,
                                runtime.manifest.indexGeneration,
                            ),
                            "documents",
                            false,
                        );
                    }
                    if (canAppend) {
                        // Pin and copy under the reservation; provider work below only
                        // mutates this detached generation, never the live DocMemory.
                        await cp(
                            this.indexDirectory(
                                request.corpusId,
                                runtime.manifest.indexGeneration,
                            ),
                            candidateDirectory,
                            { recursive: true },
                        );
                    }
                    return {
                        runtime,
                        existing,
                        source,
                        revision,
                        candidateManifest,
                        candidateIndex,
                        canAppend,
                        documents,
                        baseGeneration: runtime.manifest.indexGeneration,
                        baseVersion: this.indexVersion(runtime.manifest),
                    };
                },
            );
            if (!capture) return;
            const {
                runtime,
                existing,
                source,
                revision,
                candidateManifest,
                candidateIndex,
                canAppend,
                documents,
            } = capture;
            const reportProgress = async (progress: JobProgress) => {
                if (!signal.aborted) {
                    await this.updateJob(
                        job,
                        progress.stage ?? "building-indexes",
                        progress,
                    );
                }
            };
            await timeSearchStage("ingestion.prepare", async () => {
                if (canAppend) {
                    this.throwIfAborted(signal);
                    const addition = {
                        source,
                        revision,
                        content,
                        pipeline: contentPipeline(revision.pipeline),
                    };
                    await timeSearchStage("ingestion.index.append", () =>
                        existing && candidateIndex.replace
                            ? candidateIndex.replace(
                                  addition,
                                  signal,
                                  reportProgress,
                              )
                            : candidateIndex.append!(
                                  [addition],
                                  signal,
                                  reportProgress,
                              ),
                    );
                } else {
                    await timeSearchStage("ingestion.index.rebuild", () =>
                        candidateIndex.rebuild(
                            documents,
                            signal,
                            reportProgress,
                        ),
                    );
                }
                this.throwIfAborted(signal);
                await stampIndexSchema(
                    candidateDirectory,
                    "documents",
                    candidateManifest.sources.length > 0,
                );
                finishPreparation();
            });
            await this.enqueueWrite(request.corpusId, () =>
                timeSearchStage("ingestion.commit", async () => {
                    this.throwIfAborted(signal);
                    if (
                        runtime.manifest.indexGeneration !==
                            capture.baseGeneration ||
                        this.indexVersion(runtime.manifest) !==
                            capture.baseVersion
                    )
                        throw new ViewBuildStaleError(
                            "Corpus source index changed during ingestion preparation",
                        );
                    // Other stores and source synopses can advance while the detached
                    // index is prepared. Publish only the source change into fresh metadata.
                    const committedManifest = structuredClone(runtime.manifest);
                    delete committedManifest.pendingSourceForget;
                    const currentSource = committedManifest.sources.find(
                        (item) => item.sourceId === sourceId,
                    );
                    source.revisions = source.revisions.map((item) =>
                        item.revisionId === revisionId
                            ? item
                            : (currentSource?.revisions.find(
                                  (current) =>
                                      current.revisionId === item.revisionId,
                              ) ?? item),
                    );
                    committedManifest.sources = [
                        ...committedManifest.sources.filter(
                            (item) => item.sourceId !== sourceId,
                        ),
                        source,
                    ];
                    committedManifest.indexGeneration = indexGeneration;
                    revision.state = "ready";
                    revision.indexedAt = now();
                    committedManifest.corpus.status = "ready";
                    committedManifest.corpus.updatedAt = now();
                    committedManifest.corpus.documentCount =
                        committedManifest.sources.length;
                    committedManifest.changes = pruneChangeReceipts(
                        committedManifest.changes,
                    );
                    if (existing !== undefined) {
                        committedManifest.changes.push(
                            createChangeReceipt(
                                request.corpusId,
                                "replace",
                                sourceId,
                                { sources: 1, revisions: 1, knowledge: 0 },
                                existing.activeRevisionId,
                                revisionId,
                            ),
                        );
                    }
                    await this.updateJob(job, "persisting", {
                        completed: 1,
                        total: 1,
                        message: "Persisting corpus metadata",
                    });
                    await this.writeManifest(
                        request.corpusId,
                        committedManifest,
                    );
                    runtime.manifest = committedManifest;
                    runtime.index = candidateIndex;
                    committed = true;
                    await this.rememberDocumentIndex(request.corpusId, runtime);
                    candidateIndexDirectory = undefined;
                    await this.viewStore.markSourceRevisionStale(
                        request.corpusId,
                        sourceId,
                        revisionId,
                    );
                    await this.invalidateMaintainedViews(request.corpusId);
                    await this.cleanupReplacedAssets(
                        request.corpusId,
                        source,
                        existing,
                    );
                    await this.textStore(request.corpusId).purge(
                        runtime.manifest.sources,
                    );
                    await this.removeInactiveIndexGenerations(
                        request.corpusId,
                        indexGeneration,
                        existing !== undefined,
                    );
                    await this.updateJob(job, "complete", {
                        completed: 1,
                        total: 1,
                        message: "Ingestion complete",
                    });
                }),
            );
        } catch (error) {
            finishPreparation();
            await this.enqueueWrite(
                request.corpusId,
                () =>
                    this.handleIngestionFailure(
                        job,
                        signal,
                        error,
                        committed,
                        candidateIndexDirectory,
                        Boolean(request.source.assets?.length),
                    ),
                true,
            );
        } finally {
            finishPreparation();
            this.detachedRebuilds.delete(candidateDirectory);
            this.preparingIndexes.delete(candidateDirectory);
            this.controllers.delete(job.jobId);
        }
    }

    private async cleanupReplacedAssets(
        corpusId: string,
        source: StoredSource,
        existing?: StoredSource,
    ): Promise<void> {
        if (existing && existing.activeRevisionId !== source.activeRevisionId)
            await this.agentSessionStore.purge(corpusId, source.sourceId);
        const retained = new Set(
            source.revisions.map((revision) => revision.revisionId),
        );
        for (const removed of existing?.revisions ?? []) {
            if (retained.has(removed.revisionId) || !removed.assets?.length)
                continue;
            await this.assetStore.removeRevision({
                corpusId,
                sourceId: source.sourceId,
                revisionId: removed.revisionId,
            });
        }
    }

    private async handleIngestionFailure(
        job: IngestionJobStatus,
        signal: AbortSignal,
        error: unknown,
        committed: boolean,
        candidateIndexDirectory: string | undefined,
        hasAssets: boolean,
    ): Promise<void> {
        if (
            this.jobs.get(job.jobId)?.progress.message ===
            "Forgotten source; diagnostics removed"
        ) {
            if (candidateIndexDirectory !== undefined)
                await rm(candidateIndexDirectory, {
                    recursive: true,
                    force: true,
                });
            return;
        }
        if (committed) {
            job.warnings.push(
                `Post-commit maintenance failed: ${error instanceof Error ? error.message : String(error)}`,
            );
            await this.updateJob(job, "complete", {
                completed: 1,
                total: 1,
                message: "Source committed with maintenance warning",
            });
            return;
        }
        const runtime = await this.getCorpusRuntime(job.corpusId, true);
        if (
            hasAssets &&
            !runtime.manifest.sources.some(
                (source) =>
                    source.sourceId === job.sourceId &&
                    source.revisions.some(
                        (revision) => revision.revisionId === job.revisionId,
                    ),
            )
        ) {
            try {
                await this.assetStore.removeRevision({
                    corpusId: job.corpusId,
                    sourceId: job.sourceId,
                    revisionId: job.revisionId,
                });
            } catch (cleanupError) {
                job.warnings.push(
                    `Uncommitted asset cleanup failed: ${cleanupError instanceof Error ? cleanupError.message : String(cleanupError)}`,
                );
            }
        }
        if (candidateIndexDirectory !== undefined) {
            await rm(candidateIndexDirectory, {
                recursive: true,
                force: true,
            });
        }
        const cancelled = signal.aborted;
        await this.updateJob(
            job,
            cancelled ? "cancelled" : "failed",
            {
                ...job.progress,
                message: cancelled ? "Ingestion cancelled" : "Ingestion failed",
            },
            error instanceof Error ? error.message : String(error),
        );
    }

    private async enqueueIngestion(
        corpusId: string,
        operation: () => Promise<void>,
    ): Promise<void> {
        const previous = this.ingestionTails.get(corpusId) ?? Promise.resolve();
        const queuedAt = currentSearchTraceId() ? performance.now() : undefined;
        const work = previous.then(() => {
            if (queuedAt !== undefined)
                recordSearchTiming(
                    "ingestion.wait",
                    performance.now() - queuedAt,
                );
            return operation();
        });
        const settled = work.then(
            () => undefined,
            () => undefined,
        );
        this.ingestionTails.set(corpusId, settled);
        try {
            await work;
        } finally {
            if (this.ingestionTails.get(corpusId) === settled)
                this.ingestionTails.delete(corpusId);
        }
    }

    private async enqueueWrite<T>(
        corpusId: string,
        operation: () => Promise<T>,
        recoveringRemoval = false,
    ): Promise<T> {
        const runtime = await this.getCorpusRuntime(
            corpusId,
            recoveringRemoval,
        );
        const queuedAt = currentSearchTraceId() ? performance.now() : undefined;
        const run = async () => {
            if (!recoveringRemoval) this.assertRemovalComplete(runtime);
            if (queuedAt !== undefined)
                recordSearchTiming("queue.wait", performance.now() - queuedAt, {
                    corpusId,
                    access: "write",
                });
            const changes = pruneChangeReceipts(runtime.manifest.changes);
            if (changes.length !== (runtime.manifest.changes ?? []).length) {
                const candidate = { ...runtime.manifest, changes };
                await this.writeManifest(corpusId, candidate);
                runtime.manifest = candidate;
            }
            return operation();
        };
        return runtime.access.write(run);
    }

    private enqueueRead<T>(
        corpusId: string,
        ready: (runtime: CorpusRuntime) => Promise<boolean>,
        prepare: (runtime: CorpusRuntime) => Promise<void>,
        operation: (runtime: CorpusRuntime) => Promise<T>,
        detachedPreparation = false,
    ): Promise<T> {
        const read = this.readPreparedIndex(
            corpusId,
            ready,
            prepare,
            operation,
            detachedPreparation,
        );
        this.indexedReads.add(read);
        void read.then(
            () => this.indexedReads.delete(read),
            () => this.indexedReads.delete(read),
        );
        return read;
    }

    private async readPreparedIndex<T>(
        corpusId: string,
        ready: (runtime: CorpusRuntime) => Promise<boolean>,
        prepare: (runtime: CorpusRuntime) => Promise<void>,
        operation: (runtime: CorpusRuntime) => Promise<T>,
        detachedPreparation: boolean,
    ): Promise<T> {
        const runtime = await this.getCorpusRuntime(corpusId);
        for (let attempts = 0; ; attempts++) {
            const queuedAt = currentSearchTraceId()
                ? performance.now()
                : undefined;
            const result = await runtime.access.read(async () => {
                this.assertRemovalComplete(runtime);
                if (queuedAt !== undefined)
                    recordSearchTiming(
                        "queue.wait",
                        performance.now() - queuedAt,
                        {
                            corpusId,
                            access: "read",
                        },
                    );
                if (!(await ready(runtime))) return { ready: false as const };
                return {
                    ready: true as const,
                    value: await operation(runtime),
                };
            });
            if (result.ready) return result.value;
            if (detachedPreparation) {
                if (attempts >= 3)
                    throw new ViewBuildStaleError(
                        "Corpus index repeatedly changed during read preparation",
                    );
                await prepare(runtime);
            } else await this.enqueueWrite(corpusId, () => prepare(runtime));
        }
    }

    private enqueueDocumentRead<T>(
        corpusId: string,
        operation: (runtime: CorpusRuntime) => Promise<T>,
    ): Promise<T> {
        return this.enqueueRead(
            corpusId,
            (runtime) => this.documentIndexReady(corpusId, runtime),
            (runtime) => this.prepareDocumentReadIndex(corpusId, runtime),
            operation,
            true,
        );
    }

    private async prepareDocumentReadIndex(
        corpusId: string,
        runtime: CorpusRuntime,
    ): Promise<void> {
        let repair = this.documentRepairs.get(corpusId);
        if (!repair) {
            repair = (async () => {
                const ready = await this.enqueueWrite(corpusId, () =>
                    this.ensureDocumentIndex(corpusId, runtime, false),
                );
                if (!ready)
                    await this.reindex(
                        corpusId,
                        undefined,
                        new AbortController().signal,
                    );
            })();
            this.documentRepairs.set(corpusId, repair);
        }
        try {
            await repair;
        } finally {
            if (this.documentRepairs.get(corpusId) === repair)
                this.documentRepairs.delete(corpusId);
        }
    }

    private assertRemovalComplete(runtime: {
        manifest: Pick<
            CorpusManifest,
            "pendingCorpusClear" | "authorizedSourceRemoval"
        >;
    }): void {
        if (runtime.manifest.pendingCorpusClear)
            throw new ViewBuildStaleError(
                "Corpus clear is pending purge recovery; corpus reads and writes are withheld",
            );
        if (runtime.manifest.authorizedSourceRemoval)
            throw new ViewBuildStaleError(
                "Authorized source removal is pending purge recovery; corpus reads and writes are withheld",
            );
    }

    private async getCorpusRuntime(
        corpusId: string,
        recoveringRemoval = false,
    ): Promise<CorpusRuntime> {
        const cached = this.corpora.get(corpusId);
        if (cached !== undefined) {
            await this.eventStore(corpusId).recover();
            if (!recoveringRemoval) this.assertRemovalComplete(cached);
            return cached;
        }
        let loading = this.corpusLoads.get(corpusId);
        if (loading === undefined) {
            loading = this.loadCorpusRuntime(corpusId);
            this.corpusLoads.set(corpusId, loading);
        }
        try {
            const runtime = await loading;
            if (!recoveringRemoval) this.assertRemovalComplete(runtime);
            return runtime;
        } finally {
            if (this.corpusLoads.get(corpusId) === loading)
                this.corpusLoads.delete(corpusId);
        }
    }

    private async loadCorpusRuntime(corpusId: string): Promise<CorpusRuntime> {
        const manifest = await this.readManifest(corpusId);
        if (manifest === undefined) {
            throw new Error(`Unknown corpus '${corpusId}'`);
        }
        const persisted = await this.eventStore(corpusId).records();
        const records = [...persisted.events, ...persisted.suppressions];
        const events: MemoryEvent[] = [];
        const eventSuppressions: EventSuppression[] = [];
        const eventIdempotency = new Map<string, MemoryEvent>();
        const eventIds = new Set<string>();
        for (const record of records) {
            if ("recordType" in record) {
                this.validateStoredEventSuppression(record);
                eventSuppressions.push(record);
                continue;
            }
            const event = record;
            this.validateStoredEvent(event, corpusId);
            if (eventIds.has(event.eventId)) {
                throw new Error(
                    `Duplicate persisted event ID '${event.eventId}'`,
                );
            }
            eventIds.add(event.eventId);
            const key = eventIdempotencyKey(event);
            if (eventIdempotency.has(key)) {
                throw new Error(
                    `Duplicate persisted event idempotency key for producer '${event.producer.producerId}'`,
                );
            }
            eventIdempotency.set(key, event);
            events.push(event);
        }
        const runtime: CorpusRuntime = {
            manifest,
            index: this.createIndex(corpusId, manifest.indexGeneration),
            events,
            eventIdempotency,
            eventSuppressions: [],
            suppressedEventKeys: new Set(),
            suppressedConversations: new Set(),
            suppressedTurns: new Set(),
            access: this.corpusAccess(corpusId),
        };
        this.setEventSuppressions(runtime, eventSuppressions);
        for (const event of events) {
            if (runtime.suppressedEventKeys.has(eventIdempotencyKey(event))) {
                throw new Error(
                    `Persisted event '${event.eventId}' is suppressed`,
                );
            }
        }
        this.corpora.set(corpusId, runtime);
        return runtime;
    }

    private createIndex(
        corpusId: string,
        indexGeneration?: string,
    ): CorpusIndex {
        return this.indexFactory(
            corpusId,
            this.indexDirectory(corpusId, indexGeneration),
        );
    }

    private async ensureDocumentIndex(
        corpusId: string,
        runtime: CorpusRuntime,
        allowRebuild = true,
    ): Promise<boolean> {
        if (await this.documentIndexReady(corpusId, runtime)) return true;
        const generation = runtime.manifest.indexGeneration;
        if (generation !== undefined) {
            validateIdentifier("index generation", generation);
            const directory = this.indexDirectory(corpusId, generation);
            if (
                (await timeSearchStage(
                    "index.validate",
                    () =>
                        classifyIndexSchema(
                            directory,
                            "documents",
                            runtime.manifest.sources.length > 0,
                        ),
                    { corpusId, indexKind: "documents" },
                )) === "current"
            ) {
                await timeSearchStage(
                    "index.load",
                    () => runtime.index.initialize(),
                    {
                        corpusId,
                        indexKind: "documents",
                    },
                );
                await this.rememberDocumentIndex(corpusId, runtime);
                return true;
            }
            if (!allowRebuild) return false;
            await rm(directory, { recursive: true, force: true });
        } else if (runtime.manifest.sources.length === 0) {
            await timeSearchStage(
                "index.load",
                () => runtime.index.initialize(),
                {
                    corpusId,
                    indexKind: "documents",
                },
            );
            await this.rememberDocumentIndex(corpusId, runtime);
            return true;
        }
        if (!allowRebuild) return false;
        await timeSearchStage(
            "index.rebuild",
            () =>
                this.rebuildAndActivate(
                    corpusId,
                    runtime,
                    structuredClone(runtime.manifest),
                    new AbortController().signal,
                ),
            { corpusId, indexKind: "documents" },
        );
        return true;
    }

    private async documentIndexReady(
        corpusId: string,
        runtime: CorpusRuntime,
    ): Promise<boolean> {
        return timeSearchStage(
            "index.check",
            async () => {
                const prepared = runtime.documentIndex;
                const hit =
                    prepared !== undefined &&
                    prepared.index === runtime.index &&
                    prepared.generation === runtime.manifest.indexGeneration &&
                    prepared.fingerprint ===
                        (await indexFingerprint(
                            this.indexDirectory(corpusId, prepared.generation),
                            "documents",
                        ));
                recordSearchTiming("index.cache", 0, {
                    corpusId,
                    indexKind: "documents",
                    hit,
                });
                return hit;
            },
            { corpusId, indexKind: "documents" },
        );
    }

    private async rememberDocumentIndex(
        corpusId: string,
        runtime: CorpusRuntime,
    ): Promise<void> {
        runtime.documentIndex = {
            generation: runtime.manifest.indexGeneration,
            index: runtime.index,
            fingerprint: await indexFingerprint(
                this.indexDirectory(corpusId, runtime.manifest.indexGeneration),
                "documents",
            ),
        };
        this.scheduleTopics(corpusId, runtime);
    }

    private indexDirectory(corpusId: string, indexGeneration?: string): string {
        if (indexGeneration !== undefined) {
            validateIndexGeneration(indexGeneration);
        }
        return path.join(
            this.rootDirectory,
            corpusId,
            indexDirectoryName,
            ...(indexGeneration === undefined ? [] : [indexGeneration]),
        );
    }

    private activeDocuments(manifest: CorpusManifest): IndexedDocument[] {
        return manifest.sources.map((source) => {
            const revision = source.revisions.find(
                (item) => item.revisionId === source.activeRevisionId,
            );
            if (revision === undefined) {
                throw new Error(
                    `Source '${source.sourceId}' has no active revision`,
                );
            }

            return {
                source,
                revision,
                content: revision.content,
                pipeline: contentPipeline(revision.pipeline),
            };
        });
    }

    private eventIndexRoot(corpusId: string): string {
        return path.join(this.rootDirectory, corpusId, "event-search-index");
    }

    private eventIndexDirectory(corpusId: string, generation: string): string {
        validateIndexGeneration(generation);
        return path.join(this.eventIndexRoot(corpusId), generation);
    }

    private async removeDerivedIndexRoot(
        root: string,
        indexKind: IndexKind,
    ): Promise<void> {
        let entries;
        try {
            entries = await readdir(root, { withFileTypes: true });
        } catch (error) {
            if ((error as NodeJS.ErrnoException).code === "ENOENT") {
                return;
            }
            throw error;
        }
        for (const entry of entries) {
            if (entry.isDirectory() && entry.name !== jsonSegmentDirectory) {
                await classifyIndexSchema(
                    path.join(root, entry.name),
                    indexKind,
                    false,
                );
            }
        }
        await rm(root, { recursive: true, force: true });
        clearJsonSegmentCache(root);
    }

    private async purgeObsoleteEventIndex(
        corpusId: string,
        runtime: CorpusRuntime,
    ): Promise<EventIndexState | undefined> {
        const version = await this.eventStore(corpusId).version();
        const watermark = `${version.sequence}:${version.eligibilityRevision}`;
        const root = this.eventIndexRoot(corpusId);
        const state = await readJson<EventIndexState>(
            path.join(root, "state.json"),
        );
        if (state !== undefined) {
            validateIndexGeneration(state.generation);
            if (
                (await classifyIndexSchema(
                    this.eventIndexDirectory(corpusId, state.generation),
                    "conversation-events",
                    state.watermark === watermark && runtime.events.length > 0,
                )) === "reset"
            ) {
                await this.removeDerivedIndexRoot(root, "conversation-events");
                return undefined;
            }
        }
        if (state?.watermark !== watermark) {
            if (
                state?.eligibilityRevision === version.eligibilityRevision &&
                state.sequence !== undefined &&
                state.sequence <= version.sequence
            )
                return state;
            await this.removeDerivedIndexRoot(root, "conversation-events");
            return undefined;
        }
        return state;
    }

    private async getEventIndex(
        corpusId: string,
        runtime: CorpusRuntime,
    ): Promise<CorpusIndex> {
        const root = this.eventIndexRoot(corpusId);
        const store = this.eventStore(corpusId);
        const version = await store.version();
        let state = await this.purgeObsoleteEventIndex(corpusId, runtime);
        if (state !== undefined && state.sequence === version.sequence) {
            try {
                await access(
                    path.join(
                        this.eventIndexDirectory(corpusId, state.generation),
                        "ready",
                    ),
                );
                const index = this.eventIndexFactory(
                    corpusId,
                    this.eventIndexDirectory(corpusId, state.generation),
                );
                await index.initialize();
                return index;
            } catch (error) {
                if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
                    throw error;
                }
            }
            await this.removeDerivedIndexRoot(root, "conversation-events");
            state = undefined;
        }
        await mkdir(root, { recursive: true });
        const generation = randomUUID();
        const directory = this.eventIndexDirectory(corpusId, generation);
        await mkdir(directory);
        try {
            const index = this.eventIndexFactory(corpusId, directory);
            if (
                state &&
                index.append &&
                state.eligibilityRevision === version.eligibilityRevision
            ) {
                await cp(
                    this.eventIndexDirectory(corpusId, state.generation),
                    directory,
                    { recursive: true },
                );
                await index.append(
                    runtime.events
                        .filter(
                            (event) =>
                                store.sequenceFor(event.eventId) >
                                (state.sequence ?? 0),
                        )
                        .map((event) => this.eventDocument(event)),
                    new AbortController().signal,
                    async () => {},
                );
            } else {
                await index.rebuild(
                    runtime.events.map((event) => this.eventDocument(event)),
                    new AbortController().signal,
                    async () => {},
                );
            }
            await stampIndexSchema(
                directory,
                "conversation-events",
                runtime.events.length > 0,
            );
            await writeFile(path.join(directory, "ready"), "");
            await writeJsonAtomic(path.join(root, "state.json"), {
                generation,
                watermark: `${version.sequence}:${version.eligibilityRevision}`,
                ...version,
            } satisfies EventIndexState);
            const obsolete = (
                await readdir(root, { withFileTypes: true })
            ).filter(
                (entry) =>
                    entry.name !== generation &&
                    entry.name !== "state.json" &&
                    entry.name !== jsonSegmentDirectory,
            );
            for (const entry of obsolete) {
                if (entry.isDirectory()) {
                    await classifyIndexSchema(
                        path.join(root, entry.name),
                        "conversation-events",
                        false,
                    );
                }
            }
            for (const entry of obsolete) {
                await rm(path.join(root, entry.name), {
                    recursive: true,
                    force: true,
                });
            }
            await collectJsonSegments(root);
            return index;
        } catch (error) {
            await rm(directory, { recursive: true, force: true });
            throw error;
        }
    }

    private eventDocument(event: MemoryEvent): IndexedDocument {
        const authority = eventAuthority(event);
        const content = [
            `Event type: ${event.eventType}`,
            `Producer: ${event.producer.producerId} (${event.producer.producerType})`,
            `Source kind: ${event.sourceKind}`,
            `Observed at: ${event.observedAt}`,
            `Event time: ${event.eventTime}`,
            ...(event.conversationId === undefined
                ? []
                : [`Conversation: ${event.conversationId}`]),
            ...(event.runId === undefined ? [] : [`Run: ${event.runId}`]),
            ...(event.turnId === undefined ? [] : [`Turn: ${event.turnId}`]),
            ...(event.sender === undefined ? [] : [`Sender: ${event.sender}`]),
            ...(event.actionName === undefined
                ? []
                : [`Action: ${event.actionName}`]),
            ...(event.linkedSourceIds ?? []).map(
                (sourceId) => `Linked source: ${sourceId}`,
            ),
            ...(event.content === undefined ? [] : [event.content]),
            ...(event.metadata === undefined
                ? []
                : [JSON.stringify(event.metadata)]),
        ].join("\n");
        return {
            source: {
                sourceId: event.eventId,
                corpusId: event.corpusId,
                sourceType: "text",
                title: event.eventType,
                activeRevisionId: event.eventId,
            },
            revision: {
                revisionId: event.eventId,
                sourceId: event.eventId,
                contentHash: hashContent(content),
                mimeType: "text/plain",
                pipelineVersion,
                state: "ready",
            },
            content,
            indexTags: [
                `event-id:${event.eventId}`,
                `event-source-kind:${event.sourceKind}`,
                ...(authority === undefined
                    ? []
                    : [`event-authority:${authority}`]),
                `event-producer:${event.producer.producerId}`,
                `event-producer-type:${event.producer.producerType}`,
                `event-type:${event.eventType}`,
                `event-observed-at:${event.observedAt}`,
                `event-time:${event.eventTime}`,
                ...(event.conversationId === undefined
                    ? []
                    : [`event-conversation:${event.conversationId}`]),
                ...(event.runId === undefined
                    ? []
                    : [`event-run:${event.runId}`]),
                ...(event.turnId === undefined
                    ? []
                    : [`event-turn:${event.turnId}`]),
                ...(event.sender === undefined
                    ? []
                    : [`event-sender:${event.sender}`]),
                ...(event.actionName === undefined
                    ? []
                    : [`event-action:${event.actionName}`]),
                ...(event.linkedSourceIds ?? []).map(
                    (sourceId) => `event-linked-source:${sourceId}`,
                ),
            ],
            pipeline: { mode: "content" },
        };
    }

    private toMemorySource(source: StoredSource): MemorySource {
        const { revisions, ...document } = source;
        return {
            ...structuredClone(document),
            revisions: revisions.map((storedRevision) => {
                const {
                    content: _content,
                    locationMap: _locationMap,
                    synopsis: _synopsis,
                    ...revision
                } = storedRevision as typeof storedRevision & {
                    locationMap?: unknown;
                };
                return {
                    ...structuredClone(revision),
                    ...(this.sourceSynopsesEnabled
                        ? {
                              synopsis: this.sourceSynopsisPreview(
                                  source,
                                  storedRevision,
                              ),
                          }
                        : {}),
                    ...(revision.pipeline === undefined
                        ? {}
                        : { pipeline: contentPipeline(revision.pipeline) }),
                };
            }),
        };
    }

    private sourceSynopsisIdentity(): string {
        if (!this.synopsisModel && !this.synopsisModelFailure) {
            try {
                this.synopsisModel = configuredSourceSynopsisModel(
                    this.wikiModelEndpoint,
                );
            } catch (error) {
                this.synopsisModelFailure = safeError(error);
            }
        }
        return this.synopsisModel?.identity ?? "unavailable";
    }

    private synopsisEligible(
        source: StoredSource,
        revision: StoredRevision,
    ): boolean {
        return (
            source.activeRevisionId === revision.revisionId &&
            revision.state === "ready" &&
            !this.corpora
                .get(source.corpusId)
                ?.manifest.knowledgeSuppressions?.some(
                    (entry) => entry.sourceId === source.sourceId,
                )
        );
    }

    private synopsisFreshness(
        source: StoredSource,
        revision: StoredRevision,
    ): SourceSynopsisPreview["freshness"] {
        return revision.synopsis?.inputHash ===
            synopsisInputHash(
                source,
                revision,
                this.sourceSynopsisIdentity(),
                this.synopsisEligible(source, revision),
            )
            ? "fresh"
            : "stale";
    }

    private emptySourceSynopsis(
        source: StoredSource,
        revision: StoredRevision,
    ): SourceSynopsis {
        const identity = this.sourceSynopsisIdentity();
        const eligible = this.synopsisEligible(source, revision);
        return {
            corpusId: source.corpusId,
            sourceId: source.sourceId,
            revisionId: revision.revisionId,
            status: this.synopsisModel && eligible ? "pending" : "unavailable",
            freshness: "fresh",
            generatedVersion: 0,
            recipe: sourceSynopsisRecipe,
            inputHash: synopsisInputHash(source, revision, identity, eligible),
            ...(this.synopsisModelFailure
                ? { reason: this.synopsisModelFailure }
                : !eligible
                  ? {
                        reason: "Source revision is inactive, unready or suppressed",
                    }
                  : {}),
            evidence: [],
            influenceSources: [
                { sourceId: source.sourceId, revisionId: revision.revisionId },
            ],
            coverage: {
                method: "direct",
                scannedChars: 0,
                totalChars: revision.content.length,
                sectionCount: 0,
            },
            limitations: [
                "Synopsis is not yet available; indexed source search remains independent.",
            ],
        };
    }

    private sourceSynopsisPreview(
        source: StoredSource,
        revision: StoredRevision,
    ): SourceSynopsisPreview {
        const detail =
            revision.synopsis ?? this.emptySourceSynopsis(source, revision);
        const freshness = revision.synopsis
            ? this.synopsisFreshness(source, revision)
            : detail.freshness;
        return {
            status: detail.status,
            freshness,
            generatedVersion: detail.generatedVersion,
            recipe: detail.recipe,
            inputHash: detail.inputHash,
            ...(detail.preview && freshness === "fresh"
                ? { preview: detail.preview }
                : {}),
            ...(detail.generatedAt ? { generatedAt: detail.generatedAt } : {}),
            ...(detail.reason ? { reason: detail.reason } : {}),
        };
    }

    private scheduleSourceSynopses(corpusId: string): void {
        const key = `${corpusId}:synopsis`;
        if (
            !this.sourceSynopsesEnabled ||
            this.closed ||
            this.wikiTimers.has(key) ||
            this.synopsisWork.has(corpusId)
        )
            return;
        const timer = setTimeout(() => {
            this.wikiTimers.delete(key);
            const work = this.maintainSourceSynopses(corpusId);
            this.synopsisWork.set(corpusId, work);
            void work.then(
                () => {
                    this.synopsisWork.delete(corpusId);
                    this.wikiMaintenanceFailures.delete(key);
                },
                (error: unknown) => {
                    this.synopsisWork.delete(corpusId);
                    this.wikiMaintenanceFailures.set(
                        key,
                        new Error(safeError(error)),
                    );
                },
            );
        }, 250);
        timer.unref();
        this.wikiTimers.set(key, timer);
    }

    private async maintainSourceSynopses(corpusId: string): Promise<void> {
        const runtime = await this.getCorpusRuntime(corpusId, true);
        if (runtime.manifest.authorizedSourceRemoval) return;
        const ids = runtime.manifest.sources.map((source) => source.sourceId);
        for (const sourceId of ids) {
            if (this.closed) return;
            const capture = await this.enqueueWrite(
                corpusId,
                async () => {
                    const current = await this.getCorpusRuntime(corpusId, true);
                    if (current.manifest.authorizedSourceRemoval)
                        return undefined;
                    const candidate = structuredClone(current.manifest);
                    const source = candidate.sources.find(
                        (item) => item.sourceId === sourceId,
                    );
                    const revision = source?.revisions.find(
                        (item) => item.revisionId === source.activeRevisionId,
                    );
                    if (
                        !source ||
                        !revision ||
                        !this.synopsisEligible(source, revision)
                    )
                        return undefined;
                    const inputHash = synopsisInputHash(
                        source,
                        revision,
                        this.sourceSynopsisIdentity(),
                        true,
                    );
                    const prior = revision.synopsis;
                    if (
                        prior?.inputHash === inputHash &&
                        prior.status === "pending" &&
                        prior.attempts >= 2
                    ) {
                        revision.synopsis = {
                            ...prior,
                            status: "failed",
                            reason: "Interrupted synopsis exhausted its automatic retry; waiting for changed input",
                        };
                        await this.writeManifest(corpusId, candidate);
                        current.manifest = candidate;
                        return undefined;
                    }
                    if (
                        prior?.inputHash === inputHash &&
                        (prior.status === "ready" ||
                            prior.status === "unavailable" ||
                            prior.attempts >= 2)
                    )
                        return undefined;
                    const pending = this.emptySourceSynopsis(source, revision);
                    revision.synopsis = {
                        ...pending,
                        generatedVersion: prior?.generatedVersion ?? 0,
                        attempts:
                            prior?.inputHash === inputHash
                                ? prior.attempts + 1
                                : 1,
                    };
                    await this.writeManifest(corpusId, candidate);
                    current.manifest = candidate;
                    return {
                        source: structuredClone(source),
                        revision: structuredClone(revision),
                        inputHash,
                    };
                },
                true,
            );
            const synopsisModel = this.synopsisModel;
            if (!capture || !synopsisModel) continue;
            const controller = new AbortController();
            const key = `synopsis:${corpusId}:${sourceId}`;
            this.controllers.set(key, controller);
            const signal = AbortSignal.any([
                controller.signal,
                AbortSignal.timeout(90_000),
            ]);
            let generated:
                | Awaited<ReturnType<typeof generateSourceSynopsis>>
                | undefined;
            let failure: string | undefined;
            let failedCoverage = capture.revision.synopsis!.coverage;
            try {
                generated = await abortable(
                    runWithSearchTiming(
                        key,
                        "memory.synopsis",
                        () =>
                            timeSearchStage("synopsis.generate.total", () =>
                                generateSourceSynopsis(
                                    capture.source,
                                    capture.revision,
                                    capture.revision.content,
                                    synopsisModel,
                                    signal,
                                    (coverage) => {
                                        failedCoverage = coverage;
                                    },
                                ),
                            ),
                        {
                            corpusId,
                            sourceId,
                            revisionId: capture.revision.revisionId,
                        },
                    ),
                    signal,
                );
            } catch (error) {
                failure = safeError(error);
            } finally {
                this.controllers.delete(key);
            }
            if (this.closed) return;
            await this.enqueueWrite(
                corpusId,
                async () => {
                    const current = await this.getCorpusRuntime(corpusId, true);
                    if (current.manifest.authorizedSourceRemoval) return;
                    const candidate = structuredClone(current.manifest);
                    const source = candidate.sources.find(
                        (item) => item.sourceId === sourceId,
                    );
                    const revision = source?.revisions.find(
                        (item) =>
                            item.revisionId === capture.revision.revisionId,
                    );
                    if (
                        !source ||
                        !revision ||
                        !this.synopsisEligible(source, revision) ||
                        synopsisInputHash(
                            source,
                            revision,
                            this.sourceSynopsisIdentity(),
                            true,
                        ) !== capture.inputHash
                    )
                        return;
                    await this.assertInfluenceEligible({
                        corpusId,
                        influenceSources:
                            capture.revision.synopsis!.influenceSources,
                    });
                    const detail = revision.synopsis!;
                    if (generated)
                        revision.synopsis = {
                            ...detail,
                            ...generated,
                            status: "ready",
                            generatedAt: now(),
                            generatedVersion: detail.generatedVersion + 1,
                        };
                    else
                        revision.synopsis = {
                            ...detail,
                            status: "failed",
                            reason: failure ?? "Synopsis generation failed",
                            coverage: failedCoverage,
                            limitations: [
                                "Generation failed; scan counts describe submitted input, not accepted semantic coverage.",
                            ],
                        };
                    await this.writeManifest(corpusId, candidate);
                    current.manifest = candidate;
                },
                true,
            );
        }
    }

    private collectEventSuppressions(
        existing: EventSuppression[],
        deleted: MemoryEvent[],
        request: MemoryEventFilter & { eventIds?: string[] },
    ): EventSuppression[] {
        const suppressions = [...existing];
        const known = new Set(
            suppressions.map((suppression) => JSON.stringify(suppression)),
        );
        const add = (suppression: EventSuppression) => {
            const key = JSON.stringify(suppression);
            if (!known.has(key)) {
                known.add(key);
                suppressions.push(suppression);
            }
        };
        for (const event of deleted) {
            add({
                recordType: "event-suppression",
                scope: "idempotency",
                producerId: event.producer.producerId,
                idempotencyKey: event.idempotencyKey,
            });
            if (event.turnId !== undefined) {
                const authority = eventAuthority(event);
                add({
                    recordType: "event-suppression",
                    scope: "turn",
                    ...(event.conversationId === undefined
                        ? {}
                        : { conversationId: event.conversationId }),
                    turnId: event.turnId,
                    sourceKind: event.sourceKind,
                    ...(request.authorities === undefined ||
                    authority === undefined
                        ? {}
                        : { authority }),
                });
            }
        }
        addExplicitTurnSuppressions(request, add);
        if (isWholeConversationForget(request)) {
            for (const conversationId of request.conversationIds ?? []) {
                for (const sourceKind of request.sourceKinds ?? [undefined]) {
                    add({
                        recordType: "event-suppression",
                        scope: "conversation",
                        conversationId,
                        ...(sourceKind === undefined ? {} : { sourceKind }),
                    });
                }
            }
        }
        return suppressions;
    }

    private setEventSuppressions(
        runtime: EventSuppressionState,
        suppressions: EventSuppression[],
    ): void {
        runtime.eventSuppressions = suppressions;
        runtime.suppressedEventKeys = new Set(
            suppressions
                .filter(
                    (
                        item,
                    ): item is Extract<
                        EventSuppression,
                        { scope: "idempotency" }
                    > => item.scope === "idempotency",
                )
                .map(eventIdempotencyKey),
        );
        runtime.suppressedConversations = new Set(
            suppressions.flatMap((item) =>
                item.scope === "conversation"
                    ? [
                          suppressedConversationKey(
                              item.conversationId,
                              item.sourceKind,
                          ),
                      ]
                    : [],
            ),
        );
        runtime.suppressedTurns = new Set(
            suppressions.flatMap((item) =>
                item.scope === "turn"
                    ? [
                          suppressedTurnKey(
                              item.conversationId,
                              item.turnId,
                              item.sourceKind,
                              item.authority,
                          ),
                      ]
                    : [],
            ),
        );
    }

    private validateStoredEventSuppression(
        suppression: EventSuppression,
    ): void {
        if (suppression.recordType !== "event-suppression") {
            throw new Error("Invalid persisted event suppression record");
        }
        switch (suppression.scope) {
            case "idempotency":
                validateIdentifier("producer ID", suppression.producerId);
                if (
                    typeof suppression.idempotencyKey !== "string" ||
                    suppression.idempotencyKey.length === 0 ||
                    suppression.idempotencyKey.length > 500
                ) {
                    throw new Error("Invalid persisted event idempotency key");
                }
                break;
            case "conversation":
                validateIdentifier(
                    "conversation ID",
                    suppression.conversationId,
                );
                if (
                    suppression.sourceKind !== undefined &&
                    !eventSourceKinds.has(suppression.sourceKind)
                ) {
                    throw new Error("Invalid persisted event source kind");
                }
                break;
            case "turn":
                validateIdentifier("turn ID", suppression.turnId);
                if (
                    suppression.sourceKind !== undefined &&
                    !eventSourceKinds.has(suppression.sourceKind)
                ) {
                    throw new Error("Invalid persisted event source kind");
                }
                if (suppression.authority !== undefined) {
                    validateEventAuthority(suppression.authority);
                }
                if (suppression.conversationId !== undefined) {
                    validateIdentifier(
                        "conversation ID",
                        suppression.conversationId,
                    );
                }
                break;
            default:
                throw new Error("Invalid persisted event suppression scope");
        }
    }

    private validateEventAppendRequest(
        request: MemoryEventAppendRequest,
    ): void {
        validateIdentifier("corpus ID", request.corpusId);
        validateIdentifier("producer ID", request.producer.producerId);
        validateIdentifier("producer type", request.producer.producerType);
        validateIdentifier("event type", request.eventType);
        if (!eventSourceKinds.has(request.sourceKind)) {
            throw new Error(
                `Invalid event source kind '${request.sourceKind}'`,
            );
        }
        if (request.sender !== undefined && !eventSenders.has(request.sender)) {
            throw new Error(`Invalid event sender '${request.sender}'`);
        }
        if (
            request.idempotencyKey.length === 0 ||
            request.idempotencyKey.length > 500
        ) {
            throw new Error(
                "Event idempotency key must contain 1 to 500 characters",
            );
        }
        if (
            request.content !== undefined &&
            request.content.length > 1_000_000
        ) {
            throw new Error(
                "Event content exceeds the 1000000 character limit",
            );
        }
        if (
            request.actionName !== undefined &&
            (request.actionName.length === 0 || request.actionName.length > 500)
        ) {
            throw new Error(
                "Event action name must contain 1 to 500 characters",
            );
        }
        if (
            request.metadata !== undefined &&
            JSON.stringify(request.metadata).length > 262_144
        ) {
            throw new Error(
                "Event metadata exceeds the 262144 character limit",
            );
        }
        if (request.metadata !== undefined && "authority" in request.metadata) {
            if (typeof request.metadata.authority !== "string") {
                throw new Error("Event authority must be a string");
            }
            validateEventAuthority(request.metadata.authority);
        }
        for (const [kind, value] of [
            ["conversation ID", request.conversationId],
            ["run ID", request.runId],
            ["turn ID", request.turnId],
        ] as const) {
            if (value !== undefined) {
                validateIdentifier(kind, value);
            }
        }
        for (const sourceId of request.linkedSourceIds ?? []) {
            validateIdentifier("linked source ID", sourceId);
        }
        if ((request.linkedSourceIds?.length ?? 0) > 1_000) {
            throw new Error("An event may link to at most 1000 sources");
        }
        if (request.observedAt !== undefined) {
            validateTimestamp("observed timestamp", request.observedAt);
        }
        if (request.eventTime !== undefined) {
            validateTimestamp("event timestamp", request.eventTime);
        }
    }

    private validateEventFilterRequest(
        request: MemoryEventFilter & { corpusId: string },
    ): void {
        validateIdentifier("corpus ID", request.corpusId);
        for (const authority of request.authorities ?? []) {
            validateEventAuthority(authority);
        }
        for (const producerId of request.producerIds ?? []) {
            validateIdentifier("producer ID", producerId);
        }
        for (const eventType of request.eventTypes ?? []) {
            validateIdentifier("event type", eventType);
        }
        for (const conversationId of request.conversationIds ?? []) {
            validateIdentifier("conversation ID", conversationId);
        }
        for (const turnId of request.turnIds ?? []) {
            validateIdentifier("turn ID", turnId);
        }
        for (const runId of request.runIds ?? []) {
            validateIdentifier("run ID", runId);
        }
        for (const sourceId of request.linkedSourceIds ?? []) {
            validateIdentifier("linked source ID", sourceId);
        }
        for (const [kind, value] of [
            ["observed-from timestamp", request.observedFrom],
            ["observed-to timestamp", request.observedTo],
            ["event-from timestamp", request.eventFrom],
            ["event-to timestamp", request.eventTo],
        ] as const) {
            if (value !== undefined) {
                validateTimestamp(kind, value);
            }
        }
        if (
            request.observedFrom !== undefined &&
            request.observedTo !== undefined &&
            Date.parse(request.observedFrom) > Date.parse(request.observedTo)
        ) {
            throw new Error("Observed time range is inverted");
        }
        if (
            request.eventFrom !== undefined &&
            request.eventTo !== undefined &&
            Date.parse(request.eventFrom) > Date.parse(request.eventTo)
        ) {
            throw new Error("Event time range is inverted");
        }
    }

    private validateStoredEvent(event: MemoryEvent, corpusId: string): void {
        if (
            typeof event !== "object" ||
            event === null ||
            event.corpusId !== corpusId ||
            typeof event.eventId !== "string" ||
            typeof event.idempotencyKey !== "string" ||
            typeof event.eventType !== "string" ||
            typeof event.observedAt !== "string" ||
            typeof event.eventTime !== "string" ||
            typeof event.createdAt !== "string" ||
            typeof event.producer !== "object" ||
            event.producer === null ||
            typeof event.producer.producerId !== "string" ||
            typeof event.producer.producerType !== "string"
        ) {
            throw new Error(`Invalid persisted event in corpus '${corpusId}'`);
        }
        validateIdentifier("event ID", event.eventId);
        this.validateEventAppendRequest({
            corpusId: event.corpusId,
            idempotencyKey: event.idempotencyKey,
            producer: event.producer,
            eventType: event.eventType,
            sourceKind: event.sourceKind,
            observedAt: event.observedAt,
            eventTime: event.eventTime,
            ...(event.content === undefined ? {} : { content: event.content }),
            ...(event.conversationId === undefined
                ? {}
                : { conversationId: event.conversationId }),
            ...(event.runId === undefined ? {} : { runId: event.runId }),
            ...(event.turnId === undefined ? {} : { turnId: event.turnId }),
            ...(event.sender === undefined ? {} : { sender: event.sender }),
            ...(event.actionName === undefined
                ? {}
                : { actionName: event.actionName }),
            ...(event.linkedSourceIds === undefined
                ? {}
                : { linkedSourceIds: event.linkedSourceIds }),
            ...(event.metadata === undefined
                ? {}
                : { metadata: event.metadata }),
        });
        validateTimestamp("created timestamp", event.createdAt);
    }

    private async writeEvents(
        corpusId: string,
        events: MemoryEvent[],
        suppressions: EventSuppression[],
    ): Promise<void> {
        try {
            await this.eventStore(corpusId).replace(events, suppressions);
        } catch (error) {
            this.corpora.delete(corpusId);
            throw error;
        }
    }

    private async saveJob(job: IngestionJobStatus): Promise<void> {
        await this.serializeJobWrite(job.jobId, async () => {
            await writeRunbookJson(
                this.jobPath(job.jobId),
                JSON.stringify(job),
            );
            this.jobs.set(job.jobId, job);
        });
    }

    private async serializeJobWrite<T>(
        jobId: string,
        operation: () => Promise<T>,
    ): Promise<T> {
        const previous = this.jobWrites.get(jobId) ?? Promise.resolve();
        const task = previous.then(operation, operation);
        const settled = task.then(
            () => undefined,
            () => undefined,
        );
        this.jobWrites.set(jobId, settled);
        try {
            return await task;
        } finally {
            if (this.jobWrites.get(jobId) === settled)
                this.jobWrites.delete(jobId);
        }
    }

    private async updateJob(
        job: IngestionJobStatus,
        state: JobState,
        progress: JobProgress,
        error?: string,
    ): Promise<void> {
        await this.serializeJobWrite(job.jobId, async () => {
            const current = this.jobs.get(job.jobId) ?? job;
            if (
                current.progress.message ===
                "Forgotten source; diagnostics removed"
            ) {
                Object.assign(job, current);
                return;
            }
            const terminal = ["complete", "partial", "failed", "cancelled"];
            if (
                !terminal.includes(state) &&
                (terminal.includes(current.state) ||
                    (current.state === "cancelling" && state !== "cancelling"))
            ) {
                Object.assign(job, current);
                return;
            }
            const timestamp = now();
            const updated: IngestionJobStatus = {
                ...job,
                state,
                progress,
                updatedAt: timestamp,
                trace: [
                    ...(current.trace ?? []),
                    { state, timestamp, ...progress },
                ],
                ...(error === undefined ? {} : { error }),
            };
            await writeRunbookJson(
                this.jobPath(job.jobId),
                JSON.stringify(updated),
            );
            Object.assign(job, updated);
            this.jobs.set(job.jobId, job);
        });
    }

    private textStore(corpusId: string): RevisionTextStore {
        let store = this.textStores.get(corpusId);
        if (!store) {
            store = new RevisionTextStore(
                path.join(this.rootDirectory, corpusId, "revision-text"),
                this.revisionTextCheckpoint,
            );
            this.textStores.set(corpusId, store);
        }
        return store;
    }

    private async cleanManifestStaging(corpusId: string): Promise<void> {
        const directory = path.join(this.rootDirectory, corpusId);
        for (const entry of await readdir(directory, { withFileTypes: true })) {
            if (!/^manifest\.json\.[a-f0-9-]{36}\.staging$/.test(entry.name))
                continue;
            if (!entry.isFile())
                throw new Error("Unsafe staged corpus manifest");
            await rm(path.join(directory, entry.name));
        }
    }

    private async readSerializedManifest(
        corpusId: string,
    ): Promise<SerializedCorpusManifest | undefined> {
        const stored = await readJson<SerializedCorpusManifest>(
            this.manifestPath(corpusId),
        );
        if (!stored) return undefined;
        if (stored.storageVersion !== 1)
            throw new Error(
                `Unsupported corpus manifest storage version '${stored.storageVersion}' for '${corpusId}'; reset/reimport this corpus using a compatible build. Canonical data was not deleted.`,
            );
        return stored;
    }

    private async readManifest(
        corpusId: string,
    ): Promise<CorpusManifest | undefined> {
        const stored = await this.readSerializedManifest(corpusId);
        if (!stored) return undefined;
        const { storageVersion: _version, ...manifest } = stored;
        const store = this.textStore(corpusId);
        const sources: StoredSource[] = [];
        for (const source of stored.sources) {
            const revisions: StoredRevision[] = [];
            for (const revision of source.revisions) {
                const { text: _text, ...metadata } = revision;
                revisions.push({
                    ...metadata,
                    content: await store.read(revision),
                });
            }
            sources.push({ ...source, revisions });
        }
        return { ...manifest, sources };
    }

    private async writeManifest(
        corpusId: string,
        manifest: CorpusManifest,
    ): Promise<void> {
        const store = this.textStore(corpusId);
        const sources = [];
        // Publication is serialized by the corpus reservation. Stage new blobs
        // first; a crash can leave only unreferenced blobs, never dangling refs.
        for (const source of manifest.sources) {
            const revisions = [];
            for (const revision of source.revisions)
                revisions.push(await store.prepare(revision));
            sources.push({ ...source, revisions });
        }
        const stored: SerializedCorpusManifest = {
            ...manifest,
            storageVersion: 1,
            sources,
        };
        await store.prepared();
        await writeRunbookJson(
            this.manifestPath(corpusId),
            `${JSON.stringify(stored, undefined, 2)}\n`,
        );
    }

    private manifestPath(corpusId: string): string {
        return path.join(this.rootDirectory, corpusId, manifestFileName);
    }

    private eventsPath(corpusId: string): string {
        return path.join(this.rootDirectory, corpusId, eventsFileName);
    }

    private jobPath(jobId: string): string {
        return path.join(
            this.rootDirectory,
            jobsDirectoryName,
            `${jobId}.json`,
        );
    }

    private mimeType(
        sourceType: DocumentIngestRequest["source"]["sourceType"],
    ): string {
        switch (sourceType) {
            case "html":
                return "text/html";
            case "markdown":
            case "web":
                return "text/markdown";
            case "vtt":
                return "text/vtt";
            case "text":
                return "text/plain";
        }
    }

    private throwIfAborted(signal: AbortSignal): void {
        if (signal.aborted) {
            throw signal.reason ?? new Error("Ingestion cancelled");
        }
    }
}

// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { createHash, randomUUID } from "node:crypto";
import {
    access,
    appendFile,
    cp,
    mkdir,
    readFile,
    readdir,
    rename,
    rm,
    writeFile,
} from "node:fs/promises";
import path from "node:path";
import { userInfo } from "node:os";
import type {
    MemoryViewService,
    ViewSaveRequest,
    ViewArchiveRequest,
    ViewReadRequest,
    ViewHistoryEntry,
    ViewSnapshot,
    ViewVersion,
} from "./viewTypes.js";
import { validateViewDraft, validateViewArchive } from "./viewValidation.js";
import lockfile from "proper-lockfile";
import {
    currentSearchTraceId,
    recordSearchTiming,
    runWithSearchTiming,
    timeSearchStage,
} from "@typeagent/knowpro";
import { CorpusAccess } from "./corpusAccess.js";
import {
    getProcedureEvidenceReferences,
    normalizeAgentEditionDocument,
    type RunbookBindingValidator,
} from "./agentEdition.js";
import { redactRunbookText, redactRunbookValue } from "./runbookRedaction.js";
import {
    RevisionAssetStore,
    revisionDigest,
    validateAssetInputs,
    type RevisionAssetRequest,
    type RevisionAssetReadRequest,
    type RevisionAssetDescriptor,
} from "./revisionAssetStore.js";
import {
    MemoryBatchStore,
    type MemoryBatchImportRequest,
    type MemoryBatchImportLookup,
    type MemoryBatchImport,
} from "./batchImport.js";
import { RunbookJobStore } from "./runbookJobs.js";
import { writeRunbookJson } from "./durableRunbookJson.js";
import {
    runbookPreferences,
    type RunbookSynthesizer,
    type RunbookJobResult,
    type RunbookSynthesisRequest,
    type RunbookSynthesisInput,
} from "./runbookPipeline.js";
import { createConfiguredRunbookSynthesizer } from "./runbookSynthesizer.js";
import {
    createChangeReceipt,
    opaqueChangeReference,
    pageChangeReceipts,
    pruneChangeReceipts,
} from "./changeReceipts.js";
import { createKnowProCorpusIndex } from "./knowProCorpusIndex.js";
import {
    classifyIndexSchema,
    indexFingerprint,
    stampIndexSchema,
    type IndexKind,
} from "./indexSchema.js";
import {
    detectProcedureCandidates,
    PersonalHowToStore,
    procedureFromMarkdown,
} from "./personalHowToStore.js";
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
    MemoryCorpus,
    MemoryCorpusStatus,
    MemoryChangeReceipt,
    MemoryChangeListRequest,
    MemoryEvent,
    MemoryEventAuthority,
    MemoryEventAppendRequest,
    MemoryEventAppendResult,
    MemoryEventFilter,
    MemoryEventForgetRequest,
    MemoryEventForgetResult,
    MemoryEventListRequest,
    MemoryEventSearchRequest,
    MemoryEventSearchResult,
    MemoryAnswerRequest,
    MemoryAnswerResult,
    MemoryEvidence,
    MemoryKnowledgeGraph,
    MemorySearchRequest,
    MemorySearchResult,
    MemoryService,
    MemoryServiceCapabilities,
    MemorySource,
    MemoryPage,
    PersonalHowToSettings,
    PersonalHowToSettingsUpdate,
    PersonalHowToService,
    ProcedureCandidate,
    ProcedureCandidateCreateRequest,
    ProcedureListRequest,
    ProcedureSaveRequest,
    ProcedureSearchMatch,
    ProcedureSearchRequest,
    ProcedureSummary,
    ProcedureVersion,
    ProcedureDocument,
    ProcedureSourceCitation,
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
} from "./types.js";

const manifestFileName = "manifest.json";
const eventsFileName = "events.jsonl";
const jobsDirectoryName = "jobs";
const indexDirectoryName = "index";
const pipelineVersion = "1";
const eventSourceKinds = new Set([
    "conversation",
    "document",
    "web-activity",
    "procedure",
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
}

interface EventIndexState {
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
    procedureIndex?: PreparedCorpusIndex;
}

interface PreparedCorpusIndex {
    generation: string | undefined;
    index: CorpusIndex;
    fingerprint: string;
}

export interface FileMemoryServiceOptions {
    /** Local developer/demo capability. Drafts only; ordinary installations leave this off. */
    viewDrafts?: boolean;
    runbookBindingValidator?: RunbookBindingValidator;
    runbookSynthesizer?: RunbookSynthesizer;
    runbookModelEndpoint?: string;
    runbookMultimodal?: boolean;
    indexFactory?: CorpusIndexFactory;
    procedureIndexFactory?: CorpusIndexFactory;
    eventIndexFactory?: CorpusIndexFactory;
    capabilities?: MemoryServiceCapabilities;
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

function raceWithAbort<T>(
    operation: Promise<T>,
    signal: AbortSignal,
): Promise<T> {
    if (signal.aborted) {
        void operation.catch(() => undefined);
        return Promise.reject(
            signal.reason ?? new Error("Operation cancelled"),
        );
    }
    return new Promise<T>((resolve, reject) => {
        const abort = () =>
            reject(signal.reason ?? new Error("Operation cancelled"));
        signal.addEventListener("abort", abort, { once: true });
        operation.then(
            (value) => {
                signal.removeEventListener("abort", abort);
                resolve(value);
            },
            (error) => {
                signal.removeEventListener("abort", abort);
                reject(error);
            },
        );
    });
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

function eventIndexWatermark(events: readonly MemoryEvent[]): string {
    return hashContent(events.map((event) => event.eventId).join("\n"));
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
    const match =
        /^(\d{4})-(\d{2})-(\d{2})T(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d+)?(?:Z|[+-](?:[01]\d|2[0-3]):[0-5]\d)$/.exec(
            value,
        );
    if (match === null || !Number.isFinite(Date.parse(value))) {
        throw new Error(`Invalid search ${kind}; expected an ISO timestamp`);
    }
    const year = Number(match[1]);
    const month = Number(match[2]);
    const day = Number(match[3]);
    const leapYear = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
    const days = [
        31,
        leapYear ? 29 : 28,
        31,
        30,
        31,
        30,
        31,
        31,
        30,
        31,
        30,
        31,
    ][month - 1];
    if (days === undefined || day < 1 || day > days) {
        throw new Error(`Invalid search ${kind}; expected an ISO timestamp`);
    }
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

function isSuppressedTurn(
    runtime: CorpusRuntime,
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

async function readEventRecords(
    filePath: string,
): Promise<(MemoryEvent | EventSuppression)[]> {
    let content: string;
    try {
        content = await readFile(filePath, "utf8");
    } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") {
            return [];
        }
        throw error;
    }
    if (content.trim().length === 0) {
        return [];
    }
    return content
        .split(/\r?\n/)
        .filter((line) => line.length > 0)
        .map((line, index) => {
            try {
                return JSON.parse(line) as MemoryEvent | EventSuppression;
            } catch (error) {
                throw new Error(
                    `Invalid event record at line ${index + 1}: ${String(error)}`,
                );
            }
        });
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
    implements MemoryService, PersonalHowToService, MemoryViewService
{
    private readonly viewDrafts: boolean;
    private readonly indexFactory: CorpusIndexFactory;
    private readonly procedureIndexFactory: CorpusIndexFactory;
    private readonly eventIndexFactory: CorpusIndexFactory;
    private readonly capabilities: MemoryServiceCapabilities;
    private readonly personalHowToStore: PersonalHowToStore;
    private readonly assetStore: RevisionAssetStore;
    private readonly batchStore: MemoryBatchStore;
    private readonly runbookJobs: RunbookJobStore;
    private readonly runbookMultimodal: boolean;
    private readonly corpora = new Map<string, CorpusRuntime>();
    private readonly corpusLoads = new Map<string, Promise<CorpusRuntime>>();
    private readonly indexedReads = new Set<Promise<unknown>>();
    private readonly jobs = new Map<string, IngestionJobStatus>();
    private readonly jobWrites = new Map<string, Promise<void>>();
    private readonly controllers = new Map<string, AbortController>();
    private initializePromise: Promise<void> | undefined;
    private releaseLock: (() => Promise<void>) | undefined;
    private rootWriteTail: Promise<void> = Promise.resolve();
    private closed = false;

    public constructor(
        private readonly rootDirectory: string,
        options: FileMemoryServiceOptions = {},
    ) {
        this.viewDrafts = options.viewDrafts === true;
        this.indexFactory = options.indexFactory ?? createKnowProCorpusIndex;
        this.procedureIndexFactory =
            options.procedureIndexFactory ?? this.indexFactory;
        this.eventIndexFactory =
            options.eventIndexFactory ?? this.procedureIndexFactory;
        this.capabilities = options.capabilities ?? defaultCapabilities();
        this.assetStore = new RevisionAssetStore(rootDirectory);
        this.batchStore = new MemoryBatchStore(rootDirectory, this);
        this.runbookMultimodal = options.runbookMultimodal ?? false;
        this.runbookJobs = new RunbookJobStore(
            rootDirectory,
            options.runbookSynthesizer ??
                createConfiguredRunbookSynthesizer(
                    options.runbookModelEndpoint,
                ),
            (input, candidates, signal) =>
                this.enqueueWrite(input.corpusId, async () => {
                    signal.throwIfAborted();
                    const runtime = await this.getCorpusRuntime(input.corpusId);
                    const source = runtime.manifest.sources.find(
                        (item) => item.sourceId === input.sourceId,
                    );
                    if (source?.activeRevisionId !== input.revisionId)
                        throw new Error(
                            "Source revision changed before draft publication",
                        );
                    await this.personalHowToStore.createDetectedCandidates(
                        candidates.map((candidate) => ({
                            ...candidate,
                            ...normalizeAgentEditionDocument(candidate),
                        })),
                    );
                }),
        );
        this.personalHowToStore = new PersonalHowToStore(
            rootDirectory,
            (corpusId, procedures) =>
                this.publishProcedureIndex(corpusId, procedures),
            options.runbookBindingValidator,
            userInfo().username,
        );
    }

    public initialize(): Promise<void> {
        if (this.closed) {
            return Promise.reject(new Error("Memory service is closed"));
        }
        this.initializePromise ??= this.acquireStorageLock().then(async () => {
            const directories = await readdir(this.rootDirectory, {
                withFileTypes: true,
            });
            for (const directory of directories) {
                if (
                    directory.isDirectory() &&
                    /^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/.test(directory.name)
                )
                    await this.personalHowToStore.recover(directory.name);
            }
            await this.pruneStoredChanges();
            await this.recoverInterruptedJobs();
            await this.batchStore.recover();
            await this.runbookJobs.recover();
        });
        return this.initializePromise;
    }

    public async close(): Promise<void> {
        if (this.closed) {
            return;
        }
        this.closed = true;
        await this.initializePromise?.catch(() => undefined);
        for (const controller of this.controllers.values()) {
            controller.abort(new Error("Memory service is closing"));
        }
        await this.batchStore.close();
        await this.runbookJobs.close();
        await Promise.allSettled([
            this.rootWriteTail,
            ...this.corpusLoads.values(),
            ...this.indexedReads,
        ]);
        await Promise.allSettled(
            [...this.corpora.values()].map((runtime) => runtime.access.idle()),
        );
        await this.releaseLock?.();
        this.releaseLock = undefined;
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
            await writeJsonAtomic(this.manifestPath(corpusId), manifest);
            const index = this.createIndex(corpusId);
            this.corpora.set(corpusId, {
                manifest,
                index,
                events: [],
                eventIdempotency: new Map(),
                eventSuppressions: [],
                suppressedEventKeys: new Set(),
                suppressedConversations: new Set(),
                suppressedTurns: new Set(),
                access: new CorpusAccess(),
            });
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
            const manifest = await readJson<CorpusManifest>(
                this.manifestPath(entry.name),
            );
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
        await this.runbookJobs.purge(corpusId);
        let clearedCount = 0;
        await this.enqueueWrite(corpusId, async () => {
            const runtime = await this.getCorpusRuntime(corpusId);
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
            clearedCount = runtime.manifest.sources.length;
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
            };
            await writeJsonAtomic(
                this.manifestPath(corpusId),
                candidateManifest,
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
            runtime.manifest = candidateManifest;
            runtime.index = candidateIndex;
            await this.rememberDocumentIndex(corpusId, runtime);
            runtime.events = [];
            runtime.eventIdempotency.clear();
            this.setEventSuppressions(runtime, suppressions);
            for (const source of removedSources) {
                for (const revision of source.revisions) {
                    if (!revision.assets?.length) continue;
                    await this.assetStore.removeRevision({
                        corpusId,
                        sourceId: source.sourceId,
                        revisionId: revision.revisionId,
                    });
                }
            }
            for (const source of removedSources) {
                await this.personalHowToStore.markStale(
                    corpusId,
                    source.sourceId,
                );
                await this.rejectObsoleteRunbookCandidates(
                    corpusId,
                    source.sourceId,
                );
            }
            await this.removeDerivedIndexRoot(
                this.eventIndexRoot(corpusId),
                "conversation-events",
            );
            await this.removeInactiveIndexGenerations(
                corpusId,
                indexGeneration,
            );
        });
        return clearedCount;
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
        return {
            descriptor,
            bytes: await this.assetStore.read(request, descriptor),
        };
    }

    public async startBatchImport(
        request: MemoryBatchImportRequest,
    ): Promise<MemoryBatchImport> {
        await this.initialize();
        validateIdentifier("corpus ID", request.corpusId);
        await this.getCorpusRuntime(request.corpusId);
        return this.enqueueRootWrite(() => this.batchStore.start(request));
    }

    public async getBatchImport(batchId: string): Promise<MemoryBatchImport> {
        await this.initialize();
        return this.batchStore.get(batchId);
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
        return this.batchStore.list(corpusId);
    }

    public async retryBatchImport(batchId: string): Promise<MemoryBatchImport> {
        await this.initialize();
        return this.enqueueRootWrite(() => this.batchStore.retry(batchId));
    }

    public async cancelBatchImport(
        batchId: string,
    ): Promise<MemoryBatchImport> {
        await this.initialize();
        return this.batchStore.cancel(batchId);
    }

    public async listRunbookJobs(
        corpusId: string,
    ): Promise<RunbookJobResult[]> {
        await this.initialize();
        validateIdentifier("corpus ID", corpusId);
        return this.runbookJobs.list(corpusId);
    }

    public async getRunbookJob(
        jobId: string,
    ): Promise<RunbookJobResult | undefined> {
        await this.initialize();
        return this.runbookJobs.get(jobId);
    }

    public async requestRunbookSynthesis(
        request: RunbookSynthesisRequest,
    ): Promise<RunbookJobResult> {
        await this.initialize();
        validateIdentifier("corpus ID", request.corpusId);
        validateIdentifier("source ID", request.sourceId);
        validateIdentifier("revision ID", request.revisionId);
        return this.enqueueWrite(request.corpusId, async () =>
            this.runbookJobs.start(
                await this.buildRunbookSynthesisInput(request),
            ),
        );
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
        const contentHash = request.source.contentHash ?? hashContent(content);
        if (contentHash !== hashContent(content)) {
            throw new Error("The supplied content hash does not match content");
        }
        const sourceId = request.source.sourceId ?? randomUUID();
        validateIdentifier("source ID", sourceId);
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
        void this.enqueueWrite(request.corpusId, async () => {
            await this.processIngestion(
                request,
                content,
                contentHash,
                sourceId,
                revisionId,
                job,
                controller.signal,
            );
        });
        return {
            jobId,
            sourceId,
            revisionId,
            state: "accepted",
            statusUri: `typeagent-memory://jobs/${jobId}`,
        };
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
            await writeJsonAtomic(
                this.manifestPath(corpusId),
                candidateManifest,
            );
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
        await this.batchStore.cancelSource(request.corpusId, request.sourceId);
        let result: SourceForgetResult | undefined;
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
            candidateManifest.sources = candidateManifest.sources.filter(
                (item) => item.sourceId !== request.sourceId,
            );
            if (candidateManifest.knowledgeSuppressions !== undefined) {
                candidateManifest.knowledgeSuppressions =
                    candidateManifest.knowledgeSuppressions.filter(
                        (item) => item.sourceId !== request.sourceId,
                    );
            }
            delete candidateManifest.pendingSourceForget;
            const forgottenReference = opaqueChangeReference(
                request.corpusId,
                "source",
                request.sourceId,
            );
            candidateManifest.changes = pruneChangeReceipts(
                candidateManifest.changes,
            ).filter((receipt) => receipt.sourceId !== forgottenReference);
            candidateManifest.changes.push(
                createChangeReceipt(
                    request.corpusId,
                    "forget",
                    request.sourceId,
                    {
                        sources: 1,
                        revisions: source.revisions.length,
                        knowledge: 0,
                    },
                ),
            );
            await this.personalHowToStore.forgetSource(
                request.corpusId,
                request.sourceId,
            );
            await this.rebuildAndActivate(
                request.corpusId,
                runtime,
                candidateManifest,
                new AbortController().signal,
            );
            await this.runbookJobs.purge(request.corpusId, request.sourceId);
            for (const revision of source.revisions) {
                if (!revision.assets?.length) continue;
                await this.assetStore.removeRevision({
                    corpusId: request.corpusId,
                    sourceId: request.sourceId,
                    revisionId: revision.revisionId,
                });
            }
            await this.personalHowToStore.markStale(
                request.corpusId,
                request.sourceId,
            );
            await this.rejectObsoleteRunbookCandidates(
                request.corpusId,
                request.sourceId,
            );
            result = {
                corpusId: request.corpusId,
                sourceId: request.sourceId,
                deletedRevisionCount: source.revisions.length,
                indexVersion: this.indexVersion(runtime.manifest),
            };
        });
        await this.batchStore.purge(request.corpusId, request.sourceId);
        return result!;
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
        return job === undefined ? undefined : structuredClone(job);
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
        return pageItems(jobs, request.pageSize, request.continuationToken);
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
            await mkdir(path.dirname(this.eventsPath(request.corpusId)), {
                recursive: true,
            });
            await appendFile(
                this.eventsPath(request.corpusId),
                `${JSON.stringify(event)}\n`,
                "utf8",
            );
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
        const runtime = await this.getCorpusRuntime(corpusId);
        const event = runtime.events.find((item) => item.eventId === eventId);
        return event === undefined ? undefined : structuredClone(event);
    }

    public async listEvents(
        request: MemoryEventListRequest,
    ): Promise<MemoryPage<MemoryEvent>> {
        await this.initialize();
        this.validateEventFilterRequest(request);
        const runtime = await this.getCorpusRuntime(request.corpusId);
        const events = [...runtime.events]
            .filter((event) => matchesEventFilter(event, request))
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
            const eligible = runtime.events.filter((event) =>
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
                    await this.personalHowToStore.forgetSource(
                        request.corpusId,
                        sourceId,
                    );
                    await this.runbookJobs.purge(request.corpusId, sourceId);
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
            const candidates = await runtime.index.search(query, limit * 4);
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
        return {
            ...structuredClone(this.capabilities),
            ...(this.viewDrafts
                ? {
                      derivedViews: {
                          kinds: [
                              "troubleshootingGuide",
                          ] as Array<"troubleshootingGuide">,
                          drafts: true as const,
                          history: true as const,
                          publication: false as const,
                      },
                  }
                : {}),
        };
    }

    private async requireViews(corpusId: string): Promise<CorpusRuntime> {
        if (!this.viewDrafts)
            throw new Error(
                "Memory view drafts are not supported; enable the developer/demo capability",
            );
        await this.initialize();
        validateIdentifier("corpus ID", corpusId);
        return this.getCorpusRuntime(corpusId);
    }

    public async listViews(corpusId: string): Promise<ViewSnapshot> {
        const runtime = await this.requireViews(corpusId);
        return runtime.access.read(() =>
            this.personalHowToStore.listViews(corpusId),
        );
    }

    public async getView(
        request: ViewReadRequest,
    ): Promise<ViewVersion | undefined> {
        const runtime = await this.requireViews(request.corpusId);
        return runtime.access.read(() =>
            this.personalHowToStore.getView(request),
        );
    }

    public async saveViewDraft(
        request: ViewSaveRequest,
    ): Promise<ViewHistoryEntry> {
        validateViewDraft(request);
        await this.requireViews(request.corpusId);
        return this.enqueueWrite(request.corpusId, async () => {
            const runtime = await this.getCorpusRuntime(request.corpusId);
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
            return this.personalHowToStore.saveViewDraft(request);
        });
    }

    public async archiveView(
        request: ViewArchiveRequest,
    ): Promise<ViewHistoryEntry> {
        validateViewArchive(request);
        await this.requireViews(request.corpusId);
        validateIdentifier("view ID", request.viewId);
        return this.enqueueWrite(request.corpusId, () =>
            this.personalHowToStore.archiveView(request),
        );
    }

    public async getViewHistory(
        request: ViewReadRequest,
    ): Promise<ViewHistoryEntry[]> {
        const runtime = await this.requireViews(request.corpusId);
        return runtime.access.read(() =>
            this.personalHowToStore.getViewHistory(request),
        );
    }

    public async publishView(request: ViewReadRequest): Promise<never> {
        await this.requireViews(request.corpusId);
        throw new Error(
            "Memory view publication is not supported; this pilot is draft-only",
        );
    }

    public async answer(
        request: MemoryAnswerRequest,
    ): Promise<MemoryAnswerResult> {
        const question = request.question.trim();
        if (question.length === 0) {
            throw new Error("Memory question cannot be empty");
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
            await writeJsonAtomic(
                this.manifestPath(request.corpusId),
                candidateManifest,
            );
            runtime.manifest = candidateManifest;
        });
        return this.listSourceKnowledgeSuppressions(
            request.corpusId,
            request.sourceId,
        );
    }

    public async getPersonalHowToSettings(
        corpusId: string,
    ): Promise<PersonalHowToSettings> {
        await this.initialize();
        validateIdentifier("corpus ID", corpusId);
        await this.getCorpusRuntime(corpusId);
        return this.personalHowToStore.getSettings(corpusId);
    }

    public async updatePersonalHowToSettings(
        corpusId: string,
        update: PersonalHowToSettingsUpdate,
    ): Promise<PersonalHowToSettings> {
        await this.initialize();
        validateIdentifier("corpus ID", corpusId);
        return this.enqueueWrite(corpusId, () =>
            this.personalHowToStore.updateSettings(corpusId, update),
        );
    }

    public async createProcedureCandidate(
        request: ProcedureCandidateCreateRequest,
    ): Promise<ProcedureCandidate> {
        await this.initialize();
        validateIdentifier("corpus ID", request.corpusId);
        return this.enqueueWrite(request.corpusId, () =>
            this.personalHowToStore.createCandidate(request),
        );
    }

    public async getProcedureCandidate(
        corpusId: string,
        candidateId: string,
    ): Promise<ProcedureCandidate | undefined> {
        await this.initialize();
        validateIdentifier("corpus ID", corpusId);
        validateIdentifier("candidate ID", candidateId);
        await this.getCorpusRuntime(corpusId);
        return this.personalHowToStore.getCandidate(corpusId, candidateId);
    }

    public async listProcedureCandidates(
        corpusId: string,
        states?: ProcedureCandidate["state"][],
    ): Promise<ProcedureCandidate[]> {
        await this.initialize();
        validateIdentifier("corpus ID", corpusId);
        await this.getCorpusRuntime(corpusId);
        return this.personalHowToStore.listCandidates(corpusId, states);
    }

    public async rejectProcedureCandidate(
        corpusId: string,
        candidateId: string,
    ): Promise<ProcedureCandidate> {
        await this.initialize();
        validateIdentifier("corpus ID", corpusId);
        validateIdentifier("candidate ID", candidateId);
        return this.enqueueWrite(corpusId, () =>
            this.personalHowToStore.rejectCandidate(corpusId, candidateId),
        );
    }

    public async saveProcedure(
        request: ProcedureSaveRequest,
    ): Promise<ProcedureVersion> {
        await this.initialize();
        validateIdentifier("corpus ID", request.corpusId);
        return this.enqueueWrite(request.corpusId, async () => {
            if (request.reviewAgentEdition)
                await this.validateRunbookReviewEvidence(request);
            return this.personalHowToStore.save(request);
        });
    }

    private async validateRunbookReviewEvidence(
        request: ProcedureSaveRequest,
    ): Promise<void> {
        let document: ProcedureDocument | undefined = request.document;
        if (document === undefined && request.markdown !== undefined)
            document = procedureFromMarkdown(request.markdown);
        if (document === undefined && request.candidateId !== undefined)
            document = await this.personalHowToStore.getCandidate(
                request.corpusId,
                request.candidateId,
            );
        if (document?.agentEdition === undefined)
            throw new Error("No agent edition evidence to review");
        const runtime = await this.getCorpusRuntime(request.corpusId);
        const references = getProcedureEvidenceReferences(document);
        for (const citation of references.citations) {
            const revision = this.currentRunbookEvidence(runtime, citation);
            if (
                citation.excerpt !== undefined &&
                !this.matchesRunbookExcerpt(citation, revision.content)
            )
                throw new Error(
                    "Runbook citation does not match retained passage offsets",
                );
        }
        for (const asset of references.assets) {
            const revision = this.currentRunbookEvidence(runtime, asset);
            const descriptor = revision.assets?.find(
                (item) => item.assetId === asset.assetId,
            );
            if (!descriptor)
                throw new Error(
                    "Runbook asset is not retained under the cited revision",
                );
            await this.assetStore.read(
                {
                    corpusId: request.corpusId,
                    sourceId: asset.sourceId,
                    revisionId: asset.revisionId,
                    assetId: asset.assetId,
                    hash: descriptor.hash,
                    variant: "original",
                },
                descriptor,
            );
        }
        for (const step of document.agentEdition.steps) {
            if (
                !step.citations.some(
                    (citation) =>
                        citation.excerpt !== undefined &&
                        this.matchesRunbookExcerpt(
                            citation,
                            this.currentRunbookEvidence(runtime, citation)
                                .content,
                        ) &&
                        redactRunbookText(citation.excerpt).includes(
                            redactRunbookText(step.humanText),
                        ),
                )
            )
                throw new Error(
                    "Each reviewed derived step requires a retained supporting passage and faithful human text",
                );
        }
    }

    private currentRunbookEvidence(
        runtime: CorpusRuntime,
        reference: { sourceId: string; revisionId: string },
    ): StoredRevision {
        const source = runtime.manifest.sources.find(
            (item) => item.sourceId === reference.sourceId,
        );
        const revision = source?.revisions.find(
            (item) => item.revisionId === reference.revisionId,
        );
        if (!revision || source?.activeRevisionId !== reference.revisionId)
            throw new Error(
                "Runbook evidence is missing or source revision is stale",
            );
        return revision;
    }

    private matchesRunbookExcerpt(
        citation: ProcedureSourceCitation,
        content: string,
    ): boolean {
        const offsets = /^chars:(\d+)-(\d+)$/.exec(citation.locator ?? "");
        if (!offsets || citation.excerpt === undefined) return false;
        const start = Number(offsets[1]);
        const end = Number(offsets[2]);
        return (
            start >= 0 &&
            end > start &&
            end <= content.length &&
            redactRunbookText(content.slice(start, end)) ===
                redactRunbookText(citation.excerpt)
        );
    }

    public async listProcedures(
        request: ProcedureListRequest,
    ): Promise<ProcedureSummary[]> {
        await this.initialize();
        validateIdentifier("corpus ID", request.corpusId);
        await this.getCorpusRuntime(request.corpusId);
        return this.personalHowToStore.list(request);
    }

    public async getProcedure(
        corpusId: string,
        procedureId: string,
        version?: number,
    ): Promise<ProcedureVersion | undefined> {
        await this.initialize();
        validateIdentifier("corpus ID", corpusId);
        validateIdentifier("procedure ID", procedureId);
        await this.getCorpusRuntime(corpusId);
        return this.personalHowToStore.get(corpusId, procedureId, version);
    }

    public async searchProcedures(
        request: ProcedureSearchRequest,
    ): Promise<ProcedureSearchMatch[]> {
        return runWithSearchTiming(request.traceId, "service.procedures", () =>
            timeSearchStage("service.total", () =>
                this.searchProcedureIndex(request),
            ),
        );
    }

    private async searchProcedureIndex(
        request: ProcedureSearchRequest,
    ): Promise<ProcedureSearchMatch[]> {
        await this.initialize();
        validateIdentifier("corpus ID", request.corpusId);
        if (request.query.trim().length === 0) {
            throw new Error("Procedure search query cannot be empty");
        }
        return this.enqueueRead(
            request.corpusId,
            async (runtime) =>
                (await this.personalHowToStore.list(request)).length === 0 ||
                (await this.procedureIndexReady(request.corpusId, runtime)),
            (runtime) => this.ensureProcedureIndex(request.corpusId, runtime),
            async (runtime) => {
                const summaries = await this.personalHowToStore.list(request);
                if (summaries.length === 0) {
                    return [];
                }
                const index = runtime.procedureIndex?.index;
                if (index === undefined)
                    throw new Error("Procedure index was not prepared");
                const limit = Math.max(1, Math.min(request.limit ?? 20, 100));
                const tags = request.states?.map(
                    (state) => `procedure-state:${state}`,
                );
                const matches = await index.search(
                    request.query.trim(),
                    limit,
                    tags,
                );
                const byId = new Map(
                    summaries.map((summary) => [summary.procedureId, summary]),
                );
                return Promise.all(
                    matches.map(async (match) => {
                        const procedure = byId.get(match.sourceId);
                        if (
                            procedure === undefined ||
                            match.revisionId !== String(procedure.latestVersion)
                        ) {
                            throw new Error(
                                `Procedure index contains an unexpected version of '${match.sourceId}'`,
                            );
                        }
                        return {
                            procedure,
                            version:
                                await this.personalHowToStore.readIndexedVersion(
                                    request.corpusId,
                                    procedure.procedureId,
                                    procedure.latestVersion,
                                ),
                            score: match.score,
                        };
                    }),
                );
            },
        );
    }

    public async archiveProcedure(
        corpusId: string,
        procedureId: string,
        expectedVersion?: number,
    ): Promise<ProcedureVersion> {
        await this.initialize();
        validateIdentifier("corpus ID", corpusId);
        validateIdentifier("procedure ID", procedureId);
        return this.enqueueWrite(corpusId, () =>
            this.personalHowToStore.archive(
                corpusId,
                procedureId,
                expectedVersion,
            ),
        );
    }

    private async reindex(
        corpusId: string,
        sourceId: string | undefined,
        signal: AbortSignal,
    ): Promise<ReindexResult> {
        await this.initialize();
        validateIdentifier("corpus ID", corpusId);
        let result: ReindexResult | undefined;
        await this.enqueueWrite(corpusId, async () => {
            const runtime = await this.getCorpusRuntime(corpusId);
            if (
                sourceId !== undefined &&
                !runtime.manifest.sources.some(
                    (source) => source.sourceId === sourceId,
                )
            ) {
                throw new Error(`Unknown source '${sourceId}'`);
            }
            const candidateManifest = structuredClone(runtime.manifest);
            delete candidateManifest.pendingSourceForget;
            await this.rebuildAndActivate(
                corpusId,
                runtime,
                candidateManifest,
                signal,
            );
            result = {
                corpusId,
                ...(sourceId === undefined ? {} : { sourceId }),
                sourceCount: runtime.manifest.sources.length,
                indexVersion: this.indexVersion(runtime.manifest),
            };
        });
        return result!;
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
            await raceWithAbort(
                candidateIndex.rebuild(
                    this.activeDocuments(candidateManifest),
                    signal,
                    async () => {},
                ),
                signal,
            );
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
            await writeJsonAtomic(
                this.manifestPath(corpusId),
                candidateManifest,
            );
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
    ): Promise<void> {
        validateIndexGeneration(activeGeneration);
        const root = this.indexDirectory(corpusId);
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
                        entry.isDirectory() && entry.name !== activeGeneration,
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
            const manifestPath = this.manifestPath(entry.name);
            const manifest = await readJson<CorpusManifest>(manifestPath);
            if (manifest?.changes === undefined) {
                continue;
            }
            const changes = pruneChangeReceipts(manifest.changes);
            if (changes.length !== manifest.changes.length) {
                await writeJsonAtomic(manifestPath, { ...manifest, changes });
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

    private async processIngestion(
        request: DocumentIngestRequest,
        content: string,
        contentHash: string,
        sourceId: string,
        revisionId: string,
        job: IngestionJobStatus,
        signal: AbortSignal,
    ): Promise<void> {
        let candidateIndexDirectory: string | undefined;
        let committed = false;
        try {
            await this.updateJob(job, "validating", {
                completed: 0,
                total: 1,
                message: "Validating source",
            });
            this.throwIfAborted(signal);
            const runtime = await this.getCorpusRuntime(request.corpusId);
            const existing = runtime.manifest.sources.find(
                (source) => source.sourceId === sourceId,
            );
            const policy = request.pipeline?.updatePolicy ?? "skipIfUnchanged";
            const expectedRevision = request.pipeline?.expectedActiveRevisionId;
            if (
                expectedRevision !== undefined &&
                existing?.activeRevisionId !== expectedRevision
            ) {
                throw new Error(`Source '${sourceId}' active revision changed`);
            }
            if (existing?.activeRevisionId === revisionId) {
                if (policy === "failIfExists") {
                    throw new Error(`Source '${sourceId}' already exists`);
                }
                job.warnings.push(
                    ...(await this.updatePersonalHowToAfterIngestion(
                        request,
                        sourceId,
                        revisionId,
                        content,
                    )),
                );
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
            const timestamp = now();
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
            candidateManifest.corpus.updatedAt = timestamp;
            candidateManifest.corpus.documentCount =
                candidateManifest.sources.length;
            const indexGeneration = randomUUID();
            candidateManifest.indexGeneration = indexGeneration;
            candidateIndexDirectory = this.indexDirectory(
                request.corpusId,
                indexGeneration,
            );
            await mkdir(candidateIndexDirectory, { recursive: true });
            const candidateIndex = this.indexFactory(
                request.corpusId,
                candidateIndexDirectory,
            );
            await this.updateJob(job, "building-indexes", {
                completed: 0,
                message: "Building corpus indexes",
            });
            const documents = this.activeDocuments(candidateManifest);
            const canAppend =
                existing === undefined &&
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
            if (!canAppend && runtime.manifest.indexGeneration !== undefined) {
                await classifyIndexSchema(
                    this.indexDirectory(
                        request.corpusId,
                        runtime.manifest.indexGeneration,
                    ),
                    "documents",
                    false,
                );
            }
            const reportProgress = async (progress: JobProgress) => {
                if (!signal.aborted) {
                    await this.updateJob(
                        job,
                        progress.stage ?? "building-indexes",
                        progress,
                    );
                }
            };
            if (canAppend) {
                await cp(
                    this.indexDirectory(
                        request.corpusId,
                        runtime.manifest.indexGeneration,
                    ),
                    candidateIndexDirectory,
                    { recursive: true },
                );
                this.throwIfAborted(signal);
                await raceWithAbort(
                    candidateIndex.append!(
                        [
                            {
                                source,
                                revision,
                                content,
                                pipeline: contentPipeline(revision.pipeline),
                            },
                        ],
                        signal,
                        reportProgress,
                    ),
                    signal,
                );
            } else {
                await raceWithAbort(
                    candidateIndex.rebuild(documents, signal, reportProgress),
                    signal,
                );
            }
            this.throwIfAborted(signal);
            await stampIndexSchema(
                candidateIndexDirectory,
                "documents",
                candidateManifest.sources.length > 0,
            );
            revision.state = "ready";
            revision.indexedAt = now();
            candidateManifest.corpus.status = "ready";
            candidateManifest.changes = pruneChangeReceipts(
                candidateManifest.changes,
            );
            if (existing !== undefined) {
                candidateManifest.changes.push(
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
            await writeJsonAtomic(
                this.manifestPath(request.corpusId),
                candidateManifest,
            );
            runtime.manifest = candidateManifest;
            runtime.index = candidateIndex;
            await this.rememberDocumentIndex(request.corpusId, runtime);
            candidateIndexDirectory = undefined;
            committed = true;
            job.warnings.push(
                ...(await this.updatePersonalHowToAfterIngestion(
                    request,
                    sourceId,
                    revisionId,
                    content,
                )),
            );
            await this.cleanupReplacedAssets(
                request.corpusId,
                source,
                existing,
            );
            await this.removeInactiveIndexGenerations(
                request.corpusId,
                indexGeneration,
            );
            await this.updateJob(job, "complete", {
                completed: 1,
                total: 1,
                message: "Ingestion complete",
            });
        } catch (error) {
            await this.handleIngestionFailure(
                job,
                signal,
                error,
                committed,
                candidateIndexDirectory,
                Boolean(request.source.assets?.length),
            );
        } finally {
            this.controllers.delete(job.jobId);
        }
    }

    private async cleanupReplacedAssets(
        corpusId: string,
        source: StoredSource,
        existing?: StoredSource,
    ): Promise<void> {
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
        await this.runbookJobs.purge(corpusId, source.sourceId, retained);
    }

    private async handleIngestionFailure(
        job: IngestionJobStatus,
        signal: AbortSignal,
        error: unknown,
        committed: boolean,
        candidateIndexDirectory: string | undefined,
        hasAssets: boolean,
    ): Promise<void> {
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
        const runtime = await this.getCorpusRuntime(job.corpusId);
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

    private async rejectObsoleteRunbookCandidates(
        corpusId: string,
        sourceId: string,
        activeRevisionId?: string,
    ): Promise<void> {
        const candidates = await this.personalHowToStore.listCandidates(
            corpusId,
            ["detected", "draft"],
        );
        for (const candidate of candidates) {
            if (candidate.agentEdition === undefined) continue;
            const references = getProcedureEvidenceReferences(candidate);
            const obsolete = [
                ...references.citations,
                ...references.assets,
            ].some(
                (reference) =>
                    reference.sourceId === sourceId &&
                    reference.revisionId !== activeRevisionId,
            );
            if (obsolete)
                await this.personalHowToStore.rejectCandidate(
                    corpusId,
                    candidate.candidateId,
                );
        }
    }

    private async updatePersonalHowToAfterIngestion(
        request: DocumentIngestRequest,
        sourceId: string,
        revisionId: string,
        content: string,
    ): Promise<string[]> {
        const warnings: string[] = [];
        try {
            await this.personalHowToStore.markStale(
                request.corpusId,
                sourceId,
                revisionId,
            );
            await this.rejectObsoleteRunbookCandidates(
                request.corpusId,
                sourceId,
                revisionId,
            );
        } catch (error) {
            warnings.push(
                `Personal how-to stale update failed: ${
                    error instanceof Error ? error.message : String(error)
                }`,
            );
        }
        try {
            const settings = await this.personalHowToStore.getSettings(
                request.corpusId,
            );
            if (!settings.enabled || !settings.detectCandidates) {
                return warnings;
            }
            const preferences = runbookPreferences(settings);
            const detected =
                request.source.html !== undefined
                    ? []
                    : detectProcedureCandidates(
                          request.corpusId,
                          sourceId,
                          revisionId,
                          content,
                      );
            const candidates =
                preferences === undefined
                    ? detected
                    : detected.map(
                          (candidate) =>
                              redactRunbookValue(
                                  candidate,
                              ) as ProcedureCandidateCreateRequest,
                      );
            await this.personalHowToStore.createDetectedCandidates(candidates);
            if (preferences !== undefined) {
                await this.runbookJobs.start(
                    await this.buildRunbookSynthesisInput(
                        { corpusId: request.corpusId, sourceId, revisionId },
                        candidates,
                    ),
                );
            }
        } catch (error) {
            warnings.push(
                `Procedure candidate extraction failed: ${
                    error instanceof Error ? error.message : String(error)
                }`,
            );
        }
        return warnings;
    }

    private async buildRunbookSynthesisInput(
        request: RunbookSynthesisRequest,
        seeds?: ProcedureCandidateCreateRequest[],
    ): Promise<RunbookSynthesisInput> {
        const runtime = await this.getCorpusRuntime(request.corpusId);
        const revision = this.currentRunbookEvidence(runtime, request);
        if (revision.state !== "ready")
            throw new Error(
                "Runbook synthesis requires a ready retained source revision",
            );
        const source = runtime.manifest.sources.find(
            (item) => item.sourceId === request.sourceId,
        );
        if (!source) throw new Error("Unknown retained source");
        const settings = await this.personalHowToStore.getSettings(
            request.corpusId,
        );
        const preferences = runbookPreferences(settings);
        if (preferences === undefined)
            throw new Error(
                "Runbook synthesis requires enabled how-to detection and buildAgentEdition preferences",
            );
        const assets = await this.getRevisionAssets(request);
        const images: RunbookSynthesisInput["images"] = [];
        if (preferences.describeImages && this.runbookMultimodal) {
            for (const asset of assets.filter((item) =>
                ["image/png", "image/jpeg", "image/webp"].includes(
                    item.mimeType,
                ),
            )) {
                images.push({
                    assetId: asset.assetId,
                    mimeType: asset.mimeType,
                    bytes: await this.assetStore.read(
                        {
                            ...request,
                            assetId: asset.assetId,
                            hash: asset.hash,
                            variant: "original",
                        },
                        asset,
                    ),
                });
            }
        }
        const detected =
            source.sourceType === "html"
                ? []
                : detectProcedureCandidates(
                      request.corpusId,
                      request.sourceId,
                      request.revisionId,
                      revision.content,
                  );
        return {
            ...request,
            title: source.title,
            content: revision.content,
            assets,
            images,
            preferences,
            seeds:
                seeds ??
                detected.map(
                    (candidate) =>
                        redactRunbookValue(
                            candidate,
                        ) as ProcedureCandidateCreateRequest,
                ),
            linkedDocuments: runtime.manifest.sources
                .filter((item) => item.sourceId !== request.sourceId)
                .slice(0, 100)
                .map((item) => ({
                    sourceId: item.sourceId,
                    revisionId: item.activeRevisionId,
                    title: item.title,
                    ...(item.canonicalUri === undefined
                        ? {}
                        : { canonicalUri: item.canonicalUri }),
                })),
            ...(typeof settings.preferences?.extractionGuidance === "string"
                ? { guidance: settings.preferences.extractionGuidance }
                : {}),
        };
    }

    private async enqueueWrite<T>(
        corpusId: string,
        operation: () => Promise<T>,
    ): Promise<T> {
        const runtime = await this.getCorpusRuntime(corpusId);
        const queuedAt = currentSearchTraceId() ? performance.now() : undefined;
        const run = async () => {
            if (queuedAt !== undefined)
                recordSearchTiming("queue.wait", performance.now() - queuedAt, {
                    corpusId,
                    access: "write",
                });
            const changes = pruneChangeReceipts(runtime.manifest.changes);
            if (changes.length !== (runtime.manifest.changes ?? []).length) {
                const candidate = { ...runtime.manifest, changes };
                await writeJsonAtomic(this.manifestPath(corpusId), candidate);
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
    ): Promise<T> {
        const read = this.readPreparedIndex(
            corpusId,
            ready,
            prepare,
            operation,
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
    ): Promise<T> {
        const runtime = await this.getCorpusRuntime(corpusId);
        while (true) {
            const queuedAt = currentSearchTraceId()
                ? performance.now()
                : undefined;
            const result = await runtime.access.read(async () => {
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
            await this.enqueueWrite(corpusId, () => prepare(runtime));
        }
    }

    private enqueueDocumentRead<T>(
        corpusId: string,
        operation: (runtime: CorpusRuntime) => Promise<T>,
    ): Promise<T> {
        return this.enqueueRead(
            corpusId,
            (runtime) => this.documentIndexReady(corpusId, runtime),
            (runtime) => this.ensureDocumentIndex(corpusId, runtime),
            operation,
        );
    }

    private async getCorpusRuntime(corpusId: string): Promise<CorpusRuntime> {
        const cached = this.corpora.get(corpusId);
        if (cached !== undefined) {
            return cached;
        }
        let loading = this.corpusLoads.get(corpusId);
        if (loading === undefined) {
            loading = this.loadCorpusRuntime(corpusId);
            this.corpusLoads.set(corpusId, loading);
        }
        try {
            return await loading;
        } finally {
            if (this.corpusLoads.get(corpusId) === loading)
                this.corpusLoads.delete(corpusId);
        }
    }

    private async loadCorpusRuntime(corpusId: string): Promise<CorpusRuntime> {
        const manifest = await readJson<CorpusManifest>(
            this.manifestPath(corpusId),
        );
        if (manifest === undefined) {
            throw new Error(`Unknown corpus '${corpusId}'`);
        }
        const records = await readEventRecords(this.eventsPath(corpusId));
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
            access: new CorpusAccess(),
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
    ): Promise<void> {
        if (await this.documentIndexReady(corpusId, runtime)) return;
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
                return;
            }
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
            return;
        }
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
    }

    private async procedureIndexReady(
        corpusId: string,
        runtime: CorpusRuntime,
    ): Promise<boolean> {
        return timeSearchStage(
            "index.check",
            async () => {
                const prepared = runtime.procedureIndex;
                const generation =
                    await this.personalHowToStore.getIndexGeneration(corpusId);
                const hit =
                    prepared !== undefined &&
                    generation !== undefined &&
                    prepared.generation === generation &&
                    prepared.fingerprint ===
                        (await indexFingerprint(
                            this.procedureIndexDirectory(corpusId, generation),
                            "procedures",
                        ));
                recordSearchTiming("index.cache", 0, {
                    corpusId,
                    indexKind: "procedures",
                    hit,
                });
                return hit;
            },
            { corpusId, indexKind: "procedures" },
        );
    }

    private async ensureProcedureIndex(
        corpusId: string,
        runtime: CorpusRuntime,
    ): Promise<void> {
        if (await this.procedureIndexReady(corpusId, runtime)) return;
        let generation =
            await this.personalHowToStore.getIndexGeneration(corpusId);
        const currentDirectory =
            generation === undefined
                ? undefined
                : this.procedureIndexDirectory(corpusId, generation);
        if (
            currentDirectory === undefined ||
            (await timeSearchStage(
                "index.validate",
                () => classifyIndexSchema(currentDirectory, "procedures", true),
                { corpusId, indexKind: "procedures" },
            )) !== "current" ||
            !(await this.hasReadyMarker(currentDirectory))
        ) {
            await timeSearchStage(
                "index.rebuild",
                () => this.personalHowToStore.rebuildIndex(corpusId),
                { corpusId, indexKind: "procedures" },
            );
            generation =
                await this.personalHowToStore.getIndexGeneration(corpusId);
        }
        if (generation === undefined)
            throw new Error("Procedure index generation is missing");
        const directory = this.procedureIndexDirectory(corpusId, generation);
        const index = this.procedureIndexFactory(corpusId, directory);
        await timeSearchStage("index.load", () => index.initialize(), {
            corpusId,
            indexKind: "procedures",
        });
        runtime.procedureIndex = {
            generation,
            index,
            fingerprint: await indexFingerprint(directory, "procedures"),
        };
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

    private procedureIndexDirectory(
        corpusId: string,
        generation: string,
    ): string {
        validateIndexGeneration(generation);
        return path.join(
            this.rootDirectory,
            corpusId,
            "personal-how-to",
            "search-index",
            generation,
        );
    }

    private async hasReadyMarker(directory: string): Promise<boolean> {
        try {
            await access(path.join(directory, "ready"));
            return true;
        } catch (error) {
            if ((error as NodeJS.ErrnoException).code === "ENOENT") {
                return false;
            }
            throw error;
        }
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
            if (entry.isDirectory()) {
                await classifyIndexSchema(
                    path.join(root, entry.name),
                    indexKind,
                    false,
                );
            }
        }
        await rm(root, { recursive: true, force: true });
    }

    private async purgeObsoleteEventIndex(
        corpusId: string,
        runtime: CorpusRuntime,
    ): Promise<EventIndexState | undefined> {
        const watermark = eventIndexWatermark(runtime.events);
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
        const state = await this.purgeObsoleteEventIndex(corpusId, runtime);
        if (state !== undefined) {
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
        }
        await mkdir(root, { recursive: true });
        const generation = randomUUID();
        const directory = this.eventIndexDirectory(corpusId, generation);
        await mkdir(directory);
        try {
            const index = this.eventIndexFactory(corpusId, directory);
            await index.rebuild(
                runtime.events.map((event) => this.eventDocument(event)),
                new AbortController().signal,
                async () => {},
            );
            await stampIndexSchema(
                directory,
                "conversation-events",
                runtime.events.length > 0,
            );
            await writeFile(path.join(directory, "ready"), "");
            await writeJsonAtomic(path.join(root, "state.json"), {
                generation,
                watermark: eventIndexWatermark(runtime.events),
            } satisfies EventIndexState);
            const obsolete = (
                await readdir(root, { withFileTypes: true })
            ).filter(
                (entry) =>
                    entry.name !== generation && entry.name !== "state.json",
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

    private async publishProcedureIndex(
        corpusId: string,
        summaries: ProcedureSummary[],
    ): Promise<string> {
        const committed =
            await this.personalHowToStore.getIndexGeneration(corpusId);
        if (committed !== undefined) {
            validateIndexGeneration(committed);
        }
        const root = path.join(
            this.rootDirectory,
            corpusId,
            "personal-how-to",
            "search-index",
        );
        await mkdir(root, { recursive: true });
        const entries = await readdir(root);
        for (const entry of entries) {
            await classifyIndexSchema(
                path.join(root, entry),
                "procedures",
                false,
            );
        }
        for (const entry of entries) {
            await rm(path.join(root, entry), {
                recursive: true,
                force: true,
            });
        }
        const generation = randomUUID();
        const directory = this.procedureIndexDirectory(corpusId, generation);
        await mkdir(directory, { recursive: true });
        try {
            const documents: IndexedDocument[] = await Promise.all(
                summaries.map(async (summary) => {
                    const version =
                        await this.personalHowToStore.readIndexedVersion(
                            corpusId,
                            summary.procedureId,
                            summary.latestVersion,
                        );
                    const revisionId = String(version.version);
                    return {
                        source: {
                            sourceId: summary.procedureId,
                            corpusId,
                            sourceType: "markdown",
                            title: version.document.title,
                            activeRevisionId: revisionId,
                        },
                        revision: {
                            revisionId,
                            sourceId: summary.procedureId,
                            contentHash: version.markdownHash,
                            mimeType: "text/markdown",
                            pipelineVersion,
                            state: "ready",
                        },
                        content: version.markdown,
                        indexTags: [`procedure-state:${summary.state}`],
                        pipeline: { mode: "content" },
                    };
                }),
            );
            const index = this.procedureIndexFactory(corpusId, directory);
            await index.rebuild(
                documents,
                new AbortController().signal,
                async () => {},
            );
            await stampIndexSchema(
                directory,
                "procedures",
                documents.length > 0,
            );
            await writeFile(path.join(directory, "ready"), "");
            return generation;
        } catch (error) {
            await rm(directory, { recursive: true, force: true });
            throw error;
        }
    }

    private toMemorySource(source: StoredSource): MemorySource {
        const { revisions, ...document } = source;
        return {
            ...structuredClone(document),
            revisions: revisions.map((storedRevision) => {
                const {
                    content: _content,
                    locationMap: _locationMap,
                    ...revision
                } = storedRevision as typeof storedRevision & {
                    locationMap?: unknown;
                };
                return {
                    ...structuredClone(revision),
                    ...(revision.pipeline === undefined
                        ? {}
                        : { pipeline: contentPipeline(revision.pipeline) }),
                };
            }),
        };
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
        runtime: CorpusRuntime,
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
        await mkdir(path.dirname(this.eventsPath(corpusId)), {
            recursive: true,
        });
        const records: (MemoryEvent | EventSuppression)[] = [
            ...events,
            ...suppressions,
        ];
        const value =
            records.length === 0
                ? ""
                : `${records.map((record) => JSON.stringify(record)).join("\n")}\n`;
        const filePath = this.eventsPath(corpusId);
        const temporaryPath = `${filePath}.${randomUUID()}.tmp`;
        const backupPath = `${filePath}.${randomUUID()}.bak`;
        await writeFile(temporaryPath, value, "utf8");
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

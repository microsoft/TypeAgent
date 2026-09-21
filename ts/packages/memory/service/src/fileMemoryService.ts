// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { createHash, randomUUID } from "node:crypto";
import {
    cp,
    mkdir,
    readFile,
    readdir,
    rename,
    rm,
    writeFile,
} from "node:fs/promises";
import path from "node:path";
import lockfile from "proper-lockfile";
import { createKnowProCorpusIndex } from "./knowProCorpusIndex.js";
import type {
    CorpusIndex,
    CorpusIndexFactory,
    DocumentIngestRequest,
    DocumentIngestResult,
    IndexedDocument,
    IngestionJobStatus,
    JobListRequest,
    JobProgress,
    JobState,
    MemoryCorpus,
    MemoryCorpusStatus,
    MemoryEvidence,
    MemoryKnowledgeGraph,
    MemorySearchRequest,
    MemorySearchResult,
    MemoryService,
    MemoryServiceCapabilities,
    MemorySource,
    MemoryPage,
    ReindexResult,
    SourceContent,
    SourceContentRequest,
    SourceDocument,
    SourceForgetPreview,
    SourceForgetRequest,
    SourceForgetResult,
    SourceListRequest,
    SourceReplaceRequest,
    SourceRevision,
} from "./types.js";

const manifestFileName = "manifest.json";
const jobsDirectoryName = "jobs";
const indexDirectoryName = "index";
const pipelineVersion = "1";

interface StoredRevision extends SourceRevision {
    content: string;
}

interface StoredSource extends SourceDocument {
    revisions: StoredRevision[];
}

interface CorpusManifest {
    corpus: MemoryCorpus;
    sources: StoredSource[];
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
    writeTail: Promise<void>;
}

export interface FileMemoryServiceOptions {
    indexFactory?: CorpusIndexFactory;
    capabilities?: MemoryServiceCapabilities;
}

function now(): string {
    return new Date().toISOString();
}

function raceWithAbort<T>(
    operation: Promise<T>,
    signal: AbortSignal,
): Promise<T> {
    if (signal.aborted) {
        return Promise.reject(
            signal.reason ?? new Error("Operation cancelled"),
        );
    }
    return new Promise<T>((resolve, reject) => {
        const abort = () =>
            reject(signal.reason ?? new Error("Operation cancelled"));
        signal.addEventListener("abort", abort, { once: true });
        operation
            .then(resolve, reject)
            .finally(() => signal.removeEventListener("abort", abort));
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

function validateIdentifier(kind: string, value: string): void {
    if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/.test(value)) {
        throw new Error(`Invalid ${kind} '${value}'`);
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
            groundedAnswer: false,
        },
        warnings: [],
    };
}

export class FileMemoryService implements MemoryService {
    private readonly indexFactory: CorpusIndexFactory;
    private readonly capabilities: MemoryServiceCapabilities;
    private readonly corpora = new Map<string, CorpusRuntime>();
    private readonly jobs = new Map<string, IngestionJobStatus>();
    private readonly controllers = new Map<string, AbortController>();
    private initializePromise: Promise<void> | undefined;
    private releaseLock: (() => Promise<void>) | undefined;
    private rootWriteTail: Promise<void> = Promise.resolve();
    private closed = false;

    public constructor(
        private readonly rootDirectory: string,
        options: FileMemoryServiceOptions = {},
    ) {
        this.indexFactory = options.indexFactory ?? createKnowProCorpusIndex;
        this.capabilities = options.capabilities ?? defaultCapabilities();
    }

    public initialize(): Promise<void> {
        if (this.closed) {
            return Promise.reject(new Error("Memory service is closed"));
        }
        this.initializePromise ??= this.acquireStorageLock().then(() =>
            this.recoverInterruptedJobs(),
        );
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
        await Promise.allSettled([
            this.rootWriteTail,
            ...[...this.corpora.values()].map((runtime) => runtime.writeTail),
        ]);
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
                writeTail: Promise.resolve(),
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
        let clearedCount = 0;
        await this.enqueueWrite(corpusId, async () => {
            const runtime = await this.getCorpusRuntime(corpusId);
            clearedCount = runtime.manifest.sources.length;
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
            runtime.manifest = candidateManifest;
            runtime.index = candidateIndex;
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

    public async listSourcesPage(
        request: SourceListRequest,
    ): Promise<MemoryPage<MemorySource>> {
        const sources = (await this.listSources(request.corpusId)).sort(
            (left, right) => left.sourceId.localeCompare(right.sourceId),
        );
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
    ): Promise<MemoryKnowledgeGraph> {
        await this.initialize();
        const source = await this.getSource(corpusId, sourceId);
        if (source === undefined) {
            throw new Error(`Unknown source '${sourceId}'`);
        }
        const runtime = await this.getCorpusRuntime(corpusId);
        await runtime.index.initialize();
        return runtime.index.getKnowledgeGraph(new Set([sourceId]));
    }

    public async ingestDocument(
        request: DocumentIngestRequest,
        signal?: AbortSignal,
    ): Promise<DocumentIngestResult> {
        await this.initialize();
        validateIdentifier("corpus ID", request.corpusId);
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
        const revisionId = contentHash;
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
        return this.ingestDocument(
            {
                corpusId: request.corpusId,
                source: { ...request.source, sourceId: request.sourceId },
                pipeline: {
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
            await runtime.index.initialize();
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
            delete candidateManifest.pendingSourceForget;
            await this.rebuildAndActivate(
                request.corpusId,
                runtime,
                candidateManifest,
                new AbortController().signal,
            );
            result = {
                corpusId: request.corpusId,
                sourceId: request.sourceId,
                deletedRevisionCount: source.revisions.length,
                indexVersion: this.indexVersion(runtime.manifest),
            };
        });
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
        if (["complete", "failed", "cancelled"].includes(job.state)) {
            return job;
        }
        await this.updateJob(job, "cancelling", {
            ...job.progress,
            message: "Cancellation requested",
        });
        this.controllers.get(jobId)?.abort(new Error("Ingestion cancelled"));
        return structuredClone(job);
    }

    public async search(
        request: MemorySearchRequest,
    ): Promise<MemorySearchResult> {
        await this.initialize();
        validateIdentifier("corpus ID", request.corpusId);
        const query = request.query.trim();
        if (query.length === 0) {
            throw new Error("Search query cannot be empty");
        }
        const runtime = await this.getCorpusRuntime(request.corpusId);
        await runtime.index.initialize();
        const limit = Math.max(1, Math.min(request.limit ?? 10, 100));
        const candidates = await runtime.index.search(query, limit * 4);
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
                corpusId: request.corpusId,
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
        return {
            query,
            matches,
            warnings: [...this.capabilities.warnings],
            capabilitiesUsed: ["structured-search"],
            indexVersion: this.indexVersion(runtime.manifest),
        };
    }

    public async getCapabilities(): Promise<MemoryServiceCapabilities> {
        await this.initialize();
        return structuredClone(this.capabilities);
    }

    public async getKnowledgeGraph(
        corpusId: string,
    ): Promise<MemoryKnowledgeGraph> {
        await this.initialize();
        validateIdentifier("corpus ID", corpusId);
        const runtime = await this.getCorpusRuntime(corpusId);
        await runtime.index.initialize();
        return runtime.index.getKnowledgeGraph();
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
                .map((entry) =>
                    rm(path.join(root, entry.name), {
                        recursive: true,
                        force: true,
                    }),
                ),
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
            const revision: StoredRevision = {
                revisionId,
                sourceId,
                contentHash,
                mimeType: this.mimeType(request.source.sourceType),
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
                        : {
                              maxCharsPerChunk:
                                  request.pipeline.maxCharsPerChunk,
                          }),
                },
                state: "processing",
                content,
            };
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
                candidateIndex.append !== undefined;
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
                await raceWithAbort(
                    candidateIndex.append!(
                        [{ source, revision, content }],
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
            revision.state = "ready";
            revision.indexedAt = now();
            candidateManifest.corpus.status = "ready";
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
            candidateIndexDirectory = undefined;
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
                    message: cancelled
                        ? "Ingestion cancelled"
                        : "Ingestion failed",
                },
                error instanceof Error ? error.message : String(error),
            );
        } finally {
            this.controllers.delete(job.jobId);
        }
    }

    private async enqueueWrite(
        corpusId: string,
        operation: () => Promise<void>,
    ): Promise<void> {
        const runtime = await this.getCorpusRuntime(corpusId);
        const queued = runtime.writeTail.then(operation, operation);
        runtime.writeTail = queued.then(
            () => undefined,
            () => undefined,
        );
        return queued;
    }

    private async getCorpusRuntime(corpusId: string): Promise<CorpusRuntime> {
        const cached = this.corpora.get(corpusId);
        if (cached !== undefined) {
            return cached;
        }
        const manifest = await readJson<CorpusManifest>(
            this.manifestPath(corpusId),
        );
        if (manifest === undefined) {
            throw new Error(`Unknown corpus '${corpusId}'`);
        }
        const runtime: CorpusRuntime = {
            manifest,
            index: this.createIndex(corpusId, manifest.indexGeneration),
            writeTail: Promise.resolve(),
        };
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

    private indexDirectory(corpusId: string, indexGeneration?: string): string {
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
                pipeline: revision.pipeline ?? { mode: "content" },
            };
        });
    }

    private toMemorySource(source: StoredSource): MemorySource {
        const { revisions, ...document } = source;
        return {
            ...structuredClone(document),
            revisions: revisions.map(({ content: _content, ...revision }) =>
                structuredClone(revision),
            ),
        };
    }

    private async saveJob(job: IngestionJobStatus): Promise<void> {
        this.jobs.set(job.jobId, job);
        await writeJsonAtomic(this.jobPath(job.jobId), job);
    }

    private async updateJob(
        job: IngestionJobStatus,
        state: JobState,
        progress: JobProgress,
        error?: string,
    ): Promise<void> {
        const timestamp = now();
        job.state = state;
        job.progress = progress;
        job.updatedAt = timestamp;
        job.trace ??= [];
        job.trace.push({ state, timestamp, ...progress });
        if (error !== undefined) {
            job.error = error;
        }
        await this.saveJob(job);
    }

    private manifestPath(corpusId: string): string {
        return path.join(this.rootDirectory, corpusId, manifestFileName);
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

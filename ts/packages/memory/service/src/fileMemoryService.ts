// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { createHash, randomUUID } from "node:crypto";
import { cp, mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
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
    JobProgress,
    JobState,
    MemoryCorpus,
    MemoryEvidence,
    MemoryKnowledgeGraph,
    MemorySearchRequest,
    MemorySearchResult,
    MemoryService,
    MemoryServiceCapabilities,
    MemorySource,
    SourceDocument,
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
        this.initializePromise ??= this.acquireStorageLock();
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

    public async clearCorpus(corpusId: string): Promise<number> {
        await this.initialize();
        validateIdentifier("corpus ID", corpusId);
        let clearedCount = 0;
        await this.enqueueWrite(corpusId, async () => {
            const runtime = await this.getCorpus(corpusId);
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
        });
        return clearedCount;
    }

    public async listSources(corpusId: string): Promise<MemorySource[]> {
        await this.initialize();
        validateIdentifier("corpus ID", corpusId);
        const runtime = await this.getCorpus(corpusId);
        return runtime.manifest.sources.map((source) =>
            this.toMemorySource(source),
        );
    }

    public async getSource(
        corpusId: string,
        sourceId: string,
    ): Promise<MemorySource | undefined> {
        await this.initialize();
        validateIdentifier("corpus ID", corpusId);
        validateIdentifier("source ID", sourceId);
        const runtime = await this.getCorpus(corpusId);
        const source = runtime.manifest.sources.find(
            (item) => item.sourceId === sourceId,
        );
        return source === undefined ? undefined : this.toMemorySource(source);
    }

    public async ingestDocument(
        request: DocumentIngestRequest,
        signal?: AbortSignal,
    ): Promise<DocumentIngestResult> {
        await this.initialize();
        validateIdentifier("corpus ID", request.corpusId);
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
        const runtime = await this.getCorpus(request.corpusId);
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
            indexVersion: hashContent(
                runtime.manifest.sources
                    .map((source) => source.activeRevisionId)
                    .sort()
                    .join("\n"),
            ),
        };
    }

    public async getCapabilities(): Promise<MemoryServiceCapabilities> {
        await this.initialize();
        return structuredClone(this.capabilities);
    }

    public async getKnowledgeGraph(
        corpusId: string,
    ): Promise<MemoryKnowledgeGraph> {
        const runtime = await this.getCorpus(corpusId);
        await runtime.index.initialize();
        return runtime.index.getKnowledgeGraph();
    }

    private async acquireStorageLock(): Promise<void> {
        await mkdir(this.rootDirectory, { recursive: true });
        this.releaseLock = await lockfile.lock(this.rootDirectory, {
            realpath: false,
            retries: 0,
            stale: 10_000,
        });
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
            const runtime = await this.getCorpus(request.corpusId);
            const existing = runtime.manifest.sources.find(
                (source) => source.sourceId === sourceId,
            );
            const policy = request.pipeline?.updatePolicy ?? "skipIfUnchanged";
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
                          ? [...existing.revisions, revision]
                          : [revision],
            };
            const candidateManifest = structuredClone(runtime.manifest);
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
        const runtime = await this.getCorpus(corpusId);
        const queued = runtime.writeTail.then(operation, operation);
        runtime.writeTail = queued.then(
            () => undefined,
            () => undefined,
        );
        return queued;
    }

    private async getCorpus(corpusId: string): Promise<CorpusRuntime> {
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
            return { source, revision, content: revision.content };
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

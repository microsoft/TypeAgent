// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { createHash } from "node:crypto";
import type {
    IngestionMode,
    JobProgress,
    MemoryEvidence,
    MemoryKnowledgeGraph,
    MemoryService,
    MemorySource,
} from "@typeagent/memory-service";
import { waitForMemoryJob } from "@typeagent/memory-service/rpc";

const browserCorpusName = "TypeAgent Browser Memory";
const adapters = new WeakMap<MemoryService, BrowserMemoryService>();

export interface BrowserMemoryDocument {
    url: string;
    title: string;
    markdown: string;
    source?: string;
    domain?: string;
    pageType?: string;
    capturedAt?: string;
    tags?: string[];
}

export interface BrowserMemorySearchOptions {
    query: string;
    limit?: number;
    sourceIds?: string[];
    url?: string;
    domain?: string;
    pageType?: string;
    source?: string;
    dateFrom?: string;
    dateTo?: string;
}

export interface BrowserMemoryMatch {
    evidence: MemoryEvidence;
    source: MemorySource;
}

export class BrowserMemoryService {
    private corpusIdPromise: Promise<string> | undefined;
    private graphVersion = 0;

    public constructor(private readonly client: MemoryService) {}

    public async ingest(
        document: BrowserMemoryDocument,
        mode: IngestionMode,
        options: {
            signal?: AbortSignal;
            onProgress?: (progress: JobProgress) => void;
        } = {},
    ): Promise<void> {
        const corpusId = await this.getCorpusId();
        const result = await this.client.ingestDocument({
            corpusId,
            source: {
                sourceId: sourceIdForUrl(document.url),
                sourceType: "web",
                title: document.title,
                canonicalUri: document.url,
                markdown: document.markdown,
                ...(document.tags === undefined ? {} : { tags: document.tags }),
                ...(document.capturedAt === undefined
                    ? {}
                    : { capturedAt: document.capturedAt }),
                metadata: {
                    ...(document.domain === undefined
                        ? {}
                        : { domain: document.domain }),
                    ...(document.pageType === undefined
                        ? {}
                        : { pageType: document.pageType }),
                    ...(document.source === undefined
                        ? {}
                        : { source: document.source }),
                },
            },
            pipeline: { mode, updatePolicy: "skipIfUnchanged" },
        });
        const job = await waitForMemoryJob(this.client, result.jobId, options);
        if (job.state !== "complete" && job.state !== "partial") {
            throw new Error(
                job.error ??
                    `Memory ingestion ended in unexpected state '${job.state}'`,
            );
        }
        this.graphVersion++;
    }

    public async search(
        options: BrowserMemorySearchOptions,
    ): Promise<BrowserMemoryMatch[]> {
        const corpusId = await this.getCorpusId();
        const sources = await this.client.listSources(corpusId);
        const requestedSourceIds =
            options.sourceIds === undefined
                ? undefined
                : new Set(options.sourceIds);
        const sourceIds = sources
            .filter(
                (source) =>
                    (requestedSourceIds === undefined ||
                        requestedSourceIds.has(source.sourceId)) &&
                    matchesFilters(source, options),
            )
            .map((source) => source.sourceId);
        if (sourceIds.length === 0) {
            return [];
        }
        const result = await this.client.search({
            corpusId,
            query: options.query,
            ...(options.limit === undefined ? {} : { limit: options.limit }),
            sourceTypes: ["web"],
            sourceIds,
        });
        const sourcesById = new Map(
            sources.map((source) => [source.sourceId, source]),
        );
        return result.matches.flatMap((evidence) => {
            const source = sourcesById.get(evidence.sourceId);
            return source === undefined ? [] : [{ evidence, source }];
        });
    }

    public async getSource(url: string): Promise<MemorySource | undefined> {
        return this.client.getSource(
            await this.getCorpusId(),
            sourceIdForUrl(url),
        );
    }

    public async getSourceById(
        sourceId: string,
    ): Promise<MemorySource | undefined> {
        return this.client.getSource(await this.getCorpusId(), sourceId);
    }

    public async listSources(): Promise<MemorySource[]> {
        return this.client.listSources(await this.getCorpusId());
    }

    public async clear(): Promise<number> {
        const clearedCount = await this.client.clearCorpus(
            await this.getCorpusId(),
        );
        this.graphVersion++;
        return clearedCount;
    }

    public async getKnowledgeGraph(): Promise<MemoryKnowledgeGraph> {
        return this.client.getKnowledgeGraph(await this.getCorpusId());
    }

    public getGraphVersion(): number {
        return this.graphVersion;
    }

    private getCorpusId(): Promise<string> {
        this.corpusIdPromise ??= this.findOrCreateCorpus();
        return this.corpusIdPromise;
    }

    private async findOrCreateCorpus(): Promise<string> {
        const existing = (await this.client.listCorpora()).find(
            (corpus) => corpus.name === browserCorpusName,
        );
        return (
            existing ??
            (await this.client.createCorpus(
                browserCorpusName,
                "Web pages captured or imported by the TypeAgent browser agent",
            ))
        ).corpusId;
    }
}

export function getBrowserMemoryService(
    client: MemoryService,
): BrowserMemoryService {
    let service = adapters.get(client);
    if (service === undefined) {
        service = new BrowserMemoryService(client);
        adapters.set(client, service);
    }
    return service;
}

function sourceIdForUrl(url: string): string {
    return `web:${createHash("sha256").update(url).digest("hex")}`;
}

function matchesFilters(
    source: MemorySource,
    options: BrowserMemorySearchOptions,
): boolean {
    if (options.url !== undefined && source.canonicalUri !== options.url) {
        return false;
    }
    const metadata = source.metadata ?? {};
    if (options.domain !== undefined && metadata.domain !== options.domain) {
        return false;
    }
    if (
        options.pageType !== undefined &&
        metadata.pageType !== options.pageType
    ) {
        return false;
    }
    if (options.source !== undefined && metadata.source !== options.source) {
        return false;
    }
    const revision = source.revisions.find(
        (candidate) => candidate.revisionId === source.activeRevisionId,
    );
    const capturedAt = revision?.capturedAt;
    return !(
        (options.dateFrom !== undefined &&
            (capturedAt === undefined || capturedAt < options.dateFrom)) ||
        (options.dateTo !== undefined &&
            (capturedAt === undefined || capturedAt > options.dateTo))
    );
}

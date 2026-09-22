// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { createHash } from "node:crypto";
import type {
    IngestionMode,
    JobProgress,
    MemoryEvent,
    MemoryEventForgetResult,
    MemoryEvidence,
    MemoryKnowledgeGraph,
    MemoryServiceCapabilities,
    MemoryService,
    MemorySource,
} from "@typeagent/memory-service";
import { waitForMemoryJob } from "@typeagent/memory-service/rpc";

const browserCorpusName = "TypeAgent Browser Memory";
const browserActivityProducer = {
    producerId: "typeagent-browser",
    producerType: "browser",
} as const;
const adapters = new WeakMap<MemoryService, BrowserMemoryService>();

export type BrowserActivityType =
    | "visited"
    | "bookmarked"
    | "captured"
    | "imported";

export interface BrowserMemoryDocument {
    url: string;
    title: string;
    markdown: string;
    source?: string;
    domain?: string;
    pageType?: string;
    capturedAt?: string;
    tags?: string[];
    activityType?: BrowserActivityType;
    activityId?: string;
    activityMetadata?: Record<string, unknown>;
}

export interface BrowserMemorySearchOptions {
    query: string;
    limit?: number;
    sourceIds?: string[];
    url?: string;
    domain?: string;
    pageType?: string;
    source?: string;
    eventType?: BrowserActivityType;
    dateFrom?: string;
    dateTo?: string;
}

export interface BrowserMemoryMatch {
    evidence: MemoryEvidence;
    source: MemorySource;
    latestActivity?: MemoryEvent;
}

export interface BrowserActivityEvent extends Omit<MemoryEvent, "eventType"> {
    eventType: BrowserActivityType;
}

export interface BrowserActivityFilter {
    dateFrom?: string;
    dateTo?: string;
    domains?: string[];
    eventTypes?: BrowserActivityType[];
    sources?: string[];
    sourceIds?: string[];
    pageTypes?: string[];
    pageSize?: number;
    continuationToken?: string;
}

export interface BrowserActivityPage {
    items: BrowserActivityEvent[];
    total: number;
    nextContinuationToken?: string;
}

export interface BrowserSourceKnowledge {
    source: MemorySource;
    entities: MemoryKnowledgeGraph["entities"];
    topics: MemoryKnowledgeGraph["topics"];
    relationships: MemoryKnowledgeGraph["relationships"];
}

export interface BrowserSourceKnowledge {
    source: MemorySource;
    entities: MemoryKnowledgeGraph["entities"];
    topics: MemoryKnowledgeGraph["topics"];
    relationships: MemoryKnowledgeGraph["relationships"];
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
            maxCharsPerChunk?: number;
        } = {},
    ): Promise<BrowserSourceKnowledge> {
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
            pipeline: {
                mode,
                updatePolicy: "skipIfUnchanged",
                ...(options.maxCharsPerChunk === undefined
                    ? {}
                    : { maxCharsPerChunk: options.maxCharsPerChunk }),
            },
        });
        const job = await waitForMemoryJob(this.client, result.jobId, options);
        if (job.state !== "complete" && job.state !== "partial") {
            throw new Error(
                job.error ??
                    `Memory ingestion ended in unexpected state '${job.state}'`,
            );
        }
        this.graphVersion++;
        await this.recordActivity(document, result.sourceId);
        const knowledge = await this.getSourceKnowledge(document.url);
        if (knowledge === undefined) {
            throw new Error(
                `Memory ingestion completed but source '${document.url}' was not found`,
            );
        }
        return knowledge;
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
        const activitySourceIds = hasActivitySearchFilter(options)
            ? new Set(
                  (
                      await this.collectActivityEvents({
                          ...(options.eventType === undefined
                              ? {}
                              : { eventTypes: [options.eventType] }),
                          ...(options.dateFrom === undefined
                              ? {}
                              : { eventFrom: options.dateFrom }),
                          ...(options.dateTo === undefined
                              ? {}
                              : { eventTo: options.dateTo }),
                      })
                  )
                      .filter((event) =>
                          matchesActivityMetadata(event, {
                              ...(options.domain === undefined
                                  ? {}
                                  : { domains: [options.domain] }),
                              ...(options.pageType === undefined
                                  ? {}
                                  : { pageTypes: [options.pageType] }),
                              ...(options.source === undefined
                                  ? {}
                                  : { sources: [options.source] }),
                          }),
                      )
                      .flatMap((event) => event.linkedSourceIds ?? []),
              )
            : undefined;
        const sourceIds = sources
            .filter(
                (source) =>
                    (requestedSourceIds === undefined ||
                        requestedSourceIds.has(source.sourceId)) &&
                    (activitySourceIds === undefined ||
                        activitySourceIds.has(source.sourceId)) &&
                    matchesSourceUrl(source, options),
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
        const activityBySource = await this.latestActivityBySource(
            result.matches.map((evidence) => evidence.sourceId),
        );
        return result.matches.flatMap((evidence) => {
            const source = sourcesById.get(evidence.sourceId);
            const latestActivity = activityBySource.get(evidence.sourceId);
            return source === undefined
                ? []
                : [
                      {
                          evidence,
                          source,
                          ...(latestActivity === undefined
                              ? {}
                              : { latestActivity }),
                      },
                  ];
        });
    }

    public async listActivity(
        filter: BrowserActivityFilter = {},
    ): Promise<BrowserActivityPage> {
        const events = await this.collectActivityEvents({
            ...(filter.eventTypes === undefined
                ? {}
                : { eventTypes: filter.eventTypes }),
            ...(filter.sourceIds === undefined
                ? {}
                : { linkedSourceIds: filter.sourceIds }),
            ...(filter.dateFrom === undefined
                ? {}
                : { eventFrom: filter.dateFrom }),
            ...(filter.dateTo === undefined ? {} : { eventTo: filter.dateTo }),
        });
        const filtered = events.filter((event) =>
            matchesActivityMetadata(event, filter),
        );
        const offset = parseActivityOffset(filter.continuationToken);
        const pageSize = Math.max(1, Math.min(filter.pageSize ?? 25, 100));
        const items = filtered.slice(offset, offset + pageSize);
        const nextOffset = offset + items.length;
        return {
            items,
            total: filtered.length,
            ...(nextOffset < filtered.length
                ? { nextContinuationToken: String(nextOffset) }
                : {}),
        };
    }

    public async forgetActivity(
        filter: Omit<
            BrowserActivityFilter,
            "pageSize" | "continuationToken"
        > & {
            eventIds?: string[];
        },
    ): Promise<MemoryEventForgetResult> {
        const corpusId = await this.getCorpusId();
        const matching = await this.listActivity({
            ...filter,
            pageSize: 100,
        });
        let events = matching.items;
        let token = matching.nextContinuationToken;
        while (token !== undefined) {
            const page = await this.listActivity({
                ...filter,
                pageSize: 100,
                continuationToken: token,
            });
            events = events.concat(page.items);
            token = page.nextContinuationToken;
        }
        const requestedIds =
            filter.eventIds === undefined
                ? undefined
                : new Set(filter.eventIds);
        const eventIds = events
            .filter(
                (event) =>
                    requestedIds === undefined ||
                    requestedIds.has(event.eventId),
            )
            .map((event) => event.eventId);
        if (eventIds.length === 0) {
            const corpus = await this.client.getCorpus(corpusId);
            return {
                corpusId,
                deletedEventCount: 0,
                deletedSourceCount: 0,
                retainedLinkedSourceIds: [],
                indexVersion: corpus?.indexVersion ?? "",
            };
        }
        return this.client.forgetEvents({
            corpusId,
            eventIds,
            forgetLinkedSources: false,
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

    public async getSourceKnowledge(
        url: string,
    ): Promise<BrowserSourceKnowledge | undefined> {
        const source = await this.getSource(url);
        if (source === undefined) {
            return undefined;
        }
        return {
            source,
            ...(await this.client.getSourceKnowledge(
                await this.getCorpusId(),
                source.sourceId,
            )),
        };
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

    public async getCapabilities(): Promise<MemoryServiceCapabilities> {
        return this.client.getCapabilities();
    }

    public getGraphVersion(): number {
        return this.graphVersion;
    }

    private async recordActivity(
        document: BrowserMemoryDocument,
        sourceId: string,
    ): Promise<void> {
        const eventType =
            document.activityType ?? activityTypeForSource(document.source);
        const eventTime = document.capturedAt ?? new Date().toISOString();
        const domain = document.domain ?? domainForUrl(document.url);
        await this.client.appendEvent({
            corpusId: await this.getCorpusId(),
            idempotencyKey:
                document.activityId ??
                `${eventType}:${sourceId}:${eventTime}:${document.source ?? ""}`,
            producer: browserActivityProducer,
            eventType,
            sourceKind: "web-activity",
            observedAt: new Date().toISOString(),
            eventTime,
            content: `${eventType}: ${document.title}`,
            linkedSourceIds: [sourceId],
            metadata: {
                ...document.activityMetadata,
                url: document.url,
                title: document.title,
                ...(domain === undefined ? {} : { domain }),
                ...(document.pageType === undefined
                    ? {}
                    : { pageType: document.pageType }),
                source: document.source ?? "browser",
            },
        });
    }

    private async collectActivityEvents(
        filter: {
            eventTypes?: BrowserActivityType[];
            linkedSourceIds?: string[];
            eventFrom?: string;
            eventTo?: string;
        } = {},
    ): Promise<BrowserActivityEvent[]> {
        const items: MemoryEvent[] = [];
        let continuationToken: string | undefined;
        do {
            const page = await this.client.listEvents({
                corpusId: await this.getCorpusId(),
                sourceKinds: ["web-activity"],
                producerIds: [browserActivityProducer.producerId],
                pageSize: 100,
                ...(filter.eventTypes === undefined
                    ? {}
                    : { eventTypes: filter.eventTypes }),
                ...(filter.linkedSourceIds === undefined
                    ? {}
                    : { linkedSourceIds: filter.linkedSourceIds }),
                ...(filter.eventFrom === undefined
                    ? {}
                    : { eventFrom: filter.eventFrom }),
                ...(filter.eventTo === undefined
                    ? {}
                    : { eventTo: filter.eventTo }),
                ...(continuationToken === undefined
                    ? {}
                    : { continuationToken }),
            });
            items.push(...page.items);
            continuationToken = page.nextContinuationToken;
        } while (continuationToken !== undefined);
        return items.filter((event): event is BrowserActivityEvent =>
            isBrowserActivityType(event.eventType),
        );
    }

    private async latestActivityBySource(
        sourceIds: string[],
    ): Promise<Map<string, MemoryEvent>> {
        if (sourceIds.length === 0) {
            return new Map();
        }
        const events = await this.collectActivityEvents({
            linkedSourceIds: sourceIds,
        });
        const latest = new Map<string, MemoryEvent>();
        for (const event of events) {
            for (const sourceId of event.linkedSourceIds ?? []) {
                if (!latest.has(sourceId)) {
                    latest.set(sourceId, event);
                }
            }
        }
        return latest;
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
    let canonicalUrl = url;
    try {
        const parsed = new URL(url);
        parsed.hash = "";
        canonicalUrl = parsed.toString();
    } catch {
        // Non-URL identifiers (for example imported file paths) remain stable.
    }
    return `web:${createHash("sha256").update(canonicalUrl).digest("hex")}`;
}

function matchesSourceUrl(
    source: MemorySource,
    options: BrowserMemorySearchOptions,
): boolean {
    return !(options.url !== undefined && source.canonicalUri !== options.url);
}

function hasActivitySearchFilter(options: BrowserMemorySearchOptions): boolean {
    return (
        options.domain !== undefined ||
        options.pageType !== undefined ||
        options.source !== undefined ||
        options.eventType !== undefined ||
        options.dateFrom !== undefined ||
        options.dateTo !== undefined
    );
}

function activityTypeForSource(
    source: string | undefined,
): BrowserActivityType {
    switch (source) {
        case "bookmark":
            return "bookmarked";
        case "history":
            return "visited";
        case "file_import":
        case "reading_list":
            return "imported";
        default:
            return "captured";
    }
}

function isBrowserActivityType(value: string): value is BrowserActivityType {
    return ["visited", "bookmarked", "captured", "imported"].includes(value);
}

function domainForUrl(url: string): string | undefined {
    try {
        return new URL(url).hostname;
    } catch {
        return undefined;
    }
}

function metadataString(event: MemoryEvent, key: string): string | undefined {
    const value = event.metadata?.[key];
    return typeof value === "string" ? value : undefined;
}

function matchesActivityMetadata(
    event: MemoryEvent,
    filter: BrowserActivityFilter,
): boolean {
    return (
        (filter.domains === undefined ||
            filter.domains.some(
                (domain) =>
                    domain.toLocaleLowerCase() ===
                    (metadataString(event, "domain") ?? "").toLocaleLowerCase(),
            )) &&
        (filter.sources === undefined ||
            filter.sources.includes(metadataString(event, "source") ?? "")) &&
        (filter.pageTypes === undefined ||
            filter.pageTypes.includes(metadataString(event, "pageType") ?? ""))
    );
}

function parseActivityOffset(token: string | undefined): number {
    if (token === undefined) {
        return 0;
    }
    if (!/^(0|[1-9][0-9]*)$/.test(token)) {
        throw new Error("Invalid activity continuation token");
    }
    return Number(token);
}
